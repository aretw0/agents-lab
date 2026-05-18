import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { buildAgentRunStartupDiagnosticPacket, classifyAgentRunFailure } from "./guardrails-core-agent-run-diagnostics";
import { buildAgentRunAbortPlan, buildAgentRunBatchOutcomePacket, buildAgentRunOutcomePacket, buildAgentRunRegistryUpsertPacket, buildAgentRunStatus, type AgentRunMarkerResult, type AgentRunState } from "./guardrails-core-agent-run-runtime";
import { isTerminalAgentRunState, readLogByteCount, readLogTail, readRegistryEntry, sleepMs, writeRegistryEntry } from "./guardrails-core-agent-run-surface-runtime";
import { resolveExecutionCwdParam } from "./guardrails-core-execution-context";
import { asOptionalBoolean, asOptionalStringArray } from "./guardrails-core-param-normalizers";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

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

export function registerAgentRunLifecycleTools(pi: ExtensionAPI): void {
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
      const cwd = resolveExecutionCwdParam(p.cwd, ctx.cwd);
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
    name: "agent_run_failure_classification",
    label: "Agent Run Failure Classification",
    description: "Read-only classifier for registered agent-run failures. Distinguishes spawn, argv, tool-allowlist, extension-load, provider, model-call, silent-runner, and contract failures before retry decisions. Never dispatches execution.",
    parameters: Type.Object({
      run_id: Type.String({ description: "Agent run id to classify." }),
      log_path: Type.Optional(Type.String({ description: "Optional bounded log path override. Defaults to the registered run log." })),
      touched_files: Type.Optional(Type.Array(Type.String(), { description: "Optional parent-observed touched files for contract-failure classification." })),
      marker_failures: Type.Optional(Type.Array(Type.String(), { description: "Optional failed parent-side markers/check labels." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const runId = typeof p.run_id === "string" ? p.run_id : "";
      const entry = readRegistryEntry(ctx.cwd, runId);
      const rawLogPath = typeof p.log_path === "string" ? p.log_path : entry?.logPath;
      const logPath = rawLogPath ? path.isAbsolute(rawLogPath) ? rawLogPath : path.join(ctx.cwd, rawLogPath) : undefined;
      const logText = logPath && existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
      const result = classifyAgentRunFailure({
        runId,
        entry,
        logText,
        touchedFiles: asOptionalStringArray(p.touched_files),
        markerFailures: asOptionalStringArray(p.marker_failures),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_run_failure_classification",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_startup_diagnostic_packet",
    label: "Agent Run Startup Diagnostic Packet",
    description: "Report-only startup/provider diagnostic packet for agent runs before retry/canary decisions. Never dispatches execution.",
    parameters: Type.Object({
      run_id: Type.String({ description: "Agent run id to diagnose." }),
      log_path: Type.Optional(Type.String({ description: "Optional bounded log path override. Defaults to the registered run log." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Provider/model ref for the intended future canary." })),
      budget_decision: Type.Optional(Type.String({ description: "Provider/model budget decision: ok, warn, blocked, or unknown." })),
      live_reload_completed: Type.Optional(Type.Boolean({ description: "Whether runtime reload was completed after diagnostic tool changes." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope is requested." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const runId = typeof p.run_id === "string" ? p.run_id : "";
      const entry = readRegistryEntry(ctx.cwd, runId);
      const rawLogPath = typeof p.log_path === "string" ? p.log_path : entry?.logPath;
      const logPath = rawLogPath ? path.isAbsolute(rawLogPath) ? rawLogPath : path.join(ctx.cwd, rawLogPath) : undefined;
      const logText = logPath && existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
      const result = buildAgentRunStartupDiagnosticPacket({
        runId,
        entry,
        logText,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        budgetDecision: typeof p.budget_decision === "string" ? p.budget_decision : undefined,
        liveReloadCompleted: asOptionalBoolean(p.live_reload_completed),
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_run_startup_diagnostic_packet",
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
    name: "agent_run_follow",
    label: "Agent Run Follow",
    description: "Read-only bounded follow/finalizer for a registered agent run. Waits only up to a short timeout, returns final status/log/output bytes, and never starts, stops, or dispatches execution.",
    parameters: Type.Object({
      run_id: Type.String({ description: "Agent run id to follow." }),
      max_wait_ms: Type.Optional(Type.Number({ description: "Maximum bounded wait in milliseconds. Clamped to 0..30000; default 5000." })),
      poll_interval_ms: Type.Optional(Type.Number({ description: "Polling interval in milliseconds. Clamped to 100..5000; default 500." })),
      max_lines: Type.Optional(Type.Number({ description: "Maximum log tail lines, clamped to 1..500; default 80." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const runId = typeof p.run_id === "string" ? p.run_id : "";
      const maxWaitMs = Math.max(0, Math.min(30_000, Math.floor(typeof p.max_wait_ms === "number" ? p.max_wait_ms : 5_000)));
      const pollIntervalMs = Math.max(100, Math.min(5_000, Math.floor(typeof p.poll_interval_ms === "number" ? p.poll_interval_ms : 500)));
      const maxLines = Math.max(1, Math.min(500, Math.floor(typeof p.max_lines === "number" ? p.max_lines : 80)));
      const deadline = Date.now() + maxWaitMs;
      let entry = readRegistryEntry(ctx.cwd, runId);
      let status = buildAgentRunStatus(runId, entry);
      while (status.found && !isTerminalAgentRunState(status.state) && !status.stale && Date.now() < deadline) {
        await sleepMs(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
        entry = readRegistryEntry(ctx.cwd, runId);
        status = buildAgentRunStatus(runId, entry);
      }
      const terminal = status.found && isTerminalAgentRunState(status.state);
      const decision = !status.found ? "missing-run" : terminal ? "terminal" : status.stale ? "running-stale" : "timeout";
      const logPath = entry?.logPath;
      const lines = logPath ? readLogTail(logPath, maxLines) : [];
      const outputBytes = readLogByteCount(logPath);
      const result = {
        mode: "agent-run-follow" as const,
        activation: "none" as const,
        authorization: "none" as const,
        dispatchAllowed: false,
        processStartAllowed: false,
        processStopAllowed: false,
        runId,
        decision,
        terminal,
        status,
        outputBytes,
        logPath,
        maxWaitMs,
        pollIntervalMs,
        maxLines,
        lines,
        recommendation: terminal ? "build-outcome-packet" : decision === "timeout" ? "poll-again-or-wait" : "ask-human",
        summary: [
          "agent-run-follow:",
          `decision=${decision}`,
          `runId=${runId || "unknown"}`,
          `state=${status.state}`,
          `terminal=${terminal ? "yes" : "no"}`,
          `outputBytes=${outputBytes}`,
          `lines=${lines.length}`,
          "dispatch=no",
          "authorization=none",
        ].join(" "),
      };
      return buildOperatorVisibleToolResponse({
        label: "agent_run_follow",
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
      file_contract: Type.Optional(Type.String({ description: "Expected file contract: mutation (default) or read-only. Read-only can pass with no file changes when markers/output pass." })),
      mutation_target_files: Type.Optional(Type.Array(Type.String(), { description: "For mutation runs with read-only packet/input attachments, files expected to be mutated. Touched files must be within this set." })),
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
        fileContract: typeof p.file_contract === "string" ? p.file_contract : undefined,
        mutationTargetFiles: asOptionalStringArray(p.mutation_target_files),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_run_outcome_packet",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_batch_outcome_packet",
    label: "Agent Run Batch Outcome Packet",
    description: "Report-only fan-in packet for aggregating SDK read-only batch worker outcomes. Never dispatches execution.",
    parameters: Type.Object({
      batch_id: Type.String({ description: "Batch id being aggregated." }),
      expected_run_ids: Type.Optional(Type.Array(Type.String(), { description: "Run ids expected in the fan-in set." })),
      worker_outcomes: Type.Optional(Type.Array(Type.Object({
        run_id: Type.Optional(Type.String({ description: "Worker run id." })),
        process_state: Type.Optional(Type.String({ description: "Worker process state." })),
        contract_decision: Type.Optional(Type.String({ description: "Worker contract decision: pass, partial, or fail." })),
        touched_files: Type.Optional(Type.Array(Type.String(), { description: "Touched files observed for this worker." })),
        marker_failures: Type.Optional(Type.Array(Type.String(), { description: "Failed parent-side marker labels." })),
        output_bytes: Type.Optional(Type.Number({ description: "Worker output byte count." })),
        cache_status: Type.Optional(Type.String({ description: "Cache evidence status: hit, miss, or unknown." })),
      }), { description: "Per-worker outcome rows from prior outcome packets." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope was involved." })),
      unexpected_dirty: Type.Optional(Type.Boolean({ description: "Blocks when workspace dirty state was unexpected." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const workersRaw = Array.isArray(p.worker_outcomes) ? p.worker_outcomes : [];
      const workerOutcomes = workersRaw.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object").map((worker) => ({
        runId: typeof worker.run_id === "string" ? worker.run_id : undefined,
        processState: typeof worker.process_state === "string" ? worker.process_state : undefined,
        contractDecision: typeof worker.contract_decision === "string" ? worker.contract_decision : undefined,
        touchedFiles: asOptionalStringArray(worker.touched_files),
        markerFailures: asOptionalStringArray(worker.marker_failures),
        outputBytes: typeof worker.output_bytes === "number" ? worker.output_bytes : undefined,
        cacheStatus: typeof worker.cache_status === "string" ? worker.cache_status : undefined,
      }));
      const result = buildAgentRunBatchOutcomePacket({
        batchId: typeof p.batch_id === "string" ? p.batch_id : undefined,
        expectedRunIds: asOptionalStringArray(p.expected_run_ids),
        workerOutcomes,
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
        unexpectedDirty: asOptionalBoolean(p.unexpected_dirty),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_run_batch_outcome_packet",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_abort",
    label: "Agent Run Abort",
    description: "Dry-first abort plan for a registered agent run. execute=true requires structured operator approval and only targets the registered worker pid.",
    parameters: Type.Object({
      run_id: Type.String({ description: "Agent run id." }),
      execute: Type.Optional(Type.Boolean({ description: "When true, send SIGTERM to the registered worker pid after gates pass." })),
      operator_approval: Type.Optional(Type.Object({
        packet_mode: Type.Optional(Type.String({ description: "Must be operator-approval-packet." })),
        approved: Type.Optional(Type.Boolean({ description: "Structured operator approval decision." })),
        approval_state: Type.Optional(Type.String({ description: "Must be approved." })),
      }, { description: "Structured operator approval envelope." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const runId = typeof p.run_id === "string" ? p.run_id : "";
      const entry = readRegistryEntry(ctx.cwd, runId);
      const plan = buildAgentRunAbortPlan({
        runId,
        entry,
        execute: asOptionalBoolean(p.execute),
        operatorApproval: p.operator_approval,
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
