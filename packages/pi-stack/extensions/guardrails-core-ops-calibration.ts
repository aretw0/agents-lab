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
