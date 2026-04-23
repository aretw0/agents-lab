export const GUARDRAILS_INTENT_VERSION = 1;

export interface BoardExecuteTaskIntent {
  version: 1;
  type: "board.execute-task";
  taskId: string;
  mode: "board-first";
  contract: "no-auto-close+verification";
}

export type GuardrailsIntent = BoardExecuteTaskIntent;

export interface ParsedGuardrailsIntent {
  ok: boolean;
  intent?: GuardrailsIntent;
  reason?:
    | "empty"
    | "missing-header"
    | "invalid-header"
    | "unsupported-type"
    | "missing-task-id";
  rawType?: string;
}

function normalizeTaskId(value: unknown): string | undefined {
  const id = typeof value === "string" ? value.trim() : "";
  return id.length > 0 ? id : undefined;
}

function readIntentHeader(line: string): string | undefined {
  const trimmed = line.trim();
  const match = trimmed.match(/^\[intent:([a-z0-9._-]+)\]$/i);
  if (!match?.[1]) return undefined;
  return match[1].toLowerCase();
}

function parseKeyValueLines(lines: string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const value = trimmed.slice(eq + 1).trim();
    if (!key || !value) continue;
    fields[key] = value;
  }
  return fields;
}

export function buildBoardExecuteTaskIntent(taskId: string): BoardExecuteTaskIntent | undefined {
  const id = normalizeTaskId(taskId);
  if (!id) return undefined;
  return {
    version: GUARDRAILS_INTENT_VERSION,
    type: "board.execute-task",
    taskId: id,
    mode: "board-first",
    contract: "no-auto-close+verification",
  };
}

export function encodeGuardrailsIntent(intent: GuardrailsIntent): string {
  if (intent.type === "board.execute-task") {
    return [
      `[intent:${intent.type}]`,
      `version=${intent.version}`,
      `task_id=${intent.taskId}`,
      `mode=${intent.mode}`,
      `contract=${intent.contract}`,
    ].join("\n");
  }

  return `[intent:unknown]`;
}

export function parseGuardrailsIntent(text: string): ParsedGuardrailsIntent {
  const input = String(text ?? "").trim();
  if (!input) return { ok: false, reason: "empty" };

  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) return { ok: false, reason: "empty" };

  const header = readIntentHeader(lines[0]);
  if (!lines[0].startsWith("[intent:")) return { ok: false, reason: "missing-header" };
  if (!header) return { ok: false, reason: "invalid-header" };

  const fields = parseKeyValueLines(lines.slice(1));

  if (header === "board.execute-task") {
    const taskId = normalizeTaskId(fields.task_id);
    if (!taskId) {
      return { ok: false, reason: "missing-task-id", rawType: header };
    }
    const intent = buildBoardExecuteTaskIntent(taskId);
    if (!intent) {
      return { ok: false, reason: "missing-task-id", rawType: header };
    }
    return { ok: true, intent, rawType: header };
  }

  return { ok: false, reason: "unsupported-type", rawType: header };
}

export function summarizeGuardrailsIntent(intent: GuardrailsIntent): string {
  if (intent.type === "board.execute-task") {
    return `${intent.type} task=${intent.taskId} mode=${intent.mode}`;
  }
  return "unknown-intent";
}

export function buildGuardrailsIntentSystemPrompt(intent: GuardrailsIntent): string[] {
  if (intent.type === "board.execute-task") {
    return [
      "Canonical intent envelope detected: board-first execution is active for this turn.",
      `- intent: ${intent.type} (task_id=${intent.taskId}, version=${intent.version})`,
      "- execute this task as the primary lane objective, keeping changes minimal and reversible.",
      "- preserve contract: no-auto-close + verification evidence before any completion update.",
      "- if blocked, report explicit blocker + minimal decomposition proposal instead of broad reframing.",
    ];
  }

  return ["Canonical intent envelope detected."];
}
