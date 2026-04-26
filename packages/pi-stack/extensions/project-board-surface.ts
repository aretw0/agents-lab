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

import { existsSync, readFileSync, statSync } from "node:fs";
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

interface TasksBlock {
  tasks: TaskRecord[];
}

interface VerificationBlock {
  verifications: VerificationRecord[];
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

export interface ProjectTaskBoardRow {
  id: string;
  status: string;
  description: string;
  verification?: string;
  dependsOnCount: number;
}

export interface ProjectTaskQueryResult {
  total: number;
  filtered: number;
  rows: ProjectTaskBoardRow[];
  meta: BoardReadMeta;
}

/** @deprecated use ProjectTaskBoardRow */
export type ProjectTaskProxyRow = ProjectTaskBoardRow;

export function queryProjectTasks(
  cwd: string,
  options?: { status?: string; search?: string; limit?: number },
): ProjectTaskQueryResult {
  const { block, meta } = readTasksBlockCached(cwd);
  const statusFilter = typeof options?.status === "string" ? options.status.trim() : "";
  const search = typeof options?.search === "string" ? options.search.trim().toLowerCase() : "";
  const limit = normalizeLimit(options?.limit, 20);

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

  const mapped: ProjectTaskBoardRow[] = rows.slice(0, limit).map((row) => ({
    id: row.id,
    status: row.status,
    description: shortText(row.description, 180) ?? row.description,
    verification: row.verification,
    dependsOnCount: Array.isArray(row.depends_on) ? row.depends_on.length : 0,
  }));

  return {
    total: block.tasks.length,
    filtered: rows.length,
    rows: mapped,
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
}

export interface ProjectVerificationQueryResult {
  total: number;
  filtered: number;
  rows: ProjectVerificationBoardRow[];
  meta: BoardReadMeta;
}

/** @deprecated use ProjectVerificationBoardRow */
export type ProjectVerificationProxyRow = ProjectVerificationBoardRow;

export function queryProjectVerification(
  cwd: string,
  options?: { target?: string; status?: string; search?: string; limit?: number },
): ProjectVerificationQueryResult {
  const { block, meta } = readVerificationBlockCached(cwd);
  const targetFilter = typeof options?.target === "string" ? options.target.trim() : "";
  const statusFilter = typeof options?.status === "string" ? options.status.trim() : "";
  const search = typeof options?.search === "string" ? options.search.trim().toLowerCase() : "";
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
    })),
    meta,
  };
}

function invalidateProjectBlockCaches(cwd: string): void {
  tasksCache.delete(tasksPath(cwd));
  verificationCache.delete(verificationPath(cwd));
}

export function updateProjectTaskBoard(
  cwd: string,
  taskId: string,
  updates: {
    status?: ProjectTaskStatus;
    appendNote?: string;
    maxNoteLines?: number;
  },
): { ok: boolean; reason?: string; task?: ProjectTaskBoardRow } {
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

  if (typeof updates.appendNote === "string" && updates.appendNote.trim().length > 0) {
    const note = updates.appendNote.trim();
    const maxLinesRaw = Number(updates.maxNoteLines);
    const maxLines =
      Number.isFinite(maxLinesRaw) && maxLinesRaw > 0
        ? Math.max(1, Math.min(200, Math.floor(maxLinesRaw)))
        : 50;
    next.notes = appendTaskNote(next.notes, note, maxLines);
  }

  block.tasks[idx] = next;
  writeProjectTasksBlock(cwd, block);
  invalidateProjectBlockCaches(cwd);

  return {
    ok: true,
    task: {
      id: next.id,
      status: next.status,
      description: shortText(next.description, 180) ?? next.description,
      verification: next.verification,
      dependsOnCount: Array.isArray(next.depends_on) ? next.depends_on.length : 0,
    },
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
    const limit = params?.limit;
    const cwd = ctx.cwd;

    const details =
      entity === "tasks"
        ? queryProjectTasks(cwd, { status, search, limit })
        : queryProjectVerification(cwd, { target, status, search, limit });
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
  });

  const executeUpdate = (
    _toolCallId: string,
    params: {
      task_id?: string;
      status?: ProjectTaskStatus;
      append_note?: string;
      max_note_lines?: number;
    },
    _signal: AbortSignal,
    _onUpdate: (update: unknown) => void,
    ctx: { cwd: string },
  ) => {
    const taskId = String(params?.task_id ?? "").trim();
    const status = params?.status;
    const appendNote = typeof params?.append_note === "string" ? params.append_note : undefined;
    const maxNoteLines = params?.max_note_lines;

    if (!taskId) {
      const out = { ok: false, reason: "missing-task-id" };
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        details: out,
      };
    }

    const hasUpdate =
      (typeof status === "string" && status.length > 0) ||
      (typeof appendNote === "string" && appendNote.trim().length > 0);
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
      "Update .project/tasks through a constrained board surface (status and/or append note).",
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
  },
): { ok: boolean; reason?: string; task?: ProjectTaskBoardRow } {
  return updateProjectTaskBoard(cwd, taskId, updates);
}

/** @deprecated use projectBoardSurfaceExtension */
export const projectBoardProxyExtension = projectBoardSurfaceExtension;
