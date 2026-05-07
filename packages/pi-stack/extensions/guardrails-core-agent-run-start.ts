import { resolveProviderExecutionBudgetEvidence, type ProviderExecutionBudgetDecision } from "./guardrails-core-provider-budget-evidence";

export type AgentRunExecutorKind = "pi-print-subprocess";
export type AgentRunStartDecision = "ready-for-human-decision" | "blocked";
export type AgentRunBudgetDecision = ProviderExecutionBudgetDecision;
export type AgentRunOperatorFileContract = "read-only" | "mutation";

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
  extensionIsolation?: "minimal-no-extensions" | "inherit" | string;
  logPath?: string;
  budgetDecision?: AgentRunBudgetDecision | string;
  budgetEvidence?: string;
  budgetEvidenceSource?: "route-advisory" | "provider-budget-snapshot" | "manual" | "unknown" | string;
  budgetEvidenceProvider?: string;
  budgetEvidenceGeneratedAtIso?: string;
  budgetEvidenceMaxAgeMs?: number;
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
    | "agent-run-start-blocked-extension-isolation"
    | "agent-run-start-blocked-log-path"
    | "agent-run-start-blocked-budget"
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
    extensionIsolation: "minimal-no-extensions" | "inherit" | "unknown";
    logPath: string;
    budgetDecision: AgentRunBudgetDecision;
    budgetEvidence: string;
    budgetEvidenceSource: "route-advisory" | "provider-budget-snapshot" | "manual" | "unknown";
    budgetEvidenceProvider?: string;
    budgetEvidenceGeneratedAtIso?: string;
    budgetEvidenceFreshness: "fresh" | "stale" | "missing" | "not-required";
    budgetEvidenceConsistency: "consistent" | "mismatch" | "needs-human-review";
    budgetEvidenceHumanReviewRequired: boolean;
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

export interface AgentRunOperatorPacketInput {
  taskId?: string;
  runId?: string;
  purpose?: string;
  goal?: string;
  providerModelRef?: string;
  cwd?: string;
  declaredFiles?: string[];
  timeoutMs?: number;
  fileContract?: AgentRunOperatorFileContract | string;
  budgetDecision?: AgentRunBudgetDecision | string;
  budgetEvidence?: string;
  budgetEvidenceSource?: "route-advisory" | "provider-budget-snapshot" | "manual" | "unknown" | string;
  budgetEvidenceProvider?: string;
  budgetEvidenceGeneratedAtIso?: string;
  budgetEvidenceMaxAgeMs?: number;
  protectedScopeRequested?: boolean;
}

export interface AgentRunOperatorPacketResult {
  mode: "agent-run-operator-packet";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  requiresHumanDecision: true;
  singleRunOnly: true;
  decision: AgentRunStartDecision;
  recommendationCode: AgentRunStartPacketResult["recommendationCode"];
  blockers: string[];
  runSpec: AgentRunStartPacketResult["runSpec"] & {
    taskId: string;
    purpose: string;
    fileContract: AgentRunOperatorFileContract;
    attachmentMode: "attach-declared-files";
  };
  startPacket: AgentRunStartPacketResult;
  validationChecklist: string[];
  rollbackHint: string;
  humanConfirmationPhrase: string;
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

function normalizeExtensionIsolation(value: unknown): "minimal-no-extensions" | "inherit" | "unknown" {
  return value === "minimal-no-extensions" || value === "inherit" ? value : "unknown";
}

function normalizeFileContract(value: unknown): AgentRunOperatorFileContract {
  return value === "mutation" ? "mutation" : "read-only";
}

function sanitizeRunIdPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
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
  const extensionIsolation = normalizeExtensionIsolation(input.extensionIsolation ?? "minimal-no-extensions");
  const logPath = normalizeText(input.logPath);
  const budget = resolveProviderExecutionBudgetEvidence({
    budgetDecision: input.budgetDecision,
    budgetEvidence: input.budgetEvidence,
    budgetEvidenceSource: input.budgetEvidenceSource,
    budgetEvidenceProvider: input.budgetEvidenceProvider,
    budgetEvidenceGeneratedAtIso: input.budgetEvidenceGeneratedAtIso,
    providerModelRef,
    maxAgeMs: input.budgetEvidenceMaxAgeMs,
  });
  const budgetDecision = budget.decision;
  const budgetEvidence = budget.evidence;
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
  if (extensionIsolation === "unknown") block("agent-run-start-blocked-extension-isolation", "extension-isolation-missing");
  if (!logPath) block("agent-run-start-blocked-log-path", "log-path-missing");
  for (const budgetBlocker of budget.blockers) block("agent-run-start-blocked-budget", budgetBlocker);

  const commandArgs = [
    ...(sessionIsolation === "no-session" ? ["--no-session"] : ["--session-dir", `.pi/agent-runs/${runId || "unknown"}`]),
    ...(extensionIsolation === "minimal-no-extensions" ? ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files"] : []),
    "--model",
    providerModelRef || "provider/model-required",
    "--tools",
    toolAllowlist.join(","),
    "--print",
    ...declaredFiles.map((file) => `@${file}`),
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
      extensionIsolation,
      logPath,
      budgetDecision,
      budgetEvidence,
      budgetEvidenceSource: budget.source,
      ...(budget.provider ? { budgetEvidenceProvider: budget.provider } : {}),
      ...(budget.generatedAtIso ? { budgetEvidenceGeneratedAtIso: budget.generatedAtIso } : {}),
      budgetEvidenceFreshness: budget.freshness,
      budgetEvidenceConsistency: budget.consistency,
      budgetEvidenceHumanReviewRequired: budget.humanReviewRequired,
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
          budget.humanReviewRequired
            ? "budget evidence is manual/unknown; get explicit human review or prefer a fresh route-advisory/provider-budget snapshot before invocation"
            : "preserve fresh structured provider/model budget evidence with the run record before invocation",
          "prefer minimal-no-extensions isolation for provider-native workers unless a custom provider requires inherited extensions",
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
      `ext=${extensionIsolation}`,
      `budget=${budgetDecision}`,
      `budgetSource=${budget.source}`,
      `budgetFreshness=${budget.freshness}`,
      `budgetConsistency=${budget.consistency}`,
      `dispatch=no`,
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    ].filter(Boolean).join(" "),
  };
}

export function buildAgentRunOperatorPacket(input: AgentRunOperatorPacketInput = {}): AgentRunOperatorPacketResult {
  const taskId = normalizeText(input.taskId);
  const purpose = normalizeText(input.purpose) || "provider-native-run";
  const derivedRunId = taskId ? sanitizeRunIdPart(`${taskId}-${purpose}`) : "";
  const runId = normalizeText(input.runId) || derivedRunId;
  const fileContract = normalizeFileContract(input.fileContract);
  const logPath = runId ? `.pi/reports/${runId}.log` : "";
  const startPacket = buildAgentRunStartPacket({
    runId,
    executorKind: "pi-print-subprocess",
    goal: input.goal,
    providerModelRef: input.providerModelRef,
    cwd: input.cwd,
    declaredFiles: input.declaredFiles,
    timeoutMs: normalizePositiveInt(input.timeoutMs, 90_000),
    toolAllowlist: READ_ONLY_TOOL_ALLOWLIST,
    sessionIsolation: "no-session",
    extensionIsolation: "minimal-no-extensions",
    logPath,
    budgetDecision: input.budgetDecision,
    budgetEvidence: input.budgetEvidence,
    budgetEvidenceSource: input.budgetEvidenceSource,
    budgetEvidenceProvider: input.budgetEvidenceProvider,
    budgetEvidenceGeneratedAtIso: input.budgetEvidenceGeneratedAtIso,
    budgetEvidenceMaxAgeMs: input.budgetEvidenceMaxAgeMs,
    protectedScopeRequested: input.protectedScopeRequested,
  });

  const validationChecklist = [
    "registry-upsert planned->running before execution and completed/failed after exit",
    "bounded log captured at runSpec.logPath",
    "process exit state recorded separately from contractDecision",
    "output_bytes must be greater than zero",
    fileContract === "read-only" ? "agent_run_outcome_packet must use file_contract=read-only" : "mutation run must declare and validate touched files",
    "parent markers should include PASS/FAIL verdict and stale-extension-error count",
  ];

  return {
    mode: "agent-run-operator-packet",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    processStartAllowed: false,
    processStopAllowed: false,
    requiresHumanDecision: true,
    singleRunOnly: true,
    decision: startPacket.decision,
    recommendationCode: startPacket.recommendationCode,
    blockers: startPacket.blockers,
    runSpec: {
      ...startPacket.runSpec,
      taskId,
      purpose,
      fileContract,
      attachmentMode: "attach-declared-files",
    },
    startPacket,
    validationChecklist,
    rollbackHint: fileContract === "read-only" ? "read-only run: rollback is registry/log cleanup only; no file mutations expected" : "mutation run: rollback only declared/touched files after parent-side review",
    humanConfirmationPhrase: startPacket.humanConfirmationPhrase,
    summary: [
      "agent-run-operator-packet:",
      `decision=${startPacket.decision}`,
      `runId=${startPacket.runSpec.runId || "unknown"}`,
      `files=${startPacket.runSpec.declaredFiles.length}`,
      `fileContract=${fileContract}`,
      "attachment=attach-declared-files",
      `budget=${startPacket.runSpec.budgetDecision}`,
      "dispatch=no",
      startPacket.blockers.length > 0 ? `blockers=${startPacket.blockers.join("|")}` : undefined,
    ].filter(Boolean).join(" "),
  };
}
