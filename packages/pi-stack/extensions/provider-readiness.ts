/**
 * provider-readiness — passive provider health matrix.
 * @capability-id provider-readiness
 * @capability-criticality medium
 *
 * Why:
 * - The original implementation tried pi.loadModel() which does not exist in ExtensionAPI.
 * - A passive matrix (config + budget state) is cheaper, instant, and answers the
 *   real pre-launch question: "is it safe to start a swarm on this provider?"
 *
 * Data sources:
 * - routeModelRefs in .pi/settings.json (which providers are configured)
 * - analyzeQuota from quota-visibility (budget state per provider from session history)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { readProjectSettings } from "./context-watchdog-storage";
import { resolveGlobalWorkspaceSessionDir } from "./quota-visibility-session-roots";
import {
  analyzeQuota,
  buildProviderModelKey,
  parseProviderBudgets,
  parseRouteModelRefs,
  safeNum,
} from "./quota-visibility";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

export interface ProviderReadinessEntry {
  provider: string;
  modelRef: string | null;
  budgetState: "ok" | "warning" | "blocked" | "unknown";
  budgetScope?: "provider" | "provider-model";
  readiness: "ready" | "degraded" | "blocked" | "unconfigured";
  notes: string[];
}

export interface ProviderReadinessMatrix {
  generatedAtIso: string;
  entries: ProviderReadinessEntry[];
  summary: {
    ready: number;
    degraded: number;
    blocked: number;
    unconfigured: number;
  };
  recommendation: string;
}

interface RuntimeSignal {
  rateLimitHits: number;
  authHits: number;
  serverHits: number;
}

function readWorkspaceSettings(cwd: string): Record<string, unknown> {
  return readProjectSettings(cwd);
}

function piStackSettings(raw: Record<string, unknown>): Record<string, unknown> {
  return ((raw.piStack ?? {}) as Record<string, unknown>);
}

function modelFromProviderModelRef(provider: string, modelRef: string | null): string | undefined {
  if (!modelRef) return undefined;
  const prefix = `${provider}/`;
  if (!modelRef.startsWith(prefix)) return undefined;
  const model = modelRef.slice(prefix.length).trim();
  return model || undefined;
}

const RATE_LIMIT_RE = /(\b429\b|rate.?limit|too many requests|quota\s*exceeded|capacity\s*reached|resource\s*exhausted)/i;
const AUTH_RE = /(\b401\b|\b403\b|unauthori[sz]ed|forbidden|auth\s*failed|invalid\s*token)/i;
const SERVER_RE = /(\b5\d\d\b|overloaded|temporar(y|ily)\s*unavailable|internal\s*server\s*error)/i;

export const PROVIDER_READINESS_SESSION_TAIL_BYTES = 600_000;
export const PROVIDER_READINESS_SESSION_FILE_LIMIT = 12;

export function readProviderReadinessTailLines(filePath: string, maxBytes = PROVIDER_READINESS_SESSION_TAIL_BYTES): string[] {
  const safeMaxBytes = Math.max(1_000, Math.floor(Number(maxBytes) || PROVIDER_READINESS_SESSION_TAIL_BYTES));
  let fd: number | undefined;
  try {
    const stat = statSync(filePath);
    const bytesToRead = Math.min(safeMaxBytes, Math.max(0, stat.size));
    if (bytesToRead <= 0) return [];
    const buffer = Buffer.allocUnsafe(bytesToRead);
    fd = openSync(filePath, "r");
    readSync(fd, buffer, 0, bytesToRead, Math.max(0, stat.size - bytesToRead));
    return buffer.toString("utf8").split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
    }
  }
}

function collectRuntimeSignals(cwd: string, lookbackMinutes = 45): Record<string, RuntimeSignal> {
  const dir = resolveGlobalWorkspaceSessionDir(cwd);
  if (!existsSync(dir)) return {};

  const cutoffMs = Date.now() - lookbackMinutes * 60 * 1000;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(dir, f))
    .flatMap((p) => {
      try {
        const stat = statSync(p);
        return stat.mtimeMs >= cutoffMs ? [{ path: p, mtimeMs: stat.mtimeMs }] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, PROVIDER_READINESS_SESSION_FILE_LIMIT)
    .map((entry) => entry.path);

  const out: Record<string, RuntimeSignal> = {};

  for (const file of files) {
    const lines = readProviderReadinessTailLines(file);

    for (const line of lines) {
      let rec: any;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }

      const msg = rec?.message;
      const providerRaw = msg?.provider ?? rec?.provider;
      if (typeof providerRaw !== "string" || providerRaw.trim() === "") continue;
      const provider = providerRaw.trim().toLowerCase();

      const errorText = `${msg?.errorMessage ?? ""}`.trim();
      if (!errorText) continue;

      const cur = out[provider] ?? { rateLimitHits: 0, authHits: 0, serverHits: 0 };
      if (RATE_LIMIT_RE.test(errorText)) cur.rateLimitHits += 1;
      if (AUTH_RE.test(errorText)) cur.authHits += 1;
      if (SERVER_RE.test(errorText)) cur.serverHits += 1;
      out[provider] = cur;
    }
  }

  return out;
}

export async function buildProviderReadinessMatrix(cwd: string): Promise<ProviderReadinessMatrix> {
  const raw = readWorkspaceSettings(cwd);
  const piStack = piStackSettings(raw);
  const qv = (piStack.quotaVisibility ?? {}) as Record<string, unknown>;

  const routeModelRefs = parseRouteModelRefs(qv.routeModelRefs);
  const providerBudgets = parseProviderBudgets(qv.providerBudgets);

  const configuredProviders = Object.keys(routeModelRefs);
  const runtimeSignals = collectRuntimeSignals(cwd);

  // Get budget state from session history
  let budgetStateByProvider: Record<string, "ok" | "warning" | "blocked"> = {};
  let budgetStateByProviderModel: Record<string, "ok" | "warning" | "blocked"> = {};
  if (Object.keys(providerBudgets).length > 0) {
    try {
      const days = safeNum((qv.defaultDays)) || 30;
      const status = await analyzeQuota({ days, providerBudgets, providerWindowHours: {}, cwd });
      for (const b of status.providerBudgets) {
        if (b.providerModelKey) budgetStateByProviderModel[b.providerModelKey] = b.state;
        else budgetStateByProvider[b.provider] = b.state;
      }
    } catch {
      // quota analysis failure is non-fatal
    }
  }

  const entries: ProviderReadinessEntry[] = configuredProviders.map((provider) => {
    const modelRef = routeModelRefs[provider] ?? null;
    const model = modelFromProviderModelRef(provider, modelRef);
    const providerModelKey = model ? buildProviderModelKey(provider, model) : undefined;
    const modelBudgetState = providerModelKey ? budgetStateByProviderModel[providerModelKey] : undefined;
    const providerBudgetState = budgetStateByProvider[provider];
    const budgetState = modelBudgetState ?? providerBudgetState ?? "unknown";
    const budgetScope = modelBudgetState ? "provider-model" : providerBudgetState ? "provider" : undefined;
    const runtime = runtimeSignals[provider];
    const notes: string[] = [];
    let readiness: ProviderReadinessEntry["readiness"];

    if (!modelRef) {
      notes.push("No model ref configured in routeModelRefs.");
      readiness = "unconfigured";
    } else if (budgetState === "blocked") {
      notes.push(`Budget state: BLOCKED. Use override token or wait for period reset.`);
      readiness = "blocked";
    } else if (budgetState === "warning") {
      notes.push(`Budget state: WARNING. Approaching cap — monitor before long runs.`);
      readiness = "degraded";
    } else if (budgetState === "unknown") {
      notes.push("No budget config found — provider cost is untracked.");
      readiness = "ready";
    } else {
      if (budgetScope === "provider-model") notes.push(`Model-specific budget state: ${budgetState.toUpperCase()}.`);
      readiness = "ready";
    }

    // Runtime health overlay from recent session errors.
    if (runtime?.authHits && runtime.authHits >= 1) {
      notes.push(`Runtime auth failures detected (${runtime.authHits}) in recent window.`);
      readiness = "blocked";
    } else if (runtime?.rateLimitHits && runtime.rateLimitHits >= 2) {
      notes.push(`Runtime 429/rate-limit streak detected (${runtime.rateLimitHits}) in recent window.`);
      if (readiness !== "blocked") readiness = "degraded";
    } else if (runtime?.serverHits && runtime.serverHits >= 3) {
      notes.push(`Runtime server instability detected (${runtime.serverHits}) in recent window.`);
      if (readiness !== "blocked") readiness = "degraded";
    }

    return { provider, modelRef, budgetState, budgetScope, readiness, notes };
  });

  // Also include budget-tracked providers that have no model ref
  for (const provider of Object.keys(providerBudgets)) {
    if (!configuredProviders.includes(provider)) {
      entries.push({
        provider,
        modelRef: null,
        budgetState: budgetStateByProvider[provider] ?? "unknown",
        readiness: "unconfigured",
        notes: ["Provider has budget config but no routeModelRef entry."],
      });
    }
  }

  const summary = {
    ready: entries.filter((e) => e.readiness === "ready").length,
    degraded: entries.filter((e) => e.readiness === "degraded").length,
    blocked: entries.filter((e) => e.readiness === "blocked").length,
    unconfigured: entries.filter((e) => e.readiness === "unconfigured").length,
  };

  const readyCount = summary.ready + summary.degraded;
  const recommendation =
    readyCount === 0
      ? "BLOCKED: no providers ready. Check budget caps and routeModelRefs config."
      : summary.blocked > 0
        ? `${summary.blocked} provider(s) blocked. ${readyCount} available. Run /quota-visibility to review caps.`
        : summary.degraded > 0
          ? `${summary.degraded} provider(s) in WARNING. Prefer ready providers for long runs.`
          : `All ${summary.ready} configured provider(s) ready.`;

  return {
    generatedAtIso: new Date().toISOString(),
    entries,
    summary,
    recommendation,
  };
}

function formatMatrix(matrix: ProviderReadinessMatrix): string {
  const lines: string[] = ["provider-matrix"];
  for (const e of matrix.entries) {
    const icon = e.readiness === "ready" ? "ok" : e.readiness === "degraded" ? "warn" : e.readiness === "blocked" ? "BLOCK" : "none";
    lines.push(`  ${e.provider}: ${icon} | model=${e.modelRef ?? "(none)"} | budget=${e.budgetState}`);
    for (const n of e.notes) lines.push(`    note: ${n}`);
  }
  lines.push(`summary: ready=${matrix.summary.ready} degraded=${matrix.summary.degraded} blocked=${matrix.summary.blocked} unconfigured=${matrix.summary.unconfigured}`);
  lines.push(`recommendation: ${matrix.recommendation}`);
  return lines.join("\n");
}

export default function providerReadinessExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "provider_readiness_matrix",
    label: "Provider Readiness Matrix",
    description:
      "Passive health matrix for configured providers: config presence + budget state from session history. No model calls — safe to run at any time.",
    parameters: Type.Object({
      providers: Type.Optional(
        Type.Array(Type.String(), {
          description: "Limit to specific providers. Default: all configured in routeModelRefs.",
        })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const matrix = await buildProviderReadinessMatrix(ctx.cwd);
      const filtered = params?.providers?.length
        ? { ...matrix, entries: matrix.entries.filter((e) => params.providers!.includes(e.provider)) }
        : matrix;
      return buildOperatorVisibleToolResponse({
        label: "provider_readiness_matrix",
        summary: [
          "provider-readiness-matrix:",
          `ready=${filtered.summary.ready}`,
          `degraded=${filtered.summary.degraded}`,
          `blocked=${filtered.summary.blocked}`,
          `unconfigured=${filtered.summary.unconfigured}`,
          `entries=${filtered.entries.length}`,
        ].join(" "),
        details: filtered,
      });
    },
  });

  pi.registerCommand("provider-matrix", {
    description: "Passive provider readiness matrix — config + budget state, no model calls.",
    handler: async (_args, ctx) => {
      const matrix = await buildProviderReadinessMatrix(ctx.cwd);
      const notifyType = matrix.summary.blocked > 0 ? "warning" : "info";
      ctx.ui.notify(formatMatrix(matrix), notifyType);
    },
  });
}
