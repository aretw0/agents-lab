import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  readProjectTasksBlock,
  type ProjectTaskItem,
} from "./colony-pilot-task-sync";

export interface BoardFocusAutoAdvanceResult {
  applied: boolean;
  reason:
    | "applied"
    | "handoff-missing"
    | "task-not-found"
    | "focus-mismatch"
    | "missing-milestone"
    | "no-local-safe-successor"
    | "ambiguous-local-safe-successors";
  previousFocusTaskIds: string[];
  nextFocusTaskIds: string[];
  candidateTaskIds: string[];
}

function readBoardHandoffBlock(cwd: string): { path: string; data: Record<string, unknown> } | undefined {
  const handoffPath = path.join(cwd, ".project", "handoff.json");
  if (!existsSync(handoffPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(handoffPath, "utf8"));
    if (!parsed || typeof parsed !== "object") return { path: handoffPath, data: {} };
    return { path: handoffPath, data: parsed as Record<string, unknown> };
  } catch {
    return { path: handoffPath, data: {} };
  }
}

function normalizeBoardFocusTaskIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function taskLooksProtectedForBoardAutoAdvance(task: ProjectTaskItem): boolean {
  const milestone = typeof task.milestone === "string" ? task.milestone.toLowerCase() : "";
  if (/(^|[-_])protected[-_]parked/.test(milestone)) return true;
  const haystack = [task.description ?? "", ...(task.files ?? [])].join("\n").toLowerCase();
  return /(\.github\/|\.obsidian\/|\.pi\/settings\.json|\bgithub actions\b|\bremote\b|\bpublish\b|https?:\/\/|\bci\b)/i.test(haystack);
}

function taskDependenciesResolvedForBoardAutoAdvance(task: ProjectTaskItem, completedTaskIds: Set<string>): boolean {
  const deps = Array.isArray(task.depends_on) ? task.depends_on : [];
  return deps.every((dep) => typeof dep === "string" && completedTaskIds.has(dep.trim()));
}

function resolveBoardAutoAdvanceSuccessor(input: {
  tasks: ProjectTaskItem[];
  completedTaskId: string;
  completedMilestone?: string;
}): { reason: BoardFocusAutoAdvanceResult["reason"]; candidateTaskIds: string[]; nextTaskIds: string[] } {
  const milestone = typeof input.completedMilestone === "string" ? input.completedMilestone.trim() : "";
  if (!milestone) {
    return { reason: "missing-milestone", candidateTaskIds: [], nextTaskIds: [] };
  }

  const completedTaskIds = new Set(
    input.tasks
      .filter((task) => task.status === "completed" && typeof task.id === "string")
      .map((task) => task.id.trim())
      .filter(Boolean),
  );

  const candidates = input.tasks
    .filter((task) => {
      const id = typeof task.id === "string" ? task.id.trim() : "";
      if (!id || id === input.completedTaskId) return false;
      if (task.status !== "in-progress" && task.status !== "planned") return false;
      if ((task.milestone ?? "").trim() !== milestone) return false;
      if (taskLooksProtectedForBoardAutoAdvance(task)) return false;
      return taskDependenciesResolvedForBoardAutoAdvance(task, completedTaskIds);
    })
    .sort((a, b) => {
      const rank = (value: ProjectTaskItem) => (value.status === "in-progress" ? 0 : 1);
      const byStatus = rank(a) - rank(b);
      if (byStatus !== 0) return byStatus;
      return String(a.id ?? "").localeCompare(String(b.id ?? ""));
    });

  const candidateTaskIds = candidates
    .map((task) => (typeof task.id === "string" ? task.id.trim() : ""))
    .filter(Boolean);

  if (candidateTaskIds.length <= 0) {
    return { reason: "no-local-safe-successor", candidateTaskIds, nextTaskIds: [] };
  }
  if (candidateTaskIds.length > 1) {
    return { reason: "ambiguous-local-safe-successors", candidateTaskIds, nextTaskIds: [] };
  }
  return {
    reason: "applied",
    candidateTaskIds,
    nextTaskIds: [candidateTaskIds[0]],
  };
}

export function tryAutoAdvanceBoardHandoffFocus(cwd: string, completedTask: ProjectTaskItem): BoardFocusAutoAdvanceResult {
  const handoff = readBoardHandoffBlock(cwd);
  if (!handoff) {
    return {
      applied: false,
      reason: "handoff-missing",
      previousFocusTaskIds: [],
      nextFocusTaskIds: [],
      candidateTaskIds: [],
    };
  }

  const previousFocusTaskIds = normalizeBoardFocusTaskIds(handoff.data.current_tasks);
  const completedTaskId = typeof completedTask.id === "string" ? completedTask.id.trim() : "";
  if (!completedTaskId) {
    return {
      applied: false,
      reason: "task-not-found",
      previousFocusTaskIds,
      nextFocusTaskIds: previousFocusTaskIds,
      candidateTaskIds: [],
    };
  }

  if (!previousFocusTaskIds.includes(completedTaskId)) {
    return {
      applied: false,
      reason: "focus-mismatch",
      previousFocusTaskIds,
      nextFocusTaskIds: previousFocusTaskIds,
      candidateTaskIds: [],
    };
  }

  const tasks = readProjectTasksBlock(cwd).tasks;
  const successor = resolveBoardAutoAdvanceSuccessor({
    tasks,
    completedTaskId,
    completedMilestone: completedTask.milestone,
  });

  if (successor.reason !== "applied") {
    return {
      applied: false,
      reason: successor.reason,
      previousFocusTaskIds,
      nextFocusTaskIds: previousFocusTaskIds,
      candidateTaskIds: successor.candidateTaskIds,
    };
  }

  const nextFocusTaskIds = successor.nextTaskIds;
  const nextHandoff = {
    ...handoff.data,
    current_tasks: nextFocusTaskIds,
    updated_at: new Date().toISOString(),
  };
  writeFileSync(handoff.path, `${JSON.stringify(nextHandoff, null, 2)}\n`, "utf8");

  return {
    applied: true,
    reason: "applied",
    previousFocusTaskIds,
    nextFocusTaskIds,
    candidateTaskIds: successor.candidateTaskIds,
  };
}
