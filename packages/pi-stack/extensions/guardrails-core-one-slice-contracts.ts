export type OneSliceLocalCanaryDecision = "prepare-one-slice" | "stop-after-slice" | "blocked";

export interface OneSliceLocalCanaryInput {
  readinessReady: boolean;
  authorization: "none" | "operator" | "unknown";
  checkpointFresh: boolean;
  handoffBudgetOk: boolean;
  gitStateExpected: boolean;
  protectedScopesClear: boolean;
  validationKnown: boolean;
  stopConditionsClear: boolean;
  risk: boolean;
  ambiguous: boolean;
  repeatRequested?: boolean;
  sliceAlreadyCompleted?: boolean;
}

export interface OneSliceLocalCanaryPlan {
  effect: "none";
  mode: "advisory";
  activation: "none";
  authorization: "none";
  oneSliceOnly: true;
  decision: OneSliceLocalCanaryDecision;
  canPrepareSlice: boolean;
  mustStopAfterSlice: boolean;
  reasons: string[];
  summary: string;
  recommendation: string;
}

export type OneSliceLocalCanaryDispatchPacketDecision = "ready-for-human-decision" | "blocked";
export type OneSliceLocalCanaryOperatorIntent = "none" | "review" | "execute-one-slice";
export type OneSliceLocalHumanConfirmationKind = "missing" | "generic" | "explicit-task-action";
export type OneSliceLocalHumanConfirmedContractDecision = "contract-ready-no-executor" | "blocked";
export type OneSliceExecutorBacklogGateDecision = "ready-for-separate-task" | "blocked";

export interface OneSliceLocalCanaryDispatchPacketInput {
  plan: Pick<OneSliceLocalCanaryPlan, "decision" | "canPrepareSlice" | "mustStopAfterSlice" | "oneSliceOnly" | "authorization">;
  rollbackPlanKnown: boolean;
  validationGateKnown: boolean;
  stagingScopeKnown: boolean;
  commitScopeKnown: boolean;
  checkpointPlanned: boolean;
  stopContractKnown: boolean;
  repeatRequested?: boolean;
  operatorIntent?: OneSliceLocalCanaryOperatorIntent;
}

export interface OneSliceLocalCanaryDispatchDecisionPacket {
  effect: "none";
  mode: "decision-packet";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  requiresHumanDecision: true;
  oneSliceOnly: true;
  decision: OneSliceLocalCanaryDispatchPacketDecision;
  reasons: string[];
  summary: string;
  recommendation: string;
}

export interface OneSliceLocalHumanConfirmedContractInput {
  decisionPacket: Pick<OneSliceLocalCanaryDispatchDecisionPacket, "decision" | "dispatchAllowed" | "requiresHumanDecision" | "oneSliceOnly" | "activation" | "authorization">;
  humanConfirmation: OneSliceLocalHumanConfirmationKind;
  singleFocus: boolean;
  localSafeScope: boolean;
  declaredFilesKnown: boolean;
  protectedScopesClear: boolean;
  rollbackPlanKnown: boolean;
  validationGateKnown: boolean;
  stagingScopeKnown: boolean;
  commitScopeKnown: boolean;
  checkpointPlanned: boolean;
  stopContractKnown: boolean;
  repeatRequested?: boolean;
  schedulerRequested?: boolean;
  selfReloadRequested?: boolean;
  remoteOrOffloadRequested?: boolean;
  githubActionsRequested?: boolean;
  protectedScopeRequested?: boolean;
}

export interface OneSliceLocalHumanConfirmedContractReview {
  effect: "none";
  mode: "contract-review";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  executorApproved: false;
  oneSliceOnly: true;
  decision: OneSliceLocalHumanConfirmedContractDecision;
  reasons: string[];
  summary: string;
  recommendation: string;
}

export interface OneSliceExecutorBacklogGateInput {
  projectStrategyResolved: boolean;
  operatorPacketGreenValidated: boolean;
  operatorPacketFailClosedValidated: boolean;
  operatorPacketMissingFilesValidated: boolean;
  explicitHumanContractDefined: boolean;
  declaredFilesKnown: boolean;
  rollbackPlanKnown: boolean;
  validationGateKnown: boolean;
  stagingScopeKnown: boolean;
  commitScopeKnown: boolean;
  timeBudgetKnown: boolean;
  costBudgetKnown: boolean;
  cancellationKnown: boolean;
  checkpointPlanned: boolean;
  stopContractKnown: boolean;
  separateTaskRequired: boolean;
  startsDisabledOrDryRun: boolean;
  repeatRequested?: boolean;
  schedulerRequested?: boolean;
  selfReloadRequested?: boolean;
  remoteOrOffloadRequested?: boolean;
  githubActionsRequested?: boolean;
  protectedScopeRequested?: boolean;
  destructiveMaintenanceRequested?: boolean;
}

export interface OneSliceExecutorBacklogGate {
  effect: "none";
  mode: "backlog-gate";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  executorApproved: false;
  implementationAllowed: false;
  oneSliceOnly: true;
  decision: OneSliceExecutorBacklogGateDecision;
  reasons: string[];
  summary: string;
  recommendation: string;
}

export function resolveOneSliceLocalCanaryPlan(input: OneSliceLocalCanaryInput): OneSliceLocalCanaryPlan {
  const reasons: string[] = [];

  if (input.sliceAlreadyCompleted) {
    return {
      effect: "none",
      mode: "advisory",
      activation: "none",
      authorization: "none",
      oneSliceOnly: true,
      decision: "stop-after-slice",
      canPrepareSlice: false,
      mustStopAfterSlice: true,
      reasons: ["slice-complete", "one-slice-limit"],
      summary: "one-slice-local-canary: decision=stop-after-slice prepare=no stop=yes reasons=slice-complete,one-slice-limit authorization=none",
      recommendation: "Stop after this slice; any repetition needs a separate cooldown/iteration contract and operator authorization.",
    };
  }

  if (input.repeatRequested) reasons.push("repeat-requested");
  if (!input.readinessReady) reasons.push("readiness-not-ready");
  if (input.authorization !== "none") reasons.push(`authorization-${input.authorization}`);
  if (!input.checkpointFresh) reasons.push("checkpoint-not-fresh");
  if (!input.handoffBudgetOk) reasons.push("handoff-budget-not-ok");
  if (!input.gitStateExpected) reasons.push("git-state-unexpected");
  if (!input.protectedScopesClear) reasons.push("protected-scope");
  if (!input.validationKnown) reasons.push("validation-unknown");
  if (!input.stopConditionsClear) reasons.push("stop-conditions-present");
  if (input.risk) reasons.push("risk");
  if (input.ambiguous) reasons.push("ambiguous");

  if (reasons.length > 0) {
    return {
      effect: "none",
      mode: "advisory",
      activation: "none",
      authorization: "none",
      oneSliceOnly: true,
      decision: "blocked",
      canPrepareSlice: false,
      mustStopAfterSlice: true,
      reasons,
      summary: `one-slice-local-canary: decision=blocked prepare=no stop=yes reasons=${reasons.slice(0, 4).join(",")} authorization=none`,
      recommendation: "Do not prepare the canary slice; resolve blockers or ask the operator before any local unattended dispatch.",
    };
  }

  return {
    effect: "none",
    mode: "advisory",
    activation: "none",
    authorization: "none",
    oneSliceOnly: true,
    decision: "prepare-one-slice",
    canPrepareSlice: true,
    mustStopAfterSlice: true,
    reasons: ["readiness-green", "one-slice-only"],
    summary: "one-slice-local-canary: decision=prepare-one-slice prepare=yes stop=yes reasons=readiness-green,one-slice-only authorization=none",
    recommendation: "Prepare at most one local-safe slice, then validate, commit, checkpoint, and stop.",
  };
}

export function buildOneSliceLocalCanaryDispatchDecisionPacket(input: OneSliceLocalCanaryDispatchPacketInput): OneSliceLocalCanaryDispatchDecisionPacket {
  const reasons: string[] = [];

  if (input.plan.decision !== "prepare-one-slice" || !input.plan.canPrepareSlice) reasons.push("preview-not-ready");
  if (!input.plan.mustStopAfterSlice) reasons.push("stop-after-slice-missing");
  if (!input.plan.oneSliceOnly) reasons.push("one-slice-contract-missing");
  if (input.plan.authorization !== "none") reasons.push(`plan-authorization-${input.plan.authorization}`);
  if (!input.rollbackPlanKnown) reasons.push("rollback-plan-missing");
  if (!input.validationGateKnown) reasons.push("validation-gate-missing");
  if (!input.stagingScopeKnown) reasons.push("staging-scope-missing");
  if (!input.commitScopeKnown) reasons.push("commit-scope-missing");
  if (!input.checkpointPlanned) reasons.push("checkpoint-plan-missing");
  if (!input.stopContractKnown) reasons.push("stop-contract-missing");
  if (input.repeatRequested) reasons.push("repeat-requested");
  if (input.operatorIntent === "execute-one-slice") reasons.push("execute-intent-recorded-not-authorization");

  if (reasons.length > 0) {
    return {
      effect: "none",
      mode: "decision-packet",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      requiresHumanDecision: true,
      oneSliceOnly: true,
      decision: "blocked",
      reasons,
      summary: `one-slice-dispatch-decision-packet: decision=blocked dispatch=no reasons=${reasons.slice(0, 4).join(",")} authorization=none`,
      recommendation: "Do not dispatch; complete the missing contracts and ask for an explicit human decision first.",
    };
  }

  return {
    effect: "none",
    mode: "decision-packet",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    requiresHumanDecision: true,
    oneSliceOnly: true,
    decision: "ready-for-human-decision",
    reasons: ["preview-ready", "contracts-present", "human-decision-required"],
    summary: "one-slice-dispatch-decision-packet: decision=ready-for-human-decision dispatch=no reasons=preview-ready,contracts-present,human-decision-required authorization=none",
    recommendation: "Present this packet to the operator; do not dispatch until a separate execution path is explicitly authorized.",
  };
}

export function resolveOneSliceExecutorBacklogGate(input: OneSliceExecutorBacklogGateInput): OneSliceExecutorBacklogGate {
  const reasons: string[] = [];
  const blockedRequests: string[] = [];

  if (!input.projectStrategyResolved) reasons.push("project-strategy-missing");
  if (!input.operatorPacketGreenValidated) reasons.push("operator-packet-green-missing");
  if (!input.operatorPacketFailClosedValidated) reasons.push("operator-packet-fail-closed-missing");
  if (!input.operatorPacketMissingFilesValidated) reasons.push("operator-packet-missing-files-missing");
  if (!input.explicitHumanContractDefined) reasons.push("explicit-human-contract-missing");
  if (!input.declaredFilesKnown) reasons.push("declared-files-missing");
  if (!input.rollbackPlanKnown) reasons.push("rollback-plan-missing");
  if (!input.validationGateKnown) reasons.push("validation-gate-missing");
  if (!input.stagingScopeKnown) reasons.push("staging-scope-missing");
  if (!input.commitScopeKnown) reasons.push("commit-scope-missing");
  if (!input.timeBudgetKnown) reasons.push("time-budget-missing");
  if (!input.costBudgetKnown) reasons.push("cost-budget-missing");
  if (!input.cancellationKnown) reasons.push("cancellation-missing");
  if (!input.checkpointPlanned) reasons.push("checkpoint-plan-missing");
  if (!input.stopContractKnown) reasons.push("stop-contract-missing");
  if (!input.separateTaskRequired) reasons.push("separate-task-missing");
  if (!input.startsDisabledOrDryRun) reasons.push("disabled-or-dry-run-missing");
  if (input.repeatRequested) {
    reasons.push("repeat-requested");
    blockedRequests.push("repeat");
  }
  if (input.schedulerRequested) {
    reasons.push("scheduler-requested");
    blockedRequests.push("scheduler");
  }
  if (input.selfReloadRequested) {
    reasons.push("self-reload-requested");
    blockedRequests.push("self-reload");
  }
  if (input.remoteOrOffloadRequested) {
    reasons.push("remote-or-offload-requested");
    blockedRequests.push("remote-or-offload");
  }
  if (input.githubActionsRequested) {
    reasons.push("github-actions-requested");
    blockedRequests.push("github-actions");
  }
  if (input.protectedScopeRequested) {
    reasons.push("protected-scope-requested");
    blockedRequests.push("protected-scope");
  }
  if (input.destructiveMaintenanceRequested) {
    reasons.push("destructive-maintenance-requested");
    blockedRequests.push("destructive-maintenance");
  }

  if (reasons.length > 0) {
    const blockedRequestsSummary = blockedRequests.length > 0 ? ` blockedRequests=${blockedRequests.slice(0, 7).join("|")}` : "";
    return {
      effect: "none",
      mode: "backlog-gate",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      executorApproved: false,
      implementationAllowed: false,
      oneSliceOnly: true,
      decision: "blocked",
      reasons,
      summary: `one-slice-executor-backlog-gate: decision=blocked implementation=no dispatch=no executor=no reasons=${reasons.slice(0, 4).join(",")}${blockedRequestsSummary} authorization=none`,
      recommendation: "Do not implement or use an executor; resolve the backlog-gate blockers in a separate design task first.",
    };
  }

  return {
    effect: "none",
    mode: "backlog-gate",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    executorApproved: false,
    implementationAllowed: false,
    oneSliceOnly: true,
    decision: "ready-for-separate-task",
    reasons: ["criteria-present", "separate-task-required", "implementation-still-not-authorized"],
    summary: "one-slice-executor-backlog-gate: decision=ready-for-separate-task implementation=no dispatch=no executor=no reasons=criteria-present,separate-task-required,implementation-still-not-authorized authorization=none",
    recommendation: "The executor idea is eligible for a separate design/backlog task only; implementation and dispatch remain unauthorized.",
  };
}

export function reviewOneSliceLocalHumanConfirmedContract(input: OneSliceLocalHumanConfirmedContractInput): OneSliceLocalHumanConfirmedContractReview {
  const reasons: string[] = [];
  const blockedRequests: string[] = [];

  if (input.decisionPacket.decision !== "ready-for-human-decision") reasons.push("packet-not-ready");
  if (input.decisionPacket.dispatchAllowed !== false) reasons.push("packet-dispatch-not-false");
  if (!input.decisionPacket.requiresHumanDecision) reasons.push("human-decision-not-required");
  if (!input.decisionPacket.oneSliceOnly) reasons.push("one-slice-contract-missing");
  if (input.decisionPacket.activation !== "none") reasons.push(`packet-activation-${input.decisionPacket.activation}`);
  if (input.decisionPacket.authorization !== "none") reasons.push(`packet-authorization-${input.decisionPacket.authorization}`);
  if (input.humanConfirmation === "missing") reasons.push("human-confirmation-missing");
  if (input.humanConfirmation === "generic") reasons.push("human-confirmation-generic");
  if (!input.singleFocus) reasons.push("single-focus-missing");
  if (!input.localSafeScope) reasons.push("local-safe-scope-missing");
  if (!input.declaredFilesKnown) reasons.push("declared-files-missing");
  if (!input.protectedScopesClear) reasons.push("protected-scope");
  if (!input.rollbackPlanKnown) reasons.push("rollback-plan-missing");
  if (!input.validationGateKnown) reasons.push("validation-gate-missing");
  if (!input.stagingScopeKnown) reasons.push("staging-scope-missing");
  if (!input.commitScopeKnown) reasons.push("commit-scope-missing");
  if (!input.checkpointPlanned) reasons.push("checkpoint-plan-missing");
  if (!input.stopContractKnown) reasons.push("stop-contract-missing");
  if (input.repeatRequested) {
    reasons.push("repeat-requested");
    blockedRequests.push("repeat");
  }
  if (input.schedulerRequested) {
    reasons.push("scheduler-requested");
    blockedRequests.push("scheduler");
  }
  if (input.selfReloadRequested) {
    reasons.push("self-reload-requested");
    blockedRequests.push("self-reload");
  }
  if (input.remoteOrOffloadRequested) {
    reasons.push("remote-or-offload-requested");
    blockedRequests.push("remote-or-offload");
  }
  if (input.githubActionsRequested) {
    reasons.push("github-actions-requested");
    blockedRequests.push("github-actions");
  }
  if (input.protectedScopeRequested) {
    reasons.push("protected-scope-requested");
    blockedRequests.push("protected-scope");
  }

  if (reasons.length > 0) {
    const blockedRequestsSummary = blockedRequests.length > 0 ? ` blockedRequests=${blockedRequests.slice(0, 6).join("|")}` : "";
    return {
      effect: "none",
      mode: "contract-review",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      executorApproved: false,
      oneSliceOnly: true,
      decision: "blocked",
      reasons,
      summary: `one-slice-human-confirmed-contract: decision=blocked dispatch=no executor=no reasons=${reasons.slice(0, 4).join(",")}${blockedRequestsSummary} authorization=none`,
      recommendation: "Do not execute; resolve the contract blockers and keep using preview/readiness evidence until an approved executor exists.",
    };
  }

  return {
    effect: "none",
    mode: "contract-review",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    executorApproved: false,
    oneSliceOnly: true,
    decision: "contract-ready-no-executor",
    reasons: ["contract-valid", "human-confirmation-explicit", "executor-not-approved"],
    summary: "one-slice-human-confirmed-contract: decision=contract-ready-no-executor dispatch=no executor=no reasons=contract-valid,human-confirmation-explicit,executor-not-approved authorization=none",
    recommendation: "The proposed one-slice local contract is review-ready, but no executor is approved; keep dispatch disabled until a separate execution primitive is authorized.",
  };
}
