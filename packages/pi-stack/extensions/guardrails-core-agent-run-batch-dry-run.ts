import {
  formatAuthorizationEvidence,
  GUARDRAILS_AUTHORIZATION_NONE,
  type GuardrailsAuthorizationNone,
} from "./guardrails-core-authorization";
import { buildAgentRunStartPacket, type AgentRunStartPacketResult } from "./guardrails-core-agent-run-start";
import { MUTATION_TOOL_ALLOWLIST, READ_ONLY_TOOL_ALLOWLIST, sanitizeRunIdPart } from "./guardrails-core-agent-run-start-helpers";

export type AgentRunBatchDryRunAuthorization = "explicit-local-batch" | "generic" | "none" | "unknown";
export type AgentRunBatchDryRunDecision = "ready-for-operator-decision" | "blocked";
export type AgentRunBatchDryRunFileContract = "read-only" | "mutation";

export interface AgentRunBatchDryRunWorkerInput {
  taskId?: string;
  runId?: string;
  goal?: string;
  providerModelRef?: string;
  cwd?: string;
  declaredFiles?: string[];
  timeoutMs?: number;
  fileContract?: AgentRunBatchDryRunFileContract | string;
  budgetDecision?: string;
  budgetEvidence?: string;
  protectedScopeRequested?: boolean;
}

export interface AgentRunBatchDryRunPacketInput {
  batchId?: string;
  authorization?: AgentRunBatchDryRunAuthorization | string;
  workers?: AgentRunBatchDryRunWorkerInput[];
  requestedRunId?: string;
  localSafeScope?: boolean;
  validationGateKnown?: boolean;
  rollbackPlanKnown?: boolean;
  stopConditionsClear?: boolean;
  concurrentWorkerLimit?: number;
  protectedScopeRequested?: boolean;
  schedulerRequested?: boolean;
  repeatRequested?: boolean;
  remoteOrOffloadRequested?: boolean;
  githubActionsRequested?: boolean;
}

export interface AgentRunBatchDryRunWorkerPlan {
  index: number;
  taskId: string;
  runId: string;
  fileContract: AgentRunBatchDryRunFileContract;
  lowerGateDecision: AgentRunStartPacketResult["decision"];
  lowerGateBlockers: string[];
  startPacket: AgentRunStartPacketResult;
}

export interface AgentRunBatchDryRunPacket {
  mode: "agent-run-batch-dry-run";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  processStartAllowed: false;
  workerDispatchAllowed: false;
  batchExecutionAllowed: false;
  requiresOperatorDecision: true;
  maxConcurrentWorkers: 1;
  decision: AgentRunBatchDryRunDecision;
  batchId: string;
  requestedRunId: string;
  plannedRunIds: string[];
  workerPlans: AgentRunBatchDryRunWorkerPlan[];
  blockers: string[];
  blockedRequests: string[];
  lowerGateRequired: string[];
  summary: string;
  recommendation: string;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = normalizeText(item);
    if (text) out.push(text);
  }
  return Array.from(new Set(out));
}

function normalizeAuthorization(value: unknown): AgentRunBatchDryRunAuthorization {
  return value === "explicit-local-batch" || value === "generic" || value === "none" ? value : "unknown";
}

function normalizeFileContract(value: unknown): AgentRunBatchDryRunFileContract {
  return value === "mutation" ? "mutation" : "read-only";
}

function deriveRunId(batchId: string, worker: AgentRunBatchDryRunWorkerInput, index: number): string {
  const explicit = normalizeText(worker.runId);
  if (explicit) return sanitizeRunIdPart(explicit);
  const taskId = normalizeText(worker.taskId);
  const suffix = taskId || `worker-${index + 1}`;
  return sanitizeRunIdPart(`${batchId}-${suffix}`);
}

export function buildAgentRunBatchDryRunPacket(input: AgentRunBatchDryRunPacketInput = {}): AgentRunBatchDryRunPacket {
  const batchId = sanitizeRunIdPart(normalizeText(input.batchId));
  const authorization = normalizeAuthorization(input.authorization);
  const workers = (input.workers ?? []).slice(0, 5);
  const requestedRunId = sanitizeRunIdPart(normalizeText(input.requestedRunId));
  const concurrentWorkerLimit = Number.isFinite(input.concurrentWorkerLimit) ? Number(input.concurrentWorkerLimit) : 1;
  const blockers: string[] = [];
  const blockedRequests: string[] = [];

  if (!batchId) blockers.push("batch-id-missing");
  if (authorization !== "explicit-local-batch") blockers.push(authorization === "generic" ? "authorization-generic" : "authorization-missing");
  if (workers.length === 0) blockers.push("workers-missing");
  if (input.localSafeScope !== true) blockers.push("local-safe-scope-missing");
  if (input.validationGateKnown !== true) blockers.push("validation-gate-missing");
  if (input.rollbackPlanKnown !== true) blockers.push("rollback-plan-missing");
  if (input.stopConditionsClear !== true) blockers.push("stop-conditions-not-clear");
  if (concurrentWorkerLimit !== 1) {
    blockers.push("multi-worker-concurrency-requested");
    blockedRequests.push("multi-worker");
  }
  if (input.protectedScopeRequested) {
    blockers.push("protected-scope-requested");
    blockedRequests.push("protected-scope");
  }
  if (input.schedulerRequested) {
    blockers.push("scheduler-requested");
    blockedRequests.push("scheduler");
  }
  if (input.repeatRequested) {
    blockers.push("repeat-requested");
    blockedRequests.push("repeat");
  }
  if (input.remoteOrOffloadRequested) {
    blockers.push("remote-or-offload-requested");
    blockedRequests.push("remote-or-offload");
  }
  if (input.githubActionsRequested) {
    blockers.push("github-actions-requested");
    blockedRequests.push("github-actions");
  }

  const seenRunIds = new Set<string>();
  const workerPlans = workers.map((worker, index): AgentRunBatchDryRunWorkerPlan => {
    const runId = deriveRunId(batchId || "batch", worker, index);
    if (seenRunIds.has(runId)) blockers.push(`duplicate-run-id:${runId}`);
    seenRunIds.add(runId);
    const fileContract = normalizeFileContract(worker.fileContract);
    const taskId = normalizeText(worker.taskId) || `worker-${index + 1}`;
    const startPacket = buildAgentRunStartPacket({
      runId,
      goal: worker.goal,
      providerModelRef: worker.providerModelRef,
      cwd: worker.cwd,
      declaredFiles: normalizeStringArray(worker.declaredFiles),
      timeoutMs: worker.timeoutMs,
      toolAllowlist: fileContract === "mutation" ? MUTATION_TOOL_ALLOWLIST : READ_ONLY_TOOL_ALLOWLIST,
      logPath: `.pi/reports/${runId || "unknown"}.log`,
      budgetDecision: worker.budgetDecision,
      budgetEvidence: worker.budgetEvidence,
      protectedScopeRequested: worker.protectedScopeRequested,
    });
    if (startPacket.decision !== "ready-for-operator-decision") {
      blockers.push(`worker-start-packet-blocked:${runId}`);
    }
    return {
      index: index + 1,
      taskId,
      runId,
      fileContract,
      lowerGateDecision: startPacket.decision,
      lowerGateBlockers: startPacket.blockers,
      startPacket,
    };
  });

  const plannedRunIds = workerPlans.map((worker) => worker.runId);
  if (requestedRunId && !plannedRunIds.includes(requestedRunId)) {
    blockers.push(`run-id-outside-batch:${requestedRunId}`);
  }

  const decision: AgentRunBatchDryRunDecision = blockers.length === 0 ? "ready-for-operator-decision" : "blocked";
  const lowerGateRequired = [
    "agent_run_start_packet per planned worker",
    "agent_run_registry_upsert dry-run before any write",
    "agent_run_outcome_packet after each worker",
    "agent_run_batch_outcome_packet before promotion",
  ];
  const summary = [
    "agent-run-batch-dry-run:",
    `decision=${decision}`,
    `batchId=${batchId || "unknown"}`,
    `workers=${workerPlans.length}`,
    `requestedRunId=${requestedRunId || "none"}`,
    "concurrency=1",
    "dispatch=no",
    "processStart=no",
    blockers.length > 0 ? `blockers=${blockers.slice(0, 5).join("|")}` : undefined,
    formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE),
  ].filter(Boolean).join(" ");

  return {
    mode: "agent-run-batch-dry-run",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    processStartAllowed: false,
    workerDispatchAllowed: false,
    batchExecutionAllowed: false,
    requiresOperatorDecision: true,
    maxConcurrentWorkers: 1,
    decision,
    batchId,
    requestedRunId,
    plannedRunIds,
    workerPlans,
    blockers,
    blockedRequests,
    lowerGateRequired,
    summary,
    recommendation: decision === "ready-for-operator-decision"
      ? "Present this dry-run batch to the operator; start no worker until the selected runId passes its lower start gate."
      : "Do not consume batch authorization; resolve blockers and regenerate the dry-run packet.",
  };
}
