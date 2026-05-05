import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appendNote as appendTaskNote } from "./colony-pilot-task-sync";

export type ProjectTaskStatus =
  | "planned"
  | "in-progress"
  | "blocked"
  | "completed";

export const PROJECT_TASK_STATUSES: ProjectTaskStatus[] = [
  "planned",
  "in-progress",
  "blocked",
  "completed",
];

export interface TaskRecord {
  id: string;
  description: string;
  status: string;
  notes?: string;
  verification?: string;
  depends_on?: string[];
  files?: string[];
  acceptance_criteria?: string[];
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

export const PROJECT_VERIFICATION_STATUSES: ProjectVerificationStatus[] = [
  "passed",
  "partial",
  "failed",
];

export type BoardRationaleKind = "refactor" | "test-change" | "risk-control" | "other";

export const BOARD_RATIONALE_KINDS: BoardRationaleKind[] = [
  "refactor",
  "test-change",
  "risk-control",
  "other",
];

export interface TasksBlock {
  tasks: TaskRecord[];
}

export interface VerificationBlock {
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
  sizeBytes: number;
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

export function tasksPath(cwd: string): string {
  return path.join(cwd, ".project", "tasks.json");
}

export function verificationPath(cwd: string): string {
  return path.join(cwd, ".project", "verification.json");
}

export function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function normalizeTaskRecord(value: unknown): TaskRecord | undefined {
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
    acceptance_criteria: Array.isArray(row.acceptance_criteria)
      ? row.acceptance_criteria.filter((x): x is string => typeof x === "string")
      : undefined,
    milestone: typeof row.milestone === "string" && row.milestone.trim().length > 0
      ? row.milestone.trim()
      : undefined,
  };
}

export function normalizeVerificationRecord(value: unknown): VerificationRecord | undefined {
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

export function parseTasksBlock(raw: string): TasksBlock {
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

export function parseVerificationBlock(raw: string): VerificationBlock {
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

export function readTasksBlockCached(cwd: string): { block: TasksBlock; meta: BoardReadMeta } {
  const p = tasksPath(cwd);
  if (!existsSync(p)) {
    return { block: { tasks: [] }, meta: { cacheHit: false, path: p } };
  }

  const st = statSync(p);
  const cached = tasksCache.get(p);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.sizeBytes === st.size) {
    return {
      block: cached.data,
      meta: { cacheHit: true, path: p, mtimeIso: new Date(st.mtimeMs).toISOString() },
    };
  }

  const block = parseTasksBlock(readFileSync(p, "utf8"));
  tasksCache.set(p, { mtimeMs: st.mtimeMs, sizeBytes: st.size, data: block });
  return {
    block,
    meta: { cacheHit: false, path: p, mtimeIso: new Date(st.mtimeMs).toISOString() },
  };
}

export function readVerificationBlockCached(cwd: string): {
  block: VerificationBlock;
  meta: BoardReadMeta;
} {
  const p = verificationPath(cwd);
  if (!existsSync(p)) {
    return { block: { verifications: [] }, meta: { cacheHit: false, path: p } };
  }

  const st = statSync(p);
  const cached = verificationCache.get(p);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.sizeBytes === st.size) {
    return {
      block: cached.data,
      meta: { cacheHit: true, path: p, mtimeIso: new Date(st.mtimeMs).toISOString() },
    };
  }

  const block = parseVerificationBlock(readFileSync(p, "utf8"));
  verificationCache.set(p, { mtimeMs: st.mtimeMs, sizeBytes: st.size, data: block });
  return {
    block,
    meta: { cacheHit: false, path: p, mtimeIso: new Date(st.mtimeMs).toISOString() },
  };
}

export function writeVerificationBlock(cwd: string, block: VerificationBlock): string {
  const p = verificationPath(cwd);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify({ verifications: block.verifications }, null, 2)}\n`, "utf8");
  verificationCache.delete(p);
  return p;
}

export function invalidateProjectBlockCaches(cwd: string): void {
  tasksCache.delete(tasksPath(cwd));
  verificationCache.delete(verificationPath(cwd));
}

export function readVerificationBlockForAppend(cwd: string): VerificationBlock {
  const p = verificationPath(cwd);
  if (!existsSync(p)) return { verifications: [] };
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    const arr = Array.isArray(raw.verifications) ? raw.verifications : [];
    return {
      verifications: arr.filter((row): row is VerificationRecord => {
        const obj = asObject(row);
        return typeof obj?.id === "string" && obj.id.trim().length > 0;
      }),
    };
  } catch {
    return { verifications: [] };
  }
}

export function normalizeLimit(input: unknown, fallback = 20): number {
  const raw = Number(input);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.max(1, Math.min(200, Math.floor(raw)));
}

export function shortText(text: string | undefined, max = 140): string | undefined {
  if (typeof text !== "string") return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

export function normalizeRationaleKind(value: unknown): BoardRationaleKind | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase();
  if (!key) return undefined;
  if (key === "refactor") return "refactor";
  if (key === "test-change" || key === "test" || key === "tests") return "test-change";
  if (key === "risk-control" || key === "risk" || key === "guardrail") return "risk-control";
  if (key === "other") return "other";
  return undefined;
}

export function normalizeRationaleText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return undefined;
  return normalized.length <= 280 ? normalized : `${normalized.slice(0, 279)}…`;
}

export function normalizeMilestoneLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  return normalized.length <= 120 ? normalized : `${normalized.slice(0, 119)}…`;
}

export function normalizeBoundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

export function normalizeStringArray(value: unknown, maxItems: number, maxItemLength: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((item) => normalizeBoundedText(item, maxItemLength))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems);
  return out.length > 0 ? out : undefined;
}

export type BoardTaskProvenanceOrigin = "brainstorm" | "human" | "tangent-approved";

export function normalizeTaskProvenanceOrigin(value: unknown): BoardTaskProvenanceOrigin | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "brainstorm" || normalized === "human" || normalized === "tangent-approved") {
    return normalized;
  }
  return undefined;
}

export function buildTaskProvenanceNote(input: {
  origin: BoardTaskProvenanceOrigin;
  sourceTaskId?: string;
  sourceReason?: string;
}): string {
  const sourceTask = normalizeBoundedText(input.sourceTaskId, 80) ?? "none";
  const reason = normalizeBoundedText(input.sourceReason, 180) ?? "unspecified";
  return `[provenance:${input.origin}] source_task=${sourceTask} reason=${reason}`;
}

export function extractRationaleKindFromText(text: string | undefined): BoardRationaleKind | undefined {
  if (typeof text !== "string" || text.trim().length <= 0) return undefined;
  const matches = [...text.matchAll(/\[rationale:([^\]]+)\]/ig)];
  if (matches.length <= 0) return undefined;
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const kind = normalizeRationaleKind(matches[i]?.[1]);
    if (kind) return kind;
  }
  return undefined;
}

export function hasRationaleText(text: string | undefined): boolean {
  if (typeof text !== "string" || text.trim().length <= 0) return false;
  return /(?:\[rationale:[^\]]+\]|(?:^|\s)(?:rationale|motivo|reason)\s*[:=-]\s*\S)/i.test(text);
}

export function buildTaskRationaleNote(kind: BoardRationaleKind, rationaleText: string): string {
  return `[rationale:${kind}] ${rationaleText}`;
}

export function appendRationaleToTaskNotes(currentNotes: string | undefined, rationaleNote: string, maxLines: number): { next: string; changed: boolean } {
  const current = typeof currentNotes === "string" ? currentNotes.trim() : "";
  if (!current) return { next: appendTaskNote(undefined, rationaleNote, maxLines) ?? rationaleNote, changed: true };
  if (current.includes(rationaleNote)) return { next: current, changed: false };
  const next = appendTaskNote(current, rationaleNote, maxLines) ?? current;
  return { next, changed: next !== current };
}

export function resolveRationaleConsistency(taskKind: BoardRationaleKind | undefined, verificationKind: BoardRationaleKind | undefined): BoardRationaleConsistency {
  if (!taskKind && !verificationKind) return "none";
  if (!taskKind || !verificationKind) return "single-source";
  return taskKind === verificationKind ? "consistent" : "mismatch";
}

export function summarizeRationaleConsistency(values: BoardRationaleConsistency[]): BoardRationaleConsistencySummary {
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

export function resolveTaskNoteRationaleKind(task: TaskRecord): BoardRationaleKind | undefined {
  return extractRationaleKindFromText(task.notes);
}

export function resolveLinkedVerificationRationaleKind(task: TaskRecord, verificationsById?: Map<string, VerificationRecord>): BoardRationaleKind | undefined {
  const verificationId = typeof task.verification === "string" ? task.verification.trim() : "";
  if (!verificationId || !verificationsById) return undefined;
  const verification = verificationsById.get(verificationId);
  return extractRationaleKindFromText(verification?.evidence);
}

export function resolveTaskRationaleKind(task: TaskRecord, verificationsById?: Map<string, VerificationRecord>): BoardRationaleKind | undefined {
  return resolveTaskNoteRationaleKind(task) ?? resolveLinkedVerificationRationaleKind(task, verificationsById);
}

export function resolveTaskRationaleConsistency(task: TaskRecord, verificationsById?: Map<string, VerificationRecord>): BoardRationaleConsistency {
  return resolveRationaleConsistency(
    resolveTaskNoteRationaleKind(task),
    resolveLinkedVerificationRationaleKind(task, verificationsById),
  );
}

export function hasTaskRationale(task: TaskRecord, verificationsById?: Map<string, VerificationRecord>): boolean {
  if (hasRationaleText(task.notes)) return true;
  const verificationId = typeof task.verification === "string" ? task.verification.trim() : "";
  if (!verificationId || !verificationsById) return false;
  const verification = verificationsById.get(verificationId);
  return hasRationaleText(verification?.evidence);
}

export function resolveTaskRationaleSource(task: TaskRecord, verificationsById?: Map<string, VerificationRecord>): BoardRationaleSource {
  if (hasRationaleText(task.notes)) return "task-note";
  const verificationId = typeof task.verification === "string" ? task.verification.trim() : "";
  if (!verificationId || !verificationsById) return "none";
  const verification = verificationsById.get(verificationId);
  return hasRationaleText(verification?.evidence) ? "verification-evidence" : "none";
}

export function appendRationaleToVerificationEvidence(currentEvidence: string | undefined, rationaleNote: string): { next: string; changed: boolean } {
  const current = typeof currentEvidence === "string" ? currentEvidence.trim() : "";
  if (!current) return { next: rationaleNote, changed: true };
  if (current.includes(rationaleNote)) return { next: current, changed: false };
  return { next: `${current}\n${rationaleNote}`, changed: true };
}

export function summarizeTaskRationale(rows: TaskRecord[], verificationsById: Map<string, VerificationRecord>): BoardRationaleSummary {
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

export function summarizeVerificationRationale(rows: VerificationRecord[]): BoardRationaleSummary {
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

export function isRationaleSensitiveTask(task: TaskRecord): boolean {
  const textHaystack = [task.id, task.description, task.notes ?? ""].join("\n").toLowerCase();
  const fileHaystack = Array.isArray(task.files)
    ? task.files.join("\n").toLowerCase()
    : "";
  const hasRefactorSignal = /(refactor|rename|organize\s+imports|formatar|desinflar|hardening)/i.test(textHaystack);
  const hasTestSignal = /(^|\W)(test|tests|smoke|vitest|e2e|spec)(\W|$)/i.test(textHaystack)
    || /(\/test\/|\.test\.|\.spec\.|smoke)/i.test(fileHaystack);
  return hasRefactorSignal || hasTestSignal;
}

export function isRationaleSensitiveVerification(verification: VerificationRecord): boolean {
  const textHaystack = [
    verification.id,
    verification.target ?? "",
    verification.method ?? "",
    verification.evidence ?? "",
  ].join("\n").toLowerCase();
  return /(refactor|rename|organize\s+imports|formatar|desinflar|hardening|(^|\W)(test|tests|smoke|vitest|e2e|spec)(\W|$))/i.test(textHaystack);
}

export function resolveVerificationTaskNoteRationaleKind(verification: VerificationRecord, tasksById?: Map<string, TaskRecord>): BoardRationaleKind | undefined {
  if (!tasksById) return undefined;
  const target = typeof verification.target === "string" ? verification.target.trim() : "";
  if (!target) return undefined;
  const task = tasksById.get(target);
  return task ? resolveTaskNoteRationaleKind(task) : undefined;
}

export function resolveVerificationRationaleConsistency(verification: VerificationRecord, tasksById?: Map<string, TaskRecord>): BoardRationaleConsistency {
  return resolveRationaleConsistency(
    resolveVerificationTaskNoteRationaleKind(verification, tasksById),
    extractRationaleKindFromText(verification.evidence),
  );
}

export function resolveVerificationRationaleSource(verification: VerificationRecord, tasksById?: Map<string, TaskRecord>): BoardRationaleSource {
  if (hasRationaleText(verification.evidence)) return "verification-evidence";
  return resolveVerificationTaskNoteRationaleKind(verification, tasksById) ? "task-note" : "none";
}
