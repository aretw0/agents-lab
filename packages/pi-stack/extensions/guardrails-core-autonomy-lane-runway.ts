import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { evaluateDelegationLaneCapabilitySnapshot } from "./guardrails-core-autonomy-lane";
import { buildDelegateOrExecuteDecisionPacket, buildSimpleDelegateRehearsalDecisionPacket } from "./guardrails-core-ops-calibration";
import { buildBackgroundProcessReadinessScore, resolveBackgroundProcessControlPlan } from "./guardrails-core-background-process";
import { evaluateBackgroundProcessRehearsal } from "./guardrails-core-background-process-rehearsal";
import { consumeContextPreloadPack } from "./context-watchdog-continuation";
import { buildUnavailableGitDirtySnapshot, readGitDirtySnapshot } from "./guardrails-core-git-maintenance-surface";

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const raw = Number(value);
  return Number.isFinite(raw) ? raw : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function pickEnumValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : undefined;
}

export function readDelegationFreshnessSignals(cwd: string): {
  preloadDecision: "use-pack" | "fallback-canonical";
  dirtySignal: "clean" | "dirty" | "unknown";
} {
  const preload = consumeContextPreloadPack(cwd, { profile: "control-plane-core" });
  let dirtySignal: "clean" | "dirty" | "unknown" = "unknown";
  try {
    const snapshot = readGitDirtySnapshot(cwd);
    dirtySignal = snapshot.clean ? "clean" : "dirty";
  } catch (error) {
    const unavailable = buildUnavailableGitDirtySnapshot(error);
    dirtySignal = unavailable.available ? (unavailable.clean ? "clean" : "dirty") : "unknown";
  }
  return {
    preloadDecision: preload.decision,
    dirtySignal,
  };
}

export type DelegationRunwayCue = {
  decision: "ready-simple-delegate" | "local-execute-first" | "defer";
  recommendationCode:
    | "delegation-readiness-ready-simple-delegate"
    | "delegation-readiness-local-execute-first"
    | "delegation-readiness-defer-blocked";
  nextAction: string;
  blockers: string[];
};

export type BackgroundRunwayCue = {
  decision: "ready-window" | "needs-evidence" | "blocked";
  recommendationCode:
    | "background-process-readiness-packet-ready"
    | "background-process-readiness-packet-needs-evidence"
    | "background-process-readiness-packet-blocked";
  nextAction: string;
  blockers: string[];
};

export type RunwayReadinessCue = {
  decision: "ready-window" | "needs-evidence" | "blocked";
  recommendationCode:
    | "runway-readiness-ready-window"
    | "runway-readiness-needs-evidence"
    | "runway-readiness-blocked";
  recommendation: string;
  nextAction: string;
  blockers: string[];
  delegation: DelegationRunwayCue;
  background: BackgroundRunwayCue;
  summary: string;
};

function inferBackgroundCapabilitySignals(toolNames: Set<string>): {
  hasProcessRegistry: boolean;
  hasPortLeaseLock: boolean;
  hasBoundedLogTail: boolean;
  hasStructuredStacktraceCapture: boolean;
  hasHealthcheckProbe: boolean;
  hasGracefulStopThenKill: boolean;
  hasReloadHandoffCleanup: boolean;
} {
  const has = (name: string): boolean => toolNames.has(name);
  const hasAnyContaining = (fragment: string): boolean => {
    const f = fragment.toLowerCase();
    return Array.from(toolNames).some((name) => name.toLowerCase().includes(f));
  };
  const hasBgStatus = has("bg_status");

  return {
    hasProcessRegistry: hasBgStatus,
    hasPortLeaseLock: has("background_process_plan") && hasAnyContaining("port"),
    hasBoundedLogTail: hasBgStatus,
    hasStructuredStacktraceCapture: hasAnyContaining("stacktrace") || has("background_process_plan"),
    hasHealthcheckProbe: hasAnyContaining("healthcheck"),
    hasGracefulStopThenKill: hasBgStatus,
    hasReloadHandoffCleanup: hasAnyContaining("context_watch_checkpoint") || hasAnyContaining("handoff"),
  };
}

function normalizeBackgroundKind(value: unknown): "frontend" | "backend" | "test-server" | "worker" | "generic" | undefined {
  return value === "frontend" || value === "backend" || value === "test-server" || value === "worker" || value === "generic" ? value : undefined;
}

function normalizeBackgroundMode(value: unknown): "auto" | "shared-service" | "isolated-worker" | undefined {
  return value === "auto" || value === "shared-service" || value === "isolated-worker" ? value : undefined;
}

function buildDelegationRunwayCue(p: Record<string, unknown>, cwd: string): DelegationRunwayCue {
  const freshness = readDelegationFreshnessSignals(cwd);
  const capability = evaluateDelegationLaneCapabilitySnapshot({
    preloadDecision: pickEnumValue(p.delegation_preload_decision, ["use-pack", "fallback-canonical"]) ?? freshness.preloadDecision,
    dirtySignal: pickEnumValue(p.delegation_dirty_signal, ["clean", "dirty", "unknown"]) ?? freshness.dirtySignal,
    monitorClassifyFailures: asNumber(p.monitor_classify_failures, 0),
    subagentsReady: asBool(p.subagents_ready, true),
  });

  const delegatePacket = buildDelegateOrExecuteDecisionPacket({
    capabilityDecision: pickEnumValue(p.delegation_capability_decision, ["ready", "needs-evidence", "blocked"]) ?? capability.decision,
    capabilityRecommendationCode: asOptionalString(p.delegation_capability_recommendation_code) ?? capability.recommendationCode,
    capabilityBlockers: asStringArray(p.delegation_capability_blockers).length > 0
      ? asStringArray(p.delegation_capability_blockers)
      : capability.blockers,
    capabilityEvidenceGaps: asStringArray(p.delegation_capability_evidence_gaps).length > 0
      ? asStringArray(p.delegation_capability_evidence_gaps)
      : capability.evidenceGaps,
    mixDecision: pickEnumValue(p.delegation_mix_decision, ["ready", "needs-evidence"]) ?? "needs-evidence",
    mixScore: asOptionalNumber(p.delegation_mix_score) ?? 0,
    mixRecommendationCode: asOptionalString(p.delegation_mix_recommendation_code) ?? "delegation-mix-needs-evidence",
    mixSimpleDelegateEvents: asOptionalNumber(p.delegation_mix_simple_delegate_events) ?? 0,
    mixSwarmEvents: asOptionalNumber(p.delegation_mix_swarm_events) ?? 0,
  });

  const rehearsalPacket = buildSimpleDelegateRehearsalDecisionPacket({
    capabilityDecision: pickEnumValue(p.delegation_capability_decision, ["ready", "needs-evidence", "blocked"]) ?? capability.decision,
    capabilityRecommendationCode: asOptionalString(p.delegation_capability_recommendation_code) ?? capability.recommendationCode,
    capabilityBlockers: asStringArray(p.delegation_capability_blockers).length > 0
      ? asStringArray(p.delegation_capability_blockers)
      : capability.blockers,
    mixDecision: pickEnumValue(p.delegation_mix_decision, ["ready", "needs-evidence"]) ?? "needs-evidence",
    mixScore: asOptionalNumber(p.delegation_mix_score) ?? 0,
    mixSimpleDelegateEvents: asOptionalNumber(p.delegation_mix_simple_delegate_events) ?? 0,
    autoAdvanceDecision: pickEnumValue(p.delegation_auto_advance_decision, ["eligible", "blocked"]) ?? "blocked",
    autoAdvanceBlockedReasons: asStringArray(p.delegation_auto_advance_blocked_reasons),
    telemetryDecision: pickEnumValue(p.delegation_telemetry_decision, ["ready", "needs-evidence"]) ?? "needs-evidence",
    telemetryScore: asOptionalNumber(p.delegation_telemetry_score) ?? 0,
    telemetryBlockedRatePct: asOptionalNumber(p.delegation_telemetry_blocked_rate_pct) ?? 100,
  });

  const blockers = [...new Set([...delegatePacket.blockers, ...rehearsalPacket.blockers])];

  if (delegatePacket.recommendedOption === "simple-delegate" && rehearsalPacket.decision === "ready") {
    return {
      decision: "ready-simple-delegate",
      recommendationCode: "delegation-readiness-ready-simple-delegate",
      nextAction: "run simple_delegate_rehearsal_start_packet and require explicit human start/defer decision.",
      blockers,
    };
  }

  if (delegatePacket.recommendedOption === "local-execute" || rehearsalPacket.decision === "needs-evidence") {
    return {
      decision: "local-execute-first",
      recommendationCode: "delegation-readiness-local-execute-first",
      nextAction: "execute one bounded local-safe slice and refresh delegation readiness packets.",
      blockers,
    };
  }

  return {
    decision: "defer",
    recommendationCode: "delegation-readiness-defer-blocked",
    nextAction: "resolve delegation blockers and rerun delegation_readiness_status_packet.",
    blockers,
  };
}

function buildBackgroundRunwayCue(
  p: Record<string, unknown>,
  toolNames: Set<string>,
): BackgroundRunwayCue {
  const inferred = inferBackgroundCapabilitySignals(toolNames);
  const plan = resolveBackgroundProcessControlPlan({
    kind: normalizeBackgroundKind(p.background_kind),
    requestedMode: normalizeBackgroundMode(p.background_requested_mode),
    needsServer: asOptionalBoolean(p.background_needs_server),
    requestedPort: asOptionalNumber(p.background_requested_port),
    parallelAgents: asOptionalNumber(p.background_parallel_agents),
    existingServiceReusable: asOptionalBoolean(p.background_existing_service_reusable),
    destructiveRestart: asOptionalBoolean(p.background_destructive_restart),
    logTailMaxLines: asOptionalNumber(p.background_log_tail_max_lines),
    stacktraceCapture: asOptionalBoolean(p.background_stacktrace_capture),
    healthcheckKnown: asOptionalBoolean(p.background_healthcheck_known),
  });

  const readiness = buildBackgroundProcessReadinessScore({
    hasProcessRegistry: asOptionalBoolean(p.background_has_process_registry) ?? inferred.hasProcessRegistry,
    hasPortLeaseLock: asOptionalBoolean(p.background_has_port_lease_lock) ?? inferred.hasPortLeaseLock,
    hasBoundedLogTail: asOptionalBoolean(p.background_has_bounded_log_tail) ?? inferred.hasBoundedLogTail,
    hasStructuredStacktraceCapture: asOptionalBoolean(p.background_has_structured_stacktrace_capture) ?? inferred.hasStructuredStacktraceCapture,
    hasHealthcheckProbe: asOptionalBoolean(p.background_has_healthcheck_probe) ?? inferred.hasHealthcheckProbe,
    hasGracefulStopThenKill: asOptionalBoolean(p.background_has_graceful_stop_then_kill) ?? inferred.hasGracefulStopThenKill,
    hasReloadHandoffCleanup: asOptionalBoolean(p.background_has_reload_handoff_cleanup) ?? inferred.hasReloadHandoffCleanup,
    hasPlanSurface: asOptionalBoolean(p.background_has_plan_surface) ?? toolNames.has("background_process_plan"),
    hasLifecycleSurface: asOptionalBoolean(p.background_has_lifecycle_surface) ?? toolNames.has("background_process_lifecycle_plan"),
    rehearsalSlices: asOptionalNumber(p.background_rehearsal_slices),
    stopSourceCoveragePct: asOptionalNumber(p.background_stop_source_coverage_pct),
  });

  const rehearsal = evaluateBackgroundProcessRehearsal({
    readinessScore: readiness.score,
    readinessRecommendationCode: readiness.recommendationCode,
    lifecycleClassified: asBool(p.background_lifecycle_classified, false),
    stopSourceCoveragePct: asOptionalNumber(p.background_stop_source_coverage_pct),
    rollbackPlanKnown: asBool(p.background_rollback_plan_known, false),
    rehearsalSlices: asOptionalNumber(p.background_rehearsal_slices),
    unresolvedBlockers: asNumber(p.background_unresolved_blockers, 0),
    destructiveRestartRequested: asBool(p.background_destructive_restart_requested, false),
    protectedScopeRequested: asBool(p.background_protected_scope_requested, false),
  });

  const blockers = [...new Set([
    ...(Array.isArray(plan.blockers) ? plan.blockers : []),
    ...(Array.isArray(rehearsal.blockers) ? rehearsal.blockers : []),
  ])];

  if (plan.decision === "blocked" || rehearsal.decision === "blocked") {
    return {
      decision: "blocked",
      recommendationCode: "background-process-readiness-packet-blocked",
      nextAction: "resolve background-process blockers and rerun background_process_readiness_packet.",
      blockers,
    };
  }

  if (plan.decision !== "ready-for-design" || rehearsal.decision !== "ready") {
    return {
      decision: "needs-evidence",
      recommendationCode: "background-process-readiness-packet-needs-evidence",
      nextAction: "increase background-process readiness evidence (lifecycle classification, stopSource, rollback, slices).",
      blockers,
    };
  }

  return {
    decision: "ready-window",
    recommendationCode: "background-process-readiness-packet-ready",
    nextAction: "plan one bounded local rehearsal slice with explicit rollback and lifecycle capture.",
    blockers,
  };
}

export function buildRunwayReadinessCue(
  p: Record<string, unknown>,
  ctx: { cwd: string },
  pi: Pick<ExtensionAPI, "getAllTools">,
): RunwayReadinessCue {
  const toolNames = new Set(
    (typeof pi.getAllTools === "function" ? pi.getAllTools() : [])
      .map((tool) => (tool && typeof tool === "object" ? (tool as { name?: unknown }).name : undefined))
      .filter((name): name is string => typeof name === "string"),
  );

  const delegation = buildDelegationRunwayCue(p, ctx.cwd);
  const background = buildBackgroundRunwayCue(p, toolNames);
  const blockers = [...new Set([...delegation.blockers, ...background.blockers])];

  if (delegation.decision === "defer" || background.decision === "blocked") {
    const summary = [
      "runway-readiness-cue:",
      "decision=blocked",
      "code=runway-readiness-blocked",
      `delegation=${delegation.decision}`,
      `background=${background.decision}`,
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
      "authorization=none",
    ].filter(Boolean).join(" ");
    return {
      decision: "blocked",
      recommendationCode: "runway-readiness-blocked",
      recommendation: "runway blocked; keep local-safe execution and resolve blockers before scale promotion.",
      nextAction: `${delegation.nextAction} ${background.nextAction}`,
      blockers,
      delegation,
      background,
      summary,
    };
  }

  if (delegation.decision === "ready-simple-delegate" && background.decision === "ready-window") {
    const summary = [
      "runway-readiness-cue:",
      "decision=ready-window",
      "code=runway-readiness-ready-window",
      `delegation=${delegation.decision}`,
      `background=${background.decision}`,
      "authorization=none",
    ].join(" ");
    return {
      decision: "ready-window",
      recommendationCode: "runway-readiness-ready-window",
      recommendation: "delegation/background runway is ready for bounded promotion planning (still explicit human decision).",
      nextAction: "choose one promotion lane (simple-delegate or background rehearsal) and keep explicit human start/defer.",
      blockers,
      delegation,
      background,
      summary,
    };
  }

  const summary = [
    "runway-readiness-cue:",
    "decision=needs-evidence",
    "code=runway-readiness-needs-evidence",
    `delegation=${delegation.decision}`,
    `background=${background.decision}`,
    blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    "authorization=none",
  ].filter(Boolean).join(" ");
  return {
    decision: "needs-evidence",
    recommendationCode: "runway-readiness-needs-evidence",
    recommendation: "runway still needs evidence; continue local-safe slices while collecting readiness signals.",
    nextAction: delegation.decision !== "ready-simple-delegate" ? delegation.nextAction : background.nextAction,
    blockers,
    delegation,
    background,
    summary,
  };
}
