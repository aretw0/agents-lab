export type AgentRunExecutorKind = "pi-print-subprocess";
export type AgentRunStartDecision = "ready-for-human-decision" | "blocked";

export interface AgentRunStartPacketInput {
  runId?: string;
  executorKind?: string;
  goal?: string;
  providerModelRef?: string;
  cwd?: string;
  declaredFiles?: string[];
  timeoutMs?: number;
  toolAllowlist?: string[];
  sessionIsolation?: "no-session" | "run-session-dir" | string;
  logPath?: string;
  protectedScopeRequested?: boolean;
}

export interface AgentRunStartPacketResult {
  mode: "agent-run-start-packet";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  requiresHumanDecision: true;
  singleRunOnly: true;
  decision: AgentRunStartDecision;
  recommendationCode:
    | "agent-run-start-ready-for-human-decision"
    | "agent-run-start-blocked-run-id"
    | "agent-run-start-blocked-executor"
    | "agent-run-start-blocked-goal"
    | "agent-run-start-blocked-provider-model"
    | "agent-run-start-blocked-cwd"
    | "agent-run-start-blocked-files"
    | "agent-run-start-blocked-timeout"
    | "agent-run-start-blocked-tools"
    | "agent-run-start-blocked-session-isolation"
    | "agent-run-start-blocked-log-path"
    | "agent-run-start-blocked-protected-scope";
  blockers: string[];
  runSpec: {
    runId: string;
    executorKind: AgentRunExecutorKind | "unknown";
    goal: string;
    providerModelRef: string;
    cwd: string;
    declaredFiles: string[];
    timeoutMs: number;
    toolAllowlist: string[];
    sessionIsolation: "no-session" | "run-session-dir" | "unknown";
    logPath: string;
    protectedScopeRequested: boolean;
  };
  commandPreview: {
    command: "pi";
    args: string[];
    shellInterpolationAllowed: false;
  };
  humanConfirmationPhrase: string;
  nextActions: string[];
  summary: string;
}

const AGENT_RUN_START_TIMEOUT_MIN_MS = 5_000;
const AGENT_RUN_START_TIMEOUT_MAX_MS = 180_000;
const READ_ONLY_TOOL_ALLOWLIST = ["read", "grep", "find", "ls"];

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveInt(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
}

function normalizeToolAllowlist(value: unknown): string[] {
  const requested = normalizeStringArray(value);
  return requested.length > 0 ? Array.from(new Set(requested)) : READ_ONLY_TOOL_ALLOWLIST;
}

function normalizeSessionIsolation(value: unknown): "no-session" | "run-session-dir" | "unknown" {
  return value === "no-session" || value === "run-session-dir" ? value : "unknown";
}

export function buildAgentRunStartPacket(input: AgentRunStartPacketInput = {}): AgentRunStartPacketResult {
  const runId = normalizeText(input.runId);
  const executorKind = input.executorKind === "pi-print-subprocess" || !input.executorKind ? "pi-print-subprocess" : "unknown";
  const goal = normalizeText(input.goal);
  const providerModelRef = normalizeText(input.providerModelRef);
  const cwd = normalizeText(input.cwd);
  const declaredFiles = normalizeStringArray(input.declaredFiles);
  const timeoutMs = normalizePositiveInt(input.timeoutMs, 0);
  const toolAllowlist = normalizeToolAllowlist(input.toolAllowlist);
  const sessionIsolation = normalizeSessionIsolation(input.sessionIsolation ?? "no-session");
  const logPath = normalizeText(input.logPath);
  const protectedScopeRequested = input.protectedScopeRequested === true;
  const blockers: string[] = [];
  let recommendationCode: AgentRunStartPacketResult["recommendationCode"] = "agent-run-start-ready-for-human-decision";

  const block = (code: AgentRunStartPacketResult["recommendationCode"], blocker: string) => {
    if (blockers.length === 0) recommendationCode = code;
    blockers.push(blocker);
  };

  if (protectedScopeRequested) block("agent-run-start-blocked-protected-scope", "protected-scope-requested");
  if (!runId) block("agent-run-start-blocked-run-id", "run-id-missing");
  if (executorKind !== "pi-print-subprocess") block("agent-run-start-blocked-executor", "executor-unsupported");
  if (!goal) block("agent-run-start-blocked-goal", "goal-missing");
  if (!providerModelRef || !providerModelRef.includes("/")) block("agent-run-start-blocked-provider-model", "provider-model-ref-missing");
  if (!cwd) block("agent-run-start-blocked-cwd", "cwd-missing");
  if (declaredFiles.length === 0) block("agent-run-start-blocked-files", "declared-files-missing");
  if (timeoutMs < AGENT_RUN_START_TIMEOUT_MIN_MS || timeoutMs > AGENT_RUN_START_TIMEOUT_MAX_MS) block("agent-run-start-blocked-timeout", "timeout-out-of-bounds");
  const unsupportedTools = toolAllowlist.filter((tool) => !READ_ONLY_TOOL_ALLOWLIST.includes(tool));
  if (unsupportedTools.length > 0) block("agent-run-start-blocked-tools", `non-read-only-tools:${unsupportedTools.join(",")}`);
  if (sessionIsolation === "unknown") block("agent-run-start-blocked-session-isolation", "session-isolation-missing");
  if (!logPath) block("agent-run-start-blocked-log-path", "log-path-missing");

  const commandArgs = [
    ...(sessionIsolation === "no-session" ? ["--no-session"] : ["--session-dir", `.pi/agent-runs/${runId || "unknown"}`]),
    "--model",
    providerModelRef || "provider/model-required",
    "--tools",
    toolAllowlist.join(","),
    "-p",
    goal || "goal-required",
  ];
  const decision: AgentRunStartDecision = blockers.length === 0 ? "ready-for-human-decision" : "blocked";
  const humanConfirmationPhrase = runId ? `execute o worker ${runId}` : "execute o worker <run-id>";

  return {
    mode: "agent-run-start-packet",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    processStartAllowed: false,
    processStopAllowed: false,
    requiresHumanDecision: true,
    singleRunOnly: true,
    decision,
    recommendationCode,
    blockers,
    runSpec: {
      runId,
      executorKind,
      goal,
      providerModelRef,
      cwd,
      declaredFiles,
      timeoutMs,
      toolAllowlist,
      sessionIsolation,
      logPath,
      protectedScopeRequested,
    },
    commandPreview: {
      command: "pi",
      args: commandArgs,
      shellInterpolationAllowed: false,
    },
    humanConfirmationPhrase,
    nextActions: decision === "ready-for-human-decision"
      ? [
          "ask the human/operator for the exact confirmation phrase before starting any worker",
          "if confirmed, registry-upsert planned->running with pid/log/status before invoking the command preview as argv",
          "after exit, update registry and run parent-side outcome packet; empty output is a contract failure",
        ]
      : [
          "resolve blockers before any worker dispatch",
          "do not fall back to claude_code_execute or an opaque workflow runner to bypass this packet",
        ],
    summary: [
      "agent-run-start-packet:",
      `decision=${decision}`,
      `code=${recommendationCode}`,
      runId ? `runId=${runId}` : undefined,
      providerModelRef ? `model=${providerModelRef}` : undefined,
      `executor=${executorKind}`,
      `tools=${toolAllowlist.join(",") || "none"}`,
      `dispatch=no`,
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    ].filter(Boolean).join(" "),
  };
}
