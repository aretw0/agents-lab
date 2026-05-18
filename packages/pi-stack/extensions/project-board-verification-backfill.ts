import { readFileSync, writeFileSync } from "node:fs";
import {
  invalidateProjectBlockCaches,
  tasksPath,
  verificationPath,
  type TaskRecord,
  type VerificationRecord,
} from "./project-board-model";

export interface ProjectVerificationBackfillPlan {
  mode: "project-verification-backfill";
  dryRun: boolean;
  apply: boolean;
  tasksPath: string;
  verificationPath: string;
  completedTasksTotal: number;
  pendingWithoutVerification: number;
  patchedTasks: number;
  addedVerifications: number;
  samplePendingTaskIds: string[];
  summary: string;
}

function readProjectJsonFile(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

export function buildProjectVerificationBackfillPlan(cwd: string, options: {
  dryRun?: boolean;
  prefix?: string;
  nowIso?: string;
} = {}): ProjectVerificationBackfillPlan {
  const dryRun = options.dryRun !== false;
  const prefix = String(options.prefix ?? "VER-LEGACY-").trim() || "VER-LEGACY-";
  const taskFilePath = tasksPath(cwd);
  const verificationFilePath = verificationPath(cwd);
  const tasksData = readProjectJsonFile(taskFilePath);
  const verificationData = readProjectJsonFile(verificationFilePath);
  const tasks = Array.isArray(tasksData.tasks) ? tasksData.tasks as TaskRecord[] : [];
  const verifications = Array.isArray(verificationData.verifications)
    ? verificationData.verifications as VerificationRecord[]
    : [];
  const verificationById = new Map(verifications.map((verification) => [verification.id, verification]));
  const pending = tasks
    .filter((task) => task && task.status === "completed")
    .filter((task) => !(typeof task.verification === "string" && task.verification.trim().length > 0));

  let patchedTasks = 0;
  let addedVerifications = 0;
  const nowIso = options.nowIso ?? new Date().toISOString();

  if (!dryRun) {
    for (const task of pending) {
      const verificationId = `${prefix}${task.id}`;
      task.verification = verificationId;
      patchedTasks += 1;

      if (!verificationById.has(verificationId)) {
        const entry: VerificationRecord = {
          id: verificationId,
          target: task.id,
          target_type: "task",
          status: "partial",
          method: "inspect",
          evidence: "Legacy completion backfilled for schema integrity; full historical evidence may reside in git/session artifacts and should be refined when task area is revisited.",
          timestamp: nowIso,
        };
        verifications.push(entry);
        verificationById.set(verificationId, entry);
        addedVerifications += 1;
      }
    }

    tasksData.tasks = tasks;
    verificationData.verifications = verifications;
    writeFileSync(taskFilePath, `${JSON.stringify(tasksData, null, 2)}\n`, "utf8");
    writeFileSync(verificationFilePath, `${JSON.stringify(verificationData, null, 2)}\n`, "utf8");
    invalidateProjectBlockCaches(cwd);
  }

  const completedTasksTotal = tasks.filter((task) => task && task.status === "completed").length;
  const out = {
    mode: "project-verification-backfill" as const,
    dryRun,
    apply: !dryRun,
    tasksPath: ".project/tasks.json",
    verificationPath: ".project/verification.json",
    completedTasksTotal,
    pendingWithoutVerification: pending.length,
    patchedTasks,
    addedVerifications,
    samplePendingTaskIds: pending.slice(0, 10).map((task) => task.id),
    summary: "",
  };
  out.summary = `project-verification-backfill: dryRun=${dryRun ? "yes" : "no"} pending=${out.pendingWithoutVerification} patched=${out.patchedTasks} added=${out.addedVerifications}`;
  return out;
}
