import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  buildLocalMeasuredNudgeFreeLoopAuditEnvelopeFromCollectedFacts,
  resolveNudgeFreeLoopCanaryGate,
  resolveSelfReloadAutoresumeCanaryPlan,
  resolveOneSliceExecutorBacklogGate,
  resolveUnattendedContinuationPlan,
  reviewOneSliceLocalHumanConfirmedContract,
  type NudgeFreeLoopLocalCandidate,
  type NudgeFreeLoopLocalReadStatus,
  type NudgeFreeLoopValidationKind,
  type OneSliceLocalCanaryDispatchPacketDecision,
  type OneSliceLocalHumanConfirmationKind,
  type UnattendedContinuationContextLevel,
} from "./guardrails-core-unattended-continuation";

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeContextLevel(value: unknown): UnattendedContinuationContextLevel {
  return value === "warn" || value === "checkpoint" || value === "compact" || value === "ok" ? value : "ok";
}

function normalizePacketDecision(value: unknown): OneSliceLocalCanaryDispatchPacketDecision {
  return value === "ready-for-human-decision" ? "ready-for-human-decision" : "blocked";
}

function normalizeHumanConfirmation(value: unknown): OneSliceLocalHumanConfirmationKind {
  return value === "explicit-task-action" || value === "generic" || value === "missing" ? value : "missing";
}

function readJsonFile(path: string): { status: NudgeFreeLoopLocalReadStatus; json?: any; text?: string } {
  if (!existsSync(path)) return { status: "missing" };
  try {
    const text = readFileSync(path, "utf8");
    return { status: "observed", json: JSON.parse(text), text };
  } catch {
    return { status: "error" };
  }
}

function normalizePathForAudit(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

const LOCAL_CONTINUITY_AUDIT_BOOKKEEPING_PATHS = [
  ".project/tasks.json",
  ".project/verification.json",
  ".project/handoff.json",
];

function isProtectedAuditPath(path: string): boolean {
  const normalized = normalizePathForAudit(path).toLowerCase();
  return normalized === ".pi/settings.json" || normalized === ".obsidian" || normalized.startsWith(".obsidian/") || normalized.startsWith(".github/");
}

function localContinuityExpectedPaths(task: any): string[] {
  const taskFiles = Array.isArray(task?.files) ? task.files.map((file: unknown) => normalizePathForAudit(String(file))) : [];
  return [...new Set([...taskFiles, ...LOCAL_CONTINUITY_AUDIT_BOOKKEEPING_PATHS])];
}

function listGitChangedPaths(cwd: string): { status: NudgeFreeLoopLocalReadStatus; paths?: string[] } {
  try {
    const output = execFileSync("git", ["status", "--short"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const paths = output.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean).map((line) => {
      const raw = line.slice(3).trim();
      const renamed = raw.split(" -> ");
      return normalizePathForAudit(renamed[renamed.length - 1] ?? raw);
    }).filter(Boolean);
    return { status: "observed", paths };
  } catch {
    return { status: "error" };
  }
}

function isCandidateTask(task: any): boolean {
  return task?.status === "in-progress" || task?.status === "planned";
}

function taskProtectedPaths(task: any): string[] {
  const files = Array.isArray(task?.files) ? task.files.map((file: unknown) => String(file)) : [];
  return files.filter(isProtectedAuditPath).map(normalizePathForAudit);
}

function taskNumericSuffix(task: any): number {
  const id = typeof task?.id === "string" ? task.id : "";
  const match = id.match(/(\d+)(?!.*\d)/);
  return match ? Number(match[1]) : -1;
}

function sortLocalContinuityCandidateTasks(a: any, b: any): number {
  const statusRank = (task: any) => task?.status === "in-progress" ? 0 : 1;
  const byStatus = statusRank(a) - statusRank(b);
  if (byStatus !== 0) return byStatus;
  const byProtected = taskProtectedPaths(a).length - taskProtectedPaths(b).length;
  if (byProtected !== 0) return byProtected;
  return taskNumericSuffix(b) - taskNumericSuffix(a);
}

function findTask(tasksJson: unknown, taskId?: string): any | undefined {
  const tasks = Array.isArray(tasksJson) ? tasksJson : (tasksJson as { tasks?: unknown[] } | undefined)?.tasks;
  if (!Array.isArray(tasks)) return undefined;
  if (taskId) {
    const handoffTask = tasks.find((task: any) => task?.id === taskId);
    if (isCandidateTask(handoffTask) && taskProtectedPaths(handoffTask).length <= 0) return handoffTask;
  }
  return tasks.filter(isCandidateTask).sort(sortLocalContinuityCandidateTasks)[0];
}

function deriveValidationKind(task: any): { kind: NudgeFreeLoopValidationKind; focalGate?: string } {
  const files = Array.isArray(task?.files) ? task.files.map((file: unknown) => String(file)) : [];
  const text = [
    task?.description,
    ...(Array.isArray(task?.acceptance_criteria) ? task.acceptance_criteria : []),
    ...files,
  ].join("\n").toLowerCase();
  if (text.includes("smoke") || text.includes("test") || text.includes(".spec.")) {
    return { kind: "focal-test", focalGate: "npm-run-smoke" };
  }
  if (text.includes("marker")) return { kind: "marker-check" };
  return { kind: "unknown" };
}

function deriveCandidate(task: any): NudgeFreeLoopLocalCandidate | undefined {
  if (!task?.id) return undefined;
  const files = Array.isArray(task.files) ? task.files.map((file: unknown) => String(file)) : [];
  const protectedPaths = files.filter(isProtectedAuditPath).map(normalizePathForAudit);
  return {
    taskId: String(task.id),
    scope: protectedPaths.length > 0 ? "protected" : "local",
    estimatedFiles: files.length,
    reversible: "git",
    validationKind: deriveValidationKind(task).kind,
    risk: protectedPaths.length > 0 ? "medium" : "low",
    protectedPaths,
  };
}

export function localContinuityAuditReasons(result: ReturnType<typeof buildLocalMeasuredNudgeFreeLoopAuditEnvelopeFromCollectedFacts>): string[] {
  const collectorReasons = result.collectorResults
    .filter((collector) => collector.status !== "observed")
    .map((collector) => `${collector.fact}:${collector.status}`);
  const hasActionableCollectorReason = collectorReasons.length > 0;
  const genericWhenCollectorsExplain = new Set([
    "measured-evidence-incomplete",
    "measured-evidence-invalid",
    "collectors-not-eligible",
    "packet-not-ready",
    "trust-not-eligible",
  ]);
  const reasons = new Set<string>(collectorReasons);
  for (const reason of result.envelope.packet.gate.reasons) {
    if (hasActionableCollectorReason && genericWhenCollectorsExplain.has(reason)) continue;
    reasons.add(reason);
  }
  for (const reason of result.envelope.reasons) {
    if (hasActionableCollectorReason && genericWhenCollectorsExplain.has(reason)) continue;
    reasons.add(reason);
  }
  return [...reasons].slice(0, 5);
}

export function localContinuityProtectedPaths(result: unknown): string[] {
  const paths = (result as { protectedPaths?: unknown } | undefined)?.protectedPaths;
  return Array.isArray(paths) ? paths.map((path) => normalizePathForAudit(String(path))).filter(Boolean).slice(0, 3) : [];
}

export function formatLocalContinuityAuditSummary(
  result: ReturnType<typeof buildLocalMeasuredNudgeFreeLoopAuditEnvelopeFromCollectedFacts>,
  reasons = localContinuityAuditReasons(result),
): string {
  const protectedPaths = localContinuityProtectedPaths(result);
  return [
    `local-continuity-audit: eligible=${result.envelope.eligibleForAuditedRuntimeSurface ? "yes" : "no"}`,
    `collectors=${result.collectorResults.length}/8`,
    `packet=${result.envelope.packet.gate.decision}`,
    reasons.length > 0 ? `reasons=${reasons.join("|")}` : undefined,
    protectedPaths.length > 0 ? `protected=${protectedPaths.join("|")}` : undefined,
    "authorization=none",
  ].filter(Boolean).join(" ");
}

export function buildLocalContinuityAudit(cwd: string) {
  const handoff = readJsonFile(join(cwd, ".project", "handoff.json"));
  const tasks = readJsonFile(join(cwd, ".project", "tasks.json"));
  const handoffTaskId = Array.isArray(handoff.json?.current_tasks) ? String(handoff.json.current_tasks[0] ?? "") : undefined;
  const task = findTask(tasks.json, handoffTaskId) ?? findTask(tasks.json);
  const candidate = deriveCandidate(task);
  const validation = task ? deriveValidationKind(task) : { kind: "unknown" as const };
  const git = listGitChangedPaths(cwd);
  const expectedPaths = localContinuityExpectedPaths(task);
  const changedPaths = git.paths ?? [];
  const protectedPaths = [...new Set([...changedPaths, ...expectedPaths].filter(isProtectedAuditPath))];
  const blockers = Array.isArray(handoff.json?.blockers) ? handoff.json.blockers.filter(Boolean) : [];
  const audit = buildLocalMeasuredNudgeFreeLoopAuditEnvelopeFromCollectedFacts({
    optIn: true,
    nowMs: Date.now(),
    candidate: {
      readStatus: tasks.status === "observed" && candidate ? "observed" : tasks.status === "missing" ? "missing" : tasks.status === "error" ? "error" : "missing",
      candidate,
    },
    checkpoint: {
      readStatus: handoff.status,
      handoffTimestampIso: typeof handoff.json?.timestamp === "string" ? handoff.json.timestamp : undefined,
      maxAgeMs: 5 * 60_000,
    },
    handoffBudget: {
      readStatus: handoff.status,
      handoffJson: handoff.text,
      maxJsonChars: 2700,
    },
    gitState: {
      readStatus: git.status,
      changedPaths,
      expectedPaths,
    },
    protectedScopes: {
      readStatus: git.status,
      paths: protectedPaths,
    },
    cooldown: {
      readStatus: "observed",
      cooldownMs: 60_000,
    },
    validation: {
      readStatus: task ? "observed" : tasks.status,
      ...validation,
    },
    stopConditions: {
      readStatus: handoff.status,
      conditions: [
        { kind: "blocker", present: blockers.length > 0, evidence: blockers.length > 0 ? "blocker=present" : "blocker=none" },
        { kind: "protected-scope", present: protectedPaths.length > 0, evidence: protectedPaths.length > 0 ? "protected=present" : "protected=none" },
      ],
    },
  });
  return { ...audit, protectedPaths: protectedPaths.slice(0, 10) };
}

export function registerGuardrailsUnattendedContinuationSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "local_continuity_audit",
    label: "Local Continuity Audit",
    description: "Read-only local continuity audit packet. Derives local facts from the workspace, returns advisory evidence only, and never starts automation.",
    parameters: Type.Object({}),
    execute(_toolCallId, _params, _signal, _onUpdate, context) {
      const cwd = typeof (context as { cwd?: unknown } | undefined)?.cwd === "string" ? (context as { cwd: string }).cwd : process.cwd();
      const result = buildLocalContinuityAudit(cwd);
      const localContinuityReasons = localContinuityAuditReasons(result);
      const localContinuitySummary = formatLocalContinuityAuditSummary(result, localContinuityReasons);
      return {
        content: [{ type: "text", text: localContinuitySummary }],
        details: { ...result, localContinuitySummary, localContinuityReasons },
      };
    },
  });

  pi.registerTool({
    name: "unattended_continuation_plan",
    label: "Unattended Continuation Plan",
    description: "Decide whether an unattended loop should continue a local-safe slice, checkpoint, pause, ask, or block. Read-only and side-effect-free.",
    parameters: Type.Object({
      next_local_safe: Type.Boolean({ description: "Whether the next step is local-first, small, reversible, and has a known focal gate." }),
      protected_scope: Type.Boolean({ description: "Whether the next step touches protected scopes such as CI, remote execution, publish, settings, .obsidian, external research, or destructive maintenance." }),
      risk: Type.Boolean({ description: "Whether the next step has data-loss, security, cost, or irreversible risk." }),
      ambiguous: Type.Boolean({ description: "Whether the next step requires a real operator/product decision." }),
      progress_saved: Type.Boolean({ description: "Whether handoff/checkpoint evidence is already fresh enough for resume." }),
      context_level: Type.Optional(Type.String({ description: "ok | warn | checkpoint | compact" })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = resolveUnattendedContinuationPlan({
        nextLocalSafe: asBool(p.next_local_safe, false),
        protectedScope: asBool(p.protected_scope, false),
        risk: asBool(p.risk, false),
        ambiguous: asBool(p.ambiguous, false),
        progressSaved: asBool(p.progress_saved, false),
        contextLevel: normalizeContextLevel(p.context_level),
      });
      return {
        content: [{ type: "text", text: result.summary }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "one_slice_executor_backlog_gate",
    label: "One-Slice Executor Backlog Gate",
    description: "Read-only gate for whether a future one-slice executor idea may become a separate design/backlog task. Never approves implementation or dispatch.",
    parameters: Type.Object({
      project_strategy_resolved: Type.Boolean({ description: "Whether .project adapter/canonicality strategy is resolved for this lane." }),
      operator_packet_green_validated: Type.Boolean({ description: "Whether operator packet green path was live-validated." }),
      operator_packet_fail_closed_validated: Type.Boolean({ description: "Whether operator packet fail-closed path was live-validated." }),
      operator_packet_missing_files_validated: Type.Boolean({ description: "Whether missing-files operator packet path was live-validated." }),
      explicit_human_contract_defined: Type.Boolean({ description: "Whether explicit task/action human contract is defined." }),
      declared_files_known: Type.Boolean({ description: "Whether file scope is declared." }),
      rollback_plan_known: Type.Boolean({ description: "Whether non-destructive rollback is known." }),
      validation_gate_known: Type.Boolean({ description: "Whether validation gate is known before editing." }),
      staging_scope_known: Type.Boolean({ description: "Whether staging scope is bounded." }),
      commit_scope_known: Type.Boolean({ description: "Whether commit scope is bounded." }),
      time_budget_known: Type.Boolean({ description: "Whether time budget is defined." }),
      cost_budget_known: Type.Boolean({ description: "Whether cost budget is defined." }),
      cancellation_known: Type.Boolean({ description: "Whether safe cancellation/abort is defined." }),
      checkpoint_planned: Type.Boolean({ description: "Whether post-slice checkpoint is planned." }),
      stop_contract_known: Type.Boolean({ description: "Whether mandatory stop after one slice is defined." }),
      separate_task_required: Type.Boolean({ description: "Whether implementation would require a separate task." }),
      starts_disabled_or_dry_run: Type.Boolean({ description: "Whether first implementation would start disabled or dry-run/report-only." }),
      repeat_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
      scheduler_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
      self_reload_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
      remote_or_offload_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
      github_actions_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
      destructive_maintenance_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = resolveOneSliceExecutorBacklogGate({
        projectStrategyResolved: asBool(p.project_strategy_resolved, false),
        operatorPacketGreenValidated: asBool(p.operator_packet_green_validated, false),
        operatorPacketFailClosedValidated: asBool(p.operator_packet_fail_closed_validated, false),
        operatorPacketMissingFilesValidated: asBool(p.operator_packet_missing_files_validated, false),
        explicitHumanContractDefined: asBool(p.explicit_human_contract_defined, false),
        declaredFilesKnown: asBool(p.declared_files_known, false),
        rollbackPlanKnown: asBool(p.rollback_plan_known, false),
        validationGateKnown: asBool(p.validation_gate_known, false),
        stagingScopeKnown: asBool(p.staging_scope_known, false),
        commitScopeKnown: asBool(p.commit_scope_known, false),
        timeBudgetKnown: asBool(p.time_budget_known, false),
        costBudgetKnown: asBool(p.cost_budget_known, false),
        cancellationKnown: asBool(p.cancellation_known, false),
        checkpointPlanned: asBool(p.checkpoint_planned, false),
        stopContractKnown: asBool(p.stop_contract_known, false),
        separateTaskRequired: asBool(p.separate_task_required, false),
        startsDisabledOrDryRun: asBool(p.starts_disabled_or_dry_run, false),
        repeatRequested: asBool(p.repeat_requested, false),
        schedulerRequested: asBool(p.scheduler_requested, false),
        selfReloadRequested: asBool(p.self_reload_requested, false),
        remoteOrOffloadRequested: asBool(p.remote_or_offload_requested, false),
        githubActionsRequested: asBool(p.github_actions_requested, false),
        protectedScopeRequested: asBool(p.protected_scope_requested, false),
        destructiveMaintenanceRequested: asBool(p.destructive_maintenance_requested, false),
      });
      return {
        content: [{ type: "text", text: result.summary }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "one_slice_human_contract_review",
    label: "One-Slice Human Contract Review",
    description: "Read-only review for a proposed human-confirmed one-slice local execution contract. Never dispatches execution; always keeps dispatchAllowed=false and executorApproved=false.",
    parameters: Type.Object({
      packet_decision: Type.String({ description: "Decision from one-slice decision packet: ready-for-human-decision | blocked." }),
      packet_dispatch_allowed: Type.Boolean({ description: "Must be false; packet evidence never authorizes dispatch." }),
      packet_requires_human_decision: Type.Boolean({ description: "Must be true." }),
      packet_one_slice_only: Type.Boolean({ description: "Must be true." }),
      packet_activation: Type.Optional(Type.String({ description: "Expected none." })),
      packet_authorization: Type.Optional(Type.String({ description: "Expected none." })),
      human_confirmation: Type.String({ description: "missing | generic | explicit-task-action." }),
      single_focus: Type.Boolean({ description: "Whether exactly one focus task is named." }),
      local_safe_scope: Type.Boolean({ description: "Whether scope is local-safe." }),
      declared_files_known: Type.Boolean({ description: "Whether all touched files are declared." }),
      protected_scopes_clear: Type.Boolean({ description: "Whether protected scopes are absent." }),
      rollback_plan_known: Type.Boolean({ description: "Whether rollback is explicit and non-destructive." }),
      validation_gate_known: Type.Boolean({ description: "Whether bounded validation is known before editing." }),
      staging_scope_known: Type.Boolean({ description: "Whether staging scope is intentional and bounded." }),
      commit_scope_known: Type.Boolean({ description: "Whether commit scope is intentional and bounded." }),
      checkpoint_planned: Type.Boolean({ description: "Whether a post-slice checkpoint is planned." }),
      stop_contract_known: Type.Boolean({ description: "Whether stop after one slice is explicit." }),
      repeat_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
      scheduler_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
      self_reload_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
      remote_or_offload_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
      github_actions_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = reviewOneSliceLocalHumanConfirmedContract({
        decisionPacket: {
          decision: normalizePacketDecision(p.packet_decision),
          dispatchAllowed: asBool(p.packet_dispatch_allowed, false) as false,
          requiresHumanDecision: asBool(p.packet_requires_human_decision, false),
          oneSliceOnly: asBool(p.packet_one_slice_only, false),
          activation: (p.packet_activation === "none" ? "none" : String(p.packet_activation ?? "unknown")) as "none",
          authorization: (p.packet_authorization === "none" ? "none" : String(p.packet_authorization ?? "unknown")) as "none",
        },
        humanConfirmation: normalizeHumanConfirmation(p.human_confirmation),
        singleFocus: asBool(p.single_focus, false),
        localSafeScope: asBool(p.local_safe_scope, false),
        declaredFilesKnown: asBool(p.declared_files_known, false),
        protectedScopesClear: asBool(p.protected_scopes_clear, false),
        rollbackPlanKnown: asBool(p.rollback_plan_known, false),
        validationGateKnown: asBool(p.validation_gate_known, false),
        stagingScopeKnown: asBool(p.staging_scope_known, false),
        commitScopeKnown: asBool(p.commit_scope_known, false),
        checkpointPlanned: asBool(p.checkpoint_planned, false),
        stopContractKnown: asBool(p.stop_contract_known, false),
        repeatRequested: asBool(p.repeat_requested, false),
        schedulerRequested: asBool(p.scheduler_requested, false),
        selfReloadRequested: asBool(p.self_reload_requested, false),
        remoteOrOffloadRequested: asBool(p.remote_or_offload_requested, false),
        githubActionsRequested: asBool(p.github_actions_requested, false),
        protectedScopeRequested: asBool(p.protected_scope_requested, false),
      });
      return {
        content: [{ type: "text", text: result.summary }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "self_reload_autoresume_canary",
    label: "Self-Reload Auto-Resume Canary",
    description: "Read-only canary plan for future self-reload/autoresume. Never reloads, never dispatches resume, and requires explicit human decision even when gates are green.",
    parameters: Type.Object({
      opt_in: Type.Boolean({ description: "Explicit opt-in for evaluating the self-reload/autoresume canary." }),
      reload_required: Type.Boolean({ description: "Whether the live runtime has pending source/tool changes requiring reload." }),
      checkpoint_fresh: Type.Boolean({ description: "Whether bounded handoff/checkpoint evidence is fresh." }),
      handoff_budget_ok: Type.Boolean({ description: "Whether handoff evidence fits the bounded checkpoint budget." }),
      git_state_expected: Type.Boolean({ description: "Whether git state matches the expected local-safe scope." }),
      protected_scopes_clear: Type.Boolean({ description: "Whether protected scopes are absent." }),
      cooldown_ready: Type.Boolean({ description: "Whether reload/autoresume cooldown would allow a canary." }),
      auto_resume_preview_ready: Type.Boolean({ description: "Whether auto-resume preview is readable and bounded." }),
      pending_messages_clear: Type.Boolean({ description: "Whether no pending messages would be interrupted." }),
      recent_steer_clear: Type.Boolean({ description: "Whether no recent human steer should suppress resume." }),
      lane_queue_clear: Type.Boolean({ description: "Whether deferred lane queue is empty." }),
      stop_conditions_clear: Type.Boolean({ description: "Whether no real stop condition is present." }),
      context_level: Type.Optional(Type.Union([Type.Literal("ok"), Type.Literal("warn"), Type.Literal("checkpoint"), Type.Literal("compact")])),
      scheduler_requested: Type.Optional(Type.Boolean({ description: "Blocks when scheduler/repetition is requested." })),
      remote_or_offload_requested: Type.Optional(Type.Boolean({ description: "Blocks when remote/offload is requested." })),
      github_actions_requested: Type.Optional(Type.Boolean({ description: "Blocks when GitHub Actions/CI is requested." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scopes are requested." })),
      destructive_maintenance_requested: Type.Optional(Type.Boolean({ description: "Blocks when destructive maintenance is requested." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = resolveSelfReloadAutoresumeCanaryPlan({
        optIn: asBool(p.opt_in, false),
        reloadRequired: asBool(p.reload_required, false),
        checkpointFresh: asBool(p.checkpoint_fresh, false),
        handoffBudgetOk: asBool(p.handoff_budget_ok, false),
        gitStateExpected: asBool(p.git_state_expected, false),
        protectedScopesClear: asBool(p.protected_scopes_clear, false),
        cooldownReady: asBool(p.cooldown_ready, false),
        autoResumePreviewReady: asBool(p.auto_resume_preview_ready, false),
        pendingMessagesClear: asBool(p.pending_messages_clear, false),
        recentSteerClear: asBool(p.recent_steer_clear, false),
        laneQueueClear: asBool(p.lane_queue_clear, false),
        stopConditionsClear: asBool(p.stop_conditions_clear, false),
        contextLevel: normalizeContextLevel(p.context_level),
        schedulerRequested: asBool(p.scheduler_requested, false),
        remoteOrOffloadRequested: asBool(p.remote_or_offload_requested, false),
        githubActionsRequested: asBool(p.github_actions_requested, false),
        protectedScopeRequested: asBool(p.protected_scope_requested, false),
        destructiveMaintenanceRequested: asBool(p.destructive_maintenance_requested, false),
      });
      return {
        content: [{ type: "text", text: result.summary }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "nudge_free_loop_canary",
    label: "Nudge-Free Loop Canary",
    description: "Evaluate whether a local unattended loop can continue without a manual nudge. Advisory only: read-only, side-effect-free, never starts automation, and manual boolean input cannot produce ready.",
    parameters: Type.Object({
      opt_in: Type.Boolean({ description: "Explicit opt-in for the nudge-free loop canary." }),
      next_local_safe: Type.Boolean({ description: "Whether the next slice is local-first, small, reversible, and has a known focal gate." }),
      checkpoint_fresh: Type.Boolean({ description: "Whether handoff/checkpoint evidence is fresh enough for resume." }),
      handoff_budget_ok: Type.Boolean({ description: "Whether the handoff checkpoint is within the bounded budget." }),
      git_state_expected: Type.Boolean({ description: "Whether the git state matches the expected local-safe scope." }),
      protected_scopes_clear: Type.Boolean({ description: "Whether protected scopes are absent from the next slice." }),
      cooldown_ready: Type.Boolean({ description: "Whether the loop cooldown allows another autonomous slice." }),
      validation_known: Type.Boolean({ description: "Whether the next slice has a known bounded validation gate." }),
      stop_conditions_clear: Type.Boolean({ description: "Whether no real stop condition is present." }),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = resolveNudgeFreeLoopCanaryGate({
        optIn: asBool(p.opt_in, false),
        nextLocalSafe: asBool(p.next_local_safe, false),
        checkpointFresh: asBool(p.checkpoint_fresh, false),
        handoffBudgetOk: asBool(p.handoff_budget_ok, false),
        gitStateExpected: asBool(p.git_state_expected, false),
        protectedScopesClear: asBool(p.protected_scopes_clear, false),
        cooldownReady: asBool(p.cooldown_ready, false),
        validationKnown: asBool(p.validation_known, false),
        stopConditionsClear: asBool(p.stop_conditions_clear, false),
      });
      return {
        content: [{ type: "text", text: result.summary }],
        details: result,
      };
    },
  });
}
