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
  workerReadinessRequested?: boolean;
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

export interface OperatorIntentRouteStep {
  tool: string;
  required: true;
  purpose: string;
  inputHint: string;
  consumesPreviousStepOutput: boolean;
}

export interface OperatorIntentExecutionPlan {
  kind: "operator-prompt" | "report-only-route" | "stop";
  authorized: boolean;
  executeWithoutTextualConfirmation: boolean;
  steps: OperatorIntentRouteStep[];
  finalResponseContract: "ask-one-compact-question" | "compact-decision-summary" | "blocked-intent-summary";
  forbiddenActions: Array<"mutation" | "dispatch" | "worker-dispatch" | "protected-scope">;
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
  executionPlan: OperatorIntentExecutionPlan;
  summary: string;
  recommendationCode: OperatorIntentRecommendationCode;
  recommendation: string;
}

const RUNTIME_HEALTH_INTENT_PATTERNS = [
  /\bruntime\s+health\b/i,
  /\bhealth\s+check\b/i,
  /\bwatchdog\b/i,
  /\/watchdog(?::[A-Za-z0-9_-]+)?/i,
  /\bdev\s+pressure\b/i,
  /\bperformance\s+watchdog\b/i,
  /\bvalidar\s+(?:a\s+)?sa[uú]de\s+d[ao]\s+runtime\b/i,
  /\bsa[uú]de\s+d[ao]\s+runtime\b/i,
  /\bdiagn[oó]stico\s+(?:de\s+)?runtime\b/i,
  /\bpress[aã]o\s+d[eo]\s+runtime\b/i,
];

export function inferRuntimeHealthIntent(intent: string | undefined): boolean {
  const text = String(intent ?? "").trim();
  if (!text) return false;
  return RUNTIME_HEALTH_INTENT_PATTERNS.some((pattern) => pattern.test(text));
}

const WORKER_READINESS_INTENT_PATTERNS = [
  /\bworker\s+readiness\b/i,
  /\bworker[s]?\s+(?:ready|safe|available|healthy)\b/i,
  /\bsubagent\s+readiness\b/i,
  /\bsubagent[s]?\s+(?:ready|safe|available|healthy)\b/i,
  /\bagent[s]?\s+as\s+tools\b/i,
  /\bposso\s+usar\s+(?:os\s+)?worker[s]?\b/i,
  /\bworker[s]?\s+com\s+seguran[cç]a\b/i,
  /\bsubagente[s]?\s+pront[oa]s?\b/i,
  /\bsubagente[s]?\s+com\s+seguran[cç]a\b/i,
];

export function inferWorkerReadinessIntent(intent: string | undefined): boolean {
  const text = String(intent ?? "").trim();
  if (!text) return false;
  return WORKER_READINESS_INTENT_PATTERNS.some((pattern) => pattern.test(text));
}

const BRAINSTORM_SEED_INTENT_PATTERNS = [
  /\bbrainstorm\b/i,
  /\bseed\s+(?:the\s+)?(?:backlog|board|lane|work)\b/i,
  /\bnext\s+(?:local-safe\s+)(?:slice|lane|task|work)\b/i,
  /\bwhat\s+(?:should\s+we\s+)?(?:work\s+on|do)\s+next\b/i,
  /\bno\s+eligible\s+(?:local-safe\s+)?tasks?\b/i,
  /\bfind\s+(?:the\s+)?next\s+(?:local-safe\s+)?(?:slice|lane|task)\b/i,
  /\bpr[oó]xima\s+(?:fatia|lane|frente|tarefa)\b/i,
  /\bqual\s+(?:a\s+)?pr[oó]xima\s+(?:fatia|lane|frente|tarefa)\b/i,
  /\bsem\s+tarefas?\s+eleg[ií]ve(?:is|l)\b/i,
  /\bseme(?:ar|ie)\s+(?:o\s+)?(?:backlog|board|quadro|trabalho)\b/i,
  /\bencontrar\s+(?:a\s+)?pr[oó]xima\s+(?:fatia|lane|frente|tarefa)\b/i,
];

export function inferBrainstormSeedIntent(intent: string | undefined): boolean {
  const text = String(intent ?? "").trim();
  if (!text) return false;
  return BRAINSTORM_SEED_INTENT_PATTERNS.some((pattern) => pattern.test(text));
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

function describeRouteTool(tool: string): string {
  if (tool === "environment_runtime_health_status") return "aggregate read-only runtime health decision";
  if (tool === "environment_dev_pressure_status") return "inspect local development pressure without mutating files";
  if (tool === "safe_boot_runtime_artifact_audit") return "audit tracked runtime artifacts without cleanup";
  if (tool === "subagent_readiness_status") return "check worker/subagent readiness without dispatch";
  if (tool === "provider_readiness_matrix") return "check provider/model readiness without selecting a model";
  if (tool === "lane_brainstorm_packet") return "prepare candidate local-safe slices without writing files";
  if (tool === "lane_brainstorm_seed_preview") return "preview local-safe seed material without queue mutation";
  if (tool === "control_plane_profile_packet") return "summarize the bounded control-plane work contract";
  if (tool === "agent_run_operator_packet") return "prepare worker packet for operator review only";
  if (tool === "agent_run_task_packet") return "derive worker task packet without dispatch";
  if (tool === "structured_interview_plan") return "ask only the next missing operator question";
  return "run report-only route step";
}

function describeRouteInput(tool: string): string {
  if (tool === "environment_runtime_health_status") return "use current workspace and no mutation flags";
  if (tool === "environment_dev_pressure_status") return "use current workspace pressure snapshot";
  if (tool === "safe_boot_runtime_artifact_audit") return "audit current workspace runtime artifacts only";
  if (tool === "subagent_readiness_status") return "run strict/read-only readiness when available; do not dispatch";
  if (tool === "provider_readiness_matrix") return "read provider/model readiness; do not select a model for execution";
  if (tool === "lane_brainstorm_packet") return "use operator intent as goal; keep scope local-safe and report-only";
  if (tool === "lane_brainstorm_seed_preview") return "use previous lane_brainstorm_packet details; preview only, do not create tasks";
  if (tool === "control_plane_profile_packet") return "use normalized operator intent and known constraints";
  if (tool === "agent_run_operator_packet") return "use readiness evidence and intent; prepare packet only";
  if (tool === "agent_run_task_packet") return "use operator packet output; do not start a worker";
  if (tool === "structured_interview_plan") return "ask only the next missing question";
  return "use current intake context";
}

function buildRouteStep(tool: string, index: number, tools: string[]): OperatorIntentRouteStep {
  return {
    tool,
    required: true,
    purpose: describeRouteTool(tool),
    inputHint: describeRouteInput(tool),
    consumesPreviousStepOutput: index > 0 && (
      (tool === "lane_brainstorm_seed_preview" && tools[index - 1] === "lane_brainstorm_packet") ||
      (tool === "agent_run_task_packet" && tools[index - 1] === "agent_run_operator_packet")
    ),
  };
}

function buildExecutionPlan(action: {
  controlPlaneAction: OperatorIntentControlPlaneAction;
  confirmationRequired: boolean;
}, recommendedTools: string[]): OperatorIntentExecutionPlan {
  const forbiddenActions: OperatorIntentExecutionPlan["forbiddenActions"] = ["mutation", "dispatch", "worker-dispatch", "protected-scope"];
  if (action.controlPlaneAction === "stop-and-report") {
    return {
      kind: "stop",
      authorized: false,
      executeWithoutTextualConfirmation: false,
      steps: [],
      finalResponseContract: "blocked-intent-summary",
      forbiddenActions,
    };
  }
  if (action.controlPlaneAction === "ask-operator") {
    return {
      kind: "operator-prompt",
      authorized: false,
      executeWithoutTextualConfirmation: false,
      steps: recommendedTools.map(buildRouteStep),
      finalResponseContract: "ask-one-compact-question",
      forbiddenActions,
    };
  }
  return {
    kind: "report-only-route",
    authorized: true,
    executeWithoutTextualConfirmation: true,
    steps: recommendedTools.map(buildRouteStep),
    finalResponseContract: "compact-decision-summary",
    forbiddenActions,
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
  const runtimeHealthRequested = input.runtimeHealthRequested === true || inferRuntimeHealthIntent(input.intent);
  const workerReadinessRequested = input.workerReadinessRequested === true || inferWorkerReadinessIntent(input.intent);
  const brainstormRequested = input.brainstormRequested === true ||
    input.noEligibleLocalSafeTasks === true ||
    input.localSafeMaterialReady === false ||
    inferBrainstormSeedIntent(input.intent);

  let decision: OperatorIntentIntakeDecision;
  let recommendedTools: string[];
  let recommendation: string;

  if (profilePacket.decision === "blocked") {
    decision = "blocked";
    recommendedTools = ["control_plane_profile_packet"];
    recommendation = "Keep the intake report-only; remove protected, scheduler, remote, or GitHub Actions requests before preparing work.";
  } else if (runtimeHealthRequested) {
    decision = "check-runtime-health";
    recommendedTools = ["environment_runtime_health_status", "environment_dev_pressure_status", "safe_boot_runtime_artifact_audit"];
    recommendation = "Run read-only runtime health checks now; do not ask for confirmation and do not mutate files.";
  } else if (workerReadinessRequested) {
    decision = "check-worker-readiness";
    recommendedTools = ["environment_runtime_health_status", "subagent_readiness_status", "provider_readiness_matrix"];
    if (input.runtimeHealthReady !== true) missingCapabilities.push("runtime-health");
    if (input.subagentsReady !== true) missingCapabilities.push("subagent-readiness");
    if (input.providerReady !== true) missingCapabilities.push("provider-readiness");
    recommendation = "Run read-only runtime, worker, and provider readiness checks; do not prepare or dispatch a worker yet.";
  } else if (brainstormRequested) {
    decision = "seed-brainstorm";
    recommendedTools = ["lane_brainstorm_packet", "lane_brainstorm_seed_preview"];
    recommendation = "Prepare candidate local-safe slices, then ask the operator to choose, customize, or cancel.";
  } else if (missingQuestions.length > 0) {
    decision = "ask-operator";
    recommendedTools = ["structured_interview_plan"];
    recommendation = "Ask only the missing questions needed to turn free-form intent into a bounded work contract.";
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
  const executionPlan = buildExecutionPlan(action, recommendedTools);
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
    executionPlan,
    summary,
    recommendationCode,
    recommendation,
  };
}
