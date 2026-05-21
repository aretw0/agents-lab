/**
 * @capability-id runtime-guardrails
 * @capability-criticality high
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { buildBackgroundProcessReadinessScore, resolveBackgroundProcessControlPlan } from "./guardrails-core-background-process";
import { evaluateBackgroundProcessRehearsal } from "./guardrails-core-background-process-rehearsal";
import {
  buildDelegateOrExecuteDecisionPacket,
  buildOpsCalibrationDecisionPacket,
  buildDelegationRehearsalDecisionPacket,
  buildDelegationRehearsalStartPacket,
} from "./guardrails-core-ops-calibration";
import { buildAgentsAsToolsCalibrationScore, type ToolHygieneInputTool } from "./guardrails-core-tool-hygiene";
import {
  evaluateDelegationLaneCapabilitySnapshot,
  type DelegationLaneCapabilitySnapshot,
} from "./guardrails-core-autonomy-lane";
import { readAutonomyHandoffFocusTaskIds } from "./guardrails-core-autonomy-task-selector";
import {
  collectSessionRecords,
  parseAutoAdvanceHardIntentTelemetry,
  parseDelegationMixScore,
  type AutoAdvanceHardIntentTelemetry,
  type DelegationMixScore,
  type SessionAnalyticsScanSummary,
} from "./session-analytics";
import { GUARDRAILS_AUTHORIZATION_NONE } from "./guardrails-core-authorization";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

import {
  asOptionalBoolean,
  buildDelegationReadinessStatus,
  buildOperationalRunwayPacket,
  buildDelegationRehearsalOperatorPauseBrief,
  buildDelegationRehearsalResolutionSummary,
  buildUnlockChecklist,
  formatDelegationRehearsalOperatorPauseBriefSummary,
  inferBackgroundCapabilitySignals,
  inferDelegationCapabilityDefaults,
  inferLiveAutoAdvanceSnapshot,
  resolveAutoAdvanceCompositeDecision,
  resolveEffectiveTelemetrySignals,
  toolInfoToInput,
} from "./guardrails-core-ops-calibration-surface-helpers";

function emptySessionScan(): SessionAnalyticsScanSummary {
  return {
    maxTailBytes: 0,
    maxLineChars: 0,
    maxRecordsPerFile: 0,
    totalFileBytes: 0,
    totalBytesRead: 0,
    tailWindowFiles: 0,
    droppedLeadingPartialLines: 0,
    skippedLongLines: 0,
    parseErrors: 0,
    recordsCappedFiles: 0,
    readErrors: 0,
  };
}

function emptyCollectedSessionRecords(): ReturnType<typeof collectSessionRecords> {
  return {
    files: [],
    allRecords: [],
    scan: emptySessionScan(),
  };
}

function parseLookbackHours(p: Record<string, unknown>): number {
  const lookbackHoursRaw = Number(p.lookback_hours);
  return Number.isFinite(lookbackHoursRaw) && lookbackHoursRaw > 0
    ? lookbackHoursRaw
    : 24;
}

function buildDelegationCapabilityOverride(
  p: Record<string, unknown>,
): DelegationLaneCapabilitySnapshot | undefined {
  if (typeof p.capability_decision !== "string" || typeof p.capability_recommendation_code !== "string") {
    return undefined;
  }

  const decision = p.capability_decision === "blocked"
    ? "blocked"
    : p.capability_decision === "needs-evidence"
      ? "needs-evidence"
      : "ready";

  return {
    decision,
    recommendationCode: p.capability_recommendation_code,
    recommendation: "delegation capability supplied by explicit override; preload and git defaults skipped.",
    signals: {
      preloadDecision: p.preload_decision === "fallback-canonical" ? "fallback-canonical" : "use-pack",
      dirtySignal: p.dirty_signal === "dirty" || p.dirty_signal === "unknown" ? p.dirty_signal : "clean",
      monitorClassifyFailures: typeof p.monitor_classify_failures === "number"
        ? Math.max(0, Math.floor(p.monitor_classify_failures))
        : 0,
      subagentsReady: p.subagents_ready !== false,
    },
    blockers: Array.isArray(p.capability_blockers) ? p.capability_blockers as string[] : [],
    evidenceGaps: Array.isArray(p.capability_evidence_gaps) ? p.capability_evidence_gaps as string[] : [],
  };
}

function buildDelegationCapabilityState(
  p: Record<string, unknown>,
  cwd: string,
): {
  capability: DelegationLaneCapabilitySnapshot;
  inferredCapabilityDefaults: {
    preloadDecision: "use-pack" | "fallback-canonical";
    dirtySignal: "clean" | "dirty" | "unknown";
  };
} {
  const capabilityOverride = buildDelegationCapabilityOverride(p);
  const inferredCapabilityDefaults = capabilityOverride
    ? {
      preloadDecision: capabilityOverride.signals.preloadDecision,
      dirtySignal: capabilityOverride.signals.dirtySignal,
    }
    : inferDelegationCapabilityDefaults(cwd);
  const capability = capabilityOverride ?? evaluateDelegationLaneCapabilitySnapshot({
    preloadDecision: typeof p.preload_decision === "string"
      ? p.preload_decision
      : inferredCapabilityDefaults.preloadDecision,
    dirtySignal: typeof p.dirty_signal === "string"
      ? p.dirty_signal
      : inferredCapabilityDefaults.dirtySignal,
    monitorClassifyFailures: typeof p.monitor_classify_failures === "number" ? p.monitor_classify_failures : 0,
    subagentsReady: typeof p.subagents_ready === "boolean" ? p.subagents_ready : true,
  });

  return { capability, inferredCapabilityDefaults };
}

function buildDelegationMixOverrideScore(
  p: Record<string, unknown>,
  lookbackHours: number,
): DelegationMixScore | undefined {
  if (
    typeof p.mix_decision !== "string"
    || typeof p.mix_score !== "number"
    || typeof p.mix_delegation_events !== "number"
    || typeof p.mix_swarm_events !== "number"
  ) {
    return undefined;
  }

  const decision = p.mix_decision === "ready" ? "ready" : "needs-evidence";
  const delegate = Math.max(0, Math.floor(p.mix_delegation_events));
  const swarm = Math.max(0, Math.floor(p.mix_swarm_events));
  const totalEvents = delegate + swarm;
  const recommendationCode = typeof p.mix_recommendation_code === "string"
    ? p.mix_recommendation_code as DelegationMixScore["recommendationCode"]
    : decision === "ready"
      ? "delegation-mix-ready-diverse"
      : "delegation-mix-needs-evidence-no-data";

  const summary = [
    "delegation-mix-score:",
    `decision=${decision}`,
    `score=${p.mix_score}`,
    `events=${totalEvents}`,
    "local=0",
    "manual=0",
    `delegate=${delegate}`,
    `swarm=${swarm}`,
    `code=${recommendationCode}`,
    `authorization=${GUARDRAILS_AUTHORIZATION_NONE}`,
  ].join(" ");

  return {
    mode: "delegation-mix-score",
    decision,
    score: Math.max(0, Math.min(100, Math.round(p.mix_score))),
    recommendationCode,
    recommendation: "delegation mix supplied by explicit override; session scan skipped.",
    window: {
      lookbackHours,
      filesScanned: 0,
      totalRecords: 0,
    },
    totals: {
      totalEvents,
      local: 0,
      manual: 0,
      delegate,
      swarm,
      diversityModes: [delegate, swarm].filter((value) => value > 0).length,
      delegatedSharePct: totalEvents > 0 ? 100 : 0,
    },
    buckets: [
      { mode: "local", count: 0, sharePct: 0, examples: [] },
      { mode: "manual", count: 0, sharePct: 0, examples: [] },
      {
        mode: "delegate",
        count: delegate,
        sharePct: totalEvents > 0 ? Math.round((delegate / totalEvents) * 100) : 0,
        examples: ["override:mix_delegation_events"],
      },
      {
        mode: "swarm",
        count: swarm,
        sharePct: totalEvents > 0 ? Math.round((swarm / totalEvents) * 100) : 0,
        examples: ["override:mix_swarm_events"],
      },
    ],
    dispatchAllowed: false,
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    mutationAllowed: false,
    summary,
  };
}

function buildAutoAdvanceTelemetryOverride(
  p: Record<string, unknown>,
  lookbackHours: number,
): AutoAdvanceHardIntentTelemetry | undefined {
  if (
    typeof p.auto_advance_decision !== "string"
    || typeof p.telemetry_decision !== "string"
    || typeof p.telemetry_score !== "number"
    || typeof p.telemetry_blocked_rate_pct !== "number"
  ) {
    return undefined;
  }

  const decision = p.telemetry_decision === "ready" ? "ready" : "needs-evidence";
  const autoAdvanceEligible = p.auto_advance_decision === "eligible";
  const blockedReasons = Array.isArray(p.auto_advance_blocked_reasons)
    ? (p.auto_advance_blocked_reasons as unknown[])
      .filter((row): row is string => typeof row === "string" && row.trim().length > 0)
      .map((reason) => ({ reason, count: 1 }))
    : [];
  const score = Math.max(0, Math.min(100, Math.round(p.telemetry_score)));
  const blockedRatePct = Math.max(0, Math.min(100, Math.round(p.telemetry_blocked_rate_pct)));
  const recommendationCode = decision === "ready"
    ? "auto-advance-telemetry-ready"
    : autoAdvanceEligible
      ? "auto-advance-telemetry-needs-hardening-block-rate"
      : "auto-advance-telemetry-needs-evidence-eligible-missing";
  const summary = [
    "auto-advance-hard-intent-telemetry:",
    `decision=${decision}`,
    `score=${score}`,
    "events=0",
    `eligible=${autoAdvanceEligible ? 1 : 0}`,
    `blocked=${autoAdvanceEligible ? 0 : 1}`,
    `blockedRatePct=${blockedRatePct}`,
    `code=${recommendationCode}`,
    `authorization=${GUARDRAILS_AUTHORIZATION_NONE}`,
  ].join(" ");

  return {
    mode: "auto-advance-hard-intent-telemetry",
    decision,
    score,
    recommendationCode,
    recommendation: "auto-advance telemetry supplied by explicit override; session scan skipped.",
    window: {
      lookbackHours,
      filesScanned: 0,
      totalRecords: 0,
    },
    totals: {
      totalEvents: 0,
      eligibleEvents: autoAdvanceEligible ? 1 : 0,
      blockedEvents: autoAdvanceEligible ? 0 : 1,
      blockedRatePct,
    },
    blockedReasons,
    examples: {
      eligible: autoAdvanceEligible ? ["override:auto_advance_decision=eligible"] : [],
      blocked: autoAdvanceEligible ? [] : ["override:auto_advance_decision=blocked"],
    },
    dispatchAllowed: false,
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    mutationAllowed: false,
    summary,
  };
}

function buildSessionTelemetryState(
  p: Record<string, unknown>,
  cwd: string,
  lookbackHours: number,
): {
  collected: ReturnType<typeof collectSessionRecords>;
  mix: DelegationMixScore;
  autoAdvanceTelemetry: AutoAdvanceHardIntentTelemetry;
} {
  const mixOverride = buildDelegationMixOverrideScore(p, lookbackHours);
  const autoAdvanceTelemetryOverride = buildAutoAdvanceTelemetryOverride(p, lookbackHours);
  const collected = mixOverride && autoAdvanceTelemetryOverride
    ? emptyCollectedSessionRecords()
    : collectSessionRecords(cwd, lookbackHours);

  return {
    collected,
    mix: mixOverride ?? parseDelegationMixScore(collected.allRecords, lookbackHours, collected.files.length),
    autoAdvanceTelemetry: autoAdvanceTelemetryOverride
      ?? parseAutoAdvanceHardIntentTelemetry(collected.allRecords, lookbackHours, collected.files.length),
  };
}

function buildAutoAdvanceLiveSnapshot(
  p: Record<string, unknown>,
  cwd: string,
): ReturnType<typeof inferLiveAutoAdvanceSnapshot> {
  if (typeof p.auto_advance_decision !== "string") {
    return inferLiveAutoAdvanceSnapshot(cwd);
  }

  const decision = p.auto_advance_decision === "eligible" ? "eligible" : "blocked";
  const blockedReasons = Array.isArray(p.auto_advance_blocked_reasons)
    ? (p.auto_advance_blocked_reasons as unknown[]).filter((row): row is string => typeof row === "string")
    : [];

  return {
    decision,
    blockedReasons: decision === "blocked" ? (blockedReasons.length > 0 ? blockedReasons : ["override-blocked"]) : [],
    focusTaskIds: [],
    focusSelectionReason: "override-supplied",
  };
}

export function registerGuardrailsOpsCalibrationSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "delegate_or_execute_decision_packet",
    label: "Delegate or Execute Decision Packet",
    description: "Report-only packet recommending local-execute vs delegate vs defer from delegation capability + mix signals. Never dispatches execution.",
    parameters: Type.Object({
      lookback_hours: Type.Optional(Type.Number({ description: "How many hours back to scan local session evidence for mix score. Default: 24." })),
      preload_decision: Type.Optional(Type.String({ description: "use-pack | fallback-canonical" })),
      dirty_signal: Type.Optional(Type.String({ description: "clean | dirty | unknown" })),
      monitor_classify_failures: Type.Optional(Type.Number({ description: "Classify-failure count. Default 0." })),
      subagents_ready: Type.Optional(Type.Boolean({ description: "Subagent readiness signal. Default true." })),
      capability_decision: Type.Optional(Type.String({ description: "Override capability decision: ready | needs-evidence | blocked" })),
      capability_recommendation_code: Type.Optional(Type.String({ description: "Optional capability recommendation code override." })),
      capability_blockers: Type.Optional(Type.Array(Type.String())),
      capability_evidence_gaps: Type.Optional(Type.Array(Type.String())),
      mix_decision: Type.Optional(Type.String({ description: "Override mix decision: ready | needs-evidence" })),
      mix_score: Type.Optional(Type.Number({ description: "Override mix score (0..100)." })),
      mix_recommendation_code: Type.Optional(Type.String({ description: "Optional mix recommendation code override." })),
      mix_delegation_events: Type.Optional(Type.Number({ description: "Override delegation event count." })),
      mix_swarm_events: Type.Optional(Type.Number({ description: "Override swarm event count." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const lookbackHours = parseLookbackHours(p);
      const cwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();

      const { capability, inferredCapabilityDefaults } = buildDelegationCapabilityState(p, cwd);
      const mixOverride = buildDelegationMixOverrideScore(p, lookbackHours);
      const collected = mixOverride ? emptyCollectedSessionRecords() : collectSessionRecords(cwd, lookbackHours);
      const mix = mixOverride ?? parseDelegationMixScore(collected.allRecords, lookbackHours, collected.files.length);

      const packet = buildDelegateOrExecuteDecisionPacket({
        capabilityDecision: typeof p.capability_decision === "string"
          ? p.capability_decision as "ready" | "needs-evidence" | "blocked"
          : capability.decision,
        capabilityRecommendationCode: typeof p.capability_recommendation_code === "string"
          ? p.capability_recommendation_code
          : capability.recommendationCode,
        capabilityBlockers: Array.isArray(p.capability_blockers) ? p.capability_blockers as string[] : capability.blockers,
        capabilityEvidenceGaps: Array.isArray(p.capability_evidence_gaps) ? p.capability_evidence_gaps as string[] : capability.evidenceGaps,
        mixDecision: typeof p.mix_decision === "string"
          ? p.mix_decision as "ready" | "needs-evidence"
          : mix.decision,
        mixScore: typeof p.mix_score === "number" ? p.mix_score : mix.score,
        mixRecommendationCode: typeof p.mix_recommendation_code === "string"
          ? p.mix_recommendation_code
          : mix.recommendationCode,
        mixDelegationEvents: typeof p.mix_delegation_events === "number"
          ? p.mix_delegation_events
          : mix.totals.delegate,
        mixSwarmEvents: typeof p.mix_swarm_events === "number"
          ? p.mix_swarm_events
          : mix.totals.swarm,
      });

      return {
        content: [{ type: "text", text: packet.summary }],
        details: {
          ...packet,
          capability,
          inferredCapabilityDefaults,
          mix,
          scan: collected.scan,
        },
      };
    },
  });

  pi.registerTool({
    name: "delegation_rehearsal_packet",
    label: "Delegation Rehearsal Packet",
    description: "Report-only readiness packet for bounded delegation rehearsal from capability + mix + auto-advance telemetry signals.",
    parameters: Type.Object({
      lookback_hours: Type.Optional(Type.Number({ description: "How many hours back to scan local session evidence. Default: 24." })),
      preload_decision: Type.Optional(Type.String({ description: "use-pack | fallback-canonical" })),
      dirty_signal: Type.Optional(Type.String({ description: "clean | dirty | unknown" })),
      monitor_classify_failures: Type.Optional(Type.Number({ description: "Classify-failure count. Default 0." })),
      subagents_ready: Type.Optional(Type.Boolean({ description: "Subagent readiness signal. Default true." })),
      capability_decision: Type.Optional(Type.String({ description: "Override capability decision: ready | needs-evidence | blocked" })),
      capability_recommendation_code: Type.Optional(Type.String({ description: "Optional capability recommendation code override." })),
      capability_blockers: Type.Optional(Type.Array(Type.String())),
      mix_decision: Type.Optional(Type.String({ description: "Override mix decision: ready | needs-evidence" })),
      mix_score: Type.Optional(Type.Number({ description: "Override mix score (0..100)." })),
      mix_delegation_events: Type.Optional(Type.Number({ description: "Override delegation event count." })),
      auto_advance_decision: Type.Optional(Type.String({ description: "Override auto-advance decision: eligible | blocked" })),
      auto_advance_blocked_reasons: Type.Optional(Type.Array(Type.String())),
      telemetry_decision: Type.Optional(Type.String({ description: "Override telemetry decision: ready | needs-evidence" })),
      telemetry_score: Type.Optional(Type.Number({ description: "Override telemetry score (0..100)." })),
      telemetry_blocked_rate_pct: Type.Optional(Type.Number({ description: "Override telemetry blocked rate pct (0..100)." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const lookbackHours = parseLookbackHours(p);
      const cwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();

      const { capability, inferredCapabilityDefaults } = buildDelegationCapabilityState(p, cwd);
      const { collected, mix, autoAdvanceTelemetry } = buildSessionTelemetryState(p, cwd, lookbackHours);

      const telemetryBlockedReasons = autoAdvanceTelemetry.blockedReasons.map((row) => row.reason);
      const liveAutoAdvanceSnapshot = buildAutoAdvanceLiveSnapshot(p, cwd);
      const autoAdvanceComposite = resolveAutoAdvanceCompositeDecision({
        autoAdvanceDecisionOverride: p.auto_advance_decision,
        autoAdvanceBlockedReasonsOverride: p.auto_advance_blocked_reasons,
        telemetryDecision: autoAdvanceTelemetry.decision,
        telemetryBlockedReasons,
        telemetryEligibleEvents: autoAdvanceTelemetry.totals.eligibleEvents,
        liveSnapshot: liveAutoAdvanceSnapshot,
      });

      const effectiveTelemetry = resolveEffectiveTelemetrySignals({
        telemetryDecisionOverride: p.telemetry_decision,
        telemetryScoreOverride: p.telemetry_score,
        telemetryBlockedRatePctOverride: p.telemetry_blocked_rate_pct,
        telemetryDecisionRaw: autoAdvanceTelemetry.decision,
        telemetryScoreRaw: autoAdvanceTelemetry.score,
        telemetryBlockedRatePctRaw: autoAdvanceTelemetry.totals.blockedRatePct,
        autoAdvanceComposite,
      });

      const packet = buildDelegationRehearsalDecisionPacket({
        capabilityDecision: typeof p.capability_decision === "string"
          ? p.capability_decision as "ready" | "needs-evidence" | "blocked"
          : capability.decision,
        capabilityRecommendationCode: typeof p.capability_recommendation_code === "string"
          ? p.capability_recommendation_code
          : capability.recommendationCode,
        capabilityBlockers: Array.isArray(p.capability_blockers) ? p.capability_blockers as string[] : capability.blockers,
        mixDecision: typeof p.mix_decision === "string"
          ? p.mix_decision as "ready" | "needs-evidence"
          : mix.decision,
        mixScore: typeof p.mix_score === "number" ? p.mix_score : mix.score,
        mixDelegationEvents: typeof p.mix_delegation_events === "number"
          ? p.mix_delegation_events
          : mix.totals.delegate,
        autoAdvanceDecision: autoAdvanceComposite.decision,
        autoAdvanceBlockedReasons: autoAdvanceComposite.blockedReasons,
        telemetryDecision: effectiveTelemetry.decision,
        telemetryScore: effectiveTelemetry.score,
        telemetryBlockedRatePct: effectiveTelemetry.blockedRatePct,
      });

      const summary = buildDelegationRehearsalResolutionSummary({
        baseSummary: packet.summary,
        source: autoAdvanceComposite.source,
        liveDecision: liveAutoAdvanceSnapshot.decision,
        liveNextTaskId: liveAutoAdvanceSnapshot.nextTaskId,
        telemetrySource: effectiveTelemetry.source,
      });

      return {
        content: [{ type: "text", text: summary }],
        details: {
          ...packet,
          summary,
          capability,
          inferredCapabilityDefaults,
          mix,
          autoAdvanceTelemetry,
          effectiveTelemetrySignals: effectiveTelemetry,
          autoAdvanceLiveSnapshot: liveAutoAdvanceSnapshot,
          autoAdvanceResolutionSource: autoAdvanceComposite.source,
          scan: collected.scan,
        },
      };
    },
  });

  pi.registerTool({
    name: "delegation_readiness_status_packet",
    label: "Delegation Readiness Status Packet",
    description: "Report-only unified runway status composing delegation + background readiness with explicit options local-execute | delegate | defer. Never dispatches execution.",
    parameters: Type.Object({
      lookback_hours: Type.Optional(Type.Number({ description: "How many hours back to scan local session evidence. Default: 24." })),
      preload_decision: Type.Optional(Type.String({ description: "use-pack | fallback-canonical" })),
      dirty_signal: Type.Optional(Type.String({ description: "clean | dirty | unknown" })),
      monitor_classify_failures: Type.Optional(Type.Number({ description: "Classify-failure count. Default 0." })),
      subagents_ready: Type.Optional(Type.Boolean({ description: "Subagent readiness signal. Default true." })),
      capability_decision: Type.Optional(Type.String({ description: "Override capability decision: ready | needs-evidence | blocked" })),
      capability_recommendation_code: Type.Optional(Type.String({ description: "Optional capability recommendation code override." })),
      capability_blockers: Type.Optional(Type.Array(Type.String())),
      capability_evidence_gaps: Type.Optional(Type.Array(Type.String())),
      mix_decision: Type.Optional(Type.String({ description: "Override mix decision: ready | needs-evidence" })),
      mix_score: Type.Optional(Type.Number({ description: "Override mix score (0..100)." })),
      mix_recommendation_code: Type.Optional(Type.String({ description: "Optional mix recommendation code override." })),
      mix_delegation_events: Type.Optional(Type.Number({ description: "Override delegation event count." })),
      mix_swarm_events: Type.Optional(Type.Number({ description: "Override swarm event count." })),
      auto_advance_decision: Type.Optional(Type.String({ description: "Override auto-advance decision: eligible | blocked" })),
      auto_advance_blocked_reasons: Type.Optional(Type.Array(Type.String())),
      telemetry_decision: Type.Optional(Type.String({ description: "Override telemetry decision: ready | needs-evidence" })),
      telemetry_score: Type.Optional(Type.Number({ description: "Override telemetry score (0..100)." })),
      telemetry_blocked_rate_pct: Type.Optional(Type.Number({ description: "Override telemetry blocked rate pct (0..100)." })),
      background_kind: Type.Optional(Type.String({ description: "Override background kind (frontend | backend | test-server | worker | generic)." })),
      background_requested_mode: Type.Optional(Type.String({ description: "Override background mode (auto | shared-service | isolated-worker)." })),
      background_needs_server: Type.Optional(Type.Boolean({ description: "Override background server requirement." })),
      background_requested_port: Type.Optional(Type.Number({ description: "Override desired background port." })),
      background_parallel_agents: Type.Optional(Type.Number({ description: "Override expected parallel agents for background runway cue." })),
      background_existing_service_reusable: Type.Optional(Type.Boolean({ description: "Override existing-service-reusable signal for background runway cue." })),
      background_destructive_restart: Type.Optional(Type.Boolean({ description: "Override destructive restart signal for background runway cue." })),
      background_log_tail_max_lines: Type.Optional(Type.Number({ description: "Override log tail max lines for background runway cue." })),
      background_stacktrace_capture: Type.Optional(Type.Boolean({ description: "Override stacktrace capture signal for background runway cue." })),
      background_healthcheck_known: Type.Optional(Type.Boolean({ description: "Override healthcheck-known signal for background runway cue." })),
      background_has_process_registry: Type.Optional(Type.Boolean({ description: "Override process registry capability signal." })),
      background_has_port_lease_lock: Type.Optional(Type.Boolean({ description: "Override port lease/lock capability signal." })),
      background_has_bounded_log_tail: Type.Optional(Type.Boolean({ description: "Override bounded log tail capability signal." })),
      background_has_structured_stacktrace_capture: Type.Optional(Type.Boolean({ description: "Override structured stacktrace capability signal." })),
      background_has_healthcheck_probe: Type.Optional(Type.Boolean({ description: "Override healthcheck probe capability signal." })),
      background_has_graceful_stop_then_kill: Type.Optional(Type.Boolean({ description: "Override graceful-stop capability signal." })),
      background_has_reload_handoff_cleanup: Type.Optional(Type.Boolean({ description: "Override reload/handoff cleanup capability signal." })),
      background_has_plan_surface: Type.Optional(Type.Boolean({ description: "Override background plan-surface availability signal." })),
      background_has_lifecycle_surface: Type.Optional(Type.Boolean({ description: "Override background lifecycle-surface availability signal." })),
      background_rehearsal_slices: Type.Optional(Type.Number({ description: "Override rehearsal slices evidence for background runway cue." })),
      background_stop_source_coverage_pct: Type.Optional(Type.Number({ description: "Override stopSource coverage pct for background runway cue." })),
      background_lifecycle_classified: Type.Optional(Type.Boolean({ description: "Override lifecycle-classified signal for background runway cue." })),
      background_rollback_plan_known: Type.Optional(Type.Boolean({ description: "Override rollback-known signal for background runway cue." })),
      background_unresolved_blockers: Type.Optional(Type.Number({ description: "Override unresolved blockers count for background runway cue." })),
      background_destructive_restart_requested: Type.Optional(Type.Boolean({ description: "Override destructive-restart-requested gate for background runway cue." })),
      background_protected_scope_requested: Type.Optional(Type.Boolean({ description: "Override protected-scope-requested gate for background runway cue." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const lookbackHours = parseLookbackHours(p);
      const cwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();

      const { capability, inferredCapabilityDefaults } = buildDelegationCapabilityState(p, cwd);
      const { collected, mix, autoAdvanceTelemetry } = buildSessionTelemetryState(p, cwd, lookbackHours);

      const telemetryBlockedReasons = autoAdvanceTelemetry.blockedReasons.map((row) => row.reason);
      const liveAutoAdvanceSnapshot = buildAutoAdvanceLiveSnapshot(p, cwd);
      const autoAdvanceComposite = resolveAutoAdvanceCompositeDecision({
        autoAdvanceDecisionOverride: p.auto_advance_decision,
        autoAdvanceBlockedReasonsOverride: p.auto_advance_blocked_reasons,
        telemetryDecision: autoAdvanceTelemetry.decision,
        telemetryBlockedReasons,
        telemetryEligibleEvents: autoAdvanceTelemetry.totals.eligibleEvents,
        liveSnapshot: liveAutoAdvanceSnapshot,
      });

      const effectiveTelemetry = resolveEffectiveTelemetrySignals({
        telemetryDecisionOverride: p.telemetry_decision,
        telemetryScoreOverride: p.telemetry_score,
        telemetryBlockedRatePctOverride: p.telemetry_blocked_rate_pct,
        telemetryDecisionRaw: autoAdvanceTelemetry.decision,
        telemetryScoreRaw: autoAdvanceTelemetry.score,
        telemetryBlockedRatePctRaw: autoAdvanceTelemetry.totals.blockedRatePct,
        autoAdvanceComposite,
      });

      const delegatePacket = buildDelegateOrExecuteDecisionPacket({
        capabilityDecision: typeof p.capability_decision === "string"
          ? p.capability_decision as "ready" | "needs-evidence" | "blocked"
          : capability.decision,
        capabilityRecommendationCode: typeof p.capability_recommendation_code === "string"
          ? p.capability_recommendation_code
          : capability.recommendationCode,
        capabilityBlockers: Array.isArray(p.capability_blockers) ? p.capability_blockers as string[] : capability.blockers,
        capabilityEvidenceGaps: Array.isArray(p.capability_evidence_gaps) ? p.capability_evidence_gaps as string[] : capability.evidenceGaps,
        mixDecision: typeof p.mix_decision === "string"
          ? p.mix_decision as "ready" | "needs-evidence"
          : mix.decision,
        mixScore: typeof p.mix_score === "number" ? p.mix_score : mix.score,
        mixRecommendationCode: typeof p.mix_recommendation_code === "string"
          ? p.mix_recommendation_code
          : mix.recommendationCode,
        mixDelegationEvents: typeof p.mix_delegation_events === "number"
          ? p.mix_delegation_events
          : mix.totals.delegate,
        mixSwarmEvents: typeof p.mix_swarm_events === "number"
          ? p.mix_swarm_events
          : mix.totals.swarm,
      });

      const rehearsalPacket = buildDelegationRehearsalDecisionPacket({
        capabilityDecision: typeof p.capability_decision === "string"
          ? p.capability_decision as "ready" | "needs-evidence" | "blocked"
          : capability.decision,
        capabilityRecommendationCode: typeof p.capability_recommendation_code === "string"
          ? p.capability_recommendation_code
          : capability.recommendationCode,
        capabilityBlockers: Array.isArray(p.capability_blockers) ? p.capability_blockers as string[] : capability.blockers,
        mixDecision: typeof p.mix_decision === "string"
          ? p.mix_decision as "ready" | "needs-evidence"
          : mix.decision,
        mixScore: typeof p.mix_score === "number" ? p.mix_score : mix.score,
        mixDelegationEvents: typeof p.mix_delegation_events === "number"
          ? p.mix_delegation_events
          : mix.totals.delegate,
        autoAdvanceDecision: autoAdvanceComposite.decision,
        autoAdvanceBlockedReasons: autoAdvanceComposite.blockedReasons,
        telemetryDecision: effectiveTelemetry.decision,
        telemetryScore: effectiveTelemetry.score,
        telemetryBlockedRatePct: effectiveTelemetry.blockedRatePct,
      });

      const status = buildDelegationReadinessStatus({
        delegatePacket,
        rehearsalPacket,
      });

      const allToolNames = new Set(pi.getAllTools().map((tool) => tool.name));
      const inferredBackgroundSignals = inferBackgroundCapabilitySignals(allToolNames);
      const backgroundPlan = resolveBackgroundProcessControlPlan({
        kind: typeof p.background_kind === "string" ? p.background_kind : undefined,
        requestedMode: typeof p.background_requested_mode === "string" ? p.background_requested_mode : undefined,
        needsServer: asOptionalBoolean(p.background_needs_server),
        requestedPort: typeof p.background_requested_port === "number" ? p.background_requested_port : undefined,
        parallelAgents: typeof p.background_parallel_agents === "number" ? p.background_parallel_agents : undefined,
        existingServiceReusable: asOptionalBoolean(p.background_existing_service_reusable),
        destructiveRestart: asOptionalBoolean(p.background_destructive_restart),
        logTailMaxLines: typeof p.background_log_tail_max_lines === "number" ? p.background_log_tail_max_lines : undefined,
        stacktraceCapture: asOptionalBoolean(p.background_stacktrace_capture),
        healthcheckKnown: asOptionalBoolean(p.background_healthcheck_known),
      });
      const backgroundReadiness = buildBackgroundProcessReadinessScore({
        hasProcessRegistry: asOptionalBoolean(p.background_has_process_registry) ?? inferredBackgroundSignals.hasProcessRegistry,
        hasPortLeaseLock: asOptionalBoolean(p.background_has_port_lease_lock) ?? inferredBackgroundSignals.hasPortLeaseLock,
        hasBoundedLogTail: asOptionalBoolean(p.background_has_bounded_log_tail) ?? inferredBackgroundSignals.hasBoundedLogTail,
        hasStructuredStacktraceCapture: asOptionalBoolean(p.background_has_structured_stacktrace_capture) ?? inferredBackgroundSignals.hasStructuredStacktraceCapture,
        hasHealthcheckProbe: asOptionalBoolean(p.background_has_healthcheck_probe) ?? inferredBackgroundSignals.hasHealthcheckProbe,
        hasGracefulStopThenKill: asOptionalBoolean(p.background_has_graceful_stop_then_kill) ?? inferredBackgroundSignals.hasGracefulStopThenKill,
        hasReloadHandoffCleanup: asOptionalBoolean(p.background_has_reload_handoff_cleanup) ?? inferredBackgroundSignals.hasReloadHandoffCleanup,
        hasPlanSurface: asOptionalBoolean(p.background_has_plan_surface) ?? allToolNames.has("background_process_plan"),
        hasLifecycleSurface: asOptionalBoolean(p.background_has_lifecycle_surface) ?? allToolNames.has("background_process_lifecycle_plan"),
        rehearsalSlices: typeof p.background_rehearsal_slices === "number" ? p.background_rehearsal_slices : undefined,
        stopSourceCoveragePct: typeof p.background_stop_source_coverage_pct === "number" ? p.background_stop_source_coverage_pct : undefined,
      });
      const backgroundRehearsal = evaluateBackgroundProcessRehearsal({
        readinessScore: backgroundReadiness.score,
        readinessRecommendationCode: backgroundReadiness.recommendationCode,
        lifecycleClassified: asOptionalBoolean(p.background_lifecycle_classified),
        stopSourceCoveragePct: typeof p.background_stop_source_coverage_pct === "number" ? p.background_stop_source_coverage_pct : undefined,
        rollbackPlanKnown: asOptionalBoolean(p.background_rollback_plan_known),
        rehearsalSlices: typeof p.background_rehearsal_slices === "number" ? p.background_rehearsal_slices : undefined,
        unresolvedBlockers: typeof p.background_unresolved_blockers === "number" ? p.background_unresolved_blockers : undefined,
        destructiveRestartRequested: asOptionalBoolean(p.background_destructive_restart_requested),
        protectedScopeRequested: asOptionalBoolean(p.background_protected_scope_requested),
      });
      const operationalRunway = buildOperationalRunwayPacket({
        delegation: {
          decision: status.decision,
          recommendationCode: status.recommendationCode,
          blockers: status.blockers,
        },
        background: {
          planDecision: backgroundPlan.decision,
          rehearsalDecision: backgroundRehearsal.decision,
          planBlockers: backgroundPlan.blockers,
          rehearsalBlockers: backgroundRehearsal.blockers,
        },
      });
      const unlockChecklist = buildUnlockChecklist({
        option: operationalRunway.recommendedOption,
        blockers: operationalRunway.normalizedBlockers,
        nextAction: operationalRunway.nextAction,
      });
      const summary = `${status.summary} ${operationalRunway.summary} ${unlockChecklist.summary}`;

      return {
        content: [{ type: "text", text: summary }],
        details: {
          mode: "delegation-readiness-status-packet",
          activation: "none",
          authorization: GUARDRAILS_AUTHORIZATION_NONE,
          dispatchAllowed: false,
          mutationAllowed: false,
          decision: status.decision,
          recommendationCode: status.recommendationCode,
          recommendation: status.recommendation,
          nextAction: status.nextAction,
          blockers: status.blockers,
          summary,
          delegatePacket,
          rehearsalPacket,
          operationalRunway,
          unlockChecklist,
          backgroundPlan,
          backgroundReadiness,
          backgroundRehearsal,
          capability,
          inferredCapabilityDefaults,
          inferredBackgroundSignals,
          mix,
          autoAdvanceTelemetry,
          effectiveTelemetrySignals: effectiveTelemetry,
          autoAdvanceLiveSnapshot: liveAutoAdvanceSnapshot,
          autoAdvanceResolutionSource: autoAdvanceComposite.source,
          scan: collected.scan,
        },
      };
    },
  });

  pi.registerTool({
    name: "delegation_rehearsal_start_packet",
    label: "Delegation Rehearsal Start Packet",
    description: "Report-only start/abort packet for one-task delegation rehearsal. Never dispatches execution and always requires explicit operator decision.",
    parameters: Type.Object({
      lookback_hours: Type.Optional(Type.Number({ description: "How many hours back to scan local session evidence. Default: 24." })),
      preload_decision: Type.Optional(Type.String({ description: "use-pack | fallback-canonical" })),
      dirty_signal: Type.Optional(Type.String({ description: "clean | dirty | unknown" })),
      monitor_classify_failures: Type.Optional(Type.Number({ description: "Classify-failure count. Default 0." })),
      subagents_ready: Type.Optional(Type.Boolean({ description: "Subagent readiness signal. Default true." })),
      capability_decision: Type.Optional(Type.String({ description: "Override capability decision: ready | needs-evidence | blocked" })),
      capability_recommendation_code: Type.Optional(Type.String({ description: "Optional capability recommendation code override." })),
      capability_blockers: Type.Optional(Type.Array(Type.String())),
      mix_decision: Type.Optional(Type.String({ description: "Override mix decision: ready | needs-evidence" })),
      mix_score: Type.Optional(Type.Number({ description: "Override mix score (0..100)." })),
      mix_delegation_events: Type.Optional(Type.Number({ description: "Override delegation event count." })),
      auto_advance_decision: Type.Optional(Type.String({ description: "Override auto-advance decision: eligible | blocked" })),
      auto_advance_blocked_reasons: Type.Optional(Type.Array(Type.String())),
      telemetry_decision: Type.Optional(Type.String({ description: "Override telemetry decision: ready | needs-evidence" })),
      telemetry_score: Type.Optional(Type.Number({ description: "Override telemetry score (0..100)." })),
      telemetry_blocked_rate_pct: Type.Optional(Type.Number({ description: "Override telemetry blocked rate pct (0..100)." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Block when protected scope is requested." })),
      declared_files_known: Type.Optional(Type.Boolean({ description: "Whether file scope for rehearsal task is explicitly declared." })),
      validation_gate_known: Type.Optional(Type.Boolean({ description: "Whether a bounded validation gate is known before start." })),
      rollback_plan_known: Type.Optional(Type.Boolean({ description: "Whether non-destructive rollback is known." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const lookbackHours = parseLookbackHours(p);
      const cwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();

      const { capability, inferredCapabilityDefaults } = buildDelegationCapabilityState(p, cwd);
      const { collected, mix, autoAdvanceTelemetry } = buildSessionTelemetryState(p, cwd, lookbackHours);

      const telemetryBlockedReasons = autoAdvanceTelemetry.blockedReasons.map((row) => row.reason);
      const liveAutoAdvanceSnapshot = buildAutoAdvanceLiveSnapshot(p, cwd);
      const autoAdvanceComposite = resolveAutoAdvanceCompositeDecision({
        autoAdvanceDecisionOverride: p.auto_advance_decision,
        autoAdvanceBlockedReasonsOverride: p.auto_advance_blocked_reasons,
        telemetryDecision: autoAdvanceTelemetry.decision,
        telemetryBlockedReasons,
        telemetryEligibleEvents: autoAdvanceTelemetry.totals.eligibleEvents,
        liveSnapshot: liveAutoAdvanceSnapshot,
      });

      const effectiveTelemetry = resolveEffectiveTelemetrySignals({
        telemetryDecisionOverride: p.telemetry_decision,
        telemetryScoreOverride: p.telemetry_score,
        telemetryBlockedRatePctOverride: p.telemetry_blocked_rate_pct,
        telemetryDecisionRaw: autoAdvanceTelemetry.decision,
        telemetryScoreRaw: autoAdvanceTelemetry.score,
        telemetryBlockedRatePctRaw: autoAdvanceTelemetry.totals.blockedRatePct,
        autoAdvanceComposite,
      });

      const readiness = buildDelegationRehearsalDecisionPacket({
        capabilityDecision: typeof p.capability_decision === "string"
          ? p.capability_decision as "ready" | "needs-evidence" | "blocked"
          : capability.decision,
        capabilityRecommendationCode: typeof p.capability_recommendation_code === "string"
          ? p.capability_recommendation_code
          : capability.recommendationCode,
        capabilityBlockers: Array.isArray(p.capability_blockers) ? p.capability_blockers as string[] : capability.blockers,
        mixDecision: typeof p.mix_decision === "string"
          ? p.mix_decision as "ready" | "needs-evidence"
          : mix.decision,
        mixScore: typeof p.mix_score === "number" ? p.mix_score : mix.score,
        mixDelegationEvents: typeof p.mix_delegation_events === "number"
          ? p.mix_delegation_events
          : mix.totals.delegate,
        autoAdvanceDecision: autoAdvanceComposite.decision,
        autoAdvanceBlockedReasons: autoAdvanceComposite.blockedReasons,
        telemetryDecision: effectiveTelemetry.decision,
        telemetryScore: effectiveTelemetry.score,
        telemetryBlockedRatePct: effectiveTelemetry.blockedRatePct,
      });

      const startPacket = buildDelegationRehearsalStartPacket({
        rehearsalDecision: readiness.decision,
        rehearsalRecommendationCode: readiness.recommendationCode,
        rehearsalBlockers: readiness.blockers,
        protectedScopeRequested: p.protected_scope_requested === true,
        declaredFilesKnown: p.declared_files_known === true,
        validationGateKnown: p.validation_gate_known === true,
        rollbackPlanKnown: p.rollback_plan_known === true,
      });

      const handoffFocusTaskId = typeof p.auto_advance_decision === "string"
        ? undefined
        : readAutonomyHandoffFocusTaskIds(cwd)[0];
      const operatorPauseBrief = buildDelegationRehearsalOperatorPauseBrief({
        cwd,
        startDecision: startPacket.decision,
        blockers: startPacket.blockers,
        focusTaskId: handoffFocusTaskId,
        nextTaskId: liveAutoAdvanceSnapshot.nextTaskId,
      });
      const enrichedSummary = [
        startPacket.summary,
        formatDelegationRehearsalOperatorPauseBriefSummary(operatorPauseBrief),
      ].join(" ");

      return {
        content: [{ type: "text", text: enrichedSummary }],
        details: {
          ...startPacket,
          summary: enrichedSummary,
          operatorPauseBrief,
          readiness,
          capability,
          inferredCapabilityDefaults,
          mix,
          autoAdvanceTelemetry,
          effectiveTelemetrySignals: effectiveTelemetry,
          autoAdvanceLiveSnapshot: liveAutoAdvanceSnapshot,
          autoAdvanceResolutionSource: autoAdvanceComposite.source,
          scan: collected.scan,
        },
      };
    },
  });

  pi.registerTool({
    name: "ops_calibration_decision_packet",
    label: "Ops Calibration Decision Packet",
    description: "Report-only decision packet that composes background-process readiness and agents-as-tools calibration before bounded rehearsal.",
    parameters: Type.Object({
      has_process_registry: Type.Optional(Type.Boolean({ description: "Whether process registry capability exists." })),
      has_port_lease_lock: Type.Optional(Type.Boolean({ description: "Whether port lease/lock capability exists." })),
      has_bounded_log_tail: Type.Optional(Type.Boolean({ description: "Whether bounded stdout/stderr tail capability exists." })),
      has_structured_stacktrace_capture: Type.Optional(Type.Boolean({ description: "Whether structured stacktrace capture exists." })),
      has_healthcheck_probe: Type.Optional(Type.Boolean({ description: "Whether bounded healthcheck probe exists." })),
      has_graceful_stop_then_kill: Type.Optional(Type.Boolean({ description: "Whether graceful-stop-then-kill contract exists." })),
      has_reload_handoff_cleanup: Type.Optional(Type.Boolean({ description: "Whether reload/compact/handoff cleanup exists." })),
      rehearsal_slices: Type.Optional(Type.Number({ description: "Completed bounded rehearsal slices (evidence count)." })),
      stop_source_coverage_pct: Type.Optional(Type.Number({ description: "Percent of lifecycle events with explicit stopSource evidence (0..100)." })),
      lifecycle_classified: Type.Optional(Type.Boolean({ description: "Whether lifecycle evidence is classified." })),
      rollback_plan_known: Type.Optional(Type.Boolean({ description: "Whether rollback plan is known." })),
      unresolved_blockers: Type.Optional(Type.Number({ description: "Count of unresolved blockers." })),
      destructive_restart_requested: Type.Optional(Type.Boolean({ description: "Whether destructive restart is being requested." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Whether protected scope was requested." })),
      min_score_for_rehearsal: Type.Optional(Type.Number({ description: "Minimum score threshold (60..95, default=80)." })),
      live_reload_completed: Type.Optional(Type.Boolean({ description: "Whether runtime reload was completed after wiring new tools." })),
      tool_names: Type.Optional(Type.Array(Type.String({ description: "Optional tool-name filter for agents-as-tools calibration scope." }))),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const allTools = pi.getAllTools().map(toolInfoToInput).filter((tool): tool is ToolHygieneInputTool => Boolean(tool));
      const selectedNames = Array.isArray(p.tool_names)
        ? new Set(p.tool_names.filter((name): name is string => typeof name === "string"))
        : undefined;
      const scopedTools = selectedNames ? allTools.filter((tool) => selectedNames.has(tool.name)) : allTools;

      const allToolNames = new Set(allTools.map((tool) => tool.name));
      const inferred = inferBackgroundCapabilitySignals(allToolNames);
      const background = buildBackgroundProcessReadinessScore({
        hasProcessRegistry: asOptionalBoolean(p.has_process_registry) ?? inferred.hasProcessRegistry,
        hasPortLeaseLock: asOptionalBoolean(p.has_port_lease_lock) ?? inferred.hasPortLeaseLock,
        hasBoundedLogTail: asOptionalBoolean(p.has_bounded_log_tail) ?? inferred.hasBoundedLogTail,
        hasStructuredStacktraceCapture: asOptionalBoolean(p.has_structured_stacktrace_capture) ?? inferred.hasStructuredStacktraceCapture,
        hasHealthcheckProbe: asOptionalBoolean(p.has_healthcheck_probe) ?? inferred.hasHealthcheckProbe,
        hasGracefulStopThenKill: asOptionalBoolean(p.has_graceful_stop_then_kill) ?? inferred.hasGracefulStopThenKill,
        hasReloadHandoffCleanup: asOptionalBoolean(p.has_reload_handoff_cleanup) ?? inferred.hasReloadHandoffCleanup,
        hasPlanSurface: allToolNames.has("background_process_plan"),
        hasLifecycleSurface: allToolNames.has("background_process_lifecycle_plan"),
        rehearsalSlices: typeof p.rehearsal_slices === "number" ? p.rehearsal_slices : undefined,
        stopSourceCoveragePct: typeof p.stop_source_coverage_pct === "number" ? p.stop_source_coverage_pct : undefined,
      });
      const backgroundRehearsal = evaluateBackgroundProcessRehearsal({
        readinessScore: background.score,
        readinessRecommendationCode: background.recommendationCode,
        lifecycleClassified: asOptionalBoolean(p.lifecycle_classified),
        stopSourceCoveragePct: typeof p.stop_source_coverage_pct === "number" ? p.stop_source_coverage_pct : undefined,
        rollbackPlanKnown: asOptionalBoolean(p.rollback_plan_known),
        rehearsalSlices: typeof p.rehearsal_slices === "number" ? p.rehearsal_slices : undefined,
        unresolvedBlockers: typeof p.unresolved_blockers === "number" ? p.unresolved_blockers : undefined,
        destructiveRestartRequested: asOptionalBoolean(p.destructive_restart_requested),
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
      });
      const agents = buildAgentsAsToolsCalibrationScore({ tools: scopedTools });
      const packet = buildOpsCalibrationDecisionPacket({
        background,
        backgroundRehearsal,
        agents,
        minScoreForRehearsal: typeof p.min_score_for_rehearsal === "number" ? p.min_score_for_rehearsal : undefined,
        liveReloadCompleted: p.live_reload_completed === true,
      });

      return buildOperatorVisibleToolResponse({
        label: "ops_calibration_decision_packet",
        summary: packet.summary,
        details: packet,
      });
    },
  });
}
