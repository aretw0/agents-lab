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

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  analyzeQuota,
  parseProviderBudgets,
  parseRouteModelRefs,
  safeNum,
} from "./quota-visibility";

export interface ProviderReadinessEntry {
  provider: string;
  modelRef: string | null;
  budgetState: "ok" | "warning" | "blocked" | "unknown";
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

function readWorkspaceSettings(cwd: string): Record<string, unknown> {
  try {
    const p = path.join(cwd, ".pi", "settings.json");
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function piStackSettings(raw: Record<string, unknown>): Record<string, unknown> {
  return ((raw.piStack ?? {}) as Record<string, unknown>);
}

export async function buildProviderReadinessMatrix(cwd: string): Promise<ProviderReadinessMatrix> {
  const raw = readWorkspaceSettings(cwd);
  const piStack = piStackSettings(raw);
  const qv = (piStack.quotaVisibility ?? {}) as Record<string, unknown>;

  const routeModelRefs = parseRouteModelRefs(qv.routeModelRefs);
  const providerBudgets = parseProviderBudgets(qv.providerBudgets);

  const configuredProviders = Object.keys(routeModelRefs);

  // Get budget state from session history
  let budgetStateByProvider: Record<string, "ok" | "warning" | "blocked"> = {};
  if (Object.keys(providerBudgets).length > 0) {
    try {
      const days = safeNum((qv.defaultDays)) || 30;
      const status = await analyzeQuota({ days, providerBudgets, providerWindowHours: {} });
      for (const b of status.providerBudgets) {
        budgetStateByProvider[b.provider] = b.state;
      }
    } catch {
      // quota analysis failure is non-fatal
    }
  }

  const entries: ProviderReadinessEntry[] = configuredProviders.map((provider) => {
    const modelRef = routeModelRefs[provider] ?? null;
    const budgetState = budgetStateByProvider[provider] ?? "unknown";
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
      readiness = "ready";
    }

    return { provider, modelRef, budgetState, readiness, notes };
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
      return {
        content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }],
        details: filtered,
      };
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
