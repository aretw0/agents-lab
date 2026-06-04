import { GUARDRAILS_AUTHORIZATION_NONE, type GuardrailsAuthorizationNone } from "./guardrails-core-authorization";

export type ColonySerialFanInDecision = "pass" | "partial" | "block";
export type ColonySerialCacheStatus = "hit" | "miss" | "unknown" | string;
export type ColonySerialCacheStatusInterpretation = "explicit" | "not-applicable" | "operator-reviewed" | "missing";

export interface ColonySerialFanInWorkerInput {
  workerPacketId?: string;
  requiredOutcomeId?: string;
  expectedArtifact?: string;
  artifactPresent?: boolean;
  artifactBytes?: number;
  artifactStatus?: "PASS" | "FAIL" | string;
  processState?: string;
  contractDecision?: string;
  fileContract?: "read-only" | "mutation" | string;
  declaredFiles?: string[];
  touchedFiles?: string[];
  blockers?: string[];
  markerFailures?: string[];
  outputBytes?: number;
  cacheStatus?: ColonySerialCacheStatus;
  antColonyLaunched?: boolean;
}

export interface ColonySerialFanInInput {
  planId?: string;
  batchId?: string;
  workers?: ColonySerialFanInWorkerInput[];
  requiredOutcomeIds?: string[];
}

export interface ColonySerialFanInWorkerSummary {
  workerPacketId: string;
  requiredOutcomeId: string;
  expectedArtifact: string;
  processState: string;
  contractDecision: string;
  artifactPresent: boolean;
  artifactBytes: number;
  artifactStatus: string;
  outputBytes: number;
  fileContract: string;
  cacheStatus: string;
  cacheStatusInterpretation: ColonySerialCacheStatusInterpretation;
  declaredFiles: string[];
  touchedFiles: string[];
  evidenceTouchedFiles: string[];
  unexpectedTouchedFiles: string[];
  declaredTouchedFiles: string[];
  markerFailureCount: number;
  blockers: string[];
  decision: ColonySerialFanInDecision;
}

export interface ColonySerialFanInPacket {
  mode: "colony-serial-fanin-packet";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  requiresOperatorDecision: true;
  serialOnly: true;
  planId: string;
  batchId: string;
  decision: ColonySerialFanInDecision;
  recommendation: "promote-evidence" | "ask-operator" | "block-promotion";
  recommendationCode: "colony-serial-fanin-pass" | "colony-serial-fanin-partial" | "colony-serial-fanin-block";
  requiredOutcomeIds: string[];
  requiredArtifacts: string[];
  blockers: string[];
  warnings: string[];
  contract: {
    mode: "fail-closed";
    requiredOutcomeIds: string[];
    failClosedWhen: string[];
    promoteOnlyWhen: string;
  };
  workerSummaries: ColonySerialFanInWorkerSummary[];
  batchOutcomePacket: {
    mode: "agent-run-batch-outcome-packet";
    activation: "none";
    authorization: GuardrailsAuthorizationNone;
    dispatchAllowed: false;
    processStartAllowed: false;
    processStopAllowed: false;
    decision: ColonySerialFanInDecision;
    recommendation: "stop" | "ask-operator" | "block";
    recommendationCode: "agent-run-batch-outcome-pass" | "agent-run-batch-outcome-partial" | "agent-run-batch-outcome-block";
    blockers: string[];
    batchId: string;
    expectedRunIds: string[];
    workerCount: number;
    passedWorkerCount: number;
    cacheHits: number;
    cacheMisses: number;
    cacheUnknown: number;
    workerSummaries: Array<{
      runId: string;
      processState: string;
      contractDecision: string;
      touchedFileCount: number;
      markerFailureCount: number;
      outputBytes: number;
      cacheStatus: string;
      cacheStatusInterpretation: ColonySerialCacheStatusInterpretation;
    }>;
    fanInContract: string[];
    summary: string;
  };
  nextActions: string[];
  summary: string;
}

const FAIL_CLOSED_WHEN = [
  "missing outcome",
  "outcome != PASS",
  "artifact missing/empty",
  "scope violation",
  "stop condition violated",
  "ant_colony launch",
];

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)));
}

function normalizePositiveInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeBool(value: unknown): boolean {
  return value === true;
}

function outcomeIdFor(planId: string, workerPacketId: string): string {
  return `outcome:${planId}:${workerPacketId}`;
}

function isCanonicalOutcomeId(planId: string, outcomeId: string): boolean {
  return new RegExp(`^outcome:${planId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:[A-Za-z0-9._-]+$`).test(outcomeId);
}

function deriveWorkerPacketId(planId: string, outcomeId: string, fallback: string): string {
  const prefix = `outcome:${planId}:`;
  return outcomeId.startsWith(prefix) ? outcomeId.slice(prefix.length) : fallback;
}

function interpretCacheStatus(input: {
  cacheStatus: string;
  canonicalOutcomeId: boolean;
  contractDecision: string;
  artifactPresent: boolean;
  artifactBytes: number;
  outputBytes: number;
}): ColonySerialCacheStatusInterpretation {
  if (input.cacheStatus === "hit" || input.cacheStatus === "miss") return "explicit";
  if (input.cacheStatus !== "unknown") return "operator-reviewed";
  if (input.canonicalOutcomeId && input.contractDecision === "pass" && input.artifactPresent && input.artifactBytes > 0 && input.outputBytes > 0) {
    return "not-applicable";
  }
  return "missing";
}

export function buildColonySerialFanInPacket(input: ColonySerialFanInInput = {}): ColonySerialFanInPacket {
  const planId = normalizeText(input.planId) || "colony-plan";
  const batchId = normalizeText(input.batchId) || `colony-fanin-${planId}`;
  const workers = Array.isArray(input.workers) ? input.workers : [];
  const declaredRequiredOutcomeIds = normalizeStringArray(input.requiredOutcomeIds);
  const requiredOutcomeIds = declaredRequiredOutcomeIds.length > 0
    ? declaredRequiredOutcomeIds
    : workers.map((worker, index) => {
        const workerPacketId = normalizeText(worker.workerPacketId) || `worker-${index + 1}`;
        return normalizeText(worker.requiredOutcomeId) || outcomeIdFor(planId, workerPacketId);
      });
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (workers.length === 0) blockers.push("workers-missing");
  if (requiredOutcomeIds.length === 0) blockers.push("required-outcomes-missing");
  const workerSummaries = workers.map((worker, index): ColonySerialFanInWorkerSummary => {
    const fallbackWorkerPacketId = `worker-${index + 1}`;
    const rawOutcomeId = normalizeText(worker.requiredOutcomeId);
    const workerPacketId = normalizeText(worker.workerPacketId) || deriveWorkerPacketId(planId, rawOutcomeId, fallbackWorkerPacketId);
    const requiredOutcomeId = rawOutcomeId || outcomeIdFor(planId, workerPacketId);
    const expectedArtifact = normalizeText(worker.expectedArtifact);
    const artifactBytes = normalizePositiveInt(worker.artifactBytes);
    const artifactPresent = normalizeBool(worker.artifactPresent) || artifactBytes > 0;
    const artifactStatus = normalizeText(worker.artifactStatus) || "unknown";
    const processState = normalizeText(worker.processState) || "unknown";
    const contractDecision = normalizeText(worker.contractDecision) || (artifactStatus === "PASS" ? "pass" : "unknown");
    const fileContract = normalizeText(worker.fileContract) || "read-only";
    const declaredFiles = normalizeStringArray(worker.declaredFiles);
    const touchedFiles = normalizeStringArray(worker.touchedFiles);
    const markerFailures = normalizeStringArray(worker.markerFailures);
    const outputBytes = normalizePositiveInt(worker.outputBytes);
    const cacheStatus = normalizeText(worker.cacheStatus) || "unknown";
    const canonicalOutcomeId = isCanonicalOutcomeId(planId, requiredOutcomeId);
    const evidenceTouchedFiles = touchedFiles.filter((file) => expectedArtifact && file === expectedArtifact);
    const declaredTouchedFiles = fileContract === "read-only"
      ? touchedFiles.filter((file) => declaredFiles.includes(file))
      : [];
    const unexpectedTouchedFiles = touchedFiles.filter((file) => file !== expectedArtifact && !declaredFiles.includes(file));
    const workerBlockers = normalizeStringArray(worker.blockers);

    if (!canonicalOutcomeId) workerBlockers.push(`invalid-outcome-id:${requiredOutcomeId || "(missing)"}`);
    if (processState !== "completed") workerBlockers.push(`worker-not-completed:${processState}`);
    if (contractDecision !== "pass") workerBlockers.push(`worker-contract-not-pass:${contractDecision}`);
    if (!artifactPresent || artifactBytes === 0) workerBlockers.push(`artifact-missing-or-empty:${expectedArtifact || "(missing)"}`);
    if (!expectedArtifact) workerBlockers.push("expected-artifact-missing");
    if (declaredTouchedFiles.length > 0) workerBlockers.push(`read-only-declared-files-touched:${declaredTouchedFiles.join(",")}`);
    if (unexpectedTouchedFiles.length > 0) workerBlockers.push(`unexpected-touched-files:${unexpectedTouchedFiles.join(",")}`);
    if (markerFailures.length > 0) workerBlockers.push(`marker-failures:${markerFailures.join(",")}`);
    if (worker.antColonyLaunched === true) workerBlockers.push("ant-colony-launched");

    const cacheStatusInterpretation = interpretCacheStatus({
      cacheStatus,
      canonicalOutcomeId,
      contractDecision,
      artifactPresent,
      artifactBytes,
      outputBytes,
    });
    if (cacheStatusInterpretation === "missing") workerBlockers.push(`worker-cache-status-missing:${requiredOutcomeId}`);
    if (cacheStatusInterpretation === "operator-reviewed") warnings.push(`worker-cache-status-operator-reviewed:${requiredOutcomeId}`);

    return {
      workerPacketId,
      requiredOutcomeId,
      expectedArtifact,
      processState,
      contractDecision,
      artifactPresent,
      artifactBytes,
      artifactStatus,
      outputBytes,
      fileContract,
      cacheStatus,
      cacheStatusInterpretation,
      declaredFiles,
      touchedFiles,
      evidenceTouchedFiles,
      unexpectedTouchedFiles,
      declaredTouchedFiles,
      markerFailureCount: markerFailures.length,
      blockers: workerBlockers,
      decision: workerBlockers.length === 0 ? "pass" : "block",
    };
  });

  const presentOutcomeIds = new Set(workerSummaries.map((worker) => worker.requiredOutcomeId));
  for (const requiredOutcomeId of requiredOutcomeIds) {
    if (!isCanonicalOutcomeId(planId, requiredOutcomeId)) blockers.push(`invalid-required-outcome-id:${requiredOutcomeId}`);
    if (!presentOutcomeIds.has(requiredOutcomeId)) blockers.push(`missing-required-outcome:${requiredOutcomeId}`);
  }
  for (const worker of workerSummaries) {
    blockers.push(...worker.blockers.map((blocker) => `${worker.requiredOutcomeId}:${blocker}`));
  }

  const decision: ColonySerialFanInDecision = blockers.length > 0 ? "block" : warnings.length > 0 ? "partial" : "pass";
  const recommendation = decision === "pass" ? "promote-evidence" : decision === "partial" ? "ask-operator" : "block-promotion";
  const recommendationCode = decision === "pass" ? "colony-serial-fanin-pass" : decision === "partial" ? "colony-serial-fanin-partial" : "colony-serial-fanin-block";
  const batchRecommendation = decision === "pass" ? "stop" : decision === "partial" ? "ask-operator" : "block";
  const batchRecommendationCode = decision === "pass" ? "agent-run-batch-outcome-pass" : decision === "partial" ? "agent-run-batch-outcome-partial" : "agent-run-batch-outcome-block";
  const passedWorkerCount = workerSummaries.filter((worker) => worker.decision === "pass").length;
  const cacheHits = workerSummaries.filter((worker) => worker.cacheStatus === "hit").length;
  const cacheMisses = workerSummaries.filter((worker) => worker.cacheStatus === "miss").length;
  const cacheUnknown = workerSummaries.filter((worker) => worker.cacheStatus === "unknown").length;
  const requiredArtifacts = workerSummaries.map((worker) => worker.expectedArtifact).filter(Boolean);
  const batchWorkerSummaries = workerSummaries.map((worker) => ({
    runId: worker.requiredOutcomeId,
    processState: worker.processState,
    contractDecision: worker.contractDecision,
    touchedFileCount: worker.unexpectedTouchedFiles.length + worker.declaredTouchedFiles.length,
    markerFailureCount: worker.markerFailureCount,
    outputBytes: worker.outputBytes,
    cacheStatus: worker.cacheStatus,
    cacheStatusInterpretation: worker.cacheStatusInterpretation,
  }));

  const summary = [
    "colony-serial-fanin:",
    `decision=${decision}`,
    `recommendation=${recommendation}`,
    `batchId=${batchId}`,
    `workers=${workerSummaries.length}`,
    `passed=${passedWorkerCount}`,
    `blockers=${blockers.length}`,
    `warnings=${warnings.length}`,
    "dispatch=no",
  ].join(" ");

  return {
    mode: "colony-serial-fanin-packet",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    processStartAllowed: false,
    processStopAllowed: false,
    requiresOperatorDecision: true,
    serialOnly: true,
    planId,
    batchId,
    decision,
    recommendation,
    recommendationCode,
    requiredOutcomeIds,
    requiredArtifacts,
    blockers,
    warnings,
    contract: {
      mode: "fail-closed",
      requiredOutcomeIds,
      failClosedWhen: FAIL_CLOSED_WHEN,
      promoteOnlyWhen: "any missing or failed signal keeps BLOCK; promote only when every required outcome is present, PASS, artifact-backed, and scope-clean",
    },
    workerSummaries,
    batchOutcomePacket: {
      mode: "agent-run-batch-outcome-packet",
      activation: "none",
      authorization: GUARDRAILS_AUTHORIZATION_NONE,
      dispatchAllowed: false,
      processStartAllowed: false,
      processStopAllowed: false,
      decision,
      recommendation: batchRecommendation,
      recommendationCode: batchRecommendationCode,
      blockers,
      batchId,
      expectedRunIds: requiredOutcomeIds,
      workerCount: workerSummaries.length,
      passedWorkerCount,
      cacheHits,
      cacheMisses,
      cacheUnknown,
      workerSummaries: batchWorkerSummaries,
      fanInContract: [
        "batch outcome aggregation is report-only and never authorizes worker dispatch",
        "read-only declared files must remain untouched",
        "expected artifacts may be created or updated as evidence",
        "cacheStatus=unknown is not-applicable when explicit outcome, artifact, and output evidence are present",
        "any missing, failed, unexpected-touch, declared-file-touch, marker-failure, or ant_colony signal blocks promotion",
      ],
      summary,
    },
    nextActions: decision === "pass"
      ? ["operator may promote this evidence packet; no dispatch is authorized by the packet itself"]
      : decision === "partial"
        ? ["operator review required before promotion; rerun fan-in report-only after resolving warnings"]
        : ["resolve blockers before promotion; do not override fail-closed fan-in manually"],
    summary,
  };
}
