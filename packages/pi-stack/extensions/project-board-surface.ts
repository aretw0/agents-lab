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

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  appendNote as appendTaskNote,
  readProjectTasksBlock,
  writeProjectTasksBlock,
} from "./colony-pilot-task-sync";

export type ProjectTaskStatus =
  | "planned"
  | "in-progress"
  | "blocked"
  | "completed";

const PROJECT_TASK_STATUSES: ProjectTaskStatus[] = [
  "planned",
  "in-progress",
  "blocked",
  "completed",
];

interface TaskRecord {
  id: string;
  description: string;
  status: string;
  notes?: string;
  verification?: string;
  depends_on?: string[];
  files?: string[];
  milestone?: string;
}

export interface VerificationRecord {
  id: string;
  target?: string;
  target_type?: string;
  status?: string;
  method?: string;
  timestamp?: string;
  evidence?: string;
}

export type ProjectVerificationStatus = "passed" | "partial" | "failed";

const PROJECT_VERIFICATION_STATUSES: ProjectVerificationStatus[] = [
  "passed",
  "partial",
  "failed",
];

export type BoardRationaleKind = "refactor" | "test-change" | "risk-control" | "other";

const BOARD_RATIONALE_KINDS: BoardRationaleKind[] = [
  "refactor",
  "test-change",
  "risk-control",
  "other",
];

interface TasksBlock {
  tasks: TaskRecord[];
}

interface VerificationBlock {
  verifications: VerificationRecord[];
}

export type BoardRationaleSource = "task-note" | "verification-evidence" | "none";

export interface BoardRationaleSummary {
  required: number;
  withRationale: number;
  missingRationale: number;
}

export type BoardRationaleConsistency = "consistent" | "mismatch" | "single-source" | "none";

export interface BoardRationaleConsistencySummary {
  consistent: number;
  mismatch: number;
  singleSource: number;
  none: number;
}

export interface BoardVerificationSyncResult {
  requested: boolean;
  status: "updated" | "already-present" | "not-found" | "missing-task-verification" | "skipped";
  verificationId?: string;
}

interface BlockCacheEntry<T> {
  mtimeMs: number;
  data: T;
}

export interface BoardReadMeta {
  cacheHit: boolean;
  path: string;
  mtimeIso?: string;
}

/** @deprecated use BoardReadMeta */
export type ProxyReadMeta = BoardReadMeta;

const tasksCache = new Map<string, BlockCacheEntry<TasksBlock>>();
const verificationCache = new Map<string, BlockCacheEntry<VerificationBlock>>();

function tasksPath(cwd: string): string {
  return path.join(cwd, ".project", "tasks.json");
}

function verificationPath(cwd: string): string {
  return path.join(cwd, ".project", "verification.json");
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeTaskRecord(value: unknown): TaskRecord | undefined {
  const row = asObject(value);
  if (!row) return undefined;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const description =
    typeof row.description === "string" ? row.description.trim() : "";
  if (!id || !description) return undefined;
  return {
    id,
    description,
    status:
      typeof row.status === "string" && row.status.trim().length > 0
        ? row.status.trim()
        : "planned",
    notes: typeof row.notes === "string" ? row.notes : undefined,
    verification:
      typeof row.verification === "string" ? row.verification : undefined,
    depends_on: Array.isArray(row.depends_on)
      ? row.depends_on.filter((x): x is string => typeof x === "string")
      : undefined,
    files: Array.isArray(row.files)
      ? row.files.filter((x): x is string => typeof x === "string")
      : undefined,
    milestone: typeof row.milestone === "string" && row.milestone.trim().length > 0
      ? row.milestone.trim()
      : undefined,
  };
}

function normalizeVerificationRecord(value: unknown): VerificationRecord | undefined {
  const row = asObject(value);
  if (!row) return undefined;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) return undefined;
  return {
    id,
    target: typeof row.target === "string" ? row.target : undefined,
    target_type:
      typeof row.target_type === "string" ? row.target_type : undefined,
    status: typeof row.status === "string" ? row.status : undefined,
    method: typeof row.method === "string" ? row.method : undefined,
    timestamp: typeof row.timestamp === "string" ? row.timestamp : undefined,
    evidence: typeof row.evidence === "string" ? row.evidence : undefined,
  };
}

function parseTasksBlock(raw: string): TasksBlock {
  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    const arr = Array.isArray(json.tasks) ? json.tasks : [];
    return {
      tasks: arr
        .map(normalizeTaskRecord)
        .filter((x): x is TaskRecord => Boolean(x)),
    };
  } catch {
    return { tasks: [] };
  }
}

function parseVerificationBlock(raw: string): VerificationBlock {
  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    const arr = Array.isArray(json.verifications) ? json.verifications : [];
    return {
      verifications: arr
        .map(normalizeVerificationRecord)
        .filter((x): x is VerificationRecord => Boolean(x)),
    };
  } catch {
    return { verifications: [] };
  }
}

function readTasksBlockCached(cwd: string): { block: TasksBlock; meta: BoardReadMeta } {
  const p = tasksPath(cwd);
  if (!existsSync(p)) {
    return { block: { tasks: [] }, meta: { cacheHit: false, path: p } };
  }

  const st = statSync(p);
  const cached = tasksCache.get(p);
  if (cached && cached.mtimeMs === st.mtimeMs) {
    return {
      block: cached.data,
      meta: { cacheHit: true, path: p, mtimeIso: new Date(st.mtimeMs).toISOString() },
    };
  }

  const block = parseTasksBlock(readFileSync(p, "utf8"));
  tasksCache.set(p, { mtimeMs: st.mtimeMs, data: block });
  return {
    block,
    meta: { cacheHit: false, path: p, mtimeIso: new Date(st.mtimeMs).toISOString() },
  };
}

function readVerificationBlockCached(cwd: string): {
  block: VerificationBlock;
  meta: BoardReadMeta;
} {
  const p = verificationPath(cwd);
  if (!existsSync(p)) {
    return { block: { verifications: [] }, meta: { cacheHit: false, path: p } };
  }

  const st = statSync(p);
  const cached = verificationCache.get(p);
  if (cached && cached.mtimeMs === st.mtimeMs) {
    return {
      block: cached.data,
      meta: { cacheHit: true, path: p, mtimeIso: new Date(st.mtimeMs).toISOString() },
    };
  }

  const block = parseVerificationBlock(readFileSync(p, "utf8"));
  verificationCache.set(p, { mtimeMs: st.mtimeMs, data: block });
  return {
    block,
    meta: { cacheHit: false, path: p, mtimeIso: new Date(st.mtimeMs).toISOString() },
  };
}

function writeVerificationBlock(cwd: string, block: VerificationBlock): string {
  const p = verificationPath(cwd);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify({ verifications: block.verifications }, null, 2)}\n`, "utf8");
  return p;
}

function normalizeLimit(input: unknown, fallback = 20): number {
  const raw = Number(input);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.max(1, Math.min(200, Math.floor(raw)));
}

function shortText(text: string | undefined, max = 140): string | undefined {
  if (typeof text !== "string") return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function normalizeRationaleKind(value: unknown): BoardRationaleKind | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase();
  if (!key) return undefined;
  if (key === "refactor") return "refactor";
  if (key === "test-change" || key === "test" || key === "tests") return "test-change";
  if (key === "risk-control" || key === "risk" || key === "guardrail") return "risk-control";
  if (key === "other") return "other";
  return undefined;
}

function normalizeRationaleText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return undefined;
  return normalized.length <= 280 ? normalized : `${normalized.slice(0, 279)}…`;
}

function normalizeMilestoneLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  return normalized.length <= 120 ? normalized : `${normalized.slice(0, 119)}…`;
}

function extractRationaleKindFromText(text: string | undefined): BoardRationaleKind | undefined {
  if (typeof text !== "string" || text.trim().length <= 0) return undefined;
  const matches = [...text.matchAll(/\[rationale:([^\]]+)\]/ig)];
  if (matches.length <= 0) return undefined;
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const kind = normalizeRationaleKind(matches[i]?.[1]);
    if (kind) return kind;
  }
  return undefined;
}

function hasRationaleText(text: string | undefined): boolean {
  if (typeof text !== "string" || text.trim().length <= 0) return false;
  return /(?:\[rationale:[^\]]+\]|(?:^|\s)(?:rationale|motivo|reason)\s*[:=-]\s*\S)/i.test(text);
}

function buildTaskRationaleNote(kind: BoardRationaleKind, rationaleText: string): string {
  return `[rationale:${kind}] ${rationaleText}`;
}

function appendRationaleToTaskNotes(currentNotes: string | undefined, rationaleNote: string, maxLines: number): { next: string; changed: boolean } {
  const current = typeof currentNotes === "string" ? currentNotes.trim() : "";
  if (!current) return { next: appendTaskNote(undefined, rationaleNote, maxLines) ?? rationaleNote, changed: true };
  if (current.includes(rationaleNote)) return { next: current, changed: false };
  const next = appendTaskNote(current, rationaleNote, maxLines) ?? current;
  return { next, changed: next !== current };
}

function resolveRationaleConsistency(taskKind: BoardRationaleKind | undefined, verificationKind: BoardRationaleKind | undefined): BoardRationaleConsistency {
  if (!taskKind && !verificationKind) return "none";
  if (!taskKind || !verificationKind) return "single-source";
  return taskKind === verificationKind ? "consistent" : "mismatch";
}

function summarizeRationaleConsistency(values: BoardRationaleConsistency[]): BoardRationaleConsistencySummary {
  const summary: BoardRationaleConsistencySummary = {
    consistent: 0,
    mismatch: 0,
    singleSource: 0,
    none: 0,
  };
  for (const value of values) {
    if (value === "consistent") summary.consistent += 1;
    else if (value === "mismatch") summary.mismatch += 1;
    else if (value === "single-source") summary.singleSource += 1;
    else summary.none += 1;
  }
  return summary;
}

function resolveTaskNoteRationaleKind(task: TaskRecord): BoardRationaleKind | undefined {
  return extractRationaleKindFromText(task.notes);
}

function resolveLinkedVerificationRationaleKind(task: TaskRecord, verificationsById?: Map<string, VerificationRecord>): BoardRationaleKind | undefined {
  const verificationId = typeof task.verification === "string" ? task.verification.trim() : "";
  if (!verificationId || !verificationsById) return undefined;
  const verification = verificationsById.get(verificationId);
  return extractRationaleKindFromText(verification?.evidence);
}

function resolveTaskRationaleKind(task: TaskRecord, verificationsById?: Map<string, VerificationRecord>): BoardRationaleKind | undefined {
  return resolveTaskNoteRationaleKind(task) ?? resolveLinkedVerificationRationaleKind(task, verificationsById);
}

function resolveTaskRationaleConsistency(task: TaskRecord, verificationsById?: Map<string, VerificationRecord>): BoardRationaleConsistency {
  return resolveRationaleConsistency(
    resolveTaskNoteRationaleKind(task),
    resolveLinkedVerificationRationaleKind(task, verificationsById),
  );
}

function hasTaskRationale(task: TaskRecord, verificationsById?: Map<string, VerificationRecord>): boolean {
  if (hasRationaleText(task.notes)) return true;
  const verificationId = typeof task.verification === "string" ? task.verification.trim() : "";
  if (!verificationId || !verificationsById) return false;
  const verification = verificationsById.get(verificationId);
  return hasRationaleText(verification?.evidence);
}

function resolveTaskRationaleSource(task: TaskRecord, verificationsById?: Map<string, VerificationRecord>): BoardRationaleSource {
  if (hasRationaleText(task.notes)) return "task-note";
  const verificationId = typeof task.verification === "string" ? task.verification.trim() : "";
  if (!verificationId || !verificationsById) return "none";
  const verification = verificationsById.get(verificationId);
  return hasRationaleText(verification?.evidence) ? "verification-evidence" : "none";
}

function appendRationaleToVerificationEvidence(currentEvidence: string | undefined, rationaleNote: string): { next: string; changed: boolean } {
  const current = typeof currentEvidence === "string" ? currentEvidence.trim() : "";
  if (!current) return { next: rationaleNote, changed: true };
  if (current.includes(rationaleNote)) return { next: current, changed: false };
  return { next: `${current}\n${rationaleNote}`, changed: true };
}

function summarizeTaskRationale(rows: TaskRecord[], verificationsById: Map<string, VerificationRecord>): BoardRationaleSummary {
  let required = 0;
  let withRationale = 0;
  for (const row of rows) {
    if (!isRationaleSensitiveTask(row)) continue;
    required += 1;
    if (hasTaskRationale(row, verificationsById)) withRationale += 1;
  }
  return {
    required,
    withRationale,
    missingRationale: Math.max(0, required - withRationale),
  };
}

function summarizeVerificationRationale(rows: VerificationRecord[]): BoardRationaleSummary {
  let required = 0;
  let withRationale = 0;
  for (const row of rows) {
    if (!isRationaleSensitiveVerification(row)) continue;
    required += 1;
    if (hasRationaleText(row.evidence)) withRationale += 1;
  }
  return {
    required,
    withRationale,
    missingRationale: Math.max(0, required - withRationale),
  };
}

function isRationaleSensitiveTask(task: TaskRecord): boolean {
  const textHaystack = [task.id, task.description, task.notes ?? ""].join("\n").toLowerCase();
  const fileHaystack = Array.isArray(task.files)
    ? task.files.join("\n").toLowerCase()
    : "";
  const hasRefactorSignal = /(refactor|rename|organize\s+imports|formatar|desinflar|hardening)/i.test(textHaystack);
  const hasTestSignal = /(^|\W)(test|tests|smoke|vitest|e2e|spec)(\W|$)/i.test(textHaystack)
    || /(\/test\/|\.test\.|\.spec\.|smoke)/i.test(fileHaystack);
  return hasRefactorSignal || hasTestSignal;
}

function isRationaleSensitiveVerification(verification: VerificationRecord): boolean {
  const textHaystack = [
    verification.id,
    verification.target ?? "",
    verification.method ?? "",
    verification.evidence ?? "",
  ].join("\n").toLowerCase();
  return /(refactor|rename|organize\s+imports|formatar|desinflar|hardening|(^|\W)(test|tests|smoke|vitest|e2e|spec)(\W|$))/i.test(textHaystack);
}

function resolveVerificationTaskNoteRationaleKind(verification: VerificationRecord, tasksById?: Map<string, TaskRecord>): BoardRationaleKind | undefined {
  if (!tasksById) return undefined;
  const target = typeof verification.target === "string" ? verification.target.trim() : "";
  if (!target) return undefined;
  const task = tasksById.get(target);
  return task ? resolveTaskNoteRationaleKind(task) : undefined;
}

function resolveVerificationRationaleConsistency(verification: VerificationRecord, tasksById?: Map<string, TaskRecord>): BoardRationaleConsistency {
  return resolveRationaleConsistency(
    resolveVerificationTaskNoteRationaleKind(verification, tasksById),
    extractRationaleKindFromText(verification.evidence),
  );
}

function resolveVerificationRationaleSource(verification: VerificationRecord, tasksById?: Map<string, TaskRecord>): BoardRationaleSource {
  if (hasRationaleText(verification.evidence)) return "verification-evidence";
  return resolveVerificationTaskNoteRationaleKind(verification, tasksById) ? "task-note" : "none";
}

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
    status?: string;
    method?: string;
    timestamp?: string;
    evidence?: string;
  }>;
  blockers: string[];
  risks: string[];
  summary: string;
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

function invalidateProjectBlockCaches(cwd: string): void {
  tasksCache.delete(tasksPath(cwd));
  verificationCache.delete(verificationPath(cwd));
}

export interface ProjectTaskUpdateResult {
  ok: boolean;
  reason?: string;
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
  if (!id) return { ok: false, reason: "missing-task-id" };

  const p = tasksPath(cwd);
  if (!existsSync(p)) return { ok: false, reason: "tasks-block-missing" };

  const block = readProjectTasksBlock(cwd);
  const idx = block.tasks.findIndex((row) => row?.id === id);
  if (idx < 0) return { ok: false, reason: "task-not-found" };

  const current = block.tasks[idx]!;
  const next = { ...current };

  if (updates.status) {
    next.status = updates.status;
  }

  if (typeof updates.milestone === "string") {
    const nextMilestone = normalizeMilestoneLabel(updates.milestone);
    if (nextMilestone === undefined) return { ok: false, reason: "invalid-milestone" };
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
    return {
      ok: false,
      reason: "sync-requires-rationale-payload",
    };
  }
  if (hasRationaleKind !== hasRationaleTextInput) {
    return {
      ok: false,
      reason: hasRationaleKind ? "missing-rationale-text" : "missing-rationale-kind",
    };
  }

  let rationaleNoteForSync: string | undefined;
  if (hasRationaleKind && hasRationaleTextInput) {
    const kind = normalizeRationaleKind(updates.rationaleKind);
    const rationaleText = normalizeRationaleText(updates.rationaleText);
    if (!kind) return { ok: false, reason: "invalid-rationale-kind" };
    if (!rationaleText) return { ok: false, reason: "invalid-rationale-text" };
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
    return {
      ok: false,
      reason: "rationale-required-to-complete-sensitive-task",
    };
  }
  if (updates.requireRationaleConsistencyOnComplete === true && completingTask && rationaleConsistency === "mismatch") {
    return {
      ok: false,
      reason: "rationale-consistency-required-to-complete-task",
    };
  }
  if (updates.requireRationaleForSensitive === true && rationaleRequired && !hasRationale) {
    return {
      ok: false,
      reason: "rationale-required-for-sensitive-task",
    };
  }
  if (updates.requireRationaleConsistency === true && rationaleConsistency === "mismatch") {
    return {
      ok: false,
      reason: "rationale-consistency-mismatch",
    };
  }

  block.tasks[idx] = next;
  writeProjectTasksBlock(cwd, block);
  if (verificationSync.status === "updated") {
    writeVerificationBlock(cwd, verificationRead);
  }
  invalidateProjectBlockCaches(cwd);

  return {
    ok: true,
    task: {
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
    },
    verificationSync,
  };
}

export interface ProjectVerificationAppendResult {
  ok: boolean;
  reason?: string;
  verification?: VerificationRecord;
  task?: ProjectTaskBoardRow;
}

function normalizeVerificationEvidence(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length <= 4000 ? normalized : `${normalized.slice(0, 3999)}…`;
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

  if (!id) return { ok: false, reason: "missing-verification-id" };
  if (!target) return { ok: false, reason: "missing-verification-target" };
  if (!status) return { ok: false, reason: "invalid-verification-status" };
  if (!method) return { ok: false, reason: "missing-verification-method" };
  if (!evidence) return { ok: false, reason: "missing-verification-evidence" };

  const verificationRead = readVerificationBlockCached(cwd).block;
  if (verificationRead.verifications.some((row) => row.id === id)) {
    return { ok: false, reason: "verification-already-exists" };
  }

  let linkedTask: ProjectTaskBoardRow | undefined;
  if (input.linkTask === true) {
    if (targetType !== "task") return { ok: false, reason: "link-task-requires-task-target-type" };
    const taskBlock = readProjectTasksBlock(cwd);
    const taskIndex = taskBlock.tasks.findIndex((row) => row?.id === target);
    if (taskIndex < 0) return { ok: false, reason: "task-target-not-found" };
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

  return { ok: true, verification, task: linkedTask };
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
    const details = appendProjectVerificationBoard(ctx.cwd, {
      id: params?.id,
      target: params?.target,
      targetType: params?.target_type,
      status: params?.status,
      method: params?.method,
      evidence: params?.evidence,
      timestamp: params?.timestamp,
      linkTask: params?.link_task === true,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
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
      const out = { ok: false, reason: "missing-task-id" };
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
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
      const out = { ok: false, reason: "no-updates-requested" };
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
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
      content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
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
