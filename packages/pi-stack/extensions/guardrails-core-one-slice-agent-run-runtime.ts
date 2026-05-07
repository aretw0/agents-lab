export type OneSliceAgentRunState = "planned" | "running" | "completed" | "failed" | "timed-out" | "aborted" | "unknown";
export type OneSliceAgentAbortDecision = "dry-run" | "abort-ready" | "blocked";
export type OneSliceAgentRunContractDecision = "pass" | "partial" | "fail";
export type OneSliceAgentRunOutcomeRecommendation = "stop" | "retry-once" | "ask-human";
export type OneSliceAgentRunRegistryUpsertDecision = "dry-run" | "write-ready" | "blocked";

export interface OneSliceAgentRunRegistryEntry {
  runId?: string;
  pid?: number;
  state?: OneSliceAgentRunState;
  providerModelRef?: string;
  cwd?: string;
  declaredFiles?: string[];
  statusPath?: string;
  logPath?: string;
  startedAtIso?: string;
  lastEventAtIso?: string;
  timeoutMs?: number;
  stopRequested?: boolean;
  stopSource?: "human" | "agent" | "timeout" | "unknown";
}

export interface OneSliceAgentRunStatusResult {
  mode: "one-slice-agent-run-status";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  runId: string;
  found: boolean;
  state: OneSliceAgentRunState;
  pid?: number;
  providerModelRef?: string;
  cwd?: string;
  declaredFiles: string[];
  statusPath?: string;
  logPath?: string;
  startedAtIso?: string;
  lastEventAtIso?: string;
  elapsedMs?: number;
  stale: boolean;
  warnings: string[];
  summary: string;
}

export interface OneSliceAgentRunRegistryUpsertInput {
  runId?: string;
  existingEntry?: OneSliceAgentRunRegistryEntry;
  state?: OneSliceAgentRunState;
  providerModelRef?: string;
  cwd?: string;
  declaredFiles?: string[];
  logPath?: string;
  timeoutMs?: number;
  dryRun?: boolean;
  nowIso?: string;
}

export interface OneSliceAgentRunRegistryUpsertResult {
  mode: "one-slice-agent-run-registry-upsert";
  activation: "none";
  authorization: "none" | "explicit-apply";
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  writeAllowed: boolean;
  decision: OneSliceAgentRunRegistryUpsertDecision;
  recommendationCode:
    | "one-slice-agent-registry-upsert-dry-run"
    | "one-slice-agent-registry-upsert-write-ready"
    | "one-slice-agent-registry-upsert-blocked-run-id"
    | "one-slice-agent-registry-upsert-blocked-cwd"
    | "one-slice-agent-registry-upsert-blocked-files"
    | "one-slice-agent-registry-upsert-blocked-state";
  blockers: string[];
  runId: string;
  entry: OneSliceAgentRunRegistryEntry;
  summary: string;
}

export interface OneSliceAgentRunMarkerResult {
  label?: string;
  ok?: boolean;
}

export interface OneSliceAgentRunOutcomeInput {
  runId?: string;
  entry?: OneSliceAgentRunRegistryEntry;
  touchedFiles?: string[];
  markerResults?: OneSliceAgentRunMarkerResult[];
}

export interface OneSliceAgentRunOutcomeResult {
  mode: "one-slice-agent-run-outcome-packet";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  runId: string;
  found: boolean;
  processState: OneSliceAgentRunState;
  contractDecision: OneSliceAgentRunContractDecision;
  recommendation: OneSliceAgentRunOutcomeRecommendation;
  recommendationCode:
    | "one-slice-agent-outcome-pass"
    | "one-slice-agent-outcome-partial-no-touched-files"
    | "one-slice-agent-outcome-fail-missing-run"
    | "one-slice-agent-outcome-fail-process-state"
    | "one-slice-agent-outcome-fail-unexpected-files"
    | "one-slice-agent-outcome-fail-missing-declared-files"
    | "one-slice-agent-outcome-fail-marker";
  declaredFiles: string[];
  touchedFiles: string[];
  missingDeclaredFiles: string[];
  unexpectedFiles: string[];
  markerFailures: string[];
  rollbackFiles: string[];
  blockers: string[];
  summary: string;
}

export interface OneSliceAgentAbortPlanInput {
  runId?: string;
  entry?: OneSliceAgentRunRegistryEntry;
  execute?: boolean;
  operatorConfirmed?: boolean;
  cwdExpected?: string;
  nowMs?: number;
}

export interface OneSliceAgentAbortPlanResult {
  mode: "one-slice-agent-abort-plan";
  activation: "none";
  authorization: "none" | "explicit-human";
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: boolean;
  decision: OneSliceAgentAbortDecision;
  recommendationCode:
    | "one-slice-agent-abort-dry-run"
    | "one-slice-agent-abort-ready"
    | "one-slice-agent-abort-blocked-missing-run"
    | "one-slice-agent-abort-blocked-not-running"
    | "one-slice-agent-abort-blocked-missing-pid"
    | "one-slice-agent-abort-blocked-cwd-mismatch"
    | "one-slice-agent-abort-blocked-human-confirmation";
  blockers: string[];
  runId: string;
  pid?: number;
  stopSource: "human";
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

function normalizeState(value: unknown): OneSliceAgentRunState {
  return value === "planned" || value === "running" || value === "completed" || value === "failed" || value === "timed-out" || value === "aborted" ? value : "unknown";
}

function parseIsoMs(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function buildOneSliceAgentRunRegistryUpsertPacket(input: OneSliceAgentRunRegistryUpsertInput = {}): OneSliceAgentRunRegistryUpsertResult {
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
  let recommendationCode: OneSliceAgentRunRegistryUpsertResult["recommendationCode"] = input.dryRun === false ? "one-slice-agent-registry-upsert-write-ready" : "one-slice-agent-registry-upsert-dry-run";

  const block = (code: OneSliceAgentRunRegistryUpsertResult["recommendationCode"], blocker: string) => {
    if (blockers.length === 0) recommendationCode = code;
    blockers.push(blocker);
  };

  if (!runId) block("one-slice-agent-registry-upsert-blocked-run-id", "run-id-missing");
  if (!cwd) block("one-slice-agent-registry-upsert-blocked-cwd", "cwd-missing");
  if (declaredFiles.length === 0) block("one-slice-agent-registry-upsert-blocked-files", "declared-files-missing");
  if (state === "unknown") block("one-slice-agent-registry-upsert-blocked-state", "state-unknown");

  const entry: OneSliceAgentRunRegistryEntry = {
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
  const decision: OneSliceAgentRunRegistryUpsertDecision = blockers.length > 0 ? "blocked" : writeAllowed ? "write-ready" : "dry-run";
  const summary = [
    "one-slice-agent-registry-upsert:",
    `decision=${decision}`,
    `runId=${runId || "unknown"}`,
    `state=${state}`,
    `files=${declaredFiles.length}`,
    `writeAllowed=${writeAllowed ? "yes" : "no"}`,
    blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    `authorization=${writeAllowed ? "explicit-apply" : "none"}`,
    "dispatch=no",
  ].filter(Boolean).join(" ");

  return {
    mode: "one-slice-agent-run-registry-upsert",
    activation: "none",
    authorization: writeAllowed ? "explicit-apply" : "none",
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

export function buildOneSliceAgentRunStatus(runId: string, entry?: OneSliceAgentRunRegistryEntry, nowMs = Date.now()): OneSliceAgentRunStatusResult {
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
    "one-slice-agent-run-status:",
    `runId=${cleanRunId || "unknown"}`,
    `found=${found ? "yes" : "no"}`,
    `state=${state}`,
    pid ? `pid=${pid}` : undefined,
    stale ? "stale=yes" : "stale=no",
    warnings.length > 0 ? `warnings=${warnings.join("|")}` : undefined,
    "dispatch=no",
    "authorization=none",
  ].filter(Boolean).join(" ");

  return {
    mode: "one-slice-agent-run-status",
    activation: "none",
    authorization: "none",
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
    stale,
    warnings,
    summary,
  };
}

export function buildOneSliceAgentRunOutcomePacket(input: OneSliceAgentRunOutcomeInput = {}): OneSliceAgentRunOutcomeResult {
  const runId = normalizeText(input.runId ?? input.entry?.runId);
  const found = !!input.entry;
  const processState = normalizeState(input.entry?.state);
  const declaredFiles = normalizeFiles(input.entry?.declaredFiles);
  const touchedFiles = normalizeFiles(input.touchedFiles);
  const declaredSet = new Set(declaredFiles);
  const touchedSet = new Set(touchedFiles);
  const missingDeclaredFiles = declaredFiles.filter((file) => !touchedSet.has(file));
  const unexpectedFiles = touchedFiles.filter((file) => !declaredSet.has(file));
  const markerFailures = Array.isArray(input.markerResults)
    ? input.markerResults
      .filter((marker) => marker?.ok === false)
      .map((marker, index) => normalizeText(marker.label) || `marker-${index + 1}`)
    : [];
  const blockers: string[] = [];
  if (!found) blockers.push("run-not-found");
  if (found && processState !== "completed") blockers.push(`process-state-${processState}`);
  if (unexpectedFiles.length > 0) blockers.push("unexpected-files");
  if (touchedFiles.length > 0 && missingDeclaredFiles.length > 0) blockers.push("declared-files-missing");
  if (markerFailures.length > 0) blockers.push("marker-failures");

  let contractDecision: OneSliceAgentRunContractDecision = "pass";
  let recommendation: OneSliceAgentRunOutcomeRecommendation = "stop";
  let recommendationCode: OneSliceAgentRunOutcomeResult["recommendationCode"] = "one-slice-agent-outcome-pass";

  if (!found) {
    contractDecision = "fail";
    recommendation = "ask-human";
    recommendationCode = "one-slice-agent-outcome-fail-missing-run";
  } else if (processState !== "completed") {
    contractDecision = "fail";
    recommendation = processState === "timed-out" ? "retry-once" : "ask-human";
    recommendationCode = "one-slice-agent-outcome-fail-process-state";
  } else if (unexpectedFiles.length > 0) {
    contractDecision = "fail";
    recommendation = "ask-human";
    recommendationCode = "one-slice-agent-outcome-fail-unexpected-files";
  } else if (touchedFiles.length > 0 && missingDeclaredFiles.length > 0) {
    contractDecision = "fail";
    recommendation = "ask-human";
    recommendationCode = "one-slice-agent-outcome-fail-missing-declared-files";
  } else if (markerFailures.length > 0) {
    contractDecision = "fail";
    recommendation = "ask-human";
    recommendationCode = "one-slice-agent-outcome-fail-marker";
  } else if (touchedFiles.length === 0) {
    contractDecision = "partial";
    recommendation = "ask-human";
    recommendationCode = "one-slice-agent-outcome-partial-no-touched-files";
    blockers.push("touched-files-not-provided");
  }

  const rollbackFiles = [...new Set([...unexpectedFiles, ...touchedFiles.filter((file) => declaredSet.has(file) && contractDecision === "fail")])];
  const summary = [
    "one-slice-agent-run-outcome:",
    `contract=${contractDecision}`,
    `process=${processState}`,
    `recommendation=${recommendation}`,
    `runId=${runId || "unknown"}`,
    `declared=${declaredFiles.length}`,
    `touched=${touchedFiles.length}`,
    unexpectedFiles.length > 0 ? `unexpected=${unexpectedFiles.length}` : undefined,
    missingDeclaredFiles.length > 0 && touchedFiles.length > 0 ? `missing=${missingDeclaredFiles.length}` : undefined,
    markerFailures.length > 0 ? `markerFailures=${markerFailures.length}` : undefined,
    "dispatch=no",
    "authorization=none",
  ].filter(Boolean).join(" ");

  return {
    mode: "one-slice-agent-run-outcome-packet",
    activation: "none",
    authorization: "none",
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
    touchedFiles,
    missingDeclaredFiles: touchedFiles.length > 0 ? missingDeclaredFiles : [],
    unexpectedFiles,
    markerFailures,
    rollbackFiles,
    blockers,
    summary,
  };
}

export function buildOneSliceAgentAbortPlan(input: OneSliceAgentAbortPlanInput = {}): OneSliceAgentAbortPlanResult {
  const runId = normalizeText(input.runId ?? input.entry?.runId);
  const entry = input.entry;
  const pid = normalizePid(entry?.pid);
  const execute = input.execute === true;
  const operatorConfirmed = input.operatorConfirmed === true;
  const cwdExpected = normalizeText(input.cwdExpected);
  const blockers: string[] = [];
  let recommendationCode: OneSliceAgentAbortPlanResult["recommendationCode"] = execute ? "one-slice-agent-abort-ready" : "one-slice-agent-abort-dry-run";

  const block = (code: OneSliceAgentAbortPlanResult["recommendationCode"], blocker: string) => {
    if (blockers.length === 0) recommendationCode = code;
    blockers.push(blocker);
  };

  if (!entry) block("one-slice-agent-abort-blocked-missing-run", "run-not-found");
  if (entry && normalizeState(entry.state) !== "running") block("one-slice-agent-abort-blocked-not-running", "run-not-running");
  if (entry && !pid) block("one-slice-agent-abort-blocked-missing-pid", "pid-missing");
  if (entry && cwdExpected && normalizeText(entry.cwd) !== cwdExpected) block("one-slice-agent-abort-blocked-cwd-mismatch", "cwd-mismatch");
  if (execute && !operatorConfirmed) block("one-slice-agent-abort-blocked-human-confirmation", "human-confirmation-missing");

  const decision: OneSliceAgentAbortDecision = blockers.length > 0 ? "blocked" : execute ? "abort-ready" : "dry-run";
  const processStopAllowed = decision === "abort-ready";
  const summary = [
    "one-slice-agent-abort-plan:",
    `decision=${decision}`,
    `code=${recommendationCode}`,
    `runId=${runId || "unknown"}`,
    pid ? `pid=${pid}` : undefined,
    blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    `processStopAllowed=${processStopAllowed ? "yes" : "no"}`,
    `authorization=${processStopAllowed ? "explicit-human" : "none"}`,
  ].filter(Boolean).join(" ");

  return {
    mode: "one-slice-agent-abort-plan",
    activation: "none",
    authorization: processStopAllowed ? "explicit-human" : "none",
    dispatchAllowed: false,
    processStartAllowed: false,
    processStopAllowed,
    decision,
    recommendationCode,
    blockers,
    runId,
    ...(pid ? { pid } : {}),
    stopSource: "human",
    summary,
  };
}
