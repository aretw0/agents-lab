export type BackgroundProcessKind = "frontend" | "backend" | "test-server" | "worker" | "generic";
export type BackgroundProcessMode = "auto" | "shared-service" | "isolated-worker";
export type BackgroundProcessDecision = "ready-for-design" | "needs-port-lease" | "needs-human-decision" | "blocked";
export type BackgroundProcessLifecycleState = "running" | "stopped" | "finished" | "failed" | "killed" | "late-after-stop" | "unknown-origin";
export type BackgroundProcessLifecycleEventKind = "registered" | "stop-requested" | "done" | "killed";

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
  const displayLabel = normalizeDisplayLabel(raw.label);
  const viewTitle = normalizeViewTitle(raw.viewTitle, "background-process");
  const exitCode = typeof raw.exitCode === "number" && Number.isFinite(raw.exitCode) ? Math.floor(raw.exitCode) : raw.exitCode === null ? null : undefined;
  const warnings: string[] = [];
  if (!knownProcess) warnings.push("unknown-origin");
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
