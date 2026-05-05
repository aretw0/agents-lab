import type { VerificationRecord } from "./project-board-model";

export interface ProjectVerificationAppendToolResultLike {
  ok: boolean;
  reason?: string;
  summary?: string;
  verification?: VerificationRecord;
  task?: unknown;
}

export interface ProjectTaskCompleteToolResultLike {
  ok: boolean;
  reason?: string;
  summary?: string;
  verification?: VerificationRecord;
  task?: unknown;
  focusAutoAdvance?: unknown;
}

export function buildBoardTaskCreateSummary(ok: boolean, taskId: string, status: string, reason?: string): string {
  return [
    "board-task-create:",
    `ok=${ok ? "yes" : "no"}`,
    taskId ? `task=${taskId}` : undefined,
    status ? `status=${status}` : undefined,
    reason ? `reason=${reason}` : undefined,
  ].filter(Boolean).join(" ");
}

export function buildBoardTaskUpdateSummary(ok: boolean, taskId: string, status: string, reason?: string): string {
  return [
    "board-update:",
    `ok=${ok ? "yes" : "no"}`,
    taskId ? `task=${taskId}` : undefined,
    status ? `status=${status}` : undefined,
    reason ? `reason=${reason}` : undefined,
  ].filter(Boolean).join(" ");
}

export function buildBoardVerificationAppendSummary(ok: boolean, verificationId: string, target: string, linked: boolean, reason?: string): string {
  return [
    "board-verification-append:",
    `ok=${ok ? "yes" : "no"}`,
    verificationId ? `verification=${verificationId}` : undefined,
    target ? `target=${target}` : undefined,
    `linked=${linked ? "yes" : "no"}`,
    reason ? `reason=${reason}` : undefined,
  ].filter(Boolean).join(" ");
}

export function buildBoardTaskCompleteSummary(ok: boolean, taskId: string, verificationId: string, status: string, reason?: string): string {
  return [
    "board-task-complete:",
    `ok=${ok ? "yes" : "no"}`,
    taskId ? `task=${taskId}` : undefined,
    verificationId ? `verification=${verificationId}` : undefined,
    status ? `status=${status}` : undefined,
    reason ? `reason=${reason}` : undefined,
  ].filter(Boolean).join(" ");
}

export function normalizeVerificationEvidence(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length <= 4000 ? normalized : `${normalized.slice(0, 3999)}…`;
}

export function compactVerificationRecord(verification: VerificationRecord | undefined): Omit<VerificationRecord, "evidence"> | undefined {
  if (!verification) return undefined;
  return {
    id: verification.id,
    target: verification.target,
    target_type: verification.target_type,
    status: verification.status,
    method: verification.method,
    timestamp: verification.timestamp,
  };
}

export function compactVerificationAppendToolResult(result: ProjectVerificationAppendToolResultLike) {
  return {
    ok: result.ok,
    reason: result.reason,
    summary: result.summary,
    verification: compactVerificationRecord(result.verification),
    task: result.task,
  };
}

export function compactTaskCompleteToolResult(result: ProjectTaskCompleteToolResultLike) {
  return {
    ok: result.ok,
    reason: result.reason,
    summary: result.summary,
    verification: compactVerificationRecord(result.verification),
    task: result.task,
    focusAutoAdvance: result.focusAutoAdvance,
  };
}
