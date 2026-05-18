import { buildAgentRunAbortPlan, buildAgentRunOutcomePacket, buildAgentRunRegistryUpsertPacket, buildAgentRunStatus, type AgentRunRegistryEntry } from "./guardrails-core-agent-run-runtime";
import {
  buildTaskPacketGoal,
  buildTaskRollback,
  buildTaskValidationChecklist,
  detectProtectedAgentTaskScope,
  detectRawBoardAgentTaskScope,
} from "./guardrails-core-agent-run-task-packet-helpers";
import { buildEconomyGoalPrefix, buildEconomyInstructions, normalizeEconomyMode, normalizeMaxOutputLines } from "./guardrails-core-agent-run-worker-economy";
import { resolveProviderExecutionBudgetEvidence, type ProviderExecutionBudgetDecision } from "./guardrails-core-provider-budget-evidence";
import { buildToolkitContract, type ToolkitCapability, type ToolkitContractProfile, type ToolkitContractResult } from "./guardrails-core-toolkit-contract";

export type AgentRunExecutorKind = "pi-print-subprocess";
export type AgentRunStartDecision = "ready-for-human-decision" | "blocked";
export type AgentRunBudgetDecision = ProviderExecutionBudgetDecision;
export type AgentRunOperatorFileContract = "read-only" | "mutation";
export type AgentInvocationProfile = "read-only-review" | "small-mutation" | "test-fix" | "research";
export type AgentInvocationEconomyMode = "standard" | "conserve" | "critical";

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
  profile?: ToolkitContractProfile | string;
  requiredCapabilities?: ToolkitCapability[];
  availableTools?: string[];
  validationGateKnown?: boolean;
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
    | "agent-run-start-blocked-toolkit"
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
    toolkitContract?: ToolkitContractResult["contract"] & { blockers: string[]; decision: ToolkitContractResult["decision"] };
  };
  commandPreview: {
    command: "pi";
    args: string[];
    shellInterpolationAllowed: false;
  };
  operatorApprovalPrompt: string;
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
  economyMode?: AgentInvocationEconomyMode | string;
  tokenBudgetEvidence?: string;
  maxOutputLines?: number;
  extensionIsolation?: "minimal-no-extensions" | "inherit" | string;
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
    economyMode: AgentInvocationEconomyMode;
    tokenBudgetEvidence: string;
    maxOutputLines: number;
    economyInstructions: string[];
  };
  startPacket: AgentRunStartPacketResult;
  validationChecklist: string[];
  rollbackHint: string;
  operatorApprovalPrompt: string;
  summary: string;
}

export interface AgentInvocationSpecPacketInput extends AgentRunOperatorPacketInput {
  profile?: AgentInvocationProfile | string;
  validation?: string[];
  rollback?: string[];
  outputSchema?: string;
}

export interface AgentInvocationSpecPacketResult {
  mode: "agent-invocation-spec-packet";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  processStartAllowed: false;
  requiresHumanDecision: true;
  singleRunOnly: true;
  decision: AgentRunStartDecision;
  recommendationCode: AgentRunStartPacketResult["recommendationCode"] | "agent-invocation-spec-blocked-profile" | "agent-invocation-spec-blocked-validation" | "agent-invocation-spec-blocked-rollback" | "agent-invocation-spec-blocked-economy" | "agent-invocation-spec-blocked-toolkit";
  blockers: string[];
  invocationSpec: AgentRunOperatorPacketResult["runSpec"] & {
    profile: AgentInvocationProfile | "unknown";
    validation: string[];
    rollback: string[];
    outputSchema?: string;
    outputContract: "non-empty-text" | "structured-schema";
    toolkitContract: ToolkitContractResult["contract"] & { blockers: string[]; decision: ToolkitContractResult["decision"] };
    executionPreview: AgentRunStartPacketResult["commandPreview"];
  };
  operatorPacket: AgentRunOperatorPacketResult;
  nextActions: string[];
  operatorApprovalPrompt: string;
  summary: string;
}

export interface AgentRunTaskPacketTaskLike {
  id?: string;
  description?: string;
  status?: string;
  notes?: string;
  files?: string[];
  acceptance_criteria?: string[];
}

export interface AgentRunTaskPacketInput {
  taskId?: string;
  task?: AgentRunTaskPacketTaskLike;
  purpose?: string;
  profile?: AgentInvocationProfile | string;
  providerModelRef?: string;
  cwd?: string;
  timeoutMs?: number;
  budgetDecision?: AgentRunBudgetDecision | string;
  budgetEvidence?: string;
  budgetEvidenceSource?: "route-advisory" | "provider-budget-snapshot" | "manual" | "unknown" | string;
  budgetEvidenceProvider?: string;
  budgetEvidenceGeneratedAtIso?: string;
  budgetEvidenceMaxAgeMs?: number;
  economyMode?: AgentInvocationEconomyMode | string;
  tokenBudgetEvidence?: string;
  maxOutputLines?: number;
  extensionIsolation?: "minimal-no-extensions" | "inherit" | string;
  protectedScopeRequested?: boolean;
}

export interface AgentRunTaskPacketResult {
  mode: "agent-run-task-packet";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  requiresHumanDecision: true;
  singleRunOnly: true;
  decision: AgentRunStartDecision;
  recommendationCode:
    | AgentInvocationSpecPacketResult["recommendationCode"]
    | "agent-run-task-blocked-task-id"
    | "agent-run-task-blocked-task-missing"
    | "agent-run-task-blocked-task-completed"
    | "agent-run-task-blocked-files"
    | "agent-run-task-blocked-acceptance-criteria"
    | "agent-run-task-blocked-protected-scope";
  blockers: string[];
  task: {
    id: string;
    found: boolean;
    status: string;
    description: string;
    files: string[];
    acceptanceCriteria: string[];
    protectedScopeDetected: boolean;
    rawBoardScopeDetected: boolean;
  };
  invocationSpecPacket: AgentInvocationSpecPacketResult;
  invocationSpec: AgentInvocationSpecPacketResult["invocationSpec"];
  validationChecklist: string[];
  rollback: string[];
  operatorApprovalPrompt: string;
  nextActions: string[];
  summary: string;
}

export interface AgentRunTaskStartPacketInput extends AgentRunTaskPacketInput {
  existingEntry?: AgentRunRegistryEntry;
}

export interface AgentRunTaskStartPacketResult {
  mode: "agent-run-task-start-packet";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  requiresHumanDecision: true;
  singleRunOnly: true;
  decision: AgentRunStartDecision;
  recommendationCode:
    | AgentRunTaskPacketResult["recommendationCode"]
    | "agent-run-task-start-blocked-task-packet";
  blockers: string[];
  taskPacket: AgentRunTaskPacketResult;
  registryPreview: ReturnType<typeof buildAgentRunRegistryUpsertPacket>;
  startPreview: AgentRunStartPacketResult["commandPreview"];
  statusPreview: ReturnType<typeof buildAgentRunStatus>;
  logTailPreview: {
    runId: string;
    logPath?: string;
    maxLines: number;
    readOnly: true;
  };
  abortPreview: ReturnType<typeof buildAgentRunAbortPlan>;
  outcomeChecklist: string[];
  operatorApprovalPrompt: string;
  nextActions: string[];
  summary: string;
}

export type CodexSparkPromotedEnvelope =
  | "readonly-one-file"
  | "readonly-two-file-synthesis"
  | "readonly-one-symbol-review"
  | "failure-contract"
  | "readonly-three-file-inventory"
  | "readonly-ci-cache-risk-scan"
  | "readonly-monitor-fragility-hardening-scan"
  | "readonly-declared-evidence-synthesis"
  | "readonly-source-backed-evidence-synthesis"
  | "mutation-one-file-marker";

export interface CodexSparkPromotedWorkerPacketInput extends AgentRunTaskStartPacketInput {
  envelope?: CodexSparkPromotedEnvelope | string;
}

export interface CodexSparkPromotedWorkerPacketResult {
  mode: "codex-spark-promoted-worker-packet";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  requiresHumanDecision: true;
  singleRunOnly: true;
  providerModelRef: "openai-codex/gpt-5.3-codex-spark";
  envelope: string;
  promotion: "promoted" | "blocked";
  decision: AgentRunStartDecision;
  recommendationCode: AgentRunTaskStartPacketResult["recommendationCode"] | "codex-spark-promoted-worker-blocked-envelope";
  blockers: string[];
  promotedEnvelopes: CodexSparkPromotedEnvelope[];
  taskStartPacket: AgentRunTaskStartPacketResult;
  naturalUseContract: string[];
  stillBlocked: string[];
  operatorApprovalPrompt: string;
  nextActions: string[];
  summary: string;
}

const AGENT_RUN_START_TIMEOUT_MIN_MS = 5_000;
const AGENT_RUN_START_TIMEOUT_MAX_MS = 180_000;
const READ_ONLY_TOOL_ALLOWLIST = ["read", "grep", "find", "ls"];
const MUTATION_TOOL_ALLOWLIST = [...READ_ONLY_TOOL_ALLOWLIST, "edit", "write"];
const SUPPORTED_AGENT_RUN_TOOL_ALLOWLIST = [...MUTATION_TOOL_ALLOWLIST];
const CODEX_SPARK_PROVIDER_MODEL_REF = "openai-codex/gpt-5.3-codex-spark" as const;
const CODEX_SPARK_PROMOTED_ENVELOPES: CodexSparkPromotedEnvelope[] = [
  "readonly-one-file",
  "readonly-two-file-synthesis",
  "readonly-one-symbol-review",
  "failure-contract",
  "readonly-three-file-inventory",
  "readonly-ci-cache-risk-scan",
  "readonly-monitor-fragility-hardening-scan",
  "readonly-declared-evidence-synthesis",
  "readonly-source-backed-evidence-synthesis",
  "mutation-one-file-marker",
];

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

function normalizeInvocationProfile(value: unknown): AgentInvocationProfile | "unknown" {
  return value === "read-only-review" || value === "small-mutation" || value === "test-fix" || value === "research" ? value : "unknown";
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

  // Build toolkit contract if profile or required capabilities are provided
  const toolkitContract = input.profile || input.requiredCapabilities || input.availableTools
    ? buildToolkitContract({
        profile: input.profile as ToolkitContractProfile,
        goal,
        requiredCapabilities: input.requiredCapabilities,
        availableTools: input.availableTools ?? toolAllowlist,
        declaredFiles,
        providerModelRef,
        validationGateKnown: input.validationGateKnown,
        purpose: "agent-run-start",
      })
    : undefined;

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
  const unsupportedTools = toolAllowlist.filter((tool) => !SUPPORTED_AGENT_RUN_TOOL_ALLOWLIST.includes(tool));
  if (unsupportedTools.length > 0) block("agent-run-start-blocked-tools", `unsupported-tools:${unsupportedTools.join(",")}`);
  if (sessionIsolation === "unknown") block("agent-run-start-blocked-session-isolation", "session-isolation-missing");
  if (extensionIsolation === "unknown") block("agent-run-start-blocked-extension-isolation", "extension-isolation-missing");
  if (!logPath) block("agent-run-start-blocked-log-path", "log-path-missing");
  for (const budgetBlocker of budget.blockers) block("agent-run-start-blocked-budget", budgetBlocker);

  // Add toolkit contract blockers if applicable
  if (toolkitContract && toolkitContract.decision === "blocked") {
    for (const blocker of toolkitContract.blockers) {
      block("agent-run-start-blocked-toolkit", `toolkit-contract:${blocker}`);
    }
  }

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
  const operatorApprovalPrompt = runId ? `approve worker ${runId}` : "approve worker <run-id>";

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
      ...(toolkitContract ? { toolkitContract: { ...toolkitContract.contract, blockers: toolkitContract.blockers, decision: toolkitContract.decision } } : {}),
    },
    commandPreview: {
      command: "pi",
      args: commandArgs,
      shellInterpolationAllowed: false,
    },
    operatorApprovalPrompt,
    nextActions: decision === "ready-for-human-decision"
      ? [
          "present the structured operator approval packet before starting any worker",
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
  const economyMode = normalizeEconomyMode(input.economyMode);
  const maxOutputLines = normalizeMaxOutputLines(input.maxOutputLines, economyMode);
  const tokenBudgetEvidence = normalizeText(input.tokenBudgetEvidence || input.budgetEvidence);
  const economyInstructions = buildEconomyInstructions(economyMode, maxOutputLines);
  const goal = normalizeText(input.goal);
  const economyGoalPrefix = buildEconomyGoalPrefix(economyMode, maxOutputLines, tokenBudgetEvidence);
  const logPath = runId ? `.pi/reports/${runId}.log` : "";
  const startPacket = buildAgentRunStartPacket({
    runId,
    executorKind: "pi-print-subprocess",
    goal: goal ? `${economyGoalPrefix}\n\n${goal}` : economyGoalPrefix,
    providerModelRef: input.providerModelRef,
    cwd: input.cwd,
    declaredFiles: input.declaredFiles,
    timeoutMs: normalizePositiveInt(input.timeoutMs, 90_000),
    toolAllowlist: fileContract === "mutation" ? MUTATION_TOOL_ALLOWLIST : READ_ONLY_TOOL_ALLOWLIST,
    sessionIsolation: "no-session",
    extensionIsolation: input.extensionIsolation ?? "minimal-no-extensions",
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
    `worker economy contract must keep output <=${maxOutputLines} lines and use declared files only`,
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
      economyMode,
      tokenBudgetEvidence,
      maxOutputLines,
      economyInstructions,
    },
    startPacket,
    validationChecklist,
    rollbackHint: fileContract === "read-only" ? "read-only run: rollback is registry/log cleanup only; no file mutations expected" : "mutation run: rollback only declared/touched files after parent-side review",
    operatorApprovalPrompt: startPacket.operatorApprovalPrompt,
    summary: [
      "agent-run-operator-packet:",
      `decision=${startPacket.decision}`,
      `runId=${startPacket.runSpec.runId || "unknown"}`,
      `files=${startPacket.runSpec.declaredFiles.length}`,
      `fileContract=${fileContract}`,
      "attachment=attach-declared-files",
      `budget=${startPacket.runSpec.budgetDecision}`,
      `economy=${economyMode}`,
      "dispatch=no",
      startPacket.blockers.length > 0 ? `blockers=${startPacket.blockers.join("|")}` : undefined,
    ].filter(Boolean).join(" "),
  };
}

export function buildAgentInvocationSpecPacket(input: AgentInvocationSpecPacketInput = {}): AgentInvocationSpecPacketResult {
  const profile = normalizeInvocationProfile(input.profile ?? "read-only-review");
  const validation = normalizeStringArray(input.validation);
  const rollback = normalizeStringArray(input.rollback);
  const outputSchema = normalizeText(input.outputSchema);
  const fileContract = normalizeFileContract(input.fileContract ?? (profile === "small-mutation" || profile === "test-fix" ? "mutation" : "read-only"));
  const operatorPacket = buildAgentRunOperatorPacket({
    ...input,
    fileContract,
  });
  const toolkitContract = buildToolkitContract({
    profile,
    goal: operatorPacket.runSpec.goal,
    availableTools: operatorPacket.runSpec.toolAllowlist,
    declaredFiles: operatorPacket.runSpec.declaredFiles,
    providerModelRef: operatorPacket.runSpec.providerModelRef,
    validationGateKnown: validation.length > 0,
    purpose: normalizeText(input.purpose) || "agent-invocation-spec",
  });
  const blockers = [...operatorPacket.blockers];
  let recommendationCode: AgentInvocationSpecPacketResult["recommendationCode"] = operatorPacket.recommendationCode;
  const block = (code: AgentInvocationSpecPacketResult["recommendationCode"], blocker: string) => {
    if (blockers.length === 0 || recommendationCode === operatorPacket.recommendationCode) recommendationCode = code;
    blockers.push(blocker);
  };

  if (profile === "unknown") block("agent-invocation-spec-blocked-profile", "profile-unsupported");
  if ((profile === "small-mutation" || profile === "test-fix") && validation.length === 0) block("agent-invocation-spec-blocked-validation", "validation-required-for-mutation-profile");
  if ((profile === "small-mutation" || profile === "test-fix") && rollback.length === 0) block("agent-invocation-spec-blocked-rollback", "rollback-required-for-mutation-profile");
  if (operatorPacket.runSpec.budgetDecision === "warn" && operatorPacket.runSpec.economyMode === "standard") block("agent-invocation-spec-blocked-economy", "economy-contract-required-for-warn-budget");
  if (toolkitContract.decision === "blocked") {
    for (const blocker of toolkitContract.blockers) block("agent-invocation-spec-blocked-toolkit", `toolkit-contract:${blocker}`);
  }

  const decision: AgentRunStartDecision = blockers.length === 0 ? "ready-for-human-decision" : "blocked";
  if (decision === "ready-for-human-decision") recommendationCode = "agent-run-start-ready-for-human-decision";

  return {
    mode: "agent-invocation-spec-packet",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    processStartAllowed: false,
    requiresHumanDecision: true,
    singleRunOnly: true,
    decision,
    recommendationCode,
    blockers,
    invocationSpec: {
      ...operatorPacket.runSpec,
      profile,
      validation,
      rollback,
      ...(outputSchema ? { outputSchema } : {}),
      outputContract: outputSchema ? "structured-schema" : "non-empty-text",
      toolkitContract: { ...toolkitContract.contract, blockers: toolkitContract.blockers, decision: toolkitContract.decision },
      executionPreview: operatorPacket.startPacket.commandPreview,
    },
    operatorPacket,
    nextActions: decision === "ready-for-human-decision"
      ? [
          "present the structured operator approval packet before execution",
          "registry-upsert running before invoking the execution preview",
          "execute through the typed invocation spec instead of hand-assembling argv",
          "preserve the economy contract in the worker prompt and reject output that ignores declared-file/output-line limits",
          "after exit, evaluate agent_run_outcome_packet with the declared file contract",
        ]
      : ["resolve invocation spec blockers before any dispatch"],
    operatorApprovalPrompt: operatorPacket.operatorApprovalPrompt,
    summary: [
      "agent-invocation-spec-packet:",
      `decision=${decision}`,
      `profile=${profile}`,
      `runId=${operatorPacket.runSpec.runId || "unknown"}`,
      `fileContract=${fileContract}`,
      `files=${operatorPacket.runSpec.declaredFiles.length}`,
      `budget=${operatorPacket.runSpec.budgetDecision}`,
      `economy=${operatorPacket.runSpec.economyMode}`,
      `toolkit=${toolkitContract.decision}`,
      "dispatch=no",
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    ].filter(Boolean).join(" "),
  };
}

export function buildAgentRunTaskPacket(input: AgentRunTaskPacketInput = {}): AgentRunTaskPacketResult {
  const taskId = normalizeText(input.taskId || input.task?.id);
  const task = input.task;
  const taskFound = !!task && normalizeText(task.id) === taskId;
  const status = normalizeText(task?.status) || "unknown";
  const description = normalizeText(task?.description);
  const files = normalizeStringArray(task?.files);
  const acceptanceCriteria = normalizeStringArray(task?.acceptance_criteria);
  const rawBoardScopeDetected = detectRawBoardAgentTaskScope(files);
  const protectedScopeDetected = input.protectedScopeRequested === true || detectProtectedAgentTaskScope(files, description);
  const validationChecklist = buildTaskValidationChecklist(taskId || "<task-id>", acceptanceCriteria, files);
  const rollback = buildTaskRollback(files);
  const profile = normalizeInvocationProfile(input.profile ?? "small-mutation");
  const invocationSpecPacket = buildAgentInvocationSpecPacket({
    taskId,
    purpose: normalizeText(input.purpose) || "task-packet",
    profile,
    goal: task ? buildTaskPacketGoal({ ...task, id: taskId }, acceptanceCriteria) : "Board task missing; do not execute.",
    providerModelRef: input.providerModelRef,
    cwd: input.cwd,
    declaredFiles: files,
    timeoutMs: input.timeoutMs,
    fileContract: profile === "read-only-review" || profile === "research" ? "read-only" : "mutation",
    validation: validationChecklist,
    rollback,
    outputSchema: "PASS|FAIL with filesTouched, validationEvidence, blockers",
    budgetDecision: input.budgetDecision,
    budgetEvidence: input.budgetEvidence,
    budgetEvidenceSource: input.budgetEvidenceSource,
    budgetEvidenceProvider: input.budgetEvidenceProvider,
    budgetEvidenceGeneratedAtIso: input.budgetEvidenceGeneratedAtIso,
    budgetEvidenceMaxAgeMs: input.budgetEvidenceMaxAgeMs,
    economyMode: input.economyMode ?? "critical",
    tokenBudgetEvidence: input.tokenBudgetEvidence || input.budgetEvidence,
    maxOutputLines: input.maxOutputLines ?? 20,
    extensionIsolation: input.extensionIsolation,
    protectedScopeRequested: protectedScopeDetected,
  });
  const blockers = [...invocationSpecPacket.blockers];
  let recommendationCode: AgentRunTaskPacketResult["recommendationCode"] = invocationSpecPacket.recommendationCode;
  const block = (code: AgentRunTaskPacketResult["recommendationCode"], blocker: string) => {
    if (blockers.length === 0 || recommendationCode === invocationSpecPacket.recommendationCode) recommendationCode = code;
    if (!blockers.includes(blocker)) blockers.push(blocker);
  };

  if (!taskId) block("agent-run-task-blocked-task-id", "task-id-missing");
  if (!taskFound) block("agent-run-task-blocked-task-missing", "task-not-found");
  if (status === "completed") block("agent-run-task-blocked-task-completed", "task-already-completed");
  if (files.length === 0) block("agent-run-task-blocked-files", "task-files-missing");
  if (rawBoardScopeDetected) block("agent-run-task-blocked-files", "raw-board-state-file-declared-use-derived-board-packet");
  if (acceptanceCriteria.length === 0) block("agent-run-task-blocked-acceptance-criteria", "task-acceptance-criteria-missing");
  if (protectedScopeDetected) block("agent-run-task-blocked-protected-scope", "protected-scope-requested");

  const decision: AgentRunStartDecision = blockers.length === 0 ? "ready-for-human-decision" : "blocked";
  if (decision === "ready-for-human-decision") recommendationCode = "agent-run-start-ready-for-human-decision";

  return {
    mode: "agent-run-task-packet",
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
    task: {
      id: taskId,
      found: taskFound,
      status,
      description,
      files,
      acceptanceCriteria,
      protectedScopeDetected,
      rawBoardScopeDetected,
    },
    invocationSpecPacket,
    invocationSpec: invocationSpecPacket.invocationSpec,
    validationChecklist,
    rollback,
    operatorApprovalPrompt: invocationSpecPacket.operatorApprovalPrompt,
    nextActions: decision === "ready-for-human-decision"
      ? [
          "show the typed invocation spec to the operator",
          "require structured operator approval before any dispatch",
          "if executed later, registry-upsert planned/running before subprocess start",
          "after exit, validate touched files, non-empty output, and acceptance criteria before board completion",
        ]
      : ["resolve task packet blockers before any worker dispatch"],
    summary: [
      "agent-run-task-packet:",
      `decision=${decision}`,
      `task=${taskId || "unknown"}`,
      `found=${taskFound ? "yes" : "no"}`,
      `status=${status}`,
      `files=${files.length}`,
      `criteria=${acceptanceCriteria.length}`,
      `budget=${invocationSpecPacket.invocationSpec.budgetDecision}`,
      `economy=${invocationSpecPacket.invocationSpec.economyMode}`,
      "dispatch=no",
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    ].filter(Boolean).join(" "),
  };
}

function normalizeCodexSparkPromotedEnvelope(value: unknown): CodexSparkPromotedEnvelope | "unknown" {
  const text = normalizeText(value) || "readonly-one-file";
  return CODEX_SPARK_PROMOTED_ENVELOPES.includes(text as CodexSparkPromotedEnvelope) ? text as CodexSparkPromotedEnvelope : "unknown";
}

function inferPromotedEnvelopeProfile(envelope: string): AgentInvocationProfile {
  return envelope.startsWith("mutation-") ? "small-mutation" : "read-only-review";
}

export function buildAgentRunTaskStartPacket(input: AgentRunTaskStartPacketInput = {}): AgentRunTaskStartPacketResult {
  const taskPacket = buildAgentRunTaskPacket(input);
  const spec = taskPacket.invocationSpec;
  const registryPreview = buildAgentRunRegistryUpsertPacket({
    runId: spec.runId,
    existingEntry: input.existingEntry,
    state: "planned",
    providerModelRef: spec.providerModelRef,
    cwd: spec.cwd,
    declaredFiles: spec.declaredFiles,
    logPath: spec.logPath,
    timeoutMs: spec.timeoutMs,
    dryRun: true,
  });
  const statusPreview = buildAgentRunStatus(spec.runId, input.existingEntry);
  const abortPreview = buildAgentRunAbortPlan({ runId: spec.runId, entry: input.existingEntry, cwdExpected: spec.cwd });
  const dryOutcomePreview = buildAgentRunOutcomePacket({
    runId: spec.runId,
    entry: input.existingEntry ?? registryPreview.entry,
    touchedFiles: [],
    markerResults: [],
    fileContract: spec.fileContract,
  });
  const blockers = [...taskPacket.blockers, ...registryPreview.blockers];
  let recommendationCode: AgentRunTaskStartPacketResult["recommendationCode"] = taskPacket.recommendationCode;
  if (taskPacket.decision === "blocked" && !blockers.includes("task-packet-blocked")) {
    recommendationCode = "agent-run-task-start-blocked-task-packet";
    blockers.push("task-packet-blocked");
  }
  const decision: AgentRunStartDecision = blockers.length === 0 ? "ready-for-human-decision" : "blocked";
  if (decision === "ready-for-human-decision") recommendationCode = "agent-run-start-ready-for-human-decision";

  return {
    mode: "agent-run-task-start-packet",
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
    taskPacket,
    registryPreview,
    startPreview: spec.executionPreview,
    statusPreview,
    logTailPreview: {
      runId: spec.runId,
      logPath: spec.logPath,
      maxLines: 80,
      readOnly: true,
    },
    abortPreview,
    outcomeChecklist: [
      `expected file contract: ${spec.fileContract}`,
      "record processState separately from contractDecision",
      "fail contract on empty output even when exit code is zero",
      `touched files must be subset of: ${spec.declaredFiles.join(", ")}`,
      `dry outcome preview: ${dryOutcomePreview.summary}`,
    ],
    operatorApprovalPrompt: taskPacket.operatorApprovalPrompt,
    nextActions: decision === "ready-for-human-decision"
      ? [
          "show registry/start/status/log/abort/outcome previews to the operator",
          "require structured operator approval before any dispatch",
          "if confirmed later, write registry planned/running before subprocess start",
          "after exit, run outcome packet before any board completion",
        ]
      : ["resolve task-start packet blockers before any worker dispatch"],
    summary: [
      "agent-run-task-start-packet:",
      `decision=${decision}`,
      `task=${taskPacket.task.id || "unknown"}`,
      `runId=${spec.runId || "unknown"}`,
      `registry=${registryPreview.decision}`,
      `statusFound=${statusPreview.found ? "yes" : "no"}`,
      `budget=${spec.budgetDecision}`,
      "dispatch=no",
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    ].filter(Boolean).join(" "),
  };
}

export function buildCodexSparkPromotedWorkerPacket(input: CodexSparkPromotedWorkerPacketInput = {}): CodexSparkPromotedWorkerPacketResult {
  const requestedEnvelope = normalizeText(input.envelope) || "readonly-one-file";
  const promotedEnvelope = normalizeCodexSparkPromotedEnvelope(requestedEnvelope);
  const envelope = promotedEnvelope === "unknown" ? requestedEnvelope : promotedEnvelope;
  const taskStartPacket = buildAgentRunTaskStartPacket({
    ...input,
    purpose: input.purpose || `codex-spark-${envelope}`,
    profile: input.profile || inferPromotedEnvelopeProfile(envelope),
    providerModelRef: CODEX_SPARK_PROVIDER_MODEL_REF,
    budgetDecision: input.budgetDecision || "warn",
    budgetEvidence: input.budgetEvidence || `Codex Spark promoted worker lane: envelope ${envelope} has arena evidence for bounded use; structured operator approval is still required before dispatch.`,
    budgetEvidenceSource: input.budgetEvidenceSource || "manual",
    budgetEvidenceProvider: CODEX_SPARK_PROVIDER_MODEL_REF,
    economyMode: input.economyMode || "critical",
    tokenBudgetEvidence: input.tokenBudgetEvidence || input.budgetEvidence || "Codex Spark promoted lane; conserve output and stay within declared files.",
    maxOutputLines: input.maxOutputLines ?? 20,
  });
  const blockers = [...taskStartPacket.blockers];
  let recommendationCode: CodexSparkPromotedWorkerPacketResult["recommendationCode"] = taskStartPacket.recommendationCode;
  if (promotedEnvelope === "unknown") {
    blockers.push("codex-spark-envelope-not-promoted");
    recommendationCode = "codex-spark-promoted-worker-blocked-envelope";
  }
  const decision: AgentRunStartDecision = blockers.length === 0 ? "ready-for-human-decision" : "blocked";
  const promotion = promotedEnvelope === "unknown" ? "blocked" : "promoted";

  return {
    mode: "codex-spark-promoted-worker-packet",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    processStartAllowed: false,
    processStopAllowed: false,
    requiresHumanDecision: true,
    singleRunOnly: true,
    providerModelRef: CODEX_SPARK_PROVIDER_MODEL_REF,
    envelope,
    promotion,
    decision,
    recommendationCode,
    blockers,
    promotedEnvelopes: [...CODEX_SPARK_PROMOTED_ENVELOPES],
    taskStartPacket,
    naturalUseContract: [
      "use Codex Spark by default for promoted local-safe envelopes instead of rebuilding arena packets manually",
      "keep dispatch structured-approved and single-run only",
      "keep declared files, bounded timeout, rollback, and parent-side outcome validation",
      "record outcome evidence before expanding the envelope or closing the task",
    ],
    stillBlocked: [
      "protected-scope mutation without explicit authorization",
      "multi-file mutation beyond declared files",
      "autonomous web research",
      "swarm/fan-out or unbounded retry loops",
      "settings/routing/default-provider changes",
    ],
    operatorApprovalPrompt: taskStartPacket.operatorApprovalPrompt,
    nextActions: decision === "ready-for-human-decision"
      ? [
          "use this promoted packet instead of an arena canary for the next bounded Codex Spark worker",
          "require structured operator approval before dispatch",
          "after execution, evaluate the outcome packet and append board evidence",
        ]
      : ["resolve promoted-worker blockers before any dispatch"],
    summary: [
      "codex-spark-promoted-worker-packet:",
      `decision=${decision}`,
      `envelope=${envelope || "unknown"}`,
      `promotion=${promotion}`,
      `task=${taskStartPacket.taskPacket.task.id || "unknown"}`,
      "dispatch=no",
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    ].filter(Boolean).join(" "),
  };
}
