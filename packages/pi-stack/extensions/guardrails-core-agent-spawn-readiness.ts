import {
  GUARDRAILS_AUTHORIZATION_NONE,
  type GuardrailsAuthorizationNone,
} from "./guardrails-core-authorization";

export type AgentSpawnReadinessDecision = "keep-report-only" | "ready-for-agent-run";

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
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  decision: AgentSpawnReadinessDecision;
  recommendationCode:
    | "agent-spawn-ready-agent-run"
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

const TIMEOUT_MIN_MS = 5_000;
const TIMEOUT_MAX_MS = 300_000;

function normalizePositiveInt(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
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
  let recommendationCode: AgentSpawnReadinessResult["recommendationCode"] = "agent-spawn-ready-agent-run";
  let recommendation = "single-agent run readiness is complete for bounded local rehearsal.";

  if (!liveReloadCompleted) {
    blockers.push("reload-not-confirmed");
    recommendationCode = "agent-spawn-keep-report-only-reload";
    recommendation = "reload is required before live spawn readiness decisions.";
  } else if (maxAgentsRequested !== 1) {
    blockers.push("multi-agent-requested");
    recommendationCode = "agent-spawn-keep-report-only-multi-agent";
    recommendation = "agent-run lane allows exactly one agent per execution.";
  } else if (timeoutMs < TIMEOUT_MIN_MS || timeoutMs > TIMEOUT_MAX_MS) {
    blockers.push("timeout-out-of-bounds");
    recommendationCode = "agent-spawn-keep-report-only-timeout";
    recommendation = "spawn timeout must be explicit and bounded before enabling agent-run readiness.";
  } else if (!cwdIsolationKnown) {
    blockers.push("cwd-isolation-missing");
    recommendationCode = "agent-spawn-keep-report-only-cwd";
    recommendation = "declare cwd isolation before agent-run readiness.";
  } else if (!budgetKnown) {
    blockers.push("budget-missing");
    recommendationCode = "agent-spawn-keep-report-only-budget";
    recommendation = "declare a bounded budget before agent-run readiness.";
  } else if (!rollbackPlanKnown) {
    blockers.push("rollback-plan-missing");
    recommendationCode = "agent-spawn-keep-report-only-rollback";
    recommendation = "declare rollback plan before agent-run readiness.";
  } else if (!boundedScopeKnown) {
    blockers.push("bounded-scope-missing");
    recommendationCode = "agent-spawn-keep-report-only-scope";
    recommendation = "declare bounded scope before agent-run readiness.";
  }

  const decision: AgentSpawnReadinessDecision = blockers.length > 0 ? "keep-report-only" : "ready-for-agent-run";

  return {
    mode: "agent-spawn-readiness",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
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
