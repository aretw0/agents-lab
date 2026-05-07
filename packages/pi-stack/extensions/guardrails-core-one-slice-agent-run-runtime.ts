export type OneSliceAgentRunState = "planned" | "running" | "completed" | "failed" | "timed-out" | "aborted" | "unknown";
export type OneSliceAgentAbortDecision = "dry-run" | "abort-ready" | "blocked";

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
