import { resolveProviderExecutionBudgetEvidence, type ProviderExecutionBudgetDecision } from "./guardrails-core-provider-budget-evidence";
import { findUnsupportedDeclaredFileScopedSdkWorkerTools } from "./guardrails-core-tool-policy";

export type AgentRunSdkSessionMode = "in-memory" | "run-session-dir" | "unknown";
export type AgentRunSdkPacketDecision = "ready-for-human-decision" | "blocked";
export type AgentRunSdkFileContract = "read-only" | "mutation" | "unknown";
export type AgentRunSdkMaturityRung =
  | "validated-narrow-readgrep"
  | "needs-evidence-broad-readonly"
  | "needs-evidence-code-review"
  | "needs-evidence-mutation"
  | "blocked";

export interface AgentRunSdkInProcessPacketInput {
  runId?: string;
  goal?: string;
  providerModelRef?: string;
  cwd?: string;
  declaredFiles?: string[];
  timeoutMs?: number;
  toolAllowlist?: string[];
  sessionMode?: string;
  fileContract?: string;
  validationGateKnown?: boolean;
  rollbackPlanKnown?: boolean;
  budgetDecision?: ProviderExecutionBudgetDecision | string;
  budgetEvidence?: string;
  budgetEvidenceSource?: "route-advisory" | "provider-budget-snapshot" | "manual" | "unknown" | string;
  budgetEvidenceProvider?: string;
  budgetEvidenceGeneratedAtIso?: string;
  budgetEvidenceMaxAgeMs?: number;
  abortKnown?: boolean;
  eventStreamKnown?: boolean;
  finalOutputContractKnown?: boolean;
  protectedScopeRequested?: boolean;
  unexpectedDirty?: boolean;
}

export interface AgentRunSdkInProcessPacketResult {
  mode: "agent-run-sdk-in-process-packet";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  requiresHumanDecision: true;
  singleRunOnly: true;
  executorKind: "pi-sdk-in-process";
  decision: AgentRunSdkPacketDecision;
  recommendationCode:
    | "agent-run-sdk-ready-for-human-decision"
    | "agent-run-sdk-blocked-run-id"
    | "agent-run-sdk-blocked-goal"
    | "agent-run-sdk-blocked-provider-model"
    | "agent-run-sdk-blocked-cwd"
    | "agent-run-sdk-blocked-files"
    | "agent-run-sdk-blocked-timeout"
    | "agent-run-sdk-blocked-tools"
    | "agent-run-sdk-blocked-session-mode"
    | "agent-run-sdk-blocked-validation"
    | "agent-run-sdk-blocked-rollback"
    | "agent-run-sdk-blocked-budget"
    | "agent-run-sdk-blocked-abort"
    | "agent-run-sdk-blocked-event-stream"
    | "agent-run-sdk-blocked-final-output"
    | "agent-run-sdk-blocked-protected-scope"
    | "agent-run-sdk-blocked-dirty-state";
  blockers: string[];
  runSpec: {
    runId: string;
    goal: string;
    providerModelRef: string;
    cwd: string;
    declaredFiles: string[];
    timeoutMs: number;
    timeoutMinMs: number;
    timeoutMaxMs: number;
    toolAllowlist: string[];
    sessionMode: AgentRunSdkSessionMode;
    fileContract: AgentRunSdkFileContract;
    validationGateKnown: boolean;
    rollbackPlanKnown: boolean;
    budgetDecision: ProviderExecutionBudgetDecision;
    budgetEvidence: string;
    budgetEvidenceSource: "route-advisory" | "provider-budget-snapshot" | "manual" | "unknown";
    budgetEvidenceProvider?: string;
    budgetEvidenceGeneratedAtIso?: string;
    budgetEvidenceFreshness: "fresh" | "stale" | "missing" | "not-required";
    budgetEvidenceConsistency: "consistent" | "mismatch" | "needs-human-review";
    budgetEvidenceHumanReviewRequired: boolean;
    abortKnown: boolean;
    eventStreamKnown: boolean;
    finalOutputContractKnown: boolean;
    protectedScopeRequested: boolean;
    unexpectedDirty: boolean;
  };
  sdkMaturity: {
    rung: AgentRunSdkMaturityRung;
    validatedEnvelope: boolean;
    scope: "narrow" | "broad" | "none";
    maxDeclaredFilesValidated: number;
    supportedToolsValidated: string[];
    recommendation: string;
  };
  sdkPreview: {
    factory: "createAgentSession";
    authPattern: "AuthStorage.create + ModelRegistry.create";
    sessionPattern: "SessionManager.inMemory" | "SessionManager.create" | "unknown";
    modelSelection: string;
    toolSelection: string[];
    eventCapture: string[];
    abortContract: string[];
    finalOutputContract: string[];
    isolationNotes: string[];
  };
  humanConfirmationPhrase: string;
  nextActions: string[];
  rollbackHint: string;
  summary: string;
}

const SDK_TIMEOUT_MIN_MS = 5_000;
const SDK_TIMEOUT_MAX_MS = 180_000;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
}

function normalizePositiveInt(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function normalizeSessionMode(value: unknown): AgentRunSdkSessionMode {
  const text = normalizeText(value);
  if (text === "in-memory" || text === "run-session-dir") return text;
  return "unknown";
}

function normalizeFileContract(value: unknown): AgentRunSdkFileContract {
  const text = normalizeText(value);
  if (text === "read-only" || text === "mutation") return text;
  return "unknown";
}

function isCodeReviewGoal(goal: string): boolean {
  const lower = goal.toLowerCase();
  return lower.includes("code/test review")
    || lower.includes("code review")
    || lower.includes("recommended patch")
    || lower.includes("parent-side patch");
}

function hasOneFileOrSymbolCue(goal: string): boolean {
  const lower = goal.toLowerCase();
  return lower.includes("one target file")
    || lower.includes("one named symbol")
    || lower.includes("one-symbol")
    || lower.includes("focus only")
    || lower.includes("readynextactions")
    || lower.includes("buildsdkmaturity");
}

function buildSdkMaturity(input: {
  blocked: boolean;
  goal: string;
  declaredFiles: string[];
  toolAllowlist: string[];
  fileContract: AgentRunSdkFileContract;
}): AgentRunSdkInProcessPacketResult["sdkMaturity"] {
  const scope = input.declaredFiles.length === 0 ? "none" : input.declaredFiles.length <= 2 ? "narrow" : "broad";
  const toolsWithinValidatedEnvelope = input.toolAllowlist.length > 0 && input.toolAllowlist.every((tool) => tool === "read" || tool === "grep");
  const base = {
    scope,
    maxDeclaredFilesValidated: 2,
    supportedToolsValidated: ["read", "grep"],
  } as const;
  if (input.blocked) {
    return {
      ...base,
      rung: "blocked",
      validatedEnvelope: false,
      recommendation: "resolve packet blockers before using SDK maturity evidence",
    };
  }
  if (input.fileContract === "mutation") {
    return {
      ...base,
      rung: "needs-evidence-mutation",
      validatedEnvelope: false,
      recommendation: "keep mutation SDK workers behind separate validation, rollback, and exact-confirmation evidence",
    };
  }
  if (input.fileContract === "read-only" && scope === "narrow" && toolsWithinValidatedEnvelope) {
    if (input.declaredFiles.length > 1 && isCodeReviewGoal(input.goal) && !hasOneFileOrSymbolCue(input.goal)) {
      return {
        ...base,
        rung: "needs-evidence-code-review",
        validatedEnvelope: false,
        recommendation: "two-file open-ended code/test review is not validated; shrink to one target file or one named symbol before retrying",
      };
    }
    return {
      ...base,
      rung: "validated-narrow-readgrep",
      validatedEnvelope: true,
      recommendation: "ready for exact human decision under the validated one/two-file read/grep envelope, including real board-question checks, narrow cited synthesis, and one-file/named-symbol code review",
    };
  }
  return {
    ...base,
    rung: "needs-evidence-broad-readonly",
    validatedEnvelope: false,
    recommendation: "shrink to one or two declared files with read/grep, or treat this as a new evidence rung",
  };
}

export function buildAgentRunSdkInProcessPacket(input: AgentRunSdkInProcessPacketInput = {}): AgentRunSdkInProcessPacketResult {
  const runId = normalizeText(input.runId);
  const goal = normalizeText(input.goal);
  const providerModelRef = normalizeText(input.providerModelRef);
  const cwd = normalizeText(input.cwd);
  const declaredFiles = normalizeFiles(input.declaredFiles);
  const timeoutMs = normalizePositiveInt(input.timeoutMs, 0);
  const toolAllowlist = normalizeFiles(input.toolAllowlist);
  const unsupportedPolicyTools = findUnsupportedDeclaredFileScopedSdkWorkerTools(toolAllowlist);
  const sessionMode = normalizeSessionMode(input.sessionMode || "in-memory");
  const fileContract = normalizeFileContract(input.fileContract || "read-only");
  const validationGateKnown = input.validationGateKnown === true;
  const rollbackPlanKnown = input.rollbackPlanKnown === true;
  const abortKnown = input.abortKnown === true;
  const eventStreamKnown = input.eventStreamKnown === true;
  const finalOutputContractKnown = input.finalOutputContractKnown === true;
  const protectedScopeRequested = input.protectedScopeRequested === true;
  const unexpectedDirty = input.unexpectedDirty === true;
  const budget = resolveProviderExecutionBudgetEvidence({
    budgetDecision: input.budgetDecision,
    budgetEvidence: input.budgetEvidence,
    budgetEvidenceSource: input.budgetEvidenceSource,
    budgetEvidenceProvider: input.budgetEvidenceProvider,
    budgetEvidenceGeneratedAtIso: input.budgetEvidenceGeneratedAtIso,
    budgetEvidenceMaxAgeMs: input.budgetEvidenceMaxAgeMs,
    providerModelRef,
  });

  const blockers: string[] = [];
  let recommendationCode: AgentRunSdkInProcessPacketResult["recommendationCode"] = "agent-run-sdk-ready-for-human-decision";
  const block = (code: AgentRunSdkInProcessPacketResult["recommendationCode"], blocker: string) => {
    if (blockers.length === 0) recommendationCode = code;
    blockers.push(blocker);
  };

  if (protectedScopeRequested) block("agent-run-sdk-blocked-protected-scope", "protected-scope-requested");
  if (unexpectedDirty) block("agent-run-sdk-blocked-dirty-state", "unexpected-dirty-state");
  if (!runId) block("agent-run-sdk-blocked-run-id", "run-id-missing");
  if (!goal) block("agent-run-sdk-blocked-goal", "goal-missing");
  if (!providerModelRef || !providerModelRef.includes("/")) block("agent-run-sdk-blocked-provider-model", "provider-model-ref-missing");
  if (!cwd) block("agent-run-sdk-blocked-cwd", "cwd-missing");
  if (declaredFiles.length === 0) block("agent-run-sdk-blocked-files", "declared-files-missing");
  if (timeoutMs < SDK_TIMEOUT_MIN_MS || timeoutMs > SDK_TIMEOUT_MAX_MS) block("agent-run-sdk-blocked-timeout", "timeout-out-of-bounds");
  if (toolAllowlist.length === 0) block("agent-run-sdk-blocked-tools", "tool-allowlist-missing");
  if (unsupportedPolicyTools.length > 0) block("agent-run-sdk-blocked-tools", `unsupported-tool-policy:${unsupportedPolicyTools.join(",")}`);
  if (sessionMode === "unknown") block("agent-run-sdk-blocked-session-mode", "session-mode-unknown");
  if (!validationGateKnown) block("agent-run-sdk-blocked-validation", "validation-gate-missing");
  if (!rollbackPlanKnown) block("agent-run-sdk-blocked-rollback", "rollback-plan-missing");
  for (const budgetBlocker of budget.blockers) block("agent-run-sdk-blocked-budget", budgetBlocker);
  if (!abortKnown) block("agent-run-sdk-blocked-abort", "abort-contract-missing");
  if (!eventStreamKnown) block("agent-run-sdk-blocked-event-stream", "event-stream-contract-missing");
  if (!finalOutputContractKnown) block("agent-run-sdk-blocked-final-output", "final-output-contract-missing");

  const decision: AgentRunSdkPacketDecision = blockers.length === 0 ? "ready-for-human-decision" : "blocked";
  const sdkMaturity = buildSdkMaturity({
    blocked: blockers.length > 0,
    goal,
    declaredFiles,
    toolAllowlist,
    fileContract,
  });
  const readyNextActions = sdkMaturity.validatedEnvelope
    ? [
      "present this SDK/in-process packet for explicit human decision; the packet itself cannot dispatch",
      "prefer the validated SDK safe envelope first: one or two declared files, read/grep only, strict final output contract, bounded timeout",
      "after a failed two-file code/test review, retry only as one target file or one named symbol before expanding scope",
      "if separately implemented and confirmed, start exactly one SDK worker and record registry/log/outcome evidence",
      "after completion, validate final output bytes and declared file scope from the parent",
    ]
    : [
      "present this SDK/in-process packet as a new evidence rung, not as routine validated SDK use",
      sdkMaturity.recommendation,
      "if exact-confirmed anyway, start exactly one SDK worker and record registry/log/outcome evidence before expanding scope",
      "after completion, validate final output bytes and declared file scope from the parent",
    ];
  const sdkPreview = {
    factory: "createAgentSession" as const,
    authPattern: "AuthStorage.create + ModelRegistry.create" as const,
    sessionPattern: sessionMode === "run-session-dir" ? "SessionManager.create" as const : sessionMode === "in-memory" ? "SessionManager.inMemory" as const : "unknown" as const,
    modelSelection: providerModelRef,
    toolSelection: toolAllowlist,
    eventCapture: ["message_update:text_delta", "tool_execution_end", "agent_end", "turn_end"],
    abortContract: ["parent timeout owns AbortController", "timeout calls session.abort()", "registry records timed-out or aborted"],
    finalOutputContract: ["capture assistant text deltas", "require final output bytes > 0", "parent validates declared file scope after completion"],
    isolationNotes: [
      "SDK/in-process shares the parent Node.js process; use only after report-only packet and exact confirmation.",
      "Live-validated safe envelope: narrow read-only diagnostics with one or two declared files, read/grep only, explicit final output contract, follow, and outcome validation.",
      "Live-validated board-question rung: narrow read-only diagnostics can answer a real board question from one or two declared files when constrained to read/grep and strict final output.",
      "Live-validated synthesis rung: narrow read-only diagnostics can produce a one-sentence recommendation with cited board/doc evidence from one or two declared files.",
      "Failed evidence rung: two-file code/test review looped with zero output; shrink to one target file or one named symbol before retrying code/test review.",
      "Live-validated one-symbol review rung: one target file or named symbol can produce a parent-side patch recommendation without broadening scope.",
      "Next maturity rung: parent-side implementation of a tiny guard/recommendation patch derived from a one-symbol review, with local tests before any worker mutation; broad read-only scopes still need evidence because prior runs looped or bloated output.",
      "Use read-only tools for diagnostic canaries unless a mutation profile declares validation and rollback.",
      "Keep subprocess executor supported for stronger process isolation and argv-level diagnostics.",
    ],
  };

  return {
    mode: "agent-run-sdk-in-process-packet",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    processStartAllowed: false,
    processStopAllowed: false,
    requiresHumanDecision: true,
    singleRunOnly: true,
    executorKind: "pi-sdk-in-process",
    decision,
    recommendationCode,
    blockers,
    runSpec: {
      runId,
      goal,
      providerModelRef,
      cwd,
      declaredFiles,
      timeoutMs,
      timeoutMinMs: SDK_TIMEOUT_MIN_MS,
      timeoutMaxMs: SDK_TIMEOUT_MAX_MS,
      toolAllowlist,
      sessionMode,
      fileContract,
      validationGateKnown,
      rollbackPlanKnown,
      budgetDecision: budget.decision,
      budgetEvidence: budget.evidence,
      budgetEvidenceSource: budget.evidenceSource,
      budgetEvidenceProvider: budget.provider,
      budgetEvidenceGeneratedAtIso: budget.generatedAtIso,
      budgetEvidenceFreshness: budget.freshness,
      budgetEvidenceConsistency: budget.consistency,
      budgetEvidenceHumanReviewRequired: budget.humanReviewRequired,
      abortKnown,
      eventStreamKnown,
      finalOutputContractKnown,
      protectedScopeRequested,
      unexpectedDirty,
    },
    sdkMaturity,
    sdkPreview,
    humanConfirmationPhrase: runId ? `execute o sdk worker ${runId}` : "",
    nextActions: decision === "ready-for-human-decision"
      ? readyNextActions
      : ["resolve blockers before any SDK/in-process worker implementation or dispatch", "keep subprocess route available; do not switch globally"],
    rollbackHint: declaredFiles.length > 0 ? `restore/remove only declared files: ${declaredFiles.join(", ")}` : "no rollback target is safe until declaredFiles is provided",
    summary: [
      "agent-run-sdk-in-process-packet:",
      `decision=${decision}`,
      `runId=${runId || "missing"}`,
      providerModelRef ? `model=${providerModelRef}` : undefined,
      `tools=${toolAllowlist.length}`,
      `session=${sessionMode}`,
      `sdkMaturity=${sdkMaturity.rung}`,
      unexpectedDirty ? "unexpectedDirty=yes" : undefined,
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
      "dispatch=no",
      "authorization=none",
    ].filter(Boolean).join(" "),
  };
}
