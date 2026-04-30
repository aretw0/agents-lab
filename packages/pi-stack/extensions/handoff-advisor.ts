/**
 * handoff-advisor — deterministic control plane handoff advisor.
 *
 * Combines two independent signals into one unified handoff decision:
 *   1. Budget pressure (from quota-visibility / analyzeQuota)
 *   2. Provider availability (from provider-readiness matrix)
 *
 * Why this exists vs quota_visibility_route:
 *   - quota_visibility_route only uses budget signal.
 *   - handoff-advisor adds availability/health signal and produces an
 *     explicit switch command the human can confirm, not just a recommendation.
 *
 * noAutoSwitch invariant: this tool NEVER switches provider automatically.
 * It only recommends and produces a confirming command hint.
 *
 * @capability-id handoff-advisor
 * @capability-criticality high
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  analyzeQuota,
  buildRouteAdvisory,
  parseProviderBudgets,
  parseRouteModelRefs,
  safeNum,
  type RoutingProfile,
} from "./quota-visibility";
import { readProjectSettings } from "./context-watchdog-storage";
import { buildProviderReadinessMatrix } from "./provider-readiness";

const RATE_LIMIT_RE = /(\b429\b|rate.?limit|too many requests|quota\s*exceeded|capacity\s*reached|resource\s*exhausted)/i;

function extractProviderRuntimeError(event: unknown): { provider?: string; errorMessage?: string } {
  if (!event || typeof event !== "object") return {};
  const msg = (event as any).message;
  const provider = typeof msg?.provider === "string" ? msg.provider : undefined;
  const errorMessage = typeof msg?.errorMessage === "string" ? msg.errorMessage : undefined;
  return { provider, errorMessage };
}

// ---------------------------------------------------------------------------
// Score types
// ---------------------------------------------------------------------------

/** Lower = better. Combined budget + readiness score for provider selection. */
export interface ProviderHandoffScore {
  provider: string;
  modelRef: string | null;
  budgetState: "ok" | "warning" | "blocked" | "unknown";
  readiness: "ready" | "degraded" | "blocked" | "unconfigured";
  score: number;
  available: boolean;
}

export interface HandoffAdvisory {
  generatedAtIso: string;
  currentProvider: string | undefined;
  currentState: "ok" | "warn" | "block" | "unknown";
  recommended: {
    provider: string;
    modelRef: string;
    switchCommand: string;
    reason: string;
  } | null;
  candidates: ProviderHandoffScore[];
  blockedProviders: string[];
  noAutoSwitch: true;
}

function toRoutingProfile(raw?: string): RoutingProfile {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "cheap" || v === "reliable") return v;
  return "balanced";
}

// ---------------------------------------------------------------------------
// Score computation (pure, testable)
// ---------------------------------------------------------------------------

const BUDGET_SCORE: Record<string, number> = { ok: 0, warning: 1, blocked: 10, unknown: 5 };
const READINESS_SCORE: Record<string, number> = { ready: 0, degraded: 1, blocked: 10, unconfigured: 3 };

export function computeHandoffScore(
  budgetState: string,
  readiness: string,
): number {
  const bs = BUDGET_SCORE[budgetState] ?? 5;
  const rs = READINESS_SCORE[readiness] ?? 3;
  return bs + rs; // additive — blocked in either dimension → high score → deprioritized
}

export function isAvailable(budgetState: string, readiness: string): boolean {
  return budgetState !== "blocked" && readiness !== "blocked" && readiness !== "unconfigured";
}

export function selectNextProvider(
  candidates: ProviderHandoffScore[],
  currentProvider: string | undefined,
): ProviderHandoffScore | null {
  const eligible = candidates
    .filter((c) => c.available && c.provider !== currentProvider)
    .sort((a, b) => a.score - b.score || a.provider.localeCompare(b.provider));
  return eligible[0] ?? null;
}

// ---------------------------------------------------------------------------
// Advisory builder
// ---------------------------------------------------------------------------

function readPiStackSettings(cwd: string): Record<string, unknown> {
  const raw = readProjectSettings(cwd);
  return (raw.piStack ?? {}) as Record<string, unknown>;
}

export async function buildHandoffAdvisory(
  cwd: string,
  currentProvider: string | undefined,
): Promise<HandoffAdvisory> {
  const piStack = readPiStackSettings(cwd);
  const qv = (piStack.quotaVisibility ?? {}) as Record<string, unknown>;
  const routeModelRefs = parseRouteModelRefs(qv.routeModelRefs);
  const providerBudgets = parseProviderBudgets(qv.providerBudgets);

  // Build readiness matrix (includes budget state from session history)
  const matrix = await buildProviderReadinessMatrix(cwd);

  // Build route advisory for budget pressure
  let routeAdvisory;
  try {
    const days = safeNum(qv.defaultDays) || 30;
    const status = await analyzeQuota({ days, providerBudgets, providerWindowHours: {} });
    routeAdvisory = buildRouteAdvisory(status, toRoutingProfile(undefined));
  } catch {
    routeAdvisory = null;
  }

  const budgetStateByProvider: Record<string, string> = {};
  if (routeAdvisory) {
    for (const c of routeAdvisory.consideredProviders) {
      budgetStateByProvider[c.provider] = c.state;
    }
  }

  // Combine readiness + budget into unified candidates list
  const candidates: ProviderHandoffScore[] = matrix.entries.map((entry) => {
    const budgetState = (budgetStateByProvider[entry.provider] ?? entry.budgetState) as string;
    const score = computeHandoffScore(budgetState, entry.readiness);
    return {
      provider: entry.provider,
      modelRef: entry.modelRef,
      budgetState: budgetState as ProviderHandoffScore["budgetState"],
      readiness: entry.readiness,
      score,
      available: isAvailable(budgetState, entry.readiness),
    };
  });

  // Sort by score (ascending = best first)
  candidates.sort((a, b) => a.score - b.score || a.provider.localeCompare(b.provider));

  const blockedProviders = candidates
    .filter((c) => !c.available)
    .map((c) => c.provider);

  const next = selectNextProvider(candidates, currentProvider);
  const currentEntry = candidates.find((c) => c.provider === currentProvider);

  const currentState: HandoffAdvisory["currentState"] = currentEntry
    ? currentEntry.budgetState === "blocked"
      ? "block"
      : currentEntry.budgetState === "warning"
        ? "warn"
        : currentEntry.readiness === "degraded" || currentEntry.readiness === "unconfigured"
          ? "warn"
          : "ok"
    : "unknown";

  let recommended: HandoffAdvisory["recommended"] = null;
  if (next?.modelRef) {
    const [provider, modelId] = next.modelRef.split("/");
    recommended = {
      provider: next.provider,
      modelRef: next.modelRef,
      // Explicit switch hint — human confirms before running
      switchCommand: `quota_visibility_route({ "profile": "balanced", "execute": true })`,
      reason: [
        `${next.provider} has lowest combined score (budget:${next.budgetState} + readiness:${next.readiness} = ${next.score}).`,
        `modelRef: ${next.modelRef}`,
        `Confirm: update defaultProvider/defaultModel or run the switch command above.`,
      ].join(" "),
    };
    void provider; void modelId; // used via modelRef destructuring above
  } else if (next) {
    recommended = {
      provider: next.provider,
      modelRef: "(no routeModelRef configured)",
      switchCommand: `Add piStack.quotaVisibility.routeModelRefs["${next.provider}"] to .pi/settings.json`,
      reason: `${next.provider} is best available but has no routeModelRef configured.`,
    };
  }

  return {
    generatedAtIso: new Date().toISOString(),
    currentProvider,
    currentState,
    recommended,
    candidates,
    blockedProviders,
    noAutoSwitch: true,
  };
}

// ---------------------------------------------------------------------------
// Execute path (opt-in, audited)
// ---------------------------------------------------------------------------

export interface HandoffExecutionResult {
  executed: boolean;
  executedModelRef: string | undefined;
  reason: string | undefined;
  advisory: HandoffAdvisory;
}

/** Pure helper: resolve model ref for a recommended provider given routeModelRefs map.
 *  Returns undefined if the provider has no configured routeModelRef. */
export function resolveHandoffModelRef(
  recommendedProvider: string,
  routeModelRefs: Record<string, string | undefined>,
): string | undefined {
  return routeModelRefs[recommendedProvider];
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function handoffAdvisorExtension(pi: ExtensionAPI) {
  // ---- tool: handoff_advisor -------------------------------------------

  pi.registerTool({
    name: "handoff_advisor",
    label: "Handoff Advisor",
    description: [
      "Deterministic control plane handoff advisor.",
      "Combines budget pressure (quota-visibility) + provider availability (provider-readiness)",
      "to recommend the next provider when current is at WARN/BLOCK.",
      "execute=true: opt-in execute path — calls pi.setModel and audits the decision.",
      "noAutoSwitch default — execute must be explicitly requested.",
    ].join(" "),
    parameters: Type.Object({
      current_provider: Type.Optional(
        Type.String({ description: "Currently active provider (used to exclude from candidates). Optional." })
      ),
      execute: Type.Optional(
        Type.Boolean({ description: "If true, apply the recommended provider switch via pi.setModel. Audited." })
      ),
      reason: Type.Optional(
        Type.String({ description: "Human-readable reason for the switch, stored in audit log." })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = params as { current_provider?: string; execute?: boolean; reason?: string };
      const advisory = await buildHandoffAdvisory(ctx.cwd, p.current_provider);

      let executed = false;
      let executedModelRef: string | undefined;

      if (p.execute === true && advisory.recommended?.modelRef && advisory.recommended.modelRef !== "(no routeModelRef configured)") {
        const [provider, modelId] = advisory.recommended.modelRef.split("/");
        const model = ctx.modelRegistry.find(provider, modelId);
        if (model) {
          executed = await pi.setModel(model);
          if (executed) executedModelRef = advisory.recommended.modelRef;
        }

        pi.appendEntry("handoff-advisor.route-execution", {
          atIso: new Date().toISOString(),
          currentProvider: advisory.currentProvider,
          recommendedProvider: advisory.recommended.provider,
          executedModelRef,
          executed,
          reason: p.reason,
          currentState: advisory.currentState,
          score: advisory.candidates.find((c) => c.provider === advisory.recommended?.provider)?.score,
        });
      }

      const result: HandoffExecutionResult = { executed, executedModelRef, reason: p.reason, advisory };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  // ---- command: /handoff -----------------------------------------------

  pi.registerCommand("handoff", {
    description: "Control plane handoff advisor. Usage: /handoff [current_provider] [--execute [--reason <text>]]",
    handler: async (args, ctx) => {
      const tokens = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const executeIdx = tokens.findIndex((t) => t === "--execute" || t === "--apply");
      const execute = executeIdx >= 0;
      let reason: string | undefined;
      const reasonIdx = tokens.findIndex((t) => t === "--reason");
      if (reasonIdx >= 0 && tokens[reasonIdx + 1]) {
        reason = tokens.slice(reasonIdx + 1).join(" ");
      }
      const currentProvider = tokens.find((t) => !t.startsWith("--")) || undefined;

      const advisory = await buildHandoffAdvisory(ctx.cwd, currentProvider);

      let executed = false;
      let executedModelRef: string | undefined;

      if (execute && advisory.recommended?.modelRef && advisory.recommended.modelRef !== "(no routeModelRef configured)") {
        const [provider, modelId] = advisory.recommended.modelRef.split("/");
        const model = ctx.modelRegistry.find(provider, modelId);
        if (model) {
          executed = await pi.setModel(model);
          if (executed) executedModelRef = advisory.recommended.modelRef;
        }

        pi.appendEntry("handoff-advisor.route-execution", {
          atIso: new Date().toISOString(),
          currentProvider: advisory.currentProvider,
          recommendedProvider: advisory.recommended.provider,
          executedModelRef,
          executed,
          reason,
          currentState: advisory.currentState,
          score: advisory.candidates.find((c) => c.provider === advisory.recommended?.provider)?.score,
        });
      }

      const lines: string[] = [
        "handoff advisor",
        `generated: ${advisory.generatedAtIso.slice(0, 19)}Z`,
        `current: ${advisory.currentProvider ?? "(unknown)"} [${advisory.currentState}]`,
        "",
      ];

      if (advisory.recommended) {
        lines.push("RECOMMENDATION:");
        lines.push(`  next:    ${advisory.recommended.provider}`);
        lines.push(`  model:   ${advisory.recommended.modelRef}`);
        if (!execute) {
          lines.push(`  switch:  ${advisory.recommended.switchCommand}`);
        }
        lines.push(`  reason:  ${advisory.recommended.reason.slice(0, 120)}`);
        if (execute) {
          lines.push(`  executed: ${executed ? `YES → ${executedModelRef}` : "NO (model not found in registry)"}`);
          if (reason) lines.push(`  rationale: ${reason}`);
        }
      } else {
        lines.push("No available provider found.");
        if (advisory.blockedProviders.length > 0) {
          lines.push(`Blocked: ${advisory.blockedProviders.join(", ")}`);
        }
        lines.push("Action: configure routeModelRefs or adjust budgets in .pi/settings.json.");
      }

      lines.push("", "candidates:");
      for (const c of advisory.candidates) {
        const avail = c.available ? "avail" : "unavail";
        lines.push(
          `  ${c.provider.padEnd(24)} score=${c.score} budget=${c.budgetState} readiness=${c.readiness} [${avail}]`
        );
      }

      if (!execute) {
        lines.push("", "noAutoSwitch: true — pass --execute to apply.");
      }

      ctx.ui.notify(
        lines.join("\n"),
        advisory.currentState === "block" ? "error"
          : advisory.currentState === "warn" ? "warning"
            : "info"
      );
    },
  });

  // ---- proactive runtime hint (no auto-switch) -------------------------

  pi.on("message_end", async (event, ctx) => {
    const { provider, errorMessage } = extractProviderRuntimeError(event);
    if (!provider || !errorMessage) return;
    if (!RATE_LIMIT_RE.test(errorMessage)) return;

    const advisory = await buildHandoffAdvisory(ctx.cwd, provider);
    if (!advisory.recommended || advisory.recommended.provider === provider) return;

    const recommendation = [
      `runtime 429 detectado em ${provider}`,
      `próximo recomendado: ${advisory.recommended.modelRef}`,
      `execute manual: /handoff ${provider} --execute --reason runtime-429`,
    ].join(" | ");

    ctx.ui.setStatus?.("handoff-advisor", `[handoff] ${provider}→${advisory.recommended.provider}`);
    ctx.ui.notify(recommendation, "warning");

    pi.appendEntry("handoff-advisor.runtime-alert", {
      atIso: new Date().toISOString(),
      fromProvider: provider,
      errorMessage,
      recommendedProvider: advisory.recommended.provider,
      recommendedModelRef: advisory.recommended.modelRef,
      noAutoSwitch: true,
    });
  });
}
