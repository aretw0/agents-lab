import {
  formatAuthorizationEvidence,
  GUARDRAILS_AUTHORIZATION_NONE,
  type GuardrailsAuthorizationNone,
} from "./guardrails-core-authorization";

export type LocalSliceCanaryDecision = "prepare-local-slice" | "stop-after-slice" | "blocked";

export interface LocalSliceCanaryInput {
  readinessReady: boolean;
  authorization: GuardrailsAuthorizationNone | "operator" | "unknown";
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

export interface LocalSliceCanaryPlan {
  effect: "none";
  mode: "advisory";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  singleSliceOnly: true;
  decision: LocalSliceCanaryDecision;
  canPrepareSlice: boolean;
  mustStopAfterSlice: boolean;
  reasons: string[];
  summary: string;
  recommendation: string;
}

export type LocalSliceCanaryDispatchPacketDecision = "ready-for-operator-decision" | "blocked";
export type LocalSliceCanaryOperatorIntent = "none" | "review" | "execute-local-slice";
export type LocalSliceOperatorDecisionKind = "missing" | "generic" | "explicit-task-action";
export type LocalSliceOperatorApprovedContractDecision = "contract-ready-no-executor" | "blocked";
export type LocalSliceBacklogGateDecision = "ready-for-separate-task" | "blocked";

export interface LocalSliceCanaryDispatchPacketInput {
  plan: Pick<LocalSliceCanaryPlan, "decision" | "canPrepareSlice" | "mustStopAfterSlice" | "singleSliceOnly" | "authorization">;
  rollbackPlanKnown: boolean;
  validationGateKnown: boolean;
  stagingScopeKnown: boolean;
  commitScopeKnown: boolean;
  checkpointPlanned: boolean;
  stopContractKnown: boolean;
  repeatRequested?: boolean;
  operatorIntent?: LocalSliceCanaryOperatorIntent;
}

export interface LocalSliceCanaryDispatchDecisionPacket {
  effect: "none";
  mode: "decision-packet";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  requiresOperatorDecision: true;
  singleSliceOnly: true;
  decision: LocalSliceCanaryDispatchPacketDecision;
  reasons: string[];
  summary: string;
  recommendation: string;
}

export interface LocalSliceOperatorApprovedContractInput {
  decisionPacket: Pick<LocalSliceCanaryDispatchDecisionPacket, "decision" | "dispatchAllowed" | "requiresOperatorDecision" | "singleSliceOnly" | "activation" | "authorization">;
  operatorDecision: LocalSliceOperatorDecisionKind;
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

export interface LocalSliceOperatorApprovedContractReview {
  effect: "none";
  mode: "contract-review";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  executorApproved: false;
  singleSliceOnly: true;
  decision: LocalSliceOperatorApprovedContractDecision;
  reasons: string[];
  summary: string;
  recommendation: string;
}

export interface LocalSliceBacklogGateInput {
  projectStrategyResolved: boolean;
  operatorPacketGreenValidated: boolean;
  operatorPacketFailClosedValidated: boolean;
  operatorPacketMissingFilesValidated: boolean;
  explicitOperatorContractDefined: boolean;
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

export interface LocalSliceBacklogGate {
  effect: "none";
  mode: "backlog-gate";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  executorApproved: false;
  implementationAllowed: false;
  singleSliceOnly: true;
  decision: LocalSliceBacklogGateDecision;
  reasons: string[];
  summary: string;
  recommendation: string;
}


export type ControlPlaneProfileDecision = "ready-for-operator-decision" | "blocked";
export type ControlPlaneProfileKind = "local-safe-single-slice" | "bounded-batch-candidate" | "worker-assisted-candidate" | "blocked-protected-scope";
export type ControlPlaneProfileNextAction =
  | "prepare-single-slice-contract"
  | "present-bounded-batch-decision"
  | "run-worker-intake-readiness"
  | "resolve-blocked-intent";

export interface ControlPlaneProfilePacketInput {
  intent?: string;
  autonomyRequest?: "single-slice" | "bounded-batch" | "worker-assisted" | "unknown" | string;
  availableResources?: string[];
  expectedRoi?: string;
  limits?: string[];
  stopConditions?: string[];
  operatorFocusKnown?: boolean;
  validationKnown?: boolean;
  rollbackKnown?: boolean;
  checkpointPlanned?: boolean;
  protectedScopeRequested?: boolean;
  schedulerRequested?: boolean;
  remoteOrOffloadRequested?: boolean;
  githubActionsRequested?: boolean;
  workerRequested?: boolean;
}

export interface ControlPlaneProfilePacket {
  effect: "none";
  mode: "report-only";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  mutationAllowed: false;
  decision: ControlPlaneProfileDecision;
  profile: ControlPlaneProfileKind;
  autonomy: "single-slice" | "bounded-batch-candidate" | "worker-assisted-candidate";
  intent: string;
  roi: string;
  resources: string[];
  availableCapabilities: string[];
  limits: string[];
  stopConditions: string[];
  missingQuestions: string[];
  missingCapabilities: string[];
  blockedRequests: string[];
  operatorDecisionNeeded: true;
  nextAction: ControlPlaneProfileNextAction;
  summary: string;
  recommendation: string;
  recommendedNextAction: string;
}

function boundedProfileList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized.slice(0, 80));
    if (out.length >= maxItems) break;
  }
  return out;
}

function boundedProfileText(value: unknown, fallback: string, maxLength = 120): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : fallback;
}

export function buildControlPlaneProfilePacket(input: ControlPlaneProfilePacketInput = {}): ControlPlaneProfilePacket {
  const resources = boundedProfileList(input.availableResources, 8);
  const limits = boundedProfileList(input.limits, 8);
  const stopConditions = boundedProfileList(input.stopConditions, 8);
  const intent = boundedProfileText(input.intent, "unspecified");
  const roi = boundedProfileText(input.expectedRoi, "reduce operator ambiguity before local-safe work");
  const blockedRequests: string[] = [];
  const missingQuestions: string[] = [];

  if (input.protectedScopeRequested) blockedRequests.push("protected-scope");
  if (input.schedulerRequested) blockedRequests.push("scheduler");
  if (input.remoteOrOffloadRequested) blockedRequests.push("remote-or-offload");
  if (input.githubActionsRequested) blockedRequests.push("github-actions");

  const missingCapabilities: string[] = [];
  if (!input.operatorFocusKnown) {
    missingQuestions.push("Which single focus should the control-plane optimize for first?");
    missingCapabilities.push("operator-focus");
  }
  if (!input.validationKnown) {
    missingQuestions.push("Which focal validation proves the first slice?");
    missingCapabilities.push("validation-gate");
  }
  if (!input.rollbackKnown) {
    missingQuestions.push("What rollback path is acceptable for this work?");
    missingCapabilities.push("rollback-path");
  }
  if (!input.checkpointPlanned) {
    missingQuestions.push("Where should the checkpoint/handoff be recorded?");
    missingCapabilities.push("checkpoint-target");
  }
  if (limits.length === 0) {
    missingQuestions.push("What limits should constrain autonomy, cost, scope, or time?");
    missingCapabilities.push("autonomy-limits");
  }
  if (stopConditions.length === 0) {
    missingQuestions.push("Which stop conditions require pausing for the operator?");
    missingCapabilities.push("stop-conditions");
  }

  const requested = input.autonomyRequest === "bounded-batch" || input.autonomyRequest === "worker-assisted" || input.autonomyRequest === "single-slice"
    ? input.autonomyRequest
    : input.workerRequested
      ? "worker-assisted"
      : "single-slice";
  const autonomy = requested === "worker-assisted"
    ? "worker-assisted-candidate"
    : requested === "bounded-batch"
      ? "bounded-batch-candidate"
      : "single-slice";
  const profile: ControlPlaneProfileKind = blockedRequests.length > 0
    ? "blocked-protected-scope"
    : autonomy === "worker-assisted-candidate"
      ? "worker-assisted-candidate"
      : autonomy === "bounded-batch-candidate"
        ? "bounded-batch-candidate"
        : "local-safe-single-slice";
  const decision: ControlPlaneProfileDecision = blockedRequests.length > 0 ? "blocked" : "ready-for-operator-decision";
  const recommendation = decision === "blocked"
    ? "Keep the control-plane profile report-only; remove protected requests or ask for explicit operator authorization."
    : autonomy === "single-slice"
      ? "Prepare one local-safe slice with validation, rollback, checkpoint, and explicit stop conditions."
      : "Present this as an operator decision packet; batch or worker capability remains candidate-only until lower gates approve it.";
  const nextAction: ControlPlaneProfileNextAction = decision === "blocked"
    ? "resolve-blocked-intent"
    : autonomy === "worker-assisted-candidate"
      ? "run-worker-intake-readiness"
      : autonomy === "bounded-batch-candidate"
        ? "present-bounded-batch-decision"
        : "prepare-single-slice-contract";
  const blockedSummary = blockedRequests.length > 0 ? " blocked=" + blockedRequests.slice(0, 4).join("|") : " blocked=none";

  return {
    effect: "none",
    mode: "report-only",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    mutationAllowed: false,
    decision,
    profile,
    autonomy,
    intent,
    roi,
    resources,
    availableCapabilities: resources,
    limits,
    stopConditions,
    missingQuestions: missingQuestions.slice(0, 4),
    missingCapabilities: missingCapabilities.slice(0, 4),
    blockedRequests,
    operatorDecisionNeeded: true,
    nextAction,
    summary: "control-plane-profile-packet: decision=" + decision + " profile=" + profile + " autonomy=" + autonomy + " next=" + nextAction + " questions=" + Math.min(missingQuestions.length, 4) + blockedSummary + " " + formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE),
    recommendation,
    recommendedNextAction: recommendation,
  };
}


export type LocalBatchManifestDecision = "ready-for-operator-decision" | "blocked";
export type LocalBatchManifestKind = "missing" | "generic" | "explicit-local-batch";

export interface LocalBatchManifestPacketInput {
  profilePacket: Pick<ControlPlaneProfilePacket, "decision" | "profile" | "dispatchAllowed" | "mutationAllowed" | "authorization" | "mode">;
  manifestation: LocalBatchManifestKind;
  subject?: string;
  focusTaskId?: string;
  localSafeScope: boolean;
  sliceLimit?: number;
  timeBudgetKnown: boolean;
  costBudgetKnown: boolean;
  validationGateKnown: boolean;
  rollbackPlanKnown: boolean;
  checkpointPlanned: boolean;
  stopConditions?: string[];
  protectedScopeRequested?: boolean;
  schedulerRequested?: boolean;
  remoteOrOffloadRequested?: boolean;
  githubActionsRequested?: boolean;
  workerRequested?: boolean;
}

export interface LocalBatchManifestPacket {
  effect: "none";
  mode: "manifest-packet";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  mutationAllowed: false;
  executorApproved: false;
  batchExecutionAllowed: false;
  workerDispatchAllowed: false;
  requiresOperatorDecision: true;
  decision: LocalBatchManifestDecision;
  manifestation: LocalBatchManifestKind;
  subject: string;
  focusTaskId: string;
  sliceLimit: number;
  stopConditions: string[];
  reasons: string[];
  blockedRequests: string[];
  summary: string;
  recommendation: string;
}

function boundedSliceLimit(value: unknown): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(5, Math.floor(Number(value)))) : 3;
}

export function buildLocalBatchManifestPacket(input: LocalBatchManifestPacketInput): LocalBatchManifestPacket {
  const reasons: string[] = [];
  const blockedRequests: string[] = [];
  const stopConditions = boundedProfileList(input.stopConditions, 8);
  const subject = boundedProfileText(input.subject, "unspecified", 100);
  const focusTaskId = boundedProfileText(input.focusTaskId, "unspecified", 80);
  const sliceLimit = boundedSliceLimit(input.sliceLimit);

  if (input.profilePacket.decision !== "ready-for-operator-decision") reasons.push("profile-packet-not-ready");
  if (input.profilePacket.dispatchAllowed !== false) reasons.push("profile-dispatch-not-false");
  if (input.profilePacket.mutationAllowed !== false) reasons.push("profile-mutation-not-false");
  if (input.profilePacket.authorization !== "none") reasons.push("profile-authorization-not-none");
  if (input.profilePacket.mode !== "report-only") reasons.push("profile-mode-not-report-only");
  if (input.manifestation !== "explicit-local-batch") reasons.push(input.manifestation === "generic" ? "manifestation-generic" : "manifestation-missing");
  if (subject === "unspecified") reasons.push("subject-missing");
  if (focusTaskId === "unspecified") reasons.push("focus-task-missing");
  if (!input.localSafeScope) reasons.push("local-safe-scope-missing");
  if (!input.validationGateKnown) reasons.push("validation-gate-missing");
  if (!input.rollbackPlanKnown) reasons.push("rollback-plan-missing");
  if (!input.checkpointPlanned) reasons.push("checkpoint-plan-missing");
  if (!input.timeBudgetKnown) reasons.push("time-budget-missing");
  if (!input.costBudgetKnown) reasons.push("cost-budget-missing");
  if (stopConditions.length === 0) reasons.push("stop-conditions-missing");

  if (input.protectedScopeRequested) { reasons.push("protected-scope-requested"); blockedRequests.push("protected-scope"); }
  if (input.schedulerRequested) { reasons.push("scheduler-requested"); blockedRequests.push("scheduler"); }
  if (input.remoteOrOffloadRequested) { reasons.push("remote-or-offload-requested"); blockedRequests.push("remote-or-offload"); }
  if (input.githubActionsRequested) { reasons.push("github-actions-requested"); blockedRequests.push("github-actions"); }
  if (input.workerRequested) { reasons.push("worker-requested-needs-lower-gate"); blockedRequests.push("worker"); }

  const decision: LocalBatchManifestDecision = reasons.length > 0 ? "blocked" : "ready-for-operator-decision";
  const blockedSummary = blockedRequests.length > 0 ? " blockedRequests=" + blockedRequests.slice(0, 5).join("|") : "";
  const summary = decision === "ready-for-operator-decision"
    ? "local-batch-manifest-packet: decision=ready-for-operator-decision batch=no dispatch=no worker=no slices=" + sliceLimit + " reasons=manifest-explicit,contracts-present " + formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE)
    : "local-batch-manifest-packet: decision=blocked batch=no dispatch=no worker=no reasons=" + reasons.slice(0, 4).join(",") + blockedSummary + " " + formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE);

  return {
    effect: "none",
    mode: "manifest-packet",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    mutationAllowed: false,
    executorApproved: false,
    batchExecutionAllowed: false,
    workerDispatchAllowed: false,
    requiresOperatorDecision: true,
    decision,
    manifestation: input.manifestation,
    subject,
    focusTaskId,
    sliceLimit,
    stopConditions,
    reasons: decision === "ready-for-operator-decision" ? ["manifest-explicit", "contracts-present", "execution-still-not-authorized"] : reasons,
    blockedRequests,
    summary,
    recommendation: decision === "ready-for-operator-decision"
      ? "Present the bounded local-safe batch manifestation for operator decision; do not dispatch or start workers from this packet."
      : "Do not prepare a batch; resolve the missing local-safe contracts or protected requests first.",
  };
}

export function resolveLocalSliceCanaryPlan(input: LocalSliceCanaryInput): LocalSliceCanaryPlan {
  const reasons: string[] = [];

  if (input.sliceAlreadyCompleted) {
    return {
      effect: "none",
      mode: "advisory",
      activation: "none",
      authorization: GUARDRAILS_AUTHORIZATION_NONE,
      singleSliceOnly: true,
      decision: "stop-after-slice",
      canPrepareSlice: false,
      mustStopAfterSlice: true,
      reasons: ["slice-complete", "single-slice-limit"],
      summary: `local-slice-canary: decision=stop-after-slice prepare=no stop=yes reasons=slice-complete,single-slice-limit ${formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE)}`,
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
      authorization: GUARDRAILS_AUTHORIZATION_NONE,
      singleSliceOnly: true,
      decision: "blocked",
      canPrepareSlice: false,
      mustStopAfterSlice: true,
      reasons,
      summary: `local-slice-canary: decision=blocked prepare=no stop=yes reasons=${reasons.slice(0, 4).join(",")} ${formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE)}`,
      recommendation: "Do not prepare the canary slice; resolve blockers or ask the operator before any local unattended dispatch.",
    };
  }

  return {
    effect: "none",
    mode: "advisory",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    singleSliceOnly: true,
    decision: "prepare-local-slice",
    canPrepareSlice: true,
    mustStopAfterSlice: true,
    reasons: ["readiness-green", "single-slice-only"],
    summary: `local-slice-canary: decision=prepare-local-slice prepare=yes stop=yes reasons=readiness-green,single-slice-only ${formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE)}`,
    recommendation: "Prepare at most one local-safe slice, then validate, commit, checkpoint, and stop.",
  };
}

export function buildLocalSliceCanaryDispatchDecisionPacket(input: LocalSliceCanaryDispatchPacketInput): LocalSliceCanaryDispatchDecisionPacket {
  const reasons: string[] = [];

  if (input.plan.decision !== "prepare-local-slice" || !input.plan.canPrepareSlice) reasons.push("preview-not-ready");
  if (!input.plan.mustStopAfterSlice) reasons.push("stop-after-slice-missing");
  if (!input.plan.singleSliceOnly) reasons.push("single-slice-contract-missing");
  if (input.plan.authorization !== "none") reasons.push(`plan-authorization-${input.plan.authorization}`);
  if (!input.rollbackPlanKnown) reasons.push("rollback-plan-missing");
  if (!input.validationGateKnown) reasons.push("validation-gate-missing");
  if (!input.stagingScopeKnown) reasons.push("staging-scope-missing");
  if (!input.commitScopeKnown) reasons.push("commit-scope-missing");
  if (!input.checkpointPlanned) reasons.push("checkpoint-plan-missing");
  if (!input.stopContractKnown) reasons.push("stop-contract-missing");
  if (input.repeatRequested) reasons.push("repeat-requested");
  if (input.operatorIntent === "execute-local-slice") reasons.push("execute-intent-recorded-not-authorization");

  if (reasons.length > 0) {
    return {
      effect: "none",
      mode: "decision-packet",
      activation: "none",
      authorization: GUARDRAILS_AUTHORIZATION_NONE,
      dispatchAllowed: false,
      requiresOperatorDecision: true,
      singleSliceOnly: true,
      decision: "blocked",
      reasons,
      summary: `local-slice-dispatch-decision-packet: decision=blocked dispatch=no reasons=${reasons.slice(0, 4).join(",")} ${formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE)}`,
      recommendation: "Do not dispatch; complete the missing contracts and ask for an explicit operator decision first.",
    };
  }

  return {
    effect: "none",
    mode: "decision-packet",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    requiresOperatorDecision: true,
    singleSliceOnly: true,
    decision: "ready-for-operator-decision",
    reasons: ["preview-ready", "contracts-present", "operator-decision-required"],
    summary: `local-slice-dispatch-decision-packet: decision=ready-for-operator-decision dispatch=no reasons=preview-ready,contracts-present,operator-decision-required ${formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE)}`,
    recommendation: "Present this packet to the operator; do not dispatch until a separate execution path is explicitly authorized.",
  };
}

export function resolveLocalSliceBacklogGate(input: LocalSliceBacklogGateInput): LocalSliceBacklogGate {
  const reasons: string[] = [];
  const blockedRequests: string[] = [];

  if (!input.projectStrategyResolved) reasons.push("project-strategy-missing");
  if (!input.operatorPacketGreenValidated) reasons.push("operator-packet-green-missing");
  if (!input.operatorPacketFailClosedValidated) reasons.push("operator-packet-fail-closed-missing");
  if (!input.operatorPacketMissingFilesValidated) reasons.push("operator-packet-missing-files-missing");
  if (!input.explicitOperatorContractDefined) reasons.push("explicit-operator-contract-missing");
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
      authorization: GUARDRAILS_AUTHORIZATION_NONE,
      dispatchAllowed: false,
      executorApproved: false,
      implementationAllowed: false,
      singleSliceOnly: true,
      decision: "blocked",
      reasons,
      summary: `local-slice-backlog-gate: decision=blocked implementation=no dispatch=no executor=no reasons=${reasons.slice(0, 4).join(",")}${blockedRequestsSummary} ${formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE)}`,
      recommendation: "Do not implement or use an executor; resolve the backlog-gate blockers in a separate design task first.",
    };
  }

  return {
    effect: "none",
    mode: "backlog-gate",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    executorApproved: false,
    implementationAllowed: false,
    singleSliceOnly: true,
    decision: "ready-for-separate-task",
    reasons: ["criteria-present", "separate-task-required", "implementation-still-not-authorized"],
    summary: `local-slice-backlog-gate: decision=ready-for-separate-task implementation=no dispatch=no executor=no reasons=criteria-present,separate-task-required,implementation-still-not-authorized ${formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE)}`,
    recommendation: "The executor idea is eligible for a separate design/backlog task only; implementation and dispatch remain unauthorized.",
  };
}

export function reviewLocalSliceOperatorApprovedContract(input: LocalSliceOperatorApprovedContractInput): LocalSliceOperatorApprovedContractReview {
  const reasons: string[] = [];
  const blockedRequests: string[] = [];

  if (input.decisionPacket.decision !== "ready-for-operator-decision") reasons.push("packet-not-ready");
  if (input.decisionPacket.dispatchAllowed !== false) reasons.push("packet-dispatch-not-false");
  if (!input.decisionPacket.requiresOperatorDecision) reasons.push("operator-decision-not-required");
  if (!input.decisionPacket.singleSliceOnly) reasons.push("single-slice-contract-missing");
  if (input.decisionPacket.activation !== "none") reasons.push(`packet-activation-${input.decisionPacket.activation}`);
  if (input.decisionPacket.authorization !== "none") reasons.push(`packet-authorization-${input.decisionPacket.authorization}`);
  if (input.operatorDecision === "missing") reasons.push("operator-decision-missing");
  if (input.operatorDecision === "generic") reasons.push("operator-decision-generic");
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
      authorization: GUARDRAILS_AUTHORIZATION_NONE,
      dispatchAllowed: false,
      executorApproved: false,
      singleSliceOnly: true,
      decision: "blocked",
      reasons,
      summary: `local-slice-operator-approved-contract: decision=blocked dispatch=no executor=no reasons=${reasons.slice(0, 4).join(",")}${blockedRequestsSummary} ${formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE)}`,
      recommendation: "Do not execute; resolve the contract blockers and keep using preview/readiness evidence until an approved executor exists.",
    };
  }

  return {
    effect: "none",
    mode: "contract-review",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    executorApproved: false,
    singleSliceOnly: true,
    decision: "contract-ready-no-executor",
    reasons: ["contract-valid", "operator-decision-explicit", "executor-not-approved"],
    summary: `local-slice-operator-approved-contract: decision=contract-ready-no-executor dispatch=no executor=no reasons=contract-valid,operator-decision-explicit,executor-not-approved ${formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE)}`,
    recommendation: "The proposed local-slice local contract is review-ready, but no executor is approved; keep dispatch disabled until a separate execution primitive is authorized.",
  };
}
