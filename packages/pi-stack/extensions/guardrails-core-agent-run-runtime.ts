import {
  formatAuthorizationEvidence,
  GUARDRAILS_AUTHORIZATION_EXPLICIT_APPLY,
  GUARDRAILS_AUTHORIZATION_EXPLICIT_OPERATOR,
  GUARDRAILS_AUTHORIZATION_NONE,
  type GuardrailsAuthorizationExplicitApply,
  type GuardrailsAuthorizationExplicitOperator,
  type GuardrailsAuthorizationNone,
} from "./guardrails-core-authorization";
import { sameCwd } from "./guardrails-core-execution-context";
import { hasStructuredOperatorApproval } from "./guardrails-core-operator-approval";

export type AgentRunState = "planned" | "running" | "completed" | "failed" | "timed-out" | "aborted" | "unknown";
export type AgentRunAbortDecision = "dry-run" | "abort-ready" | "blocked";
export type AgentRunContractDecision = "pass" | "partial" | "fail";
export type AgentRunOutcomeRecommendation = "stop" | "retry-once" | "retry-with-toolkit" | "ask-operator";
export type AgentRunRegistryUpsertDecision = "dry-run" | "write-ready" | "blocked";
export type AgentRunToolkitFeedbackKind = "missing-tool" | "weak-tool" | "capability-gap";

export interface AgentRunRegistryEntry {
  runId?: string;
  pid?: number;
  state?: AgentRunState;
  providerModelRef?: string;
  cwd?: string;
  declaredFiles?: string[];
  statusPath?: string;
  logPath?: string;
  startedAtIso?: string;
  lastEventAtIso?: string;
  timeoutMs?: number;
  exitCode?: number;
  outputBytes?: number;
  errorCode?: string;
  errorMessage?: string;
  stopRequested?: boolean;
  stopSource?: "operator" | "agent" | "timeout" | "unknown";
}

export interface AgentRunStatusResult {
  mode: "agent-run-status";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  runId: string;
  found: boolean;
  state: AgentRunState;
  pid?: number;
  providerModelRef?: string;
  cwd?: string;
  declaredFiles: string[];
  statusPath?: string;
  logPath?: string;
  startedAtIso?: string;
  lastEventAtIso?: string;
  elapsedMs?: number;
  exitCode?: number;
  outputBytes?: number;
  errorCode?: string;
  errorMessage?: string;
  stale: boolean;
  warnings: string[];
  summary: string;
}

export interface AgentRunRegistryUpsertInput {
  runId?: string;
  existingEntry?: AgentRunRegistryEntry;
  state?: AgentRunState;
  providerModelRef?: string;
  cwd?: string;
  declaredFiles?: string[];
  logPath?: string;
  timeoutMs?: number;
  dryRun?: boolean;
  nowIso?: string;
}

export interface AgentRunRegistryUpsertResult {
  mode: "agent-run-registry-upsert";
  activation: "none";
  authorization: GuardrailsAuthorizationNone | GuardrailsAuthorizationExplicitApply;
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  writeAllowed: boolean;
  decision: AgentRunRegistryUpsertDecision;
  recommendationCode:
    | "agent-run-registry-upsert-dry-run"
    | "agent-run-registry-upsert-write-ready"
    | "agent-run-registry-upsert-blocked-run-id"
    | "agent-run-registry-upsert-blocked-cwd"
    | "agent-run-registry-upsert-blocked-files"
    | "agent-run-registry-upsert-blocked-state";
  blockers: string[];
  runId: string;
  entry: AgentRunRegistryEntry;
  summary: string;
}

export interface AgentRunMarkerResult {
  label?: string;
  ok?: boolean;
}

export type AgentRunFileContract = "mutation" | "read-only";

export interface AgentRunOutcomeInput {
  runId?: string;
  entry?: AgentRunRegistryEntry;
  touchedFiles?: string[];
  markerResults?: AgentRunMarkerResult[];
  outputBytes?: number;
  fileContract?: AgentRunFileContract | string;
  mutationTargetFiles?: string[];
  toolkitFeedback?: {
    kind?: string;
    capability?: string;
    tool?: string;
    message?: string;
  };
}

export interface AgentRunOutcomeResult {
  mode: "agent-run-outcome-packet";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  runId: string;
  found: boolean;
  processState: AgentRunState;
  contractDecision: AgentRunContractDecision;
  recommendation: AgentRunOutcomeRecommendation;
  recommendationCode:
    | "agent-run-outcome-pass"
    | "agent-run-outcome-partial-no-touched-files"
    | "agent-run-outcome-fail-missing-run"
    | "agent-run-outcome-fail-process-state"
    | "agent-run-outcome-fail-empty-output"
    | "agent-run-outcome-fail-read-only-touched-files"
    | "agent-run-outcome-fail-unexpected-files"
    | "agent-run-outcome-fail-missing-declared-files"
    | "agent-run-outcome-fail-toolkit-gap"
    | "agent-run-outcome-fail-marker";
  declaredFiles: string[];
  mutationTargetFiles: string[];
  touchedFiles: string[];
  missingDeclaredFiles: string[];
  unexpectedFiles: string[];
  markerFailures: string[];
  outputBytes?: number;
  fileContract: AgentRunFileContract;
  rollbackFiles: string[];
  toolkitFeedback?: {
    kind: AgentRunToolkitFeedbackKind;
    capability: string;
    tool: string;
    message: string;
  };
  toolkitRetry?: {
    action: "retry-with-toolkit";
    dispatchAllowed: false;
    requiredCapability: string;
    requestedTool: string;
    reason: string;
  };
  blockers: string[];
  summary: string;
}

export interface AgentRunBatchOutcomeWorkerInput {
  runId?: string;
  processState?: AgentRunState | string;
  contractDecision?: AgentRunContractDecision | string;
  touchedFiles?: string[];
  markerFailures?: string[];
  outputBytes?: number;
  cacheStatus?: "hit" | "miss" | "unknown" | string;
}

export interface AgentRunBatchOutcomeInput {
  batchId?: string;
  expectedRunIds?: string[];
  workerOutcomes?: AgentRunBatchOutcomeWorkerInput[];
  protectedScopeRequested?: boolean;
  unexpectedDirty?: boolean;
}

export interface AgentRunBatchOutcomeResult {
  mode: "agent-run-batch-outcome-packet";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  decision: AgentRunContractDecision;
  recommendation: "promote" | "ask-operator";
  recommendationCode: "agent-run-batch-outcome-pass" | "agent-run-batch-outcome-partial" | "agent-run-batch-outcome-fail";
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
    processState: AgentRunState;
    contractDecision: AgentRunContractDecision;
    touchedFileCount: number;
    markerFailureCount: number;
    outputBytes?: number;
    cacheStatus: "hit" | "miss" | "unknown";
  }>;
  fanInContract: string[];
  summary: string;
}

export interface AgentRunAbortPlanInput {
  runId?: string;
  entry?: AgentRunRegistryEntry;
  execute?: boolean;
  operatorApproval?: unknown;
  cwdExpected?: string;
  nowMs?: number;
}

export interface AgentRunAbortPlanResult {
  mode: "agent-run-abort-plan";
  activation: "none";
  authorization: GuardrailsAuthorizationNone | GuardrailsAuthorizationExplicitOperator;
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: boolean;
  decision: AgentRunAbortDecision;
  recommendationCode:
    | "agent-run-abort-dry-run"
    | "agent-run-abort-ready"
    | "agent-run-abort-blocked-missing-run"
    | "agent-run-abort-blocked-not-running"
    | "agent-run-abort-blocked-missing-pid"
    | "agent-run-abort-blocked-cwd-mismatch"
    | "agent-run-abort-blocked-operator-approval";
  blockers: string[];
  runId: string;
  pid?: number;
  stopSource: "operator";
  summary: string;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePid(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const pid = Math.floor(value);
  return pid > 0 ? pid : undefined;
}

function normalizeFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
}

function normalizeState(value: unknown): AgentRunState {
  return value === "planned" || value === "running" || value === "completed" || value === "failed" || value === "timed-out" || value === "aborted" ? value : "unknown";
}

function normalizeContractDecision(value: unknown): AgentRunContractDecision {
  return value === "pass" || value === "partial" || value === "fail" ? value : "fail";
}

function normalizeCacheStatus(value: unknown): "hit" | "miss" | "unknown" {
  return value === "hit" || value === "miss" ? value : "unknown";
}

function normalizeNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : undefined;
}

function normalizeToolkitFeedbackKind(value: unknown): AgentRunToolkitFeedbackKind | undefined {
  return value === "missing-tool" || value === "weak-tool" || value === "capability-gap" ? value : undefined;
}

function parseIsoMs(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function buildAgentRunRegistryUpsertPacket(input: AgentRunRegistryUpsertInput = {}): AgentRunRegistryUpsertResult {
  const existing = input.existingEntry;
  const runId = normalizeText(input.runId ?? existing?.runId);
  const cwd = normalizeText(input.cwd ?? existing?.cwd);
  const state = normalizeState(input.state ?? existing?.state ?? "planned");
  const declaredFiles = normalizeFiles(input.declaredFiles).length > 0 ? normalizeFiles(input.declaredFiles) : normalizeFiles(existing?.declaredFiles);
  const providerModelRef = normalizeText(input.providerModelRef ?? existing?.providerModelRef);
  const logPath = normalizeText(input.logPath ?? existing?.logPath);
  const timeoutMs = typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0 ? Math.floor(input.timeoutMs) : existing?.timeoutMs;
  const nowIso = normalizeText(input.nowIso) || new Date().toISOString();
  const blockers: string[] = [];
  let recommendationCode: AgentRunRegistryUpsertResult["recommendationCode"] = input.dryRun === false ? "agent-run-registry-upsert-write-ready" : "agent-run-registry-upsert-dry-run";

  const block = (code: AgentRunRegistryUpsertResult["recommendationCode"], blocker: string) => {
    if (blockers.length === 0) recommendationCode = code;
    blockers.push(blocker);
  };

  if (!runId) block("agent-run-registry-upsert-blocked-run-id", "run-id-missing");
  if (!cwd) block("agent-run-registry-upsert-blocked-cwd", "cwd-missing");
  if (declaredFiles.length === 0) block("agent-run-registry-upsert-blocked-files", "declared-files-missing");
  if (state === "unknown") block("agent-run-registry-upsert-blocked-state", "state-unknown");

  const entry: AgentRunRegistryEntry = {
    ...(existing ?? {}),
    runId,
    state,
    ...(providerModelRef ? { providerModelRef } : {}),
    cwd,
    declaredFiles,
    ...(logPath ? { logPath } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    startedAtIso: existing?.startedAtIso ?? nowIso,
    lastEventAtIso: nowIso,
  };

  const writeAllowed = blockers.length === 0 && input.dryRun === false;
  const authorization = writeAllowed ? GUARDRAILS_AUTHORIZATION_EXPLICIT_APPLY : GUARDRAILS_AUTHORIZATION_NONE;
  const decision: AgentRunRegistryUpsertDecision = blockers.length > 0 ? "blocked" : writeAllowed ? "write-ready" : "dry-run";
  const summary = [
    "agent-run-registry-upsert:",
    `decision=${decision}`,
    `runId=${runId || "unknown"}`,
    `state=${state}`,
    `files=${declaredFiles.length}`,
    `writeAllowed=${writeAllowed ? "yes" : "no"}`,
    blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    formatAuthorizationEvidence(authorization),
    "dispatch=no",
  ].filter(Boolean).join(" ");

  return {
    mode: "agent-run-registry-upsert",
    activation: "none",
    authorization,
    dispatchAllowed: false,
    processStartAllowed: false,
    processStopAllowed: false,
    writeAllowed,
    decision,
    recommendationCode,
    blockers,
    runId,
    entry,
    summary,
  };
}

export function buildAgentRunStatus(runId: string, entry?: AgentRunRegistryEntry, nowMs = Date.now()): AgentRunStatusResult {
  const cleanRunId = normalizeText(runId);
  const found = !!entry;
  const state = normalizeState(entry?.state);
  const pid = normalizePid(entry?.pid);
  const lastEventMs = parseIsoMs(entry?.lastEventAtIso);
  const startedMs = parseIsoMs(entry?.startedAtIso);
  const elapsedMs = startedMs ? Math.max(0, nowMs - startedMs) : undefined;
  const stale = state === "running" && !!lastEventMs && nowMs - lastEventMs > 60_000;
  const warnings: string[] = [];
  if (!found) warnings.push("run-not-found");
  if (found && state === "unknown") warnings.push("state-unknown");
  if (state === "running" && !pid) warnings.push("pid-missing");
  if (stale) warnings.push("heartbeat-stale");

  const summary = [
    "agent-run-status:",
    `runId=${cleanRunId || "unknown"}`,
    `found=${found ? "yes" : "no"}`,
    `state=${state}`,
    pid ? `pid=${pid}` : undefined,
    stale ? "stale=yes" : "stale=no",
    warnings.length > 0 ? `warnings=${warnings.join("|")}` : undefined,
    "dispatch=no",
    formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE),
  ].filter(Boolean).join(" ");

  return {
    mode: "agent-run-status",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    processStartAllowed: false,
    processStopAllowed: false,
    runId: cleanRunId,
    found,
    state,
    ...(pid ? { pid } : {}),
    ...(entry?.providerModelRef ? { providerModelRef: entry.providerModelRef } : {}),
    ...(entry?.cwd ? { cwd: entry.cwd } : {}),
    declaredFiles: normalizeFiles(entry?.declaredFiles),
    ...(entry?.statusPath ? { statusPath: entry.statusPath } : {}),
    ...(entry?.logPath ? { logPath: entry.logPath } : {}),
    ...(entry?.startedAtIso ? { startedAtIso: entry.startedAtIso } : {}),
    ...(entry?.lastEventAtIso ? { lastEventAtIso: entry.lastEventAtIso } : {}),
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
    ...(normalizeNonNegativeInteger(entry?.exitCode) !== undefined ? { exitCode: normalizeNonNegativeInteger(entry?.exitCode) } : {}),
    ...(normalizeNonNegativeInteger(entry?.outputBytes) !== undefined ? { outputBytes: normalizeNonNegativeInteger(entry?.outputBytes) } : {}),
    ...(entry?.errorCode ? { errorCode: entry.errorCode } : {}),
    ...(entry?.errorMessage ? { errorMessage: entry.errorMessage } : {}),
    stale,
    warnings,
    summary,
  };
}

export function buildAgentRunOutcomePacket(input: AgentRunOutcomeInput = {}): AgentRunOutcomeResult {
  const runId = normalizeText(input.runId ?? input.entry?.runId);
  const found = !!input.entry;
  const processState = normalizeState(input.entry?.state);
  const declaredFiles = normalizeFiles(input.entry?.declaredFiles);
  const touchedFiles = normalizeFiles(input.touchedFiles);
  const outputBytes = normalizeNonNegativeInteger(input.outputBytes) ?? normalizeNonNegativeInteger(input.entry?.outputBytes);
  const fileContract: AgentRunFileContract = input.fileContract === "read-only" ? "read-only" : "mutation";
  const toolkitFeedbackKind = normalizeToolkitFeedbackKind(input.toolkitFeedback?.kind);
  const toolkitFeedback = toolkitFeedbackKind ? {
    kind: toolkitFeedbackKind,
    capability: normalizeText(input.toolkitFeedback?.capability) || "unknown",
    tool: normalizeText(input.toolkitFeedback?.tool) || "unspecified",
    message: normalizeText(input.toolkitFeedback?.message) || `${toolkitFeedbackKind} reported by worker`,
  } : undefined;
  const mutationTargetFiles = fileContract === "mutation" && normalizeFiles(input.mutationTargetFiles).length > 0 ? normalizeFiles(input.mutationTargetFiles) : declaredFiles;
  const declaredSet = new Set(declaredFiles);
  const expectedTouchedSet = new Set(fileContract === "mutation" ? mutationTargetFiles : declaredFiles);
  const touchedSet = new Set(touchedFiles);
  const missingDeclaredFiles = (fileContract === "mutation" ? mutationTargetFiles : declaredFiles).filter((file) => !touchedSet.has(file));
  const unexpectedFiles = touchedFiles.filter((file) => !expectedTouchedSet.has(file));
  const markerFailures = Array.isArray(input.markerResults)
    ? input.markerResults
      .filter((marker) => marker?.ok === false)
      .map((marker, index) => normalizeText(marker.label) || `marker-${index + 1}`)
    : [];
  const blockers: string[] = [];
  if (!found) blockers.push("run-not-found");
  if (found && processState !== "completed") blockers.push(`process-state-${processState}`);
  if (found && processState === "completed" && outputBytes === 0) blockers.push("empty-output");
  if (fileContract === "read-only" && touchedFiles.length > 0) blockers.push("read-only-touched-files");
  if (unexpectedFiles.length > 0) blockers.push("unexpected-files");
  if (fileContract !== "read-only" && touchedFiles.length > 0 && missingDeclaredFiles.length > 0) blockers.push("declared-files-missing");
  if (toolkitFeedback) blockers.push(`toolkit-feedback:${toolkitFeedback.kind}:${toolkitFeedback.capability}`);
  if (markerFailures.length > 0) blockers.push("marker-failures");

  let contractDecision: AgentRunContractDecision = "pass";
  let recommendation: AgentRunOutcomeRecommendation = "stop";
  let recommendationCode: AgentRunOutcomeResult["recommendationCode"] = "agent-run-outcome-pass";

  if (!found) {
    contractDecision = "fail";
    recommendation = "ask-operator";
    recommendationCode = "agent-run-outcome-fail-missing-run";
  } else if (processState !== "completed") {
    contractDecision = "fail";
    recommendation = processState === "timed-out" ? "retry-once" : "ask-operator";
    recommendationCode = "agent-run-outcome-fail-process-state";
  } else if (outputBytes === 0) {
    contractDecision = "fail";
    recommendation = "ask-operator";
    recommendationCode = "agent-run-outcome-fail-empty-output";
  } else if (fileContract === "read-only" && touchedFiles.length > 0) {
    contractDecision = "fail";
    recommendation = "ask-operator";
    recommendationCode = "agent-run-outcome-fail-read-only-touched-files";
  } else if (unexpectedFiles.length > 0) {
    contractDecision = "fail";
    recommendation = "ask-operator";
    recommendationCode = "agent-run-outcome-fail-unexpected-files";
  } else if (touchedFiles.length > 0 && missingDeclaredFiles.length > 0) {
    contractDecision = "fail";
    recommendation = "ask-operator";
    recommendationCode = "agent-run-outcome-fail-missing-declared-files";
  } else if (toolkitFeedback) {
    contractDecision = "fail";
    recommendation = "retry-with-toolkit";
    recommendationCode = "agent-run-outcome-fail-toolkit-gap";
  } else if (markerFailures.length > 0) {
    contractDecision = "fail";
    recommendation = "ask-operator";
    recommendationCode = "agent-run-outcome-fail-marker";
  } else if (fileContract === "mutation" && touchedFiles.length === 0) {
    contractDecision = "partial";
    recommendation = "ask-operator";
    recommendationCode = "agent-run-outcome-partial-no-touched-files";
    blockers.push("touched-files-not-provided");
  }

  const rollbackFiles = [...new Set([...unexpectedFiles, ...touchedFiles.filter((file) => declaredSet.has(file) && contractDecision === "fail")])];
  const summary = [
    "agent-run-outcome:",
    `contract=${contractDecision}`,
    `process=${processState}`,
    `recommendation=${recommendation}`,
    `runId=${runId || "unknown"}`,
    `declared=${declaredFiles.length}`,
    `touched=${touchedFiles.length}`,
    unexpectedFiles.length > 0 ? `unexpected=${unexpectedFiles.length}` : undefined,
    missingDeclaredFiles.length > 0 && touchedFiles.length > 0 ? `missing=${missingDeclaredFiles.length}` : undefined,
    markerFailures.length > 0 ? `markerFailures=${markerFailures.length}` : undefined,
    toolkitFeedback ? `toolkitFeedback=${toolkitFeedback.kind}:${toolkitFeedback.capability}` : undefined,
    outputBytes !== undefined ? `outputBytes=${outputBytes}` : undefined,
    "dispatch=no",
    formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE),
  ].filter(Boolean).join(" ");

  return {
    mode: "agent-run-outcome-packet",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    processStartAllowed: false,
    processStopAllowed: false,
    runId,
    found,
    processState,
    contractDecision,
    recommendation,
    recommendationCode,
    declaredFiles,
    mutationTargetFiles,
    touchedFiles,
    missingDeclaredFiles: touchedFiles.length > 0 ? missingDeclaredFiles : [],
    unexpectedFiles,
    markerFailures,
    ...(outputBytes !== undefined ? { outputBytes } : {}),
    fileContract,
    rollbackFiles,
    ...(toolkitFeedback ? { toolkitFeedback } : {}),
    ...(toolkitFeedback ? {
      toolkitRetry: {
        action: "retry-with-toolkit",
        dispatchAllowed: false,
        requiredCapability: toolkitFeedback.capability,
        requestedTool: toolkitFeedback.tool,
        reason: toolkitFeedback.message,
      },
    } : {}),
    blockers,
    summary,
  };
}

export function buildAgentRunBatchOutcomePacket(input: AgentRunBatchOutcomeInput = {}): AgentRunBatchOutcomeResult {
  const batchId = normalizeText(input.batchId);
  const expectedRunIds = normalizeFiles(input.expectedRunIds);
  const outcomes = Array.isArray(input.workerOutcomes) ? input.workerOutcomes : [];
  const protectedScopeRequested = input.protectedScopeRequested === true;
  const unexpectedDirty = input.unexpectedDirty === true;
  const blockers: string[] = [];
  if (!batchId) blockers.push("batch-id-missing");
  if (protectedScopeRequested) blockers.push("protected-scope-requested");
  if (unexpectedDirty) blockers.push("unexpected-dirty-state");
  if (outcomes.length === 0) blockers.push("worker-outcomes-missing");

  const seenRunIds = new Set<string>();
  const workerSummaries = outcomes.map((outcome, index) => {
    const runId = normalizeText(outcome.runId);
    const processState = normalizeState(outcome.processState);
    const contractDecision = normalizeContractDecision(outcome.contractDecision);
    const touchedFiles = normalizeFiles(outcome.touchedFiles);
    const markerFailures = normalizeFiles(outcome.markerFailures);
    const outputBytes = normalizeNonNegativeInteger(outcome.outputBytes);
    const cacheStatus = normalizeCacheStatus(outcome.cacheStatus);
    const label = runId || `worker-${index + 1}`;
    if (!runId) blockers.push(`worker-run-id-missing:${index + 1}`);
    if (runId && seenRunIds.has(runId)) blockers.push(`duplicate-run-id:${runId}`);
    if (runId) seenRunIds.add(runId);
    if (processState !== "completed") blockers.push(`worker-process-not-completed:${label}:${processState}`);
    if (contractDecision !== "pass") blockers.push(`worker-contract-not-pass:${label}:${contractDecision}`);
    if (touchedFiles.length > 0) blockers.push(`worker-touched-files:${label}:${touchedFiles.length}`);
    if (markerFailures.length > 0) blockers.push(`worker-marker-failures:${label}:${markerFailures.length}`);
    if (outputBytes === undefined || outputBytes === 0) blockers.push(`worker-output-missing:${label}`);
    if (cacheStatus === "unknown") blockers.push(`worker-cache-status-unknown:${label}`);
    return {
      runId,
      processState,
      contractDecision,
      touchedFileCount: touchedFiles.length,
      markerFailureCount: markerFailures.length,
      ...(outputBytes !== undefined ? { outputBytes } : {}),
      cacheStatus,
    };
  });

  for (const expectedRunId of expectedRunIds) {
    if (!seenRunIds.has(expectedRunId)) blockers.push(`expected-run-missing:${expectedRunId}`);
  }

  const passedWorkerCount = workerSummaries.filter((worker) => worker.processState === "completed" && worker.contractDecision === "pass" && worker.touchedFileCount === 0 && worker.markerFailureCount === 0 && (worker.outputBytes ?? 0) > 0).length;
  const cacheHits = workerSummaries.filter((worker) => worker.cacheStatus === "hit").length;
  const cacheMisses = workerSummaries.filter((worker) => worker.cacheStatus === "miss").length;
  const cacheUnknown = workerSummaries.filter((worker) => worker.cacheStatus === "unknown").length;
  const decision: AgentRunContractDecision = blockers.length === 0 ? "pass" : passedWorkerCount > 0 ? "partial" : "fail";
  const recommendation = decision === "pass" ? "promote" : "ask-operator";
  const recommendationCode: AgentRunBatchOutcomeResult["recommendationCode"] = decision === "pass" ? "agent-run-batch-outcome-pass" : decision === "partial" ? "agent-run-batch-outcome-partial" : "agent-run-batch-outcome-fail";
  const fanInContract = [
    "batch outcome aggregation is report-only and never authorizes worker dispatch",
    "all expected workers must be completed, contract=pass, outputBytes>0, read-only clean, and marker-clean before promotion",
    "cache-hit/cache-miss evidence must be explicit for every worker; unknown cache status blocks promotion",
    "any failed, missing, touched-file, protected-scope, dirty-state, or missing-output signal requires operator review",
  ];
  const summary = [
    "agent-run-batch-outcome:",
    `decision=${decision}`,
    `recommendation=${recommendation}`,
    `batchId=${batchId || "unknown"}`,
    `workers=${workerSummaries.length}`,
    `passed=${passedWorkerCount}`,
    `cacheHits=${cacheHits}`,
    `cacheMisses=${cacheMisses}`,
    cacheUnknown > 0 ? `cacheUnknown=${cacheUnknown}` : undefined,
    blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    "dispatch=no",
    formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE),
  ].filter(Boolean).join(" ");

  return {
    mode: "agent-run-batch-outcome-packet",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    processStartAllowed: false,
    processStopAllowed: false,
    decision,
    recommendation,
    recommendationCode,
    blockers,
    batchId,
    expectedRunIds,
    workerCount: workerSummaries.length,
    passedWorkerCount,
    cacheHits,
    cacheMisses,
    cacheUnknown,
    workerSummaries,
    fanInContract,
    summary,
  };
}

export function buildAgentRunAbortPlan(input: AgentRunAbortPlanInput = {}): AgentRunAbortPlanResult {
  const runId = normalizeText(input.runId ?? input.entry?.runId);
  const entry = input.entry;
  const pid = normalizePid(entry?.pid);
  const execute = input.execute === true;
  const structuredOperatorApproval = hasStructuredOperatorApproval(input.operatorApproval);
  const cwdExpected = normalizeText(input.cwdExpected);
  const blockers: string[] = [];
  let recommendationCode: AgentRunAbortPlanResult["recommendationCode"] = execute ? "agent-run-abort-ready" : "agent-run-abort-dry-run";

  const block = (code: AgentRunAbortPlanResult["recommendationCode"], blocker: string) => {
    if (blockers.length === 0) recommendationCode = code;
    blockers.push(blocker);
  };

  if (!entry) block("agent-run-abort-blocked-missing-run", "run-not-found");
  if (entry && normalizeState(entry.state) !== "running") block("agent-run-abort-blocked-not-running", "run-not-running");
  if (entry && !pid) block("agent-run-abort-blocked-missing-pid", "pid-missing");
  if (entry && cwdExpected && !sameCwd(normalizeText(entry.cwd), cwdExpected)) block("agent-run-abort-blocked-cwd-mismatch", "cwd-mismatch");
  if (execute && !structuredOperatorApproval) block("agent-run-abort-blocked-operator-approval", "structured-operator-approval-missing");

  const decision: AgentRunAbortDecision = blockers.length > 0 ? "blocked" : execute ? "abort-ready" : "dry-run";
  const processStopAllowed = decision === "abort-ready";
  const authorization = processStopAllowed ? GUARDRAILS_AUTHORIZATION_EXPLICIT_OPERATOR : GUARDRAILS_AUTHORIZATION_NONE;
  const summary = [
    "agent-run-abort-plan:",
    `decision=${decision}`,
    `code=${recommendationCode}`,
    `runId=${runId || "unknown"}`,
    pid ? `pid=${pid}` : undefined,
    blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    `processStopAllowed=${processStopAllowed ? "yes" : "no"}`,
    formatAuthorizationEvidence(authorization),
  ].filter(Boolean).join(" ");

  return {
    mode: "agent-run-abort-plan",
    activation: "none",
    authorization,
    dispatchAllowed: false,
    processStartAllowed: false,
    processStopAllowed,
    decision,
    recommendationCode,
    blockers,
    runId,
    ...(pid ? { pid } : {}),
    stopSource: "operator",
    summary,
  };
}
