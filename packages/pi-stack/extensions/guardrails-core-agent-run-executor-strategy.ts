export type AgentRunExecutorStrategyDecision = "subprocess-first" | "sdk-in-process-candidate" | "blocked";
export type AgentRunExecutorStrategyKind = "pi-print-subprocess" | "pi-sdk-in-process";

export interface AgentRunExecutorStrategyInput {
  failureClass?: string;
  subprocessDiagnosticsAvailable?: boolean;
  sdkRuntimeAvailable?: boolean;
  budgetDecision?: string;
  protectedScopeRequested?: boolean;
  exactConfirmationAvailable?: boolean;
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
  supportedExecutors: AgentRunExecutorStrategyKind[];
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

export function buildAgentRunExecutorStrategyPacket(input: AgentRunExecutorStrategyInput = {}): AgentRunExecutorStrategyPacketResult {
  const failureClass = cleanText(input.failureClass || "unknown");
  const budgetDecision = cleanText(input.budgetDecision || "unknown");
  const blockers: string[] = [];
  if (input.protectedScopeRequested) blockers.push("protected-scope-requested");
  if (budgetDecision === "blocked" || budgetDecision === "unknown" || !budgetDecision) blockers.push(`budget-${budgetDecision || "unknown"}`);

  const subprocessDiagnosticsAvailable = input.subprocessDiagnosticsAvailable === true;
  const sdkRuntimeAvailable = input.sdkRuntimeAvailable === true;
  const exactConfirmationAvailable = input.exactConfirmationAvailable === true;
  const silentSubprocessFailure = failureClass === "silent-runner-failure";

  let decision: AgentRunExecutorStrategyDecision = "subprocess-first";
  let preferredExecutor: AgentRunExecutorStrategyKind = "pi-print-subprocess";
  let recommendationCode: AgentRunExecutorStrategyPacketResult["recommendationCode"] = "agent-run-executor-strategy-subprocess-first";

  if (blockers.length > 0) {
    decision = "blocked";
    recommendationCode = "agent-run-executor-strategy-blocked";
  } else if (silentSubprocessFailure && subprocessDiagnosticsAvailable && sdkRuntimeAvailable) {
    decision = "sdk-in-process-candidate";
    preferredExecutor = "pi-sdk-in-process";
    recommendationCode = "agent-run-executor-strategy-sdk-candidate";
  }

  const executorContracts = [
    {
      executor: "pi-print-subprocess" as const,
      purpose: "isolated CLI worker with argv/log/registry/outcome evidence",
      requiredEvidence: ["argv", "cwd", "command-source", "exit-code", "stdout-bytes", "stderr-bytes", "timeout", "registry-state"],
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
      "Implement an SDK/in-process packet and canary as a separate local-safe slice.",
      "Keep subprocess as a supported executor; do not replace it with SDK-only behavior.",
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
    `failureClass=${failureClass}`,
    `subprocessDiagnostics=${subprocessDiagnosticsAvailable ? "yes" : "no"}`,
    `sdkRuntime=${sdkRuntimeAvailable ? "yes" : "no"}`,
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
    supportedExecutors: ["pi-print-subprocess", "pi-sdk-in-process"],
    executorContracts,
    blockers,
    nextActions,
    summary,
  };
}
