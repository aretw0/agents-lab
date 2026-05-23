import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

type BoardPressureStatus = "ok" | "pressure" | "unavailable";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toMb(bytes: number): number {
  return Number((Math.max(0, Number(bytes) || 0) / 1024 / 1024).toFixed(2));
}

function readJson(filePath: string): Record<string, unknown> | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function valueBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

export interface BoardPressureReductionPlan {
  mode: "board-pressure-reduction-plan";
  dryRun: true;
  mutates: false;
  status: BoardPressureStatus;
  reason?: string;
  boardPath: ".project/tasks.json";
  verificationPath: ".project/verification.json";
  boardMb?: number;
  verificationMb?: number;
  boardWarnMb: number;
  totalTaskCount: number;
  openTaskCount: number;
  nonCompletedTaskCount: number;
  cancelledTaskCount: number;
  completedTaskCount: number;
  completedMb: number;
  completedNotesMb: number;
  verificationCount: number;
  recommendedOrder: string[];
  safety: string[];
  actions: Array<Record<string, unknown>>;
  summary: string;
}

export function buildBoardPressureReductionPlan(cwd: string, options: { boardWarnMb?: number } = {}): BoardPressureReductionPlan {
  const boardWarnMb = Number(options.boardWarnMb ?? 1);
  const boardPath = join(cwd, ".project", "tasks.json");
  const verificationPath = join(cwd, ".project", "verification.json");
  const base = {
    mode: "board-pressure-reduction-plan" as const,
    dryRun: true as const,
    mutates: false as const,
    boardPath: ".project/tasks.json" as const,
    verificationPath: ".project/verification.json" as const,
    boardWarnMb,
    totalTaskCount: 0,
    openTaskCount: 0,
    nonCompletedTaskCount: 0,
    cancelledTaskCount: 0,
    completedTaskCount: 0,
    completedMb: 0,
    completedNotesMb: 0,
    verificationCount: 0,
    recommendedOrder: [] as string[],
    safety: [
      "preview-only",
      "keep-open-tasks-in-hot-board",
      "preserve-verification-links",
      "require-explicit-operator-approval-before-any-write",
    ],
    actions: [] as Array<Record<string, unknown>>,
  };

  const board = readJson(boardPath);
  if (!board) {
    return {
      ...base,
      status: "unavailable",
      reason: "board-missing-or-invalid",
      summary: "board-pressure-plan: status=unavailable reason=board-missing-or-invalid",
    };
  }

  const tasks = Array.isArray(board.tasks) ? board.tasks.filter(isRecord) : [];
  const boardBytes = statSync(boardPath).size;
  const boardMb = toMb(boardBytes);
  const byStatus = new Map<string, number>();
  let completedBytes = 0;
  let completedNotesBytes = 0;

  for (const task of tasks) {
    const status = String(task.status ?? "unknown");
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    if (status !== "completed") continue;
    completedBytes += valueBytes(task);
    completedNotesBytes += valueBytes(task.notes);
  }

  const verification = readJson(verificationPath);
  const verificationRows = Array.isArray(verification?.verifications) ? verification.verifications.filter(isRecord) : [];
  const verificationMb = existsSync(verificationPath) ? toMb(statSync(verificationPath).size) : 0;
  const completedTaskCount = byStatus.get("completed") ?? 0;
  const cancelledTaskCount = byStatus.get("cancelled") ?? 0;
  const nonCompletedTaskCount = Math.max(0, tasks.length - completedTaskCount);
  const openTaskCount = Math.max(0, nonCompletedTaskCount - cancelledTaskCount);
  const actions: Array<Record<string, unknown>> = [];

  if (completedTaskCount > 0) {
    actions.push({
      id: "archive-completed-tasks",
      candidateCount: completedTaskCount,
      candidateMb: toMb(completedBytes),
      retainedHotTasks: nonCompletedTaskCount,
      guard: "explicit-operator-approval-required",
    });
  }
  if (completedNotesBytes > 0) {
    actions.push({
      id: "compact-completed-task-notes",
      candidateMb: toMb(completedNotesBytes),
      guard: "explicit-operator-approval-required",
    });
  }
  if (verificationRows.length > 0) {
    actions.push({
      id: "split-verification-ledger",
      candidateCount: verificationRows.length,
      candidateMb: verificationMb,
      guard: "explicit-operator-approval-required",
    });
  }

  const status: BoardPressureStatus = boardBytes >= boardWarnMb * 1024 * 1024 ? "pressure" : "ok";
  const out = {
    ...base,
    status,
    boardMb,
    verificationMb,
    totalTaskCount: tasks.length,
    openTaskCount,
    nonCompletedTaskCount,
    cancelledTaskCount,
    completedTaskCount,
    completedMb: toMb(completedBytes),
    completedNotesMb: toMb(completedNotesBytes),
    verificationCount: verificationRows.length,
    recommendedOrder: actions.map((action) => String(action.id)),
    actions,
    summary: "",
  };
  out.summary = `board-pressure-plan: status=${status} dryRun=yes tasks=${tasks.length} open=${openTaskCount} completed=${completedTaskCount} boardMb=${boardMb} verification=${verificationRows.length}/${verificationMb}MB`;
  return out;
}
