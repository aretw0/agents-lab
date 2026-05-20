/**
 * @capability-id runtime-guardrails
 * @capability-criticality high
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  buildLocalMeasuredNudgeFreeLoopAuditEnvelopeFromCollectedFacts,
  resolveNudgeFreeLoopCanaryGate,
  resolveSelfReloadAutoresumeCanaryPlan,
  buildLocalBatchManifestPacket,
  resolveLocalSliceBacklogGate,
  resolveUnattendedContinuationPlan,
  reviewLocalSliceOperatorApprovedContract,
  type NudgeFreeLoopLocalCandidate,
  type NudgeFreeLoopLocalReadStatus,
  type NudgeFreeLoopValidationKind,
  type LocalSliceCanaryDispatchPacketDecision,
  type LocalSliceOperatorDecisionKind,
  type UnattendedContinuationContextLevel,
} from "./guardrails-core-unattended-continuation";
import { asBooleanWithDefault } from "./guardrails-core-param-normalizers";
import {
  formatAuthorizationEvidence,
  GUARDRAILS_AUTHORIZATION_NONE,
} from "./guardrails-core-authorization";

function normalizeContextLevel(value: unknown): UnattendedContinuationContextLevel {
  return value === "warn" || value === "checkpoint" || value === "compact" || value === "ok" ? value : "ok";
}

function normalizePacketDecision(value: unknown): LocalSliceCanaryDispatchPacketDecision {
  return value === "ready-for-operator-decision" ? "ready-for-operator-decision" : "blocked";
}

function normalizeOperatorDecision(value: unknown): LocalSliceOperatorDecisionKind {
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

const LOCAL_CONTINUITY_ADVISORY_BLOCKERS = new Set([
  "context-watch-compact-required",
  "context-watch-checkpoint-required",
  "auto-advance-telemetry-needs-evidence",
]);

function isLocalContinuityStopBlocker(blocker: string): boolean {
  const normalized = blocker.trim();
  if (!normalized) return false;
  return !LOCAL_CONTINUITY_ADVISORY_BLOCKERS.has(normalized);
}

function localContinuityStopBlockerEvidence(input: { advisoryCount: number; stopCount: number }): string {
  if (input.stopCount > 0) return "blocker=present";
  if (input.advisoryCount > 0) return `blocker=advisory-only count=${input.advisoryCount}`;
  return "blocker=none";
}

type LocalContinuityStagnationSignal = {
  decision: "none" | "watch" | "pause-operator-replan";
  reasonCode: "no-stagnation" | "context-pressure-repeat";
  consecutiveContextPressureEvents: number;
  focusTask: string;
  operatorActionRequired: boolean;
  advisoryOnly: true;
};

function isContextPressureEvent(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  const level = typeof event.level === "string" ? event.level : "";
  const action = typeof event.action === "string" ? event.action : "";
  return level === "compact" || level === "checkpoint" || action === "compact-now" || action === "checkpoint-refresh";
}

function buildLocalContinuityStagnationSignal(handoffJson: any): LocalContinuityStagnationSignal {
  const focusTask = Array.isArray(handoffJson?.current_tasks) ? String(handoffJson.current_tasks[0] ?? "none") : "none";
  const events = Array.isArray(handoffJson?.context_watch_events) ? handoffJson.context_watch_events : [];
  let consecutiveContextPressureEvents = 0;
  for (const event of events.slice().reverse()) {
    if (!isContextPressureEvent(event)) break;
    consecutiveContextPressureEvents += 1;
  }
  const hasFreshCompletion = Array.isArray(handoffJson?.completed_tasks) && handoffJson.completed_tasks.length > 0;
  const decision = consecutiveContextPressureEvents >= 2 && focusTask !== "none" && !hasFreshCompletion
    ? "pause-operator-replan"
    : consecutiveContextPressureEvents === 1 && focusTask !== "none" && !hasFreshCompletion
      ? "watch"
      : "none";
  return {
    decision,
    reasonCode: decision === "none" ? "no-stagnation" : "context-pressure-repeat",
    consecutiveContextPressureEvents,
    focusTask,
    operatorActionRequired: decision === "pause-operator-replan",
    advisoryOnly: true,
  };
}

function localContinuityStagnationSummary(result: unknown): string | undefined {
  const signal = (result as { stagnationSignal?: LocalContinuityStagnationSignal } | undefined)?.stagnationSignal;
  if (!signal || signal.decision === "none") return undefined;
  return `${signal.decision} events=${signal.consecutiveContextPressureEvents}`;
}

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
  const stagnation = localContinuityStagnationSummary(result);
  return [
    `local-continuity-audit: eligible=${result.envelope.eligibleForAuditedRuntimeSurface ? "yes" : "no"}`,
    `collectors=${result.collectorResults.length}/8`,
    `packet=${result.envelope.packet.gate.decision}`,
    reasons.length > 0 ? `reasons=${reasons.join("|")}` : undefined,
    protectedPaths.length > 0 ? `protected=${protectedPaths.join("|")}` : undefined,
    stagnation ? `stagnation=${stagnation}` : undefined,
    formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE),
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
  const blockers = Array.isArray(handoff.json?.blockers) ? handoff.json.blockers.filter(Boolean).map(String) : [];
  const stopBlockers = blockers.filter(isLocalContinuityStopBlocker);
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
        {
          kind: "blocker",
          present: stopBlockers.length > 0,
          evidence: localContinuityStopBlockerEvidence({ advisoryCount: blockers.length - stopBlockers.length, stopCount: stopBlockers.length }),
        },
        { kind: "protected-scope", present: protectedPaths.length > 0, evidence: protectedPaths.length > 0 ? "protected=present" : "protected=none" },
      ],
    },
  });
  return {
    ...audit,
    protectedPaths: protectedPaths.slice(0, 10),
    advisoryBlockers: blockers.filter((blocker) => !isLocalContinuityStopBlocker(blocker)).slice(0, 10),
    stagnationSignal: buildLocalContinuityStagnationSignal(handoff.json),
  };
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
        nextLocalSafe: asBooleanWithDefault(p.next_local_safe, false),
        protectedScope: asBooleanWithDefault(p.protected_scope, false),
        risk: asBooleanWithDefault(p.risk, false),
        ambiguous: asBooleanWithDefault(p.ambiguous, false),
        progressSaved: asBooleanWithDefault(p.progress_saved, false),
        contextLevel: normalizeContextLevel(p.context_level),
      });
      return {
        content: [{ type: "text", text: result.summary }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "local_batch_manifest_packet",
    label: "Local Batch Manifest Packet",
    description: "Report-only packet for the operator minimal local-safe batch manifestation. Never dispatches, never approves workers, and never starts execution.",
    parameters: Type.Object({
      profile_decision: Type.String({ description: "Decision from control_plane_profile_packet." }),
      profile_kind: Type.String({ description: "Profile from control_plane_profile_packet." }),
      profile_dispatch_allowed: Type.Boolean({ description: "Must be false." }),
      profile_mutation_allowed: Type.Boolean({ description: "Must be false." }),
      profile_authorization: Type.Optional(Type.String({ description: "Expected none." })),
      profile_mode: Type.Optional(Type.String({ description: "Expected report-only." })),
      manifestation: Type.String({ description: "missing | generic | explicit-local-batch." }),
      subject: Type.Optional(Type.String({ description: "Batch subject/seed." })),
      focus_task_id: Type.Optional(Type.String({ description: "Initial focus task or theme id." })),
      local_safe_scope: Type.Boolean({ description: "Whether all requested work is local-safe." }),
      slice_limit: Type.Optional(Type.Number({ description: "Bounded number of slices, clamped to 1..5." })),
      time_budget_known: Type.Boolean(),
      cost_budget_known: Type.Boolean(),
      validation_gate_known: Type.Boolean(),
      rollback_plan_known: Type.Boolean(),
      checkpoint_planned: Type.Boolean(),
      stop_conditions: Type.Optional(Type.Array(Type.String({ description: "Batch stop conditions." }))),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
      scheduler_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
      remote_or_offload_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
      github_actions_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
      worker_requested: Type.Optional(Type.Boolean({ description: "Blocks until lower worker gate approves." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = buildLocalBatchManifestPacket({
        profilePacket: {
          decision: normalizePacketDecision(p.profile_decision),
          profile: String(p.profile_kind ?? "local-safe-single-slice") as never,
          dispatchAllowed: asBooleanWithDefault(p.profile_dispatch_allowed, false) as false,
          mutationAllowed: asBooleanWithDefault(p.profile_mutation_allowed, false) as false,
          authorization: (p.profile_authorization === "none" ? "none" : String(p.profile_authorization ?? "unknown")) as "none",
          mode: (p.profile_mode === "report-only" ? "report-only" : String(p.profile_mode ?? "unknown")) as "report-only",
        },
        manifestation: p.manifestation === "explicit-local-batch" || p.manifestation === "generic" ? p.manifestation : "missing",
        subject: typeof p.subject === "string" ? p.subject : undefined,
        focusTaskId: typeof p.focus_task_id === "string" ? p.focus_task_id : undefined,
        localSafeScope: asBooleanWithDefault(p.local_safe_scope, false),
        sliceLimit: typeof p.slice_limit === "number" ? p.slice_limit : undefined,
        timeBudgetKnown: asBooleanWithDefault(p.time_budget_known, false),
        costBudgetKnown: asBooleanWithDefault(p.cost_budget_known, false),
        validationGateKnown: asBooleanWithDefault(p.validation_gate_known, false),
        rollbackPlanKnown: asBooleanWithDefault(p.rollback_plan_known, false),
        checkpointPlanned: asBooleanWithDefault(p.checkpoint_planned, false),
        stopConditions: Array.isArray(p.stop_conditions) ? p.stop_conditions as string[] : undefined,
        protectedScopeRequested: asBooleanWithDefault(p.protected_scope_requested, false),
        schedulerRequested: asBooleanWithDefault(p.scheduler_requested, false),
        remoteOrOffloadRequested: asBooleanWithDefault(p.remote_or_offload_requested, false),
        githubActionsRequested: asBooleanWithDefault(p.github_actions_requested, false),
        workerRequested: asBooleanWithDefault(p.worker_requested, false),
      });
      return {
        content: [{ type: "text", text: result.summary }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "local_slice_backlog_gate",
    label: "One-Slice Executor Backlog Gate",
    description: "Read-only gate for whether a future local-slice executor idea may become a separate design/backlog task. Never approves implementation or dispatch.",
    parameters: Type.Object({
      project_strategy_resolved: Type.Boolean({ description: "Whether .project adapter/canonicality strategy is resolved for this lane." }),
      operator_packet_green_validated: Type.Boolean({ description: "Whether operator packet green path was live-validated." }),
      operator_packet_fail_closed_validated: Type.Boolean({ description: "Whether operator packet fail-closed path was live-validated." }),
      operator_packet_missing_files_validated: Type.Boolean({ description: "Whether missing-files operator packet path was live-validated." }),
      explicit_operator_contract_defined: Type.Boolean({ description: "Whether explicit task/action operator contract is defined." }),
      declared_files_known: Type.Boolean({ description: "Whether file scope is declared." }),
      rollback_plan_known: Type.Boolean({ description: "Whether non-destructive rollback is known." }),
      validation_gate_known: Type.Boolean({ description: "Whether validation gate is known before editing." }),
      staging_scope_known: Type.Boolean({ description: "Whether staging scope is bounded." }),
      commit_scope_known: Type.Boolean({ description: "Whether commit scope is bounded." }),
      time_budget_known: Type.Boolean({ description: "Whether time budget is defined." }),
      cost_budget_known: Type.Boolean({ description: "Whether cost budget is defined." }),
      cancellation_known: Type.Boolean({ description: "Whether safe cancellation/abort is defined." }),
      checkpoint_planned: Type.Boolean({ description: "Whether post-slice checkpoint is planned." }),
      stop_contract_known: Type.Boolean({ description: "Whether mandatory stop after local slice is defined." }),
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
      const result = resolveLocalSliceBacklogGate({
        projectStrategyResolved: asBooleanWithDefault(p.project_strategy_resolved, false),
        operatorPacketGreenValidated: asBooleanWithDefault(p.operator_packet_green_validated, false),
        operatorPacketFailClosedValidated: asBooleanWithDefault(p.operator_packet_fail_closed_validated, false),
        operatorPacketMissingFilesValidated: asBooleanWithDefault(p.operator_packet_missing_files_validated, false),
        explicitOperatorContractDefined: asBooleanWithDefault(p.explicit_operator_contract_defined, false),
        declaredFilesKnown: asBooleanWithDefault(p.declared_files_known, false),
        rollbackPlanKnown: asBooleanWithDefault(p.rollback_plan_known, false),
        validationGateKnown: asBooleanWithDefault(p.validation_gate_known, false),
        stagingScopeKnown: asBooleanWithDefault(p.staging_scope_known, false),
        commitScopeKnown: asBooleanWithDefault(p.commit_scope_known, false),
        timeBudgetKnown: asBooleanWithDefault(p.time_budget_known, false),
        costBudgetKnown: asBooleanWithDefault(p.cost_budget_known, false),
        cancellationKnown: asBooleanWithDefault(p.cancellation_known, false),
        checkpointPlanned: asBooleanWithDefault(p.checkpoint_planned, false),
        stopContractKnown: asBooleanWithDefault(p.stop_contract_known, false),
        separateTaskRequired: asBooleanWithDefault(p.separate_task_required, false),
        startsDisabledOrDryRun: asBooleanWithDefault(p.starts_disabled_or_dry_run, false),
        repeatRequested: asBooleanWithDefault(p.repeat_requested, false),
        schedulerRequested: asBooleanWithDefault(p.scheduler_requested, false),
        selfReloadRequested: asBooleanWithDefault(p.self_reload_requested, false),
        remoteOrOffloadRequested: asBooleanWithDefault(p.remote_or_offload_requested, false),
        githubActionsRequested: asBooleanWithDefault(p.github_actions_requested, false),
        protectedScopeRequested: asBooleanWithDefault(p.protected_scope_requested, false),
        destructiveMaintenanceRequested: asBooleanWithDefault(p.destructive_maintenance_requested, false),
      });
      return {
        content: [{ type: "text", text: result.summary }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "local_slice_operator_contract_review",
    label: "One-Slice Operator Contract Review",
    description: "Read-only review for a proposed operator-approved local-slice local execution contract. Never dispatches execution; always keeps dispatchAllowed=false and executorApproved=false.",
    parameters: Type.Object({
      packet_decision: Type.String({ description: "Decision from local-slice decision packet: ready-for-operator-decision | blocked." }),
      packet_dispatch_allowed: Type.Boolean({ description: "Must be false; packet evidence never authorizes dispatch." }),
      packet_requires_operator_decision: Type.Boolean({ description: "Must be true." }),
      packet_single_slice_only: Type.Boolean({ description: "Must be true." }),
      packet_activation: Type.Optional(Type.String({ description: "Expected none." })),
      packet_authorization: Type.Optional(Type.String({ description: "Expected none." })),
      operator_decision: Type.String({ description: "missing | generic | explicit-task-action." }),
      single_focus: Type.Boolean({ description: "Whether exactly one focus task is named." }),
      local_safe_scope: Type.Boolean({ description: "Whether scope is local-safe." }),
      declared_files_known: Type.Boolean({ description: "Whether all touched files are declared." }),
      protected_scopes_clear: Type.Boolean({ description: "Whether protected scopes are absent." }),
      rollback_plan_known: Type.Boolean({ description: "Whether rollback is explicit and non-destructive." }),
      validation_gate_known: Type.Boolean({ description: "Whether bounded validation is known before editing." }),
      staging_scope_known: Type.Boolean({ description: "Whether staging scope is intentional and bounded." }),
      commit_scope_known: Type.Boolean({ description: "Whether commit scope is intentional and bounded." }),
      checkpoint_planned: Type.Boolean({ description: "Whether a post-slice checkpoint is planned." }),
      stop_contract_known: Type.Boolean({ description: "Whether stop after local slice is explicit." }),
      repeat_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
      scheduler_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
      self_reload_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
      remote_or_offload_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
      github_actions_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when true." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = reviewLocalSliceOperatorApprovedContract({
        decisionPacket: {
          decision: normalizePacketDecision(p.packet_decision),
          dispatchAllowed: asBooleanWithDefault(p.packet_dispatch_allowed, false) as false,
          requiresOperatorDecision: asBooleanWithDefault(p.packet_requires_operator_decision, false),
          singleSliceOnly: asBooleanWithDefault(p.packet_single_slice_only, false),
          activation: (p.packet_activation === "none" ? "none" : String(p.packet_activation ?? "unknown")) as "none",
          authorization: (p.packet_authorization === "none" ? "none" : String(p.packet_authorization ?? "unknown")) as "none",
        },
        operatorDecision: normalizeOperatorDecision(p.operator_decision),
        singleFocus: asBooleanWithDefault(p.single_focus, false),
        localSafeScope: asBooleanWithDefault(p.local_safe_scope, false),
        declaredFilesKnown: asBooleanWithDefault(p.declared_files_known, false),
        protectedScopesClear: asBooleanWithDefault(p.protected_scopes_clear, false),
        rollbackPlanKnown: asBooleanWithDefault(p.rollback_plan_known, false),
        validationGateKnown: asBooleanWithDefault(p.validation_gate_known, false),
        stagingScopeKnown: asBooleanWithDefault(p.staging_scope_known, false),
        commitScopeKnown: asBooleanWithDefault(p.commit_scope_known, false),
        checkpointPlanned: asBooleanWithDefault(p.checkpoint_planned, false),
        stopContractKnown: asBooleanWithDefault(p.stop_contract_known, false),
        repeatRequested: asBooleanWithDefault(p.repeat_requested, false),
        schedulerRequested: asBooleanWithDefault(p.scheduler_requested, false),
        selfReloadRequested: asBooleanWithDefault(p.self_reload_requested, false),
        remoteOrOffloadRequested: asBooleanWithDefault(p.remote_or_offload_requested, false),
        githubActionsRequested: asBooleanWithDefault(p.github_actions_requested, false),
        protectedScopeRequested: asBooleanWithDefault(p.protected_scope_requested, false),
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
    description: "Read-only canary plan for future self-reload/autoresume. Never reloads, never dispatches resume, and requires explicit operator decision even when gates are green.",
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
      recent_steer_clear: Type.Boolean({ description: "Whether no recent operator steer should suppress resume." }),
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
        optIn: asBooleanWithDefault(p.opt_in, false),
        reloadRequired: asBooleanWithDefault(p.reload_required, false),
        checkpointFresh: asBooleanWithDefault(p.checkpoint_fresh, false),
        handoffBudgetOk: asBooleanWithDefault(p.handoff_budget_ok, false),
        gitStateExpected: asBooleanWithDefault(p.git_state_expected, false),
        protectedScopesClear: asBooleanWithDefault(p.protected_scopes_clear, false),
        cooldownReady: asBooleanWithDefault(p.cooldown_ready, false),
        autoResumePreviewReady: asBooleanWithDefault(p.auto_resume_preview_ready, false),
        pendingMessagesClear: asBooleanWithDefault(p.pending_messages_clear, false),
        recentSteerClear: asBooleanWithDefault(p.recent_steer_clear, false),
        laneQueueClear: asBooleanWithDefault(p.lane_queue_clear, false),
        stopConditionsClear: asBooleanWithDefault(p.stop_conditions_clear, false),
        contextLevel: normalizeContextLevel(p.context_level),
        schedulerRequested: asBooleanWithDefault(p.scheduler_requested, false),
        remoteOrOffloadRequested: asBooleanWithDefault(p.remote_or_offload_requested, false),
        githubActionsRequested: asBooleanWithDefault(p.github_actions_requested, false),
        protectedScopeRequested: asBooleanWithDefault(p.protected_scope_requested, false),
        destructiveMaintenanceRequested: asBooleanWithDefault(p.destructive_maintenance_requested, false),
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
        optIn: asBooleanWithDefault(p.opt_in, false),
        nextLocalSafe: asBooleanWithDefault(p.next_local_safe, false),
        checkpointFresh: asBooleanWithDefault(p.checkpoint_fresh, false),
        handoffBudgetOk: asBooleanWithDefault(p.handoff_budget_ok, false),
        gitStateExpected: asBooleanWithDefault(p.git_state_expected, false),
        protectedScopesClear: asBooleanWithDefault(p.protected_scopes_clear, false),
        cooldownReady: asBooleanWithDefault(p.cooldown_ready, false),
        validationKnown: asBooleanWithDefault(p.validation_known, false),
        stopConditionsClear: asBooleanWithDefault(p.stop_conditions_clear, false),
      });
      return {
        content: [{ type: "text", text: result.summary }],
        details: result,
      };
    },
  });
}
