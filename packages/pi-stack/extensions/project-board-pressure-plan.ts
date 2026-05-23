import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type BoardPressureStatus = "ok" | "pressure" | "unavailable";
type BoardPressureApplyStatus = BoardPressureStatus | "blocked";

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

function recordsFrom(value: unknown, key: string): Record<string, unknown>[] {
  const obj = isRecord(value) ? value : undefined;
  const rows = Array.isArray(obj?.[key]) ? obj[key] : [];
  return rows.filter(isRecord);
}

function mergeRecordsById(existing: Record<string, unknown>[], incoming: Record<string, unknown>[]): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>();
  const noId: Record<string, unknown>[] = [];
  for (const row of [...existing, ...incoming]) {
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) noId.push(row);
    else byId.set(id, row);
  }
  return [...byId.values(), ...noId];
}

function readJsonlShard(filePath: string): Record<string, unknown>[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return undefined;
      }
    })
    .filter(isRecord);
}

function readArchiveShards(cwd: string, prefix: string): Record<string, unknown>[] {
  const archiveDir = join(cwd, ".project", "archive");
  if (!existsSync(archiveDir)) return [];
  return readdirSync(archiveDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".jsonl"))
    .sort()
    .flatMap((name) => readJsonlShard(join(archiveDir, name)));
}

function writeArchiveShards(cwd: string, prefix: string, records: Record<string, unknown>[], chunkSize = 500): string[] {
  const archiveDir = join(cwd, ".project", "archive");
  mkdirSync(archiveDir, { recursive: true });
  for (const name of readdirSync(archiveDir).filter((entry) => entry.startsWith(prefix) && entry.endsWith(".jsonl"))) {
    rmSync(join(archiveDir, name), { force: true });
  }
  const paths: string[] = [];
  for (let index = 0; index < records.length; index += chunkSize) {
    const chunk = records.slice(index, index + chunkSize);
    const shard = String(Math.floor(index / chunkSize) + 1).padStart(4, "0");
    const relative = `.project/archive/${prefix}-${shard}.jsonl`;
    writeFileSync(
      join(cwd, relative),
      `${chunk.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8",
    );
    paths.push(relative);
  }
  return paths;
}

function writeHotJson(filePath: string, value: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

export interface BoardPressureReductionApplyResult extends Omit<BoardPressureReductionPlan, "mode" | "dryRun" | "mutates" | "status" | "summary"> {
  mode: "board-pressure-reduction-apply";
  dryRun: boolean;
  mutates: boolean;
  status: BoardPressureApplyStatus;
  authorization: "none" | "explicit-operator";
  archivedTasksPath: ".project/archive/completed-tasks-*.jsonl";
  archivedVerificationPath: ".project/archive/verification-ledger-*.jsonl";
  archivedTaskShards: string[];
  archivedVerificationShards: string[];
  archivedTaskCount: number;
  archivedVerificationCount: number;
  retainedTaskCount: number;
  retainedVerificationCount: number;
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

export function applyBoardPressureReduction(cwd: string, options: {
  dryRun?: boolean;
  authorization?: string;
  boardWarnMb?: number;
} = {}): BoardPressureReductionApplyResult {
  const dryRun = options.dryRun !== false;
  const authorization = options.authorization === "explicit-operator" ? "explicit-operator" : "none";
  const plan = buildBoardPressureReductionPlan(cwd, { boardWarnMb: options.boardWarnMb });
  const archivedTasksPath = ".project/archive/completed-tasks-*.jsonl" as const;
  const archivedVerificationPath = ".project/archive/verification-ledger-*.jsonl" as const;
  const base = {
    ...plan,
    mode: "board-pressure-reduction-apply" as const,
    dryRun,
    mutates: false,
    authorization,
    archivedTasksPath,
    archivedVerificationPath,
    archivedTaskShards: [] as string[],
    archivedVerificationShards: [] as string[],
    archivedTaskCount: 0,
    archivedVerificationCount: 0,
    retainedTaskCount: plan.totalTaskCount,
    retainedVerificationCount: plan.verificationCount,
  };

  if (plan.status === "unavailable") {
    return {
      ...base,
      status: "unavailable",
      summary: "board-pressure-apply: status=unavailable reason=board-missing-or-invalid",
    };
  }
  if (!dryRun && authorization !== "explicit-operator") {
    return {
      ...base,
      status: "blocked",
      mutates: false,
      summary: "board-pressure-apply: status=blocked reason=explicit-operator-authorization-required",
    };
  }

  const boardPath = join(cwd, ".project", "tasks.json");
  const verificationPath = join(cwd, ".project", "verification.json");
  const board = readJson(boardPath) ?? {};
  const verification = readJson(verificationPath) ?? {};
  const tasks = recordsFrom(board, "tasks");
  const verifications = recordsFrom(verification, "verifications");
  const archivedTasks = tasks.filter((task) => task.status === "completed");
  const retainedTasks = tasks.filter((task) => task.status !== "completed");
  const archivedTaskIds = new Set(archivedTasks.map((task) => String(task.id ?? "")).filter(Boolean));
  const archivedVerificationIds = new Set(
    archivedTasks.map((task) => String(task.verification ?? "")).filter(Boolean),
  );
  const verificationToArchive = verifications.filter((row) => {
    const target = typeof row.target === "string" ? row.target.trim() : "";
    const id = typeof row.id === "string" ? row.id.trim() : "";
    return archivedTaskIds.has(target) || archivedVerificationIds.has(id);
  });
  const verificationToRetain = verifications.filter((row) => !verificationToArchive.includes(row));

  const out = {
    ...base,
    status: plan.status,
    mutates: !dryRun && authorization === "explicit-operator" && archivedTasks.length > 0,
    archivedTaskCount: archivedTasks.length,
    archivedVerificationCount: verificationToArchive.length,
    retainedTaskCount: retainedTasks.length,
    retainedVerificationCount: verificationToRetain.length,
    summary: "",
  };
  out.summary = `board-pressure-apply: status=${out.status} dryRun=${dryRun ? "yes" : "no"} archivedTasks=${out.archivedTaskCount} retainedTasks=${out.retainedTaskCount} archivedVerification=${out.archivedVerificationCount} retainedVerification=${out.retainedVerificationCount}`;

  if (dryRun || archivedTasks.length <= 0) return out;

  const existingArchiveTasks = readArchiveShards(cwd, "completed-tasks");
  const existingArchiveVerification = readArchiveShards(cwd, "verification-ledger");
  writeHotJson(boardPath, { ...board, tasks: retainedTasks });
  writeHotJson(verificationPath, { ...verification, verifications: verificationToRetain });
  out.archivedTaskShards = writeArchiveShards(cwd, "completed-tasks", mergeRecordsById(existingArchiveTasks, archivedTasks));
  out.archivedVerificationShards = writeArchiveShards(cwd, "verification-ledger", mergeRecordsById(existingArchiveVerification, verificationToArchive));
  return out;
}
