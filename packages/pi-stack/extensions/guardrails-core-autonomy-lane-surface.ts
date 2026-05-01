import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { evaluateAutonomyLaneReadiness, type AutonomyContextLevel } from "./guardrails-core-autonomy-lane";
import { evaluateAutonomyLaneTaskSelection, readAutonomyHandoffFocusTaskIds } from "./guardrails-core-autonomy-task-selector";
import { buildLaneBrainstormPacket } from "./lane-brainstorm-packet";
import { evaluateProjectIntakePlan } from "./project-intake-primitive";

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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function resolveFocusTaskIds(p: Record<string, unknown>, cwd: string): { ids: string[]; source?: "explicit" | "handoff" } {
  const explicit = asStringArray(p.focus_task_ids);
  if (explicit.length > 0) return { ids: explicit, source: "explicit" };
  if (p.use_handoff_focus === false) return { ids: [] };
  const handoff = readAutonomyHandoffFocusTaskIds(cwd);
  return handoff.length > 0 ? { ids: handoff, source: "handoff" } : { ids: [] };
}

function resolveTaskSelection(p: Record<string, unknown>, cwd: string) {
  const focus = resolveFocusTaskIds(p, cwd);
  return evaluateAutonomyLaneTaskSelection(cwd, {
    milestone: typeof p.milestone === "string" ? p.milestone : undefined,
    includeProtectedScopes: p.include_protected_scopes === true,
    includeMissingRationale: p.include_missing_rationale === true,
    sampleLimit: asNumber(p.sample_limit, 5),
    focusTaskIds: focus.ids,
    focusSource: focus.source,
  });
}

function buildReadinessInput(
  p: Record<string, unknown>,
  board: { ready: boolean; nextTaskId?: string },
) {
  return {
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
    board,
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
  };
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
      const result = evaluateAutonomyLaneReadiness(buildReadinessInput(p, {
        ready: asBool(p.board_ready, true),
        nextTaskId: typeof p.next_task_id === "string" ? p.next_task_id : undefined,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "autonomy_lane_status",
    label: "Autonomy Lane Status",
    description: "Compose supplied runtime gates with conservative board task selection. Read-only and side-effect-free.",
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
      monitor_classify_failures: Type.Optional(Type.Number()),
      monitor_sovereign_divergence: Type.Optional(Type.Number()),
      subagents_ready: Type.Optional(Type.Boolean()),
      unexpected_dirty: Type.Optional(Type.Boolean()),
      milestone: Type.Optional(Type.String({ description: "Optional milestone filter." })),
      include_protected_scopes: Type.Optional(Type.Boolean({ description: "Opt in to CI/settings/publish/.obsidian scopes. Default false." })),
      include_missing_rationale: Type.Optional(Type.Boolean({ description: "Opt in to rationale-sensitive tasks that still lack rationale evidence. Default false." })),
      focus_task_ids: Type.Optional(Type.Array(Type.String(), { description: "Optional focus task ids; when omitted, fresh handoff current_tasks are used by default." })),
      use_handoff_focus: Type.Optional(Type.Boolean({ description: "Use .project/handoff.json current_tasks as focus when focus_task_ids is omitted. Default true." })),
      sample_limit: Type.Optional(Type.Number({ description: "Max eligible ids to return (1..20)." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const selection = resolveTaskSelection(p, ctx.cwd);
      const plan = evaluateAutonomyLaneReadiness(buildReadinessInput(p, {
        // Board surface is readable here; selection.ready=false means lane policy stop, not board failure.
        ready: true,
        nextTaskId: selection.nextTaskId,
      }));
      const result = {
        ready: plan.ready && selection.ready,
        plan,
        selection,
        recommendationCode: selection.recommendationCode,
        nextAction: selection.ready ? plan.nextAction : selection.recommendation,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "autonomy_lane_next_task",
    label: "Autonomy Lane Next Task",
    description: "Select the next conservative autonomy-lane board task. Read-only and side-effect-free.",
    parameters: Type.Object({
      milestone: Type.Optional(Type.String({ description: "Optional milestone filter." })),
      include_protected_scopes: Type.Optional(Type.Boolean({ description: "Opt in to CI/settings/publish/.obsidian scopes. Default false." })),
      include_missing_rationale: Type.Optional(Type.Boolean({ description: "Opt in to rationale-sensitive tasks that still lack rationale evidence. Default false." })),
      focus_task_ids: Type.Optional(Type.Array(Type.String(), { description: "Optional focus task ids; when omitted, fresh handoff current_tasks are used by default." })),
      use_handoff_focus: Type.Optional(Type.Boolean({ description: "Use .project/handoff.json current_tasks as focus when focus_task_ids is omitted. Default true." })),
      sample_limit: Type.Optional(Type.Number({ description: "Max eligible ids to return (1..20)." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = resolveTaskSelection(p, ctx.cwd);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "lane_brainstorm_packet",
    label: "Lane Brainstorm Packet",
    description: "Report-only lane brainstorm packet with ranked ideas and stable recommendationCode/nextAction.",
    parameters: Type.Object({
      goal: Type.Optional(Type.String({ description: "Short lane objective." })),
      ideas: Type.Optional(Type.Array(Type.Object({
        id: Type.String(),
        theme: Type.String(),
        value: Type.Optional(Type.String()),
        risk: Type.Optional(Type.String()),
        effort: Type.Optional(Type.String()),
      }))),
      max_ideas: Type.Optional(Type.Number({ description: "Max ranked ideas (1..50)." })),
      max_slices: Type.Optional(Type.Number({ description: "Max suggested slices (1..10)." })),
      milestone: Type.Optional(Type.String({ description: "Optional milestone filter." })),
      include_protected_scopes: Type.Optional(Type.Boolean({ description: "Opt in protected scopes." })),
      include_missing_rationale: Type.Optional(Type.Boolean({ description: "Opt in missing rationale tasks." })),
      focus_task_ids: Type.Optional(Type.Array(Type.String())),
      use_handoff_focus: Type.Optional(Type.Boolean()),
      sample_limit: Type.Optional(Type.Number()),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const selection = resolveTaskSelection(p, ctx.cwd);
      const packet = buildLaneBrainstormPacket({
        goal: p.goal,
        ideas: p.ideas,
        maxIdeas: p.max_ideas,
        maxSlices: p.max_slices,
        selection,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(packet, null, 2) }],
        details: packet,
      };
    },
  });

  pi.registerTool({
    name: "project_intake_plan",
    label: "Project Intake Plan",
    description: "Report-only universal project intake plan with deterministic profile/recommendation and no dispatch authorization.",
    parameters: Type.Object({
      dominant_artifacts: Type.Optional(Type.Array(Type.String({ description: "Dominant project artifacts/languages." }))),
      has_build_files: Type.Optional(Type.Boolean()),
      has_tests: Type.Optional(Type.Boolean()),
      has_ci: Type.Optional(Type.Boolean()),
      repository_scale: Type.Optional(Type.String({ description: "small | medium | large" })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "When true, plan blocks and asks explicit human focus." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const plan = evaluateProjectIntakePlan({
        dominantArtifacts: p.dominant_artifacts as string[] | undefined,
        hasBuildFiles: p.has_build_files === true,
        hasTests: p.has_tests === true,
        hasCi: p.has_ci === true,
        repositoryScale: typeof p.repository_scale === "string" ? p.repository_scale : undefined,
        protectedScopeRequested: p.protected_scope_requested === true,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(plan, null, 2) }],
        details: plan,
      };
    },
  });
}
