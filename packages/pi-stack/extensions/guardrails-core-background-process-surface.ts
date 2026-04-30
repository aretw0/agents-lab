import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { resolveBackgroundProcessControlPlan, type BackgroundProcessKind, type BackgroundProcessMode } from "./guardrails-core-background-process";

function normalizeKind(value: unknown): BackgroundProcessKind | undefined {
  return value === "frontend" || value === "backend" || value === "test-server" || value === "worker" || value === "generic" ? value : undefined;
}

function normalizeMode(value: unknown): BackgroundProcessMode | undefined {
  return value === "auto" || value === "shared-service" || value === "isolated-worker" ? value : undefined;
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
}
