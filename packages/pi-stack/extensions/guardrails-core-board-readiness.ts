import {
  readProjectTasksBlock,
  type ProjectTaskItem,
} from "./colony-pilot-task-sync";
import {
  buildBoardExecuteTaskIntent,
  encodeGuardrailsIntent,
} from "./guardrails-core-intent-bus";

export interface BoardLongRunReadiness {
  ready: boolean;
  reason: "ready" | "no-planned-tasks" | "no-eligible-planned-tasks";
  recommendation: string;
  selectionPolicy: string;
  nextTaskId?: string;
  totals: {
    tasks: number;
    planned: number;
    inProgress: number;
    completed: number;
    blocked: number;
    cancelled: number;
  };
  eligibleTaskIds: string[];
  blockedByDependencies: number;
}

function clampSampleLimit(value: unknown, fallback = 3): number {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.max(1, Math.min(20, Math.floor(raw)));
}

function normalizeTaskId(value: unknown): string | undefined {
  const id = typeof value === "string" ? value.trim() : "";
  return id.length > 0 ? id : undefined;
}

function normalizeDependsOn(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
}

function getStatusCounts(tasks: ProjectTaskItem[]): BoardLongRunReadiness["totals"] {
  return {
    tasks: tasks.length,
    planned: tasks.filter((t) => t.status === "planned").length,
    inProgress: tasks.filter((t) => t.status === "in-progress").length,
    completed: tasks.filter((t) => t.status === "completed").length,
    blocked: tasks.filter((t) => t.status === "blocked").length,
    cancelled: tasks.filter((t) => t.status === "cancelled").length,
  };
}

function resolvePriorityRank(task: ProjectTaskItem): number {
  const description = typeof task.description === "string" ? task.description : "";
  const match = description.match(/\[(P\d+)\]/i);
  if (!match?.[1]) return 9;
  const numeric = Number(match[1].slice(1));
  if (!Number.isFinite(numeric) || numeric < 0) return 9;
  return Math.min(9, Math.floor(numeric));
}

function compareEligibleTasks(a: ProjectTaskItem, b: ProjectTaskItem): number {
  const byPriority = resolvePriorityRank(a) - resolvePriorityRank(b);
  if (byPriority !== 0) return byPriority;

  const idA = normalizeTaskId(a.id) ?? "";
  const idB = normalizeTaskId(b.id) ?? "";
  return idA.localeCompare(idB);
}

export function evaluateBoardLongRunReadiness(
  cwd: string,
  options?: { sampleLimit?: number },
): BoardLongRunReadiness {
  const sampleLimit = clampSampleLimit(options?.sampleLimit, 3);
  const tasks = readProjectTasksBlock(cwd).tasks.filter(
    (task) => normalizeTaskId(task.id) !== undefined,
  );
  const counts = getStatusCounts(tasks);

  const completed = new Set(
    tasks
      .filter((t) => t.status === "completed")
      .map((t) => normalizeTaskId(t.id))
      .filter((id): id is string => Boolean(id)),
  );

  const planned = tasks.filter((t) => t.status === "planned");
  const eligible = planned
    .filter((task) => {
      const deps = normalizeDependsOn(task.depends_on);
      if (deps.length === 0) return true;
      return deps.every((dep) => completed.has(dep));
    })
    .sort(compareEligibleTasks);

  const blockedByDependencies = planned.filter((task) => {
    const deps = normalizeDependsOn(task.depends_on);
    return deps.length > 0 && !deps.every((dep) => completed.has(dep));
  }).length;

  if (eligible.length > 0) {
    const eligibleTaskIds = eligible
      .map((t) => normalizeTaskId(t.id))
      .filter((id): id is string => Boolean(id));
    return {
      ready: true,
      reason: "ready",
      recommendation:
        "board ready: execute next planned task(s) with dependencies satisfied.",
      selectionPolicy: "planned+deps+priority(P0..Pn)+id",
      nextTaskId: eligibleTaskIds[0],
      totals: counts,
      eligibleTaskIds: eligibleTaskIds.slice(0, sampleLimit),
      blockedByDependencies,
    };
  }

  if (planned.length === 0) {
    return {
      ready: false,
      reason: "no-planned-tasks",
      recommendation:
        "board not ready: add/decompose planned tasks before unattended long-run.",
      selectionPolicy: "planned+deps+priority(P0..Pn)+id",
      nextTaskId: undefined,
      totals: counts,
      eligibleTaskIds: [],
      blockedByDependencies,
    };
  }

  return {
    ready: false,
    reason: "no-eligible-planned-tasks",
    recommendation:
      blockedByDependencies > 0
        ? "board not ready: unblock dependency chain or decompose next executable slice."
        : "board not ready: decompose planned work into executable slices.",
    selectionPolicy: "planned+deps+priority(P0..Pn)+id",
    nextTaskId: undefined,
    totals: counts,
    eligibleTaskIds: [],
    blockedByDependencies,
  };
}

export function buildBoardReadinessStatusLabel(readiness: BoardLongRunReadiness): string {
  const eligible = readiness.eligibleTaskIds.length;
  const nextTask = readiness.nextTaskId ? ` next=${readiness.nextTaskId}` : "";
  return `boardReady=${readiness.ready ? "yes" : "no"} eligible=${eligible} planned=${readiness.totals.planned} blockedDeps=${readiness.blockedByDependencies}${nextTask}`;
}

export function buildBoardExecuteTaskIntentText(taskId: string): string {
  const intent = buildBoardExecuteTaskIntent(taskId);
  if (!intent) return "[intent:board.execute-task]";
  return encodeGuardrailsIntent(intent);
}
