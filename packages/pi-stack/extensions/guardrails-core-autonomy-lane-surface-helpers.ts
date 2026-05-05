import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
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

function asStringArray(value: unknown): string[] {
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

function readJsonRecord(filePath: string): Record<string, unknown> | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function normalizeIterationReminderItem(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > 96 ? `${compact.slice(0, 93)}...` : compact;
}

function isCompletedReloadReminderItem(item: string): boolean {
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

function readContextWatchHandoffFreshMaxAgeMs(cwd: string): number {
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

function resolveFocusTaskIds(p: Record<string, unknown>, cwd: string): { ids: string[]; source?: "explicit" | "handoff" } {
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

function taskHasRiskSignal(task: ProjectTaskItem): boolean {
  const text = [task.description, task.notes ?? "", ...(task.acceptance_criteria ?? []), ...(task.files ?? [])].join("\n").toLowerCase();
  if (taskHasProtectedSignal(task)) return true;
  if ((task.files?.length ?? 0) >= 9) return true;
  return /\b(delete|destroy|drop\s+table|rm\s+-rf|force\s+push|destructive|irreversible|dangerous)\b/i.test(text);
}

function taskValidationGateKnown(task: ProjectTaskItem): boolean {
  const text = [task.description, ...(task.acceptance_criteria ?? []), ...(task.files ?? [])].join("\n").toLowerCase();
  return /(smoke|test|spec|vitest|marker-check|inspection|lint|typecheck|build)/i.test(text);
}

function workspaceLooksClean(cwd: string): boolean {
  try {
    return readGitDirtySnapshot(cwd).clean;
  } catch {
    return false;
  }
}

function resolveAutoAdvanceFailClosedReasons(input: {
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

function normalizeDependsOn(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeTaskId(item))
    .filter((item): item is string => Boolean(item));
}

export function buildAfkMaterialReadinessPacket(p: Record<string, unknown>, cwd: string) {
  const focus = resolveFocusTaskIds(p, cwd);
  const milestone = typeof p.milestone === "string" ? p.milestone : undefined;
  const includeProtectedScopes = p.include_protected_scopes === true;
  const includeMissingRationale = p.include_missing_rationale === true;
  const sampleLimit = asNumber(p.sample_limit, 10);
  const minReadySlices = Math.max(1, Math.min(20, Math.floor(asNumber(p.min_ready_slices, 3))));
  const targetSlices = Math.max(minReadySlices, Math.min(20, Math.floor(asNumber(p.target_slices, 7))));

  const selection = resolveTaskSelection(p, cwd);
  const tasks = readProjectTasksBlock(cwd).tasks;
  const completedTaskIds = new Set(
    tasks
      .filter((task) => task.status === "completed")
      .map((task) => normalizeTaskId(task.id))
      .filter((id): id is string => Boolean(id)),
  );

  const inScope = tasks.filter((task) => {
    if (task.status !== "planned" && task.status !== "in-progress") return false;
    if (!milestone) return true;
    return (task.milestone ?? "").trim() === milestone;
  });

  const localSafe = inScope.filter((task) => {
    if (!includeProtectedScopes && taskHasProtectedSignal(task)) return false;
    if (taskHasRiskSignal(task)) return false;
    const deps = normalizeDependsOn(task.depends_on);
    return deps.every((dep) => completedTaskIds.has(dep));
  });

  const validationKnown = localSafe.filter((task) => taskValidationGateKnown(task));

  const focusTasks = focus.ids
    .map((taskId) => findTaskById(tasks, taskId))
    .filter((task): task is ProjectTaskItem => Boolean(task));
  const focusKnown = focus.ids.length > 0 && focusTasks.length === focus.ids.length;
  const focusValidationKnown = focusKnown && focusTasks.every((task) => taskValidationGateKnown(task));

  const blockedReasons: string[] = [];
  if (focus.ids.length <= 0) blockedReasons.push("focus-missing");
  else if (!focusKnown) blockedReasons.push("focus-task-not-found");
  else if (!focusValidationKnown) blockedReasons.push("focus-validation-unknown");

  if (!workspaceLooksClean(cwd)) blockedReasons.push("reload-required-or-dirty");

  if (validationKnown.length <= 0) blockedReasons.push("no-local-safe-material");
  if (!selection.ready) blockedReasons.push(`selection-${selection.reason}`);
  if (!includeMissingRationale && selection.totals.skippedMissingRationale > 0) blockedReasons.push("missing-rationale-slices-present");

  let decision: "continue" | "seed-backlog" | "blocked" = "continue";
  let recommendationCode = "afk-material-readiness-continue-stock-healthy";
  let nextAction = "continue bounded AFK batch; material stock and validation coverage are healthy.";

  if (blockedReasons.length > 0) {
    decision = "blocked";
    if (blockedReasons.some((reason) => reason.startsWith("focus-"))) {
      recommendationCode = "afk-material-readiness-blocked-focus";
      nextAction = "restore a valid single focus with known validation before AFK continuation.";
    } else if (blockedReasons.includes("reload-required-or-dirty")) {
      recommendationCode = "afk-material-readiness-blocked-reload-or-dirty";
      nextAction = "clean workspace/reload before AFK continuation.";
    } else if (blockedReasons.includes("no-local-safe-material")) {
      recommendationCode = "afk-material-readiness-blocked-no-material";
      nextAction = "seed local-safe backlog first (brainstorm packet + seed preview + human decision).";
    } else {
      recommendationCode = "afk-material-readiness-blocked-selection";
      nextAction = "resolve selection blockers before AFK continuation.";
    }
  } else if (validationKnown.length < minReadySlices) {
    decision = "seed-backlog";
    recommendationCode = "afk-material-readiness-seed-backlog-low-stock";
    nextAction = `material stock below target (${validationKnown.length}/${minReadySlices}); run brainstorm+seed flow before next AFK batch.`;
  }

  const validationCoveragePct = localSafe.length > 0
    ? Math.round((validationKnown.length / localSafe.length) * 100)
    : 0;
  const stockGap = Math.max(0, targetSlices - validationKnown.length);
  const recommendedSeedCount = stockGap > 0
    ? Math.max(1, Math.min(6, stockGap))
    : 0;

  const summary = [
    "afk-material-readiness:",
    `decision=${decision}`,
    `code=${recommendationCode}`,
    `focus=${focus.ids.join(",") || "none"}`,
    `localSafe=${localSafe.length}`,
    `validationKnown=${validationKnown.length}`,
    `minReady=${minReadySlices}`,
    `target=${targetSlices}`,
    `stockGap=${stockGap}`,
    `recommendedSeedCount=${recommendedSeedCount}`,
    decision === "blocked" ? `blockers=${blockedReasons.join("|")}` : undefined,
    "authorization=none",
  ].filter(Boolean).join(" ");

  return {
    mode: "report-only",
    decision,
    recommendationCode,
    nextAction,
    focusTaskIds: focus.ids,
    focusSource: focus.source,
    nextTaskId: selection.nextTaskId,
    selectionReason: selection.reason,
    eligibleTaskIds: selection.eligibleTaskIds,
    material: {
      minReadySlices,
      targetSlices,
      stockGap,
      recommendedSeedCount,
      localSafeCount: localSafe.length,
      validationKnownCount: validationKnown.length,
      validationCoveragePct,
      localSafeTaskIds: localSafe.map((task) => normalizeTaskId(task.id)).filter((id): id is string => Boolean(id)).slice(0, 20),
      validationKnownTaskIds: validationKnown.map((task) => normalizeTaskId(task.id)).filter((id): id is string => Boolean(id)).slice(0, 20),
    },
    blockedReasons,
    dispatchAllowed: false,
    mutationAllowed: false,
    authorization: "none",
    summary,
  };
}

function buildBootstrapSeedTemplates(input: { suggestedSeedCount: number; maxSeedSlices: number }): Array<{
  id: string;
  description: string;
  validationGate: string;
  rollback: string;
  filesHint: string[];
}> {
  const templates = [
    {
      id: "seed-local-safe-smoke-guard",
      description: "Adicionar/ajustar um smoke test local-safe para reduzir regressão de surface crítica.",
      validationGate: "npm run test:smoke -- <suite-focal>",
      rollback: "git restore -- <arquivo(s)>",
      filesHint: ["packages/pi-stack/test/smoke/<suite>.test.ts"],
    },
    {
      id: "seed-status-summary-clarity",
      description: "Melhorar resumo/status report-only para reduzir nudge operacional sem mudar autorização.",
      validationGate: "marker-check + smoke focal",
      rollback: "git checkout -- <arquivo(s)>",
      filesHint: ["packages/pi-stack/extensions/<surface>.ts", "packages/pi-stack/test/smoke/<surface>.test.ts"],
    },
    {
      id: "seed-readonly-observability",
      description: "Adicionar campo de observabilidade read-only para diagnóstico de bloqueio/decisão.",
      validationGate: "smoke de payload details",
      rollback: "git restore --source=HEAD -- <arquivo(s)>",
      filesHint: ["packages/pi-stack/extensions/<surface>.ts", "packages/pi-stack/test/smoke/<surface>.test.ts"],
    },
    {
      id: "seed-doc-sync-short",
      description: "Sincronizar doutrina/runbook com mudança já entregue em runtime, de forma curta e sem nomenclatura nova.",
      validationGate: "safe_marker_check em docs + smoke focal inalterado",
      rollback: "git restore -- <doc(s)>",
      filesHint: ["docs/guides/control-plane-operating-doctrine.md"],
    },
    {
      id: "seed-handoff-noise-trim",
      description: "Reduzir ruído de handoff/status mantendo evidência canônica e fail-closed.",
      validationGate: "smoke + inspeção de summary/status",
      rollback: "git revert local da fatia",
      filesHint: ["packages/pi-stack/extensions/context-watchdog.ts", "packages/pi-stack/test/smoke/context-watchdog.test.ts"],
    },
  ] as const;

  const count = Math.max(1, Math.min(Math.floor(input.maxSeedSlices), Math.floor(input.suggestedSeedCount), templates.length));
  return templates.slice(0, count).map((row) => ({ ...row, filesHint: [...row.filesHint] }));
}

function buildReseedJustification(input: {
  decision: "seed-now" | "wait" | "blocked";
  recommendationCode: string;
  readiness: ReturnType<typeof buildAfkMaterialReadinessPacket>;
  blockedReasons: string[];
  suggestedSeedCount: number;
}): {
  required: boolean;
  reasonCode: "bootstrap-focus-missing" | "stock-below-target" | "readiness-blocked" | "not-needed";
  reason: string;
  evidenceSummary: string;
} {
  const evidenceSummary = [
    `stock=${input.readiness.material.validationKnownCount}/${input.readiness.material.targetSlices}`,
    `coverage=${input.readiness.material.validationCoveragePct}%`,
    input.blockedReasons.length > 0 ? `blockers=${input.blockedReasons.join("|")}` : "blockers=none",
    `suggested=${input.suggestedSeedCount}`,
  ].join(" ");

  if (input.decision === "seed-now" && input.recommendationCode === "afk-material-seed-now-bootstrap") {
    return {
      required: true,
      reasonCode: "bootstrap-focus-missing",
      reason: "bootstrap reseed required because focus/readiness blockers prevent normal queue continuation.",
      evidenceSummary,
    };
  }

  if (input.decision === "seed-now") {
    return {
      required: true,
      reasonCode: "stock-below-target",
      reason: "reseed required because validated local-safe stock is below target.",
      evidenceSummary,
    };
  }

  if (input.decision === "blocked") {
    return {
      required: false,
      reasonCode: "readiness-blocked",
      reason: "reseed blocked until operational/readiness blockers are resolved.",
      evidenceSummary,
    };
  }

  return {
    required: false,
    reasonCode: "not-needed",
    reason: "reseed not required while stock remains healthy.",
    evidenceSummary,
  };
}

function buildReseedPriority(input: {
  decision: "seed-now" | "wait" | "blocked";
  recommendationCode: string;
  readiness: ReturnType<typeof buildAfkMaterialReadinessPacket>;
  blockedReasons: string[];
  suggestedSeedCount: number;
}): {
  code: "continuity-bootstrap" | "stock-health" | "blocked-readiness" | "none";
  reason: string;
  evidenceSummary: string;
} {
  const evidenceSummary = [
    `localSafe=${input.readiness.material.localSafeCount}`,
    `validated=${input.readiness.material.validationKnownCount}/${input.readiness.material.targetSlices}`,
    input.blockedReasons.length > 0 ? `blockers=${input.blockedReasons.join("|")}` : "blockers=none",
    `suggested=${input.suggestedSeedCount}`,
  ].join(" ");

  if (input.decision === "seed-now" && input.recommendationCode === "afk-material-seed-now-bootstrap") {
    return {
      code: "continuity-bootstrap",
      reason: "bootstrap reseed preserves continuity when focus/readiness gaps prevent local-safe continuation.",
      evidenceSummary,
    };
  }

  if (input.decision === "seed-now") {
    return {
      code: "stock-health",
      reason: "reseed restores validated local-safe stock to sustain long-run throughput.",
      evidenceSummary,
    };
  }

  if (input.decision === "blocked") {
    return {
      code: "blocked-readiness",
      reason: "reseed stays blocked until operational readiness is restored.",
      evidenceSummary,
    };
  }

  return {
    code: "none",
    reason: "stock is healthy; no reseed priority action is required.",
    evidenceSummary,
  };
}

export function buildAfkMaterialSeedPacket(p: Record<string, unknown>, cwd: string) {
  const readiness = buildAfkMaterialReadinessPacket(p, cwd);
  const maxSeedSlices = Math.max(1, Math.min(10, Math.floor(asNumber(p.max_seed_slices, 3))));
  const currentValidated = readiness.material.validationKnownCount;
  const targetValidated = readiness.material.targetSlices;
  const seedGap = Math.max(0, targetValidated - currentValidated);
  const suggestedSeedCount = Math.max(1, Math.min(maxSeedSlices, seedGap || maxSeedSlices));

  let decision: "seed-now" | "wait" | "blocked" = "wait";
  let recommendationCode = "afk-material-seed-wait-stock-healthy";
  let nextAction = "defer seeding; continue bounded AFK slice and re-check material packet after checkpoint.";
  let humanActionRequired = false;
  let seedTemplates: ReturnType<typeof buildBootstrapSeedTemplates> = [];

  if (readiness.decision === "blocked") {
    const bootstrapBlockers = new Set([
      "focus-missing",
      "focus-task-not-found",
      "focus-validation-unknown",
      "no-local-safe-material",
      "selection-no-eligible-tasks",
    ]);
    const canBootstrapSeed = readiness.blockedReasons.length > 0
      && readiness.blockedReasons.every((reason) => bootstrapBlockers.has(reason));

    if (canBootstrapSeed) {
      decision = "seed-now";
      recommendationCode = "afk-material-seed-now-bootstrap";
      nextAction = `run lane_brainstorm_packet + lane_brainstorm_seed_preview and decide bootstrap seeding for up to ${suggestedSeedCount} slices.`;
      humanActionRequired = true;
      seedTemplates = buildBootstrapSeedTemplates({ suggestedSeedCount, maxSeedSlices });
    } else {
      decision = "blocked";
      recommendationCode = "afk-material-seed-blocked-readiness";
      nextAction = "resolve readiness blockers before triggering seeding flow.";
      humanActionRequired = true;
    }
  } else if (readiness.decision === "seed-backlog") {
    decision = "seed-now";
    recommendationCode = "afk-material-seed-now-low-stock";
    nextAction = `run lane_brainstorm_packet + lane_brainstorm_seed_preview and decide seeding for up to ${suggestedSeedCount} slices.`;
    humanActionRequired = true;
  }

  const reseedJustification = buildReseedJustification({
    decision,
    recommendationCode,
    readiness,
    blockedReasons: readiness.blockedReasons,
    suggestedSeedCount,
  });
  const reseedPriority = buildReseedPriority({
    decision,
    recommendationCode,
    readiness,
    blockedReasons: readiness.blockedReasons,
    suggestedSeedCount,
  });

  const summary = [
    "afk-material-seed:",
    `decision=${decision}`,
    `code=${recommendationCode}`,
    `readiness=${readiness.decision}`,
    `focus=${readiness.focusTaskIds.join(",") || "none"}`,
    `suggestedSeedCount=${suggestedSeedCount}`,
    `seedWhy=${reseedJustification.reasonCode}`,
    `seedPriority=${reseedPriority.code}`,
    `humanActionRequired=${humanActionRequired ? "yes" : "no"}`,
    "authorization=none",
  ].join(" ");

  return {
    mode: "report-only",
    decision,
    recommendationCode,
    nextAction,
    humanActionRequired,
    suggestedSeedCount,
    maxSeedSlices,
    readiness,
    blockedReasons: readiness.blockedReasons,
    seedTemplates,
    reseedJustification,
    reseedPriority,
    dispatchAllowed: false,
    mutationAllowed: false,
    authorization: "none",
    summary,
  };
}

export function buildInfluenceAssimilationWindowPacket(p: Record<string, unknown>, cwd: string) {
  const minReadySlices = Math.max(1, Math.min(20, Math.floor(asNumber(p.min_ready_slices, 3))));
  const targetSlices = Math.max(minReadySlices, Math.min(20, Math.floor(asNumber(p.target_slices, 7))));
  const minValidationCoveragePct = Math.max(10, Math.min(100, Math.floor(asNumber(p.min_validation_coverage_pct, 80))));

  const readiness = buildAfkMaterialReadinessPacket({
    ...p,
    include_protected_scopes: false,
    min_ready_slices: minReadySlices,
    target_slices: targetSlices,
  }, cwd);

  const blockedReasons: string[] = [];
  if (!workspaceLooksClean(cwd)) blockedReasons.push("reload-required-or-dirty");
  if (readiness.decision === "blocked") blockedReasons.push("local-safe-readiness-blocked");
  if (readiness.material.validationKnownCount < minReadySlices) blockedReasons.push("local-safe-stock-low");
  if (readiness.material.validationCoveragePct < minValidationCoveragePct) blockedReasons.push("validation-coverage-low");

  let decision: "ready-window" | "defer" | "blocked" = "ready-window";
  let window: "open" | "hold" | "closed" = "open";
  let recommendationCode = "influence-assimilation-ready-window-open";
  let recommendation = "open-protected-focus";
  let nextAction = "window open: prepare protected decision packet and request explicit human focus before external influence assimilation.";

  if (blockedReasons.includes("reload-required-or-dirty") || blockedReasons.includes("local-safe-readiness-blocked")) {
    decision = "blocked";
    window = "closed";
    recommendationCode = "influence-assimilation-blocked-operational";
    recommendation = "stabilize-local-runtime";
    nextAction = "stabilize local runtime/readiness first (reload/dirty/focus), then re-evaluate influence window.";
  } else if (blockedReasons.length > 0) {
    decision = "defer";
    window = "hold";
    recommendationCode = "influence-assimilation-defer-local-safe-stock";
    recommendation = "continue-local-safe";
    nextAction = "defer influence assimilation until local-safe stock and validation maturity are healthy.";
  }

  const options = decision === "ready-window"
    ? [
      { option: "open-protected-focus", impact: "Start one protected decision slice with explicit human choice." },
      { option: "continue-local-safe", impact: "Keep throughput and revisit the influence window later." },
    ]
    : decision === "defer"
      ? [
        { option: "continue-local-safe", impact: "Grow validated local-safe stock before assimilation." },
        { option: "checkpoint", impact: "Persist concise handoff and re-check the packet next boundary." },
      ]
      : [
        { option: "stabilize-local-runtime", impact: "Resolve reload/dirty/readiness blockers before any assimilation decision." },
        { option: "checkpoint", impact: "Preserve context and avoid accidental protected drift." },
      ];

  const summary = [
    "influence-assimilation:",
    `decision=${decision}`,
    `window=${window}`,
    `code=${recommendationCode}`,
    `stock=${readiness.material.validationKnownCount}/${minReadySlices}`,
    `coverage=${readiness.material.validationCoveragePct}/${minValidationCoveragePct}`,
    blockedReasons.length > 0 ? `blockers=${blockedReasons.join("|")}` : undefined,
    `recommend=${recommendation}`,
    "authorization=none",
  ].filter(Boolean).join(" ");

  return {
    mode: "report-only",
    decision,
    window,
    recommendationCode,
    recommendation,
    nextAction,
    options,
    blockedReasons,
    readiness,
    thresholds: {
      minReadySlices,
      targetSlices,
      minValidationCoveragePct,
    },
    dispatchAllowed: false,
    mutationAllowed: false,
    authorization: "none",
    summary,
  };
}

export function buildReadyQueuePreview(selection: {
  nextTaskId?: string;
  eligibleTaskIds?: string[];
}, sampleLimitInput: unknown): {
  taskIds: string[];
  nextTaskId?: string;
  previewCount: number;
  bounded: true;
} {
  const sampleLimit = Math.max(1, Math.min(20, Math.floor(asNumber(sampleLimitInput, 5))));
  const taskIds = Array.isArray(selection.eligibleTaskIds)
    ? selection.eligibleTaskIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0).slice(0, sampleLimit)
    : [];
  return {
    taskIds,
    nextTaskId: typeof selection.nextTaskId === "string" ? selection.nextTaskId : undefined,
    previewCount: taskIds.length,
    bounded: true,
  };
}

function toShortSentence(value: string, maxLen = 90): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > maxLen ? `${compact.slice(0, Math.max(12, maxLen - 3))}...` : compact;
}

function buildSliceValidationGate(task: ProjectTaskItem): string {
  const criteria = Array.isArray(task.acceptance_criteria)
    ? task.acceptance_criteria.filter((item): item is string => typeof item === "string")
    : [];
  const fromCriteria = criteria.find((item) => /(smoke|test|spec|vitest|marker-check|inspection|lint|typecheck|build)/i.test(item));
  if (fromCriteria) return toShortSentence(fromCriteria, 110);
  if (taskValidationGateKnown(task)) return "run focal smoke/test gate for this slice";
  return "define focal validation gate before execution";
}

function buildSliceRollback(task: ProjectTaskItem): string {
  const files = Array.isArray(task.files)
    ? task.files.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  if (files.length <= 0) return "git restore -- <declared-files>";
  const hint = files.slice(0, 2).join(" ");
  return files.length > 2 ? `git restore -- ${hint} ...` : `git restore -- ${hint}`;
}

export function buildAutonomyLaneBatchPreviewPacket(p: Record<string, unknown>, cwd: string) {
  const selection = resolveTaskSelection(p, cwd);
  const requestedSliceCount = Math.max(3, Math.min(7, Math.floor(asNumber(p.slice_count, 5))));
  const sampleLimit = Math.max(requestedSliceCount, Math.min(20, Math.floor(asNumber(p.sample_limit, 20))));
  const tasks = readProjectTasksBlock(cwd).tasks;

  const milestone = typeof p.milestone === "string" ? p.milestone : undefined;
  const includeProtectedScopes = p.include_protected_scopes === true;

  const completedTaskIds = new Set(
    tasks
      .filter((task) => task.status === "completed")
      .map((task) => normalizeTaskId(task.id))
      .filter((id): id is string => Boolean(id)),
  );

  const fallbackTaskIds = tasks
    .filter((task) => {
      if (task.status !== "planned" && task.status !== "in-progress") return false;
      if (milestone && (task.milestone ?? "").trim() !== milestone) return false;
      if (!includeProtectedScopes && taskHasProtectedSignal(task)) return false;
      if (taskHasRiskSignal(task)) return false;
      if (!taskValidationGateKnown(task)) return false;
      const deps = normalizeDependsOn(task.depends_on);
      return deps.every((dep) => completedTaskIds.has(dep));
    })
    .map((task) => normalizeTaskId(task.id))
    .filter((id): id is string => Boolean(id));

  const selectionTaskIds = Array.isArray(selection.eligibleTaskIds)
    ? selection.eligibleTaskIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  const mergedTaskIds = [
    ...selectionTaskIds,
    ...fallbackTaskIds.filter((id) => !selectionTaskIds.includes(id)),
  ].slice(0, sampleLimit);

  const eligibleSlices = mergedTaskIds
    .map((taskId) => findTaskById(tasks, taskId))
    .filter((task): task is ProjectTaskItem => Boolean(task))
    .filter((task) => (includeProtectedScopes || !taskHasProtectedSignal(task)) && !taskHasRiskSignal(task) && taskValidationGateKnown(task))
    .map((task) => {
      const taskId = normalizeTaskId(task.id);
      return {
        taskId,
        mnemonic: toTaskMnemonic(task),
        validationGate: buildSliceValidationGate(task),
        rollback: buildSliceRollback(task),
        files: Array.isArray(task.files)
          ? task.files.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 3)
          : [],
      };
    });

  const slices = eligibleSlices.slice(0, requestedSliceCount);
  const blockedReasons: string[] = [];
  if (!workspaceLooksClean(cwd)) blockedReasons.push("reload-required-or-dirty");
  if (!selection.ready && eligibleSlices.length <= 0) blockedReasons.push(`selection-${selection.reason}`);

  let decision: "ready" | "seed-backlog" | "blocked" = "ready";
  let recommendationCode = "autonomy-lane-batch-preview-ready";
  let nextAction = "execute batch in listed order with commit+checkpoint per slice; refresh status after each slice.";

  if (blockedReasons.length > 0) {
    decision = "blocked";
    recommendationCode = blockedReasons.includes("reload-required-or-dirty")
      ? "autonomy-lane-batch-preview-blocked-reload-or-dirty"
      : "autonomy-lane-batch-preview-blocked-selection";
    nextAction = blockedReasons.includes("reload-required-or-dirty")
      ? "clean workspace/reload and re-run autonomy_lane_batch_preview."
      : "resolve local-safe selection blockers and re-run autonomy_lane_batch_preview.";
  } else if (eligibleSlices.length < 3) {
    decision = "seed-backlog";
    recommendationCode = "autonomy-lane-batch-preview-seed-backlog";
    nextAction = `seed ${Math.max(1, 3 - eligibleSlices.length)} additional local-safe slices before long batch execution.`;
  }

  const summary = [
    "autonomy-lane-batch-preview:",
    `decision=${decision}`,
    `code=${recommendationCode}`,
    `requested=${requestedSliceCount}`,
    `available=${eligibleSlices.length}`,
    `preview=${slices.length}`,
    selection.nextTaskId ? `next=${selection.nextTaskId}` : undefined,
    blockedReasons.length > 0 ? `blockers=${blockedReasons.join("|")}` : undefined,
    "authorization=none",
  ].filter(Boolean).join(" ");

  return {
    mode: "report-only",
    decision,
    recommendationCode,
    nextAction,
    requestedSliceCount,
    minimumSliceCount: 3,
    maximumSliceCount: 7,
    availableSliceCount: eligibleSlices.length,
    slices,
    blockedReasons,
    selectionReason: selection.reason,
    nextTaskId: selection.nextTaskId,
    dispatchAllowed: false,
    mutationAllowed: false,
    authorization: "none",
    summary,
  };
}

export function resolveTaskSelection(p: Record<string, unknown>, cwd: string) {
  const focus = resolveFocusTaskIds(p, cwd);
  const milestone = typeof p.milestone === "string" ? p.milestone : undefined;
  const includeProtectedScopes = p.include_protected_scopes === true;
  const includeMissingRationale = p.include_missing_rationale === true;
  const sampleLimit = asNumber(p.sample_limit, 5);

  const selection = evaluateAutonomyLaneTaskSelection(cwd, {
    milestone,
    includeProtectedScopes,
    includeMissingRationale,
    sampleLimit,
    focusTaskIds: focus.ids,
    focusSource: focus.source,
  });

  const hardIntentEligible = selection.reason === "focus-complete" && focus.source === "handoff";
  if (!hardIntentEligible) return selection;

  const fallback = evaluateAutonomyLaneTaskSelection(cwd, {
    milestone,
    includeProtectedScopes,
    includeMissingRationale,
    sampleLimit,
  });

  if (!fallback.ready || !fallback.nextTaskId) {
    return {
      ...selection,
      selectionPolicy: `${selection.selectionPolicy}+auto-advance-hard-intent-blocked`,
      recommendation: "hard-intent auto-advance fail-closed; choose next focus explicitly (no eligible local-safe successor).",
    };
  }

  const tasks = readProjectTasksBlock(cwd).tasks;
  const nextTask = findTaskById(tasks, fallback.nextTaskId);
  const failClosedReasons = resolveAutoAdvanceFailClosedReasons({ cwd, params: p, nextTask });
  if (failClosedReasons.length > 0) {
    return {
      ...selection,
      selectionPolicy: `${selection.selectionPolicy}+auto-advance-hard-intent-blocked`,
      recommendation: `hard-intent auto-advance fail-closed; choose next focus explicitly (${failClosedReasons.join(",")}).`,
    };
  }

  return {
    ...fallback,
    selectionPolicy: `${fallback.selectionPolicy}+auto-advance-hard-intent`,
    recommendation: `auto-advance hard-intent: ${fallback.recommendation}`,
  };
}

export function buildAutoAdvanceHardIntentSnapshot(p: Record<string, unknown>, cwd: string) {
  const focus = resolveFocusTaskIds(p, cwd);
  const milestone = typeof p.milestone === "string" ? p.milestone : undefined;
  const includeProtectedScopes = p.include_protected_scopes === true;
  const includeMissingRationale = p.include_missing_rationale === true;
  const sampleLimit = asNumber(p.sample_limit, 5);

  const selection = evaluateAutonomyLaneTaskSelection(cwd, {
    milestone,
    includeProtectedScopes,
    includeMissingRationale,
    sampleLimit,
    focusTaskIds: focus.ids,
    focusSource: focus.source,
  });

  const fallback = evaluateAutonomyLaneTaskSelection(cwd, {
    milestone,
    includeProtectedScopes,
    includeMissingRationale,
    sampleLimit,
  });

  if (!(selection.reason === "focus-complete" && focus.source === "handoff")) {
    return {
      mode: "report-only",
      decision: "blocked",
      recommendationCode: "auto-advance-snapshot-blocked-no-focus-complete",
      nextAction: "auto-advance requires handoff focus-complete before successor evaluation.",
      focusTaskIds: focus.ids,
      focusSource: focus.source,
      blockedReasons: ["focus-not-complete"],
      eligibleTaskIds: fallback.eligibleTaskIds,
      nextTaskId: fallback.nextTaskId,
      dispatchAllowed: false,
      mutationAllowed: false,
      authorization: "none",
      summary: "autonomy-lane-auto-advance-snapshot: decision=blocked code=auto-advance-snapshot-blocked-no-focus-complete",
    };
  }

  if (!fallback.ready || !fallback.nextTaskId) {
    return {
      mode: "report-only",
      decision: "blocked",
      recommendationCode: "auto-advance-snapshot-blocked-no-successor",
      nextAction: "auto-advance blocked until a single local-safe successor is eligible.",
      focusTaskIds: focus.ids,
      focusSource: focus.source,
      blockedReasons: ["no-eligible-local-safe-successor"],
      eligibleTaskIds: fallback.eligibleTaskIds,
      nextTaskId: undefined,
      dispatchAllowed: false,
      mutationAllowed: false,
      authorization: "none",
      summary: "autonomy-lane-auto-advance-snapshot: decision=blocked code=auto-advance-snapshot-blocked-no-successor",
    };
  }

  const tasks = readProjectTasksBlock(cwd).tasks;
  const nextTask = findTaskById(tasks, fallback.nextTaskId);
  const blockedReasons = resolveAutoAdvanceFailClosedReasons({ cwd, params: p, nextTask });

  if (blockedReasons.length > 0) {
    return {
      mode: "report-only",
      decision: "blocked",
      recommendationCode: "auto-advance-snapshot-blocked-fail-closed",
      nextAction: "auto-advance fail-closed; keep explicit focus selection until blockers clear.",
      focusTaskIds: focus.ids,
      focusSource: focus.source,
      blockedReasons,
      eligibleTaskIds: fallback.eligibleTaskIds,
      nextTaskId: fallback.nextTaskId,
      dispatchAllowed: false,
      mutationAllowed: false,
      authorization: "none",
      summary: `autonomy-lane-auto-advance-snapshot: decision=blocked code=auto-advance-snapshot-blocked-fail-closed reasons=${blockedReasons.join(",")}`,
    };
  }

  return {
    mode: "report-only",
    decision: "eligible",
    recommendationCode: "auto-advance-snapshot-eligible",
    nextAction: `auto-advance eligible for ${fallback.nextTaskId}; continue bounded local-safe slice.`,
    focusTaskIds: focus.ids,
    focusSource: focus.source,
    blockedReasons: [],
    eligibleTaskIds: fallback.eligibleTaskIds,
    nextTaskId: fallback.nextTaskId,
    dispatchAllowed: false,
    mutationAllowed: false,
    authorization: "none",
    summary: `autonomy-lane-auto-advance-snapshot: decision=eligible code=auto-advance-snapshot-eligible next=${fallback.nextTaskId}`,
  };
}

export function buildReadinessInput(
  p: Record<string, unknown>,
  board: { ready: boolean; nextTaskId?: string },
) {
  return {
    context: {
      level: normalizeContextLevel(p.context_level),
      percent: asNumber(p.context_percent, 0),
    },
    machine: {
      severity: typeof p.machine_severity === "string" ? p.machine_severity : "ok",
      canStartLongRun: asBool(p.can_start_long_run, true),
      canEvaluateMonitors: true,
    },
    provider: {
      ready: asNumber(p.provider_ready, 1),
      blocked: asNumber(p.provider_blocked, 0),
      degraded: asNumber(p.provider_degraded, 0),
    },
    quota: {
      blockAlerts: asNumber(p.quota_block_alerts, 0),
      warnAlerts: asNumber(p.quota_warn_alerts, 0),
    },
    board,
    monitors: {
      classifyFailures: asNumber(p.monitor_classify_failures, 0),
      sovereignDivergence: asNumber(p.monitor_sovereign_divergence, 0),
    },
    subagents: {
      ready: asBool(p.subagents_ready, true),
    },
    workspace: {
      unexpectedDirty: asBool(p.unexpected_dirty, false),
    },
  };
}
