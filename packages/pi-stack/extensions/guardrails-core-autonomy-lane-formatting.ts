export function buildAutonomyLaneStatusSummary(input: {
  ready: boolean;
  recommendationCode: string;
  nextTaskId?: string;
  readyQueuePreviewCount: number;
  suggestedSeedCount?: number;
  seedWhy?: string;
  seedPriority?: string;
  influenceWindowDecision?: string;
  protectedReadyDecision: string;
  protectedEligibleCount: number;
  decisionCueReasonCode: string;
  runwayDecision: string;
  delegationDecision: string;
  backgroundDecision: string;
  antiBloatDecision: string;
  lineBudgetAboveExtract: number;
}): string {
  return [
    "autonomy-lane-status:",
    `ready=${input.ready ? "yes" : "no"}`,
    `code=${input.recommendationCode}`,
    input.nextTaskId ? `next=${input.nextTaskId}` : undefined,
    `queue=${input.readyQueuePreviewCount}`,
    Number.isFinite(input.suggestedSeedCount)
      ? `seedCount=${Math.max(1, Math.floor(Number(input.suggestedSeedCount)))}`
      : undefined,
    input.seedWhy ? `seedWhy=${input.seedWhy}` : undefined,
    input.seedPriority ? `seedPriority=${input.seedPriority}` : undefined,
    input.influenceWindowDecision ? `influenceWindow=${input.influenceWindowDecision}` : undefined,
    `protectedReady=${input.protectedReadyDecision}`,
    `protectedEligible=${input.protectedEligibleCount}`,
    `decisionCue=${input.decisionCueReasonCode}`,
    `runway=${input.runwayDecision}`,
    `delegationReady=${input.delegationDecision}`,
    `backgroundReady=${input.backgroundDecision}`,
    `antiBloat=${input.antiBloatDecision}`,
    `lineBudgetAboveExtract=${input.lineBudgetAboveExtract}`,
    "authorization=none",
  ].filter(Boolean).join(" ");
}

export function buildAutonomyLaneSeededNextAction(input: {
  selectionReady: boolean;
  seedingDecision?: string;
  suggestedSeedCount?: number;
  seedWhy?: string;
  seedPriority?: string;
}): string | undefined {
  if (input.selectionReady || input.seedingDecision !== "seed-now") return undefined;
  return [
    `seed ${Math.max(1, Math.floor(Number(input.suggestedSeedCount ?? 1)))} local-safe tasks`,
    `seedWhy=${input.seedWhy ?? "unknown"}`,
    `seedPriority=${input.seedPriority ?? "unknown"}`,
    "then re-run autonomy_lane_status",
  ].join("; ");
}

export function buildDelegationLaneCapabilitySummary(input: {
  decision: string;
  preloadDecision: string;
  dirtySignal: string;
  monitorClassifyFailures: number;
  subagentsReady: boolean;
  recommendationCode: string;
}): string {
  return [
    "delegation-lane-capability:",
    `decision=${input.decision}`,
    `preload=${input.preloadDecision}`,
    `dirty=${input.dirtySignal}`,
    `monitorClassifyFailures=${input.monitorClassifyFailures}`,
    `subagentsReady=${input.subagentsReady ? "yes" : "no"}`,
    `code=${input.recommendationCode}`,
    "authorization=none",
  ].join(" ");
}
