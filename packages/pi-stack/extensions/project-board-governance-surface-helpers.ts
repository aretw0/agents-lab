import {
  readProjectTasksBlock,
  writeProjectTasksBlock,
} from "./colony-pilot-task-sync";
import {
  hasRationaleText,
  hasTaskRationale,
  invalidateProjectBlockCaches,
  isRationaleSensitiveTask,
  readTasksBlockCached,
  readVerificationBlockCached,
  resolveTaskRationaleConsistency,
  shortText,
  type TaskRecord,
  type VerificationRecord,
} from "./project-board-model";
import {
  diagnoseTaskDependencyBlockers,
  isBroadTaskCandidate,
  normalizeDependencyIdList,
  normalizePositiveInt,
  scoreRatio,
  verificationLooksPartial,
  type ProjectTaskDependencyRecommendationCode,
} from "./project-board-governance-helpers";
import { queryProjectTasks, type ProjectTaskBoardRow } from "./project-board-query";

export interface ProjectTaskDecisionPacket {
  ok: boolean;
  reason?: string;
  taskId: string;
  task?: ProjectTaskBoardRow;
  noAutoClose: true;
  readyForHumanDecision: boolean;
  recommendedDecision: "close" | "keep-open" | "defer";
  options: Array<"close" | "keep-open" | "defer">;
  evidence: Array<{
    verificationId: string;
    status: string;
    method: string;
    timestamp?: string;
    evidence: string;
  }>;
  blockers: string[];
  risks: string[];
  summary: string;
}

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
