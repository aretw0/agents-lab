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
  extractRationaleKindFromText,
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
  readVerificationBlockForAppend,
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
import {
  tryAutoAdvanceBoardHandoffFocus,
  type BoardFocusAutoAdvanceResult,
} from "./project-board-auto-advance";

export type { BoardFocusAutoAdvanceResult } from "./project-board-auto-advance";
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
  buildBoardTaskCompleteSummary,
  buildBoardTaskCreateSummary,
  buildBoardTaskUpdateSummary,
  buildBoardVerificationAppendSummary,
  compactTaskCompleteToolResult,
  compactVerificationAppendToolResult,
  normalizeVerificationEvidence,
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

export function buildProjectTaskDecisionPacket(cwd: string, taskIdInput: string): ProjectTaskDecisionPacket {
  const taskId = String(taskIdInput ?? "").trim();
  if (!taskId) {
    return {
      ok: false,
      reason: "missing-task-id",
      taskId,
      noAutoClose: true,
      readyForHumanDecision: false,
      recommendedDecision: "defer",
      options: ["close", "keep-open", "defer"],
      evidence: [],
      blockers: ["missing-task-id"],
      risks: ["cannot-build-decision-packet-without-task-id"],
      summary: "decision-packet: missing task id; defer and provide a concrete task id.",
    };
  }

  const tasks = readTasksBlockCached(cwd).block.tasks;
  const verifications = readVerificationBlockCached(cwd).block.verifications;
  const verificationsById = new Map(verifications.map((row) => [row.id, row] as const));
  const task = tasks.find((row) => row.id === taskId);
  if (!task) {
    return {
      ok: false,
      reason: "task-not-found",
      taskId,
      noAutoClose: true,
      readyForHumanDecision: false,
      recommendedDecision: "defer",
      options: ["close", "keep-open", "defer"],
      evidence: [],
      blockers: ["task-not-found"],
      risks: ["cannot-decide-missing-task"],
      summary: `decision-packet: ${taskId} not found; defer until the canonical board contains the task.`,
    };
  }

  const linkedVerificationId = typeof task.verification === "string" ? task.verification.trim() : "";
  const linkedVerification = linkedVerificationId ? verificationsById.get(linkedVerificationId) : undefined;
  const targetVerifications = verifications
    .filter((row) => row.target === taskId)
    .sort((a, b) => String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? "")));
  const evidenceRows = [linkedVerification, ...targetVerifications]
    .filter((row): row is VerificationRecord => Boolean(row))
    .filter((row, index, arr) => arr.findIndex((candidate) => candidate.id === row.id) === index)
    .slice(0, 3);
  const hasPassedVerification = evidenceRows.some((row) => row.status === "passed");
  const blockers: string[] = [];
  if (!linkedVerificationId && evidenceRows.length === 0) blockers.push("missing-verification-evidence");
  if (linkedVerificationId && !linkedVerification) blockers.push("linked-verification-not-found");
  if (evidenceRows.length > 0 && !hasPassedVerification) blockers.push("no-passed-verification");
  if (task.status === "completed") blockers.push("task-already-completed");

  const risks: string[] = [];
  if (isRationaleSensitiveTask(task) && !hasTaskRationale(task, verificationsById)) risks.push("missing-rationale-for-sensitive-task");
  if (resolveTaskRationaleConsistency(task, verificationsById) === "mismatch") risks.push("rationale-consistency-mismatch");
  if (blockers.length === 0 && risks.length > 0) risks.push("human-review-before-close");

  const readyForHumanDecision = blockers.length === 0 && hasPassedVerification;
  const recommendedDecision = readyForHumanDecision ? "close" : "defer";
  const taskRow = queryProjectTasks(cwd, { search: taskId, limit: 1 }).rows.find((row) => row.id === taskId);
  const evidence = evidenceRows.map((row) => ({
    verificationId: row.id,
    status: row.status,
    method: row.method,
    timestamp: row.timestamp,
    evidence: shortText(row.evidence, 220),
  }));
  const summary = readyForHumanDecision
    ? `decision-packet: ${taskId} has passed verification evidence; ask human to close, keep-open, or defer.`
    : `decision-packet: ${taskId} is not ready for close; defer until blockers are resolved.`;

  return {
    ok: true,
    taskId,
    task: taskRow,
    noAutoClose: true,
    readyForHumanDecision,
    recommendedDecision,
    options: ["close", "keep-open", "defer"],
    evidence,
    blockers,
    risks,
    summary,
  };
}

export interface ProjectTaskDependencyUpdateResult {
  ok: boolean;
  applied: boolean;
  dryRun: boolean;
  reason?: string;
  taskId: string;
  before: string[];
  after: string[];
  added: string[];
  missingDependencies: string[];
  cycleDependencies: string[];
  protectedDependencyIds: string[];
  blockers: string[];
  recommendationCode: ProjectTaskDependencyRecommendationCode;
  recommendation: string;
  summary: string;
  task?: ProjectTaskBoardRow;
}

function buildBoardTaskDependencySummary(result: Pick<ProjectTaskDependencyUpdateResult, "ok" | "applied" | "dryRun" | "taskId" | "added" | "blockers" | "reason" | "recommendationCode" | "protectedDependencyIds">): string {
  return [
    "board-task-dependencies:",
    `ok=${result.ok ? "yes" : "no"}`,
    `applied=${result.applied ? "yes" : "no"}`,
    `dryRun=${result.dryRun ? "yes" : "no"}`,
    result.taskId ? `task=${result.taskId}` : undefined,
    result.added.length > 0 ? `added=${result.added.length}` : undefined,
    result.blockers.length > 0 ? `blockers=${result.blockers.join("|")}` : undefined,
    result.protectedDependencyIds.length > 0 ? `protectedDeps=${result.protectedDependencyIds.join("|")}` : undefined,
    result.reason ? `reason=${result.reason}` : undefined,
    `code=${result.recommendationCode}`,
  ].filter(Boolean).join(" ");
}

export function updateProjectTaskDependencies(
  cwd: string,
  input: {
    taskId?: string;
    addDependsOn?: string[];
    replaceDependsOn?: string[];
    dryRun?: boolean;
  },
): ProjectTaskDependencyUpdateResult {
  const taskId = typeof input.taskId === "string" ? input.taskId.trim() : "";
  const dryRun = input.dryRun !== false;
  const fail = (reason: string): ProjectTaskDependencyUpdateResult => {
    const result: ProjectTaskDependencyUpdateResult = {
      ok: false,
      applied: false,
      dryRun,
      reason,
      taskId,
      before: [],
      after: [],
      added: [],
      missingDependencies: [],
      cycleDependencies: [],
      protectedDependencyIds: [],
      blockers: [reason],
      recommendationCode: "dependency-update-invalid-input",
      recommendation: "Entrada inválida para atualização de dependências; ajuste parâmetros e tente novamente.",
      summary: "",
    };
    result.summary = buildBoardTaskDependencySummary(result);
    return result;
  };
  if (!taskId) return fail("missing-task-id");

  const block = readProjectTasksBlock(cwd);
  const idx = block.tasks.findIndex((row) => row?.id === taskId);
  if (idx < 0) return fail("task-not-found");
  const tasksById = new Map(block.tasks.map((row) => [String(row.id), row as TaskRecord] as const));
  const current = block.tasks[idx] as TaskRecord;
  const before = Array.isArray(current.depends_on) ? current.depends_on.filter((x): x is string => typeof x === "string") : [];
  const replacementProvided = Array.isArray(input.replaceDependsOn);
  const requested = replacementProvided
    ? normalizeDependencyIdList(input.replaceDependsOn)
    : normalizeDependencyIdList(input.addDependsOn);
  if (requested.length === 0) return { ...fail("missing-dependencies"), before };

  const after = replacementProvided ? requested : [...before];
  for (const dep of requested) {
    if (!after.includes(dep)) after.push(dep);
  }
  const added = after.filter((dep) => !before.includes(dep));
  const diagnostics = diagnoseTaskDependencyBlockers(taskId, current, after, tasksById);
  const ok = diagnostics.blockers.length === 0;
  const applied = ok && !dryRun;

  if (applied) {
    block.tasks[idx] = {
      ...block.tasks[idx],
      depends_on: after,
    };
    writeProjectTasksBlock(cwd, block);
    invalidateProjectBlockCaches(cwd);
  }

  const result: ProjectTaskDependencyUpdateResult = {
    ok,
    applied,
    dryRun,
    reason: ok ? undefined : "dependency-update-blocked",
    taskId,
    before,
    after,
    added,
    missingDependencies: diagnostics.missingDependencies,
    cycleDependencies: diagnostics.cycleDependencies,
    protectedDependencyIds: diagnostics.protectedDependencyIds,
    blockers: diagnostics.blockers,
    recommendationCode: diagnostics.recommendationCode,
    recommendation: diagnostics.recommendation,
    summary: "",
    task: applied ? queryProjectTasks(cwd, { search: taskId, limit: 200 }).rows.find((row) => row.id === taskId) : undefined,
  };
  result.summary = buildBoardTaskDependencySummary(result);
  return result;
}

export interface ProjectTaskQualityGateResult {
  ok: boolean;
  taskId: string;
  closeAllowed: boolean;
  decision: "ready" | "needs-decomposition" | "blocked";
  macroCandidate: boolean;
  broadSignals: string[];
  dependencies: string[];
  missingDependencies: string[];
  unresolvedDependencies: string[];
  verificationIds: string[];
  passedVerificationIds: string[];
  blockers: string[];
  warnings: string[];
  summary: string;
}

export function buildProjectTaskQualityGate(cwd: string, taskIdInput: string): ProjectTaskQualityGateResult {
  const taskId = String(taskIdInput ?? "").trim();
  const empty = (reason: string): ProjectTaskQualityGateResult => ({
    ok: false,
    taskId,
    closeAllowed: false,
    decision: "blocked",
    macroCandidate: false,
    broadSignals: [],
    dependencies: [],
    missingDependencies: [],
    unresolvedDependencies: [],
    verificationIds: [],
    passedVerificationIds: [],
    blockers: [reason],
    warnings: [],
    summary: `board-task-quality-gate: ok=no task=${taskId || "?"} closeAllowed=no decision=blocked blockers=${reason}`,
  });
  if (!taskId) return empty("missing-task-id");

  const { block } = readTasksBlockCached(cwd);
  const task = block.tasks.find((row) => row.id === taskId);
  if (!task) return empty("task-not-found");
  const tasksById = new Map(block.tasks.map((row) => [row.id, row] as const));
  const dependencies = task.depends_on ?? [];
  const missingDependencies = dependencies.filter((dep) => !tasksById.has(dep));
  const unresolvedDependencies = dependencies.filter((dep) => {
    const dependencyTask = tasksById.get(dep);
    return dependencyTask ? dependencyTask.status !== "completed" : false;
  });
  const { macro, signals } = isBroadTaskCandidate(task);
  const verificationBlock = readVerificationBlockCached(cwd).block;
  const verificationRows = verificationBlock.verifications.filter((row) => row.target === taskId || row.id === task.verification);
  const verificationIds = verificationRows.map((row) => row.id);
  const passedVerificationIds = verificationRows.filter((row) => row.status === "passed").map((row) => row.id);
  const partialVerificationIds = verificationRows.filter(verificationLooksPartial).map((row) => row.id);
  const blockers = [
    missingDependencies.length > 0 ? "missing-dependencies" : undefined,
    unresolvedDependencies.length > 0 ? "unresolved-dependencies" : undefined,
    macro && dependencies.length === 0 ? "macro-task-missing-dependencies" : undefined,
    task.status === "completed" && passedVerificationIds.length === 0 ? "completed-without-passed-verification" : undefined,
    task.status === "completed" && macro && partialVerificationIds.length > 0 ? "completed-with-partial-verification" : undefined,
  ].filter(Boolean) as string[];
  const warnings = [
    !macro && dependencies.length === 0 ? "small-task-no-dependencies-ok" : undefined,
    partialVerificationIds.length > 0 && task.status !== "completed" ? "partial-verification-present" : undefined,
    macro && dependencies.length > 0 && passedVerificationIds.length === 0 ? "macro-awaiting-own-verification" : undefined,
  ].filter(Boolean) as string[];
  const closeAllowed = blockers.length === 0;
  const decision = closeAllowed ? "ready" : blockers.includes("macro-task-missing-dependencies") ? "needs-decomposition" : "blocked";
  return {
    ok: true,
    taskId,
    closeAllowed,
    decision,
    macroCandidate: macro,
    broadSignals: signals,
    dependencies,
    missingDependencies,
    unresolvedDependencies,
    verificationIds,
    passedVerificationIds,
    blockers,
    warnings,
    summary: [
      "board-task-quality-gate:",
      "ok=yes",
      `task=${taskId}`,
      `closeAllowed=${closeAllowed ? "yes" : "no"}`,
      `decision=${decision}`,
      `macro=${macro ? "yes" : "no"}`,
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
      warnings.length > 0 ? `warnings=${warnings.join("|")}` : undefined,
    ].filter(Boolean).join(" "),
  };
}

export interface BoardPlanningClarityScoreResult {
  ok: boolean;
  score: number;
  recommendationCode: "planning-clarity-strong" | "planning-clarity-needs-decomposition" | "planning-clarity-needs-focus";
  recommendation: string;
  metrics: {
    openTasks: number;
    inProgressTasks: number;
    macroOpenTasks: number;
    macroWithDependencies: number;
    inProgressWithVerification: number;
    rationaleSensitiveWithoutRationale: number;
  };
  subScores: {
    decomposition: number;
    verification: number;
    focus: number;
    rationaleCoverage: number;
  };
  summary: string;
}

export function buildBoardPlanningClarityScore(
  cwd: string,
  options: { milestone?: string } = {},
): BoardPlanningClarityScoreResult {
  const read = queryProjectTasks(cwd, {
    milestone: options.milestone,
    limit: 200,
  });
  const open = read.rows.filter((row) => row.status !== "completed");
  const block = readTasksBlockCached(cwd).block;
  const taskById = new Map(block.tasks.map((task) => [task.id, task] as const));

  const openTasks = open.length;
  const inProgressTasks = open.filter((row) => row.status === "in-progress").length;
  let macroOpenTasks = 0;
  let macroWithDependencies = 0;
  for (const row of open) {
    const task = taskById.get(row.id);
    if (!task) continue;
    const broad = isBroadTaskCandidate(task);
    if (!broad.macro) continue;
    macroOpenTasks += 1;
    if ((task.depends_on?.length ?? 0) > 0) macroWithDependencies += 1;
  }

  const inProgressWithVerification = open
    .filter((row) => row.status === "in-progress")
    .filter((row) => typeof row.verification === "string" && row.verification.trim().length > 0)
    .length;

  const rationaleSensitiveWithoutRationale = open
    .filter((row) => row.rationaleRequired === true && row.hasRationale !== true)
    .length;

  const decomposition = scoreRatio(macroWithDependencies, macroOpenTasks);
  const verification = scoreRatio(inProgressWithVerification, inProgressTasks);
  const focus = inProgressTasks <= 1 ? 100 : inProgressTasks <= 2 ? 80 : inProgressTasks <= 3 ? 60 : 30;
  const rationaleCoverage = scoreRatio(
    open.filter((row) => row.rationaleRequired === true && row.hasRationale === true).length,
    open.filter((row) => row.rationaleRequired === true).length,
  );

  const score = Math.round((decomposition * 0.35) + (verification * 0.25) + (focus * 0.2) + (rationaleCoverage * 0.2));

  let recommendationCode: BoardPlanningClarityScoreResult["recommendationCode"] = "planning-clarity-strong";
  let recommendation = "planning clarity is strong; continue bounded milestone execution.";
  if (decomposition < 60) {
    recommendationCode = "planning-clarity-needs-decomposition";
    recommendation = "planning clarity degraded by macro tasks without explicit dependencies; decompose before long runs.";
  } else if (verification < 70 || focus < 60 || rationaleCoverage < 70) {
    recommendationCode = "planning-clarity-needs-focus";
    recommendation = "planning clarity needs focus: tighten in-progress scope and link focal verification/rationale evidence.";
  }

  return {
    ok: true,
    score,
    recommendationCode,
    recommendation,
    metrics: {
      openTasks,
      inProgressTasks,
      macroOpenTasks,
      macroWithDependencies,
      inProgressWithVerification,
      rationaleSensitiveWithoutRationale,
    },
    subScores: {
      decomposition,
      verification,
      focus,
      rationaleCoverage,
    },
    summary: [
      "board-planning-score:",
      "ok=yes",
      `score=${score}`,
      `code=${recommendationCode}`,
      `open=${openTasks}`,
      `inProgress=${inProgressTasks}`,
      `macro=${macroOpenTasks}`,
    ].join(" "),
  };
}

export type BoardDependencyHealthRecommendationCode =
  | "board-dependency-health-strong"
  | "board-dependency-health-needs-reconcile"
  | "board-dependency-health-protected-coupling";

export interface BoardDependencyHealthSnapshotRow {
  taskId: string;
  blockers: string[];
  missingDependencies: string[];
  cycleDependencies: string[];
  protectedDependencyIds: string[];
  recommendationCode: ProjectTaskDependencyRecommendationCode;
}

export interface BoardDependencyHealthSnapshotResult {
  ok: boolean;
  milestone?: string;
  recommendationCode: BoardDependencyHealthRecommendationCode;
  recommendation: string;
  metrics: {
    sampledTasks: number;
    tasksWithDependencies: number;
    tasksWithBlockers: number;
    missingReferenceCount: number;
    cycleReferenceCount: number;
    protectedCouplingCount: number;
  };
  blockerTaskCounts: {
    missing: number;
    cycle: number;
    protectedCoupling: number;
  };
  rows: BoardDependencyHealthSnapshotRow[];
  summary: string;
}

export type BoardDependencyHygieneRecommendationCode =
  | "board-dependency-hygiene-strong"
  | "board-dependency-hygiene-needs-reconcile"
  | "board-dependency-hygiene-critical-protected-coupling";

export interface BoardDependencyHygieneScoreResult {
  ok: boolean;
  score: number;
  milestone?: string;
  recommendationCode: BoardDependencyHygieneRecommendationCode;
  recommendation: string;
  dimensions: {
    coupling: number;
    consistency: number;
    traceability: number;
  };
  metrics: BoardDependencyHealthSnapshotResult["metrics"];
  blockerTaskCounts: BoardDependencyHealthSnapshotResult["blockerTaskCounts"];
  summary: string;
}

export function buildBoardDependencyHealthSnapshot(
  cwd: string,
  options: { milestone?: string; limit?: number } = {},
): BoardDependencyHealthSnapshotResult {
  const milestone = typeof options.milestone === "string" && options.milestone.trim().length > 0
    ? options.milestone.trim()
    : undefined;
  const rowLimit = normalizePositiveInt(options.limit, 20, 200);
  const read = queryProjectTasks(cwd, {
    milestone,
    limit: 200,
  });
  const block = readTasksBlockCached(cwd).block;
  const tasksById = new Map(block.tasks.map((task) => [task.id, task] as const));
  const openRows = read.rows.filter((row) => row.status !== "completed");

  let tasksWithDependencies = 0;
  let tasksWithBlockers = 0;
  let missingReferenceCount = 0;
  let cycleReferenceCount = 0;
  let protectedCouplingCount = 0;
  let missingTaskCount = 0;
  let cycleTaskCount = 0;
  let protectedTaskCount = 0;
  const rows: BoardDependencyHealthSnapshotRow[] = [];

  for (const row of openRows) {
    const task = tasksById.get(row.id);
    if (!task) continue;
    const dependencyIds = Array.isArray(task.depends_on)
      ? task.depends_on.filter((dep): dep is string => typeof dep === "string")
      : [];
    if (dependencyIds.length === 0) continue;
    tasksWithDependencies += 1;

    const diagnostics = diagnoseTaskDependencyBlockers(task.id, task, dependencyIds, tasksById);
    if (diagnostics.blockers.length <= 0) continue;

    tasksWithBlockers += 1;
    missingReferenceCount += diagnostics.missingDependencies.length;
    cycleReferenceCount += diagnostics.cycleDependencies.length;
    protectedCouplingCount += diagnostics.protectedDependencyIds.length;
    if (diagnostics.missingDependencies.length > 0) missingTaskCount += 1;
    if (diagnostics.cycleDependencies.length > 0) cycleTaskCount += 1;
    if (diagnostics.protectedDependencyIds.length > 0) protectedTaskCount += 1;

    if (rows.length < rowLimit) {
      rows.push({
        taskId: task.id,
        blockers: diagnostics.blockers,
        missingDependencies: diagnostics.missingDependencies,
        cycleDependencies: diagnostics.cycleDependencies,
        protectedDependencyIds: diagnostics.protectedDependencyIds,
        recommendationCode: diagnostics.recommendationCode,
      });
    }
  }

  let recommendationCode: BoardDependencyHealthRecommendationCode = "board-dependency-health-strong";
  let recommendation = "dependency health is strong; proceed with bounded wave execution.";
  if (protectedCouplingCount > 0) {
    recommendationCode = "board-dependency-health-protected-coupling";
    recommendation = "local-safe/protected coupling detected; reconcile dependencies before continuing local-safe waves.";
  } else if (tasksWithBlockers > 0) {
    recommendationCode = "board-dependency-health-needs-reconcile";
    recommendation = "dependency blockers detected (missing/cycle); reconcile board dependencies before scaling run size.";
  }

  return {
    ok: true,
    milestone,
    recommendationCode,
    recommendation,
    metrics: {
      sampledTasks: openRows.length,
      tasksWithDependencies,
      tasksWithBlockers,
      missingReferenceCount,
      cycleReferenceCount,
      protectedCouplingCount,
    },
    blockerTaskCounts: {
      missing: missingTaskCount,
      cycle: cycleTaskCount,
      protectedCoupling: protectedTaskCount,
    },
    rows,
    summary: [
      "board-dependency-health:",
      "ok=yes",
      `sampled=${openRows.length}`,
      `withDeps=${tasksWithDependencies}`,
      `blocked=${tasksWithBlockers}`,
      `missing=${missingReferenceCount}`,
      `cycle=${cycleReferenceCount}`,
      `protected=${protectedCouplingCount}`,
      `code=${recommendationCode}`,
    ].join(" "),
  };
}

export function buildBoardDependencyHygieneScore(
  cwd: string,
  options: { milestone?: string } = {},
): BoardDependencyHygieneScoreResult {
  const snapshot = buildBoardDependencyHealthSnapshot(cwd, {
    milestone: options.milestone,
    limit: 200,
  });

  const withDeps = snapshot.metrics.tasksWithDependencies;
  const coupling = scoreRatio(withDeps - snapshot.blockerTaskCounts.protectedCoupling, withDeps);
  const consistency = scoreRatio(withDeps - snapshot.blockerTaskCounts.cycle, withDeps);
  const traceability = scoreRatio(withDeps - snapshot.blockerTaskCounts.missing, withDeps);
  const score = Math.round((coupling * 0.45) + (consistency * 0.3) + (traceability * 0.25));

  let recommendationCode: BoardDependencyHygieneRecommendationCode = "board-dependency-hygiene-strong";
  let recommendation = "dependency hygiene is strong; continue bounded maintenance waves.";
  if (snapshot.metrics.protectedCouplingCount > 0 || coupling < 80) {
    recommendationCode = "board-dependency-hygiene-critical-protected-coupling";
    recommendation = "critical dependency hygiene issue: protected coupling present; reconcile before scaling local-safe run.";
  } else if (snapshot.metrics.tasksWithBlockers > 0 || consistency < 85 || traceability < 85 || score < 85) {
    recommendationCode = "board-dependency-hygiene-needs-reconcile";
    recommendation = "dependency hygiene needs reconciliation; reduce missing/cycle blockers before larger waves.";
  }

  return {
    ok: true,
    score,
    milestone: snapshot.milestone,
    recommendationCode,
    recommendation,
    dimensions: {
      coupling,
      consistency,
      traceability,
    },
    metrics: snapshot.metrics,
    blockerTaskCounts: snapshot.blockerTaskCounts,
    summary: [
      "board-dependency-hygiene-score:",
      "ok=yes",
      `score=${score}`,
      `code=${recommendationCode}`,
      `coupling=${coupling}`,
      `consistency=${consistency}`,
      `traceability=${traceability}`,
    ].join(" "),
  };
}

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

export interface ProjectVerificationAppendResult {
  ok: boolean;
  reason?: string;
  summary?: string;
  verification?: VerificationRecord;
  task?: ProjectTaskBoardRow;
}

export interface ProjectTaskCompleteWithVerificationResult {
  ok: boolean;
  reason?: string;
  summary?: string;
  verificationAppend?: ProjectVerificationAppendResult;
  update?: ProjectTaskUpdateResult;
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

  const update = updateProjectTaskBoard(cwd, taskId, {
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
