export type TaskContractLike = {
  id?: unknown;
  description?: unknown;
  notes?: unknown;
  acceptance_criteria?: unknown;
  files?: unknown;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function normalizeTaskId(value: unknown): string | undefined {
  const id = typeof value === "string" ? value.trim() : "";
  return id.length > 0 ? id : undefined;
}

export function normalizeTaskDependencyIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeTaskId(item))
    .filter((item): item is string => Boolean(item));
}

export function taskContractText(task: TaskContractLike, fields: Array<keyof TaskContractLike>): string {
  const parts: string[] = [];
  for (const field of fields) {
    const value = task[field];
    if (typeof value === "string") parts.push(value);
    if (field === "acceptance_criteria" || field === "files") parts.push(...asStringArray(value));
  }
  return parts.join("\n").toLowerCase();
}

export function taskHasLocalProtectedSignal(task: TaskContractLike): boolean {
  const haystack = taskContractText(task, ["description", "files"]);
  return /(\.github\/|\.obsidian\/|\.pi\/settings\.json|\bgithub actions\b|\bremote\b|\bpublish\b|https?:\/\/|\bci\b)/i.test(haystack);
}

export function taskHasLocalRiskSignal(task: TaskContractLike): boolean {
  if (taskHasLocalProtectedSignal(task)) return true;
  if (asStringArray(task.files).length >= 9) return true;
  const text = taskContractText(task, ["description", "notes", "acceptance_criteria", "files"]);
  return /\b(delete|destroy|drop\s+table|rm\s+-rf|force\s+push|destructive|irreversible|dangerous)\b/i.test(text);
}

export function taskValidationGateKnown(task: TaskContractLike): boolean {
  const text = taskContractText(task, ["description", "acceptance_criteria", "files"]);
  return /(smoke|test|spec|vitest|marker-check|inspection|lint|typecheck|build)/i.test(text);
}
