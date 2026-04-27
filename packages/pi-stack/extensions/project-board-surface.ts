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
}

interface VerificationRecord {
  id: string;
  target?: string;
  target_type?: string;
  status?: string;
  method?: string;
  timestamp?: string;
  evidence?: string;
}

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

function extractRationaleKindFromText(text: string | undefined): BoardRationaleKind | undefined {
  if (typeof text !== "string" || text.trim().length <= 0) return undefined;
  const match = text.match(/\[rationale:([^\]]+)\]/i);
  if (!match?.[1]) return undefined;
  return normalizeRationaleKind(match[1]);
}

function hasRationaleText(text: string | undefined): boolean {
  if (typeof text !== "string" || text.trim().length <= 0) return false;
  return /(?:\[rationale:[^\]]+\]|(?:^|\s)(?:rationale|motivo|reason)\s*[:=-]\s*\S)/i.test(text);
}

function buildTaskRationaleNote(kind: BoardRationaleKind, rationaleText: string): string {
  return `[rationale:${kind}] ${rationaleText}`;
}

function resolveTaskRationaleKind(task: TaskRecord, verificationsById?: Map<string, VerificationRecord>): BoardRationaleKind | undefined {
  const directKind = extractRationaleKindFromText(task.notes);
  if (directKind) return directKind;
  const verificationId = typeof task.verification === "string" ? task.verification.trim() : "";
  if (!verificationId || !verificationsById) return undefined;
  const verification = verificationsById.get(verificationId);
  return extractRationaleKindFromText(verification?.evidence);
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

export interface ProjectTaskBoardRow {
  id: string;
  status: string;
  description: string;
  verification?: string;
  dependsOnCount: number;
  rationaleRequired?: boolean;
  hasRationale?: boolean;
  rationaleKind?: BoardRationaleKind;
  rationaleSource?: BoardRationaleSource;
}

export interface ProjectTaskQueryResult {
  total: number;
  filtered: number;
  rows: ProjectTaskBoardRow[];
  rationaleSummary?: BoardRationaleSummary;
  meta: BoardReadMeta;
}

/** @deprecated use ProjectTaskBoardRow */
export type ProjectTaskProxyRow = ProjectTaskBoardRow;

export function queryProjectTasks(
  cwd: string,
  options?: { status?: string; search?: string; limit?: number; needsRationale?: boolean; rationaleRequired?: boolean },
): ProjectTaskQueryResult {
  const { block, meta } = readTasksBlockCached(cwd);
  const statusFilter = typeof options?.status === "string" ? options.status.trim() : "";
  const search = typeof options?.search === "string" ? options.search.trim().toLowerCase() : "";
  const needsRationale = options?.needsRationale === true;
  const rationaleRequiredFilter = typeof options?.rationaleRequired === "boolean"
    ? options.rationaleRequired
    : undefined;
  const limit = normalizeLimit(options?.limit, 20);
  const verificationsById = new Map(readVerificationBlockCached(cwd).block.verifications.map((row) => [row.id, row] as const));

  let rows = block.tasks;

  if (statusFilter) {
    rows = rows.filter((row) => row.status === statusFilter);
  }

  if (search) {
    rows = rows.filter((row) => {
      const hay = [row.id, row.description, row.notes ?? "", row.verification ?? ""]
        .join("\n")
        .toLowerCase();
      return hay.includes(search);
    });
  }

  if (typeof rationaleRequiredFilter === "boolean") {
    rows = rows.filter((row) => isRationaleSensitiveTask(row) === rationaleRequiredFilter);
  }

  if (needsRationale) {
    rows = rows.filter((row) => isRationaleSensitiveTask(row) && !hasTaskRationale(row, verificationsById));
  }

  const mapped: ProjectTaskBoardRow[] = rows.slice(0, limit).map((row) => {
    const rationaleRequired = isRationaleSensitiveTask(row);
    const hasRationale = hasTaskRationale(row, verificationsById);
    return {
      id: row.id,
      status: row.status,
      description: shortText(row.description, 180) ?? row.description,
      verification: row.verification,
      dependsOnCount: Array.isArray(row.depends_on) ? row.depends_on.length : 0,
      rationaleRequired,
      hasRationale,
      rationaleKind: resolveTaskRationaleKind(row, verificationsById),
      rationaleSource: resolveTaskRationaleSource(row, verificationsById),
    };
  });

  return {
    total: block.tasks.length,
    filtered: rows.length,
    rows: mapped,
    rationaleSummary: summarizeTaskRationale(rows, verificationsById),
    meta,
  };
}

export interface ProjectVerificationBoardRow {
  id: string;
  target?: string;
  status?: string;
  method?: string;
  timestamp?: string;
  evidence?: string;
  rationaleRequired?: boolean;
  hasRationale?: boolean;
  rationaleKind?: BoardRationaleKind;
  rationaleSource?: BoardRationaleSource;
}

export interface ProjectVerificationQueryResult {
  total: number;
  filtered: number;
  rows: ProjectVerificationBoardRow[];
  rationaleSummary?: BoardRationaleSummary;
  meta: BoardReadMeta;
}

/** @deprecated use ProjectVerificationBoardRow */
export type ProjectVerificationProxyRow = ProjectVerificationBoardRow;

export function queryProjectVerification(
  cwd: string,
  options?: { target?: string; status?: string; search?: string; limit?: number; needsRationale?: boolean; rationaleRequired?: boolean },
): ProjectVerificationQueryResult {
  const { block, meta } = readVerificationBlockCached(cwd);
  const targetFilter = typeof options?.target === "string" ? options.target.trim() : "";
  const statusFilter = typeof options?.status === "string" ? options.status.trim() : "";
  const search = typeof options?.search === "string" ? options.search.trim().toLowerCase() : "";
  const needsRationale = options?.needsRationale === true;
  const rationaleRequiredFilter = typeof options?.rationaleRequired === "boolean"
    ? options.rationaleRequired
    : undefined;
  const limit = normalizeLimit(options?.limit, 20);

  let rows = block.verifications;

  if (targetFilter) rows = rows.filter((row) => row.target === targetFilter);
  if (statusFilter) rows = rows.filter((row) => row.status === statusFilter);

  if (search) {
    rows = rows.filter((row) => {
      const hay = [
        row.id,
        row.target ?? "",
        row.status ?? "",
        row.method ?? "",
        row.evidence ?? "",
      ]
        .join("\n")
        .toLowerCase();
      return hay.includes(search);
    });
  }

  if (typeof rationaleRequiredFilter === "boolean") {
    rows = rows.filter((row) => isRationaleSensitiveVerification(row) === rationaleRequiredFilter);
  }

  if (needsRationale) {
    rows = rows.filter((row) => isRationaleSensitiveVerification(row) && !hasRationaleText(row.evidence));
  }

  return {
    total: block.verifications.length,
    filtered: rows.length,
    rows: rows.slice(0, limit).map((row) => ({
      id: row.id,
      target: row.target,
      status: row.status,
      method: row.method,
      timestamp: row.timestamp,
      evidence: shortText(row.evidence, 160),
      rationaleRequired: isRationaleSensitiveVerification(row),
      hasRationale: hasRationaleText(row.evidence),
      rationaleKind: extractRationaleKindFromText(row.evidence),
      rationaleSource: hasRationaleText(row.evidence) ? "verification-evidence" : "none",
    })),
    rationaleSummary: summarizeVerificationRationale(rows),
    meta,
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
    rationaleKind?: BoardRationaleKind;
    rationaleText?: string;
    requireRationaleForSensitive?: boolean;
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
    next.notes = appendTaskNote(next.notes, rationaleNoteForSync, maxLines);
  }

  const verificationRead = readVerificationBlockCached(cwd).block;
  const verificationMap = new Map(verificationRead.verifications.map((row) => [row.id, row] as const));
  const rationaleRequired = isRationaleSensitiveTask(next as TaskRecord);
  const hasRationale = hasTaskRationale(next as TaskRecord, verificationMap);
  if (updates.requireRationaleForSensitive === true && rationaleRequired && !hasRationale) {
    return {
      ok: false,
      reason: "rationale-required-for-sensitive-task",
    };
  }

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
        verificationSync = {
          requested: true,
          status: merged.changed ? "updated" : "already-present",
          verificationId,
        };
      }
    }
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
      verification: next.verification,
      dependsOnCount: Array.isArray(next.depends_on) ? next.depends_on.length : 0,
      rationaleRequired,
      hasRationale,
      rationaleKind: resolveTaskRationaleKind(next as TaskRecord, verificationMap),
      rationaleSource: resolveTaskRationaleSource(next as TaskRecord, verificationMap),
    },
    verificationSync,
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
      needs_rationale?: boolean;
      rationale_required?: boolean;
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
    const needsRationale = params?.needs_rationale === true;
    const rationaleRequired = typeof params?.rationale_required === "boolean"
      ? params.rationale_required
      : undefined;
    const limit = params?.limit;
    const cwd = ctx.cwd;

    const details =
      entity === "tasks"
        ? queryProjectTasks(cwd, { status, search, needsRationale, rationaleRequired, limit })
        : queryProjectVerification(cwd, { target, status, search, needsRationale, rationaleRequired, limit });
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
      rationale_kind?: BoardRationaleKind;
      rationale_text?: string;
      require_rationale_for_sensitive?: boolean;
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
    const rationaleKind = typeof params?.rationale_kind === "string" ? params.rationale_kind : undefined;
    const rationaleText = typeof params?.rationale_text === "string" ? params.rationale_text : undefined;
    const requireRationaleForSensitive = params?.require_rationale_for_sensitive === true;
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
      Boolean(params?.rationale_kind) ||
      Boolean(params?.rationale_text) ||
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
      rationaleKind,
      rationaleText,
      requireRationaleForSensitive,
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
      "Update .project/tasks through a constrained board surface (status, notes, rationale, optional sensitive-task enforcement, and optional verification sync).",
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
    rationaleKind?: BoardRationaleKind;
    rationaleText?: string;
    requireRationaleForSensitive?: boolean;
    syncRationaleToVerification?: boolean;
  },
): ProjectTaskUpdateResult {
  return updateProjectTaskBoard(cwd, taskId, updates);
}

/** @deprecated use projectBoardSurfaceExtension */
export const projectBoardProxyExtension = projectBoardSurfaceExtension;
