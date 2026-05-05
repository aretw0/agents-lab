/**
 * project-board-surface — bounded query/update surface for `.project/*` blocks.
 *
 * Why:
 * - Long runs should avoid raw full-block reads for repetitive lookups.
 * - Provides deterministic query/update operations for high-volume board loops.
 * - Uses mtime-based cache to avoid reparsing unchanged blocks repeatedly.
 *
 * @capability-id project-board-surface
 * @capability-criticality medium
 */

import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  appendNote as appendTaskNote,
  readProjectTasksBlock,
  writeProjectTasksBlock,
  type ProjectTaskItem,
} from "./colony-pilot-task-sync";

import {
  appendRationaleToTaskNotes,
  appendRationaleToVerificationEvidence,
  BOARD_RATIONALE_KINDS,
  buildTaskProvenanceNote,
  buildTaskRationaleNote,
  hasRationaleText,
  hasTaskRationale,
  invalidateProjectBlockCaches,
  isRationaleSensitiveTask,
  isRationaleSensitiveVerification,
  normalizeBoundedText,
  normalizeLimit,
  normalizeMilestoneLabel,
  normalizeRationaleKind,
  normalizeRationaleText,
  normalizeStringArray,
  normalizeTaskProvenanceOrigin,
  PROJECT_TASK_STATUSES,
  PROJECT_VERIFICATION_STATUSES,
  readTasksBlockCached,
  readVerificationBlockCached,
  resolveLinkedVerificationRationaleKind,
  resolveRationaleConsistency,
  resolveTaskNoteRationaleKind,
  resolveTaskRationaleConsistency,
  resolveTaskRationaleKind,
  resolveTaskRationaleSource,
  resolveVerificationRationaleConsistency,
  resolveVerificationRationaleSource,
  resolveVerificationTaskNoteRationaleKind,
  shortText,
  summarizeRationaleConsistency,
  summarizeTaskRationale,
  summarizeVerificationRationale,
  tasksPath,
  verificationPath,
  writeVerificationBlock,
  type BoardRationaleConsistency,
  type BoardRationaleConsistencySummary,
  type BoardRationaleKind,
  type BoardRationaleSource,
  type BoardRationaleSummary,
  type BoardTaskProvenanceOrigin,
  type BoardVerificationSyncResult,
  type ProjectTaskStatus,
  type ProjectVerificationStatus,
  type TaskRecord,
  type TasksBlock,
  type VerificationBlock,
  type VerificationRecord,
} from "./project-board-model";
import {
  diagnoseTaskDependencyBlockers,
  isBroadTaskCandidate,
  normalizeDependencyIdList,
  normalizePositiveInt,
  scoreRatio,
  taskDependsOnProtectedScope,
  verificationLooksPartial,
  type ProjectTaskDependencyRecommendationCode,
} from "./project-board-governance-helpers";
export type { BoardFocusAutoAdvanceResult } from "./project-board-auto-advance";
import {
  appendProjectVerificationBoard as appendProjectVerificationBoardImpl,
  completeProjectTaskBoardWithVerification as completeProjectTaskBoardWithVerificationImpl,
  type ProjectTaskCompleteWithVerificationResult,
  type ProjectVerificationAppendResult,
} from "./project-board-completion";

export type {
  ProjectTaskCompleteWithVerificationResult,
  ProjectVerificationAppendResult,
} from "./project-board-completion";
export type { ProjectTaskDependencyRecommendationCode } from "./project-board-governance-helpers";

export {
  PROJECT_TASK_STATUSES,
  PROJECT_VERIFICATION_STATUSES,
  BOARD_RATIONALE_KINDS,
} from "./project-board-model";

export type {
  BoardRationaleConsistency,
  BoardRationaleConsistencySummary,
  BoardRationaleKind,
  BoardRationaleSource,
  BoardRationaleSummary,
  BoardReadMeta,
  BoardVerificationSyncResult,
  ProjectTaskStatus,
  ProjectVerificationStatus,
  ProxyReadMeta,
  VerificationRecord,
} from "./project-board-model";

import {
  queryProjectTasks,
  queryProjectVerification,
  type ProjectTaskBoardRow,
} from "./project-board-query";
import {
  buildBoardDependencyHealthSnapshot,
  buildBoardDependencyHygieneScore,
  buildBoardPlanningClarityScore,
  buildProjectTaskDecisionPacket,
  buildProjectTaskQualityGate,
  updateProjectTaskDependencies,
} from "./project-board-governance-surface-helpers";
import {
  buildBoardTaskCreateSummary,
  buildBoardTaskUpdateSummary,
  compactTaskCompleteToolResult,
  compactVerificationAppendToolResult,
} from "./project-board-tool-formatting";

export {
  queryProjectTasks,
  queryProjectVerification,
} from "./project-board-query";

export type {
  ProjectTaskBoardRow,
  ProjectTaskProxyRow,
  ProjectTaskQueryResult,
  ProjectVerificationBoardRow,
  ProjectVerificationProxyRow,
  ProjectVerificationQueryResult,
} from "./project-board-query";

export {
  buildBoardDependencyHealthSnapshot,
  buildBoardDependencyHygieneScore,
  buildBoardPlanningClarityScore,
  buildProjectTaskDecisionPacket,
  buildProjectTaskQualityGate,
  updateProjectTaskDependencies,
} from "./project-board-governance-surface-helpers";

export type {
  BoardDependencyHealthRecommendationCode,
  BoardDependencyHealthSnapshotResult,
  BoardDependencyHealthSnapshotRow,
  BoardDependencyHygieneRecommendationCode,
  BoardDependencyHygieneScoreResult,
  BoardPlanningClarityScoreResult,
  ProjectTaskDecisionPacket,
  ProjectTaskDependencyUpdateResult,
  ProjectTaskQualityGateResult,
} from "./project-board-governance-surface-helpers";

import {
  appendProjectVerificationBoard,
  completeProjectTaskBoardWithVerification,
  createProjectTaskBoard,
  updateProjectTaskBoard,
} from "./project-board-mutations";
export {
  appendProjectVerificationBoard,
  completeProjectTaskBoardWithVerification,
  createProjectTaskBoard,
  updateProjectTaskBoard,
} from "./project-board-mutations";
export type { ProjectTaskCreateResult, ProjectTaskUpdateResult } from "./project-board-mutations";

export default function projectBoardSurfaceExtension(pi: ExtensionAPI) {
  const queryParameters = Type.Object({
    entity: Type.Union([Type.Literal("tasks"), Type.Literal("verification")]),
    status: Type.Optional(Type.String({ description: "Filter by status." })),
    target: Type.Optional(
      Type.String({
        description: "Verification target filter (only for entity=verification).",
      }),
    ),
    search: Type.Optional(Type.String({ description: "Case-insensitive text search." })),
    milestone: Type.Optional(Type.String({ description: "Filter by milestone label (user-defined semantic)." })),
    needs_rationale: Type.Optional(
      Type.Boolean({
        description: "When true, return only rationale-sensitive rows still missing rationale evidence.",
      }),
    ),
    rationale_required: Type.Optional(
      Type.Boolean({
        description: "Filter by rationale sensitivity (true=sensitive, false=non-sensitive).",
      }),
    ),
    rationale_consistency: Type.Optional(
      Type.Union([
        Type.Literal("consistent"),
        Type.Literal("mismatch"),
        Type.Literal("single-source"),
        Type.Literal("none"),
      ]),
    ),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 200,
        description: "Max rows to return (default=20, cap=200).",
      }),
    ),
  });

  const executeQuery = (
    _toolCallId: string,
    params: {
      entity?: "tasks" | "verification";
      status?: string;
      target?: string;
      search?: string;
      milestone?: string;
      needs_rationale?: boolean;
      rationale_required?: boolean;
      rationale_consistency?: BoardRationaleConsistency;
      limit?: number;
    },
    _signal: AbortSignal,
    _onUpdate: (update: unknown) => void,
    ctx: { cwd: string },
  ) => {
    const entity = params?.entity;
    if (entity !== "tasks" && entity !== "verification") {
      const out = {
        ok: false,
        reason: "missing-or-invalid-entity",
        allowed: ["tasks", "verification"],
      };
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        details: out,
      };
    }

    const status = typeof params?.status === "string" ? params.status : undefined;
    const target = typeof params?.target === "string" ? params.target : undefined;
    const search = typeof params?.search === "string" ? params.search : undefined;
    const milestone = typeof params?.milestone === "string" ? params.milestone : undefined;
    const needsRationale = params?.needs_rationale === true;
    const rationaleRequired = typeof params?.rationale_required === "boolean"
      ? params.rationale_required
      : undefined;
    const rationaleConsistency = params?.rationale_consistency;
    const limit = params?.limit;
    const cwd = ctx.cwd;

    const details =
      entity === "tasks"
        ? queryProjectTasks(cwd, { status, search, milestone, needsRationale, rationaleRequired, rationaleConsistency, limit })
        : queryProjectVerification(cwd, { target, status, search, milestone, needsRationale, rationaleRequired, rationaleConsistency, limit });
    return {
      content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
      details,
    };
  };

  pi.registerTool({
    name: "board_query",
    label: "Board Query",
    description:
      "Query .project/tasks and .project/verification through a bounded board surface with cache-aware metadata.",
    parameters: queryParameters,
    execute: executeQuery,
  });

  const taskCreateParameters = Type.Object({
    id: Type.String({ minLength: 1, description: "Task id to create." }),
    description: Type.String({ minLength: 1, description: "Task description." }),
    status: Type.Optional(Type.Union(PROJECT_TASK_STATUSES.map((s) => Type.Literal(s)))),
    priority: Type.Optional(Type.String({ description: "Optional priority label, e.g. p1/p2." })),
    depends_on: Type.Optional(Type.Array(Type.String(), { description: "Optional dependencies." })),
    files: Type.Optional(Type.Array(Type.String(), { description: "Optional related files." })),
    acceptance_criteria: Type.Optional(Type.Array(Type.String(), { description: "Optional bounded acceptance criteria." })),
    milestone: Type.Optional(Type.String({ description: "Optional milestone label." })),
    note: Type.Optional(Type.String({ description: "Optional initial note." })),
    provenance_origin: Type.Optional(Type.String({ description: "Optional provenance origin: brainstorm | human | tangent-approved." })),
    source_task_id: Type.Optional(Type.String({ description: "Optional source task id for emergent/tangent work." })),
    source_reason: Type.Optional(Type.String({ description: "Optional bounded reason describing why emergent work was created." })),
  });

  const executeTaskCreate = (
    _toolCallId: string,
    params: {
      id?: string;
      description?: string;
      status?: ProjectTaskStatus;
      priority?: string;
      depends_on?: string[];
      files?: string[];
      acceptance_criteria?: string[];
      milestone?: string;
      note?: string;
      provenance_origin?: string;
      source_task_id?: string;
      source_reason?: string;
    },
    _signal: AbortSignal,
    _onUpdate: (update: unknown) => void,
    ctx: { cwd: string },
  ) => {
    const details = createProjectTaskBoard(ctx.cwd, {
      id: params?.id,
      description: params?.description,
      status: params?.status,
      priority: params?.priority,
      dependsOn: params?.depends_on,
      files: params?.files,
      acceptanceCriteria: params?.acceptance_criteria,
      milestone: params?.milestone,
      note: params?.note,
      provenanceOrigin: params?.provenance_origin as BoardTaskProvenanceOrigin | undefined,
      sourceTaskId: params?.source_task_id,
      sourceReason: params?.source_reason,
    });
    return {
      content: [{ type: "text", text: details.summary ?? JSON.stringify(details, null, 2) }],
      details,
    };
  };

  pi.registerTool({
    name: "board_task_create",
    label: "Board Task Create",
    description:
      "Create one .project/tasks entry through a constrained board surface with duplicate protection and bounded fields.",
    parameters: taskCreateParameters,
    execute: executeTaskCreate,
  });

  const decisionPacketParameters = Type.Object({
    task_id: Type.String({ minLength: 1, description: "Task id to summarize for a no-auto-close human decision packet." }),
  });

  const executeDecisionPacket = (
    _toolCallId: string,
    params: { task_id?: string },
    _signal: AbortSignal,
    _onUpdate: (update: unknown) => void,
    ctx: { cwd: string },
  ) => {
    const details = buildProjectTaskDecisionPacket(ctx.cwd, String(params?.task_id ?? ""));
    return {
      content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
      details,
    };
  };

  pi.registerTool({
    name: "board_decision_packet",
    label: "Board Decision Packet",
    description:
      "Build a compact no-auto-close decision packet (close/keep-open/defer) with recent verification evidence and blockers for one task.",
    parameters: decisionPacketParameters,
    execute: executeDecisionPacket,
  });

  const dependencyParameters = Type.Object({
    task_id: Type.String({ minLength: 1, description: "Task id to update/analyze." }),
    add_depends_on: Type.Optional(Type.Array(Type.String(), { description: "Dependencies to append to the existing depends_on list." })),
    replace_depends_on: Type.Optional(Type.Array(Type.String(), { description: "Full replacement depends_on list. Use only when intentionally reconciling." })),
    dry_run: Type.Optional(Type.Boolean({ description: "Preview only by default; set false to apply." })),
  });

  const executeDependencies = (
    _toolCallId: string,
    params: {
      task_id?: string;
      add_depends_on?: string[];
      replace_depends_on?: string[];
      dry_run?: boolean;
    },
    _signal: AbortSignal,
    _onUpdate: (update: unknown) => void,
    ctx: { cwd: string },
  ) => {
    const details = updateProjectTaskDependencies(ctx.cwd, {
      taskId: params?.task_id,
      addDependsOn: params?.add_depends_on,
      replaceDependsOn: params?.replace_depends_on,
      dryRun: params?.dry_run,
    });
    return {
      content: [{ type: "text", text: details.summary }],
      details,
    };
  };

  pi.registerTool({
    name: "board_task_dependencies",
    label: "Board Task Dependencies",
    description:
      "Dry-first bounded dependency update for existing .project/tasks entries with missing/cycle/protected-coupling blockers.",
    parameters: dependencyParameters,
    execute: executeDependencies,
  });

  const qualityGateParameters = Type.Object({
    task_id: Type.String({ minLength: 1, description: "Task id to inspect before close/decomposition decisions." }),
  });

  const executeQualityGate = (
    _toolCallId: string,
    params: { task_id?: string },
    _signal: AbortSignal,
    _onUpdate: (update: unknown) => void,
    ctx: { cwd: string },
  ) => {
    const details = buildProjectTaskQualityGate(ctx.cwd, String(params?.task_id ?? ""));
    return {
      content: [{ type: "text", text: details.summary }],
      details,
    };
  };

  pi.registerTool({
    name: "board_task_quality_gate",
    label: "Board Task Quality Gate",
    description:
      "Read-only gate for loose/simplistic tickets, implicit dependencies, and verification traceability before task closure.",
    parameters: qualityGateParameters,
    execute: executeQualityGate,
  });

  const planningScoreParameters = Type.Object({
    milestone: Type.Optional(Type.String({ description: "Optional milestone filter for score calculation." })),
  });

  const executePlanningScore = (
    _toolCallId: string,
    params: { milestone?: string },
    _signal: AbortSignal,
    _onUpdate: (update: unknown) => void,
    ctx: { cwd: string },
  ) => {
    const details = buildBoardPlanningClarityScore(ctx.cwd, { milestone: params?.milestone });
    return {
      content: [{ type: "text", text: details.summary }],
      details,
    };
  };

  pi.registerTool({
    name: "board_planning_clarity_score",
    label: "Board Planning Clarity Score",
    description:
      "Report-only planning clarity/direction score for open tasks (decomposition, verification linkage, focus, rationale coverage).",
    parameters: planningScoreParameters,
    execute: executePlanningScore,
  });

  const dependencyHealthSnapshotParameters = Type.Object({
    milestone: Type.Optional(Type.String({ description: "Optional milestone filter for dependency health sampling." })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, description: "Max affected rows in output (default=20)." })),
  });

  const executeDependencyHealthSnapshot = (
    _toolCallId: string,
    params: { milestone?: string; limit?: number },
    _signal: AbortSignal,
    _onUpdate: (update: unknown) => void,
    ctx: { cwd: string },
  ) => {
    const details = buildBoardDependencyHealthSnapshot(ctx.cwd, {
      milestone: params?.milestone,
      limit: params?.limit,
    });
    return {
      content: [{ type: "text", text: details.summary }],
      details,
    };
  };

  pi.registerTool({
    name: "board_dependency_health_snapshot",
    label: "Board Dependency Health Snapshot",
    description:
      "Report-only dependency health snapshot (missing/cycle/protected-coupling) with optional milestone filter.",
    parameters: dependencyHealthSnapshotParameters,
    execute: executeDependencyHealthSnapshot,
  });

  const dependencyHygieneScoreParameters = Type.Object({
    milestone: Type.Optional(Type.String({ description: "Optional milestone filter for dependency hygiene score." })),
  });

  const executeDependencyHygieneScore = (
    _toolCallId: string,
    params: { milestone?: string },
    _signal: AbortSignal,
    _onUpdate: (update: unknown) => void,
    ctx: { cwd: string },
  ) => {
    const details = buildBoardDependencyHygieneScore(ctx.cwd, {
      milestone: params?.milestone,
    });
    return {
      content: [{ type: "text", text: details.summary }],
      details,
    };
  };

  pi.registerTool({
    name: "board_dependency_hygiene_score",
    label: "Board Dependency Hygiene Score",
    description:
      "Report-only dependency hygiene score with coupling/consistency/traceability dimensions.",
    parameters: dependencyHygieneScoreParameters,
    execute: executeDependencyHygieneScore,
  });

  const verificationAppendParameters = Type.Object({
    id: Type.String({ minLength: 1, description: "Verification id to append." }),
    target: Type.String({ minLength: 1, description: "Target task/id this verification belongs to." }),
    target_type: Type.Optional(Type.String({ description: "Target type (default: task)." })),
    status: Type.Union(PROJECT_VERIFICATION_STATUSES.map((s) => Type.Literal(s))),
    method: Type.String({ minLength: 1, description: "Verification method, e.g. test or inspection." }),
    evidence: Type.String({ minLength: 1, description: "Bounded evidence text." }),
    timestamp: Type.Optional(Type.String({ description: "ISO timestamp. Defaults to now." })),
    link_task: Type.Optional(Type.Boolean({ description: "When true and target_type=task, set target task verification to this id." })),
  });

  const executeVerificationAppend = (
    _toolCallId: string,
    params: {
      id?: string;
      target?: string;
      target_type?: string;
      status?: ProjectVerificationStatus;
      method?: string;
      evidence?: string;
      timestamp?: string;
      link_task?: boolean;
    },
    _signal: AbortSignal,
    _onUpdate: (update: unknown) => void,
    ctx: { cwd: string },
  ) => {
    const result = appendProjectVerificationBoard(ctx.cwd, {
      id: params?.id,
      target: params?.target,
      targetType: params?.target_type,
      status: params?.status,
      method: params?.method,
      evidence: params?.evidence,
      timestamp: params?.timestamp,
      linkTask: params?.link_task === true,
    });
    const details = compactVerificationAppendToolResult(result);
    return {
      content: [{ type: "text", text: details.summary ?? JSON.stringify(details, null, 2) }],
      details,
    };
  };

  pi.registerTool({
    name: "board_verification_append",
    label: "Board Verification Append",
    description:
      "Append one .project/verification entry through a constrained board surface, optionally linking it to a task.",
    parameters: verificationAppendParameters,
    execute: executeVerificationAppend,
  });

  const taskCompleteParameters = Type.Object({
    task_id: Type.String({ minLength: 1, description: "Task id to complete." }),
    verification_id: Type.String({ minLength: 1, description: "Verification id to append and link." }),
    method: Type.String({ minLength: 1, description: "Verification method, e.g. test or inspection." }),
    evidence: Type.String({ minLength: 1, description: "Bounded verification evidence." }),
    timestamp: Type.Optional(Type.String({ description: "ISO timestamp. Defaults to now." })),
    append_note: Type.Optional(Type.String({ description: "Optional completion note appended to the task." })),
    max_note_lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    require_rationale_on_complete: Type.Optional(Type.Boolean({ description: "Default true." })),
    require_rationale_consistency_on_complete: Type.Optional(Type.Boolean({ description: "Default true for mismatches." })),
  });

  const executeTaskComplete = (
    _toolCallId: string,
    params: {
      task_id?: string;
      verification_id?: string;
      method?: string;
      evidence?: string;
      timestamp?: string;
      append_note?: string;
      max_note_lines?: number;
      require_rationale_on_complete?: boolean;
      require_rationale_consistency_on_complete?: boolean;
    },
    _signal: AbortSignal,
    _onUpdate: (update: unknown) => void,
    ctx: { cwd: string },
  ) => {
    const result = completeProjectTaskBoardWithVerification(ctx.cwd, {
      taskId: params?.task_id,
      verificationId: params?.verification_id,
      method: params?.method,
      evidence: params?.evidence,
      timestamp: params?.timestamp,
      appendNote: params?.append_note,
      maxNoteLines: params?.max_note_lines,
      requireRationaleOnComplete: params?.require_rationale_on_complete,
      requireRationaleConsistencyOnComplete: params?.require_rationale_consistency_on_complete,
    });
    const details = compactTaskCompleteToolResult(result);
    return {
      content: [{ type: "text", text: details.summary ?? JSON.stringify(details, null, 2) }],
      details,
    };
  };

  pi.registerTool({
    name: "board_task_complete",
    label: "Board Task Complete",
    description:
      "Append passed verification, link it to a task, and mark the task completed through a constrained board surface.",
    parameters: taskCompleteParameters,
    execute: executeTaskComplete,
  });

  const updateParameters = Type.Object({
    task_id: Type.String({ minLength: 1, description: "Task id to update." }),
    status: Type.Optional(
      Type.Union(PROJECT_TASK_STATUSES.map((s) => Type.Literal(s))),
    ),
    append_note: Type.Optional(
      Type.String({
        description: "Append one note line/block to task notes.",
      }),
    ),
    max_note_lines: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 200,
        description: "Trim notes to last N lines after append (default=50, cap=200).",
      }),
    ),
    milestone: Type.Optional(
      Type.String({
        description: "Milestone label (user-defined semantic). Empty string clears milestone.",
      }),
    ),
    rationale_kind: Type.Optional(Type.Union(BOARD_RATIONALE_KINDS.map((kind) => Type.Literal(kind)))),
    rationale_text: Type.Optional(
      Type.String({
        description: "Communicable rationale recorded as task note (`[rationale:<kind>] ...`).",
      }),
    ),
    require_rationale_for_sensitive: Type.Optional(
      Type.Boolean({
        description: "When true, blocks update if a rationale-sensitive task still lacks rationale evidence after update.",
      }),
    ),
    require_rationale_consistency: Type.Optional(
      Type.Boolean({
        description: "When true, blocks update if task-note rationale kind conflicts with linked verification rationale kind.",
      }),
    ),
    require_rationale_on_complete: Type.Optional(
      Type.Boolean({
        description: "When true, blocks transition to completed for rationale-sensitive tasks still missing rationale evidence.",
      }),
    ),
    require_rationale_consistency_on_complete: Type.Optional(
      Type.Boolean({
        description: "When true, blocks transition to completed when task-note and linked verification rationale kinds diverge.",
      }),
    ),
    sync_rationale_to_verification: Type.Optional(
      Type.Boolean({
        description: "When true and rationale payload is provided, appends rationale note to linked verification evidence.",
      }),
    ),
  });

  const executeUpdate = (
    _toolCallId: string,
    params: {
      task_id?: string;
      status?: ProjectTaskStatus;
      append_note?: string;
      max_note_lines?: number;
      milestone?: string;
      rationale_kind?: BoardRationaleKind;
      rationale_text?: string;
      require_rationale_for_sensitive?: boolean;
      require_rationale_consistency?: boolean;
      require_rationale_on_complete?: boolean;
      require_rationale_consistency_on_complete?: boolean;
      sync_rationale_to_verification?: boolean;
    },
    _signal: AbortSignal,
    _onUpdate: (update: unknown) => void,
    ctx: { cwd: string },
  ) => {
    const taskId = String(params?.task_id ?? "").trim();
    const status = params?.status;
    const appendNote = typeof params?.append_note === "string" ? params.append_note : undefined;
    const maxNoteLines = params?.max_note_lines;
    const milestone = typeof params?.milestone === "string" ? params.milestone : undefined;
    const rationaleKind = typeof params?.rationale_kind === "string" ? params.rationale_kind : undefined;
    const rationaleText = typeof params?.rationale_text === "string" ? params.rationale_text : undefined;
    const requireRationaleForSensitive = params?.require_rationale_for_sensitive === true;
    const requireRationaleConsistency = params?.require_rationale_consistency === true;
    const requireRationaleOnComplete = status === "completed" && params?.require_rationale_on_complete !== false;
    const requireRationaleConsistencyOnComplete = status === "completed" && params?.require_rationale_consistency_on_complete !== false;
    const syncRationaleToVerification = params?.sync_rationale_to_verification === true;

    if (!taskId) {
      const out = { ok: false, reason: "missing-task-id", summary: buildBoardTaskUpdateSummary(false, taskId, status ?? "unchanged", "missing-task-id") };
      return {
        content: [{ type: "text", text: out.summary }],
        details: out,
      };
    }

    const hasUpdate =
      (typeof status === "string" && status.length > 0) ||
      (typeof appendNote === "string" && appendNote.trim().length > 0) ||
      typeof params?.milestone === "string" ||
      Boolean(params?.rationale_kind) ||
      Boolean(params?.rationale_text) ||
      Boolean(params?.require_rationale_for_sensitive) ||
      Boolean(params?.require_rationale_consistency) ||
      Boolean(params?.require_rationale_on_complete) ||
      Boolean(params?.require_rationale_consistency_on_complete) ||
      Boolean(params?.sync_rationale_to_verification);
    if (!hasUpdate) {
      const out = { ok: false, reason: "no-updates-requested", summary: buildBoardTaskUpdateSummary(false, taskId, status ?? "unchanged", "no-updates-requested") };
      return {
        content: [{ type: "text", text: out.summary }],
        details: out,
      };
    }

    const details = updateProjectTaskBoard(ctx.cwd, taskId, {
      status,
      appendNote,
      maxNoteLines,
      milestone,
      rationaleKind,
      rationaleText,
      requireRationaleForSensitive,
      requireRationaleConsistency,
      requireRationaleOnComplete,
      requireRationaleConsistencyOnComplete,
      syncRationaleToVerification,
    });
    return {
      content: [{ type: "text", text: details.summary ?? JSON.stringify(details, null, 2) }],
      details,
    };
  };

  pi.registerTool({
    name: "board_update",
    label: "Board Update",
    description:
      "Update .project/tasks through a constrained board surface (status, milestone, notes, rationale, completion gates, optional consistency enforcement, and optional verification sync).",
    parameters: updateParameters,
    execute: executeUpdate,
  });

}

/** @deprecated use updateProjectTaskBoard */
export function updateProjectTaskProxy(
  cwd: string,
  taskId: string,
  updates: {
    status?: ProjectTaskStatus;
    appendNote?: string;
    maxNoteLines?: number;
    milestone?: string;
    rationaleKind?: BoardRationaleKind;
    rationaleText?: string;
    requireRationaleForSensitive?: boolean;
    requireRationaleConsistency?: boolean;
    requireRationaleOnComplete?: boolean;
    requireRationaleConsistencyOnComplete?: boolean;
    syncRationaleToVerification?: boolean;
  },
): ProjectTaskUpdateResult {
  return updateProjectTaskBoard(cwd, taskId, updates);
}

/** @deprecated use projectBoardSurfaceExtension */
export const projectBoardProxyExtension = projectBoardSurfaceExtension;
