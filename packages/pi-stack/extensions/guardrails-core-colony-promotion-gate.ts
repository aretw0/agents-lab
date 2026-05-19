import {
  GUARDRAILS_AUTHORIZATION_NONE,
  type GuardrailsAuthorizationNone,
} from "./guardrails-core-authorization";

export type ColonyPromotionGateDecision = "keep-report-only" | "ready-for-colony-gate";

export interface ColonyPromotionGateInput {
  backgroundReadinessScore?: number;
  backgroundReadinessCode?: string;
  agentRunDecision?: string;
  workerLaneStage?: string;
  workerLaneColonyPromotionAllowed?: boolean;
  liveReloadCompleted?: boolean;
  protectedScopeRequested?: boolean;
}

export interface ColonyPromotionGateResult {
  mode: "colony-promotion-readiness-gate";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  colonyDispatchAllowed: false;
  decision: ColonyPromotionGateDecision;
  recommendationCode:
    | "colony-gate-ready"
    | "colony-gate-keep-report-only-background"
    | "colony-gate-keep-report-only-agent-run"
    | "colony-gate-keep-report-only-worker-lane"
    | "colony-gate-keep-report-only-reload"
    | "colony-gate-keep-report-only-protected";
  recommendation: string;
  blockers: string[];
  signals: {
    backgroundReady: boolean;
    agentRunReady: boolean;
    workerLaneColonyPromotionAllowed: boolean;
    liveReloadCompleted: boolean;
    protectedScopeRequested: boolean;
    backgroundReadinessScore: number;
    backgroundReadinessCode: string;
    agentRunDecision: string;
    workerLaneStage: string;
  };
  summary: string;
}

function normalizePercent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function evaluateColonyPromotionGate(input: ColonyPromotionGateInput = {}): ColonyPromotionGateResult {
  const backgroundReadinessScore = normalizePercent(input.backgroundReadinessScore);
  const backgroundReadinessCode = typeof input.backgroundReadinessCode === "string" && input.backgroundReadinessCode.trim().length > 0
    ? input.backgroundReadinessCode.trim()
    : "unknown";
  const agentRunDecision = typeof input.agentRunDecision === "string" && input.agentRunDecision.trim().length > 0
    ? input.agentRunDecision.trim()
    : "unknown";
  const workerLaneStage = typeof input.workerLaneStage === "string" && input.workerLaneStage.trim().length > 0
    ? input.workerLaneStage.trim()
    : "unknown";
  const workerLaneColonyPromotionAllowed = input.workerLaneColonyPromotionAllowed === true;
  const liveReloadCompleted = input.liveReloadCompleted === true;
  const protectedScopeRequested = input.protectedScopeRequested === true;

  const backgroundReady = backgroundReadinessScore >= 80 && backgroundReadinessCode === "background-process-readiness-strong";
  const agentRunReady = agentRunDecision === "ready-for-agent-run";

  const blockers: string[] = [];
  let recommendationCode: ColonyPromotionGateResult["recommendationCode"] = "colony-gate-ready";
  let recommendation = "background and agent-run gates are green; colony discussion can proceed as operator decision packet only.";

  if (!liveReloadCompleted) {
    blockers.push("reload-not-confirmed");
    recommendationCode = "colony-gate-keep-report-only-reload";
    recommendation = "reload must be confirmed before evaluating colony-promotion readiness.";
  } else if (protectedScopeRequested) {
    blockers.push("protected-scope-requested");
    recommendationCode = "colony-gate-keep-report-only-protected";
    recommendation = "protected scope requested; keep report-only and require explicit operator focus for any promotion step.";
  } else if (!backgroundReady) {
    blockers.push("background-readiness-signal-missing");
    recommendationCode = "colony-gate-keep-report-only-background";
    recommendation = "background readiness is not strong enough; close background gaps before considering colony promotion.";
  } else if (!agentRunReady) {
    blockers.push("agent-run-readiness-signal-missing");
    recommendationCode = "colony-gate-keep-report-only-agent-run";
    recommendation = "agent-run readiness is not green; validate single-agent bounded run before colony promotion.";
  } else if (!workerLaneColonyPromotionAllowed) {
    blockers.push("worker-lane-colony-promotion-not-ready");
    recommendationCode = "colony-gate-keep-report-only-worker-lane";
    recommendation = "worker lane does not permit colony promotion; keep report-only until fan-in, abort, and evidence gates are explicit.";
  }

  const decision: ColonyPromotionGateDecision = blockers.length > 0 ? "keep-report-only" : "ready-for-colony-gate";

  return {
    mode: "colony-promotion-readiness-gate",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    colonyDispatchAllowed: false,
    decision,
    recommendationCode,
    recommendation,
    blockers,
    signals: {
      backgroundReady,
      agentRunReady,
      workerLaneColonyPromotionAllowed,
      liveReloadCompleted,
      protectedScopeRequested,
      backgroundReadinessScore,
      backgroundReadinessCode,
      agentRunDecision,
      workerLaneStage,
    },
    summary: [
      "colony-promotion-gate:",
      `decision=${decision}`,
      `code=${recommendationCode}`,
      `backgroundReady=${backgroundReady ? "yes" : "no"}`,
      `agentRunReady=${agentRunReady ? "yes" : "no"}`,
      `workerLaneColony=${workerLaneColonyPromotionAllowed ? "yes" : "no"}`,
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    ].filter(Boolean).join(" "),
  };
}
