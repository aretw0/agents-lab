import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { buildBackgroundProcessReadinessScore } from "./guardrails-core-background-process";
import { evaluateBackgroundProcessRehearsal } from "./guardrails-core-background-process-rehearsal";
import {
  buildDelegateOrExecuteDecisionPacket,
  buildOpsCalibrationDecisionPacket,
  buildSimpleDelegateRehearsalDecisionPacket,
  buildSimpleDelegateRehearsalStartPacket,
} from "./guardrails-core-ops-calibration";
import { buildAgentsAsToolsCalibrationScore, type ToolHygieneInputTool } from "./guardrails-core-tool-hygiene";
import { evaluateDelegationLaneCapabilitySnapshot } from "./guardrails-core-autonomy-lane";
import {
  collectSessionRecords,
  parseAutoAdvanceHardIntentTelemetry,
  parseDelegationMixScore,
} from "./session-analytics";

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

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

function toolInfoToInput(tool: unknown): ToolHygieneInputTool | undefined {
  if (!tool || typeof tool !== "object") return undefined;
  const t = tool as Record<string, unknown>;
  if (typeof t.name !== "string") return undefined;
  return {
    name: t.name,
    description: typeof t.description === "string" ? t.description : typeof t.label === "string" ? t.label : undefined,
    parameters: t.parameters,
  };
}

export function registerGuardrailsOpsCalibrationSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "delegate_or_execute_decision_packet",
    label: "Delegate or Execute Decision Packet",
    description: "Report-only packet recommending local-execute vs simple-delegate vs defer from delegation capability + mix signals. Never dispatches execution.",
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
      mix_simple_delegate_events: Type.Optional(Type.Number({ description: "Override simple-delegate event count." })),
      mix_swarm_events: Type.Optional(Type.Number({ description: "Override swarm event count." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const lookbackHoursRaw = Number(p.lookback_hours);
      const lookbackHours = Number.isFinite(lookbackHoursRaw) && lookbackHoursRaw > 0
        ? lookbackHoursRaw
        : 24;
      const cwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();

      const capability = evaluateDelegationLaneCapabilitySnapshot({
        preloadDecision: typeof p.preload_decision === "string" ? p.preload_decision : "fallback-canonical",
        dirtySignal: typeof p.dirty_signal === "string" ? p.dirty_signal : "unknown",
        monitorClassifyFailures: typeof p.monitor_classify_failures === "number" ? p.monitor_classify_failures : 0,
        subagentsReady: typeof p.subagents_ready === "boolean" ? p.subagents_ready : true,
      });

      const collected = collectSessionRecords(cwd, lookbackHours);
      const mix = parseDelegationMixScore(collected.allRecords, lookbackHours, collected.files.length);

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
        mixSimpleDelegateEvents: typeof p.mix_simple_delegate_events === "number"
          ? p.mix_simple_delegate_events
          : mix.totals.simpleDelegate,
        mixSwarmEvents: typeof p.mix_swarm_events === "number"
          ? p.mix_swarm_events
          : mix.totals.swarm,
      });

      return {
        content: [{ type: "text", text: packet.summary }],
        details: {
          ...packet,
          capability,
          mix,
          scan: collected.scan,
        },
      };
    },
  });

  pi.registerTool({
    name: "simple_delegate_rehearsal_packet",
    label: "Simple-Delegate Rehearsal Packet",
    description: "Report-only readiness packet for bounded simple-delegate rehearsal from capability + mix + auto-advance telemetry signals.",
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
      mix_simple_delegate_events: Type.Optional(Type.Number({ description: "Override simple-delegate event count." })),
      auto_advance_decision: Type.Optional(Type.String({ description: "Override auto-advance decision: eligible | blocked" })),
      auto_advance_blocked_reasons: Type.Optional(Type.Array(Type.String())),
      telemetry_decision: Type.Optional(Type.String({ description: "Override telemetry decision: ready | needs-evidence" })),
      telemetry_score: Type.Optional(Type.Number({ description: "Override telemetry score (0..100)." })),
      telemetry_blocked_rate_pct: Type.Optional(Type.Number({ description: "Override telemetry blocked rate pct (0..100)." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const lookbackHoursRaw = Number(p.lookback_hours);
      const lookbackHours = Number.isFinite(lookbackHoursRaw) && lookbackHoursRaw > 0
        ? lookbackHoursRaw
        : 24;
      const cwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();

      const capability = evaluateDelegationLaneCapabilitySnapshot({
        preloadDecision: typeof p.preload_decision === "string" ? p.preload_decision : "fallback-canonical",
        dirtySignal: typeof p.dirty_signal === "string" ? p.dirty_signal : "unknown",
        monitorClassifyFailures: typeof p.monitor_classify_failures === "number" ? p.monitor_classify_failures : 0,
        subagentsReady: typeof p.subagents_ready === "boolean" ? p.subagents_ready : true,
      });

      const collected = collectSessionRecords(cwd, lookbackHours);
      const mix = parseDelegationMixScore(collected.allRecords, lookbackHours, collected.files.length);
      const autoAdvanceTelemetry = parseAutoAdvanceHardIntentTelemetry(collected.allRecords, lookbackHours, collected.files.length);

      const telemetryBlockedReasons = autoAdvanceTelemetry.blockedReasons.map((row) => row.reason);
      const derivedAutoAdvanceDecision = autoAdvanceTelemetry.decision === "ready"
        && autoAdvanceTelemetry.totals.eligibleEvents > 0
        ? "eligible"
        : "blocked";

      const packet = buildSimpleDelegateRehearsalDecisionPacket({
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
        mixSimpleDelegateEvents: typeof p.mix_simple_delegate_events === "number"
          ? p.mix_simple_delegate_events
          : mix.totals.simpleDelegate,
        autoAdvanceDecision: typeof p.auto_advance_decision === "string"
          ? p.auto_advance_decision as "eligible" | "blocked"
          : derivedAutoAdvanceDecision,
        autoAdvanceBlockedReasons: Array.isArray(p.auto_advance_blocked_reasons)
          ? p.auto_advance_blocked_reasons as string[]
          : (telemetryBlockedReasons.length > 0 ? telemetryBlockedReasons : derivedAutoAdvanceDecision === "blocked" ? ["auto-advance-telemetry-not-ready"] : []),
        telemetryDecision: typeof p.telemetry_decision === "string"
          ? p.telemetry_decision as "ready" | "needs-evidence"
          : autoAdvanceTelemetry.decision,
        telemetryScore: typeof p.telemetry_score === "number" ? p.telemetry_score : autoAdvanceTelemetry.score,
        telemetryBlockedRatePct: typeof p.telemetry_blocked_rate_pct === "number"
          ? p.telemetry_blocked_rate_pct
          : autoAdvanceTelemetry.totals.blockedRatePct,
      });

      return {
        content: [{ type: "text", text: packet.summary }],
        details: {
          ...packet,
          capability,
          mix,
          autoAdvanceTelemetry,
          scan: collected.scan,
        },
      };
    },
  });

  pi.registerTool({
    name: "simple_delegate_rehearsal_start_packet",
    label: "Simple-Delegate Rehearsal Start Packet",
    description: "Report-only start/abort packet for one-task simple-delegate rehearsal. Never dispatches execution and always requires explicit human decision.",
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
      mix_simple_delegate_events: Type.Optional(Type.Number({ description: "Override simple-delegate event count." })),
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
      const lookbackHoursRaw = Number(p.lookback_hours);
      const lookbackHours = Number.isFinite(lookbackHoursRaw) && lookbackHoursRaw > 0
        ? lookbackHoursRaw
        : 24;
      const cwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();

      const capability = evaluateDelegationLaneCapabilitySnapshot({
        preloadDecision: typeof p.preload_decision === "string" ? p.preload_decision : "fallback-canonical",
        dirtySignal: typeof p.dirty_signal === "string" ? p.dirty_signal : "unknown",
        monitorClassifyFailures: typeof p.monitor_classify_failures === "number" ? p.monitor_classify_failures : 0,
        subagentsReady: typeof p.subagents_ready === "boolean" ? p.subagents_ready : true,
      });

      const collected = collectSessionRecords(cwd, lookbackHours);
      const mix = parseDelegationMixScore(collected.allRecords, lookbackHours, collected.files.length);
      const autoAdvanceTelemetry = parseAutoAdvanceHardIntentTelemetry(collected.allRecords, lookbackHours, collected.files.length);

      const telemetryBlockedReasons = autoAdvanceTelemetry.blockedReasons.map((row) => row.reason);
      const derivedAutoAdvanceDecision = autoAdvanceTelemetry.decision === "ready"
        && autoAdvanceTelemetry.totals.eligibleEvents > 0
        ? "eligible"
        : "blocked";

      const readiness = buildSimpleDelegateRehearsalDecisionPacket({
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
        mixSimpleDelegateEvents: typeof p.mix_simple_delegate_events === "number"
          ? p.mix_simple_delegate_events
          : mix.totals.simpleDelegate,
        autoAdvanceDecision: typeof p.auto_advance_decision === "string"
          ? p.auto_advance_decision as "eligible" | "blocked"
          : derivedAutoAdvanceDecision,
        autoAdvanceBlockedReasons: Array.isArray(p.auto_advance_blocked_reasons)
          ? p.auto_advance_blocked_reasons as string[]
          : (telemetryBlockedReasons.length > 0 ? telemetryBlockedReasons : derivedAutoAdvanceDecision === "blocked" ? ["auto-advance-telemetry-not-ready"] : []),
        telemetryDecision: typeof p.telemetry_decision === "string"
          ? p.telemetry_decision as "ready" | "needs-evidence"
          : autoAdvanceTelemetry.decision,
        telemetryScore: typeof p.telemetry_score === "number" ? p.telemetry_score : autoAdvanceTelemetry.score,
        telemetryBlockedRatePct: typeof p.telemetry_blocked_rate_pct === "number"
          ? p.telemetry_blocked_rate_pct
          : autoAdvanceTelemetry.totals.blockedRatePct,
      });

      const startPacket = buildSimpleDelegateRehearsalStartPacket({
        rehearsalDecision: readiness.decision,
        rehearsalRecommendationCode: readiness.recommendationCode,
        rehearsalBlockers: readiness.blockers,
        protectedScopeRequested: p.protected_scope_requested === true,
        declaredFilesKnown: p.declared_files_known === true,
        validationGateKnown: p.validation_gate_known === true,
        rollbackPlanKnown: p.rollback_plan_known === true,
      });

      return {
        content: [{ type: "text", text: startPacket.summary }],
        details: {
          ...startPacket,
          readiness,
          capability,
          mix,
          autoAdvanceTelemetry,
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

      return {
        content: [{ type: "text", text: JSON.stringify(packet, null, 2) }],
        details: packet,
      };
    },
  });
}
