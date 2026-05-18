export type AgentRunPlanDecision = "ready-for-operator-decision" | "blocked";

export interface AgentRunPlanInput {
  goal?: string;
  providerModelRef?: string;
  cwd?: string;
  declaredFiles?: string[];
  timeoutMs?: number;
  validationGateKnown?: boolean;
  rollbackPlanKnown?: boolean;
  budgetKnown?: boolean;
  abortKnown?: boolean;
  logTailKnown?: boolean;
  protectedScopeRequested?: boolean;
}

export interface AgentRunPlanResult {
  mode: "agent-run-plan";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  executorApproved: false;
  requiresOperatorDecision: true;
  singleRunOnly: true;
  decision: AgentRunPlanDecision;
  recommendationCode:
    | "agent-run-ready-for-operator-decision"
    | "agent-run-blocked-protected-scope"
    | "agent-run-blocked-goal"
    | "agent-run-blocked-provider-model"
    | "agent-run-blocked-cwd"
    | "agent-run-blocked-files"
    | "agent-run-blocked-timeout"
    | "agent-run-blocked-validation"
    | "agent-run-blocked-rollback"
    | "agent-run-blocked-budget"
    | "agent-run-blocked-abort"
    | "agent-run-blocked-log-tail";
  recommendation: string;
  blockers: string[];
  runSpec: {
    goal: string;
    providerModelRef: string;
    cwd: string;
    declaredFiles: string[];
    timeoutMs: number;
    timeoutMinMs: number;
    timeoutMaxMs: number;
    validationGateKnown: boolean;
    rollbackPlanKnown: boolean;
    budgetKnown: boolean;
    abortKnown: boolean;
    logTailKnown: boolean;
    protectedScopeRequested: boolean;
  };
  nextActions: string[];
  rollbackHint: string;
  summary: string;
}

const AGENT_RUN_TIMEOUT_MIN_MS = 5_000;
const AGENT_RUN_TIMEOUT_MAX_MS = 180_000;

function normalizePositiveInt(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function buildAgentRunPlan(input: AgentRunPlanInput = {}): AgentRunPlanResult {
  const goal = normalizeText(input.goal);
  const providerModelRef = normalizeText(input.providerModelRef);
  const cwd = normalizeText(input.cwd);
  const declaredFiles = normalizeFiles(input.declaredFiles);
  const timeoutMs = normalizePositiveInt(input.timeoutMs, 0);
  const validationGateKnown = input.validationGateKnown === true;
  const rollbackPlanKnown = input.rollbackPlanKnown === true;
  const budgetKnown = input.budgetKnown === true;
  const abortKnown = input.abortKnown === true;
  const logTailKnown = input.logTailKnown === true;
  const protectedScopeRequested = input.protectedScopeRequested === true;

  const blockers: string[] = [];
  let recommendationCode: AgentRunPlanResult["recommendationCode"] = "agent-run-ready-for-operator-decision";
  let recommendation = "agent-run contract is bounded enough to ask for an explicit operator decision.";

  const block = (code: AgentRunPlanResult["recommendationCode"], blocker: string, message: string) => {
    if (blockers.length === 0) {
      recommendationCode = code;
      recommendation = message;
    }
    blockers.push(blocker);
  };

  if (protectedScopeRequested) {
    block("agent-run-blocked-protected-scope", "protected-scope-requested", "protected scope requires a separate explicit protected-focus decision before any agent run.");
  }
  if (!goal) {
    block("agent-run-blocked-goal", "goal-missing", "declare the run goal before preparing an agent run.");
  }
  if (!providerModelRef || !providerModelRef.includes("/")) {
    block("agent-run-blocked-provider-model", "provider-model-ref-missing", "declare a full provider/model reference before preparing an agent run.");
  }
  if (!cwd) {
    block("agent-run-blocked-cwd", "cwd-missing", "declare the worker cwd before preparing an agent run.");
  }
  if (declaredFiles.length === 0) {
    block("agent-run-blocked-files", "declared-files-missing", "declare the exact file scope before preparing an agent run.");
  }
  if (timeoutMs < AGENT_RUN_TIMEOUT_MIN_MS || timeoutMs > AGENT_RUN_TIMEOUT_MAX_MS) {
    block("agent-run-blocked-timeout", "timeout-out-of-bounds", "declare a short bounded timeout before preparing an agent run.");
  }
  if (!validationGateKnown) {
    block("agent-run-blocked-validation", "validation-gate-missing", "declare the parent-side validation gate before preparing an agent run.");
  }
  if (!rollbackPlanKnown) {
    block("agent-run-blocked-rollback", "rollback-plan-missing", "declare a non-destructive rollback plan before preparing an agent run.");
  }
  if (!budgetKnown) {
    block("agent-run-blocked-budget", "budget-missing", "declare a bounded provider/cost budget before preparing an agent run.");
  }
  if (!abortKnown) {
    block("agent-run-blocked-abort", "abort-contract-missing", "prove a safe abort path before preparing an agent run.");
  }
  if (!logTailKnown) {
    block("agent-run-blocked-log-tail", "bounded-log-tail-missing", "declare bounded log/status visibility before preparing an agent run.");
  }

  const decision: AgentRunPlanDecision = blockers.length === 0 ? "ready-for-operator-decision" : "blocked";
  const runSpec = {
    goal,
    providerModelRef,
    cwd,
    declaredFiles,
    timeoutMs,
    timeoutMinMs: AGENT_RUN_TIMEOUT_MIN_MS,
    timeoutMaxMs: AGENT_RUN_TIMEOUT_MAX_MS,
    validationGateKnown,
    rollbackPlanKnown,
    budgetKnown,
    abortKnown,
    logTailKnown,
    protectedScopeRequested,
  };

  const nextActions = decision === "ready-for-operator-decision"
    ? [
        "present this packet to the operator for an explicit single-run execute decision",
        "if approved, start exactly one worker and record run id/status/log paths before dispatch",
        "after worker exit, validate declared files from the parent and stop",
      ]
    : [
        "resolve blockers before any worker dispatch",
        "keep the lane report-only; do not retry via opaque workflow runners",
      ];

  return {
    mode: "agent-run-plan",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    executorApproved: false,
    requiresOperatorDecision: true,
    singleRunOnly: true,
    decision,
    recommendationCode,
    recommendation,
    blockers,
    runSpec,
    nextActions,
    rollbackHint: declaredFiles.length > 0
      ? `restore/remove only declared files: ${declaredFiles.join(", ")}`
      : "no rollback target is safe until declaredFiles is provided",
    summary: [
      "agent-run-plan:",
      `decision=${decision}`,
      `code=${recommendationCode}`,
      providerModelRef ? `model=${providerModelRef}` : undefined,
      `files=${declaredFiles.length}`,
      `timeoutMs=${timeoutMs}`,
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    ].filter(Boolean).join(" "),
  };
}
