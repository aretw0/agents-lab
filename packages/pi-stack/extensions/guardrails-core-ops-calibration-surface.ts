import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { buildBackgroundProcessReadinessScore } from "./guardrails-core-background-process";
import { buildOpsCalibrationDecisionPacket } from "./guardrails-core-ops-calibration";
import { buildAgentsAsToolsCalibrationScore, type ToolHygieneInputTool } from "./guardrails-core-tool-hygiene";

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
    hasStructuredStacktraceCapture: hasAnyContaining("stacktrace"),
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
      const agents = buildAgentsAsToolsCalibrationScore({ tools: scopedTools });
      const packet = buildOpsCalibrationDecisionPacket({
        background,
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
