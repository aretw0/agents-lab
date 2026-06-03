import { GUARDRAILS_AUTHORIZATION_NONE, type GuardrailsAuthorizationNone } from "./guardrails-core-authorization";
import { formatAuthorizationEvidence } from "./guardrails-core-authorization";

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
  joinPolicy: ColonyPlanJoinPolicy;
  nextActionCode: ColonyPlanNextActionCode;
  nextAction: string;
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
      || `reports/colony-${planId}-worker-${sourceIndex}.json`;
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
    ? "collect each worker outcome and apply fail-closed fan-in before any colony promotion or phase advance."
    : blockers.join("; ");
  const joinPolicy = buildJoinPolicy(workers);

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
    joinPolicy,
    nextActionCode,
    nextAction,
    summary,
  };
}
