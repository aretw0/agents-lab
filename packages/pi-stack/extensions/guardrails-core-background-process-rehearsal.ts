export type BackgroundProcessRehearsalDecision = "ready" | "needs-evidence" | "blocked";

export interface BackgroundProcessRehearsalInput {
  readinessScore?: number;
  readinessRecommendationCode?: string;
  lifecycleClassified?: boolean;
  stopSourceCoveragePct?: number;
  rollbackPlanKnown?: boolean;
  rehearsalSlices?: number;
  unresolvedBlockers?: number;
  destructiveRestartRequested?: boolean;
  protectedScopeRequested?: boolean;
}

export interface BackgroundProcessRehearsalResult {
  mode: "background-process-rehearsal";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  decision: BackgroundProcessRehearsalDecision;
  ready: boolean;
  blockers: string[];
  missingEvidence: string[];
  recommendation: string;
  criteria: {
    readinessScore: number;
    readinessThreshold: number;
    readinessRecommendationCode: string;
    lifecycleClassified: boolean;
    stopSourceCoveragePct: number;
    stopSourceCoverageThreshold: number;
    rollbackPlanKnown: boolean;
    rehearsalSlices: number;
    requiredRehearsalSlices: number;
    unresolvedBlockers: number;
    destructiveRestartRequested: boolean;
    protectedScopeRequested: boolean;
  };
  summary: string;
}

const READINESS_THRESHOLD = 80;
const STOP_SOURCE_COVERAGE_THRESHOLD = 80;
const REQUIRED_REHEARSAL_SLICES = 1;

function normalizeNonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function normalizePercent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function evaluateBackgroundProcessRehearsal(input: BackgroundProcessRehearsalInput = {}): BackgroundProcessRehearsalResult {
  const readinessScore = normalizePercent(input.readinessScore);
  const readinessRecommendationCode = typeof input.readinessRecommendationCode === "string" && input.readinessRecommendationCode.trim().length > 0
    ? input.readinessRecommendationCode.trim()
    : "unknown";
  const lifecycleClassified = input.lifecycleClassified === true;
  const stopSourceCoveragePct = normalizePercent(input.stopSourceCoveragePct);
  const rollbackPlanKnown = input.rollbackPlanKnown === true;
  const rehearsalSlices = normalizeNonNegativeInt(input.rehearsalSlices);
  const unresolvedBlockers = normalizeNonNegativeInt(input.unresolvedBlockers);
  const destructiveRestartRequested = input.destructiveRestartRequested === true;
  const protectedScopeRequested = input.protectedScopeRequested === true;

  const blockers: string[] = [];
  if (destructiveRestartRequested) blockers.push("destructive-restart-requested");
  if (protectedScopeRequested) blockers.push("protected-scope-requested");
  if (unresolvedBlockers > 0) blockers.push("unresolved-blockers");

  const missingEvidence: string[] = [];
  if (!(readinessScore >= READINESS_THRESHOLD && readinessRecommendationCode === "background-process-readiness-strong")) {
    missingEvidence.push("background-readiness-not-strong");
  }
  if (!lifecycleClassified) missingEvidence.push("lifecycle-evidence-not-classified");
  if (stopSourceCoveragePct < STOP_SOURCE_COVERAGE_THRESHOLD) missingEvidence.push("stop-source-coverage-below-threshold");
  if (!rollbackPlanKnown) missingEvidence.push("rollback-plan-missing");
  if (rehearsalSlices < REQUIRED_REHEARSAL_SLICES) missingEvidence.push("insufficient-rehearsal-slices");

  let decision: BackgroundProcessRehearsalDecision = "needs-evidence";
  let recommendation = "collect rehearsal evidence (lifecycle + stopSource + rollback) before operational promotion.";

  if (blockers.length > 0) {
    decision = "blocked";
    recommendation = "blocked: resolve protected/destructive/unresolved blockers before rehearsal escalation.";
  } else if (missingEvidence.length === 0) {
    decision = "ready";
    recommendation = "rehearsal evidence is sufficient; ready for bounded local rehearsal under explicit human focus.";
  }

  const ready = decision === "ready";

  return {
    mode: "background-process-rehearsal",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    decision,
    ready,
    blockers,
    missingEvidence,
    recommendation,
    criteria: {
      readinessScore,
      readinessThreshold: READINESS_THRESHOLD,
      readinessRecommendationCode,
      lifecycleClassified,
      stopSourceCoveragePct,
      stopSourceCoverageThreshold: STOP_SOURCE_COVERAGE_THRESHOLD,
      rollbackPlanKnown,
      rehearsalSlices,
      requiredRehearsalSlices: REQUIRED_REHEARSAL_SLICES,
      unresolvedBlockers,
      destructiveRestartRequested,
      protectedScopeRequested,
    },
    summary: [
      "background-process-rehearsal:",
      `decision=${decision}`,
      `ready=${ready ? "yes" : "no"}`,
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
      missingEvidence.length > 0 ? `missing=${missingEvidence.join("|")}` : undefined,
    ].filter(Boolean).join(" "),
  };
}
