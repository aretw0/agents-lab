import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { buildBackgroundProcessReadinessScore, resolveBackgroundProcessControlPlan, resolveBackgroundProcessLifecycleEvent, type BackgroundProcessKind, type BackgroundProcessLifecycleEventKind, type BackgroundProcessMode, type BackgroundProcessStopSource } from "./guardrails-core-background-process";
import { evaluateBackgroundProcessRehearsal } from "./guardrails-core-background-process-rehearsal";

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

function normalizeKind(value: unknown): BackgroundProcessKind | undefined {
  return value === "frontend" || value === "backend" || value === "test-server" || value === "worker" || value === "generic" ? value : undefined;
}

function normalizeMode(value: unknown): BackgroundProcessMode | undefined {
  return value === "auto" || value === "shared-service" || value === "isolated-worker" ? value : undefined;
}

function normalizeEventKind(value: unknown): BackgroundProcessLifecycleEventKind | undefined {
  return value === "registered" || value === "stop-requested" || value === "done" || value === "killed" ? value : undefined;
}

function normalizeStopSource(value: unknown): BackgroundProcessStopSource | undefined {
  return value === "human" || value === "agent" || value === "timeout" || value === "unknown" ? value : undefined;
}

export function registerGuardrailsBackgroundProcessSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "background_process_plan",
    label: "Background Process Control Plan",
    description: "Read-only local-first plan for future background server/process control. Never launches, stops, restarts, dispatches, or reserves ports.",
    parameters: Type.Object({
      kind: Type.Optional(Type.String({ description: "frontend | backend | test-server | worker | generic" })),
      requested_mode: Type.Optional(Type.String({ description: "auto | shared-service | isolated-worker" })),
      needs_server: Type.Optional(Type.Boolean({ description: "Whether the work needs a long-lived server/process. Default true." })),
      requested_port: Type.Optional(Type.Number({ description: "Desired port. Evidence only; the tool does not reserve it." })),
      parallel_agents: Type.Optional(Type.Number({ description: "Expected agents needing server/process resources on this machine. Default 1." })),
      existing_service_reusable: Type.Optional(Type.Boolean({ description: "Whether an existing workspace service can be reused. Default false." })),
      destructive_restart: Type.Optional(Type.Boolean({ description: "Whether the plan would restart/kill an existing process. Blocks by default." })),
      log_tail_max_lines: Type.Optional(Type.Number({ description: "Bounded log tail size. Clamped 20..1000; default 200." })),
      stacktrace_capture: Type.Optional(Type.Boolean({ description: "Whether structured stacktrace capture is desired. Default true." })),
      healthcheck_known: Type.Optional(Type.Boolean({ description: "Whether a bounded healthcheck is known. Default false." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = resolveBackgroundProcessControlPlan({
        kind: normalizeKind(p.kind),
        requestedMode: normalizeMode(p.requested_mode),
        needsServer: typeof p.needs_server === "boolean" ? p.needs_server : undefined,
        requestedPort: typeof p.requested_port === "number" ? p.requested_port : undefined,
        parallelAgents: typeof p.parallel_agents === "number" ? p.parallel_agents : undefined,
        existingServiceReusable: typeof p.existing_service_reusable === "boolean" ? p.existing_service_reusable : undefined,
        destructiveRestart: typeof p.destructive_restart === "boolean" ? p.destructive_restart : undefined,
        logTailMaxLines: typeof p.log_tail_max_lines === "number" ? p.log_tail_max_lines : undefined,
        stacktraceCapture: typeof p.stacktrace_capture === "boolean" ? p.stacktrace_capture : undefined,
        healthcheckKnown: typeof p.healthcheck_known === "boolean" ? p.healthcheck_known : undefined,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "background_process_readiness_score",
    label: "Background Process Readiness Score",
    description: "Report-only readiness score for background-process operational maturity (capabilities/surface/evidence). Never launches or stops processes.",
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
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const allToolNames = new Set(
        pi.getAllTools()
          .map((tool) => tool?.name)
          .filter((name): name is string => typeof name === "string"),
      );
      const inferred = inferBackgroundCapabilitySignals(allToolNames);
      const result = buildBackgroundProcessReadinessScore({
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
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "background_process_rehearsal_gate",
    label: "Background Process Rehearsal Gate",
    description: "Report-only rehearsal gate for background-process readiness evidence (lifecycle/stopSource/rollback/slices). Never starts or stops processes.",
    parameters: Type.Object({
      readiness_score: Type.Optional(Type.Number({ description: "Background readiness score (0..100)." })),
      readiness_recommendation_code: Type.Optional(Type.String({ description: "Background readiness recommendation code." })),
      lifecycle_classified: Type.Optional(Type.Boolean({ description: "Whether lifecycle evidence is classified." })),
      stop_source_coverage_pct: Type.Optional(Type.Number({ description: "stopSource coverage percent (0..100)." })),
      rollback_plan_known: Type.Optional(Type.Boolean({ description: "Whether rollback plan is known." })),
      rehearsal_slices: Type.Optional(Type.Number({ description: "Count of rehearsal slices with evidence." })),
      unresolved_blockers: Type.Optional(Type.Number({ description: "Count of unresolved blockers." })),
      destructive_restart_requested: Type.Optional(Type.Boolean({ description: "Whether destructive restart is being requested." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Whether protected scope was requested." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = evaluateBackgroundProcessRehearsal({
        readinessScore: typeof p.readiness_score === "number" ? p.readiness_score : undefined,
        readinessRecommendationCode: typeof p.readiness_recommendation_code === "string" ? p.readiness_recommendation_code : undefined,
        lifecycleClassified: asOptionalBoolean(p.lifecycle_classified),
        stopSourceCoveragePct: typeof p.stop_source_coverage_pct === "number" ? p.stop_source_coverage_pct : undefined,
        rollbackPlanKnown: asOptionalBoolean(p.rollback_plan_known),
        rehearsalSlices: typeof p.rehearsal_slices === "number" ? p.rehearsal_slices : undefined,
        unresolvedBlockers: typeof p.unresolved_blockers === "number" ? p.unresolved_blockers : undefined,
        destructiveRestartRequested: asOptionalBoolean(p.destructive_restart_requested),
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "background_process_lifecycle_plan",
    label: "Background Process Lifecycle Plan",
    description: "Read-only classifier for background process lifecycle events. Never starts, stops, kills, dispatches, or mutates processes.",
    parameters: Type.Object({
      event_kind: Type.Optional(Type.String({ description: "registered | stop-requested | done | killed" })),
      pid: Type.Optional(Type.Number({ description: "Process id, if known." })),
      exit_code: Type.Optional(Type.Number({ description: "Exit code for done events, if known." })),
      known_process: Type.Optional(Type.Boolean({ description: "Whether the event belongs to a known first-party process registry entry." })),
      stop_requested: Type.Optional(Type.Boolean({ description: "Whether a stop was requested before this event." })),
      stop_source: Type.Optional(Type.String({ description: "Stop/cancel source: human | agent | timeout | unknown." })),
      label: Type.Optional(Type.String({ description: "Lifecycle event display label; undefined/null/empty labels fall back to background-process." })),
      view_title: Type.Optional(Type.String({ description: "Background-process view/header title; undefined/null/empty titles fall back to background-process." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = resolveBackgroundProcessLifecycleEvent({
        eventKind: normalizeEventKind(p.event_kind),
        pid: typeof p.pid === "number" ? p.pid : undefined,
        exitCode: typeof p.exit_code === "number" ? p.exit_code : undefined,
        knownProcess: typeof p.known_process === "boolean" ? p.known_process : undefined,
        stopRequested: typeof p.stop_requested === "boolean" ? p.stop_requested : undefined,
        stopSource: normalizeStopSource(p.stop_source),
        label: typeof p.label === "string" ? p.label : undefined,
        viewTitle: typeof p.view_title === "string" ? p.view_title : undefined,
      });
      return {
        content: [{ type: "text", text: result.evidence }],
        details: result,
      };
    },
  });
}
