export type BackgroundProcessKind = "frontend" | "backend" | "test-server" | "worker" | "generic";
export type BackgroundProcessMode = "auto" | "shared-service" | "isolated-worker";
export type BackgroundProcessDecision = "ready-for-design" | "needs-port-lease" | "needs-human-decision" | "blocked";
export type BackgroundProcessLifecycleState = "running" | "stopped" | "finished" | "failed" | "killed" | "late-after-stop" | "unknown-origin";
export type BackgroundProcessLifecycleEventKind = "registered" | "stop-requested" | "done" | "killed";
export type BackgroundProcessStopSource = "none" | "human" | "agent" | "timeout" | "unknown";

export interface BackgroundProcessPlanInput {
  kind?: BackgroundProcessKind;
  requestedMode?: BackgroundProcessMode;
  needsServer?: boolean;
  requestedPort?: number;
  parallelAgents?: number;
  existingServiceReusable?: boolean;
  destructiveRestart?: boolean;
  logTailMaxLines?: number;
  stacktraceCapture?: boolean;
  healthcheckKnown?: boolean;
}

export interface BackgroundProcessLifecycleEventInput {
  eventKind?: BackgroundProcessLifecycleEventKind;
  pid?: number;
  exitCode?: number | null;
  knownProcess?: boolean;
  stopRequested?: boolean;
  stopSource?: BackgroundProcessStopSource;
  label?: string;
  viewTitle?: string;
}

export interface BackgroundProcessLifecycleEventResult {
  mode: "background-process-lifecycle-event";
  state: BackgroundProcessLifecycleState;
  eventKind: BackgroundProcessLifecycleEventKind;
  pid?: number;
  exitCode?: number | null;
  knownProcess: boolean;
  stopRequested: boolean;
  stopSource: BackgroundProcessStopSource;
  displayLabel: string;
  viewTitle: string;
  staleOrLate: boolean;
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  authorization: "none";
  warnings: string[];
  evidence: string;
}

export interface BackgroundProcessPlanResult {
  mode: "background-process-control-plan";
  decision: BackgroundProcessDecision;
  recommendedMode: "no-server" | "shared-service" | "isolated-worker" | "manual-decision";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  mutationAllowed: false;
  kind: BackgroundProcessKind;
  portPolicy: {
    requiresLease: boolean;
    requestedPort?: number;
    collisionPolicy: "fail-closed" | "not-applicable";
  };
  logPolicy: {
    tailMaxLines: number;
    captureStdout: true;
    captureStderr: true;
    captureStacktrace: boolean;
    dumpFullLogsAllowed: false;
  };
  requiredMetadata: string[];
  requiredCapabilities: string[];
  blockers: string[];
  warnings: string[];
  evidence: string;
}

export type BackgroundProcessReadinessRecommendationCode =
  | "background-process-readiness-strong"
  | "background-process-readiness-needs-capabilities"
  | "background-process-readiness-needs-evidence"
  | "background-process-readiness-needs-surface-wiring";

export interface BackgroundProcessReadinessInput {
  hasProcessRegistry?: boolean;
  hasPortLeaseLock?: boolean;
  hasBoundedLogTail?: boolean;
  hasStructuredStacktraceCapture?: boolean;
  hasHealthcheckProbe?: boolean;
  hasGracefulStopThenKill?: boolean;
  hasReloadHandoffCleanup?: boolean;
  hasPlanSurface?: boolean;
  hasLifecycleSurface?: boolean;
  rehearsalSlices?: number;
  stopSourceCoveragePct?: number;
}

export interface BackgroundProcessReadinessScore {
  mode: "background-process-readiness-score";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  score: number;
  recommendationCode: BackgroundProcessReadinessRecommendationCode;
  recommendation: string;
  dimensions: {
    capabilities: number;
    surfaceWiring: number;
    operationalEvidence: number;
  };
  checks: Required<BackgroundProcessReadinessInput>;
  summary: string;
}

function normalizeKind(value: unknown): BackgroundProcessKind {
  return value === "frontend" || value === "backend" || value === "test-server" || value === "worker" || value === "generic" ? value : "generic";
}

function normalizeMode(value: unknown): BackgroundProcessMode {
  return value === "shared-service" || value === "isolated-worker" || value === "auto" ? value : "auto";
}

function cleanPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const int = Math.floor(value);
  return int > 0 ? int : undefined;
}

function normalizeTailMaxLines(value: unknown): number {
  const parsed = cleanPositiveInteger(value) ?? 200;
  return Math.max(20, Math.min(1000, parsed));
}

function normalizeLifecycleEventKind(value: unknown): BackgroundProcessLifecycleEventKind {
  return value === "registered" || value === "stop-requested" || value === "done" || value === "killed" ? value : "done";
}

function normalizeStopSource(value: unknown, stopRequested: boolean): BackgroundProcessStopSource {
  if (value === "human" || value === "agent" || value === "timeout" || value === "unknown") return value;
  return stopRequested ? "unknown" : "none";
}

function normalizeDisplayLabel(value: unknown): string {
  const label = typeof value === "string" ? value.trim() : "";
  if (!label || label === "undefined" || label === "null") return "background-process";
  return label.slice(0, 80);
}

function normalizeViewTitle(value: unknown, fallback: string): string {
  const title = typeof value === "string" ? value.trim() : "";
  if (!title || title === "undefined" || title === "null") return fallback;
  return title.slice(0, 80);
}

export function resolveBackgroundProcessLifecycleEvent(raw: BackgroundProcessLifecycleEventInput = {}): BackgroundProcessLifecycleEventResult {
  const eventKind = normalizeLifecycleEventKind(raw.eventKind);
  const pid = cleanPositiveInteger(raw.pid);
  const knownProcess = raw.knownProcess === true;
  const stopRequested = raw.stopRequested === true;
  const stopSource = normalizeStopSource(raw.stopSource, stopRequested);
  const displayLabel = normalizeDisplayLabel(raw.label);
  const viewTitle = normalizeViewTitle(raw.viewTitle, "background-process");
  const exitCode = typeof raw.exitCode === "number" && Number.isFinite(raw.exitCode) ? Math.floor(raw.exitCode) : raw.exitCode === null ? null : undefined;
  const warnings: string[] = [];
  if (!knownProcess) warnings.push("unknown-origin");
  if (stopRequested && stopSource === "unknown") warnings.push("unknown-stop-source");
  if (displayLabel === "background-process") warnings.push("fallback-display-label");
  if (viewTitle === "background-process") warnings.push("fallback-view-title");

  let state: BackgroundProcessLifecycleState;
  if (!knownProcess) {
    state = "unknown-origin";
  } else if (eventKind === "registered") {
    state = "running";
  } else if (eventKind === "stop-requested") {
    state = "stopped";
  } else if (eventKind === "killed") {
    state = "killed";
  } else if (stopRequested) {
    state = "late-after-stop";
    warnings.push("done-after-stop-request");
  } else if (exitCode === 0 || exitCode === undefined || exitCode === null) {
    state = "finished";
  } else {
    state = "failed";
  }

  const staleOrLate = state === "late-after-stop" || state === "unknown-origin";
  const evidence = [
    "background-process-lifecycle",
    `state=${state}`,
    `event=${eventKind}`,
    `pid=${pid ?? "unknown"}`,
    `known=${knownProcess ? "yes" : "no"}`,
    `stopRequested=${stopRequested ? "yes" : "no"}`,
    stopSource !== "none" ? `stopSource=${stopSource}` : undefined,
    exitCode !== undefined ? `exit=${exitCode}` : undefined,
    `label=${displayLabel}`,
    `viewTitle=${viewTitle}`,
    "dispatch=no",
    "authorization=none",
  ].filter(Boolean).join(" ");

  return {
    mode: "background-process-lifecycle-event",
    state,
    eventKind,
    ...(pid ? { pid } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    knownProcess,
    stopRequested,
    stopSource,
    displayLabel,
    viewTitle,
    staleOrLate,
    dispatchAllowed: false,
    processStartAllowed: false,
    processStopAllowed: false,
    authorization: "none",
    warnings,
    evidence,
  };
}

function decideRecommendedMode(input: Required<Pick<BackgroundProcessPlanInput, "needsServer" | "existingServiceReusable">> & {
  requestedMode: BackgroundProcessMode;
  parallelAgents: number;
}): BackgroundProcessPlanResult["recommendedMode"] {
  if (!input.needsServer) return "no-server";
  if (input.requestedMode === "shared-service") return "shared-service";
  if (input.requestedMode === "isolated-worker") return "isolated-worker";
  if (input.existingServiceReusable) return "shared-service";
  if (input.parallelAgents > 1) return "manual-decision";
  return "shared-service";
}

export function resolveBackgroundProcessControlPlan(raw: BackgroundProcessPlanInput = {}): BackgroundProcessPlanResult {
  const kind = normalizeKind(raw.kind);
  const requestedMode = normalizeMode(raw.requestedMode);
  const needsServer = raw.needsServer !== false;
  const requestedPort = cleanPositiveInteger(raw.requestedPort);
  const parallelAgents = cleanPositiveInteger(raw.parallelAgents) ?? 1;
  const existingServiceReusable = raw.existingServiceReusable === true;
  const destructiveRestart = raw.destructiveRestart === true;
  const healthcheckKnown = raw.healthcheckKnown === true;
  const tailMaxLines = normalizeTailMaxLines(raw.logTailMaxLines);
  const captureStacktrace = raw.stacktraceCapture !== false;
  const recommendedMode = decideRecommendedMode({ needsServer, requestedMode, parallelAgents, existingServiceReusable });

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (needsServer && !requestedPort) blockers.push("port-lease-required");
  if (recommendedMode === "manual-decision") blockers.push("parallel-agent-server-mode-decision-required");
  if (destructiveRestart) blockers.push("destructive-restart-requires-human-approval");
  if (needsServer && !healthcheckKnown) warnings.push("healthcheck-not-declared");
  if (parallelAgents > 1 && recommendedMode === "shared-service") warnings.push("shared-service-needs-cross-agent-lock");

  const decision: BackgroundProcessDecision = destructiveRestart
    ? "blocked"
    : blockers.includes("parallel-agent-server-mode-decision-required")
      ? "needs-human-decision"
      : blockers.includes("port-lease-required")
        ? "needs-port-lease"
        : "ready-for-design";

  const requiredMetadata = ["owner", "workspace", "session", "command", "cwd", "pid", "startedAt", "portLease", "mode", "healthcheck"];
  const requiredCapabilities = [
    "process-registry",
    "port-lease-lock",
    "bounded-log-tail",
    "structured-stacktrace-capture",
    "healthcheck-probe",
    "graceful-stop-then-kill",
    "reload-handoff-cleanup",
  ];

  const evidence = [
    "background-process-plan",
    `decision=${decision}`,
    `mode=${recommendedMode}`,
    `needsServer=${needsServer ? "yes" : "no"}`,
    `port=${requestedPort ?? "none"}`,
    `parallelAgents=${parallelAgents}`,
    "dispatch=no",
    "processStart=no",
    "authorization=none",
  ].join(" ");

  return {
    mode: "background-process-control-plan",
    decision,
    recommendedMode,
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    processStartAllowed: false,
    processStopAllowed: false,
    mutationAllowed: false,
    kind,
    portPolicy: {
      requiresLease: needsServer,
      ...(requestedPort ? { requestedPort } : {}),
      collisionPolicy: needsServer ? "fail-closed" : "not-applicable",
    },
    logPolicy: {
      tailMaxLines,
      captureStdout: true,
      captureStderr: true,
      captureStacktrace,
      dumpFullLogsAllowed: false,
    },
    requiredMetadata,
    requiredCapabilities,
    blockers,
    warnings,
    evidence,
  };
}

function normalizePercent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreRatio(values: boolean[]): number {
  if (values.length <= 0) return 0;
  const passed = values.filter(Boolean).length;
  return Math.round((passed / values.length) * 100);
}

export function buildBackgroundProcessReadinessScore(raw: BackgroundProcessReadinessInput = {}): BackgroundProcessReadinessScore {
  const checks: Required<BackgroundProcessReadinessInput> = {
    hasProcessRegistry: raw.hasProcessRegistry === true,
    hasPortLeaseLock: raw.hasPortLeaseLock === true,
    hasBoundedLogTail: raw.hasBoundedLogTail === true,
    hasStructuredStacktraceCapture: raw.hasStructuredStacktraceCapture === true,
    hasHealthcheckProbe: raw.hasHealthcheckProbe === true,
    hasGracefulStopThenKill: raw.hasGracefulStopThenKill === true,
    hasReloadHandoffCleanup: raw.hasReloadHandoffCleanup === true,
    hasPlanSurface: raw.hasPlanSurface === true,
    hasLifecycleSurface: raw.hasLifecycleSurface === true,
    rehearsalSlices: cleanPositiveInteger(raw.rehearsalSlices) ?? 0,
    stopSourceCoveragePct: normalizePercent(raw.stopSourceCoveragePct),
  };

  const capabilities = scoreRatio([
    checks.hasProcessRegistry,
    checks.hasPortLeaseLock,
    checks.hasBoundedLogTail,
    checks.hasStructuredStacktraceCapture,
    checks.hasHealthcheckProbe,
    checks.hasGracefulStopThenKill,
    checks.hasReloadHandoffCleanup,
  ]);
  const surfaceWiring = scoreRatio([checks.hasPlanSurface, checks.hasLifecycleSurface]);
  const rehearsalScore = checks.rehearsalSlices >= 3
    ? 100
    : checks.rehearsalSlices === 2
      ? 70
      : checks.rehearsalSlices === 1
        ? 40
        : 0;
  const operationalEvidence = Math.round((rehearsalScore * 0.6) + (checks.stopSourceCoveragePct * 0.4));

  const score = Math.round((capabilities * 0.55) + (surfaceWiring * 0.2) + (operationalEvidence * 0.25));

  let recommendationCode: BackgroundProcessReadinessRecommendationCode = "background-process-readiness-strong";
  let recommendation = "background process readiness is strong; continue bounded local rehearsal before any operational promotion.";

  if (surfaceWiring < 100) {
    recommendationCode = "background-process-readiness-needs-surface-wiring";
    recommendation = "surface wiring is incomplete; keep calibration in report-only mode until plan/lifecycle surfaces are both present.";
  } else if (capabilities < 75) {
    recommendationCode = "background-process-readiness-needs-capabilities";
    recommendation = "core capabilities are incomplete; prioritize registry/lease/log/stop/cleanup contracts before operational control.";
  } else if (operationalEvidence < 70) {
    recommendationCode = "background-process-readiness-needs-evidence";
    recommendation = "operational evidence is insufficient; run bounded local drills and capture stopSource coverage before scaling.";
  }

  return {
    mode: "background-process-readiness-score",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    score,
    recommendationCode,
    recommendation,
    dimensions: {
      capabilities,
      surfaceWiring,
      operationalEvidence,
    },
    checks,
    summary: [
      "background-process-readiness:",
      "ok=yes",
      `score=${score}`,
      `code=${recommendationCode}`,
      `capabilities=${capabilities}`,
      `surface=${surfaceWiring}`,
      `evidence=${operationalEvidence}`,
    ].join(" "),
  };
}
