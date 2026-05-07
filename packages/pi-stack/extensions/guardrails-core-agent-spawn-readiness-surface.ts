import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { buildSimpleAgentRunPlan, evaluateAgentSpawnReadiness } from "./guardrails-core-agent-spawn-readiness";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function registerGuardrailsAgentSpawnReadinessSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "agent_spawn_readiness_gate",
    label: "Agent Spawn Readiness Gate",
    description: "Report-only simple-agent spawn readiness gate (single agent, timeout, cwd, budget, rollback, bounded scope). Never dispatches execution.",
    parameters: Type.Object({
      max_agents_requested: Type.Optional(Type.Number({ description: "Requested number of agents for this spawn attempt (must be 1 for simple spawn lane)." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Explicit timeout in milliseconds (bounded)." })),
      cwd_isolation_known: Type.Optional(Type.Boolean({ description: "Whether cwd isolation is explicitly known." })),
      budget_known: Type.Optional(Type.Boolean({ description: "Whether bounded budget is explicitly known." })),
      rollback_plan_known: Type.Optional(Type.Boolean({ description: "Whether rollback plan is explicitly known." })),
      bounded_scope_known: Type.Optional(Type.Boolean({ description: "Whether bounded scope is explicitly known." })),
      live_reload_completed: Type.Optional(Type.Boolean({ description: "Whether live reload was completed before runtime invocation." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = evaluateAgentSpawnReadiness({
        maxAgentsRequested: typeof p.max_agents_requested === "number" ? p.max_agents_requested : undefined,
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        cwdIsolationKnown: asOptionalBoolean(p.cwd_isolation_known),
        budgetKnown: asOptionalBoolean(p.budget_known),
        rollbackPlanKnown: asOptionalBoolean(p.rollback_plan_known),
        boundedScopeKnown: asOptionalBoolean(p.bounded_scope_known),
        liveReloadCompleted: asOptionalBoolean(p.live_reload_completed),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_spawn_readiness_gate",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "simple_agent_run_plan",
    label: "Simple Agent Run Plan",
    description: "Report-only one-slice simple-agent run packet with provider/model, declared files, timeout, validation, rollback, budget, abort, and log-tail gates. Never dispatches execution.",
    parameters: Type.Object({
      goal: Type.Optional(Type.String({ description: "One-slice goal for the future worker." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference, e.g. openai-codex/gpt-5.3-codex-spark." })),
      cwd: Type.Optional(Type.String({ description: "Explicit worker cwd." })),
      declared_files: Type.Optional(Type.Array(Type.String(), { description: "Exact file scope for the future worker." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Short bounded timeout in milliseconds." })),
      validation_gate_known: Type.Optional(Type.Boolean({ description: "Whether parent-side validation is known before dispatch." })),
      rollback_plan_known: Type.Optional(Type.Boolean({ description: "Whether rollback is explicit and non-destructive." })),
      budget_known: Type.Optional(Type.Boolean({ description: "Whether provider/cost budget is bounded." })),
      abort_known: Type.Optional(Type.Boolean({ description: "Whether safe abort is available without killing the parent session." })),
      log_tail_known: Type.Optional(Type.Boolean({ description: "Whether bounded log/status visibility is available." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when settings/routing/CI/publish/credentials/remote/protected scope is requested." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = buildSimpleAgentRunPlan({
        goal: typeof p.goal === "string" ? p.goal : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        cwd: typeof p.cwd === "string" ? p.cwd : ctx?.cwd,
        declaredFiles: asOptionalStringArray(p.declared_files),
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        validationGateKnown: asOptionalBoolean(p.validation_gate_known),
        rollbackPlanKnown: asOptionalBoolean(p.rollback_plan_known),
        budgetKnown: asOptionalBoolean(p.budget_known),
        abortKnown: asOptionalBoolean(p.abort_known),
        logTailKnown: asOptionalBoolean(p.log_tail_known),
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
      });
      return buildOperatorVisibleToolResponse({
        label: "simple_agent_run_plan",
        summary: result.summary,
        details: result,
      });
    },
  });
}
