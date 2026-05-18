import { resolveProviderExecutionBudgetEvidence, type ProviderExecutionBudgetDecision } from "./guardrails-core-provider-budget-evidence";
import { buildOperatorApprovalPacket, type OperatorApprovalPacket } from "./guardrails-core-operator-approval";
import { findUnsupportedDeclaredFileScopedSdkWorkerTools } from "./guardrails-core-tool-policy";

export type AgentRunSdkSessionMode = "in-memory" | "run-session-dir" | "unknown";
export type AgentRunSdkPacketDecision = "ready-for-human-decision" | "blocked";
export type AgentRunSdkFileContract = "read-only" | "mutation" | "unknown";
export type AgentRunSdkMaturityRung =
  | "validated-narrow-readgrep"
  | "validated-one-file-mutation"
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
  sharedEvidence?: string[];
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
    sharedEvidence: string[];
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
    budgetEvidenceConsistency: "consistent" | "mismatch" | "needs-operator-review";
    budgetEvidenceOperatorReviewRequired: boolean;
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
    cacheEconomyContract: string[];
    parallelReadOnlyContract: string[];
    isolationNotes: string[];
  };
  operatorApproval: OperatorApprovalPacket;
  operatorApprovalPrompt: string;
  nextActions: string[];
  rollbackHint: string;
  summary: string;
}

const SDK_TIMEOUT_MIN_MS = 5_000;
const SDK_TIMEOUT_MAX_MS = 180_000;
const SDK_CACHE_PACK_SUMMARY_MAX_CHARS = 600;
const SDK_CACHE_PACK_EVIDENCE_MAX_CHARS = 300;
const SDK_SHARED_EVIDENCE_MAX_ITEMS = 20;
const SDK_SHARED_EVIDENCE_MAX_CHARS = 300;

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
  const mutationToolsWithinValidatedEnvelope = input.toolAllowlist.length > 0
    && input.toolAllowlist.some((tool) => tool === "write" || tool === "edit")
    && input.toolAllowlist.every((tool) => tool === "read" || tool === "write" || tool === "edit");
  const base = {
    scope,
    maxDeclaredFilesValidated: 2,
    supportedToolsValidated: ["read", "grep"],
  } as const;
  const mutationBase = {
    scope,
    maxDeclaredFilesValidated: 1,
    supportedToolsValidated: ["read", "write", "edit"],
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
    if (input.declaredFiles.length === 1 && mutationToolsWithinValidatedEnvelope) {
      return {
        ...mutationBase,
        rung: "validated-one-file-mutation",
        validatedEnvelope: true,
        recommendation: "ready for structured operator approval under the validated one-file SDK mutation envelope: one declared file, read plus write/edit only, parent-side follow/outcome validation, and no fan-out",
      };
    }
    return {
      ...mutationBase,
      rung: "needs-evidence-mutation",
      validatedEnvelope: false,
      recommendation: "keep multi-file, broad, or tool-expanded mutation SDK workers behind separate validation, rollback, and exact-confirmation evidence",
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
      recommendation: "ready for structured operator approval under the validated one/two-file read/grep envelope, including real board-question checks, narrow cited synthesis, and one-file/named-symbol code review",
    };
  }
  return {
    ...base,
    rung: "needs-evidence-broad-readonly",
    validatedEnvelope: false,
    recommendation: "shrink to one or two declared files with read/grep, or treat this as a new evidence rung",
  };
}

export interface AgentRunSdkCachePackEntryInput {
  id?: string;
  path?: string;
  summary?: string;
  freshness?: "fresh" | "stale" | "unknown" | string;
  evidence?: string;
}

export interface AgentRunSdkCachePackPacketInput {
  packId?: string;
  entries?: AgentRunSdkCachePackEntryInput[];
  maxEntries?: number;
  protectedScopeRequested?: boolean;
  unexpectedDirty?: boolean;
}

export interface AgentRunSdkCachePackPacketResult {
  mode: "agent-run-sdk-cache-pack-packet";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  requiresHumanDecision: true;
  decision: AgentRunSdkPacketDecision;
  recommendationCode: "agent-run-sdk-cache-pack-ready-for-human-decision" | "agent-run-sdk-cache-pack-blocked";
  blockers: string[];
  packSpec: {
    packId: string;
    entryCount: number;
    maxEntries: number;
    freshCount: number;
    staleCount: number;
    unknownCount: number;
    protectedScopeRequested: boolean;
    unexpectedDirty: boolean;
    maxSummaryChars: number;
    maxEvidenceChars: number;
  };
  entries: Array<{
    id: string;
    path?: string;
    summary: string;
    summaryChars: number;
    freshness: "fresh" | "stale" | "unknown";
    evidence: string;
    evidenceChars: number;
  }>;
  cacheKeyContract: string[];
  freshnessContract: string[];
  workerUseContract: string[];
  operatorApprovalPrompt: string;
  nextActions: string[];
  summary: string;
}

export interface AgentRunSdkReadOnlyBatchPacketInput {
  batchId?: string;
  workers?: AgentRunSdkInProcessPacketInput[];
  sharedEvidence?: string[];
  maxWorkers?: number;
  protectedScopeRequested?: boolean;
  unexpectedDirty?: boolean;
}

export interface AgentRunSdkReadOnlyBatchPacketResult {
  mode: "agent-run-sdk-readonly-batch-packet";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  parallelDispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  requiresHumanDecision: true;
  executorKind: "pi-sdk-in-process";
  decision: AgentRunSdkPacketDecision;
  recommendationCode: "agent-run-sdk-readonly-batch-ready-for-human-decision" | "agent-run-sdk-readonly-batch-blocked";
  blockers: string[];
  batchSpec: {
    batchId: string;
    workerCount: number;
    maxWorkers: number;
    sharedEvidence: string[];
    maxSharedEvidenceItems: number;
    maxSharedEvidenceChars: number;
    protectedScopeRequested: boolean;
    unexpectedDirty: boolean;
  };
  workers: AgentRunSdkInProcessPacketResult[];
  readyWorkerCount: number;
  fanOutContract: string[];
  fanInContract: string[];
  cacheEconomyContract: string[];
  operatorApproval: OperatorApprovalPacket;
  operatorApprovalPrompt: string;
  nextActions: string[];
  summary: string;
}

export interface AgentRunSdkReadOnlyBatchTaskInput {
  taskId?: string;
  task?: {
    id?: string;
    description?: string;
    files?: string[];
    verification?: string;
  };
  providerModelRef?: string;
  cwd?: string;
  maxWorkers?: number;
  timeoutMs?: number;
  budgetDecision?: ProviderExecutionBudgetDecision | string;
  budgetEvidence?: string;
  budgetEvidenceSource?: "route-advisory" | "provider-budget-snapshot" | "manual" | "unknown" | string;
  budgetEvidenceProvider?: string;
  includeProtectedScopes?: boolean;
  protectedScopeRequested?: boolean;
  unexpectedDirty?: boolean;
}

export interface AgentRunSdkReadOnlyBatchTaskResult {
  mode: "agent-run-sdk-readonly-batch-task-packet";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  parallelDispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  requiresHumanDecision: true;
  decision: AgentRunSdkPacketDecision;
  recommendationCode: "agent-run-sdk-readonly-batch-task-ready" | "agent-run-sdk-readonly-batch-task-blocked";
  blockers: string[];
  taskSpec: {
    taskId: string;
    fileCount: number;
    protectedFileCount: number;
    omittedFileCount: number;
    includeProtectedScopes: boolean;
  };
  protectedFiles: string[];
  omittedFiles: string[];
  packet: AgentRunSdkReadOnlyBatchPacketResult;
  operatorApprovalPrompt: string;
  nextActions: string[];
  summary: string;
}

export function buildAgentRunSdkInProcessPacket(input: AgentRunSdkInProcessPacketInput = {}): AgentRunSdkInProcessPacketResult {
  const runId = normalizeText(input.runId);
  const goal = normalizeText(input.goal);
  const providerModelRef = normalizeText(input.providerModelRef);
  const cwd = normalizeText(input.cwd);
  const declaredFiles = normalizeFiles(input.declaredFiles);
  const sharedEvidence = normalizeFiles(input.sharedEvidence);
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
  if (sharedEvidence.length > SDK_SHARED_EVIDENCE_MAX_ITEMS) block("agent-run-sdk-blocked-files", `shared-evidence-count-exceeds-max:${sharedEvidence.length}>${SDK_SHARED_EVIDENCE_MAX_ITEMS}`);
  const seenSharedEvidence = new Set<string>();
  for (const [index, evidence] of sharedEvidence.entries()) {
    if (evidence.length > SDK_SHARED_EVIDENCE_MAX_CHARS) block("agent-run-sdk-blocked-files", `shared-evidence-too-large:${index + 1}:${evidence.length}>${SDK_SHARED_EVIDENCE_MAX_CHARS}`);
    if (seenSharedEvidence.has(evidence)) block("agent-run-sdk-blocked-files", `duplicate-shared-evidence:${evidence}`);
    seenSharedEvidence.add(evidence);
  }
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
  const operatorApprovalPrompt = runId ? `approve sdk worker ${runId}` : "";
  const operatorApproval = buildOperatorApprovalPacket({
    intentKind: "worker-single-run",
    recommendedAction: runId ? `execute sdk worker ${runId}` : undefined,
    structuredApprovalAvailable: false,
    protectedScopeRequested,
  });
  const sdkMaturity = buildSdkMaturity({
    blocked: blockers.length > 0,
    goal,
    declaredFiles,
    toolAllowlist,
    fileContract,
  });
  const readyNextActions = sdkMaturity.rung === "validated-one-file-mutation"
    ? [
      "present this SDK/in-process mutation packet for structured operator approval; the packet itself cannot dispatch",
      "use only the validated one-file mutation envelope: one declared file, read plus write/edit only, strict final output contract, bounded timeout",
      "after completion, validate final output bytes, git touched-file scope, marker/check results, and agent_run_outcome_packet from the parent",
      "do not promote broad mutation, multi-file mutation, protected scope, or parallel fan-out from this single-worker evidence rung",
      "record operator-visible evidence before any board closure or commit",
    ]
    : sdkMaturity.validatedEnvelope
      ? [
      "present this SDK/in-process packet for structured operator approval; the packet itself cannot dispatch",
        "prefer the validated SDK safe envelope first: one or two declared files, read/grep only, strict final output contract, bounded timeout",
        "after a failed two-file code/test review, retry only as one target file or one named symbol before expanding scope",
        "prefer shared parent-side cache/evidence packs before repeated reads of stable logs, docs, or declared files",
        "for parallel fan-out, prepare a separate read-only batch packet with shared cache/evidence and fan-in validation; do not start multiple workers from this single-worker packet",
        "if separately implemented and confirmed, start exactly one SDK worker and record registry/log/outcome evidence",
        "after completion, validate final output bytes and declared file scope from the parent",
      ]
      : [
      "present this SDK/in-process packet as a new evidence rung, not as routine validated SDK use",
      sdkMaturity.recommendation,
      "if structured-approved anyway, start exactly one SDK worker and record registry/log/outcome evidence before expanding scope",
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
    cacheEconomyContract: [
      `shared evidence attachments are optional for single workers, but when present they are bounded to ${SDK_SHARED_EVIDENCE_MAX_ITEMS} items of ${SDK_SHARED_EVIDENCE_MAX_CHARS} chars each`,
      "parent should attach a bounded shared evidence pack before asking workers to reread stable logs, docs, or packet previews",
      "cache keys should include path plus freshness evidence such as git object, mtime/size, or explicit verification id",
      "worker goals should prefer cached summaries first and read only focal anchors when the cache is fresh",
      "fan-in evidence should record cache-hit/cache-miss and invalidate on unexpected dirty state or touched declared files",
    ],
    parallelReadOnlyContract: [
      "parallel SDK fan-out remains report-only until a separate batch gate exists; this single-worker packet never dispatches multiple workers",
      "eligible parallel workers must be independent, read-only, narrow, and limited to read/grep with strict final output contracts",
      "batch approval must be structured for the batch id and still preserve per-worker run ids, logs, outcome packets, and abort visibility",
      "fan-in must validate every worker outcome before promotion and fail closed on mutation, protected scope, dirty state, budget blockers, or missing output",
    ],
    isolationNotes: [
      "SDK/in-process shares the parent Node.js process; use only after report-only packet and structured operator approval.",
      "Live-validated safe envelope: narrow read-only diagnostics with one or two declared files, read/grep only, explicit final output contract, follow, and outcome validation.",
      "Live-validated board-question rung: narrow read-only diagnostics can answer a real board question from one or two declared files when constrained to read/grep and strict final output.",
      "Live-validated synthesis rung: narrow read-only diagnostics can produce a one-sentence recommendation with cited board/doc evidence from one or two declared files.",
      "Failed evidence rung: two-file code/test review looped with zero output; shrink to one target file or one named symbol before retrying code/test review.",
      "Live-validated one-symbol review rung: one target file or named symbol can produce a parent-side patch recommendation without broadening scope.",
      "Next maturity rung: parent-side implementation of a tiny guard/recommendation patch derived from a one-symbol review, with local tests before any worker mutation; broad read-only scopes still need evidence because prior runs looped or bloated output.",
      "Live-validated one-file mutation rung: one declared file with read plus write/edit only can run after structured operator approval, then parent-side follow/outcome/touched-file validation; broad mutation, multi-file mutation, and fan-out still need evidence.",
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
      sharedEvidence,
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
      budgetEvidenceOperatorReviewRequired: budget.operatorReviewRequired,
      abortKnown,
      eventStreamKnown,
      finalOutputContractKnown,
      protectedScopeRequested,
      unexpectedDirty,
    },
    sdkMaturity,
    sdkPreview,
    operatorApproval,
    operatorApprovalPrompt,
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
      sharedEvidence.length > 0 ? `sharedEvidence=${sharedEvidence.length}` : undefined,
      `session=${sessionMode}`,
      `sdkMaturity=${sdkMaturity.rung}`,
      unexpectedDirty ? "unexpectedDirty=yes" : undefined,
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
      "dispatch=no",
      "authorization=none",
    ].filter(Boolean).join(" "),
  };
}

function normalizeCacheFreshness(value: unknown): "fresh" | "stale" | "unknown" {
  return value === "fresh" || value === "stale" ? value : "unknown";
}

export function buildAgentRunSdkCachePackPacket(input: AgentRunSdkCachePackPacketInput = {}): AgentRunSdkCachePackPacketResult {
  const packId = normalizeText(input.packId);
  const entriesInput = Array.isArray(input.entries) ? input.entries : [];
  const requestedMaxEntries = normalizePositiveInt(input.maxEntries, 12);
  const maxEntries = Math.max(1, Math.min(20, requestedMaxEntries || 12));
  const protectedScopeRequested = input.protectedScopeRequested === true;
  const unexpectedDirty = input.unexpectedDirty === true;
  const blockers: string[] = [];
  if (!packId) blockers.push("pack-id-missing");
  if (protectedScopeRequested) blockers.push("protected-scope-requested");
  if (unexpectedDirty) blockers.push("unexpected-dirty-state");
  if (entriesInput.length === 0) blockers.push("cache-pack-entries-missing");
  if (entriesInput.length > maxEntries) blockers.push(`cache-pack-entry-count-exceeds-max:${entriesInput.length}>${maxEntries}`);

  const seenIds = new Set<string>();
  const entries = entriesInput.map((entry, index) => {
    const id = normalizeText(entry.id);
    const entryPath = normalizeText(entry.path);
    const summary = normalizeText(entry.summary);
    const freshness = normalizeCacheFreshness(entry.freshness);
    const evidence = normalizeText(entry.evidence);
    const label = id || `entry-${index + 1}`;
    if (!id) blockers.push(`entry-id-missing:${index + 1}`);
    if (id && seenIds.has(id)) blockers.push(`duplicate-entry-id:${id}`);
    if (id) seenIds.add(id);
    const summaryChars = summary.length;
    const evidenceChars = evidence.length;
    if (!summary) blockers.push(`entry-summary-missing:${label}`);
    if (summaryChars > SDK_CACHE_PACK_SUMMARY_MAX_CHARS) blockers.push(`entry-summary-too-large:${label}:${summaryChars}>${SDK_CACHE_PACK_SUMMARY_MAX_CHARS}`);
    if (!evidence) blockers.push(`entry-evidence-missing:${label}`);
    if (evidenceChars > SDK_CACHE_PACK_EVIDENCE_MAX_CHARS) blockers.push(`entry-evidence-too-large:${label}:${evidenceChars}>${SDK_CACHE_PACK_EVIDENCE_MAX_CHARS}`);
    if (freshness !== "fresh") blockers.push(`entry-not-fresh:${label}:${freshness}`);
    return {
      id,
      ...(entryPath ? { path: entryPath } : {}),
      summary,
      summaryChars,
      freshness,
      evidence,
      evidenceChars,
    };
  });

  const freshCount = entries.filter((entry) => entry.freshness === "fresh").length;
  const staleCount = entries.filter((entry) => entry.freshness === "stale").length;
  const unknownCount = entries.filter((entry) => entry.freshness === "unknown").length;
  const decision: AgentRunSdkPacketDecision = blockers.length === 0 ? "ready-for-human-decision" : "blocked";
  const cacheKeyContract = [
    "cache keys should include pack id, entry id, path when present, and freshness evidence",
    "path-backed entries should cite git object, mtime/size, or verification id evidence before workers trust the summary",
    "duplicate entry ids are blocked so fan-out workers can cite cache evidence unambiguously",
    `entry summaries are bounded to ${SDK_CACHE_PACK_SUMMARY_MAX_CHARS} chars and evidence labels to ${SDK_CACHE_PACK_EVIDENCE_MAX_CHARS} chars`,
  ];
  const freshnessContract = [
    "only fresh entries are promotable into worker prompts",
    "stale or unknown freshness blocks the pack and should force focal reread or pack regeneration",
    "unexpected dirty state invalidates the whole pack before fan-out",
  ];
  const workerUseContract = [
    "workers should consume the shared pack first and read only focal anchors not covered by fresh evidence",
    "worker final output should report cache-hit/cache-miss for parent fan-in",
    "the cache pack never authorizes dispatch; it is an attachment/evidence contract only",
  ];

  return {
    mode: "agent-run-sdk-cache-pack-packet",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    processStartAllowed: false,
    processStopAllowed: false,
    requiresHumanDecision: true,
    decision,
    recommendationCode: decision === "ready-for-human-decision" ? "agent-run-sdk-cache-pack-ready-for-human-decision" : "agent-run-sdk-cache-pack-blocked",
    blockers,
    packSpec: {
      packId,
      entryCount: entries.length,
      maxEntries,
      freshCount,
      staleCount,
      unknownCount,
      protectedScopeRequested,
      unexpectedDirty,
      maxSummaryChars: SDK_CACHE_PACK_SUMMARY_MAX_CHARS,
      maxEvidenceChars: SDK_CACHE_PACK_EVIDENCE_MAX_CHARS,
    },
    entries,
    cacheKeyContract,
    freshnessContract,
    workerUseContract,
    operatorApprovalPrompt: packId ? `approve sdk cache pack ${packId}` : "",
    nextActions: decision === "ready-for-human-decision"
      ? [
        "attach this cache pack to a future read-only SDK worker or batch packet only after structured operator approval",
        "keep worker prompts narrow and require cache-hit/cache-miss evidence in final output",
        "regenerate or block the pack if git state becomes unexpected dirty before fan-out",
      ]
      : [
        "resolve cache pack blockers before attaching it to workers",
        "fallback to focal reads when freshness is stale or unknown",
      ],
    summary: [
      "agent-run-sdk-cache-pack-packet:",
      `decision=${decision}`,
      `packId=${packId || "missing"}`,
      `entries=${entries.length}`,
      `fresh=${freshCount}`,
      staleCount > 0 ? `stale=${staleCount}` : undefined,
      unknownCount > 0 ? `unknown=${unknownCount}` : undefined,
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
      "dispatch=no",
      "authorization=none",
    ].filter(Boolean).join(" "),
  };
}

function slugifyRunIdPart(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.slice(0, 48) || "files";
}

function basenameWithoutExtension(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const base = normalized.split("/").filter(Boolean).pop() || normalized;
  return base.replace(/\.[^.]+$/g, "") || base;
}

function isProtectedBatchTaskFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return normalized.startsWith(".github/")
    || normalized === ".pi/settings.json"
    || normalized.startsWith(".pi/settings")
    || normalized.startsWith(".obsidian/")
    || normalized.startsWith(".github/workflows/")
    || normalized.includes("/credentials")
    || normalized.includes("/secrets");
}

function chunkDeclaredFiles(files: string[], chunkSize: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < files.length; index += chunkSize) chunks.push(files.slice(index, index + chunkSize));
  return chunks;
}

export function buildAgentRunSdkReadOnlyBatchPacket(input: AgentRunSdkReadOnlyBatchPacketInput = {}): AgentRunSdkReadOnlyBatchPacketResult {
  const batchId = normalizeText(input.batchId);
  const workersInput = Array.isArray(input.workers) ? input.workers : [];
  const sharedEvidence = normalizeFiles(input.sharedEvidence);
  const requestedMaxWorkers = normalizePositiveInt(input.maxWorkers, 5);
  const maxWorkers = Math.max(2, Math.min(5, requestedMaxWorkers || 5));
  const protectedScopeRequested = input.protectedScopeRequested === true;
  const unexpectedDirty = input.unexpectedDirty === true;
  const workers = workersInput.map((worker) => buildAgentRunSdkInProcessPacket({
    ...worker,
    sharedEvidence: worker.sharedEvidence?.length ? worker.sharedEvidence : sharedEvidence,
    fileContract: "read-only",
    protectedScopeRequested: protectedScopeRequested || worker.protectedScopeRequested,
    unexpectedDirty: unexpectedDirty || worker.unexpectedDirty,
  }));

  const blockers: string[] = [];
  if (!batchId) blockers.push("batch-id-missing");
  if (protectedScopeRequested) blockers.push("protected-scope-requested");
  if (unexpectedDirty) blockers.push("unexpected-dirty-state");
  if (sharedEvidence.length === 0) blockers.push("shared-evidence-missing");
  if (sharedEvidence.length > SDK_SHARED_EVIDENCE_MAX_ITEMS) blockers.push(`shared-evidence-count-exceeds-max:${sharedEvidence.length}>${SDK_SHARED_EVIDENCE_MAX_ITEMS}`);
  const seenSharedEvidence = new Set<string>();
  for (const [index, evidence] of sharedEvidence.entries()) {
    if (evidence.length > SDK_SHARED_EVIDENCE_MAX_CHARS) blockers.push(`shared-evidence-too-large:${index + 1}:${evidence.length}>${SDK_SHARED_EVIDENCE_MAX_CHARS}`);
    if (seenSharedEvidence.has(evidence)) blockers.push(`duplicate-shared-evidence:${evidence}`);
    seenSharedEvidence.add(evidence);
  }
  if (workers.length < 2) blockers.push("batch-needs-at-least-two-workers");
  if (workers.length > maxWorkers) blockers.push(`worker-count-exceeds-max:${workers.length}>${maxWorkers}`);
  const seenRunIds = new Set<string>();
  for (const worker of workers) {
    const runId = worker.runSpec.runId;
    if (!runId) continue;
    if (seenRunIds.has(runId)) blockers.push(`duplicate-run-id:${runId}`);
    seenRunIds.add(runId);
  }
  for (const worker of workers) {
    if (worker.decision !== "ready-for-human-decision") blockers.push(`worker-blocked:${worker.runSpec.runId || "missing"}`);
    if (!worker.sdkMaturity.validatedEnvelope) blockers.push(`worker-not-validated-envelope:${worker.runSpec.runId || "missing"}:${worker.sdkMaturity.rung}`);
    if (worker.runSpec.fileContract !== "read-only") blockers.push(`worker-not-readonly:${worker.runSpec.runId || "missing"}`);
  }

  const readyWorkerCount = workers.filter((worker) => worker.decision === "ready-for-human-decision" && worker.sdkMaturity.validatedEnvelope && worker.runSpec.fileContract === "read-only").length;
  const decision: AgentRunSdkPacketDecision = blockers.length === 0 ? "ready-for-human-decision" : "blocked";
  const operatorApprovalPrompt = batchId ? `approve sdk readonly batch ${batchId}` : "";
  const operatorApproval = buildOperatorApprovalPacket({
    intentKind: "worker-suite",
    suiteId: batchId,
    providerModelRef: workers[0]?.runSpec.providerModelRef,
    maxCalls: workers.length,
    parallelism: Math.min(workers.length, maxWorkers),
    structuredApprovalAvailable: false,
    protectedScopeRequested,
  });
  const fanOutContract = [
    "batch packet is report-only and never dispatches workers by itself",
    "all workers must be independent, read-only, narrow, and validated under the read/grep SDK envelope",
    "future execution must preserve per-worker run ids, logs, timeouts, abort visibility, and structured operator approval for the batch id",
  ];
  const fanInContract = [
    "parent must collect every worker outcome before using the batch result",
    "fan-in fails closed on missing output, failed outcome, touched files, protected scope, dirty state, or budget blockers",
    "promotion requires an aggregate verification entry listing each worker run id and cache-hit/cache-miss evidence",
  ];
  const cacheEconomyContract = [
    "shared evidence pack is required before fan-out so workers avoid repeated broad reads",
    `shared evidence is bounded to ${SDK_SHARED_EVIDENCE_MAX_ITEMS} items of ${SDK_SHARED_EVIDENCE_MAX_CHARS} chars each and duplicates are blocked`,
    "each worker should read only focal anchors not covered by fresh shared evidence",
    "cache freshness must be invalidated by unexpected dirty state or touched declared files",
  ];

  return {
    mode: "agent-run-sdk-readonly-batch-packet",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    parallelDispatchAllowed: false,
    processStartAllowed: false,
    processStopAllowed: false,
    requiresHumanDecision: true,
    executorKind: "pi-sdk-in-process",
    decision,
    recommendationCode: decision === "ready-for-human-decision" ? "agent-run-sdk-readonly-batch-ready-for-human-decision" : "agent-run-sdk-readonly-batch-blocked",
    blockers,
    batchSpec: {
      batchId,
      workerCount: workers.length,
      maxWorkers,
      sharedEvidence,
      maxSharedEvidenceItems: SDK_SHARED_EVIDENCE_MAX_ITEMS,
      maxSharedEvidenceChars: SDK_SHARED_EVIDENCE_MAX_CHARS,
      protectedScopeRequested,
      unexpectedDirty,
    },
    workers,
    readyWorkerCount,
    fanOutContract,
    fanInContract,
    cacheEconomyContract,
    operatorApproval,
    operatorApprovalPrompt,
    nextActions: decision === "ready-for-human-decision"
      ? [
        "present this read-only batch packet for structured operator approval; the packet itself cannot dispatch",
        "if a future executor is implemented, start at most the listed independent workers and preserve per-worker outcome validation",
        "after fan-in, record aggregate verification before promoting any result",
      ]
      : [
        "resolve batch blockers before any parallel SDK worker design or dispatch",
        "fallback to single-worker SDK packets while batch evidence is incomplete",
      ],
    summary: [
      "agent-run-sdk-readonly-batch-packet:",
      `decision=${decision}`,
      `batchId=${batchId || "missing"}`,
      `workers=${workers.length}`,
      `ready=${readyWorkerCount}`,
      `maxWorkers=${maxWorkers}`,
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
      "parallelDispatch=no",
      "authorization=none",
    ].filter(Boolean).join(" "),
  };
}

export function buildAgentRunSdkReadOnlyBatchTaskPacket(input: AgentRunSdkReadOnlyBatchTaskInput = {}): AgentRunSdkReadOnlyBatchTaskResult {
  const taskId = normalizeText(input.taskId || input.task?.id);
  const description = normalizeText(input.task?.description);
  const declaredFiles = normalizeFiles(input.task?.files);
  const requestedMaxWorkers = normalizePositiveInt(input.maxWorkers, 3);
  const maxWorkers = Math.max(2, Math.min(5, requestedMaxWorkers || 3));
  const timeoutMs = normalizePositiveInt(input.timeoutMs, 90_000) || 90_000;
  const providerModelRef = normalizeText(input.providerModelRef) || "openai-codex/gpt-5.3-codex-spark";
  const cwd = normalizeText(input.cwd);
  const includeProtectedScopes = input.includeProtectedScopes === true;
  const protectedFiles = declaredFiles.filter(isProtectedBatchTaskFile);
  const protectedScopeRequested = input.protectedScopeRequested === true || (protectedFiles.length > 0 && !includeProtectedScopes);
  const unexpectedDirty = input.unexpectedDirty === true;
  const chunks = chunkDeclaredFiles(declaredFiles, 2);
  const omittedFiles = chunks.length > maxWorkers ? chunks.slice(maxWorkers).flat() : [];
  const visibleChunks = chunks.slice(0, maxWorkers);
  const baseRunId = slugifyRunIdPart(taskId || "task");
  const sharedEvidence = [normalizeText(input.task?.verification) || `task:${taskId || "missing"}`];
  const budgetDecision = input.budgetDecision || "warn";
  const budgetEvidence = normalizeText(input.budgetEvidence)
    || "task-derived read-only batch preview; structured operator approval required before dispatch";
  const budgetEvidenceSource = input.budgetEvidenceSource || "manual";
  const budgetEvidenceProvider = normalizeText(input.budgetEvidenceProvider) || providerModelRef;
  const workers = visibleChunks.map((files, index) => {
    const label = slugifyRunIdPart(basenameWithoutExtension(files[files.length - 1] || `w${index + 1}`));
    return {
      runId: `${baseRunId}-readonly-w${index + 1}-${label}`,
      goal: `Read only ${files.join(" and ")} for ${taskId || "the task"}. Return concise source-backed findings for the parent fan-in, report cache-hit/cache-miss, and perform no mutations.`,
      providerModelRef,
      cwd,
      declaredFiles: files,
      sharedEvidence,
      timeoutMs,
      toolAllowlist: ["read", "grep"],
      sessionMode: "in-memory",
      fileContract: "read-only",
      validationGateKnown: true,
      rollbackPlanKnown: true,
      budgetDecision,
      budgetEvidence,
      budgetEvidenceSource,
      budgetEvidenceProvider,
      abortKnown: true,
      eventStreamKnown: true,
      finalOutputContractKnown: true,
    } satisfies AgentRunSdkInProcessPacketInput;
  });
  const batchId = taskId ? `${baseRunId}-readonly-narrow-batch` : "";
  const packet = buildAgentRunSdkReadOnlyBatchPacket({
    batchId,
    sharedEvidence,
    maxWorkers,
    workers,
    protectedScopeRequested,
    unexpectedDirty,
  });
  const blockers = [...packet.blockers];
  if (!taskId) blockers.unshift("task-id-missing");
  if (!input.task) blockers.unshift("task-not-found");
  if (!description) blockers.push("task-description-missing");
  if (declaredFiles.length === 0) blockers.push("task-files-missing");
  if (omittedFiles.length > 0) blockers.push(`task-files-omitted:${omittedFiles.length}`);
  if (protectedFiles.length > 0 && !includeProtectedScopes) blockers.push(`protected-task-files:${protectedFiles.length}`);
  const decision: AgentRunSdkPacketDecision = blockers.length === 0 ? "ready-for-human-decision" : "blocked";
  return {
    mode: "agent-run-sdk-readonly-batch-task-packet",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    parallelDispatchAllowed: false,
    processStartAllowed: false,
    processStopAllowed: false,
    requiresHumanDecision: true,
    decision,
    recommendationCode: decision === "ready-for-human-decision" ? "agent-run-sdk-readonly-batch-task-ready" : "agent-run-sdk-readonly-batch-task-blocked",
    blockers,
    taskSpec: {
      taskId,
      fileCount: declaredFiles.length,
      protectedFileCount: protectedFiles.length,
      omittedFileCount: omittedFiles.length,
      includeProtectedScopes,
    },
    protectedFiles,
    omittedFiles,
    packet,
    operatorApprovalPrompt: packet.operatorApprovalPrompt,
    nextActions: decision === "ready-for-human-decision"
      ? [
        "present the derived batch packet and operator approval packet before any dispatch",
        "if structured-approved later, use agent_run_sdk_readonly_batch_dispatch with the derived worker specs",
        "after completion, use batch status and fan-in packet before any board verification or closure",
      ]
      : [
        "resolve task-derived batch blockers before dispatch",
        "split protected or broad scopes into explicit human-approved packets when needed",
      ],
    summary: [
      "agent-run-sdk-readonly-batch-task-packet:",
      `decision=${decision}`,
      `task=${taskId || "missing"}`,
      `files=${declaredFiles.length}`,
      `workers=${workers.length}`,
      protectedFiles.length > 0 ? `protectedFiles=${protectedFiles.length}` : undefined,
      omittedFiles.length > 0 ? `omitted=${omittedFiles.length}` : undefined,
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
      "dispatch=no",
      "authorization=none",
    ].filter(Boolean).join(" "),
  };
}
