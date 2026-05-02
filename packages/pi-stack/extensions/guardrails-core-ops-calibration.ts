import type { AgentsAsToolsCalibrationScore } from "./guardrails-core-tool-hygiene";
import type { BackgroundProcessReadinessScore } from "./guardrails-core-background-process";
import type { BackgroundProcessRehearsalResult } from "./guardrails-core-background-process-rehearsal";

export type OpsCalibrationDecision = "keep-report-only" | "ready-for-bounded-rehearsal";
export type OpsCalibrationRecommendationCode =
  | "ops-calibration-ready-bounded-rehearsal"
  | "ops-calibration-keep-report-only-background"
  | "ops-calibration-keep-report-only-background-rehearsal"
  | "ops-calibration-keep-report-only-agents"
  | "ops-calibration-keep-report-only-threshold"
  | "ops-calibration-keep-report-only-reload";

export interface OpsCalibrationDecisionInput {
  background: BackgroundProcessReadinessScore;
  backgroundRehearsal?: BackgroundProcessRehearsalResult;
  agents: AgentsAsToolsCalibrationScore;
  minScoreForRehearsal?: number;
  liveReloadCompleted?: boolean;
}

export interface OpsCalibrationDecisionPacket {
  mode: "ops-calibration-decision-packet";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  decision: OpsCalibrationDecision;
  recommendationCode: OpsCalibrationRecommendationCode;
  recommendation: string;
  thresholds: {
    minScoreForRehearsal: number;
  };
  blockers: string[];
  background: {
    score: number;
    recommendationCode: string;
    dimensions: BackgroundProcessReadinessScore["dimensions"];
  };
  backgroundRehearsal: {
    decision: string;
    blockers: string[];
    missingEvidence: string[];
  };
  agents: {
    score: number;
    recommendationCode: string;
    dimensions: AgentsAsToolsCalibrationScore["dimensions"];
  };
  summary: string;
}

function clampScoreThreshold(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 80;
  const normalized = Math.round(value);
  return Math.max(60, Math.min(95, normalized));
}

export function buildOpsCalibrationDecisionPacket(input: OpsCalibrationDecisionInput): OpsCalibrationDecisionPacket {
  const minScoreForRehearsal = clampScoreThreshold(input.minScoreForRehearsal);
  const liveReloadCompleted = input.liveReloadCompleted === true;
  const blockers: string[] = [];

  let recommendationCode: OpsCalibrationRecommendationCode = "ops-calibration-ready-bounded-rehearsal";
  let recommendation = "calibration looks strong; bounded local rehearsal is ready under explicit human focus.";

  const backgroundRehearsal = input.backgroundRehearsal;

  if (!liveReloadCompleted) {
    blockers.push("reload-required-for-live-invocation");
    recommendationCode = "ops-calibration-keep-report-only-reload";
    recommendation = "reload is required to invoke newly wired runtime tools live; keep report-only until reload is completed.";
  } else if (input.background.recommendationCode !== "background-process-readiness-strong") {
    blockers.push("background-readiness-not-strong");
    recommendationCode = "ops-calibration-keep-report-only-background";
    recommendation = "background process readiness is not strong yet; keep report-only and close capability/evidence gaps first.";
  } else if (!backgroundRehearsal || backgroundRehearsal.decision !== "ready") {
    blockers.push("background-rehearsal-not-ready");
    recommendationCode = "ops-calibration-keep-report-only-background-rehearsal";
    recommendation = "background rehearsal evidence is not ready yet; close lifecycle/stopSource/rollback/slice gaps before rehearsal promotion.";
  } else if (input.agents.recommendationCode !== "agents-as-tools-calibration-strong") {
    blockers.push("agents-calibration-not-strong");
    recommendationCode = "ops-calibration-keep-report-only-agents";
    recommendation = "agents-as-tools calibration is not strong yet; tighten governance/boundedness/observability before rehearsal.";
  } else if (input.background.score < minScoreForRehearsal || input.agents.score < minScoreForRehearsal) {
    blockers.push("score-below-rehearsal-threshold");
    recommendationCode = "ops-calibration-keep-report-only-threshold";
    recommendation = "scores are below rehearsal threshold; keep report-only and continue local-safe hardening waves.";
  }

  const decision: OpsCalibrationDecision = blockers.length > 0 ? "keep-report-only" : "ready-for-bounded-rehearsal";

  return {
    mode: "ops-calibration-decision-packet",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    decision,
    recommendationCode,
    recommendation,
    thresholds: {
      minScoreForRehearsal,
    },
    blockers,
    background: {
      score: input.background.score,
      recommendationCode: input.background.recommendationCode,
      dimensions: input.background.dimensions,
    },
    backgroundRehearsal: {
      decision: backgroundRehearsal?.decision ?? "unknown",
      blockers: backgroundRehearsal?.blockers ?? [],
      missingEvidence: backgroundRehearsal?.missingEvidence ?? ["background-rehearsal-signal-missing"],
    },
    agents: {
      score: input.agents.score,
      recommendationCode: input.agents.recommendationCode,
      dimensions: input.agents.dimensions,
    },
    summary: [
      "ops-calibration-packet:",
      `decision=${decision}`,
      `code=${recommendationCode}`,
      `background=${input.background.score}`,
      `rehearsal=${backgroundRehearsal?.decision ?? "unknown"}`,
      `agents=${input.agents.score}`,
      `threshold=${minScoreForRehearsal}`,
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    ].filter(Boolean).join(" "),
  };
}

export type DelegateOrExecuteOption = "local-execute" | "simple-delegate" | "defer";

export type DelegateOrExecuteRecommendationCode =
  | "delegate-execute-simple-delegate"
  | "delegate-execute-local-execute"
  | "delegate-execute-defer-missing-signals"
  | "delegate-execute-defer-blocked";

export interface DelegateOrExecuteDecisionInput {
  capabilityDecision?: "ready" | "needs-evidence" | "blocked";
  capabilityRecommendationCode?: string;
  capabilityBlockers?: string[];
  capabilityEvidenceGaps?: string[];
  mixDecision?: "ready" | "needs-evidence";
  mixScore?: number;
  mixRecommendationCode?: string;
  mixSimpleDelegateEvents?: number;
  mixSwarmEvents?: number;
}

export interface DelegateOrExecuteDecisionPacket {
  mode: "delegate-or-execute-decision-packet";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  mutationAllowed: false;
  recommendedOption: DelegateOrExecuteOption;
  recommendationCode: DelegateOrExecuteRecommendationCode;
  recommendation: string;
  blockers: string[];
  evidenceGaps: string[];
  signals: {
    capabilityDecision: "ready" | "needs-evidence" | "blocked" | "missing";
    capabilityRecommendationCode: string;
    mixDecision: "ready" | "needs-evidence" | "missing";
    mixScore: number;
    mixRecommendationCode: string;
    mixSimpleDelegateEvents: number;
    mixSwarmEvents: number;
  };
  summary: string;
}

function normalizeDecision(value: unknown, allowed: string[]): string {
  return typeof value === "string" && allowed.includes(value) ? value : "missing";
}

export function buildDelegateOrExecuteDecisionPacket(
  input: DelegateOrExecuteDecisionInput,
): DelegateOrExecuteDecisionPacket {
  const capabilityDecision = normalizeDecision(input.capabilityDecision, ["ready", "needs-evidence", "blocked"]) as
    | "ready"
    | "needs-evidence"
    | "blocked"
    | "missing";
  const mixDecision = normalizeDecision(input.mixDecision, ["ready", "needs-evidence"]) as
    | "ready"
    | "needs-evidence"
    | "missing";

  const mixScoreRaw = Number(input.mixScore);
  const mixScore = Number.isFinite(mixScoreRaw) ? Math.max(0, Math.min(100, Math.round(mixScoreRaw))) : 0;
  const mixSimpleDelegateEvents = Math.max(0, Math.floor(Number(input.mixSimpleDelegateEvents ?? 0)));
  const mixSwarmEvents = Math.max(0, Math.floor(Number(input.mixSwarmEvents ?? 0)));

  const blockers: string[] = [];
  const evidenceGaps = [
    ...(Array.isArray(input.capabilityEvidenceGaps) ? input.capabilityEvidenceGaps : []),
  ];

  let recommendedOption: DelegateOrExecuteOption = "defer";
  let recommendationCode: DelegateOrExecuteRecommendationCode = "delegate-execute-defer-missing-signals";
  let recommendation = "insufficient signals; defer delegation decision until capability and mix signals are available.";

  if (capabilityDecision === "missing" || mixDecision === "missing") {
    blockers.push("missing-capability-or-mix-signal");
  } else if (capabilityDecision === "blocked") {
    blockers.push("capability-blocked");
    blockers.push(...(Array.isArray(input.capabilityBlockers) ? input.capabilityBlockers : []));
    recommendationCode = "delegate-execute-defer-blocked";
    recommendation = "capability is blocked; defer and close hard blockers before executing/delegating.";
  } else if (capabilityDecision === "ready" && mixDecision === "ready" && mixScore >= 70 && mixSimpleDelegateEvents > 0 && mixSwarmEvents > 0) {
    recommendedOption = "simple-delegate";
    recommendationCode = "delegate-execute-simple-delegate";
    recommendation = "signals are strong; prefer bounded simple-delegate as next step (still no auto-dispatch).";
  } else {
    recommendedOption = "local-execute";
    recommendationCode = "delegate-execute-local-execute";
    recommendation = "signals are partial; prefer local execution slice to gather evidence before stronger delegation.";
    if (mixDecision !== "ready") evidenceGaps.push("mix-needs-evidence");
    if (mixSimpleDelegateEvents <= 0) evidenceGaps.push("mix-simple-delegate-missing");
    if (mixSwarmEvents <= 0) evidenceGaps.push("mix-swarm-missing");
  }

  if (blockers.length > 0) {
    recommendedOption = "defer";
    recommendationCode = blockers.includes("capability-blocked")
      ? "delegate-execute-defer-blocked"
      : "delegate-execute-defer-missing-signals";
  }

  const summary = [
    "delegate-or-execute-packet:",
    `option=${recommendedOption}`,
    `code=${recommendationCode}`,
    `capability=${capabilityDecision}`,
    `mix=${mixDecision}`,
    `mixScore=${mixScore}`,
    blockers.length > 0 ? `blockers=${[...new Set(blockers)].join("|")}` : undefined,
    "authorization=none",
  ].filter(Boolean).join(" ");

  return {
    mode: "delegate-or-execute-decision-packet",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    mutationAllowed: false,
    recommendedOption,
    recommendationCode,
    recommendation,
    blockers: [...new Set(blockers)],
    evidenceGaps: [...new Set(evidenceGaps)],
    signals: {
      capabilityDecision,
      capabilityRecommendationCode: typeof input.capabilityRecommendationCode === "string"
        ? input.capabilityRecommendationCode
        : "missing",
      mixDecision,
      mixScore,
      mixRecommendationCode: typeof input.mixRecommendationCode === "string"
        ? input.mixRecommendationCode
        : "missing",
      mixSimpleDelegateEvents,
      mixSwarmEvents,
    },
    summary,
  };
}
