import { GUARDRAILS_AUTHORIZATION_NONE, type GuardrailsAuthorizationNone } from "./guardrails-core-authorization";
import { formatAuthorizationEvidence } from "./guardrails-core-authorization";
import {
  buildAgentInvocationSpecPacket,
  type AgentInvocationSpecPacketResult,
} from "./guardrails-core-agent-run-start";
import { hasStructuredOperatorApproval } from "./guardrails-core-operator-approval";

export type ColonyPlanDecision = "ready-for-operator-decision" | "blocked";
export type ColonyPlanNextActionCode = "prepare-worker-fan-in" | "resolve-colony-plan-blockers";
export type ColonyPlanBudgetDecision = "ok" | "warn" | "blocked" | "unknown";

export interface ColonyPlanWorkerInput {
  id?: string;
  objective?: string;
  declaredFiles?: string[];
  allowedTools?: string[];
  allowedCapabilities?: string[];
  providerModelRef?: string;
  budgetEvidencePolicy?: ColonyPlanBudgetDecision | string;
  budgetEvidence?: string;
  stopConditions?: string[];
  expectedArtifact?: string;
}

export interface ColonyPlanWorkerPacket {
  packetId: string;
  workerSequence: number;
  objective: string;
  declaredFiles: string[];
  allowedTools: string[];
  allowedCapabilities: string[];
  budgetEvidencePolicy: ColonyPlanBudgetDecision;
  budgetEvidence: string;
  stopConditions: string[];
  expectedArtifact: string;
  outcomeContract: {
    requiredOutcomeId: string;
    expectedArtifact: string;
    requiredArtifact: string;
    requiredScope: string[];
    requiredStopConditions: string[];
    failOn: string[];
  };
  providerModelRef?: string;
}

export interface ColonyPlanJoinPolicy {
  mode: "fail-closed";
  requiredOutcomeIds: string[];
  failClosedWhen: string[];
  passCriteria: string[];
  promoteOnlyWhen: string;
}

export interface ColonyPlanPacket {
  mode: "colony-plan-packet";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  workerDispatchAllowed: false;
  batchExecutionAllowed: false;
  requiresOperatorDecision: true;
  decision: ColonyPlanDecision;
  recommendationCode: "colony-plan-ready" | "colony-plan-blocked";
  decisionCode: "ready-for-operator-decision" | "blocked";
  planId: string;
  objective: string;
  workerCount: number;
  workerMin: number;
  workerMax: number;
  blockers: string[];
  blockedRequests: string[];
  workers: ColonyPlanWorkerPacket[];
  executionManifest: Array<{
    index: number;
    workerPacketId: string;
    requiredOutcomeId: string;
    expectedArtifact: string;
  }>;
  joinPolicy: ColonyPlanJoinPolicy;
  nextActionCode: ColonyPlanNextActionCode;
  nextAction: string;
  summary: string;
}

export interface ColonyWorkerStartPacketInput extends ColonyPlanWorkerInput {
  planId?: string;
  workerPacketId?: string;
  cwd?: string;
  timeoutMs?: number;
  mutationRequested?: boolean;
  validation?: string[];
}

export interface ColonyWorkerStartPacket {
  mode: "colony-worker-start-packet";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  processStartAllowed: false;
  batchExecutionAllowed: false;
  requiresOperatorDecision: true;
  serialOnly: true;
  planId: string;
  workerPacketId: string;
  requiredOutcomeId: string;
  expectedArtifact: string;
  agentInvocationSpecPacket: AgentInvocationSpecPacketResult;
  nextActionCode: "present-agent-run-approval" | "resolve-worker-start-blockers";
  nextActions: string[];
  summary: string;
}

export interface ColonySerialManifestItem {
  index?: number;
  workerPacketId?: string;
  requiredOutcomeId?: string;
  expectedArtifact?: string;
}

export interface ColonySerialDriverInput {
  planId?: string;
  executionManifest?: ColonySerialManifestItem[];
  completedOutcomes?: string[];
}

export interface ColonySerialDriverPacket {
  mode: "colony-serial-driver-packet";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  processStartAllowed: false;
  batchExecutionAllowed: false;
  requiresOperatorDecision: true;
  serialOnly: true;
  decision: "next-worker-ready" | "completed" | "blocked";
  recommendationCode: "colony-serial-driver-next-worker" | "colony-serial-driver-completed" | "colony-serial-driver-blocked";
  planId: string;
  nextWorkerPacketId: string;
  nextRequiredOutcomeId: string;
  nextExpectedArtifact: string;
  requiredApprovalPrompt: string;
  driverSteps: string[];
  blockers: string[];
  completedOutcomes: string[];
  summary: string;
}

export interface ColonySerialDriverDispatchInput extends ColonySerialDriverInput {
  execute?: boolean;
  operatorApproval?: unknown;
}

export interface ColonySerialDriverDispatchPacket {
  mode: "colony-serial-driver-dispatch-packet";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  processStartAllowed: false;
  batchExecutionAllowed: false;
  requiresOperatorDecision: true;
  serialOnly: true;
  decision: "ready-for-operator-decision" | "blocked";
  recommendationCode: "colony-serial-driver-dispatch-ready" | "colony-serial-driver-dispatch-blocked";
  planId: string;
  executeRequested: boolean;
  structuredOperatorApproval: boolean;
  driverPacket: ColonySerialDriverPacket;
  nextWorkerPacketId: string;
  nextRequiredOutcomeId: string;
  nextExpectedArtifact: string;
  requiredApprovalPrompt: string;
  nextWorkerStartPacket?: ColonyWorkerStartPacket;
  driverSteps: string[];
  blockers: string[];
  summary: string;
}

export interface ColonyPlanInput {
  planId?: string;
  objective?: string;
  workers?: ColonyPlanWorkerInput[];
  validationKnown?: boolean;
  rollbackPlanKnown?: boolean;
  stopConditionsClear?: boolean;
  protectedScopeRequested?: boolean;
  schedulerRequested?: boolean;
  repeatRequested?: boolean;
  remoteOrOffloadRequested?: boolean;
  githubActionsRequested?: boolean;
  providerModelRef?: string;
}

const MIN_WORKERS = 2;
const MAX_WORKERS = 5;
const MAX_ITEMS_PER_LIST = 12;
const DEFAULT_COLONY_REPORT_DIR = ".project/reports";
const MAX_FILES_PER_WORKER = 20;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeId(raw: unknown, fallback: string): string {
  const normalized = normalizeText(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return normalized || fallback;
}

function normalizeBudgetPolicy(value: unknown): ColonyPlanBudgetDecision {
  return value === "ok" || value === "warn" || value === "blocked" || value === "unknown"
    ? value
    : "warn";
}

function normalizeList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of value) {
    const normalized = normalizeText(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized.slice(0, 200));
    if (out.length >= maxItems) {
      break;
    }
  }

  return out;
}

function normalizeFiles(value: unknown): string[] {
  return normalizeList(value, MAX_FILES_PER_WORKER);
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function boolText(value: boolean): string {
  return value ? "yes" : "no";
}

function containsAntColonyReference(value: unknown): boolean {
  return typeof value === "string" && /ant_colony/i.test(value);
}

function isCanonicalOutcomeForPlan(planId: string, outcomeId: string): boolean {
  const escapedPlanId = planId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^outcome:${escapedPlanId}:[A-Za-z0-9._-]+$`).test(outcomeId);
}

function buildJoinPolicy(workers: ColonyPlanWorkerPacket[]): ColonyPlanJoinPolicy {
  const requiredOutcomeIds = workers.map((worker) => worker.outcomeContract.requiredOutcomeId);

  return {
    mode: "fail-closed",
    requiredOutcomeIds,
    failClosedWhen: [
      "missing any required worker outcome",
      "worker outcome contract is not pass",
      "outcome artifact missing or mismatched expectedArtifact",
      "stop condition not satisfied",
      "schema or declared scope violation",
      "top-level blocker introduced after packet creation",
    ],
    passCriteria: [
      "all required worker outcomes are present",
      "all worker outcomes are pass according to the parent contract",
      "all expectedArtifact files are produced",
      "all stop conditions are explicit and satisfied before promotion",
    ],
    promoteOnlyWhen:
      "Do not promote until all required worker outcomes pass; a single missing or failed outcome keeps the aggregate in fail-closed state.",
  };
}

export function buildColonySerialDriverPacket(input: ColonySerialDriverInput = {}): ColonySerialDriverPacket {
  const planId = normalizeId(input.planId, "colony-plan");
  const manifest = Array.isArray(input.executionManifest) ? input.executionManifest : [];
  const completedOutcomes = normalizeList(input.completedOutcomes, 50);
  const completedSet = new Set(completedOutcomes);
  const blockers: string[] = [];

  if (!Array.isArray(input.executionManifest)) {
    blockers.push("execution-manifest-missing");
  }
  if (manifest.length === 0) {
    blockers.push("execution-manifest-empty");
  }

  const seenIndexes = new Set<number>();
  for (let i = 0; i < manifest.length; i += 1) {
    const item = manifest[i] ?? {};
    const expectedIndex = i + 1;
    const index = item.index;
    const workerPacketId = normalizeText(item.workerPacketId);
    const requiredOutcomeId = normalizeText(item.requiredOutcomeId);
    const expectedArtifact = normalizeText(item.expectedArtifact);

    if (typeof index !== "number" || !Number.isInteger(index) || index < 1) {
      blockers.push(`execution-manifest-index-missing:${expectedIndex}`);
    } else {
      if (seenIndexes.has(index)) blockers.push(`execution-manifest-index-duplicate:${index}`);
      seenIndexes.add(index);
      if (index !== expectedIndex) blockers.push(`execution-manifest-disordered:${index}!=${expectedIndex}`);
    }
    if (!workerPacketId) blockers.push(`manifest-item-missing-worker-packet-id:${expectedIndex}`);
    if (!requiredOutcomeId) {
      blockers.push(`manifest-item-missing-required-outcome-id:${expectedIndex}`);
    } else if (!isCanonicalOutcomeForPlan(planId, requiredOutcomeId)) {
      blockers.push(`manifest-item-invalid-outcome-format:${requiredOutcomeId}`);
    }
    if (!expectedArtifact) blockers.push(`manifest-item-missing-expected-artifact:${expectedIndex}`);
    if (
      containsAntColonyReference(workerPacketId)
      || containsAntColonyReference(requiredOutcomeId)
      || containsAntColonyReference(expectedArtifact)
    ) {
      blockers.push("manifest-ant-colony-reference");
    }
  }

  if (completedOutcomes.some(containsAntColonyReference)) {
    blockers.push("manifest-ant-colony-reference");
  }

  const nextItem = blockers.length === 0
    ? manifest.find((item) => !completedSet.has(normalizeText(item.requiredOutcomeId)))
    : undefined;
  const nextWorkerPacketId = normalizeText(nextItem?.workerPacketId);
  const nextRequiredOutcomeId = normalizeText(nextItem?.requiredOutcomeId);
  const nextExpectedArtifact = normalizeText(nextItem?.expectedArtifact);
  const decision = blockers.length > 0 ? "blocked" : nextItem ? "next-worker-ready" : "completed";
  const recommendationCode = decision === "blocked"
    ? "colony-serial-driver-blocked"
    : decision === "completed"
      ? "colony-serial-driver-completed"
      : "colony-serial-driver-next-worker";
  const requiredApprovalPrompt = nextWorkerPacketId
    ? `approve worker colony-${planId}-${nextWorkerPacketId}`
    : "no next worker: executionManifest complete; run colony_serial_fanin_packet";
  const driverSteps = nextWorkerPacketId
    ? [
        `call colony_worker_start_packet for worker ${nextWorkerPacketId} in plan ${planId}`,
        `use explicit operator approval prompt exactly: ${requiredApprovalPrompt}`,
        `after execution, run agent_run_outcome_packet for ${nextRequiredOutcomeId} and require PASS/evidence match before continuing`,
        "when completedOutcomes satisfy executionManifest, run colony_serial_fanin_packet",
      ]
    : [
        "no serial worker remains pending",
        "run colony_serial_fanin_packet with all required outcomes before promotion",
      ];
  const summary = [
    "colony-serial-driver-packet:",
    `decision=${decision}`,
    `plan=${planId}`,
    nextWorkerPacketId ? `nextWorker=${nextWorkerPacketId}` : "nextWorker=none",
    blockers.length > 0 ? `blockers=${blockers.slice(0, 4).join("|")}` : "blockers=none",
    formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE),
    "dispatch=no",
  ].join(" ");

  return {
    mode: "colony-serial-driver-packet",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    processStartAllowed: false,
    batchExecutionAllowed: false,
    requiresOperatorDecision: true,
    serialOnly: true,
    decision,
    recommendationCode,
    planId,
    nextWorkerPacketId,
    nextRequiredOutcomeId,
    nextExpectedArtifact,
    requiredApprovalPrompt,
    driverSteps,
    blockers,
    completedOutcomes,
    summary,
  };
}

export function buildColonySerialDriverDispatchPacket(input: ColonySerialDriverDispatchInput = {}): ColonySerialDriverDispatchPacket {
  const driverPacket = buildColonySerialDriverPacket({
    planId: input.planId,
    executionManifest: input.executionManifest,
    completedOutcomes: input.completedOutcomes,
  });
  const executeRequested = input.execute === true;
  const structuredOperatorApproval = hasStructuredOperatorApproval(input.operatorApproval);
  const blockers = [...driverPacket.blockers];

  if (driverPacket.decision !== "next-worker-ready") {
    blockers.push("colony-driver-decision-not-ready-for-dispatch");
  }
  if (driverPacket.blockers.includes("manifest-ant-colony-reference")) {
    blockers.push("colony-driver-dispatch-ant-colony-reference");
  }
  if (executeRequested && !structuredOperatorApproval) {
    blockers.push("structured-operator-approval-missing");
  }

  const ready = blockers.length === 0;
  const nextWorkerStartPacket = ready
    ? buildColonyWorkerStartPacket({
        planId: driverPacket.planId,
        workerPacketId: driverPacket.nextWorkerPacketId,
        objective: `Execute serial worker ${driverPacket.nextWorkerPacketId} for plan ${driverPacket.planId}`,
        expectedArtifact: driverPacket.nextExpectedArtifact,
        stopConditions: [
          "do not launch ant_colony",
          "do not dispatch another worker",
          "stop on missing expected artifact",
        ],
      })
    : undefined;
  const decision = ready ? "ready-for-operator-decision" : "blocked";
  const driverSteps = ready
    ? [
        `preview colony_worker_start_packet for ${driverPacket.nextWorkerPacketId}`,
        `present approval prompt exactly: ${driverPacket.requiredApprovalPrompt}`,
        "future execute=true path must require structured operator approval and still start only one worker",
        `after execution, run agent_run_outcome_packet for ${driverPacket.nextRequiredOutcomeId}`,
        "when all outcomes are complete, run colony_serial_fanin_packet",
      ]
    : ["resolve colony serial driver dispatch blockers before any worker handoff"];
  const summary = [
    "colony-serial-driver-dispatch-packet:",
    `decision=${decision}`,
    `plan=${driverPacket.planId}`,
    `nextWorker=${driverPacket.nextWorkerPacketId || "none"}`,
    `execute=${executeRequested ? "yes" : "no"}`,
    `structuredApproval=${structuredOperatorApproval ? "yes" : "no"}`,
    blockers.length > 0 ? `blockers=${blockers.slice(0, 4).join("|")}` : "blockers=none",
    formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE),
    "dispatch=no",
  ].join(" ");

  return {
    mode: "colony-serial-driver-dispatch-packet",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    processStartAllowed: false,
    batchExecutionAllowed: false,
    requiresOperatorDecision: true,
    serialOnly: true,
    decision,
    recommendationCode: ready ? "colony-serial-driver-dispatch-ready" : "colony-serial-driver-dispatch-blocked",
    planId: driverPacket.planId,
    executeRequested,
    structuredOperatorApproval,
    driverPacket,
    nextWorkerPacketId: driverPacket.nextWorkerPacketId,
    nextRequiredOutcomeId: driverPacket.nextRequiredOutcomeId,
    nextExpectedArtifact: driverPacket.nextExpectedArtifact,
    requiredApprovalPrompt: driverPacket.requiredApprovalPrompt,
    nextWorkerStartPacket,
    driverSteps,
    blockers,
    summary,
  };
}

export function buildColonyPlanPacket(input: ColonyPlanInput = {}): ColonyPlanPacket {
  const planId = normalizeId(input.planId, "colony-plan");
  const objective = normalizeText(input.objective) || "colony frontier plan";
  const validationKnown = normalizeBoolean(input.validationKnown);
  const rollbackPlanKnown = normalizeBoolean(input.rollbackPlanKnown);
  const stopConditionsClear = normalizeBoolean(input.stopConditionsClear);

  const protectedScopeRequested = normalizeBoolean(input.protectedScopeRequested);
  const schedulerRequested = normalizeBoolean(input.schedulerRequested);
  const repeatRequested = normalizeBoolean(input.repeatRequested);
  const remoteOrOffloadRequested = normalizeBoolean(input.remoteOrOffloadRequested);
  const githubActionsRequested = normalizeBoolean(input.githubActionsRequested);

  const fallbackProvider = normalizeText(input.providerModelRef);
  const rawWorkers = Array.isArray(input.workers) ? input.workers : [];
  const blockers: string[] = [];
  const blockedRequests: string[] = [];
  const seenPacketIds = new Set<string>();

  if (!validationKnown) {
    blockers.push("validation-gate-missing");
  }
  if (!rollbackPlanKnown) {
    blockers.push("rollback-plan-missing");
  }
  if (!stopConditionsClear) {
    blockers.push("stop-conditions-unclear");
  }
  if (protectedScopeRequested) {
    blockers.push("protected-scope-requested");
    blockedRequests.push("protected-scope");
  }
  if (schedulerRequested) {
    blockers.push("scheduler-requested");
    blockedRequests.push("scheduler");
  }
  if (repeatRequested) {
    blockers.push("repeat-requested");
    blockedRequests.push("repeat");
  }
  if (remoteOrOffloadRequested) {
    blockers.push("remote-or-offload-requested");
    blockedRequests.push("remote-or-offload");
  }
  if (githubActionsRequested) {
    blockers.push("github-actions-requested");
    blockedRequests.push("github-actions");
  }

  const workers: ColonyPlanWorkerPacket[] = rawWorkers.map((row, index): ColonyPlanWorkerPacket => {
    const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const sourceIndex = index + 1;
    const packetId = normalizeId(record.id, `worker-${sourceIndex}`).slice(0, 48);
    const objectiveText = normalizeText(record.objective);
    const declaredFiles = normalizeFiles(record.declaredFiles);
    const allowedTools = normalizeList(record.allowedTools, MAX_ITEMS_PER_LIST);
    const allowedCapabilities = normalizeList(record.allowedCapabilities, MAX_ITEMS_PER_LIST);
    const stopConditions = normalizeList(record.stopConditions, MAX_ITEMS_PER_LIST);
    const expectedArtifact = normalizeText(record.expectedArtifact)
      || `${DEFAULT_COLONY_REPORT_DIR}/colony-${planId}-worker-${sourceIndex}.json`;
    const budgetEvidence = normalizeText(record.budgetEvidence)
      || `budget evidence required for ${packetId}`;
    const budgetEvidencePolicy = normalizeBudgetPolicy(record.budgetEvidencePolicy);
    const providerModelRef = normalizeText(record.providerModelRef) || fallbackProvider;

    if (!objectiveText) {
      blockers.push(`worker-objective-missing:${packetId}`);
    }
    if (declaredFiles.length === 0) {
      blockers.push(`worker-declared-files-missing:${packetId}`);
    }
    if (budgetEvidencePolicy === "blocked") {
      blockers.push(`worker-budget-policy-blocked:${packetId}`);
    }
    if (seenPacketIds.has(packetId)) {
      blockers.push(`worker-id-duplicate:${packetId}`);
    }
    seenPacketIds.add(packetId);

    const normalizedStopConditions = stopConditions.length > 0
      ? stopConditions
      : ["stop on first worker-blocking-signal", "require operator review on fail"];

    return {
      packetId,
      workerSequence: sourceIndex,
      objective: objectiveText || "worker objective missing",
      declaredFiles,
      allowedTools: allowedTools.length > 0 ? allowedTools : ["read", "grep", "git"],
      allowedCapabilities: allowedCapabilities.length > 0
        ? allowedCapabilities
        : ["evidence-synthesis", "local-safe-merge"],
      budgetEvidencePolicy,
      budgetEvidence,
      stopConditions: normalizedStopConditions,
      expectedArtifact,
      providerModelRef: providerModelRef || undefined,
      outcomeContract: {
        requiredOutcomeId: `outcome:${planId}:${packetId}`,
        expectedArtifact,
        requiredArtifact: expectedArtifact,
        requiredScope: declaredFiles,
        requiredStopConditions: normalizedStopConditions,
        failOn: ["artifact missing", "unexpected touched files", "blocked stop condition", "missing evidence"],
      },
    };
  });

  if (workers.length < MIN_WORKERS) {
    blockers.push(`workers-missing:${workers.length}<${MIN_WORKERS}`);
  }
  if (workers.length > MAX_WORKERS) {
    blockers.push(`workers-exceed-max:${workers.length}>${MAX_WORKERS}`);
  }

  const decision: ColonyPlanDecision = blockers.length > 0 ? "blocked" : "ready-for-operator-decision";
  const nextActionCode: ColonyPlanNextActionCode =
    decision === "ready-for-operator-decision" ? "prepare-worker-fan-in" : "resolve-colony-plan-blockers";
  const nextAction = decision === "ready-for-operator-decision"
    ? "execute workers by executionManifest order, collect each worker outcome, and apply fail-closed fan-in before any colony promotion or phase advance."
    : blockers.join("; ");
  const joinPolicy = buildJoinPolicy(workers);
  const executionManifest = workers.map((worker) => ({
    index: worker.workerSequence,
    workerPacketId: worker.packetId,
    requiredOutcomeId: worker.outcomeContract.requiredOutcomeId,
    expectedArtifact: worker.expectedArtifact,
  }));

  const summary = [
    "colony-plan-packet:",
    `decision=${decision}`,
    `plan=${planId}`,
    `workers=${workers.length}`,
    `min=${MIN_WORKERS}`,
    `max=${MAX_WORKERS}`,
    `validation=${boolText(validationKnown)}`,
    `rollback=${boolText(rollbackPlanKnown)}`,
    `stop-clear=${boolText(stopConditionsClear)}`,
    blockers.length > 0 ? `blockers=${blockers.slice(0, 4).join("|")}` : "blockers=none",
    `blockedRequests=${blockedRequests.length > 0 ? blockedRequests.join("|") : "none"}`,
    formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE),
    "dispatch=no",
  ].join(" ");

  return {
    mode: "colony-plan-packet",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    workerDispatchAllowed: false,
    batchExecutionAllowed: false,
    requiresOperatorDecision: true,
    decision,
    recommendationCode: decision === "ready-for-operator-decision" ? "colony-plan-ready" : "colony-plan-blocked",
    decisionCode: decision,
    planId,
    objective,
    workerCount: workers.length,
    workerMin: MIN_WORKERS,
    workerMax: MAX_WORKERS,
    blockers,
    blockedRequests,
    workers,
    executionManifest,
    joinPolicy,
    nextActionCode,
    nextAction,
    summary,
  };
}

export function buildColonyWorkerStartPacket(input: ColonyWorkerStartPacketInput = {}): ColonyWorkerStartPacket {
  const planId = normalizeId(input.planId, "colony-plan");
  const workerPacketId = normalizeId(input.workerPacketId ?? input.id, "worker-1");
  const declaredFiles = normalizeFiles(input.declaredFiles);
  const stopConditions = normalizeList(input.stopConditions, MAX_ITEMS_PER_LIST);
  const expectedArtifact = normalizeText(input.expectedArtifact)
    || `${DEFAULT_COLONY_REPORT_DIR}/colony-${planId}-${workerPacketId}.json`;
  const requiredOutcomeId = `outcome:${planId}:${workerPacketId}`;
  const objective = normalizeText(input.objective) || "worker objective missing";
  const budgetEvidencePolicy = normalizeBudgetPolicy(input.budgetEvidencePolicy);
  const budgetEvidence = normalizeText(input.budgetEvidence) || `budget evidence required for ${workerPacketId}`;
  const inheritedAllowedTools = normalizeList(input.allowedTools, MAX_ITEMS_PER_LIST);
  const inheritedAllowedCapabilities = normalizeList(input.allowedCapabilities, MAX_ITEMS_PER_LIST);
  const validation = [
    `required outcome id: ${requiredOutcomeId}`,
    `expected artifact must exist and be non-empty: ${expectedArtifact}`,
    `touched files must be a subset of declared files: ${declaredFiles.join(", ") || "(none)"}`,
    "worker output must include PASS/FAIL, filesTouched, validationEvidence, and blockers",
    ...stopConditions.map((condition) => `stop condition: ${condition}`),
    ...normalizeList(input.validation, MAX_ITEMS_PER_LIST),
  ];
  const fileContract = input.mutationRequested === true ? "mutation" : "read-only";

  const agentInvocationSpecPacket = buildAgentInvocationSpecPacket({
    taskId: `colony-${planId}-${workerPacketId}`,
    runId: `colony-${planId}-${workerPacketId}`,
    purpose: "colony-worker-serial",
    profile: fileContract === "mutation" ? "small-mutation" : "read-only-review",
    goal: [
      objective,
      "",
      `Required outcome id: ${requiredOutcomeId}`,
      `Expected artifact: ${expectedArtifact}`,
      inheritedAllowedTools.length > 0 ? `Inherited worker allowed tools: ${inheritedAllowedTools.join(", ")}` : undefined,
      inheritedAllowedCapabilities.length > 0 ? `Inherited worker allowed capabilities: ${inheritedAllowedCapabilities.join(", ")}` : undefined,
      "Stay within declared files. Do not dispatch other workers. Do not launch ant_colony.",
    ].filter((line): line is string => typeof line === "string").join("\n"),
    providerModelRef: normalizeText(input.providerModelRef),
    cwd: normalizeText(input.cwd) || ".",
    declaredFiles,
    timeoutMs: typeof input.timeoutMs === "number" ? input.timeoutMs : 90_000,
    fileContract,
    validation,
    rollback: fileContract === "mutation" ? declaredFiles.map((file) => `git restore ${file}`) : ["read-only: no file rollback expected"],
    outputSchema: "PASS|FAIL with requiredOutcomeId, expectedArtifact, filesTouched, validationEvidence, blockers",
    budgetDecision: budgetEvidencePolicy,
    budgetEvidence,
    budgetEvidenceSource: "manual",
    budgetEvidenceProvider: normalizeText(input.providerModelRef),
    economyMode: "critical",
    tokenBudgetEvidence: budgetEvidence,
    maxOutputLines: 30,
    extensionIsolation: "minimal-no-extensions",
    protectedScopeRequested: false,
  });

  const nextActionCode = agentInvocationSpecPacket.decision === "ready-for-operator-decision"
    ? "present-agent-run-approval"
    : "resolve-worker-start-blockers";

  return {
    mode: "colony-worker-start-packet",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    processStartAllowed: false,
    batchExecutionAllowed: false,
    requiresOperatorDecision: true,
    serialOnly: true,
    planId,
    workerPacketId,
    requiredOutcomeId,
    expectedArtifact,
    agentInvocationSpecPacket,
    nextActionCode,
    nextActions: agentInvocationSpecPacket.decision === "ready-for-operator-decision"
      ? [
          `present approval prompt exactly: ${agentInvocationSpecPacket.operatorApprovalPrompt}`,
          "only after explicit operator approval, use the existing agent_run dispatch path for one serial worker",
          "after completion, run agent_run_outcome_packet and match the required outcome id before starting any next worker",
        ]
      : ["resolve agent invocation spec blockers before any worker dispatch"],
    summary: [
      "colony-worker-start-packet:",
      `decision=${agentInvocationSpecPacket.decision}`,
      `plan=${planId}`,
      `worker=${workerPacketId}`,
      `outcome=${requiredOutcomeId}`,
      `artifact=${expectedArtifact}`,
      `nextActionCode=${nextActionCode}`,
      "dispatch=no",
    ].join(" "),
  };
}
