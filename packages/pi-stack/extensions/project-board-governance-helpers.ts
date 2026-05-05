import {
  isRationaleSensitiveTask,
  type TaskRecord,
  type VerificationRecord,
} from "./project-board-model";

export type ProjectTaskDependencyRecommendationCode =
  | "dependency-update-ready"
  | "dependency-update-blocked-missing"
  | "dependency-update-blocked-cycle"
  | "dependency-update-blocked-protected-coupling"
  | "dependency-update-invalid-input";

interface TaskDependencyDiagnostics {
  missingDependencies: string[];
  cycleDependencies: string[];
  protectedDependencyIds: string[];
  blockers: string[];
  recommendationCode: ProjectTaskDependencyRecommendationCode;
  recommendation: string;
}

export function normalizeDependencyIdList(value: unknown, max = 30): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || out.includes(id)) continue;
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

function taskDependsOnPath(tasksById: Map<string, TaskRecord>, fromId: string, targetId: string, seen = new Set<string>()): boolean {
  if (fromId === targetId) return true;
  if (seen.has(fromId)) return false;
  seen.add(fromId);
  const task = tasksById.get(fromId);
  for (const dep of task?.depends_on ?? []) {
    if (dep === targetId) return true;
    if (taskDependsOnPath(tasksById, dep, targetId, seen)) return true;
  }
  return false;
}

function resolveProjectTaskDependencyRecommendation(blockers: string[]): {
  recommendationCode: ProjectTaskDependencyRecommendationCode;
  recommendation: string;
} {
  if (blockers.includes("local-safe-depends-on-protected")) {
    return {
      recommendationCode: "dependency-update-blocked-protected-coupling",
      recommendation: "Replaneje para remover acoplamento local-safe -> protected ou promova a task para fluxo protected com decisão humana explícita.",
    };
  }
  if (blockers.includes("dependency-cycle")) {
    return {
      recommendationCode: "dependency-update-blocked-cycle",
      recommendation: "Quebre o ciclo de dependências em tarefas menores antes de aplicar.",
    };
  }
  if (blockers.includes("missing-dependencies")) {
    return {
      recommendationCode: "dependency-update-blocked-missing",
      recommendation: "Crie/reconcilie as tarefas faltantes antes de aplicar dependências.",
    };
  }
  return {
    recommendationCode: "dependency-update-ready",
    recommendation: "Dependências consistentes; pode aplicar update mantendo validação focal bounded.",
  };
}

export function diagnoseTaskDependencyBlockers(
  taskId: string,
  currentTask: TaskRecord,
  dependencyIds: string[],
  tasksById: Map<string, TaskRecord>,
): TaskDependencyDiagnostics {
  const missingDependencies = dependencyIds.filter((dep) => !tasksById.has(dep));
  const cycleDependencies = dependencyIds.filter((dep) => dep === taskId || taskDependsOnPath(tasksById, dep, taskId));
  const protectedDependencyIds = taskDependsOnProtectedScope(currentTask, dependencyIds, tasksById);
  const blockers = [
    missingDependencies.length > 0 ? "missing-dependencies" : undefined,
    cycleDependencies.length > 0 ? "dependency-cycle" : undefined,
    protectedDependencyIds.length > 0 ? "local-safe-depends-on-protected" : undefined,
  ].filter(Boolean) as string[];
  const recommendation = resolveProjectTaskDependencyRecommendation(blockers);
  return {
    missingDependencies,
    cycleDependencies,
    protectedDependencyIds,
    blockers,
    recommendationCode: recommendation.recommendationCode,
    recommendation: recommendation.recommendation,
  };
}

function taskHasProtectedFiles(task: TaskRecord): boolean {
  return (task.files ?? []).some((file) => /(^|\/)(\.github|\.obsidian)(\/|$)|(^|\/)\.pi\/settings\.json$/i.test(file));
}

function isProtectedParkedMilestone(value: string | undefined): boolean {
  if (!value) return false;
  return /(^|[-_])protected[-_]parked/i.test(value);
}

function taskHasProtectedScopeSignals(task: TaskRecord): boolean {
  if (isProtectedParkedMilestone(task.milestone)) return true;
  if (taskHasProtectedFiles(task)) return true;

  const text = [task.description, task.notes ?? ""].join("\n").toLowerCase();
  if (/\bgithub\s+actions\b|\bremote\s+(?:compute|execution|runner|runners)\b|\bpublish\b|\bci\b/.test(text)) return true;
  if (/https?:\/\//.test(text)) return true;
  if (/\bcolony\b.*\b(?:promotion|promote|recovery|recover|materializa[cç][aã]o)\b|\b(?:promotion|promote|recovery|recover)\b.*\bcolony\b/.test(text)) return true;
  if (/\b(?:research|pesquisa)\b.*\b(?:extern[ao]|external|web|internet|url|fonte(?:s)?|source|influ[eê]ncia|inspiration|inspira[cç][aã]o|prior\s*art)\b/.test(text)) return true;
  return false;
}

export function taskDependsOnProtectedScope(task: TaskRecord, dependencyIds: string[], tasksById: Map<string, TaskRecord>): string[] {
  if (taskHasProtectedScopeSignals(task)) return [];
  const blocked: string[] = [];
  for (const dep of dependencyIds) {
    const dependencyTask = tasksById.get(dep);
    if (!dependencyTask) continue;
    if (taskHasProtectedScopeSignals(dependencyTask)) blocked.push(dep);
  }
  return blocked;
}

export function isBroadTaskCandidate(task: TaskRecord): { macro: boolean; signals: string[] } {
  const text = [task.id, task.description, task.notes ?? "", task.milestone ?? ""].join("\n").toLowerCase();
  const signals = [
    /macro|ampla|protegida|multi-modo|ininterrupta|unattended|overnight|long-run|pipeline|sistema|gate|governança/.test(text) ? "broad-language" : undefined,
    (task.files?.length ?? 0) >= 5 ? "many-files" : undefined,
    (task.acceptance_criteria?.length ?? 0) >= 3 ? "multi-criteria" : undefined,
    taskHasProtectedFiles(task) ? "protected-scope" : undefined,
    isRationaleSensitiveTask(task) ? "rationale-sensitive" : undefined,
  ].filter(Boolean) as string[];
  return { macro: signals.length >= 2 || signals.includes("protected-scope"), signals };
}

export function verificationLooksPartial(row: VerificationRecord): boolean {
  const text = [row.status ?? "", row.method ?? "", row.evidence ?? ""].join("\n").toLowerCase();
  return row.status === "partial" || /parcial|partial|slice|fatia|policy-only|read-only|evidência parcial|evidence partial/.test(text);
}

export function scoreRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
}

export function normalizePositiveInt(value: unknown, fallback: number, max = 100): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const rounded = Math.floor(value);
  if (rounded <= 0) return fallback;
  return Math.min(max, rounded);
}
