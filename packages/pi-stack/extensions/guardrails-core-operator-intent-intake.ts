import {
  buildControlPlaneProfilePacket,
  type ControlPlaneProfilePacket,
  type ControlPlaneProfilePacketInput,
} from "./guardrails-core-local-slice-contracts";
import { GUARDRAILS_AUTHORIZATION_NONE, type GuardrailsAuthorizationNone } from "./guardrails-core-authorization";

export type OperatorIntentIntakeDecision =
  | "ask-operator"
  | "check-runtime-health"
  | "check-worker-readiness"
  | "seed-brainstorm"
  | "prepare-single-slice"
  | "prepare-worker-packet"
  | "blocked";

export type OperatorIntentControlPlaneAction =
  | "ask-operator"
  | "run-report-only-route"
  | "stop-and-report";

export type OperatorIntentNextAction =
  | "answer-next-question"
  | "run-runtime-health-checks"
  | "run-brainstorm-seed-preview"
  | "prepare-single-slice-contract"
  | "run-worker-readiness-checks"
  | "prepare-worker-packet"
  | "resolve-blocked-intent";

export type OperatorIntentRecommendationCode =
  | "operator-intent-ask-operator"
  | "operator-intent-check-runtime-health"
  | "operator-intent-seed-brainstorm"
  | "operator-intent-prepare-single-slice"
  | "operator-intent-check-worker-readiness"
  | "operator-intent-prepare-worker-packet"
  | "operator-intent-blocked";

export interface OperatorIntentIntakeInput extends ControlPlaneProfilePacketInput {
  localSafeMaterialReady?: boolean;
  runtimeHealthRequested?: boolean;
  brainstormRequested?: boolean;
  noEligibleLocalSafeTasks?: boolean;
  runtimeHealthReady?: boolean;
  subagentsReady?: boolean;
  providerReady?: boolean;
}

export interface OperatorIntentChoice {
  id: string;
  label: string;
  description: string;
  route: string;
}

export interface OperatorIntentInteraction {
  kind: "operator-choice";
  prompt: string;
  choices: OperatorIntentChoice[];
  recommendedChoiceId: string;
  allowCustomAnswer: true;
  allowCancel: true;
  uiHints: {
    preferred: "choice-list";
    fallback: "compact-text";
  };
}

export interface OperatorIntentIntakePacket {
  effect: "none";
  mode: "operator-intent-intake";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  mutationAllowed: false;
  workerDispatchAllowed: false;
  decision: OperatorIntentIntakeDecision;
  recommendedRoute: string;
  recommendedTools: string[];
  operatorDecisionNeeded: boolean;
  reportOnlyRouteAuthorized: boolean;
  operatorPromptRequired: boolean;
  controlPlaneAction: OperatorIntentControlPlaneAction;
  nextAction: OperatorIntentNextAction;
  confirmationRequired: boolean;
  confirmationReason: string;
  profilePacket: ControlPlaneProfilePacket;
  missingQuestions: string[];
  blockedRequests: string[];
  missingCapabilities: string[];
  interaction: OperatorIntentInteraction;
  summary: string;
  recommendationCode: OperatorIntentRecommendationCode;
  recommendation: string;
}

function buildInteraction(decision: OperatorIntentIntakeDecision, tools: string[], questions: string[]): OperatorIntentInteraction {
  const choices: OperatorIntentChoice[] = [];

  if (decision === "ask-operator") {
    choices.push({
      id: "answer-next-question",
      label: "Answer next question",
      description: questions[0] ?? "Fill the next missing control-plane input.",
      route: "structured_interview_plan",
    });
  }
  if (decision === "check-runtime-health") {
    choices.push({
      id: "check-runtime-health",
      label: "Check runtime health",
      description: "Run read-only runtime pressure and artifact checks before work starts.",
      route: tools.join("+"),
    });
  }
  if (decision === "seed-brainstorm") {
    choices.push({
      id: "seed-brainstorm",
      label: "Seed brainstorm",
      description: "Prepare local-safe candidate slices without mutating files.",
      route: "lane_brainstorm_packet",
    });
  }
  if (decision === "prepare-single-slice") {
    choices.push({
      id: "prepare-single-slice",
      label: "Prepare single slice",
      description: "Keep work local-safe, bounded, validated, and checkpointed.",
      route: "control_plane_profile_packet",
    });
  }
  if (decision === "prepare-worker-packet") {
    choices.push({
      id: "prepare-worker-packet",
      label: "Prepare worker packet",
      description: "Build a worker packet for operator review; do not dispatch.",
      route: "agent_run_operator_packet",
    });
  }
  if (decision === "check-worker-readiness") {
    choices.push({
      id: "check-worker-readiness",
      label: "Check worker readiness",
      description: "Run read-only runtime, subagent, and provider readiness checks before preparing a worker packet.",
      route: tools.join("+"),
    });
  }
  if (decision === "blocked") {
    choices.push({
      id: "remove-blocked-request",
      label: "Remove blocked request",
      description: "Return to a local-safe profile before asking for execution.",
      route: "control_plane_profile_packet",
    });
  }

  return {
    kind: "operator-choice",
    prompt: "Choose the next safe control-plane step, write another answer, or cancel.",
    choices: choices.length > 0
      ? choices
      : tools.map((tool) => ({
        id: tool,
        label: tool,
        description: "Use this report-only tool as the next route.",
        route: tool,
    })),
    recommendedChoiceId: choices[0]?.id ?? tools[0] ?? "custom-answer",
    allowCustomAnswer: true,
    allowCancel: true,
    uiHints: {
      preferred: "choice-list",
      fallback: "compact-text",
    },
  };
}

function resolveControlPlaneAction(decision: OperatorIntentIntakeDecision): {
  controlPlaneAction: OperatorIntentControlPlaneAction;
  confirmationRequired: boolean;
  confirmationReason: string;
} {
  if (decision === "blocked") {
    return {
      controlPlaneAction: "stop-and-report",
      confirmationRequired: true,
      confirmationReason: "blocked intent needs operator correction before any next route.",
    };
  }
  if (decision === "ask-operator") {
    return {
      controlPlaneAction: "ask-operator",
      confirmationRequired: true,
      confirmationReason: "required intent fields are missing.",
    };
  }
  return {
    controlPlaneAction: "run-report-only-route",
    confirmationRequired: false,
    confirmationReason: "recommended route is report-only/read-only and does not authorize mutation, dispatch, or worker start.",
  };
}

function resolveNextAction(decision: OperatorIntentIntakeDecision): OperatorIntentNextAction {
  if (decision === "ask-operator") return "answer-next-question";
  if (decision === "check-runtime-health") return "run-runtime-health-checks";
  if (decision === "seed-brainstorm") return "run-brainstorm-seed-preview";
  if (decision === "prepare-single-slice") return "prepare-single-slice-contract";
  if (decision === "check-worker-readiness") return "run-worker-readiness-checks";
  if (decision === "prepare-worker-packet") return "prepare-worker-packet";
  return "resolve-blocked-intent";
}

function resolveRecommendationCode(decision: OperatorIntentIntakeDecision): OperatorIntentRecommendationCode {
  if (decision === "ask-operator") return "operator-intent-ask-operator";
  if (decision === "check-runtime-health") return "operator-intent-check-runtime-health";
  if (decision === "seed-brainstorm") return "operator-intent-seed-brainstorm";
  if (decision === "prepare-single-slice") return "operator-intent-prepare-single-slice";
  if (decision === "check-worker-readiness") return "operator-intent-check-worker-readiness";
  if (decision === "prepare-worker-packet") return "operator-intent-prepare-worker-packet";
  return "operator-intent-blocked";
}

export function buildOperatorIntentIntakePacket(input: OperatorIntentIntakeInput = {}): OperatorIntentIntakePacket {
  const profilePacket = buildControlPlaneProfilePacket(input);
  const missingQuestions = profilePacket.missingQuestions;
  const blockedRequests = profilePacket.blockedRequests;
  const missingCapabilities = [...profilePacket.missingCapabilities];

  let decision: OperatorIntentIntakeDecision;
  let recommendedTools: string[];
  let recommendation: string;

  if (profilePacket.decision === "blocked") {
    decision = "blocked";
    recommendedTools = ["control_plane_profile_packet"];
    recommendation = "Keep the intake report-only; remove protected, scheduler, remote, or GitHub Actions requests before preparing work.";
  } else if (input.runtimeHealthRequested) {
    decision = "check-runtime-health";
    recommendedTools = ["environment_runtime_health_status", "environment_dev_pressure_status", "safe_boot_runtime_artifact_audit"];
    recommendation = "Run read-only runtime health checks now; do not ask for confirmation and do not mutate files.";
  } else if (missingQuestions.length > 0) {
    decision = "ask-operator";
    recommendedTools = ["structured_interview_plan"];
    recommendation = "Ask only the missing questions needed to turn free-form intent into a bounded work contract.";
  } else if (input.brainstormRequested || input.noEligibleLocalSafeTasks || input.localSafeMaterialReady === false) {
    decision = "seed-brainstorm";
    recommendedTools = ["lane_brainstorm_packet", "lane_brainstorm_seed_preview"];
    recommendation = "Prepare candidate local-safe slices, then ask the operator to choose, customize, or cancel.";
  } else if (profilePacket.profile === "worker-assisted-candidate") {
    if (input.runtimeHealthReady !== true) missingCapabilities.push("runtime-health");
    if (input.subagentsReady !== true) missingCapabilities.push("subagent-readiness");
    if (input.providerReady !== true) missingCapabilities.push("provider-readiness");
    decision = missingCapabilities.includes("runtime-health") ||
      missingCapabilities.includes("subagent-readiness") ||
      missingCapabilities.includes("provider-readiness")
      ? "check-worker-readiness"
      : "prepare-worker-packet";
    recommendedTools = decision === "prepare-worker-packet"
      ? ["agent_run_operator_packet", "agent_run_task_packet"]
      : ["environment_runtime_health_status", "subagent_readiness_status", "provider_readiness_matrix"];
    recommendation = decision === "prepare-worker-packet"
      ? "Prepare a worker packet for operator review; dispatch remains disabled until lower gates approve it."
      : "Run read-only runtime, worker, and provider readiness checks before preparing a worker packet.";
  } else {
    decision = "prepare-single-slice";
    recommendedTools = ["control_plane_profile_packet"];
    recommendation = "Prepare one local-safe slice with validation, rollback, checkpoint, and explicit stop conditions.";
  }

  const recommendedRoute = recommendedTools.join("+");
  const interaction = buildInteraction(decision, recommendedTools, missingQuestions);
  const blockedSummary = blockedRequests.length > 0 ? blockedRequests.slice(0, 4).join("|") : "none";
  const action = resolveControlPlaneAction(decision);
  const nextAction = resolveNextAction(decision);
  const recommendationCode = resolveRecommendationCode(decision);
  const reportOnlyRouteAuthorized = action.controlPlaneAction === "run-report-only-route";
  const operatorPromptRequired = action.confirmationRequired;
  const summary = [
    "operator-intent-intake:",
    `decision=${decision}`,
    `code=${recommendationCode}`,
    `action=${action.controlPlaneAction}`,
    `next=${nextAction}`,
    `route=${recommendedRoute}`,
    `choice=${interaction.recommendedChoiceId}`,
    `profile=${profilePacket.profile}`,
    `questions=${missingQuestions.length}`,
    `operatorDecision=${action.confirmationRequired ? "yes" : "no"}`,
    `reportOnlyAuthorized=${reportOnlyRouteAuthorized ? "yes" : "no"}`,
    `blocked=${blockedSummary}`,
    "dispatch=no",
    "mutation=no",
    "worker-dispatch=no",
  ].join(" ");

  return {
    effect: "none",
    mode: "operator-intent-intake",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    mutationAllowed: false,
    workerDispatchAllowed: false,
    decision,
    recommendedRoute,
    recommendedTools,
    operatorDecisionNeeded: action.confirmationRequired,
    reportOnlyRouteAuthorized,
    operatorPromptRequired,
    controlPlaneAction: action.controlPlaneAction,
    nextAction,
    confirmationRequired: action.confirmationRequired,
    confirmationReason: action.confirmationReason,
    profilePacket,
    missingQuestions,
    blockedRequests,
    missingCapabilities: [...new Set(missingCapabilities)].slice(0, 6),
    interaction,
    summary,
    recommendationCode,
    recommendation,
  };
}
