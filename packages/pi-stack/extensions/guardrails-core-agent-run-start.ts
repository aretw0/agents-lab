import { resolveProviderExecutionBudgetEvidence, type ProviderExecutionBudgetDecision } from "./guardrails-core-provider-budget-evidence";

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
  economyMode?: AgentInvocationEconomyMode | string;
  tokenBudgetEvidence?: string;
  maxOutputLines?: number;
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
  humanConfirmationPhrase: string;
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
  recommendationCode: AgentRunStartPacketResult["recommendationCode"] | "agent-invocation-spec-blocked-profile" | "agent-invocation-spec-blocked-validation" | "agent-invocation-spec-blocked-rollback" | "agent-invocation-spec-blocked-economy";
  blockers: string[];
  invocationSpec: AgentRunOperatorPacketResult["runSpec"] & {
    profile: AgentInvocationProfile | "unknown";
    validation: string[];
    rollback: string[];
    outputSchema?: string;
    outputContract: "non-empty-text" | "structured-schema";
    executionPreview: AgentRunStartPacketResult["commandPreview"];
  };
  operatorPacket: AgentRunOperatorPacketResult;
  nextActions: string[];
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

function normalizeInvocationProfile(value: unknown): AgentInvocationProfile | "unknown" {
  return value === "read-only-review" || value === "small-mutation" || value === "test-fix" || value === "research" ? value : "unknown";
}

function normalizeEconomyMode(value: unknown): AgentInvocationEconomyMode {
  return value === "standard" || value === "critical" || value === "conserve" ? value : "conserve";
}

function normalizeMaxOutputLines(value: unknown, mode: AgentInvocationEconomyMode): number {
  const fallback = mode === "critical" ? 20 : mode === "conserve" ? 40 : 80;
  const requested = normalizePositiveInt(value, fallback);
  return Math.max(5, Math.min(120, requested || fallback));
}

function buildEconomyInstructions(mode: AgentInvocationEconomyMode, maxOutputLines: number): string[] {
  const base = [
    "use only declared files unless the parent explicitly expands scope",
    "avoid broad scans, dependency installs, remote calls, and repeated context restatement",
    `keep final output concise: <=${maxOutputLines} lines unless reporting a hard blocker`,
    "prefer exact file/line evidence over narrative explanation",
    "stop and report missing context instead of exploring outside the declared scope",
  ];
  return mode === "standard" ? base.slice(0, 3) : base;
}

function buildEconomyGoalPrefix(mode: AgentInvocationEconomyMode, maxOutputLines: number, tokenBudgetEvidence: string): string {
  const evidence = tokenBudgetEvidence ? ` Token budget evidence: ${tokenBudgetEvidence}.` : "";
  return `Worker economy contract (${mode}): use declared files only; avoid broad scans; avoid restating context; keep output <=${maxOutputLines} lines.${evidence}`;
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
    humanConfirmationPhrase: startPacket.humanConfirmationPhrase,
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
      executionPreview: operatorPacket.startPacket.commandPreview,
    },
    operatorPacket,
    nextActions: decision === "ready-for-human-decision"
      ? [
          "ask for the exact human confirmation phrase before execution",
          "registry-upsert running before invoking the execution preview",
          "execute through the typed invocation spec instead of hand-assembling argv",
          "preserve the economy contract in the worker prompt and reject output that ignores declared-file/output-line limits",
          "after exit, evaluate agent_run_outcome_packet with the declared file contract",
        ]
      : ["resolve invocation spec blockers before any dispatch"],
    humanConfirmationPhrase: operatorPacket.humanConfirmationPhrase,
    summary: [
      "agent-invocation-spec-packet:",
      `decision=${decision}`,
      `profile=${profile}`,
      `runId=${operatorPacket.runSpec.runId || "unknown"}`,
      `fileContract=${fileContract}`,
      `files=${operatorPacket.runSpec.declaredFiles.length}`,
      `budget=${operatorPacket.runSpec.budgetDecision}`,
      `economy=${operatorPacket.runSpec.economyMode}`,
      "dispatch=no",
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    ].filter(Boolean).join(" "),
  };
}
