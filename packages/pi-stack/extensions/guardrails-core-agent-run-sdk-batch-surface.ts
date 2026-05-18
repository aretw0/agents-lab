import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { buildAgentRunSdkReadOnlyBatchPacket, buildAgentRunSdkReadOnlyBatchTaskPacket, type AgentRunSdkReadOnlyBatchPacketInput } from "./guardrails-core-agent-run-sdk-preview";
import { buildAgentRunAbortPlan, buildAgentRunBatchOutcomePacket, buildAgentRunOutcomePacket, buildAgentRunStatus } from "./guardrails-core-agent-run-runtime";
import { readLogByteCount, readLogTail, readRegistryEntry, startSdkInProcessWorker } from "./guardrails-core-agent-run-surface-runtime";
import { evaluateAgentWorkerLaneReadiness } from "./guardrails-core-agent-worker-lane";
import { resolveExecutionCwdParam, sameCwd } from "./guardrails-core-execution-context";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function hasStructuredOperatorApproval(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.packet_mode === "operator-approval-packet"
    && row.approved === true
    && row.approval_state === "approved";
}

function sdkReadOnlyBatchWorkerSchema() {
  return Type.Object({
    run_id: Type.Optional(Type.String({ description: "SDK worker run id." })),
    goal: Type.Optional(Type.String({ description: "Run goal/prompt for the SDK worker." })),
    provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference." })),
    cwd: Type.Optional(Type.String({ description: "Worker cwd. For execute=true must match current cwd." })),
    declared_files: Type.Optional(Type.Array(Type.String(), { description: "Exact declared file scope for parent validation." })),
    timeout_ms: Type.Optional(Type.Number({ description: "Bounded timeout in milliseconds." })),
    tool_allowlist: Type.Optional(Type.Array(Type.String(), { description: "SDK tool allowlist." })),
    session_mode: Type.Optional(Type.String({ description: "SDK session mode." })),
    validation_gate_known: Type.Optional(Type.Boolean({ description: "Whether parent-side validation is known." })),
    rollback_plan_known: Type.Optional(Type.Boolean({ description: "Whether rollback is known." })),
    budget_decision: Type.Optional(Type.String({ description: "Provider/model budget decision." })),
    budget_evidence: Type.Optional(Type.String({ description: "Scoped provider/model budget evidence." })),
    budget_evidence_source: Type.Optional(Type.String({ description: "Budget evidence source." })),
    budget_evidence_provider: Type.Optional(Type.String({ description: "Provider named by evidence." })),
    budget_evidence_generated_at_iso: Type.Optional(Type.String({ description: "ISO timestamp for budget evidence freshness." })),
    budget_evidence_max_age_ms: Type.Optional(Type.Number({ description: "Optional max age for budget evidence freshness." })),
    abort_known: Type.Optional(Type.Boolean({ description: "Whether safe SDK abort is known." })),
    event_stream_known: Type.Optional(Type.Boolean({ description: "Whether SDK event stream capture is known." })),
    final_output_contract_known: Type.Optional(Type.Boolean({ description: "Whether final output contract is known." })),
  });
}

function parseSdkReadOnlyBatchPacketInput(params: Record<string, unknown>, cwd: string): AgentRunSdkReadOnlyBatchPacketInput {
  const workersRaw = Array.isArray(params.workers) ? params.workers : [];
  const workers = workersRaw.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object").map((worker) => ({
    runId: typeof worker.run_id === "string" ? worker.run_id : undefined,
    goal: typeof worker.goal === "string" ? worker.goal : undefined,
    providerModelRef: typeof worker.provider_model_ref === "string" ? worker.provider_model_ref : undefined,
    cwd: resolveExecutionCwdParam(worker.cwd, cwd),
    declaredFiles: asOptionalStringArray(worker.declared_files),
    timeoutMs: typeof worker.timeout_ms === "number" ? worker.timeout_ms : undefined,
    toolAllowlist: asOptionalStringArray(worker.tool_allowlist),
    sessionMode: typeof worker.session_mode === "string" ? worker.session_mode : undefined,
    fileContract: "read-only",
    validationGateKnown: asOptionalBoolean(worker.validation_gate_known),
    rollbackPlanKnown: asOptionalBoolean(worker.rollback_plan_known),
    budgetDecision: typeof worker.budget_decision === "string" ? worker.budget_decision : undefined,
    budgetEvidence: typeof worker.budget_evidence === "string" ? worker.budget_evidence : undefined,
    budgetEvidenceSource: typeof worker.budget_evidence_source === "string" ? worker.budget_evidence_source : undefined,
    budgetEvidenceProvider: typeof worker.budget_evidence_provider === "string" ? worker.budget_evidence_provider : undefined,
    budgetEvidenceGeneratedAtIso: typeof worker.budget_evidence_generated_at_iso === "string" ? worker.budget_evidence_generated_at_iso : undefined,
    budgetEvidenceMaxAgeMs: typeof worker.budget_evidence_max_age_ms === "number" ? worker.budget_evidence_max_age_ms : undefined,
    abortKnown: asOptionalBoolean(worker.abort_known),
    eventStreamKnown: asOptionalBoolean(worker.event_stream_known),
    finalOutputContractKnown: asOptionalBoolean(worker.final_output_contract_known),
  }));
  return {
    batchId: typeof params.batch_id === "string" ? params.batch_id : undefined,
    sharedEvidence: asOptionalStringArray(params.shared_evidence),
    maxWorkers: typeof params.max_workers === "number" ? params.max_workers : undefined,
    workers,
    protectedScopeRequested: asOptionalBoolean(params.protected_scope_requested),
    unexpectedDirty: asOptionalBoolean(params.unexpected_dirty),
  };
}

function sdkReadOnlyBatchParameters(extra: Record<string, unknown> = {}) {
  return Type.Object({
    batch_id: Type.Optional(Type.String({ description: "Read-only batch id." })),
    shared_evidence: Type.Optional(Type.Array(Type.String(), { description: "Bounded shared evidence/cache pack identifiers or summaries." })),
    max_workers: Type.Optional(Type.Number({ description: "Maximum workers allowed in this batch, clamped to 2..5." })),
    workers: Type.Optional(Type.Array(sdkReadOnlyBatchWorkerSchema(), { description: "Independent read-only SDK workers." })),
    protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope is requested." })),
    unexpected_dirty: Type.Optional(Type.Boolean({ description: "Blocks when workspace dirty state is unexpected." })),
    ...extra,
  });
}

export function registerAgentRunSdkReadOnlyBatchTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "agent_run_sdk_readonly_batch_task_packet",
    label: "Agent Run SDK Read-Only Batch Task Packet",
    description: "Report-only board-task packetizer that derives a narrow read-only SDK batch from one .project task. Never dispatches workers; protected scopes block unless explicitly opted in.",
    parameters: Type.Object({
      task_id: Type.String({ description: "Board task id to derive a read-only batch packet from." }),
      provider_model_ref: Type.Optional(Type.String({ description: "Provider/model ref for derived workers. Defaults to Codex Spark pilot model." })),
      max_workers: Type.Optional(Type.Number({ description: "Maximum derived workers, clamped to 2..5." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Per-worker bounded timeout in milliseconds." })),
      budget_decision: Type.Optional(Type.String({ description: "Provider/model budget decision for the derived worker specs." })),
      budget_evidence: Type.Optional(Type.String({ description: "Scoped budget evidence for the derived worker specs." })),
      budget_evidence_source: Type.Optional(Type.String({ description: "Budget evidence source." })),
      budget_evidence_provider: Type.Optional(Type.String({ description: "Provider named by budget evidence." })),
      include_protected_scopes: Type.Optional(Type.Boolean({ description: "Opt in to protected task file scopes. Default false blocks .github/settings/.obsidian scopes." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope is requested." })),
      unexpected_dirty: Type.Optional(Type.Boolean({ description: "Blocks when workspace dirty state is unexpected." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const taskId = typeof p.task_id === "string" ? p.task_id : "";
      const { readTasksBlockCached } = await import("./project-board-model");
      const task = readTasksBlockCached(ctx.cwd).block.tasks.find((row) => row.id === taskId);
      const result = buildAgentRunSdkReadOnlyBatchTaskPacket({
        taskId,
        task,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        cwd: ctx.cwd,
        maxWorkers: typeof p.max_workers === "number" ? p.max_workers : undefined,
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        budgetDecision: typeof p.budget_decision === "string" ? p.budget_decision : undefined,
        budgetEvidence: typeof p.budget_evidence === "string" ? p.budget_evidence : undefined,
        budgetEvidenceSource: typeof p.budget_evidence_source === "string" ? p.budget_evidence_source : undefined,
        budgetEvidenceProvider: typeof p.budget_evidence_provider === "string" ? p.budget_evidence_provider : undefined,
        includeProtectedScopes: asOptionalBoolean(p.include_protected_scopes),
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
        unexpectedDirty: asOptionalBoolean(p.unexpected_dirty),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_run_sdk_readonly_batch_task_packet",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_sdk_readonly_batch_packet",
    label: "Agent Run SDK Read-Only Batch Packet",
    description: "Report-only batch packet for future parallel SDK read-only fan-out/fan-in. Never dispatches workers and always requires a separate operator decision.",
    parameters: sdkReadOnlyBatchParameters(),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = buildAgentRunSdkReadOnlyBatchPacket(parseSdkReadOnlyBatchPacketInput(p, ctx.cwd));
      return buildOperatorVisibleToolResponse({
        label: "agent_run_sdk_readonly_batch_packet",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_sdk_readonly_batch_dispatch",
    label: "Agent Run SDK Read-Only Batch Dispatch",
    description: "First-party read-only SDK batch gate. Preview by default; execute=true requires structured operator approval and starts only ready read-only workers through the shared control-plane registry/log runtime.",
    parameters: sdkReadOnlyBatchParameters({
      execute: Type.Optional(Type.Boolean({ description: "When true, start all ready read-only workers after structured operator approval." })),
      operator_approval: Type.Optional(Type.Object({
        packet_mode: Type.Optional(Type.String({ description: "Must be operator-approval-packet." })),
        approved: Type.Optional(Type.Boolean({ description: "Structured operator approval decision." })),
        approval_state: Type.Optional(Type.String({ description: "Must be approved." })),
      }, { description: "Structured operator approval envelope." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const packet = buildAgentRunSdkReadOnlyBatchPacket(parseSdkReadOnlyBatchPacketInput(p, ctx.cwd));
      const executeRequested = p.execute === true;
      const structuredOperatorApproval = hasStructuredOperatorApproval(p.operator_approval);
      const workerLaneReadiness = evaluateAgentWorkerLaneReadiness(ctx.cwd);
      const blockers = [...packet.blockers];
      if (packet.decision !== "ready-for-human-decision") blockers.push("batch-packet-blocked");
      if (executeRequested && !workerLaneReadiness.multiWorkerRehearsalCandidate) blockers.push("worker-lane-multi-worker-not-ready");
      if (executeRequested && !structuredOperatorApproval) blockers.push("structured-operator-approval-missing");
      for (const worker of packet.workers) {
        if (executeRequested && !sameCwd(worker.runSpec.cwd, ctx.cwd)) blockers.push(`worker-cwd-mismatch:${worker.runSpec.runId || "missing"}`);
        const existingEntry = worker.runSpec.runId ? readRegistryEntry(ctx.cwd, worker.runSpec.runId) : undefined;
        if (existingEntry?.state === "running") blockers.push(`worker-already-running:${worker.runSpec.runId || "missing"}`);
      }
      const parallelDispatchAllowed = executeRequested && blockers.length === 0;
      const startedWorkers = parallelDispatchAllowed
        ? packet.workers.map((worker) => ({ runId: worker.runSpec.runId, ...startSdkInProcessWorker(ctx.cwd, worker) }))
        : [];
      const decision = parallelDispatchAllowed ? "dispatched" : blockers.length > 0 ? "blocked" : "preview";
      const result = {
        mode: "agent-run-sdk-readonly-batch-dispatch" as const,
        activation: "none" as const,
        authorization: parallelDispatchAllowed ? "explicit-operator" as const : "none" as const,
        dispatchAllowed: parallelDispatchAllowed,
        parallelDispatchAllowed,
        processStartAllowed: parallelDispatchAllowed,
        processStopAllowed: false,
        requiresHumanDecision: true,
        decision,
        blockers,
        executeRequested,
        structuredOperatorApproval,
        batchId: packet.batchSpec.batchId,
        workerRunIds: packet.workers.map((worker) => worker.runSpec.runId),
        startedWorkers,
        packet,
        workerLaneReadiness,
        fanInNextAction: "after workers finish, call agent_run_outcome_packet per worker and agent_run_batch_outcome_packet for aggregate fan-in",
        summary: [
          "agent-run-sdk-readonly-batch-dispatch:",
          `decision=${decision}`,
          `batchId=${packet.batchSpec.batchId || "unknown"}`,
          `workers=${packet.workers.length}`,
          `execute=${executeRequested ? "yes" : "no"}`,
          `parallelDispatch=${parallelDispatchAllowed ? "yes" : "no"}`,
          `workerLane=${workerLaneReadiness.stage}`,
          startedWorkers.length > 0 ? `started=${startedWorkers.length}` : undefined,
          blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
        ].filter(Boolean).join(" "),
      };
      return buildOperatorVisibleToolResponse({
        label: "agent_run_sdk_readonly_batch_dispatch",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_sdk_readonly_batch_status",
    label: "Agent Run SDK Read-Only Batch Status",
    description: "Read-only aggregate status/log-tail view for SDK read-only batch workers. Reuses the shared agent-run registry and per-worker logs; never starts or stops workers.",
    parameters: Type.Object({
      batch_id: Type.Optional(Type.String({ description: "Batch id for display only." })),
      run_ids: Type.Optional(Type.Array(Type.String(), { description: "Worker run ids to aggregate." })),
      max_lines: Type.Optional(Type.Number({ description: "Maximum log tail lines per worker, clamped to 0..80." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const batchId = typeof p.batch_id === "string" ? p.batch_id : "";
      const runIds = Array.isArray(p.run_ids) ? p.run_ids.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
      const maxLinesInput = typeof p.max_lines === "number" && Number.isFinite(p.max_lines) ? Math.trunc(p.max_lines) : 20;
      const maxLines = Math.max(0, Math.min(80, maxLinesInput));
      const blockers = runIds.length === 0 ? ["run-ids-missing"] : [];
      const rows = runIds.map((runId) => {
        const entry = readRegistryEntry(ctx.cwd, runId);
        const status = buildAgentRunStatus(runId, entry);
        const logTail = entry?.logPath && maxLines > 0 ? readLogTail(entry.logPath, maxLines) : [];
        return {
          runId,
          status,
          logPath: entry?.logPath,
          logTail,
        };
      });
      const terminalStates = new Set(["completed", "failed", "timed-out", "aborted"]);
      const runningCount = rows.filter((row) => row.status.state === "running").length;
      const terminalCount = rows.filter((row) => terminalStates.has(row.status.state)).length;
      const missingCount = rows.filter((row) => !row.status.found).length;
      const staleCount = rows.filter((row) => row.status.stale).length;
      const decision = blockers.length > 0 ? "blocked" : "ready";
      const result = {
        mode: "agent-run-sdk-readonly-batch-status" as const,
        activation: "none" as const,
        authorization: "none" as const,
        dispatchAllowed: false,
        processStartAllowed: false,
        processStopAllowed: false,
        decision,
        blockers,
        batchId,
        runCount: runIds.length,
        runningCount,
        terminalCount,
        missingCount,
        staleCount,
        rows,
        fanInReady: runIds.length > 0 && missingCount === 0 && terminalCount === runIds.length,
        summary: [
          "agent-run-sdk-readonly-batch-status:",
          `decision=${decision}`,
          batchId ? `batchId=${batchId}` : undefined,
          `runs=${runIds.length}`,
          `running=${runningCount}`,
          `terminal=${terminalCount}`,
          missingCount > 0 ? `missing=${missingCount}` : undefined,
          staleCount > 0 ? `stale=${staleCount}` : undefined,
          `fanInReady=${runIds.length > 0 && missingCount === 0 && terminalCount === runIds.length ? "yes" : "no"}`,
          "dispatch=no",
          "authorization=none",
          blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
        ].filter(Boolean).join(" "),
      };
      return buildOperatorVisibleToolResponse({
        label: "agent_run_sdk_readonly_batch_status",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_sdk_readonly_batch_abort",
    label: "Agent Run SDK Read-Only Batch Abort",
    description: "Dry-first abort plan for read-only SDK batch workers. execute=true requires structured operator approval and only targets registered worker pids through the shared abort plan.",
    parameters: Type.Object({
      batch_id: Type.Optional(Type.String({ description: "Batch id for display only." })),
      run_ids: Type.Optional(Type.Array(Type.String(), { description: "Worker run ids to abort." })),
      execute: Type.Optional(Type.Boolean({ description: "When true, send SIGTERM only to registered worker pids after all gates pass." })),
      operator_approval: Type.Optional(Type.Object({
        packet_mode: Type.Optional(Type.String({ description: "Must be operator-approval-packet." })),
        approved: Type.Optional(Type.Boolean({ description: "Structured operator approval decision." })),
        approval_state: Type.Optional(Type.String({ description: "Must be approved." })),
      }, { description: "Structured operator approval envelope." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const batchId = typeof p.batch_id === "string" ? p.batch_id : "";
      const runIds = Array.isArray(p.run_ids) ? p.run_ids.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
      const executeRequested = p.execute === true;
      const structuredOperatorApproval = hasStructuredOperatorApproval(p.operator_approval);
      const blockers = runIds.length === 0 ? ["run-ids-missing"] : [];
      const plans = runIds.map((runId) => {
        const entry = readRegistryEntry(ctx.cwd, runId);
        return buildAgentRunAbortPlan({
          runId,
          entry,
          execute: executeRequested,
          operatorApproval: p.operator_approval,
          cwdExpected: ctx.cwd,
        });
      });
      for (const plan of plans) {
        if (plan.decision === "blocked") blockers.push(...plan.blockers.map((blocker) => `${plan.runId || "unknown"}:${blocker}`));
      }
      const stopAllowed = executeRequested && blockers.length === 0 && plans.length > 0 && plans.every((plan) => plan.processStopAllowed && !!plan.pid);
      const stoppedPids: number[] = [];
      if (stopAllowed) {
        for (const plan of plans) {
          if (plan.pid) {
            process.kill(plan.pid, "SIGTERM");
            stoppedPids.push(plan.pid);
          }
        }
      }
      const decision = blockers.length > 0 ? "blocked" : stopAllowed ? "abort-ready" : "dry-run";
      const result = {
        mode: "agent-run-sdk-readonly-batch-abort" as const,
        activation: "none" as const,
        authorization: stopAllowed ? "explicit-operator" as const : "none" as const,
        dispatchAllowed: false,
        processStartAllowed: false,
        processStopAllowed: stopAllowed,
        decision,
        blockers,
        batchId,
        runIds,
        executeRequested,
        structuredOperatorApproval,
        plans,
        stoppedPids,
        summary: [
          "agent-run-sdk-readonly-batch-abort:",
          `decision=${decision}`,
          batchId ? `batchId=${batchId}` : undefined,
          `runs=${runIds.length}`,
          `execute=${executeRequested ? "yes" : "no"}`,
          `processStopAllowed=${stopAllowed ? "yes" : "no"}`,
          stoppedPids.length > 0 ? `stopped=${stoppedPids.length}` : undefined,
          blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
          "dispatch=no",
          `authorization=${stopAllowed ? "explicit-operator" : "none"}`,
        ].filter(Boolean).join(" "),
      };
      return buildOperatorVisibleToolResponse({
        label: "agent_run_sdk_readonly_batch_abort",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_sdk_readonly_batch_fan_in_packet",
    label: "Agent Run SDK Read-Only Batch Fan-In Packet",
    description: "Report-only fan-in packet that derives per-worker outcomes from the shared registry/log runtime and aggregates them with the existing batch outcome contract. Never dispatches workers.",
    parameters: Type.Object({
      batch_id: Type.String({ description: "Batch id being aggregated." }),
      expected_run_ids: Type.Optional(Type.Array(Type.String(), { description: "Run ids expected in the fan-in set." })),
      cache_status_by_run: Type.Optional(Type.Array(Type.Object({
        run_id: Type.Optional(Type.String({ description: "Worker run id." })),
        cache_status: Type.Optional(Type.String({ description: "Cache status: hit, miss, or unknown." })),
      }), { description: "Explicit cache evidence status per worker." })),
      touched_files_by_run: Type.Optional(Type.Array(Type.Object({
        run_id: Type.Optional(Type.String({ description: "Worker run id." })),
        touched_files: Type.Optional(Type.Array(Type.String(), { description: "Files touched by this worker. Read-only batches expect none." })),
      }), { description: "Optional observed touched files per worker." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope was involved." })),
      unexpected_dirty: Type.Optional(Type.Boolean({ description: "Blocks when workspace dirty state was unexpected." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const expectedRunIds = asOptionalStringArray(p.expected_run_ids) ?? [];
      const cacheRows = Array.isArray(p.cache_status_by_run) ? p.cache_status_by_run.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object") : [];
      const touchedRows = Array.isArray(p.touched_files_by_run) ? p.touched_files_by_run.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object") : [];
      const cacheStatusByRun = new Map(cacheRows.map((row) => [typeof row.run_id === "string" ? row.run_id : "", typeof row.cache_status === "string" ? row.cache_status : "unknown"]));
      const touchedFilesByRun = new Map(touchedRows.map((row) => [typeof row.run_id === "string" ? row.run_id : "", asOptionalStringArray(row.touched_files) ?? []]));
      const workerOutcomes = expectedRunIds.map((runId) => {
        const entry = readRegistryEntry(ctx.cwd, runId);
        const logOutputBytes = readLogByteCount(entry?.logPath);
        const outputBytes = typeof entry?.outputBytes === "number" ? entry.outputBytes : logOutputBytes;
        const outcome = buildAgentRunOutcomePacket({
          runId,
          entry,
          touchedFiles: touchedFilesByRun.get(runId) ?? [],
          outputBytes,
          fileContract: "read-only",
        });
        return {
          runId,
          processState: outcome.processState,
          contractDecision: outcome.contractDecision,
          touchedFiles: outcome.touchedFiles,
          markerFailures: outcome.markerFailures,
          outputBytes: outcome.outputBytes,
          cacheStatus: cacheStatusByRun.get(runId) ?? "unknown",
          outcome,
        };
      });
      const aggregate = buildAgentRunBatchOutcomePacket({
        batchId: typeof p.batch_id === "string" ? p.batch_id : undefined,
        expectedRunIds,
        workerOutcomes: workerOutcomes.map((worker) => ({
          runId: worker.runId,
          processState: worker.processState,
          contractDecision: worker.contractDecision,
          touchedFiles: worker.touchedFiles,
          markerFailures: worker.markerFailures,
          outputBytes: worker.outputBytes,
          cacheStatus: worker.cacheStatus,
        })),
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
        unexpectedDirty: asOptionalBoolean(p.unexpected_dirty),
      });
      const result = {
        mode: "agent-run-sdk-readonly-batch-fan-in-packet" as const,
        activation: "none" as const,
        authorization: "none" as const,
        dispatchAllowed: false,
        processStartAllowed: false,
        processStopAllowed: false,
        batchId: typeof p.batch_id === "string" ? p.batch_id : "",
        expectedRunIds,
        workerOutcomes,
        aggregate,
        decision: aggregate.decision,
        recommendation: aggregate.recommendation,
        blockers: aggregate.blockers,
        summary: [
          "agent-run-sdk-readonly-batch-fan-in:",
          `decision=${aggregate.decision}`,
          `recommendation=${aggregate.recommendation}`,
          `batchId=${typeof p.batch_id === "string" ? p.batch_id : "unknown"}`,
          `workers=${workerOutcomes.length}`,
          aggregate.blockers.length > 0 ? `blockers=${aggregate.blockers.join("|")}` : undefined,
          "dispatch=no",
          "authorization=none",
        ].filter(Boolean).join(" "),
      };
      return buildOperatorVisibleToolResponse({
        label: "agent_run_sdk_readonly_batch_fan_in_packet",
        summary: result.summary,
        details: result,
      });
    },
  });
}
