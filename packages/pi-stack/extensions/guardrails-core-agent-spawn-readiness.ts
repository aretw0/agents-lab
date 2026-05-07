export type AgentSpawnReadinessDecision = "keep-report-only" | "ready-for-simple-spawn";

export interface AgentSpawnReadinessInput {
  maxAgentsRequested?: number;
  timeoutMs?: number;
  cwdIsolationKnown?: boolean;
  budgetKnown?: boolean;
  rollbackPlanKnown?: boolean;
  boundedScopeKnown?: boolean;
  liveReloadCompleted?: boolean;
}

export interface AgentSpawnReadinessResult {
  mode: "agent-spawn-readiness";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  decision: AgentSpawnReadinessDecision;
  recommendationCode:
    | "agent-spawn-ready-simple"
    | "agent-spawn-keep-report-only-multi-agent"
    | "agent-spawn-keep-report-only-timeout"
    | "agent-spawn-keep-report-only-cwd"
    | "agent-spawn-keep-report-only-budget"
    | "agent-spawn-keep-report-only-rollback"
    | "agent-spawn-keep-report-only-scope"
    | "agent-spawn-keep-report-only-reload";
  recommendation: string;
  blockers: string[];
  criteria: {
    maxAgentsRequested: number;
    timeoutMs: number;
    timeoutMinMs: number;
    timeoutMaxMs: number;
    cwdIsolationKnown: boolean;
    budgetKnown: boolean;
    rollbackPlanKnown: boolean;
    boundedScopeKnown: boolean;
    liveReloadCompleted: boolean;
  };
  summary: string;
}

export type OneSliceAgentRunPlanDecision = "ready-for-human-decision" | "blocked";

export interface OneSliceAgentRunPlanInput {
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

export interface OneSliceAgentRunPlanResult {
  mode: "one-slice-agent-run-plan";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  executorApproved: false;
  requiresHumanDecision: true;
  oneSliceOnly: true;
  decision: OneSliceAgentRunPlanDecision;
  recommendationCode:
    | "one-slice-agent-run-ready-for-human-decision"
    | "one-slice-agent-run-blocked-protected-scope"
    | "one-slice-agent-run-blocked-goal"
    | "one-slice-agent-run-blocked-provider-model"
    | "one-slice-agent-run-blocked-cwd"
    | "one-slice-agent-run-blocked-files"
    | "one-slice-agent-run-blocked-timeout"
    | "one-slice-agent-run-blocked-validation"
    | "one-slice-agent-run-blocked-rollback"
    | "one-slice-agent-run-blocked-budget"
    | "one-slice-agent-run-blocked-abort"
    | "one-slice-agent-run-blocked-log-tail";
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

const TIMEOUT_MIN_MS = 5_000;
const TIMEOUT_MAX_MS = 300_000;
const SIMPLE_AGENT_TIMEOUT_MIN_MS = 5_000;
const SIMPLE_AGENT_TIMEOUT_MAX_MS = 180_000;

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

export function evaluateAgentSpawnReadiness(input: AgentSpawnReadinessInput = {}): AgentSpawnReadinessResult {
  const maxAgentsRequested = normalizePositiveInt(input.maxAgentsRequested, 1);
  const timeoutMs = normalizePositiveInt(input.timeoutMs, 0);
  const cwdIsolationKnown = input.cwdIsolationKnown === true;
  const budgetKnown = input.budgetKnown === true;
  const rollbackPlanKnown = input.rollbackPlanKnown === true;
  const boundedScopeKnown = input.boundedScopeKnown === true;
  const liveReloadCompleted = input.liveReloadCompleted === true;

  const blockers: string[] = [];
  let recommendationCode: AgentSpawnReadinessResult["recommendationCode"] = "agent-spawn-ready-simple";
  let recommendation = "simple single-agent spawn is readiness-complete for bounded local rehearsal.";

  if (!liveReloadCompleted) {
    blockers.push("reload-not-confirmed");
    recommendationCode = "agent-spawn-keep-report-only-reload";
    recommendation = "reload is required before live spawn readiness decisions.";
  } else if (maxAgentsRequested !== 1) {
    blockers.push("multi-agent-requested");
    recommendationCode = "agent-spawn-keep-report-only-multi-agent";
    recommendation = "simple spawn lane allows exactly one agent per execution.";
  } else if (timeoutMs < TIMEOUT_MIN_MS || timeoutMs > TIMEOUT_MAX_MS) {
    blockers.push("timeout-out-of-bounds");
    recommendationCode = "agent-spawn-keep-report-only-timeout";
    recommendation = "spawn timeout must be explicit and bounded before enabling simple spawn readiness.";
  } else if (!cwdIsolationKnown) {
    blockers.push("cwd-isolation-missing");
    recommendationCode = "agent-spawn-keep-report-only-cwd";
    recommendation = "declare cwd isolation before simple spawn readiness.";
  } else if (!budgetKnown) {
    blockers.push("budget-missing");
    recommendationCode = "agent-spawn-keep-report-only-budget";
    recommendation = "declare a bounded budget before simple spawn readiness.";
  } else if (!rollbackPlanKnown) {
    blockers.push("rollback-plan-missing");
    recommendationCode = "agent-spawn-keep-report-only-rollback";
    recommendation = "declare rollback plan before simple spawn readiness.";
  } else if (!boundedScopeKnown) {
    blockers.push("bounded-scope-missing");
    recommendationCode = "agent-spawn-keep-report-only-scope";
    recommendation = "declare bounded scope before simple spawn readiness.";
  }

  const decision: AgentSpawnReadinessDecision = blockers.length > 0 ? "keep-report-only" : "ready-for-simple-spawn";

  return {
    mode: "agent-spawn-readiness",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    decision,
    recommendationCode,
    recommendation,
    blockers,
    criteria: {
      maxAgentsRequested,
      timeoutMs,
      timeoutMinMs: TIMEOUT_MIN_MS,
      timeoutMaxMs: TIMEOUT_MAX_MS,
      cwdIsolationKnown,
      budgetKnown,
      rollbackPlanKnown,
      boundedScopeKnown,
      liveReloadCompleted,
    },
    summary: [
      "agent-spawn-readiness:",
      `decision=${decision}`,
      `code=${recommendationCode}`,
      `agents=${maxAgentsRequested}`,
      `timeoutMs=${timeoutMs}`,
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    ].filter(Boolean).join(" "),
  };
}

export function buildOneSliceAgentRunPlan(input: OneSliceAgentRunPlanInput = {}): OneSliceAgentRunPlanResult {
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
  let recommendationCode: OneSliceAgentRunPlanResult["recommendationCode"] = "one-slice-agent-run-ready-for-human-decision";
  let recommendation = "one-slice agent run contract is bounded enough to ask for an explicit one-slice human decision.";

  const block = (code: OneSliceAgentRunPlanResult["recommendationCode"], blocker: string, message: string) => {
    if (blockers.length === 0) {
      recommendationCode = code;
      recommendation = message;
    }
    blockers.push(blocker);
  };

  if (protectedScopeRequested) {
    block("one-slice-agent-run-blocked-protected-scope", "protected-scope-requested", "protected scope requires a separate explicit protected-focus decision before any agent run.");
  }
  if (!goal) {
    block("one-slice-agent-run-blocked-goal", "goal-missing", "declare the one-slice goal before preparing a one-slice agent run.");
  }
  if (!providerModelRef || !providerModelRef.includes("/")) {
    block("one-slice-agent-run-blocked-provider-model", "provider-model-ref-missing", "declare a full provider/model reference before preparing a one-slice agent run.");
  }
  if (!cwd) {
    block("one-slice-agent-run-blocked-cwd", "cwd-missing", "declare the worker cwd before preparing a one-slice agent run.");
  }
  if (declaredFiles.length === 0) {
    block("one-slice-agent-run-blocked-files", "declared-files-missing", "declare the exact file scope before preparing a one-slice agent run.");
  }
  if (timeoutMs < SIMPLE_AGENT_TIMEOUT_MIN_MS || timeoutMs > SIMPLE_AGENT_TIMEOUT_MAX_MS) {
    block("one-slice-agent-run-blocked-timeout", "timeout-out-of-bounds", "declare a short bounded timeout before preparing a one-slice agent run.");
  }
  if (!validationGateKnown) {
    block("one-slice-agent-run-blocked-validation", "validation-gate-missing", "declare the parent-side validation gate before preparing a one-slice agent run.");
  }
  if (!rollbackPlanKnown) {
    block("one-slice-agent-run-blocked-rollback", "rollback-plan-missing", "declare a non-destructive rollback plan before preparing a one-slice agent run.");
  }
  if (!budgetKnown) {
    block("one-slice-agent-run-blocked-budget", "budget-missing", "declare a bounded provider/cost budget before preparing a one-slice agent run.");
  }
  if (!abortKnown) {
    block("one-slice-agent-run-blocked-abort", "abort-contract-missing", "prove a safe abort path before preparing a one-slice agent run.");
  }
  if (!logTailKnown) {
    block("one-slice-agent-run-blocked-log-tail", "bounded-log-tail-missing", "declare bounded log/status visibility before preparing a one-slice agent run.");
  }

  const decision: OneSliceAgentRunPlanDecision = blockers.length === 0 ? "ready-for-human-decision" : "blocked";
  const runSpec = {
    goal,
    providerModelRef,
    cwd,
    declaredFiles,
    timeoutMs,
    timeoutMinMs: SIMPLE_AGENT_TIMEOUT_MIN_MS,
    timeoutMaxMs: SIMPLE_AGENT_TIMEOUT_MAX_MS,
    validationGateKnown,
    rollbackPlanKnown,
    budgetKnown,
    abortKnown,
    logTailKnown,
    protectedScopeRequested,
  };

  const nextActions = decision === "ready-for-human-decision"
    ? [
        "present this packet to the human/operator for an explicit one-slice execute decision",
        "if approved, start exactly one worker and record run id/status/log paths before dispatch",
        "after worker exit, validate declared files from the parent and stop",
      ]
    : [
        "resolve blockers before any worker dispatch",
        "keep the lane report-only; do not retry via opaque workflow runners",
      ];

  return {
    mode: "one-slice-agent-run-plan",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    executorApproved: false,
    requiresHumanDecision: true,
    oneSliceOnly: true,
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
      "one-slice-agent-run-plan:",
      `decision=${decision}`,
      `code=${recommendationCode}`,
      providerModelRef ? `model=${providerModelRef}` : undefined,
      `files=${declaredFiles.length}`,
      `timeoutMs=${timeoutMs}`,
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    ].filter(Boolean).join(" "),
  };
}
