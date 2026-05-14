export type AgentRunExecutorStrategyDecision = "subprocess-first" | "sdk-in-process-candidate" | "blocked";
export type AgentRunExecutorStrategyKind = "pi-print-subprocess" | "pi-sdk-in-process";
export type AgentRunExecutorRuntimeMode = "windows" | "linux" | "devcontainer" | "unknown";

export interface AgentRunExecutorStrategyInput {
  failureClass?: string;
  subprocessDiagnosticsAvailable?: boolean;
  sdkRuntimeAvailable?: boolean;
  budgetDecision?: string;
  protectedScopeRequested?: boolean;
  exactConfirmationAvailable?: boolean;
  runtimeMode?: string;
  devcontainerAvailable?: boolean;
  requiresProcessIsolation?: boolean;
  requiresDirectEventStream?: boolean;
  mutationRequested?: boolean;
  unexpectedDirty?: boolean;
}

export interface AgentRunExecutorStrategyPacketResult {
  mode: "agent-run-executor-strategy-packet";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  processStartAllowed: false;
  decision: AgentRunExecutorStrategyDecision;
  recommendationCode:
    | "agent-run-executor-strategy-subprocess-first"
    | "agent-run-executor-strategy-sdk-candidate"
    | "agent-run-executor-strategy-blocked";
  preferredExecutor: AgentRunExecutorStrategyKind;
  nextProbeExecutor: AgentRunExecutorStrategyKind;
  supportedExecutors: AgentRunExecutorStrategyKind[];
  executorPosture: {
    subprocessRetained: true;
    sdkIsReplacement: false;
    subprocessBlindRetryAllowed: boolean;
    subprocessMaturityProbe: "continue-diagnostics" | "devcontainer-or-linux-canary" | "not-needed-yet";
  };
  selectionSignals: {
    runtimeMode: AgentRunExecutorRuntimeMode;
    devcontainerAvailable: boolean;
    requiresProcessIsolation: boolean;
    requiresDirectEventStream: boolean;
    mutationRequested: boolean;
    unexpectedDirty: boolean;
  };
  selectionRationale: string[];
  trustLadder: Array<{
    oodaStage: "observe" | "orient" | "decide" | "act";
    support: string;
    confidence: "high" | "medium" | "low";
    boundary: string;
  }>;
  executorContracts: Array<{
    executor: AgentRunExecutorStrategyKind;
    purpose: string;
    requiredEvidence: string[];
    dispatchStatus: "not-authorized-by-packet";
  }>;
  blockers: string[];
  nextActions: string[];
  summary: string;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRuntimeMode(value: unknown): AgentRunExecutorRuntimeMode {
  const text = cleanText(value);
  if (text === "windows" || text === "linux" || text === "devcontainer") return text;
  return "unknown";
}

export function buildAgentRunExecutorStrategyPacket(input: AgentRunExecutorStrategyInput = {}): AgentRunExecutorStrategyPacketResult {
  const failureClass = cleanText(input.failureClass || "unknown");
  const budgetDecision = cleanText(input.budgetDecision || "unknown");
  const blockers: string[] = [];
  if (input.protectedScopeRequested) blockers.push("protected-scope-requested");
  if (input.unexpectedDirty) blockers.push("unexpected-dirty-state");
  if (budgetDecision === "blocked" || budgetDecision === "unknown" || !budgetDecision) blockers.push(`budget-${budgetDecision || "unknown"}`);

  const subprocessDiagnosticsAvailable = input.subprocessDiagnosticsAvailable === true;
  const sdkRuntimeAvailable = input.sdkRuntimeAvailable === true;
  const exactConfirmationAvailable = input.exactConfirmationAvailable === true;
  const runtimeMode = normalizeRuntimeMode(input.runtimeMode);
  const devcontainerAvailable = input.devcontainerAvailable === true;
  const requiresProcessIsolation = input.requiresProcessIsolation === true;
  const requiresDirectEventStream = input.requiresDirectEventStream === true;
  const mutationRequested = input.mutationRequested === true;
  const unexpectedDirty = input.unexpectedDirty === true;
  const subprocessStartupFailure = failureClass === "silent-runner-failure" || failureClass === "runner-timeout";
  const canProbeSubprocessOffWindows = subprocessStartupFailure && subprocessDiagnosticsAvailable && (devcontainerAvailable || runtimeMode === "linux" || runtimeMode === "devcontainer");
  const selectionSignals = {
    runtimeMode,
    devcontainerAvailable,
    requiresProcessIsolation,
    requiresDirectEventStream,
    mutationRequested,
    unexpectedDirty,
  };
  const selectionRationale: string[] = [];

  let decision: AgentRunExecutorStrategyDecision = "subprocess-first";
  let preferredExecutor: AgentRunExecutorStrategyKind = "pi-print-subprocess";
  let recommendationCode: AgentRunExecutorStrategyPacketResult["recommendationCode"] = "agent-run-executor-strategy-subprocess-first";

  if (blockers.length > 0) {
    decision = "blocked";
    recommendationCode = "agent-run-executor-strategy-blocked";
    selectionRationale.push("blocked until protected-scope and budget gates are clear");
  } else if (canProbeSubprocessOffWindows || (requiresProcessIsolation && !subprocessStartupFailure) || (mutationRequested && !requiresDirectEventStream)) {
    decision = "subprocess-first";
    preferredExecutor = "pi-print-subprocess";
    recommendationCode = "agent-run-executor-strategy-subprocess-first";
    selectionRationale.push(canProbeSubprocessOffWindows
      ? "subprocess remains the next maturity probe because devcontainer/Linux evidence can distinguish Windows startup fragility"
      : "subprocess is preferred when process isolation or mutation safety dominates");
  } else if ((subprocessStartupFailure && subprocessDiagnosticsAvailable && sdkRuntimeAvailable) || (requiresDirectEventStream && sdkRuntimeAvailable)) {
    decision = "sdk-in-process-candidate";
    preferredExecutor = "pi-sdk-in-process";
    recommendationCode = "agent-run-executor-strategy-sdk-candidate";
    selectionRationale.push(subprocessStartupFailure
      ? "SDK/in-process is the next diagnostic candidate because current subprocess startup evidence is not actionable enough and no off-Windows subprocess probe is declared"
      : "SDK/in-process is preferred when direct AgentSession event visibility dominates");
  } else {
    selectionRationale.push("subprocess remains the conservative default while SDK/process signals are insufficient");
  }

  const nextProbeExecutor: AgentRunExecutorStrategyKind = preferredExecutor;
  const executorPosture: AgentRunExecutorStrategyPacketResult["executorPosture"] = {
    subprocessRetained: true,
    sdkIsReplacement: false,
    subprocessBlindRetryAllowed: !subprocessStartupFailure && decision !== "blocked",
    subprocessMaturityProbe: canProbeSubprocessOffWindows ? "devcontainer-or-linux-canary" : subprocessStartupFailure && subprocessDiagnosticsAvailable ? "devcontainer-or-linux-canary" : "not-needed-yet",
  };

  const trustLadder: AgentRunExecutorStrategyPacketResult["trustLadder"] = [
    {
      oodaStage: "observe",
      support: "local deterministic sensors: git dirty state, route/budget evidence, registry, logs, outcome packets, line budget",
      confidence: "high",
      boundary: "read-only/report-only sensors do not authorize dispatch or closure by themselves",
    },
    {
      oodaStage: "orient",
      support: "report-only packets: executor strategy, SDK packet, startup diagnostic, cache pack, batch/fan-in preview",
      confidence: "high",
      boundary: "packets explain options and blockers; they remain authorization=none",
    },
    {
      oodaStage: "decide",
      support: "control-plane or human decision after fresh route evidence and board context",
      confidence: "medium",
      boundary: "exact one-run confirmation is still required for any provider/worker dispatch or provider experiment",
    },
    {
      oodaStage: "act",
      support: "small local edits/tests/commits and, when confirmed, one narrow SDK read-only worker under the validated read/grep envelope",
      confidence: "medium",
      boundary: "parallel fan-out, mutation workers, blind subprocess retry, and alternate provider/model canaries remain separate explicit decisions",
    },
  ];

  const executorContracts = [
    {
      executor: "pi-print-subprocess" as const,
      purpose: "isolated CLI worker with argv/log/registry/outcome evidence; retained as first-class executor even when blind retry is paused",
      requiredEvidence: ["argv", "cwd", "command-source", "exit-code", "stdout-bytes", "stderr-bytes", "timeout", "registry-state", "startup-diagnostic-or-devcontainer-probe"],
      dispatchStatus: "not-authorized-by-packet" as const,
    },
    {
      executor: "pi-sdk-in-process" as const,
      purpose: "embedded AgentSession worker with direct event stream and final-output contract",
      requiredEvidence: ["model-resolution", "tool-scope", "cwd", "event-stream", "final-output-bytes", "abort-signal", "registry-state"],
      dispatchStatus: "not-authorized-by-packet" as const,
    },
  ];

  const nextActions = decision === "sdk-in-process-candidate"
    ? [
      "Use SDK/in-process as the next diagnostic candidate, not as a replacement for subprocess.",
      "Keep subprocess as a first-class executor; mature it with startup diagnostics and/or a devcontainer/Linux canary before judging it unsuitable.",
      "Mature the worker rung on the current configured/recommended provider/model before treating alternate provider/model canaries as separate explicit experiments with fresh route/budget evidence.",
      "Require exact runId confirmation before either executor starts a worker.",
    ]
    : decision === "subprocess-first"
      ? [
        "Continue with subprocess diagnostics until a classified blocker justifies SDK fallback.",
        exactConfirmationAvailable ? "Use exact runId confirmation for the next subprocess canary." : "Prepare packet only; wait for exact runId confirmation before dispatch.",
      ]
      : ["Resolve blockers before selecting an executor or preparing a canary."];

  const summary = [
    "agent-run-executor-strategy-packet:",
    `decision=${decision}`,
    `preferred=${preferredExecutor}`,
    `subprocessRetained=${executorPosture.subprocessRetained ? "yes" : "no"}`,
    `sdkReplacement=${executorPosture.sdkIsReplacement ? "yes" : "no"}`,
    `subprocessBlindRetry=${executorPosture.subprocessBlindRetryAllowed ? "yes" : "no"}`,
    `failureClass=${failureClass}`,
    `subprocessDiagnostics=${subprocessDiagnosticsAvailable ? "yes" : "no"}`,
    `sdkRuntime=${sdkRuntimeAvailable ? "yes" : "no"}`,
    `runtime=${runtimeMode}`,
    devcontainerAvailable ? "devcontainerAvailable=yes" : undefined,
    requiresProcessIsolation ? "requiresProcessIsolation=yes" : undefined,
    requiresDirectEventStream ? "requiresDirectEventStream=yes" : undefined,
    "trustLadder=ooda",
    mutationRequested ? "mutationRequested=yes" : undefined,
    unexpectedDirty ? "unexpectedDirty=yes" : undefined,
    blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    "dispatch=no",
    "authorization=none",
  ].filter(Boolean).join(" ");

  return {
    mode: "agent-run-executor-strategy-packet",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    processStartAllowed: false,
    decision,
    recommendationCode,
    preferredExecutor,
    nextProbeExecutor,
    supportedExecutors: ["pi-print-subprocess", "pi-sdk-in-process"],
    executorPosture,
    selectionSignals,
    selectionRationale,
    trustLadder,
    executorContracts,
    blockers,
    nextActions,
    summary,
  };
}
