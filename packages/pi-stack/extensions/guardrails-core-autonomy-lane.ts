export type AutonomyContextLevel = "ok" | "warn" | "checkpoint" | "compact";
export type AutonomyLaneDecision = "go" | "bounded" | "checkpoint" | "wrap-up" | "blocked";

export interface AutonomyLaneReadinessInput {
  context: {
    level: AutonomyContextLevel;
    action?: string;
    percent?: number;
  };
  machine: {
    severity: "ok" | "warn" | "pause" | "block" | string;
    canStartLongRun?: boolean;
    canEvaluateMonitors?: boolean;
  };
  provider: {
    ready: number;
    blocked?: number;
    degraded?: number;
  };
  quota: {
    blockAlerts?: number;
    warnAlerts?: number;
  };
  board: {
    ready: boolean;
    nextTaskId?: string;
  };
  monitors: {
    classifyFailures: number;
    sovereignDivergence?: number;
  };
  subagents: {
    ready: boolean;
  };
  workspace?: {
    unexpectedDirty?: boolean;
  };
}

export interface AutonomyLaneReadinessResult {
  ready: boolean;
  decision: AutonomyLaneDecision;
  allowedWork: "normal-bounded" | "bounded-only" | "checkpoint-only" | "wrap-up-only" | "none";
  stopReasons: string[];
  steering: string[];
  nextAction: string;
}

export type DelegationLaneCapabilityDecision = "ready" | "needs-evidence" | "blocked";

export interface DelegationLaneCapabilityInput {
  preloadDecision?: "use-pack" | "fallback-canonical" | string;
  dirtySignal?: "clean" | "dirty" | "unknown" | string;
  monitorClassifyFailures?: number;
  subagentsReady?: boolean;
}

export interface DelegationLaneCapabilitySnapshot {
  decision: DelegationLaneCapabilityDecision;
  recommendationCode: string;
  recommendation: string;
  signals: {
    preloadDecision: "use-pack" | "fallback-canonical";
    dirtySignal: "clean" | "dirty" | "unknown";
    monitorClassifyFailures: number;
    subagentsReady: boolean;
  };
  blockers: string[];
  evidenceGaps: string[];
}

function pushIf(out: string[], condition: boolean, value: string): void {
  if (condition) out.push(value);
}

function normalizePreloadDecision(value: unknown): "use-pack" | "fallback-canonical" {
  return value === "use-pack" ? "use-pack" : "fallback-canonical";
}

function normalizeDirtySignal(value: unknown): "clean" | "dirty" | "unknown" {
  return value === "clean" || value === "dirty" || value === "unknown" ? value : "unknown";
}

export function evaluateDelegationLaneCapabilitySnapshot(input: DelegationLaneCapabilityInput): DelegationLaneCapabilitySnapshot {
  const signals = {
    preloadDecision: normalizePreloadDecision(input.preloadDecision),
    dirtySignal: normalizeDirtySignal(input.dirtySignal),
    monitorClassifyFailures: Math.max(0, Math.floor(Number(input.monitorClassifyFailures ?? 0))),
    subagentsReady: input.subagentsReady !== false,
  };

  const blockers: string[] = [];
  const evidenceGaps: string[] = [];

  if (!signals.subagentsReady) blockers.push("subagents-not-ready");
  if (signals.monitorClassifyFailures >= 4) blockers.push("monitor-classify-failures-block");

  if (signals.preloadDecision !== "use-pack") evidenceGaps.push("preload-fallback-canonical");
  if (signals.dirtySignal === "dirty") evidenceGaps.push("workspace-dirty");
  if (signals.dirtySignal === "unknown") evidenceGaps.push("workspace-dirty-unknown");
  if (signals.monitorClassifyFailures > 0 && signals.monitorClassifyFailures < 4) {
    evidenceGaps.push("monitor-classify-failures-warn");
  }

  if (blockers.length > 0) {
    const recommendationCode = blockers.includes("subagents-not-ready")
      ? "delegation-capability-blocked-subagents"
      : "delegation-capability-blocked-monitor-classify";
    return {
      decision: "blocked",
      recommendationCode,
      recommendation: "delegation capability blocked; fix hard blockers before preparing delegated slice.",
      signals,
      blockers,
      evidenceGaps,
    };
  }

  if (evidenceGaps.length > 0) {
    const recommendationCode = evidenceGaps.includes("workspace-dirty")
      ? "delegation-capability-needs-evidence-dirty"
      : evidenceGaps.includes("preload-fallback-canonical")
        ? "delegation-capability-needs-evidence-preload"
        : "delegation-capability-needs-evidence";
    return {
      decision: "needs-evidence",
      recommendationCode,
      recommendation: "delegation capability needs evidence hardening before reliable delegated execution.",
      signals,
      blockers,
      evidenceGaps,
    };
  }

  return {
    decision: "ready",
    recommendationCode: "delegation-capability-ready",
    recommendation: "delegation capability signals are ready for bounded delegated planning.",
    signals,
    blockers,
    evidenceGaps,
  };
}

export function evaluateAutonomyLaneReadiness(input: AutonomyLaneReadinessInput): AutonomyLaneReadinessResult {
  const stopReasons: string[] = [];
  const steering: string[] = [];

  pushIf(stopReasons, input.machine.severity === "block", "machine-block");
  pushIf(stopReasons, input.machine.canStartLongRun === false, "machine-long-run-disabled");
  pushIf(stopReasons, (input.provider.ready ?? 0) <= 0, "provider-not-ready");
  pushIf(stopReasons, (input.provider.blocked ?? 0) > 0, "provider-blocked");
  pushIf(stopReasons, (input.quota.blockAlerts ?? 0) > 0, "quota-block");
  pushIf(stopReasons, input.monitors.classifyFailures > 0, "monitor-classify-failures");
  pushIf(stopReasons, (input.monitors.sovereignDivergence ?? 0) > 0, "monitor-sovereign-divergence");
  pushIf(stopReasons, !input.subagents.ready, "subagents-not-ready");
  pushIf(stopReasons, !input.board.ready, "board-not-ready");
  pushIf(stopReasons, input.workspace?.unexpectedDirty === true, "unexpected-dirty-workspace");

  if (stopReasons.length > 0) {
    return {
      ready: false,
      decision: "blocked",
      allowedWork: "none",
      stopReasons,
      steering,
      nextAction: "stop, persist handoff, and require human or recovery lane before autonomous continuation.",
    };
  }

  if (input.context.level === "compact") {
    return {
      ready: false,
      decision: "wrap-up",
      allowedWork: "wrap-up-only",
      stopReasons: ["context-compact"],
      steering: ["wrap up current slice", "persist handoff", "allow auto-compact and auto-resume"],
      nextAction: "wrap up and let auto-compact/auto-resume proceed.",
    };
  }

  if (input.context.level === "checkpoint") {
    return {
      ready: true,
      decision: "checkpoint",
      allowedWork: "checkpoint-only",
      stopReasons: [],
      steering: ["refresh handoff before broader continuation"],
      nextAction: `checkpoint then continue with next eligible task${input.board.nextTaskId ? ` (${input.board.nextTaskId})` : ""}.`,
    };
  }

  if (input.context.level === "warn" || input.machine.severity === "warn" || input.machine.severity === "pause" || (input.quota.warnAlerts ?? 0) > 0 || (input.provider.degraded ?? 0) > 0) {
    pushIf(steering, input.context.level === "warn", "context-warn: continue bounded work; do not soft-stop");
    pushIf(steering, input.machine.severity === "warn" || input.machine.severity === "pause", "machine-pressure: avoid heavy broad runs");
    pushIf(steering, (input.quota.warnAlerts ?? 0) > 0, "quota-warn: prefer cheap/bounded work");
    pushIf(steering, (input.provider.degraded ?? 0) > 0, "provider-degraded: keep retry budget conservative");
    return {
      ready: true,
      decision: "bounded",
      allowedWork: "bounded-only",
      stopReasons: [],
      steering,
      nextAction: `continue bounded autonomous slices${input.board.nextTaskId ? `; next=${input.board.nextTaskId}` : ""}.`,
    };
  }

  return {
    ready: true,
    decision: "go",
    allowedWork: "normal-bounded",
    stopReasons: [],
    steering,
    nextAction: `continue autonomous lane${input.board.nextTaskId ? `; next=${input.board.nextTaskId}` : ""}.`,
  };
}
