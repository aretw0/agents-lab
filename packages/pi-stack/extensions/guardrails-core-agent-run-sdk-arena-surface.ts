import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { buildAgentRunSdkProviderModelArenaPacket } from "./guardrails-core-agent-run-sdk-arena";
import { resolveExecutionCwdParam } from "./guardrails-core-execution-context";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function registerAgentRunSdkProviderModelArenaTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "agent_run_sdk_provider_model_arena_packet",
    label: "Agent Run SDK Provider/Model Arena Packet",
    description: "Report-only arena packet for comparing SDK worker maturity by provider/model/envelope with explicit budgets. Never dispatches paid/model calls.",
    parameters: Type.Object({
      arena_id: Type.Optional(Type.String({ description: "Future arena run id." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Provider/model reference." })),
      cwd: Type.Optional(Type.String({ description: "Worker cwd. Defaults to current cwd." })),
      envelopes: Type.Optional(Type.Array(Type.String(), { description: "Arena envelopes to include." })),
      max_calls: Type.Optional(Type.Number({ description: "Maximum paid/model calls allowed by the future arena budget." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Bounded timeout per future canary in milliseconds." })),
      max_estimated_cost_usd: Type.Optional(Type.Number({ description: "Maximum estimated spend for the future arena run." })),
      budget_evidence: Type.Optional(Type.String({ description: "Manual or structured budget evidence for this provider/model." })),
      budget_decision: Type.Optional(Type.String({ description: "Provider/model budget decision: ok, warn, blocked, or unknown." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope is requested." })),
      unexpected_dirty: Type.Optional(Type.Boolean({ description: "Blocks when workspace dirty state is unexpected." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = buildAgentRunSdkProviderModelArenaPacket({
        arenaId: typeof p.arena_id === "string" ? p.arena_id : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        cwd: resolveExecutionCwdParam(p.cwd, ctx.cwd),
        envelopes: asOptionalStringArray(p.envelopes),
        maxCalls: typeof p.max_calls === "number" ? p.max_calls : undefined,
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        maxEstimatedCostUsd: typeof p.max_estimated_cost_usd === "number" ? p.max_estimated_cost_usd : undefined,
        budgetEvidence: typeof p.budget_evidence === "string" ? p.budget_evidence : undefined,
        budgetDecision: typeof p.budget_decision === "string" ? p.budget_decision : undefined,
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
        unexpectedDirty: asOptionalBoolean(p.unexpected_dirty),
      });
      return buildOperatorVisibleToolResponse({ label: "agent_run_sdk_provider_model_arena_packet", summary: result.summary, details: result });
    },
  });
}
