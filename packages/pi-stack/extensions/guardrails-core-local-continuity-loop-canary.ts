import {
  formatAuthorizationEvidence,
  GUARDRAILS_AUTHORIZATION_NONE,
  type GuardrailsAuthorizationNone,
} from "./guardrails-core-authorization";
import type { UnattendedContinuationContextLevel } from "./guardrails-core-unattended-continuation";

export type LocalContinuityLoopCanaryDecision = "prepare-one-slice" | "checkpoint-required" | "stop-after-slice" | "blocked";
export type LocalContinuityLoopCanaryNextAction = "prepare-slice" | "validate-slice" | "commit-slice" | "checkpoint" | "stop" | "ask-operator";

export interface LocalContinuityLoopCanaryInput {
  optIn?: boolean;
  dryRun?: boolean;
  selectedTaskId?: string;
  packetReady?: boolean;
  sliceExecuted?: boolean;
  validationPassed?: boolean;
  commitRecorded?: boolean;
  checkpointRecorded?: boolean;
  stopConditionsRechecked?: boolean;
  gitStateExpected?: boolean;
  protectedScopesClear?: boolean;
  rollbackPlanKnown?: boolean;
  budgetKnown?: boolean;
  contextLevel?: UnattendedContinuationContextLevel | string;
  stopConditionPresent?: boolean;
  repeatRequested?: boolean;
  schedulerRequested?: boolean;
  remoteOrOffloadRequested?: boolean;
  githubActionsRequested?: boolean;
  protectedScopeRequested?: boolean;
}

export interface LocalContinuityLoopCanaryPacket {
  effect: "none";
  mode: "dry-run-canary";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  executionAllowed: false;
  commitAllowed: false;
  checkpointAllowed: false;
  repeatAllowed: false;
  schedulerAllowed: false;
  remoteAllowed: false;
  singleSliceOnly: true;
  decision: LocalContinuityLoopCanaryDecision;
  nextAction: LocalContinuityLoopCanaryNextAction;
  selectedTaskId: string;
  cycleComplete: boolean;
  blockers: string[];
  completedStages: string[];
  pendingStages: string[];
  summary: string;
  recommendation: string;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

function normalizeContextLevel(value: unknown): UnattendedContinuationContextLevel {
  return value === "warn" || value === "checkpoint" || value === "compact" || value === "ok" ? value : "ok";
}

function pushStage(stages: string[], condition: boolean, name: string): void {
  if (condition) stages.push(name);
}

function firstPending(input: LocalContinuityLoopCanaryInput): LocalContinuityLoopCanaryNextAction {
  if (!input.packetReady || !input.sliceExecuted) return "prepare-slice";
  if (!input.validationPassed) return "validate-slice";
  if (!input.commitRecorded) return "commit-slice";
  if (!input.checkpointRecorded) return "checkpoint";
  return "stop";
}

export function buildLocalContinuityLoopCanaryPacket(input: LocalContinuityLoopCanaryInput = {}): LocalContinuityLoopCanaryPacket {
  const selectedTaskId = cleanText(input.selectedTaskId);
  const contextLevel = normalizeContextLevel(input.contextLevel);
  const blockers: string[] = [];

  if (input.optIn !== true) blockers.push("missing-opt-in");
  if (input.dryRun === false) blockers.push("execution-not-implemented");
  if (!selectedTaskId) blockers.push("selected-task-missing");
  if (input.gitStateExpected !== true) blockers.push("unexpected-git-state");
  if (input.protectedScopesClear !== true) blockers.push("protected-scope-pending");
  if (input.rollbackPlanKnown !== true) blockers.push("rollback-plan-missing");
  if (input.budgetKnown !== true) blockers.push("budget-missing");
  if (input.stopConditionPresent === true) blockers.push("stop-condition-present");
  if (contextLevel === "compact" && input.checkpointRecorded !== true) blockers.push("compact-without-checkpoint");
  if (input.repeatRequested) blockers.push("repeat-requested");
  if (input.schedulerRequested) blockers.push("scheduler-requested");
  if (input.remoteOrOffloadRequested) blockers.push("remote-or-offload-requested");
  if (input.githubActionsRequested) blockers.push("github-actions-requested");
  if (input.protectedScopeRequested) blockers.push("protected-scope-requested");

  const completedStages: string[] = [];
  pushStage(completedStages, Boolean(selectedTaskId), "select");
  pushStage(completedStages, input.packetReady === true, "packetize");
  pushStage(completedStages, input.sliceExecuted === true, "execute-or-preview");
  pushStage(completedStages, input.validationPassed === true, "validate");
  pushStage(completedStages, input.commitRecorded === true, "commit");
  pushStage(completedStages, input.checkpointRecorded === true, "checkpoint");
  pushStage(completedStages, input.stopConditionsRechecked === true, "recheck-stops");

  const pendingStages = ["select", "packetize", "execute-or-preview", "validate", "commit", "checkpoint", "recheck-stops"]
    .filter((stage) => !completedStages.includes(stage));
  const cycleComplete = pendingStages.length === 0 && blockers.length === 0;
  const nextAction = blockers.length > 0
    ? "ask-operator"
    : cycleComplete
      ? "stop"
      : firstPending(input);
  const decision: LocalContinuityLoopCanaryDecision = blockers.length > 0
    ? "blocked"
    : cycleComplete
      ? "stop-after-slice"
      : nextAction === "checkpoint"
        ? "checkpoint-required"
        : "prepare-one-slice";

  const summary = [
    "local-continuity-loop-canary:",
    `decision=${decision}`,
    `next=${nextAction}`,
    `task=${selectedTaskId || "none"}`,
    `complete=${cycleComplete ? "yes" : "no"}`,
    "singleSliceOnly=yes",
    "dispatch=no",
    "repeat=no",
    blockers.length > 0 ? `blockers=${blockers.slice(0, 5).join("|")}` : undefined,
    formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE),
  ].filter(Boolean).join(" ");

  return {
    effect: "none",
    mode: "dry-run-canary",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    executionAllowed: false,
    commitAllowed: false,
    checkpointAllowed: false,
    repeatAllowed: false,
    schedulerAllowed: false,
    remoteAllowed: false,
    singleSliceOnly: true,
    decision,
    nextAction,
    selectedTaskId,
    cycleComplete,
    blockers,
    completedStages,
    pendingStages,
    summary,
    recommendation: decision === "blocked"
      ? "Do not continue the loop; resolve blockers or ask the operator."
      : cycleComplete
        ? "Stop after this slice; any next iteration needs a fresh canary decision."
        : "Prepare only the next bounded local-safe stage, then validate this packet again.",
  };
}
