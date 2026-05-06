import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { type AutonomyContextLevel } from "./guardrails-core-autonomy-lane";
import {
  evaluateAutonomyLaneTaskSelection,
  readAutonomyHandoffFocusTaskIds,
} from "./guardrails-core-autonomy-task-selector";
import { readProjectTasksBlock, type ProjectTaskItem } from "./colony-pilot-task-sync";
import { resolveHandoffFreshness, type HandoffFreshnessLabel } from "./context-watchdog-handoff";
import { readGitDirtySnapshot } from "./guardrails-core-git-maintenance-surface";

export function normalizeContextLevel(value: unknown): AutonomyContextLevel {
  return value === "compact" || value === "checkpoint" || value === "warn" || value === "ok" ? value : "ok";
}

export function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function asNumber(value: unknown, fallback: number): number {
  const raw = Number(value);
  return Number.isFinite(raw) ? raw : fallback;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

const DEFAULT_HANDOFF_FRESH_MAX_AGE_MS = 30 * 60 * 1000;

type LocalSafeChainingDecision = {
  active: boolean;
  decision: "active" | "blocked";
  recommendationCode:
    | "autonomy-chaining-active"
    | "autonomy-chaining-blocked-compact"
    | "autonomy-chaining-blocked-selection"
    | "autonomy-chaining-blocked-plan"
    | "autonomy-chaining-blocked-handoff-freshness";
  blockedReasons: string[];
  handoffFreshness: HandoffFreshnessLabel;
  nextAction: string;
  nextTaskId?: string;
};

type AutonomyOperatorPauseOption = {
  option: string;
  impact: string;
};

type AutonomyOperatorPauseBrief = {
  whyPaused: string;
  nextTaskId?: string;
  nextTaskMnemonic?: string;
  seedingCue?: {
    seedCount: number;
    seedWhy: string;
    seedPriority: string;
  };
  options: AutonomyOperatorPauseOption[];
  recommendation: string;
};

type AutonomyIterationReminder = {
  source: "seed-guidance" | "handoff-stale" | "handoff-next-actions" | "handoff-current-tasks" | "none";
  items: string[];
  summary: string;
};

export function readJsonRecord(filePath: string): Record<string, unknown> | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeIterationReminderItem(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > 96 ? `${compact.slice(0, 93)}...` : compact;
}

export function isCompletedReloadReminderItem(item: string): boolean {
  return /(?:^|\s)(?:rodar|run|apply|aplicar)?\s*\/?reload\b/i.test(item);
}

export function buildIterationReminder(
  cwd: string,
  handoffFreshnessLabel?: HandoffFreshnessLabel,
  seedingGuidance?: {
    decision?: string;
    seedWhy?: string;
    seedPriority?: string;
    suggestedSeedCount?: number;
    humanActionRequired?: boolean;
  },
): AutonomyIterationReminder {
  if (handoffFreshnessLabel === "stale") {
    return {
      source: "handoff-stale",
      items: ["refresh-handoff checkpoint evidence before next slice"],
      summary: "refresh-handoff checkpoint evidence before next slice",
    };
  }

  if (seedingGuidance?.decision === "seed-now") {
    const suggested = Number.isFinite(seedingGuidance.suggestedSeedCount)
      ? Math.max(1, Math.floor(Number(seedingGuidance.suggestedSeedCount)))
      : 1;
    const item = `seed local-safe (${suggested}) seedWhy=${seedingGuidance.seedWhy ?? "unknown"} seedPriority=${seedingGuidance.seedPriority ?? "unknown"}`;
    return {
      source: "seed-guidance",
      items: [item],
      summary: item,
    };
  }

  const handoff = readJsonRecord(path.join(cwd, ".project", "handoff.json"));
  const fromNextActions = Array.isArray(handoff?.next_actions)
    ? handoff.next_actions
      .map((item) => normalizeIterationReminderItem(item))
      .filter((item): item is string => Boolean(item))
      .filter((item) => !isCompletedReloadReminderItem(item))
    : [];

  if (fromNextActions.length > 0) {
    const items = fromNextActions.slice(0, 2);
    return {
      source: "handoff-next-actions",
      items,
      summary: items.join(" | "),
    };
  }

  const fromCurrentTasks = Array.isArray(handoff?.current_tasks)
    ? handoff.current_tasks
      .map((item) => normalizeIterationReminderItem(item))
      .filter((item): item is string => Boolean(item))
      .map((taskId) => `focus ${taskId}`)
    : [];

  if (fromCurrentTasks.length > 0) {
    const items = fromCurrentTasks.slice(0, 2);
    return {
      source: "handoff-current-tasks",
      items,
      summary: items.join(" | "),
    };
  }

  return {
    source: "none",
    items: [],
    summary: "none",
  };
}

export function readContextWatchHandoffFreshMaxAgeMs(cwd: string): number {
  const settings = readJsonRecord(path.join(cwd, ".pi", "settings.json"));
  const piStack = settings?.piStack;
  const contextWatchdog = piStack && typeof piStack === "object"
    ? (piStack as Record<string, unknown>).contextWatchdog
    : undefined;
  const raw = contextWatchdog && typeof contextWatchdog === "object"
    ? Number((contextWatchdog as Record<string, unknown>).handoffFreshMaxAgeMs)
    : Number.NaN;
  if (!Number.isFinite(raw)) return DEFAULT_HANDOFF_FRESH_MAX_AGE_MS;
  return Math.max(60_000, Math.floor(raw));
}

export function readHandoffFreshnessSignal(cwd: string): { label: HandoffFreshnessLabel; ageMs?: number; maxAgeMs: number } {
  const handoff = readJsonRecord(path.join(cwd, ".project", "handoff.json"));
  const timestampIso = typeof handoff?.timestamp === "string" ? handoff.timestamp : undefined;
  const maxAgeMs = readContextWatchHandoffFreshMaxAgeMs(cwd);
  const freshness = resolveHandoffFreshness(timestampIso, Date.now(), maxAgeMs);
  return {
    label: freshness.label,
    ageMs: freshness.ageMs,
    maxAgeMs,
  };
}

export function resolveLocalSafeChainingDecision(input: {
  contextLevel: AutonomyContextLevel;
  planReady: boolean;
  selectionReady: boolean;
  selectionReason: string;
  nextTaskId?: string;
  handoffFreshness: HandoffFreshnessLabel;
}): LocalSafeChainingDecision {
  const blockedReasons: string[] = [];
  if (input.contextLevel === "compact") blockedReasons.push("context-compact");
  if (!input.planReady) blockedReasons.push("plan-not-ready");
  if (!input.selectionReady) blockedReasons.push(`selection-${input.selectionReason || "not-ready"}`);
  if (input.handoffFreshness !== "fresh") blockedReasons.push(`handoff-${input.handoffFreshness}`);

  if (blockedReasons.length === 0) {
    return {
      active: true,
      decision: "active",
      recommendationCode: "autonomy-chaining-active",
      blockedReasons,
      handoffFreshness: input.handoffFreshness,
      nextTaskId: input.nextTaskId,
      nextAction: `continue chained local-safe slices until compact boundary; next=${input.nextTaskId ?? "none"}.`,
    };
  }

  const recommendationCode = blockedReasons.includes("context-compact")
    ? "autonomy-chaining-blocked-compact"
    : blockedReasons.some((reason) => reason.startsWith("selection-"))
      ? "autonomy-chaining-blocked-selection"
      : blockedReasons.some((reason) => reason.startsWith("plan-"))
        ? "autonomy-chaining-blocked-plan"
        : "autonomy-chaining-blocked-handoff-freshness";

  const nextAction = blockedReasons.includes("context-compact")
    ? "stop starting new slices and let compact/auto-resume finish before continuing chain."
    : blockedReasons.some((reason) => reason.startsWith("handoff-"))
      ? "refresh handoff checkpoint evidence, then continue chained local-safe slices."
      : blockedReasons.some((reason) => reason.startsWith("selection-"))
        ? "resolve local-safe task selection before continuing chain."
        : "resolve runtime lane blockers before continuing chain.";

  return {
    active: false,
    decision: "blocked",
    recommendationCode,
    blockedReasons,
    handoffFreshness: input.handoffFreshness,
    nextTaskId: input.nextTaskId,
    nextAction,
  };
}

export function resolveFocusTaskIds(p: Record<string, unknown>, cwd: string): { ids: string[]; source?: "explicit" | "handoff" } {
  const explicit = asStringArray(p.focus_task_ids);
  if (explicit.length > 0) return { ids: explicit, source: "explicit" };
  if (p.use_handoff_focus === false) return { ids: [] };
  const handoff = readAutonomyHandoffFocusTaskIds(cwd);
  return handoff.length > 0 ? { ids: handoff, source: "handoff" } : { ids: [] };
}

export function normalizeTaskId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function findTaskById(tasks: ProjectTaskItem[], taskId: string): ProjectTaskItem | undefined {
  const normalized = normalizeTaskId(taskId);
  if (!normalized) return undefined;
  return tasks.find((task) => normalizeTaskId(task.id) === normalized);
}

export function toTaskMnemonic(task: ProjectTaskItem | undefined): string | undefined {
  if (!task) return undefined;
  const taskId = normalizeTaskId(task.id);
  if (!taskId) return undefined;
  const cleanedDescription = String(task.description ?? "")
    .replace(/\[[^\]]+\]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const shortDescription = cleanedDescription.length > 0
    ? cleanedDescription.split(/[.;]/)[0].trim().slice(0, 72)
    : "";
  return shortDescription.length > 0 ? `${taskId}:${shortDescription}` : taskId;
}

export function buildAutonomyOperatorPauseBrief(input: {
  selectionReady: boolean;
  selectionReason: string;
  selectionRecommendation: string;
  includeProtectedScopes: boolean;
  handoffFreshness: HandoffFreshnessLabel;
  seedingGuidance?: {
    suggestedSeedCount?: number;
    seedWhy?: string;
    seedPriority?: string;
  };
  nextTaskId?: string;
  nextTaskMnemonic?: string;
}): AutonomyOperatorPauseBrief {
  const seedingCue = input.seedingGuidance
    ? {
      seedCount: Number.isFinite(input.seedingGuidance.suggestedSeedCount)
        ? Math.max(1, Math.floor(Number(input.seedingGuidance.suggestedSeedCount)))
        : 1,
      seedWhy: input.seedingGuidance.seedWhy ?? "unknown",
      seedPriority: input.seedingGuidance.seedPriority ?? "unknown",
    }
    : undefined;
  if (input.selectionReady) {
    return {
      whyPaused: "No pause gate: bounded local-safe task is ready.",
      nextTaskId: input.nextTaskId,
      nextTaskMnemonic: input.nextTaskMnemonic,
      options: [
        { option: "continue", impact: "Execute next bounded local-safe slice now." },
        { option: "checkpoint", impact: "Persist short checkpoint before starting the slice." },
      ],
      recommendation: "continue",
    };
  }

  if (input.selectionReason === "no-eligible-tasks" && input.includeProtectedScopes !== true) {
    if (input.handoffFreshness === "stale") {
      return {
        whyPaused: "No eligible local-safe tasks remain and handoff is stale.",
        seedingCue,
        options: [
          { option: "refresh-handoff", impact: "Write fresh checkpoint evidence before reseeding/continuing." },
          { option: "seed-local-safe", impact: "Create 1-3 bounded local-safe tasks after handoff refresh." },
        ],
        recommendation: "refresh-handoff",
      };
    }

    return {
      whyPaused: "No eligible local-safe tasks remain in current selection policy.",
      seedingCue,
      options: [
        { option: "seed-local-safe", impact: "Create 1-3 bounded local-safe tasks and resume chaining." },
        { option: "choose-protected-focus", impact: "Explicitly opt-in protected scope for the next slice." },
      ],
      recommendation: "seed-local-safe",
    };
  }

  return {
    whyPaused: input.selectionRecommendation,
    nextTaskId: input.nextTaskId,
    nextTaskMnemonic: input.nextTaskMnemonic,
    options: [
      { option: "resolve-blockers", impact: "Address current selection blockers and retry status." },
      { option: "checkpoint", impact: "Persist context and re-evaluate after checkpoint." },
    ],
    recommendation: "resolve-blockers",
  };
}

export function taskHasProtectedSignal(task: ProjectTaskItem): boolean {
  const haystack = [task.description, ...(task.files ?? [])].join("\n").toLowerCase();
  return /(\.github\/|\.obsidian\/|\.pi\/settings\.json|\bgithub actions\b|\bremote\b|\bpublish\b|https?:\/\/|\bci\b)/i.test(haystack);
}

export function taskHasRiskSignal(task: ProjectTaskItem): boolean {
  const text = [task.description, task.notes ?? "", ...(task.acceptance_criteria ?? []), ...(task.files ?? [])].join("\n").toLowerCase();
  if (taskHasProtectedSignal(task)) return true;
  if ((task.files?.length ?? 0) >= 9) return true;
  return /\b(delete|destroy|drop\s+table|rm\s+-rf|force\s+push|destructive|irreversible|dangerous)\b/i.test(text);
}

export function taskValidationGateKnown(task: ProjectTaskItem): boolean {
  const text = [task.description, ...(task.acceptance_criteria ?? []), ...(task.files ?? [])].join("\n").toLowerCase();
  return /(smoke|test|spec|vitest|marker-check|inspection|lint|typecheck|build)/i.test(text);
}

export function workspaceLooksClean(cwd: string): boolean {
  try {
    return readGitDirtySnapshot(cwd).clean;
  } catch {
    return false;
  }
}

export function resolveAutoAdvanceFailClosedReasons(input: {
  cwd: string;
  params: Record<string, unknown>;
  nextTask?: ProjectTaskItem;
}): string[] {
  const reasons: string[] = [];
  if (input.params.include_protected_scopes === true) reasons.push("protected-opt-in");
  if (!workspaceLooksClean(input.cwd)) reasons.push("reload-required-or-dirty");
  if (!input.nextTask) {
    reasons.push("next-task-not-found");
    return reasons;
  }
  if (taskHasProtectedSignal(input.nextTask)) reasons.push("protected-task");
  if (taskHasRiskSignal(input.nextTask)) reasons.push("risk-signal");
  if (!taskValidationGateKnown(input.nextTask)) reasons.push("validation-gate-unknown");
  return reasons;
}

export function normalizeDependsOn(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeTaskId(item))
    .filter((item): item is string => Boolean(item));
}
