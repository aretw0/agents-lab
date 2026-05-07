import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { buildOneSliceAgentRunPlan, evaluateAgentSpawnReadiness } from "./guardrails-core-agent-spawn-readiness";
import { buildOneSliceAgentAbortPlan, buildOneSliceAgentRunStatus, type OneSliceAgentRunRegistryEntry } from "./guardrails-core-one-slice-agent-run-runtime";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function registryPath(cwd: string): string {
  return path.join(cwd, ".pi", "reports", "one-slice-agent-runs.json");
}

function readRegistryEntry(cwd: string, runId: string): OneSliceAgentRunRegistryEntry | undefined {
  const filePath = registryPath(cwd);
  if (!existsSync(filePath)) return undefined;
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { runs?: OneSliceAgentRunRegistryEntry[] } | OneSliceAgentRunRegistryEntry[];
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.runs) ? parsed.runs : [];
  return rows.find((row) => row?.runId === runId);
}

function readLogTail(logPath: string, maxLines: number): string[] {
  if (!logPath || !existsSync(logPath)) return [];
  const text = readFileSync(logPath, "utf8");
  return text.split(/\r?\n/).slice(-Math.max(1, Math.min(500, Math.floor(maxLines))));
}

export function registerGuardrailsAgentSpawnReadinessSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "agent_spawn_readiness_gate",
    label: "Agent Spawn Readiness Gate",
    description: "Report-only agent spawn readiness gate (single worker, timeout, cwd, budget, rollback, bounded scope). Never dispatches execution.",
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
    name: "one_slice_agent_run_plan",
    label: "One-Slice Agent Run Plan",
    description: "Report-only one-slice agent run packet with provider/model, declared files, timeout, validation, rollback, budget, abort, and log-tail gates. Never dispatches execution.",
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
      const result = buildOneSliceAgentRunPlan({
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
        label: "one_slice_agent_run_plan",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "one_slice_agent_run_status",
    label: "One-Slice Agent Run Status",
    description: "Read-only status lookup for a registered one-slice agent run. Never starts, stops, or dispatches execution.",
    parameters: Type.Object({
      run_id: Type.String({ description: "Simple-agent run id." }),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const runId = typeof p.run_id === "string" ? p.run_id : "";
      const entry = readRegistryEntry(ctx.cwd, runId);
      const result = buildOneSliceAgentRunStatus(runId, entry);
      return buildOperatorVisibleToolResponse({
        label: "one_slice_agent_run_status",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "one_slice_agent_run_log_tail",
    label: "One-Slice Agent Run Log Tail",
    description: "Read-only bounded log tail for a registered one-slice agent run. Never starts, stops, or dispatches execution.",
    parameters: Type.Object({
      run_id: Type.String({ description: "Simple-agent run id." }),
      max_lines: Type.Optional(Type.Number({ description: "Maximum tail lines, clamped to 1..500." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const runId = typeof p.run_id === "string" ? p.run_id : "";
      const entry = readRegistryEntry(ctx.cwd, runId);
      const maxLines = typeof p.max_lines === "number" ? p.max_lines : 80;
      const lines = entry?.logPath ? readLogTail(entry.logPath, maxLines) : [];
      const result = {
        mode: "one-slice-agent-run-log-tail" as const,
        activation: "none" as const,
        authorization: "none" as const,
        dispatchAllowed: false,
        processStartAllowed: false,
        processStopAllowed: false,
        runId,
        found: !!entry,
        logPath: entry?.logPath,
        maxLines: Math.max(1, Math.min(500, Math.floor(maxLines))),
        lines,
        summary: `one-slice-agent-run-log-tail: runId=${runId || "unknown"} found=${entry ? "yes" : "no"} lines=${lines.length} dispatch=no authorization=none`,
      };
      return buildOperatorVisibleToolResponse({
        label: "one_slice_agent_run_log_tail",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "one_slice_agent_run_abort",
    label: "One-Slice Agent Run Abort",
    description: "Dry-first abort plan for a registered one-slice agent run. execute=true requires operator_confirmed=true and only targets the registered worker pid.",
    parameters: Type.Object({
      run_id: Type.String({ description: "Simple-agent run id." }),
      execute: Type.Optional(Type.Boolean({ description: "When true, send SIGTERM to the registered worker pid after gates pass." })),
      operator_confirmed: Type.Optional(Type.Boolean({ description: "Explicit human confirmation for execute=true." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const runId = typeof p.run_id === "string" ? p.run_id : "";
      const entry = readRegistryEntry(ctx.cwd, runId);
      const plan = buildOneSliceAgentAbortPlan({
        runId,
        entry,
        execute: asOptionalBoolean(p.execute),
        operatorConfirmed: asOptionalBoolean(p.operator_confirmed),
        cwdExpected: ctx.cwd,
      });
      if (plan.processStopAllowed && plan.pid) {
        process.kill(plan.pid, "SIGTERM");
      }
      return buildOperatorVisibleToolResponse({
        label: "one_slice_agent_run_abort",
        summary: plan.summary,
        details: plan,
      });
    },
  });
}
