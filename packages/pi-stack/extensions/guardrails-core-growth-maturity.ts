export type GrowthMaturityDecision = "go" | "hold" | "needs-evidence";

export type GrowthMaturityRecommendationCode =
  | "growth-maturity-go-expand-bounded"
  | "growth-maturity-hold-maintain"
  | "growth-maturity-hold-stabilize"
  | "growth-maturity-needs-evidence";

export interface GrowthMaturityScoreInput {
  safetyScore?: number;
  calibrationScore?: number;
  throughputScore?: number;
  simplicityScore?: number;
  goThreshold?: number;
  holdThreshold?: number;
  debtBudgetOk?: boolean;
  criticalBlockers?: number;
}

export interface GrowthMaturityScorePacket {
  mode: "growth-maturity-score-packet";
  reviewMode: "read-only";
  activation: "none";
  authorization: "none";
  mutationAllowed: false;
  dispatchAllowed: false;
  decision: GrowthMaturityDecision;
  recommendationCode: GrowthMaturityRecommendationCode;
  recommendation: string;
  nextAction: string;
  score: number | null;
  thresholds: {
    go: number;
    hold: number;
  };
  dimensions: {
    safety: { score: number | null; missing: boolean };
    calibration: { score: number | null; missing: boolean };
    throughput: { score: number | null; missing: boolean };
    simplicity: { score: number | null; missing: boolean };
  };
  signals: {
    debtBudgetOk: boolean | null;
    criticalBlockers: number | null;
  };
  blockers: string[];
  missingSignals: string[];
  summary: string;
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeOptionalScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? clampPct(value) : null;
}

export function evaluateGrowthMaturityScorePacket(input: GrowthMaturityScoreInput): GrowthMaturityScorePacket {
  const goThreshold = clampPct(typeof input.goThreshold === "number" ? input.goThreshold : 85);
  const holdThresholdRaw = clampPct(typeof input.holdThreshold === "number" ? input.holdThreshold : 70);
  const holdThreshold = Math.min(holdThresholdRaw, goThreshold);

  const safety = normalizeOptionalScore(input.safetyScore);
  const calibration = normalizeOptionalScore(input.calibrationScore);
  const throughput = normalizeOptionalScore(input.throughputScore);
  const simplicity = normalizeOptionalScore(input.simplicityScore);

  const missingSignals = [
    safety === null ? "missing-safety-score" : undefined,
    calibration === null ? "missing-calibration-score" : undefined,
    throughput === null ? "missing-throughput-score" : undefined,
    simplicity === null ? "missing-simplicity-score" : undefined,
  ].filter(Boolean) as string[];

  const blockers: string[] = [];
  if (input.debtBudgetOk === false) blockers.push("debt-budget-exceeded");
  const criticalBlockers = typeof input.criticalBlockers === "number" && Number.isFinite(input.criticalBlockers)
    ? Math.max(0, Math.floor(input.criticalBlockers))
    : null;
  if ((criticalBlockers ?? 0) > 0) blockers.push("critical-blockers-present");

  const completeScores = [safety, calibration, throughput, simplicity].filter((row): row is number => row !== null);
  const score = completeScores.length === 4
    ? Math.round((safety! + calibration! + throughput! + simplicity!) / 4)
    : null;

  let decision: GrowthMaturityDecision = "go";
  let recommendationCode: GrowthMaturityRecommendationCode = "growth-maturity-go-expand-bounded";
  let recommendation = "maturity score is strong; you may expand one bounded experimentation level while keeping rollback and checkpoint discipline.";
  let nextAction = "promote one bounded slice and record evidence at the next turn boundary.";

  if (missingSignals.length > 0) {
    decision = "needs-evidence";
    recommendationCode = "growth-maturity-needs-evidence";
    recommendation = "missing maturity signals; fail-closed and collect the full scorecard before any growth promotion.";
    nextAction = "fill all four dimensions (safety/calibration/throughput/simplicity) and rerun this packet.";
  } else if (blockers.length > 0 || (score ?? 0) < holdThreshold) {
    decision = "hold";
    recommendationCode = "growth-maturity-hold-stabilize";
    recommendation = blockers.length > 0
      ? "stabilization required; blockers indicate governance/debt pressure and growth acceleration should pause."
      : "overall maturity is below the hold threshold; keep growth on hold and stabilize fundamentals first.";
    nextAction = blockers.length > 0
      ? "clear blockers, reduce debt pressure, and re-check score before expansion."
      : "run local-safe hardening slices until score reaches hold/go thresholds.";
  } else if ((score ?? 0) < goThreshold) {
    decision = "hold";
    recommendationCode = "growth-maturity-hold-maintain";
    recommendation = "maturity is acceptable but not yet expansion-grade; maintain pace and optimize without widening scope.";
    nextAction = "continue bounded local-safe slices and raise weak dimensions before promoting the next level.";
  }

  const summary = [
    "growth-maturity-score:",
    `decision=${decision}`,
    `code=${recommendationCode}`,
    `score=${score ?? "na"}`,
    `safety=${safety ?? "na"}`,
    `calibration=${calibration ?? "na"}`,
    `throughput=${throughput ?? "na"}`,
    `simplicity=${simplicity ?? "na"}`,
    `go=${goThreshold}`,
    `hold=${holdThreshold}`,
    missingSignals.length > 0 ? `missing=${missingSignals.join("|")}` : undefined,
    blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    "dispatch=no",
  ].filter(Boolean).join(" ");

  return {
    mode: "growth-maturity-score-packet",
    reviewMode: "read-only",
    activation: "none",
    authorization: "none",
    mutationAllowed: false,
    dispatchAllowed: false,
    decision,
    recommendationCode,
    recommendation,
    nextAction,
    score,
    thresholds: {
      go: goThreshold,
      hold: holdThreshold,
    },
    dimensions: {
      safety: { score: safety, missing: safety === null },
      calibration: { score: calibration, missing: calibration === null },
      throughput: { score: throughput, missing: throughput === null },
      simplicity: { score: simplicity, missing: simplicity === null },
    },
    signals: {
      debtBudgetOk: typeof input.debtBudgetOk === "boolean" ? input.debtBudgetOk : null,
      criticalBlockers,
    },
    blockers,
    missingSignals,
    summary,
  };
}
