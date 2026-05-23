import { readFileSync, statSync } from "node:fs";
import path from "node:path";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toMb(bytes) {
  return Number((Math.max(0, Number(bytes) || 0) / 1024 / 1024).toFixed(2));
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    return { __parseError: err instanceof Error ? err.message : String(err) };
  }
}

export function collectBoardStateStats(cwd = process.cwd()) {
  const boardPath = path.join(cwd, ".project", "tasks.json");
  const verificationPath = path.join(cwd, ".project", "verification.json");
  try {
    const stat = statSync(boardPath);
    const board = readJsonIfExists(boardPath);
    const rawTasks = Array.isArray(board?.tasks) ? board.tasks : [];
    const tasks = rawTasks.filter(isRecord);
    const byStatus = {};
    let completedBytes = 0;
    let completedNotesBytes = 0;
    const topCompleted = [];
    for (const task of tasks) {
      const status = String(task.status ?? "unknown");
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      if (status !== "completed") continue;
      const bytes = Buffer.byteLength(JSON.stringify(task), "utf8");
      const notesBytes = Buffer.byteLength(JSON.stringify(task.notes ?? []), "utf8");
      completedBytes += bytes;
      completedNotesBytes += notesBytes;
      topCompleted.push({
        id: String(task.id ?? task.title ?? "unknown"),
        kb: Number((bytes / 1024).toFixed(1)),
        notesKb: Number((notesBytes / 1024).toFixed(1)),
      });
    }
    topCompleted.sort((a, b) => b.kb - a.kb);

    let verification;
    try {
      const verificationStat = statSync(verificationPath);
      const verificationJson = readJsonIfExists(verificationPath);
      const rawVerifications = Array.isArray(verificationJson?.verifications) ? verificationJson.verifications : [];
      verification = {
        exists: true,
        path: ".project/verification.json",
        mb: toMb(verificationStat.size),
        count: rawVerifications.length,
      };
    } catch {
      verification = { exists: false, path: ".project/verification.json" };
    }

    return {
      exists: true,
      path: ".project/tasks.json",
      mb: toMb(stat.size),
      mtimeIso: stat.mtime.toISOString(),
      tasks: {
        total: tasks.length,
        byStatus,
        completedCount: byStatus.completed ?? 0,
        completedMb: toMb(completedBytes),
        completedNotesMb: toMb(completedNotesBytes),
        topCompleted: topCompleted.slice(0, 5),
      },
      verification,
    };
  } catch {
    return { exists: false, path: ".project/tasks.json" };
  }
}

export function formatBoardPressureDetail(board) {
  const tasks = board?.tasks;
  const statusParts = tasks?.byStatus
    ? Object.entries(tasks.byStatus)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, count]) => `${status}=${count}`)
    : [];
  const top = tasks?.topCompleted?.[0];
  const topPart = top ? `topCompleted=${top.id}:${top.kb}KB` : "topCompleted=n/a";
  return [
    `${board.path} ${board.mb} MB`,
    tasks ? `tasks=${tasks.total}` : undefined,
    statusParts.length > 0 ? statusParts.join(",") : undefined,
    tasks ? `completedMb=${tasks.completedMb}` : undefined,
    tasks ? `completedNotesMb=${tasks.completedNotesMb}` : undefined,
    board.verification?.exists ? `verification=${board.verification.count}/${board.verification.mb}MB` : undefined,
    topPart,
  ].filter(Boolean).join("; ");
}
