import path from "node:path";

const SCHEMA_VERSION = 1;

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.map((entry) => asString(entry)).filter(Boolean)
    : [];
}

function normalizeTimeoutMs(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 90_000;
}

function normalizeRunSpec(value = {}) {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const executionPreview = row.executionPreview ?? row.execution_preview ?? {};
  return {
    runId: asString(row.runId ?? row.run_id),
    providerModelRef: asString(row.providerModelRef ?? row.provider_model_ref),
    cwd: asString(row.cwd) || ".",
    declaredFiles: asStringArray(row.declaredFiles ?? row.declared_files),
    logPath: asString(row.logPath ?? row.log_path),
    timeoutMs: normalizeTimeoutMs(row.timeoutMs ?? row.timeout_ms),
    fileContract: asString(row.fileContract ?? row.file_contract) === "mutation" ? "mutation" : "read-only",
    executionPreview: {
      command: asString(executionPreview.command),
      args: asStringArray(executionPreview.args),
    },
  };
}

function normalizeQueueStep(rawStep = {}, index = 0) {
  const step = rawStep && typeof rawStep === "object" && !Array.isArray(rawStep) ? rawStep : {};
  const runSpec = normalizeRunSpec(step.runSpec ?? step.run_spec);
  const stepId = asString(step.stepId ?? step.step_id) || asString(step.workerId ?? step.worker_id) || `step-${index + 1}`;
  return {
    index: index + 1,
    stepId,
    sourceAdapter: asString(step.sourceAdapter ?? step.source_adapter),
    singleRunOnly: step.singleRunOnly !== false,
    dispatchAllowed: false,
    processStartAllowed: false,
    requiresOperatorDecision: true,
    runSpec,
    driverStepCall: step.driverStepCall ?? step.driver_step_call,
  };
}

function validateStep(step) {
  const blockers = [];
  if (!step.stepId) blockers.push("step-id-missing");
  if (!step.singleRunOnly) blockers.push("single-run-only-missing");
  if (step.dispatchAllowed !== false) blockers.push("step-dispatch-must-default-false");
  if (step.processStartAllowed !== false) blockers.push("step-process-start-must-default-false");
  if (!step.runSpec.runId) blockers.push("run-id-missing");
  if (!step.runSpec.providerModelRef) blockers.push("provider-model-ref-missing");
  if (!step.runSpec.cwd) blockers.push("cwd-missing");
  if (step.runSpec.declaredFiles.length === 0) blockers.push("declared-files-missing");
  if (!step.runSpec.logPath) blockers.push("log-path-missing");
  if (!step.runSpec.executionPreview.command) blockers.push("execution-command-missing");
  return blockers;
}

export function buildAgentWorkerStepQueue(options = {}) {
  const queueId = asString(options.queueId ?? options.queue_id) || "agent-worker-step-queue";
  const cwd = path.resolve(asString(options.cwd) || process.cwd());
  const steps = Array.isArray(options.steps) ? options.steps.map(normalizeQueueStep) : [];
  const stepBlockers = steps.flatMap((step) => validateStep(step).map((blocker) => `${step.stepId}:${blocker}`));
  const blockers = [
    ...(steps.length === 0 ? ["worker-steps-missing"] : []),
    ...stepBlockers,
  ];
  const decision = blockers.length === 0 ? "ready-for-operator-decision" : "blocked";

  return {
    mode: "agent-worker-step-queue",
    schemaVersion: SCHEMA_VERSION,
    queueId,
    cwd,
    decision,
    dispatchAllowed: false,
    processStartAllowed: false,
    batchExecutionAllowed: false,
    workerCount: steps.length,
    steps,
    blockers,
    nextActions: decision === "ready-for-operator-decision"
      ? [
          "review each steps[*].driverStepCall before approval",
          "execute at most one step through agent_run_driver_step_dispatch",
          "record parent-side outcome before selecting another step",
        ]
      : ["resolve blockers before preparing worker step dispatch"],
    summary: `agent-worker-step-queue: decision=${decision} workers=${steps.length} dispatch=no`,
  };
}
