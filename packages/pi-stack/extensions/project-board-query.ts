import {
  extractRationaleKindFromText,
  hasRationaleText,
  hasTaskRationale,
  isRationaleSensitiveTask,
  isRationaleSensitiveVerification,
  normalizeLimit,
  normalizeMilestoneLabel,
  readTasksBlockCached,
  readVerificationBlockCached,
  resolveTaskRationaleConsistency,
  resolveTaskRationaleKind,
  resolveTaskRationaleSource,
  resolveVerificationRationaleConsistency,
  resolveVerificationRationaleSource,
  shortText,
  summarizeRationaleConsistency,
  summarizeTaskRationale,
  summarizeVerificationRationale,
  type BoardReadMeta,
  type BoardRationaleConsistency,
  type BoardRationaleConsistencySummary,
  type BoardRationaleKind,
  type BoardRationaleSource,
  type BoardRationaleSummary,
} from "./project-board-model";

export interface ProjectTaskBoardRow {
  id: string;
  status: string;
  description: string;
  milestone?: string;
  verification?: string;
  dependsOnCount: number;
  rationaleRequired?: boolean;
  hasRationale?: boolean;
  rationaleKind?: BoardRationaleKind;
  rationaleSource?: BoardRationaleSource;
  rationaleConsistency?: BoardRationaleConsistency;
}

export interface ProjectTaskQueryResult {
  total: number;
  filtered: number;
  rows: ProjectTaskBoardRow[];
  rationaleSummary?: BoardRationaleSummary;
  rationaleConsistencySummary?: BoardRationaleConsistencySummary;
  meta: BoardReadMeta;
}

/** @deprecated use ProjectTaskBoardRow */
export type ProjectTaskProxyRow = ProjectTaskBoardRow;

export function queryProjectTasks(
  cwd: string,
  options?: {
    status?: string;
    search?: string;
    milestone?: string;
    limit?: number;
    needsRationale?: boolean;
    rationaleRequired?: boolean;
    rationaleConsistency?: BoardRationaleConsistency;
  },
): ProjectTaskQueryResult {
  const { block, meta } = readTasksBlockCached(cwd);
  const statusFilter = typeof options?.status === "string" ? options.status.trim() : "";
  const search = typeof options?.search === "string" ? options.search.trim().toLowerCase() : "";
  const milestoneFilter = normalizeMilestoneLabel(options?.milestone);
  const needsRationale = options?.needsRationale === true;
  const rationaleRequiredFilter = typeof options?.rationaleRequired === "boolean"
    ? options.rationaleRequired
    : undefined;
  const rationaleConsistencyFilter =
    options?.rationaleConsistency === "consistent"
    || options?.rationaleConsistency === "mismatch"
    || options?.rationaleConsistency === "single-source"
    || options?.rationaleConsistency === "none"
      ? options.rationaleConsistency
      : undefined;
  const limit = normalizeLimit(options?.limit, 20);
  const verificationsById = new Map(readVerificationBlockCached(cwd).block.verifications.map((row) => [row.id, row] as const));

  let rows = block.tasks;

  if (statusFilter) {
    rows = rows.filter((row) => row.status === statusFilter);
  }

  if (search) {
    rows = rows.filter((row) => {
      const hay = [row.id, row.description, row.notes ?? "", row.verification ?? "", row.milestone ?? ""]
        .join("\n")
        .toLowerCase();
      return hay.includes(search);
    });
  }

  if (typeof milestoneFilter === "string" && milestoneFilter.length > 0) {
    rows = rows.filter((row) => (row.milestone ?? "") === milestoneFilter);
  }

  if (typeof rationaleRequiredFilter === "boolean") {
    rows = rows.filter((row) => isRationaleSensitiveTask(row) === rationaleRequiredFilter);
  }

  if (needsRationale) {
    rows = rows.filter((row) => isRationaleSensitiveTask(row) && !hasTaskRationale(row, verificationsById));
  }

  if (rationaleConsistencyFilter) {
    rows = rows.filter((row) => resolveTaskRationaleConsistency(row, verificationsById) === rationaleConsistencyFilter);
  }

  const mapped: ProjectTaskBoardRow[] = rows.slice(0, limit).map((row) => {
    const rationaleRequired = isRationaleSensitiveTask(row);
    const hasRationale = hasTaskRationale(row, verificationsById);
    const rationaleConsistency = resolveTaskRationaleConsistency(row, verificationsById);
    return {
      id: row.id,
      status: row.status,
      description: shortText(row.description, 180) ?? row.description,
      milestone: row.milestone,
      verification: row.verification,
      dependsOnCount: Array.isArray(row.depends_on) ? row.depends_on.length : 0,
      rationaleRequired,
      hasRationale,
      rationaleKind: resolveTaskRationaleKind(row, verificationsById),
      rationaleSource: resolveTaskRationaleSource(row, verificationsById),
      rationaleConsistency,
    };
  });

  return {
    total: block.tasks.length,
    filtered: rows.length,
    rows: mapped,
    rationaleSummary: summarizeTaskRationale(rows, verificationsById),
    rationaleConsistencySummary: summarizeRationaleConsistency(rows.map((row) => resolveTaskRationaleConsistency(row, verificationsById))),
    meta,
  };
}

export interface ProjectVerificationBoardRow {
  id: string;
  target?: string;
  milestone?: string;
  status?: string;
  method?: string;
  timestamp?: string;
  evidence?: string;
  rationaleRequired?: boolean;
  hasRationale?: boolean;
  rationaleKind?: BoardRationaleKind;
  rationaleSource?: BoardRationaleSource;
  rationaleConsistency?: BoardRationaleConsistency;
}

export interface ProjectVerificationQueryResult {
  total: number;
  filtered: number;
  rows: ProjectVerificationBoardRow[];
  rationaleSummary?: BoardRationaleSummary;
  rationaleConsistencySummary?: BoardRationaleConsistencySummary;
  meta: BoardReadMeta;
}

/** @deprecated use ProjectVerificationBoardRow */
export type ProjectVerificationProxyRow = ProjectVerificationBoardRow;

export function queryProjectVerification(
  cwd: string,
  options?: {
    target?: string;
    status?: string;
    search?: string;
    milestone?: string;
    limit?: number;
    needsRationale?: boolean;
    rationaleRequired?: boolean;
    rationaleConsistency?: BoardRationaleConsistency;
  },
): ProjectVerificationQueryResult {
  const { block, meta } = readVerificationBlockCached(cwd);
  const targetFilter = typeof options?.target === "string" ? options.target.trim() : "";
  const statusFilter = typeof options?.status === "string" ? options.status.trim() : "";
  const search = typeof options?.search === "string" ? options.search.trim().toLowerCase() : "";
  const milestoneFilter = normalizeMilestoneLabel(options?.milestone);
  const needsRationale = options?.needsRationale === true;
  const rationaleRequiredFilter = typeof options?.rationaleRequired === "boolean"
    ? options.rationaleRequired
    : undefined;
  const rationaleConsistencyFilter =
    options?.rationaleConsistency === "consistent"
    || options?.rationaleConsistency === "mismatch"
    || options?.rationaleConsistency === "single-source"
    || options?.rationaleConsistency === "none"
      ? options.rationaleConsistency
      : undefined;
  const limit = normalizeLimit(options?.limit, 20);
  const tasksById = new Map(readTasksBlockCached(cwd).block.tasks.map((row) => [row.id, row] as const));

  let rows = block.verifications;

  if (targetFilter) rows = rows.filter((row) => row.target === targetFilter);
  if (statusFilter) rows = rows.filter((row) => row.status === statusFilter);

  if (search) {
    rows = rows.filter((row) => {
      const linkedMilestone = (() => {
        const target = typeof row.target === "string" ? row.target.trim() : "";
        if (!target) return "";
        return tasksById.get(target)?.milestone ?? "";
      })();
      const hay = [
        row.id,
        row.target ?? "",
        row.status ?? "",
        row.method ?? "",
        row.evidence ?? "",
        linkedMilestone,
      ]
        .join("\n")
        .toLowerCase();
      return hay.includes(search);
    });
  }

  if (typeof milestoneFilter === "string" && milestoneFilter.length > 0) {
    rows = rows.filter((row) => {
      const target = typeof row.target === "string" ? row.target.trim() : "";
      if (!target) return false;
      return (tasksById.get(target)?.milestone ?? "") === milestoneFilter;
    });
  }

  if (typeof rationaleRequiredFilter === "boolean") {
    rows = rows.filter((row) => isRationaleSensitiveVerification(row) === rationaleRequiredFilter);
  }

  if (needsRationale) {
    rows = rows.filter((row) => isRationaleSensitiveVerification(row) && !hasRationaleText(row.evidence));
  }

  if (rationaleConsistencyFilter) {
    rows = rows.filter((row) => resolveVerificationRationaleConsistency(row, tasksById) === rationaleConsistencyFilter);
  }

  return {
    total: block.verifications.length,
    filtered: rows.length,
    rows: rows.slice(0, limit).map((row) => ({
      id: row.id,
      target: row.target,
      milestone: (() => {
        const target = typeof row.target === "string" ? row.target.trim() : "";
        if (!target) return undefined;
        return tasksById.get(target)?.milestone;
      })(),
      status: row.status,
      method: row.method,
      timestamp: row.timestamp,
      evidence: shortText(row.evidence, 160),
      rationaleRequired: isRationaleSensitiveVerification(row),
      hasRationale: hasRationaleText(row.evidence),
      rationaleKind: extractRationaleKindFromText(row.evidence),
      rationaleSource: resolveVerificationRationaleSource(row, tasksById),
      rationaleConsistency: resolveVerificationRationaleConsistency(row, tasksById),
    })),
    rationaleSummary: summarizeVerificationRationale(rows),
    rationaleConsistencySummary: summarizeRationaleConsistency(rows.map((row) => resolveVerificationRationaleConsistency(row, tasksById))),
    meta,
  };
}
