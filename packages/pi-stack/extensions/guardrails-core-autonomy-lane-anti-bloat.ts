import { buildExtensionLineBudgetEntries } from "./guardrails-core-line-budget-files";
import { buildLineBudgetSnapshot, type LineBudgetRecommendation, type LineBudgetSnapshotRow } from "./guardrails-core-tool-hygiene";

export type AutonomyAntiBloatCue = {
  decision: LineBudgetRecommendation;
  recommendationCode: "anti-bloat-ok" | "anti-bloat-watch" | "anti-bloat-extract";
  recommendation: string;
  nextAction: string;
  lineBudgetRecommendationCode: "line-budget-ok" | "line-budget-watch" | "line-budget-extract";
  totals: {
    scanned: number;
    aboveWatch: number;
    aboveExtract: number;
    aboveCritical: number;
  };
  topFiles: LineBudgetSnapshotRow[];
  blockers: string[];
  risks: string[];
  authorization: "none";
  dispatchAllowed: false;
  mutationAllowed: false;
  summary: string;
};

export function buildAutonomyAntiBloatCue(cwd: string): AutonomyAntiBloatCue {
  const snapshot = buildLineBudgetSnapshot({
    files: buildExtensionLineBudgetEntries(cwd),
    limit: 5,
  });
  const recommendationCode = snapshot.recommendation === "extract"
    ? "anti-bloat-extract"
    : snapshot.recommendation === "watch"
      ? "anti-bloat-watch"
      : "anti-bloat-ok";
  const recommendation = snapshot.recommendation === "extract"
    ? "prefer cohesive extraction slices before growing oversized extension surfaces; authorized anti-bloat/refactor extraction is not a tangent"
    : snapshot.recommendation === "watch"
      ? "keep new code in small modules and monitor line-budget drift; authorized extraction may contain growth"
      : "line-budget posture is within autonomy-lane budget";
  const nextAction = snapshot.recommendation === "extract"
    ? "schedule/continue bounded anti-bloat extraction wave; preserve public contracts; run focal smoke; keep backlog/policy tangents separate"
    : snapshot.recommendation === "watch"
      ? "avoid adding to watch surfaces unless the slice extracts or contains authorized refactor growth"
      : "continue local-safe slice selection";
  const summary = [
    "anti-bloat-cue:",
    `decision=${snapshot.recommendation}`,
    `code=${recommendationCode}`,
    `aboveWatch=${snapshot.totals.aboveWatch}`,
    `aboveExtract=${snapshot.totals.aboveExtract}`,
    `aboveCritical=${snapshot.totals.aboveCritical}`,
    snapshot.blockers.length > 0 ? `blockers=${snapshot.blockers.join("|")}` : undefined,
    "authorization=none",
  ].filter(Boolean).join(" ");

  return {
    decision: snapshot.recommendation,
    recommendationCode,
    recommendation,
    nextAction,
    lineBudgetRecommendationCode: snapshot.recommendationCode,
    totals: snapshot.totals,
    topFiles: snapshot.rows.slice(0, 5),
    blockers: snapshot.blockers,
    risks: snapshot.risks,
    authorization: "none",
    dispatchAllowed: false,
    mutationAllowed: false,
    summary,
  };
}
