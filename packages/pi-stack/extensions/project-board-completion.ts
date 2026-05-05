import {
  readProjectTasksBlock,
  writeProjectTasksBlock,
} from "./colony-pilot-task-sync";
import {
  extractRationaleKindFromText,
  hasRationaleText,
  invalidateProjectBlockCaches,
  isRationaleSensitiveTask,
  PROJECT_VERIFICATION_STATUSES,
  readVerificationBlockForAppend,
  resolveTaskNoteRationaleKind,
  writeVerificationBlock,
  type BoardRationaleKind,
  type BoardVerificationSyncResult,
  type ProjectTaskStatus,
  type ProjectVerificationStatus,
  type TaskRecord,
  type VerificationRecord,
} from "./project-board-model";
import {
  tryAutoAdvanceBoardHandoffFocus,
  type BoardFocusAutoAdvanceResult,
} from "./project-board-auto-advance";
import {
  queryProjectTasks,
  type ProjectTaskBoardRow,
} from "./project-board-query";
import {
  buildBoardTaskCompleteSummary,
  buildBoardVerificationAppendSummary,
  normalizeVerificationEvidence,
} from "./project-board-tool-formatting";

export interface ProjectVerificationAppendResult {
  ok: boolean;
  reason?: string;
  summary?: string;
  verification?: VerificationRecord;
  task?: ProjectTaskBoardRow;
}

export interface ProjectTaskBoardUpdateForCompletionResult {
  ok: boolean;
  reason?: string;
  summary?: string;
  task?: ProjectTaskBoardRow;
  verificationSync?: BoardVerificationSyncResult;
}

export type UpdateProjectTaskBoardForCompletion = (
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
) => ProjectTaskBoardUpdateForCompletionResult;

export interface ProjectTaskCompleteWithVerificationResult {
  ok: boolean;
  reason?: string;
  summary?: string;
  verificationAppend?: ProjectVerificationAppendResult;
  update?: ProjectTaskBoardUpdateForCompletionResult;
  verification?: VerificationRecord;
  task?: ProjectTaskBoardRow;
  focusAutoAdvance?: BoardFocusAutoAdvanceResult;
}

export function appendProjectVerificationBoard(
  cwd: string,
  input: {
    id?: string;
    target?: string;
    targetType?: string;
    status?: ProjectVerificationStatus;
    method?: string;
    evidence?: string;
    timestamp?: string;
    linkTask?: boolean;
  },
): ProjectVerificationAppendResult {
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const target = typeof input.target === "string" ? input.target.trim() : "";
  const targetType = typeof input.targetType === "string" && input.targetType.trim().length > 0
    ? input.targetType.trim()
    : "task";
  const status = PROJECT_VERIFICATION_STATUSES.includes(input.status as ProjectVerificationStatus)
    ? input.status as ProjectVerificationStatus
    : undefined;
  const method = typeof input.method === "string" ? input.method.trim() : "";
  const evidence = normalizeVerificationEvidence(input.evidence);
  const timestamp = typeof input.timestamp === "string" && input.timestamp.trim().length > 0
    ? input.timestamp.trim()
    : new Date().toISOString();

  if (!id) return { ok: false, reason: "missing-verification-id", summary: buildBoardVerificationAppendSummary(false, id, target, false, "missing-verification-id") };
  if (!target) return { ok: false, reason: "missing-verification-target", summary: buildBoardVerificationAppendSummary(false, id, target, false, "missing-verification-target") };
  if (!status) return { ok: false, reason: "invalid-verification-status", summary: buildBoardVerificationAppendSummary(false, id, target, false, "invalid-verification-status") };
  if (!method) return { ok: false, reason: "missing-verification-method", summary: buildBoardVerificationAppendSummary(false, id, target, false, "missing-verification-method") };
  if (!evidence) return { ok: false, reason: "missing-verification-evidence", summary: buildBoardVerificationAppendSummary(false, id, target, false, "missing-verification-evidence") };

  const verificationRead = readVerificationBlockForAppend(cwd);
  if (verificationRead.verifications.some((row) => row.id === id)) {
    return { ok: false, reason: "verification-already-exists", summary: buildBoardVerificationAppendSummary(false, id, target, false, "verification-already-exists") };
  }

  let linkedTask: ProjectTaskBoardRow | undefined;
  if (input.linkTask === true) {
    if (targetType !== "task") return { ok: false, reason: "link-task-requires-task-target-type", summary: buildBoardVerificationAppendSummary(false, id, target, false, "link-task-requires-task-target-type") };
    const taskBlock = readProjectTasksBlock(cwd);
    const taskIndex = taskBlock.tasks.findIndex((row) => row?.id === target);
    if (taskIndex < 0) return { ok: false, reason: "task-target-not-found", summary: buildBoardVerificationAppendSummary(false, id, target, false, "task-target-not-found") };
    taskBlock.tasks[taskIndex] = {
      ...taskBlock.tasks[taskIndex],
      verification: id,
    };
    writeProjectTasksBlock(cwd, taskBlock);
    invalidateProjectBlockCaches(cwd);
    linkedTask = queryProjectTasks(cwd, { search: target, limit: 200 }).rows.find((row) => row.id === target);
  }

  const verification: VerificationRecord = {
    id,
    target,
    target_type: targetType,
    status,
    method,
    timestamp,
    evidence,
  };
  verificationRead.verifications.push(verification);
  writeVerificationBlock(cwd, verificationRead);
  invalidateProjectBlockCaches(cwd);

  return {
    ok: true,
    summary: buildBoardVerificationAppendSummary(true, id, target, Boolean(linkedTask)),
    verification,
    task: linkedTask,
  };
}

export function completeProjectTaskBoardWithVerification(
  cwd: string,
  input: {
    taskId?: string;
    verificationId?: string;
    method?: string;
    evidence?: string;
    timestamp?: string;
    appendNote?: string;
    maxNoteLines?: number;
    requireRationaleOnComplete?: boolean;
    requireRationaleConsistencyOnComplete?: boolean;
  },
  deps: {
    updateProjectTaskBoard: UpdateProjectTaskBoardForCompletion;
  },
): ProjectTaskCompleteWithVerificationResult {
  const taskId = typeof input.taskId === "string" ? input.taskId.trim() : "";
  const verificationId = typeof input.verificationId === "string" ? input.verificationId.trim() : "";
  const method = typeof input.method === "string" ? input.method.trim() : "";
  const evidence = normalizeVerificationEvidence(input.evidence);
  const requireRationaleOnComplete = input.requireRationaleOnComplete !== false;
  const requireRationaleConsistencyOnComplete = input.requireRationaleConsistencyOnComplete !== false;

  if (!taskId) return { ok: false, reason: "missing-task-id", summary: buildBoardTaskCompleteSummary(false, taskId, verificationId, "blocked", "missing-task-id") };
  if (!verificationId) return { ok: false, reason: "missing-verification-id", summary: buildBoardTaskCompleteSummary(false, taskId, verificationId, "blocked", "missing-verification-id") };
  if (!method) return { ok: false, reason: "missing-verification-method", summary: buildBoardTaskCompleteSummary(false, taskId, verificationId, "blocked", "missing-verification-method") };
  if (!evidence) return { ok: false, reason: "missing-verification-evidence", summary: buildBoardTaskCompleteSummary(false, taskId, verificationId, "blocked", "missing-verification-evidence") };

  const taskBlock = readProjectTasksBlock(cwd);
  const currentTask = taskBlock.tasks.find((row) => row?.id === taskId) as TaskRecord | undefined;
  if (!currentTask) return { ok: false, reason: "task-not-found", summary: buildBoardTaskCompleteSummary(false, taskId, verificationId, "blocked", "task-not-found") };

  const verificationRead = readVerificationBlockForAppend(cwd);
  if (verificationRead.verifications.some((row) => row.id === verificationId)) {
    return { ok: false, reason: "verification-already-exists", summary: buildBoardTaskCompleteSummary(false, taskId, verificationId, "blocked", "verification-already-exists") };
  }

  const evidenceRationaleKind = extractRationaleKindFromText(evidence);
  const taskRationaleKind = resolveTaskNoteRationaleKind(currentTask);
  const rationaleRequired = isRationaleSensitiveTask(currentTask);
  if (requireRationaleOnComplete && rationaleRequired && !hasRationaleText(currentTask.notes) && !hasRationaleText(evidence)) {
    return { ok: false, reason: "rationale-required-to-complete-sensitive-task", summary: buildBoardTaskCompleteSummary(false, taskId, verificationId, "blocked", "rationale-required-to-complete-sensitive-task") };
  }
  if (
    requireRationaleConsistencyOnComplete
    && taskRationaleKind
    && evidenceRationaleKind
    && taskRationaleKind !== evidenceRationaleKind
  ) {
    return { ok: false, reason: "rationale-consistency-required-to-complete-task", summary: buildBoardTaskCompleteSummary(false, taskId, verificationId, "blocked", "rationale-consistency-required-to-complete-task") };
  }

  const verificationAppend = appendProjectVerificationBoard(cwd, {
    id: verificationId,
    target: taskId,
    targetType: "task",
    status: "passed",
    method,
    evidence,
    timestamp: input.timestamp,
    linkTask: true,
  });
  if (!verificationAppend.ok) {
    const reason = verificationAppend.reason ?? "verification-append-failed";
    return { ok: false, reason, summary: buildBoardTaskCompleteSummary(false, taskId, verificationId, "blocked", reason), verificationAppend };
  }

  const update = deps.updateProjectTaskBoard(cwd, taskId, {
    status: "completed",
    appendNote: input.appendNote,
    maxNoteLines: input.maxNoteLines,
    requireRationaleOnComplete,
    requireRationaleConsistencyOnComplete,
  });
  if (!update.ok) {
    const reason = update.reason ?? "task-update-failed";
    return { ok: false, reason, summary: buildBoardTaskCompleteSummary(false, taskId, verificationId, "blocked", reason), verificationAppend, update };
  }

  const completedTask = readProjectTasksBlock(cwd).tasks.find((row) => row?.id === taskId);
  const focusAutoAdvance = completedTask
    ? tryAutoAdvanceBoardHandoffFocus(cwd, completedTask)
    : {
        applied: false,
        reason: "task-not-found" as const,
        previousFocusTaskIds: [],
        nextFocusTaskIds: [],
        candidateTaskIds: [],
      };

  return {
    ok: true,
    summary: buildBoardTaskCompleteSummary(true, taskId, verificationId, "completed"),
    verificationAppend,
    update,
    verification: verificationAppend.verification,
    task: update.task,
    focusAutoAdvance,
  };
}
