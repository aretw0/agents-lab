import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { buildAgentRunSdkReadOnlyBatchPacket, type AgentRunSdkReadOnlyBatchPacketInput } from "./guardrails-core-agent-run-sdk-preview";
import { readRegistryEntry, startSdkInProcessWorker } from "./guardrails-core-agent-run-surface-runtime";
import { resolveExecutionCwdParam, sameCwd } from "./guardrails-core-execution-context";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
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
    name: "agent_run_sdk_readonly_batch_packet",
    label: "Agent Run SDK Read-Only Batch Packet",
    description: "Report-only batch packet for future parallel SDK read-only fan-out/fan-in. Never dispatches workers and always requires a separate human decision.",
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
    description: "First-party read-only SDK batch gate. Preview by default; execute=true requires exact batch confirmation and starts only ready read-only workers through the shared control-plane registry/log runtime.",
    parameters: sdkReadOnlyBatchParameters({
      execute: Type.Optional(Type.Boolean({ description: "When true, start all ready read-only workers after exact batch confirmation." })),
      operator_confirmation: Type.Optional(Type.String({ description: "Must exactly equal the packet humanConfirmationPhrase for execute=true." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const packet = buildAgentRunSdkReadOnlyBatchPacket(parseSdkReadOnlyBatchPacketInput(p, ctx.cwd));
      const executeRequested = p.execute === true;
      const operatorConfirmation = typeof p.operator_confirmation === "string" ? p.operator_confirmation : "";
      const blockers = [...packet.blockers];
      if (packet.decision !== "ready-for-human-decision") blockers.push("batch-packet-blocked");
      if (executeRequested && operatorConfirmation !== packet.humanConfirmationPhrase) blockers.push("operator-confirmation-mismatch");
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
        authorization: parallelDispatchAllowed ? "explicit-human" as const : "none" as const,
        dispatchAllowed: parallelDispatchAllowed,
        parallelDispatchAllowed,
        processStartAllowed: parallelDispatchAllowed,
        processStopAllowed: false,
        requiresHumanDecision: true,
        decision,
        blockers,
        executeRequested,
        batchId: packet.batchSpec.batchId,
        workerRunIds: packet.workers.map((worker) => worker.runSpec.runId),
        startedWorkers,
        packet,
        humanConfirmationPhrase: packet.humanConfirmationPhrase,
        fanInNextAction: "after workers finish, call agent_run_outcome_packet per worker and agent_run_batch_outcome_packet for aggregate fan-in",
        summary: [
          "agent-run-sdk-readonly-batch-dispatch:",
          `decision=${decision}`,
          `batchId=${packet.batchSpec.batchId || "unknown"}`,
          `workers=${packet.workers.length}`,
          `execute=${executeRequested ? "yes" : "no"}`,
          `parallelDispatch=${parallelDispatchAllowed ? "yes" : "no"}`,
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
}
