import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { evaluateAgentSpawnReadiness } from "./guardrails-core-agent-spawn-readiness";
import { buildAgentRunPlan } from "./guardrails-core-agent-run-plan";
import { buildAgentRunAbortPlan, buildAgentRunOutcomePacket, buildAgentRunRegistryUpsertPacket, buildAgentRunStatus, type AgentRunMarkerResult, type AgentRunRegistryEntry, type AgentRunState } from "./guardrails-core-agent-run-runtime";
import { buildAgentRunStartPacket } from "./guardrails-core-agent-run-start";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function asMarkerResults(value: unknown): AgentRunMarkerResult[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is AgentRunMarkerResult => !!entry && typeof entry === "object").map((entry) => {
    const row = entry as Record<string, unknown>;
    return {
      ...(typeof row.label === "string" ? { label: row.label } : {}),
      ...(typeof row.ok === "boolean" ? { ok: row.ok } : {}),
    };
  });
}

function registryPath(cwd: string): string {
  return path.join(cwd, ".pi", "reports", "agent-runs.json");
}

function readRegistryRows(cwd: string): AgentRunRegistryEntry[] {
  const filePath = registryPath(cwd);
  if (!existsSync(filePath)) return [];
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { runs?: AgentRunRegistryEntry[] } | AgentRunRegistryEntry[];
  return Array.isArray(parsed) ? parsed : Array.isArray(parsed.runs) ? parsed.runs : [];
}

function readRegistryEntry(cwd: string, runId: string): AgentRunRegistryEntry | undefined {
  return readRegistryRows(cwd).find((row) => row?.runId === runId);
}

function writeRegistryEntry(cwd: string, entry: AgentRunRegistryEntry): void {
  const filePath = registryPath(cwd);
  const rows = readRegistryRows(cwd).filter((row) => row?.runId !== entry.runId);
  rows.push(entry);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify({ runs: rows }, null, 2), "utf8");
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
      max_agents_requested: Type.Optional(Type.Number({ description: "Requested number of agents for this spawn attempt (must be 1 for agent-run lane)." })),
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
    name: "agent_run_plan",
    label: "Agent Run Plan",
    description: "Report-only agent run packet with provider/model, declared files, timeout, validation, rollback, budget, abort, and log-tail gates. Never dispatches execution.",
    parameters: Type.Object({
      goal: Type.Optional(Type.String({ description: "Run goal for the future worker." })),
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
      const result = buildAgentRunPlan({
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
        label: "agent_run_plan",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_start_packet",
    label: "Agent Run Start Packet",
    description: "Report-only provider-native agent-run start packet with exact pi subprocess argv preview. Never dispatches execution and always requires explicit human confirmation.",
    parameters: Type.Object({
      run_id: Type.Optional(Type.String({ description: "Agent run id for the future worker." })),
      executor_kind: Type.Optional(Type.String({ description: "Executor kind. Initial supported value: pi-print-subprocess." })),
      goal: Type.Optional(Type.String({ description: "Run goal/prompt for the future worker." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference, e.g. dashscope/qwen3-coder-plus." })),
      cwd: Type.Optional(Type.String({ description: "Explicit worker cwd." })),
      declared_files: Type.Optional(Type.Array(Type.String(), { description: "Exact file scope for the future worker." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Short bounded timeout in milliseconds." })),
      tool_allowlist: Type.Optional(Type.Array(Type.String(), { description: "Read-only tool allowlist for first provider-native canaries." })),
      session_isolation: Type.Optional(Type.String({ description: "Session isolation mode: no-session or run-session-dir." })),
      log_path: Type.Optional(Type.String({ description: "Bounded log path for stdout/stderr metadata." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope is requested." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = buildAgentRunStartPacket({
        runId: typeof p.run_id === "string" ? p.run_id : undefined,
        executorKind: typeof p.executor_kind === "string" ? p.executor_kind : undefined,
        goal: typeof p.goal === "string" ? p.goal : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        cwd: typeof p.cwd === "string" ? p.cwd : ctx?.cwd,
        declaredFiles: asOptionalStringArray(p.declared_files),
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        toolAllowlist: asOptionalStringArray(p.tool_allowlist),
        sessionIsolation: typeof p.session_isolation === "string" ? p.session_isolation : undefined,
        logPath: typeof p.log_path === "string" ? p.log_path : undefined,
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_run_start_packet",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_registry_upsert",
    label: "Agent Run Registry Upsert",
    description: "Dry-first local registry upsert for agent runs under .pi/reports. apply=true writes only registry state; it never starts, stops, or dispatches execution.",
    parameters: Type.Object({
      run_id: Type.String({ description: "Agent run id." }),
      state: Type.Optional(Type.String({ description: "Run state: planned, running, completed, failed, timed-out, aborted, or unknown." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Provider/model reference used by the run." })),
      cwd: Type.Optional(Type.String({ description: "Run cwd. Defaults to current tool cwd." })),
      declared_files: Type.Optional(Type.Array(Type.String(), { description: "Declared file scope for the run." })),
      log_path: Type.Optional(Type.String({ description: "Optional bounded log path." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Optional bounded timeout in milliseconds." })),
      dry_run: Type.Optional(Type.Boolean({ description: "Preview only by default; set false to apply registry upsert." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const runId = typeof p.run_id === "string" ? p.run_id : "";
      const cwd = typeof p.cwd === "string" ? p.cwd : ctx.cwd;
      const entry = readRegistryEntry(ctx.cwd, runId);
      const result = buildAgentRunRegistryUpsertPacket({
        runId,
        existingEntry: entry,
        state: typeof p.state === "string" ? p.state as AgentRunState : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        cwd,
        declaredFiles: asOptionalStringArray(p.declared_files),
        logPath: typeof p.log_path === "string" ? p.log_path : undefined,
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        dryRun: p.dry_run !== false,
      });
      if (result.writeAllowed) writeRegistryEntry(ctx.cwd, result.entry);
      return buildOperatorVisibleToolResponse({
        label: "agent_run_registry_upsert",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_status",
    label: "Agent Run Status",
    description: "Read-only status lookup for a registered agent run. Never starts, stops, or dispatches execution.",
    parameters: Type.Object({
      run_id: Type.String({ description: "Agent run id." }),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const runId = typeof p.run_id === "string" ? p.run_id : "";
      const entry = readRegistryEntry(ctx.cwd, runId);
      const result = buildAgentRunStatus(runId, entry);
      return buildOperatorVisibleToolResponse({
        label: "agent_run_status",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_log_tail",
    label: "Agent Run Log Tail",
    description: "Read-only bounded log tail for a registered agent run. Never starts, stops, or dispatches execution.",
    parameters: Type.Object({
      run_id: Type.String({ description: "Agent run id." }),
      max_lines: Type.Optional(Type.Number({ description: "Maximum tail lines, clamped to 1..500." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const runId = typeof p.run_id === "string" ? p.run_id : "";
      const entry = readRegistryEntry(ctx.cwd, runId);
      const maxLines = typeof p.max_lines === "number" ? p.max_lines : 80;
      const lines = entry?.logPath ? readLogTail(entry.logPath, maxLines) : [];
      const result = {
        mode: "agent-run-log-tail" as const,
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
        summary: `agent-run-log-tail: runId=${runId || "unknown"} found=${entry ? "yes" : "no"} lines=${lines.length} dispatch=no authorization=none`,
      };
      return buildOperatorVisibleToolResponse({
        label: "agent_run_log_tail",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_outcome_packet",
    label: "Agent Run Outcome Packet",
    description: "Report-only outcome packet for agent runs. Separates processState from contractDecision using declared files, touched files, marker results, and rollback cues. Never dispatches execution.",
    parameters: Type.Object({
      run_id: Type.String({ description: "Agent run id." }),
      touched_files: Type.Optional(Type.Array(Type.String(), { description: "Files observed as touched after the run, usually from git status/diff." })),
      marker_results: Type.Optional(Type.Array(Type.Object({
        label: Type.Optional(Type.String({ description: "Marker/check label." })),
        ok: Type.Optional(Type.Boolean({ description: "Whether the marker/check passed." })),
      }), { description: "Optional parent-side validation marker/check results." })),
      output_bytes: Type.Optional(Type.Number({ description: "Worker stdout/output byte count. Zero is a contract failure even when process exit succeeds." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const runId = typeof p.run_id === "string" ? p.run_id : "";
      const entry = readRegistryEntry(ctx.cwd, runId);
      const result = buildAgentRunOutcomePacket({
        runId,
        entry,
        touchedFiles: asOptionalStringArray(p.touched_files),
        markerResults: asMarkerResults(p.marker_results),
        outputBytes: typeof p.output_bytes === "number" ? p.output_bytes : undefined,
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_run_outcome_packet",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_abort",
    label: "Agent Run Abort",
    description: "Dry-first abort plan for a registered agent run. execute=true requires operator_confirmed=true and only targets the registered worker pid.",
    parameters: Type.Object({
      run_id: Type.String({ description: "Agent run id." }),
      execute: Type.Optional(Type.Boolean({ description: "When true, send SIGTERM to the registered worker pid after gates pass." })),
      operator_confirmed: Type.Optional(Type.Boolean({ description: "Explicit human confirmation for execute=true." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const runId = typeof p.run_id === "string" ? p.run_id : "";
      const entry = readRegistryEntry(ctx.cwd, runId);
      const plan = buildAgentRunAbortPlan({
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
        label: "agent_run_abort",
        summary: plan.summary,
        details: plan,
      });
    },
  });
}
