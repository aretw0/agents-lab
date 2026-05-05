import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";
import {
  evaluateAutonomyLaneReadiness,
  evaluateDelegationLaneCapabilitySnapshot,
} from "./guardrails-core-autonomy-lane";
import {
  evaluateAutonomyProtectedFocusDecisionPacket,
  evaluateAutonomyProtectedScopeReasonReport,
} from "./guardrails-core-autonomy-task-selector";
import { readProjectTasksBlock } from "./colony-pilot-task-sync";
import { buildLaneBrainstormPacket, buildLaneBrainstormSeedPreview } from "./lane-brainstorm-packet";
import { evaluateProjectIntakePlan } from "./project-intake-primitive";
import {
  buildRunwayReadinessCue,
  readDelegationFreshnessSignals,
} from "./guardrails-core-autonomy-lane-runway";
import { buildAutonomyAntiBloatCue } from "./guardrails-core-autonomy-lane-anti-bloat";
import {
  buildAutonomyLaneSeededNextAction,
  buildAutonomyLaneStatusSummary,
  buildDelegationLaneCapabilitySummary,
} from "./guardrails-core-autonomy-lane-formatting";
import {
  buildAutonomyMaterialParameters,
  buildAutonomyTaskSelectionParameters,
  buildLaneBrainstormParameters,
} from "./guardrails-core-autonomy-lane-tool-schemas";

import {
  asBool,
  asNumber,
  buildAfkMaterialReadinessPacket,
  buildAfkMaterialSeedPacket,
  buildAutoAdvanceHardIntentSnapshot,
  buildAutonomyLaneBatchPreviewPacket,
  buildAutonomyOperatorPauseBrief,
  buildInfluenceAssimilationWindowPacket,
  buildIterationReminder,
  buildReadinessInput,
  buildReadyQueuePreview,
  findTaskById,
  normalizeContextLevel,
  normalizeTaskId,
  readHandoffFreshnessSignal,
  resolveLocalSafeChainingDecision,
  resolveTaskSelection,
  taskHasProtectedSignal,
  toTaskMnemonic,
} from "./guardrails-core-autonomy-lane-surface-helpers";
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
      return buildOperatorVisibleToolResponse({
        label: "autonomy_lane_plan",
        summary: `autonomy-lane-plan: ready=${result.ready ? "yes" : "no"} decision=${result.decision} code=${result.recommendationCode} allowed=${result.allowedWork}`,
        details: result,
      });
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
      delegation_preload_decision: Type.Optional(Type.String({ description: "Override delegation preload decision for runway cue (use-pack | fallback-canonical)." })),
      delegation_dirty_signal: Type.Optional(Type.String({ description: "Override delegation dirty signal for runway cue (clean | dirty | unknown)." })),
      delegation_capability_decision: Type.Optional(Type.String({ description: "Override delegation capability decision (ready | needs-evidence | blocked)." })),
      delegation_capability_recommendation_code: Type.Optional(Type.String({ description: "Override delegation capability recommendation code." })),
      delegation_capability_blockers: Type.Optional(Type.Array(Type.String())),
      delegation_capability_evidence_gaps: Type.Optional(Type.Array(Type.String())),
      delegation_mix_decision: Type.Optional(Type.String({ description: "Override delegation mix decision (ready | needs-evidence)." })),
      delegation_mix_score: Type.Optional(Type.Number({ description: "Override delegation mix score (0..100)." })),
      delegation_mix_recommendation_code: Type.Optional(Type.String({ description: "Override delegation mix recommendation code." })),
      delegation_mix_simple_delegate_events: Type.Optional(Type.Number({ description: "Override simple-delegate event count." })),
      delegation_mix_swarm_events: Type.Optional(Type.Number({ description: "Override swarm event count." })),
      delegation_auto_advance_decision: Type.Optional(Type.String({ description: "Override auto-advance decision (eligible | blocked)." })),
      delegation_auto_advance_blocked_reasons: Type.Optional(Type.Array(Type.String())),
      delegation_telemetry_decision: Type.Optional(Type.String({ description: "Override telemetry decision (ready | needs-evidence)." })),
      delegation_telemetry_score: Type.Optional(Type.Number({ description: "Override telemetry score (0..100)." })),
      delegation_telemetry_blocked_rate_pct: Type.Optional(Type.Number({ description: "Override telemetry blocked rate pct (0..100)." })),
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
      const selection = resolveTaskSelection(p, ctx.cwd);
      const includeProtectedScopes = p.include_protected_scopes === true;
      const tasks = readProjectTasksBlock(ctx.cwd).tasks;
      const nextTask = selection.nextTaskId ? findTaskById(tasks, selection.nextTaskId) : undefined;
      const nextTaskMnemonic = toTaskMnemonic(nextTask);
      const handoffFreshness = readHandoffFreshnessSignal(ctx.cwd);
      const plan = evaluateAutonomyLaneReadiness(buildReadinessInput(p, {
        // Board surface is readable here; selection.ready=false means lane policy stop, not board failure.
        ready: true,
        nextTaskId: selection.nextTaskId,
      }));
      const chaining = resolveLocalSafeChainingDecision({
        contextLevel: normalizeContextLevel(p.context_level),
        planReady: plan.ready,
        selectionReady: selection.ready,
        selectionReason: selection.reason,
        nextTaskId: selection.nextTaskId,
        handoffFreshness: handoffFreshness.label,
      });
      const readyQueue = buildReadyQueuePreview(selection, p.sample_limit);
      const seedingGuidance = !selection.ready && selection.reason === "no-eligible-tasks" && includeProtectedScopes !== true
        ? (() => {
          const packet = buildAfkMaterialSeedPacket({
            ...p,
            include_protected_scopes: false,
            include_missing_rationale: false,
          }, ctx.cwd);
          return {
            decision: packet.decision,
            recommendationCode: packet.recommendationCode,
            suggestedSeedCount: packet.suggestedSeedCount,
            seedWhy: packet.reseedJustification.reasonCode,
            seedPriority: packet.reseedPriority.code,
            humanActionRequired: packet.humanActionRequired,
            summary: packet.summary,
          };
        })()
        : undefined;
      const influenceWindowPacket = buildInfluenceAssimilationWindowPacket({
        ...p,
        include_protected_scopes: false,
        include_missing_rationale: false,
      }, ctx.cwd);
      const influenceWindowCue = {
        decision: influenceWindowPacket.decision,
        window: influenceWindowPacket.window,
        recommendationCode: influenceWindowPacket.recommendationCode,
      };
      const protectedFocusTaskIds = tasks
        .map((task) => ({ task, id: normalizeTaskId(task.id), status: String(task.status ?? "").toLowerCase() }))
        .filter(({ task, id, status }) => Boolean(id) && taskHasProtectedSignal(task) && (status === "planned" || status === "in-progress"))
        .map(({ id }) => id);
      const protectedSelection = protectedFocusTaskIds.length > 0
        ? resolveTaskSelection({
          ...p,
          include_protected_scopes: true,
          focus_task_ids: protectedFocusTaskIds,
          use_handoff_focus: false,
        }, ctx.cwd)
        : undefined;
      const protectedReadyCue = {
        decision: influenceWindowCue.decision === "ready-window" && protectedSelection?.ready ? "ready" : "hold",
        recommendationCode: influenceWindowCue.decision === "ready-window" && protectedSelection?.ready
          ? "protected-ready-explicit-focus-required"
          : "protected-ready-hold-local-safe-first",
        eligibleProtectedCount: protectedSelection?.eligibleTaskIds.length ?? 0,
        nextProtectedTaskId: protectedSelection?.nextTaskId,
      };
      const decisionCue = !selection.ready && seedingGuidance?.decision === "seed-now"
        ? {
          humanDecisionNeeded: true,
          reasonCode: "seed-local-safe-required",
          recommendedAction: "seed-local-safe",
          nextCandidateTaskId: undefined as string | undefined,
        }
        : influenceWindowCue.decision === "ready-window" && protectedReadyCue.decision === "ready"
          ? {
            humanDecisionNeeded: true,
            reasonCode: "protected-focus-ready",
            recommendedAction: "open-protected-focus",
            nextCandidateTaskId: protectedReadyCue.nextProtectedTaskId,
          }
          : {
            humanDecisionNeeded: false,
            reasonCode: "none",
            recommendedAction: selection.ready ? "continue-local-safe" : "stabilize-local-safe",
            nextCandidateTaskId: selection.nextTaskId,
          };
      const runwayReadinessCue = buildRunwayReadinessCue(p, ctx, pi);
      const antiBloatCue = buildAutonomyAntiBloatCue(ctx.cwd);
      const operatorPauseBrief = buildAutonomyOperatorPauseBrief({
        selectionReady: selection.ready,
        selectionReason: selection.reason,
        selectionRecommendation: selection.recommendation,
        includeProtectedScopes,
        handoffFreshness: handoffFreshness.label,
        seedingGuidance,
        nextTaskId: selection.nextTaskId,
        nextTaskMnemonic,
      });
      const iterationReminder = buildIterationReminder(ctx.cwd, handoffFreshness.label, seedingGuidance);
      const statusSummary = buildAutonomyLaneStatusSummary({
        ready: plan.ready && selection.ready,
        recommendationCode: selection.recommendationCode,
        nextTaskId: selection.nextTaskId,
        readyQueuePreviewCount: readyQueue.previewCount,
        suggestedSeedCount: seedingGuidance?.suggestedSeedCount,
        seedWhy: seedingGuidance?.seedWhy,
        seedPriority: seedingGuidance?.seedPriority,
        influenceWindowDecision: influenceWindowCue?.decision,
        protectedReadyDecision: protectedReadyCue.decision,
        protectedEligibleCount: protectedReadyCue.eligibleProtectedCount,
        decisionCueReasonCode: decisionCue.reasonCode,
        runwayDecision: runwayReadinessCue.decision,
        delegationDecision: runwayReadinessCue.delegation.decision,
        backgroundDecision: runwayReadinessCue.background.decision,
        antiBloatDecision: antiBloatCue.decision,
        lineBudgetAboveExtract: antiBloatCue.totals.aboveExtract,
      });
      const seededNextAction = buildAutonomyLaneSeededNextAction({
        selectionReady: selection.ready,
        seedingDecision: seedingGuidance?.decision,
        suggestedSeedCount: seedingGuidance?.suggestedSeedCount,
        seedWhy: seedingGuidance?.seedWhy,
        seedPriority: seedingGuidance?.seedPriority,
      });
      const result = {
        ready: plan.ready && selection.ready,
        summary: statusSummary,
        plan,
        selection,
        readyQueue,
        chaining: {
          ...chaining,
          handoffAgeMs: handoffFreshness.ageMs,
          handoffFreshMaxAgeMs: handoffFreshness.maxAgeMs,
        },
        recommendationCode: selection.recommendationCode,
        nextTaskMnemonic,
        operatorPauseBrief,
        iterationReminder,
        seedingGuidance,
        influenceWindowCue,
        protectedReadyCue,
        decisionCue,
        runwayReadinessCue,
        antiBloatCue,
        nextAction: chaining.active
          ? chaining.nextAction
          : (selection.ready ? plan.nextAction : (seededNextAction ?? selection.recommendation)),
      };
      return buildOperatorVisibleToolResponse({
        label: "autonomy_lane_status",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "delegation_lane_capability_snapshot",
    label: "Delegation Lane Capability Snapshot",
    description: "Read-only delegation capability snapshot composed from freshness + monitor/subagent readiness signals. No dispatch authorization.",
    parameters: Type.Object({
      preload_decision: Type.Optional(Type.String({ description: "use-pack | fallback-canonical" })),
      dirty_signal: Type.Optional(Type.String({ description: "clean | dirty | unknown" })),
      monitor_classify_failures: Type.Optional(Type.Number({ description: "Classify-failure count (default 0)." })),
      subagents_ready: Type.Optional(Type.Boolean({ description: "Subagent readiness signal (default true)." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const freshness = readDelegationFreshnessSignals(ctx.cwd);
      const snapshot = evaluateDelegationLaneCapabilitySnapshot({
        preloadDecision: typeof p.preload_decision === "string" ? p.preload_decision : freshness.preloadDecision,
        dirtySignal: typeof p.dirty_signal === "string" ? p.dirty_signal : freshness.dirtySignal,
        monitorClassifyFailures: asNumber(p.monitor_classify_failures, 0),
        subagentsReady: asBool(p.subagents_ready, true),
      });
      const result = {
        ...snapshot,
        effect: "none",
        mode: "report-only",
        authorization: "none",
        dispatchAllowed: false,
        mutationAllowed: false,
      };
      const summary = buildDelegationLaneCapabilitySummary({
        decision: snapshot.decision,
        preloadDecision: snapshot.signals.preloadDecision,
        dirtySignal: snapshot.signals.dirtySignal,
        monitorClassifyFailures: snapshot.signals.monitorClassifyFailures,
        subagentsReady: snapshot.signals.subagentsReady,
        recommendationCode: snapshot.recommendationCode,
      });
      return {
        content: [{ type: "text", text: summary }],
        details: {
          summary,
          ...result,
        },
      };
    },
  });

  pi.registerTool({
    name: "autonomy_lane_next_task",
    label: "Autonomy Lane Next Task",
    description: "Select the next conservative autonomy-lane board task. Read-only and side-effect-free.",
    parameters: buildAutonomyTaskSelectionParameters(),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const selection = resolveTaskSelection(p, ctx.cwd);
      const plan = evaluateAutonomyLaneReadiness(buildReadinessInput(p, {
        ready: true,
        nextTaskId: selection.nextTaskId,
      }));
      const handoffFreshness = readHandoffFreshnessSignal(ctx.cwd);
      const chaining = resolveLocalSafeChainingDecision({
        contextLevel: normalizeContextLevel(p.context_level),
        planReady: plan.ready,
        selectionReady: selection.ready,
        selectionReason: selection.reason,
        nextTaskId: selection.nextTaskId,
        handoffFreshness: handoffFreshness.label,
      });
      const result = {
        ...selection,
        readyQueue: buildReadyQueuePreview(selection, p.sample_limit),
        chaining: {
          ...chaining,
          handoffAgeMs: handoffFreshness.ageMs,
          handoffFreshMaxAgeMs: handoffFreshness.maxAgeMs,
        },
      };
      return buildOperatorVisibleToolResponse({
        label: "autonomy_lane_next_task",
        summary: `autonomy-lane-next-task: ready=${result.ready ? "yes" : "no"} reason=${result.reason} next=${result.nextTaskId ?? "none"} code=${result.recommendationCode} chaining=${result.chaining.decision}`,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "autonomy_lane_batch_preview",
    label: "Autonomy Lane Batch Preview",
    description: "Report-only batch preview listing 3-7 local-safe slices with short validation/rollback cues for continuous execution.",
    parameters: buildAutonomyTaskSelectionParameters({
      sampleLimitDescription: "Max eligible ids to inspect before preview (1..20).",
      extra: {
        slice_count: Type.Optional(Type.Number({ description: "Requested preview size (3..7, default 5)." })),
      },
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const packet = buildAutonomyLaneBatchPreviewPacket({
        ...p,
        include_protected_scopes: p.include_protected_scopes === true,
        include_missing_rationale: p.include_missing_rationale === true,
      }, ctx.cwd);
      return {
        content: [{ type: "text", text: packet.summary }],
        details: packet,
      };
    },
  });

  pi.registerTool({
    name: "autonomy_lane_material_readiness_packet",
    label: "Autonomy Lane Material Readiness Packet",
    description: "Report-only AFK lane material readiness packet (continue|seed-backlog|blocked) with no dispatch authorization.",
    parameters: buildAutonomyMaterialParameters(),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const packet = buildAfkMaterialReadinessPacket(p, ctx.cwd);
      return {
        content: [{ type: "text", text: packet.summary }],
        details: packet,
      };
    },
  });

  pi.registerTool({
    name: "autonomy_lane_material_seed_packet",
    label: "Autonomy Lane Material Seed Packet",
    description: "Report-only AFK seeding recommendation packet (seed-now|wait|blocked) with no dispatch authorization.",
    parameters: buildAutonomyMaterialParameters({ maxSeedSlices: true }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const packet = buildAfkMaterialSeedPacket(p, ctx.cwd);
      return {
        content: [{ type: "text", text: packet.summary }],
        details: packet,
      };
    },
  });

  pi.registerTool({
    name: "autonomy_lane_influence_assimilation_packet",
    label: "Autonomy Lane Influence Assimilation Packet",
    description: "Report-only packet recommending when to assimilate external influences (ready-window|defer|blocked) without dispatch authorization.",
    parameters: buildAutonomyMaterialParameters({
      includeProtectedScopes: false,
      influenceMaturity: true,
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const packet = buildInfluenceAssimilationWindowPacket(p, ctx.cwd);
      return {
        content: [{ type: "text", text: packet.summary }],
        details: packet,
      };
    },
  });

  pi.registerTool({
    name: "autonomy_lane_auto_advance_snapshot",
    label: "Autonomy Lane Auto-Advance Snapshot",
    description: "Report-only snapshot for hard-intent auto-advance (focus-complete -> successor) with explicit fail-closed blockers.",
    parameters: buildAutonomyTaskSelectionParameters(),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const snapshot = buildAutoAdvanceHardIntentSnapshot(p, ctx.cwd);
      return {
        content: [{ type: "text", text: snapshot.summary }],
        details: snapshot,
      };
    },
  });

  pi.registerTool({
    name: "autonomy_lane_protected_scope_report",
    label: "Autonomy Lane Protected Scope Report",
    description: "Report-only protected-scope classification evidence for autonomy lane tasks (reason codes + signals).",
    parameters: Type.Object({
      milestone: Type.Optional(Type.String({ description: "Optional milestone filter." })),
      limit: Type.Optional(Type.Number({ description: "Max rows to return (1..20)." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = evaluateAutonomyProtectedScopeReasonReport(ctx.cwd, {
        milestone: typeof p.milestone === "string" ? p.milestone : undefined,
        limit: asNumber(p.limit, 10),
      });
      return buildOperatorVisibleToolResponse({
        label: "autonomy_lane_protected_scope_report",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "autonomy_lane_protected_focus_packet",
    label: "Autonomy Lane Protected Focus Packet",
    description: "Report-only decision packet for one protected-focus task (promote|skip|defer) with value/risk/effort and no dispatch authorization.",
    parameters: Type.Object({
      task_id: Type.String({ minLength: 1, description: "Task id to evaluate for protected-focus decision." }),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = evaluateAutonomyProtectedFocusDecisionPacket(ctx.cwd, String(p.task_id ?? ""));
      return {
        content: [{ type: "text", text: result.summary }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "lane_brainstorm_packet",
    label: "Lane Brainstorm Packet",
    description: "Report-only lane brainstorm packet with ranked ideas and stable recommendationCode/nextAction.",
    parameters: buildLaneBrainstormParameters(),
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

      return buildOperatorVisibleToolResponse({
        label: "lane_brainstorm_packet",
        summary: `lane-brainstorm: decision=${packet.decision} code=${packet.recommendationCode} ideas=${packet.ideas.length} slices=${packet.selectedSlices.length}`,
        details: packet,
      });
    },
  });

  pi.registerTool({
    name: "lane_brainstorm_seed_preview",
    label: "Lane Brainstorm Seed Preview",
    description: "Report-only visible seeding preview from brainstorm slices; always requires explicit human decision before task materialization.",
    parameters: buildLaneBrainstormParameters({ includeSource: true }),
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
      const preview = buildLaneBrainstormSeedPreview({
        packet,
        source: p.source === "human" || p.source === "tangent-approved" ? p.source : "brainstorm",
      });
      return buildOperatorVisibleToolResponse({
        label: "lane_brainstorm_seed_preview",
        summary: `lane-brainstorm-seed-preview: decision=${preview.decision} code=${preview.recommendationCode} proposals=${preview.proposals.length} source=${preview.source} confirmation=yes`,
        details: preview,
      });
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
      return buildOperatorVisibleToolResponse({
        label: "project_intake_plan",
        summary: `project-intake: decision=${plan.decision} profile=${plan.profile} code=${plan.recommendationCode} authorization=${plan.authorization}`,
        details: plan,
      });
    },
  });
}
