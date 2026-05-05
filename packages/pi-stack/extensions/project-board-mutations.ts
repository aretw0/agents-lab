import { existsSync } from "node:fs";
import {
  appendNote as appendTaskNote,
  readProjectTasksBlock,
  writeProjectTasksBlock,
  type ProjectTaskItem,
} from "./colony-pilot-task-sync";
import {
  appendRationaleToTaskNotes,
  appendRationaleToVerificationEvidence,
  buildTaskProvenanceNote,
  buildTaskRationaleNote,
  hasTaskRationale,
  invalidateProjectBlockCaches,
  isRationaleSensitiveTask,
  normalizeBoundedText,
  normalizeMilestoneLabel,
  normalizeRationaleKind,
  normalizeRationaleText,
  normalizeStringArray,
  normalizeTaskProvenanceOrigin,
  PROJECT_TASK_STATUSES,
  readVerificationBlockCached,
  resolveTaskRationaleConsistency,
  resolveTaskRationaleKind,
  resolveTaskRationaleSource,
  shortText,
  tasksPath,
  writeVerificationBlock,
  type BoardRationaleKind,
  type BoardTaskProvenanceOrigin,
  type BoardVerificationSyncResult,
  type ProjectTaskStatus,
  type TaskRecord,
} from "./project-board-model";
import { taskDependsOnProtectedScope } from "./project-board-governance-helpers";
import {
  appendProjectVerificationBoard as appendProjectVerificationBoardImpl,
  completeProjectTaskBoardWithVerification as completeProjectTaskBoardWithVerificationImpl,
  type ProjectTaskCompleteWithVerificationResult,
} from "./project-board-completion";
import { queryProjectTasks, type ProjectTaskBoardRow } from "./project-board-query";
import { buildBoardTaskCreateSummary, buildBoardTaskUpdateSummary } from "./project-board-tool-formatting";

export interface ProjectTaskUpdateResult {
  ok: boolean;
  reason?: string;
  summary?: string;
  task?: ProjectTaskBoardRow;
  verificationSync?: BoardVerificationSyncResult;
}

export function updateProjectTaskBoard(
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
  const id = String(taskId ?? "").trim();
  const requestedStatus = typeof updates.status === "string" && updates.status.length > 0 ? updates.status : "unchanged";
  const fail = (reason: string): ProjectTaskUpdateResult => ({
    ok: false,
    reason,
    summary: buildBoardTaskUpdateSummary(false, id, requestedStatus, reason),
  });
  if (!id) return fail("missing-task-id");

  const p = tasksPath(cwd);
  if (!existsSync(p)) return fail("tasks-block-missing");

  const block = readProjectTasksBlock(cwd);
  const idx = block.tasks.findIndex((row) => row?.id === id);
  if (idx < 0) return fail("task-not-found");

  const current = block.tasks[idx]!;
  const next = { ...current };

  if (updates.status) {
    next.status = updates.status;
  }

  if (typeof updates.milestone === "string") {
    const nextMilestone = normalizeMilestoneLabel(updates.milestone);
    if (nextMilestone === undefined) return fail("invalid-milestone");
    if (nextMilestone.length <= 0) delete (next as { milestone?: string }).milestone;
    else (next as { milestone?: string }).milestone = nextMilestone;
  }

  const maxLinesRaw = Number(updates.maxNoteLines);
  const maxLines =
    Number.isFinite(maxLinesRaw) && maxLinesRaw > 0
      ? Math.max(1, Math.min(200, Math.floor(maxLinesRaw)))
      : 50;

  if (typeof updates.appendNote === "string" && updates.appendNote.trim().length > 0) {
    const note = updates.appendNote.trim();
    next.notes = appendTaskNote(next.notes, note, maxLines);
  }

  const hasRationaleKind = typeof updates.rationaleKind === "string" && updates.rationaleKind.trim().length > 0;
  const hasRationaleTextInput = typeof updates.rationaleText === "string" && updates.rationaleText.trim().length > 0;
  if (updates.syncRationaleToVerification === true && (!hasRationaleKind || !hasRationaleTextInput)) {
    return fail("sync-requires-rationale-payload");
  }
  if (hasRationaleKind !== hasRationaleTextInput) {
    return fail(hasRationaleKind ? "missing-rationale-text" : "missing-rationale-kind");
  }

  let rationaleNoteForSync: string | undefined;
  if (hasRationaleKind && hasRationaleTextInput) {
    const kind = normalizeRationaleKind(updates.rationaleKind);
    const rationaleText = normalizeRationaleText(updates.rationaleText);
    if (!kind) return fail("invalid-rationale-kind");
    if (!rationaleText) return fail("invalid-rationale-text");
    rationaleNoteForSync = buildTaskRationaleNote(kind, rationaleText);
    const mergedNote = appendRationaleToTaskNotes(next.notes, rationaleNoteForSync, maxLines);
    next.notes = mergedNote.next;
  }

  const verificationRead = readVerificationBlockCached(cwd).block;
  const verificationMap = new Map(verificationRead.verifications.map((row) => [row.id, row] as const));
  const rationaleRequired = isRationaleSensitiveTask(next as TaskRecord);

  let verificationSync: BoardVerificationSyncResult = {
    requested: updates.syncRationaleToVerification === true,
    status: "skipped",
  };
  if (updates.syncRationaleToVerification === true && rationaleNoteForSync) {
    const verificationId = typeof next.verification === "string" ? next.verification.trim() : "";
    if (!verificationId) {
      verificationSync = { requested: true, status: "missing-task-verification" };
    } else {
      const verificationIndex = verificationRead.verifications.findIndex((row) => row.id === verificationId);
      if (verificationIndex < 0) {
        verificationSync = { requested: true, status: "not-found", verificationId };
      } else {
        const currentEvidence = verificationRead.verifications[verificationIndex]?.evidence;
        const merged = appendRationaleToVerificationEvidence(currentEvidence, rationaleNoteForSync);
        verificationRead.verifications[verificationIndex] = {
          ...verificationRead.verifications[verificationIndex],
          evidence: merged.next,
        };
        verificationMap.set(verificationId, verificationRead.verifications[verificationIndex]!);
        verificationSync = {
          requested: true,
          status: merged.changed ? "updated" : "already-present",
          verificationId,
        };
      }
    }
  }

  const hasRationale = hasTaskRationale(next as TaskRecord, verificationMap);
  const rationaleConsistency = resolveTaskRationaleConsistency(next as TaskRecord, verificationMap);
  const completingTask = next.status === "completed";
  if (updates.requireRationaleOnComplete === true && completingTask && rationaleRequired && !hasRationale) {
    return fail("rationale-required-to-complete-sensitive-task");
  }
  if (updates.requireRationaleConsistencyOnComplete === true && completingTask && rationaleConsistency === "mismatch") {
    return fail("rationale-consistency-required-to-complete-task");
  }
  if (updates.requireRationaleForSensitive === true && rationaleRequired && !hasRationale) {
    return fail("rationale-required-for-sensitive-task");
  }
  if (updates.requireRationaleConsistency === true && rationaleConsistency === "mismatch") {
    return fail("rationale-consistency-mismatch");
  }

  block.tasks[idx] = next;
  writeProjectTasksBlock(cwd, block);
  if (verificationSync.status === "updated") {
    writeVerificationBlock(cwd, verificationRead);
  }
  invalidateProjectBlockCaches(cwd);

  const task: ProjectTaskBoardRow = {
    id: next.id,
    status: next.status,
    description: shortText(next.description, 180) ?? next.description,
    milestone: next.milestone,
    verification: next.verification,
    dependsOnCount: Array.isArray(next.depends_on) ? next.depends_on.length : 0,
    rationaleRequired,
    hasRationale,
    rationaleKind: resolveTaskRationaleKind(next as TaskRecord, verificationMap),
    rationaleSource: resolveTaskRationaleSource(next as TaskRecord, verificationMap),
    rationaleConsistency,
  };
  return {
    ok: true,
    summary: buildBoardTaskUpdateSummary(true, id, task.status),
    task,
    verificationSync,
  };
}

export interface ProjectTaskCreateResult {
  ok: boolean;
  reason?: string;
  summary?: string;
  task?: ProjectTaskBoardRow;
}

export function createProjectTaskBoard(
  cwd: string,
  input: {
    id?: string;
    description?: string;
    status?: ProjectTaskStatus;
    priority?: string;
    dependsOn?: string[];
    files?: string[];
    acceptanceCriteria?: string[];
    milestone?: string;
    note?: string;
    provenanceOrigin?: BoardTaskProvenanceOrigin;
    sourceTaskId?: string;
    sourceReason?: string;
  },
): ProjectTaskCreateResult {
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const description = normalizeBoundedText(input.description, 500);
  const status = PROJECT_TASK_STATUSES.includes(input.status as ProjectTaskStatus)
    ? input.status as ProjectTaskStatus
    : "planned";
  const priority = normalizeBoundedText(input.priority, 40);
  const dependsOn = normalizeStringArray(input.dependsOn, 20, 120);
  const files = normalizeStringArray(input.files, 50, 240);
  const acceptanceCriteria = normalizeStringArray(input.acceptanceCriteria, 20, 300);
  const milestone = normalizeMilestoneLabel(input.milestone);
  const note = normalizeBoundedText(input.note, 1000);
  const provenanceOrigin = normalizeTaskProvenanceOrigin(input.provenanceOrigin);
  const provenanceNote = provenanceOrigin
    ? buildTaskProvenanceNote({
      origin: provenanceOrigin,
      sourceTaskId: input.sourceTaskId,
      sourceReason: input.sourceReason,
    })
    : undefined;

  if (!id) return { ok: false, reason: "missing-task-id", summary: buildBoardTaskCreateSummary(false, id, status, "missing-task-id") };
  if (!description) return { ok: false, reason: "missing-task-description", summary: buildBoardTaskCreateSummary(false, id, status, "missing-task-description") };
  if (typeof input.status === "string" && !PROJECT_TASK_STATUSES.includes(input.status as ProjectTaskStatus)) {
    return { ok: false, reason: "invalid-task-status", summary: buildBoardTaskCreateSummary(false, id, status, "invalid-task-status") };
  }

  const block = readProjectTasksBlock(cwd);
  if (block.tasks.some((row) => row?.id === id)) return { ok: false, reason: "task-already-exists", summary: buildBoardTaskCreateSummary(false, id, status, "task-already-exists") };

  const tasksById = new Map(block.tasks.map((row) => [String(row.id), row as TaskRecord] as const));
  const localCandidate: TaskRecord = {
    id,
    description,
    status,
    notes: note,
    milestone,
    files,
    depends_on: dependsOn,
    acceptance_criteria: acceptanceCriteria,
  };
  const protectedDependencyIds = taskDependsOnProtectedScope(localCandidate, dependsOn ?? [], tasksById);
  if (protectedDependencyIds.length > 0) {
    return {
      ok: false,
      reason: "local-safe-depends-on-protected",
      summary: buildBoardTaskCreateSummary(false, id, status, "local-safe-depends-on-protected"),
    };
  }

  const task: ProjectTaskItem & { priority?: string } = {
    id,
    description,
    status,
  };
  if (priority) task.priority = priority;
  if (dependsOn) task.depends_on = dependsOn;
  if (files) task.files = files;
  if (acceptanceCriteria) task.acceptance_criteria = acceptanceCriteria;
  if (milestone && milestone.length > 0) task.milestone = milestone;
  if (note) task.notes = appendTaskNote(undefined, note, 50);
  if (provenanceNote) task.notes = appendTaskNote(task.notes, provenanceNote, 50);

  block.tasks.push(task);
  writeProjectTasksBlock(cwd, block);
  invalidateProjectBlockCaches(cwd);

  const row = queryProjectTasks(cwd, { search: id, limit: 200 }).rows.find((item) => item.id === id);
  return {
    ok: true,
    summary: buildBoardTaskCreateSummary(true, id, status),
    task: row,
  };
}

export const appendProjectVerificationBoard = appendProjectVerificationBoardImpl;

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
): ProjectTaskCompleteWithVerificationResult {
  return completeProjectTaskBoardWithVerificationImpl(cwd, input, {
    updateProjectTaskBoard,
  });
}
