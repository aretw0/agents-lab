export type ColonyPromotionGateDecision = "keep-report-only" | "ready-for-colony-gate";

export interface ColonyPromotionGateInput {
  backgroundReadinessScore?: number;
  backgroundReadinessCode?: string;
  simpleSpawnDecision?: string;
  liveReloadCompleted?: boolean;
  protectedScopeRequested?: boolean;
}

export interface ColonyPromotionGateResult {
  mode: "colony-promotion-readiness-gate";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  colonyDispatchAllowed: false;
  decision: ColonyPromotionGateDecision;
  recommendationCode:
    | "colony-gate-ready"
    | "colony-gate-keep-report-only-background"
    | "colony-gate-keep-report-only-simple-spawn"
    | "colony-gate-keep-report-only-reload"
    | "colony-gate-keep-report-only-protected";
  recommendation: string;
  blockers: string[];
  signals: {
    backgroundReady: boolean;
    simpleSpawnReady: boolean;
    liveReloadCompleted: boolean;
    protectedScopeRequested: boolean;
    backgroundReadinessScore: number;
    backgroundReadinessCode: string;
    simpleSpawnDecision: string;
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
  const simpleSpawnDecision = typeof input.simpleSpawnDecision === "string" && input.simpleSpawnDecision.trim().length > 0
    ? input.simpleSpawnDecision.trim()
    : "unknown";
  const liveReloadCompleted = input.liveReloadCompleted === true;
  const protectedScopeRequested = input.protectedScopeRequested === true;

  const backgroundReady = backgroundReadinessScore >= 80 && backgroundReadinessCode === "background-process-readiness-strong";
  const simpleSpawnReady = simpleSpawnDecision === "ready-for-simple-spawn";

  const blockers: string[] = [];
  let recommendationCode: ColonyPromotionGateResult["recommendationCode"] = "colony-gate-ready";
  let recommendation = "background and simple spawn gates are green; colony discussion can proceed as human decision packet only.";

  if (!liveReloadCompleted) {
    blockers.push("reload-not-confirmed");
    recommendationCode = "colony-gate-keep-report-only-reload";
    recommendation = "reload must be confirmed before evaluating colony-promotion readiness.";
  } else if (protectedScopeRequested) {
    blockers.push("protected-scope-requested");
    recommendationCode = "colony-gate-keep-report-only-protected";
    recommendation = "protected scope requested; keep report-only and require explicit human focus for any promotion step.";
  } else if (!backgroundReady) {
    blockers.push("background-readiness-signal-missing");
    recommendationCode = "colony-gate-keep-report-only-background";
    recommendation = "background readiness is not strong enough; close background gaps before considering colony promotion.";
  } else if (!simpleSpawnReady) {
    blockers.push("simple-spawn-readiness-signal-missing");
    recommendationCode = "colony-gate-keep-report-only-simple-spawn";
    recommendation = "simple spawn readiness is not green; validate single-agent bounded spawn before colony promotion.";
  }

  const decision: ColonyPromotionGateDecision = blockers.length > 0 ? "keep-report-only" : "ready-for-colony-gate";

  return {
    mode: "colony-promotion-readiness-gate",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    colonyDispatchAllowed: false,
    decision,
    recommendationCode,
    recommendation,
    blockers,
    signals: {
      backgroundReady,
      simpleSpawnReady,
      liveReloadCompleted,
      protectedScopeRequested,
      backgroundReadinessScore,
      backgroundReadinessCode,
      simpleSpawnDecision,
    },
    summary: [
      "colony-promotion-gate:",
      `decision=${decision}`,
      `code=${recommendationCode}`,
      `backgroundReady=${backgroundReady ? "yes" : "no"}`,
      `simpleSpawnReady=${simpleSpawnReady ? "yes" : "no"}`,
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    ].filter(Boolean).join(" "),
  };
}
