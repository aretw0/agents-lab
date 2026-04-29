import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { evaluateAutonomyLaneReadiness, type AutonomyContextLevel } from "./guardrails-core-autonomy-lane";

function normalizeContextLevel(value: unknown): AutonomyContextLevel {
  return value === "compact" || value === "checkpoint" || value === "warn" || value === "ok" ? value : "ok";
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const raw = Number(value);
  return Number.isFinite(raw) ? raw : fallback;
}

export function registerGuardrailsAutonomyLaneSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "autonomy_lane_plan",
    label: "Autonomy Lane Plan",
    description: "Deterministic autonomy-lane continue/stop plan from bounded runtime gate signals. No side effects.",
    parameters: Type.Object({
      context_level: Type.Optional(Type.String({ description: "ok | warn | checkpoint | compact" })),
      context_percent: Type.Optional(Type.Number()),
      machine_severity: Type.Optional(Type.String({ description: "ok | warn | pause | block" })),
      can_start_long_run: Type.Optional(Type.Boolean()),
      provider_ready: Type.Optional(Type.Number()),
      provider_blocked: Type.Optional(Type.Number()),
      provider_degraded: Type.Optional(Type.Number()),
      quota_block_alerts: Type.Optional(Type.Number()),
      quota_warn_alerts: Type.Optional(Type.Number()),
      board_ready: Type.Optional(Type.Boolean()),
      next_task_id: Type.Optional(Type.String()),
      monitor_classify_failures: Type.Optional(Type.Number()),
      monitor_sovereign_divergence: Type.Optional(Type.Number()),
      subagents_ready: Type.Optional(Type.Boolean()),
      unexpected_dirty: Type.Optional(Type.Boolean()),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = evaluateAutonomyLaneReadiness({
        context: {
          level: normalizeContextLevel(p.context_level),
          percent: asNumber(p.context_percent, 0),
        },
        machine: {
          severity: typeof p.machine_severity === "string" ? p.machine_severity : "ok",
          canStartLongRun: asBool(p.can_start_long_run, true),
          canEvaluateMonitors: true,
        },
        provider: {
          ready: asNumber(p.provider_ready, 1),
          blocked: asNumber(p.provider_blocked, 0),
          degraded: asNumber(p.provider_degraded, 0),
        },
        quota: {
          blockAlerts: asNumber(p.quota_block_alerts, 0),
          warnAlerts: asNumber(p.quota_warn_alerts, 0),
        },
        board: {
          ready: asBool(p.board_ready, true),
          nextTaskId: typeof p.next_task_id === "string" ? p.next_task_id : undefined,
        },
        monitors: {
          classifyFailures: asNumber(p.monitor_classify_failures, 0),
          sovereignDivergence: asNumber(p.monitor_sovereign_divergence, 0),
        },
        subagents: {
          ready: asBool(p.subagents_ready, true),
        },
        workspace: {
          unexpectedDirty: asBool(p.unexpected_dirty, false),
        },
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}
