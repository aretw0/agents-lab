import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { readProjectTasksBlock, type ProjectTaskItem } from "./colony-pilot-task-sync";
import {
  ADD_OR_SELECT_TASK_CODE,
  CHOOSE_NEXT_FOCUS_CODE,
  EXECUTE_BOUNDED_SLICE_CODE,
  LOCAL_STOP_ADD_RATIONALE_OR_ALLOW_CODE,
  LOCAL_STOP_DECOMPOSE_BOUNDED_CODE,
  LOCAL_STOP_MIXED_BLOCKERS_CODE,
  LOCAL_STOP_PROTECTED_FOCUS_REQUIRED_CODE,
  LOCAL_STOP_UNBLOCK_DEPENDENCIES_CODE,
  REALIGN_FOCUS_CODE,
  localStopProtectedFocusNextAction,
} from "./guardrails-core-local-stop-guidance";

export type AutonomyTaskSelectionReason =
  | "ready"
  | "no-candidate-tasks"
  | "no-eligible-tasks"
  | "focus-complete"
  | "focus-mismatch";

export interface AutonomyTaskSelectorOptions {
  milestone?: string;
  includeProtectedScopes?: boolean;
  includeMissingRationale?: boolean;
  sampleLimit?: number;
  focusTaskIds?: string[];
  focusSource?: "explicit" | "handoff";
}

export type AutonomyTaskRecommendationCode =
  | typeof EXECUTE_BOUNDED_SLICE_CODE
  | typeof ADD_OR_SELECT_TASK_CODE
  | typeof CHOOSE_NEXT_FOCUS_CODE
  | typeof REALIGN_FOCUS_CODE
  | typeof LOCAL_STOP_PROTECTED_FOCUS_REQUIRED_CODE
  | typeof LOCAL_STOP_UNBLOCK_DEPENDENCIES_CODE
  | typeof LOCAL_STOP_ADD_RATIONALE_OR_ALLOW_CODE
  | typeof LOCAL_STOP_MIXED_BLOCKERS_CODE
  | typeof LOCAL_STOP_DECOMPOSE_BOUNDED_CODE;

export interface AutonomyTaskSelection {
  ready: boolean;
  reason: AutonomyTaskSelectionReason;
  recommendationCode: AutonomyTaskRecommendationCode;
  recommendation: string;
  selectionPolicy: string;
  milestone?: string;
  focusTaskIds?: string[];
  focusSource?: "explicit" | "handoff";
  nextTaskId?: string;
  eligibleTaskIds: string[];
  totals: {
    candidate: number;
    inProgress: number;
    planned: number;
    blockedByDependencies: number;
    skippedProtectedScope: number;
    skippedMissingRationale: number;
    skippedFocusMismatch: number;
  };
}

export type AutonomyProtectedScopeReasonCode =
  | "protected-settings-file"
  | "protected-obsidian-path"
  | "protected-github-path"
  | "protected-workflows-path"
  | "protected-github-actions"
  | "protected-remote-execution"
  | "protected-colony-promotion"
  | "protected-external-url"
  | "protected-external-research"
  | "protected-publish"
  | "protected-ci-keyword";

interface ProtectedScopeRule {
  reasonCode: AutonomyProtectedScopeReasonCode;
  signal: string;
  pattern: RegExp;
}

const PROTECTED_SCOPE_RULES: ProtectedScopeRule[] = [
  { reasonCode: "protected-settings-file", signal: ".pi/settings.json", pattern: /^\.pi\/settings\.json$/i },
  { reasonCode: "protected-obsidian-path", signal: ".obsidian", pattern: /^\.obsidian(?:\/|$)/i },
  { reasonCode: "protected-github-path", signal: ".github", pattern: /^\.github(?:\/|$)/i },
  { reasonCode: "protected-workflows-path", signal: "workflows", pattern: /(?:^|\/)workflows(?:\/|$)/i },
  { reasonCode: "protected-github-actions", signal: "github actions", pattern: /\bgithub\s+actions\b/i },
  { reasonCode: "protected-github-actions", signal: "gh actions", pattern: /\bgh\s+actions\b/i },
  { reasonCode: "protected-remote-execution", signal: "remote execution", pattern: /\bremote\s+(?:compute|execution|runner|runners)\b/i },
  { reasonCode: "protected-colony-promotion", signal: "colony promotion", pattern: /\bcolony\b.*\b(?:promotion|promote|recovery|recover|materializa[cç][aã]o)\b/i },
  { reasonCode: "protected-colony-promotion", signal: "promotion colony", pattern: /\b(?:promotion|promote|recovery|recover)\b.*\bcolony\b/i },
  { reasonCode: "protected-colony-promotion", signal: "*-promotion", pattern: /(?:^|\W)[\w-]*-promotion(?:\W|$)/i },
  { reasonCode: "protected-external-url", signal: "http-url", pattern: /https?:\/\//i },
  { reasonCode: "protected-external-research", signal: "external research", pattern: /\b(?:research|pesquisa)\b.*\b(?:extern[ao]|external|web|internet|url|fonte(?:s)?|source|influ[eê]ncia|inspiration|inspira[cç][aã]o|prior\s*art)\b/i },
  { reasonCode: "protected-external-research", signal: "external influence", pattern: /\b(?:influ[eê]ncia|inspiration|inspira[cç][aã]o)\b.*\b(?:extern[ao]|external|web|internet|fonte(?:s)?|source|prior\s*art)\b/i },
  { reasonCode: "protected-publish", signal: "publish", pattern: /\bpublish\b/i },
  { reasonCode: "protected-ci-keyword", signal: "ci", pattern: /\bci\b/i },
];

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\\/g, "/").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : undefined;
}

function normalizeTaskId(value: unknown): string | undefined {
  return normalizeText(value);
}

function normalizeMilestone(value: unknown): string | undefined {
  const text = normalizeText(value);
  if (!text) return undefined;
  return text.length <= 120 ? text : `${text.slice(0, 119)}…`;
}

function normalizeTaskIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const id = normalizeTaskId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.slice(0, 20);
}

export function readAutonomyHandoffFocusTaskIds(cwd: string): string[] {
  const handoffPath = path.join(cwd, ".project", "handoff.json");
  if (!existsSync(handoffPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(handoffPath, "utf8")) as { current_tasks?: unknown; focusTasks?: unknown };
    const currentTasks = normalizeTaskIdList(parsed.current_tasks);
    if (currentTasks.length > 0) return currentTasks;
    return normalizeTaskIdList(parsed.focusTasks);
  } catch {
    return [];
  }
}

function clampSampleLimit(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 5;
  return Math.max(1, Math.min(20, Math.floor(raw)));
}

function normalizeDependsOn(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeTaskId(item))
    .filter((item): item is string => Boolean(item));
}

function priorityRank(task: ProjectTaskItem): number {
  const description = normalizeText(task.description) ?? "";
  const match = description.match(/\[(P\d+)\]/i);
  if (!match?.[1]) return 9;
  const numeric = Number(match[1].slice(1));
  return Number.isFinite(numeric) ? Math.max(0, Math.min(9, Math.floor(numeric))) : 9;
}

function statusRank(task: ProjectTaskItem): number {
  if (task.status === "in-progress") return 0;
  if (task.status === "planned") return 1;
  return 9;
}

export interface AutonomyProtectedScopeEvidence {
  reasonCode: AutonomyProtectedScopeReasonCode;
  signal: string;
  source: "file" | "description";
  matchedOn: string;
}

function classifyProtectedScopeText(text: string): ProtectedScopeRule[] {
  const normalized = text.replace(/\\/g, "/");
  return PROTECTED_SCOPE_RULES.filter((rule) => rule.pattern.test(normalized));
}

function clipEvidenceText(text: string, max = 120): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(16, max - 1))}…`;
}

export function classifyTaskProtectedScope(task: ProjectTaskItem): {
  protected: boolean;
  reasonCodes: AutonomyProtectedScopeReasonCode[];
  signals: string[];
  evidence: AutonomyProtectedScopeEvidence[];
} {
  const evidence: AutonomyProtectedScopeEvidence[] = [];

  const files = Array.isArray(task.files) ? task.files : [];
  for (const file of files) {
    const normalized = normalizeText(file);
    if (!normalized) continue;
    const matches = classifyProtectedScopeText(normalized);
    for (const match of matches) {
      evidence.push({
        reasonCode: match.reasonCode,
        signal: match.signal,
        source: "file",
        matchedOn: clipEvidenceText(normalized, 90),
      });
    }
  }

  const description = normalizeText(task.description);
  if (description) {
    const matches = classifyProtectedScopeText(description);
    for (const match of matches) {
      evidence.push({
        reasonCode: match.reasonCode,
        signal: match.signal,
        source: "description",
        matchedOn: clipEvidenceText(description, 110),
      });
    }
  }

  const reasonCodes = [...new Set(evidence.map((row) => row.reasonCode))];
  const signals = [...new Set(evidence.map((row) => row.signal))];

  return {
    protected: reasonCodes.length > 0,
    reasonCodes,
    signals,
    evidence,
  };
}

function taskTouchesProtectedScope(task: ProjectTaskItem): boolean {
  return classifyTaskProtectedScope(task).protected;
}

function hasRationaleText(text: unknown): boolean {
  if (typeof text !== "string" || text.trim().length <= 0) return false;
  return /(?:\[rationale:[^\]]+\]|(?:^|\s)(?:rationale|motivo|reason)\s*[:=-]\s*\S)/i.test(text);
}

function isRationaleSensitiveAutonomyTask(task: ProjectTaskItem): boolean {
  const textHaystack = [task.id, task.description, task.notes ?? ""].join("\n").toLowerCase();
  const fileHaystack = Array.isArray(task.files) ? task.files.join("\n").toLowerCase() : "";
  const hasRefactorSignal = /(refactor|rename|organize\s+imports|formatar|desinflar|hardening)/i.test(textHaystack);
  const hasTestSignal = /(^|\W)(test|tests|smoke|vitest|e2e|spec)(\W|$)/i.test(textHaystack)
    || /(\/test\/|\.test\.|\.spec\.|smoke)/i.test(fileHaystack);
  return hasRefactorSignal || hasTestSignal;
}

function taskMissingRequiredRationale(task: ProjectTaskItem): boolean {
  return isRationaleSensitiveAutonomyTask(task) && !hasRationaleText(task.notes);
}

function compareTasks(a: ProjectTaskItem, b: ProjectTaskItem): number {
  const byStatus = statusRank(a) - statusRank(b);
  if (byStatus !== 0) return byStatus;
  const byPriority = priorityRank(a) - priorityRank(b);
  if (byPriority !== 0) return byPriority;
  return (normalizeTaskId(a.id) ?? "").localeCompare(normalizeTaskId(b.id) ?? "");
}

function resolveNoEligibleTaskRecommendation(input: {
  blockedByDependencies: number;
  skippedProtectedScope: number;
  skippedMissingRationale: number;
}): { recommendationCode: AutonomyTaskRecommendationCode; recommendation: string } {
  const { blockedByDependencies, skippedProtectedScope, skippedMissingRationale } = input;
  if (skippedProtectedScope > 0 && blockedByDependencies === 0 && skippedMissingRationale === 0) {
    return {
      recommendationCode: LOCAL_STOP_PROTECTED_FOCUS_REQUIRED_CODE,
      recommendation: localStopProtectedFocusNextAction(),
    };
  }
  if (blockedByDependencies > 0 && skippedProtectedScope === 0 && skippedMissingRationale === 0) {
    return {
      recommendationCode: LOCAL_STOP_UNBLOCK_DEPENDENCIES_CODE,
      recommendation: "local stop condition: no eligible tasks remain until dependencies are unblocked or decomposed.",
    };
  }
  if (skippedMissingRationale > 0 && skippedProtectedScope === 0 && blockedByDependencies === 0) {
    return {
      recommendationCode: LOCAL_STOP_ADD_RATIONALE_OR_ALLOW_CODE,
      recommendation: "local stop condition: only rationale-sensitive tasks remain; add rationale evidence or explicitly opt in to include missing-rationale tasks.",
    };
  }
  if (blockedByDependencies > 0 || skippedProtectedScope > 0 || skippedMissingRationale > 0) {
    return {
      recommendationCode: LOCAL_STOP_MIXED_BLOCKERS_CODE,
      recommendation: "local stop condition: no eligible local-safe tasks remain; unblock dependencies and/or request explicit focus for protected or rationale-sensitive lanes.",
    };
  }
  return {
    recommendationCode: LOCAL_STOP_DECOMPOSE_BOUNDED_CODE,
    recommendation: "local stop condition: no eligible tasks remain; decompose or add the next bounded local-safe task before autonomous continuation.",
  };
}

function resolveSelectionRecommendation(
  reason: AutonomyTaskSelectionReason,
  noEligibleGuidance: { recommendationCode: AutonomyTaskRecommendationCode; recommendation: string },
): { recommendationCode: AutonomyTaskRecommendationCode; recommendation: string } {
  if (reason === "no-candidate-tasks") {
    return {
      recommendationCode: ADD_OR_SELECT_TASK_CODE,
      recommendation: "add or select a planned/in-progress task before autonomous continuation.",
    };
  }
  if (reason === "focus-complete") {
    return {
      recommendationCode: CHOOSE_NEXT_FOCUS_CODE,
      recommendation: "current focus is complete; choose the next focus explicitly before autonomous continuation.",
    };
  }
  if (reason === "focus-mismatch") {
    return {
      recommendationCode: REALIGN_FOCUS_CODE,
      recommendation: "do not drift to an unrelated board task; update handoff/focus or explicitly clear focus before autonomous continuation.",
    };
  }
  if (reason === "no-eligible-tasks") {
    return noEligibleGuidance;
  }
  return {
    recommendationCode: EXECUTE_BOUNDED_SLICE_CODE,
    recommendation: "execute bounded slice for the selected task; validate focal gate; commit; update board.",
  };
}

export function selectAutonomyLaneTask(
  tasks: ProjectTaskItem[],
  options?: AutonomyTaskSelectorOptions,
): AutonomyTaskSelection {
  const milestone = normalizeMilestone(options?.milestone);
  const sampleLimit = clampSampleLimit(options?.sampleLimit);
  const includeProtectedScopes = options?.includeProtectedScopes === true;
  const includeMissingRationale = options?.includeMissingRationale === true;
  const focusTaskIds = normalizeTaskIdList(options?.focusTaskIds);
  const focusSource = focusTaskIds.length > 0 ? options?.focusSource : undefined;
  const allowProtectedByExplicitFocus = focusTaskIds.length > 0 && focusSource === "explicit";
  const includeProtectedByPolicy = includeProtectedScopes || allowProtectedByExplicitFocus;
  const focusSet = new Set(focusTaskIds);
  const completed = new Set(
    tasks
      .filter((task) => task.status === "completed")
      .map((task) => normalizeTaskId(task.id))
      .filter((id): id is string => Boolean(id)),
  );
  const candidate = tasks.filter((task) => {
    if (!normalizeTaskId(task.id)) return false;
    if (task.status !== "in-progress" && task.status !== "planned") return false;
    if (!milestone) return true;
    return normalizeMilestone(task.milestone) === milestone;
  });
  const skippedProtectedScope = candidate.filter((task) => !includeProtectedByPolicy && taskTouchesProtectedScope(task)).length;
  const scoped = includeProtectedByPolicy
    ? candidate
    : candidate.filter((task) => !taskTouchesProtectedScope(task));
  const skippedMissingRationale = scoped.filter((task) => !includeMissingRationale && taskMissingRequiredRationale(task)).length;
  const rationaleReady = includeMissingRationale
    ? scoped
    : scoped.filter((task) => !taskMissingRequiredRationale(task));
  const skippedFocusMismatch = focusTaskIds.length > 0
    ? rationaleReady.filter((task) => !focusSet.has(normalizeTaskId(task.id) ?? "")).length
    : 0;
  const focusReady = focusTaskIds.length > 0
    ? rationaleReady.filter((task) => focusSet.has(normalizeTaskId(task.id) ?? ""))
    : rationaleReady;
  const blockedByDependencies = focusReady.filter((task) => {
    const deps = normalizeDependsOn(task.depends_on);
    return deps.length > 0 && !deps.every((dep) => completed.has(dep));
  }).length;
  const eligible = focusReady
    .filter((task) => {
      const deps = normalizeDependsOn(task.depends_on);
      return deps.every((dep) => completed.has(dep));
    })
    .sort(compareTasks);
  const eligibleTaskIds = eligible
    .map((task) => normalizeTaskId(task.id))
    .filter((id): id is string => Boolean(id));
  const selectionPolicy = [
    "status(in-progress>planned)",
    "deps-completed",
    "priority(P0..P9)",
    "id",
    includeProtectedScopes
      ? "protected-scopes-included"
      : allowProtectedByExplicitFocus
        ? "protected-scopes-explicit-focus-only"
        : "protected-scopes-skipped",
    includeMissingRationale ? "missing-rationale-included" : "missing-rationale-skipped",
    focusTaskIds.length > 0 ? `focus(${focusSource ?? "explicit"}:${focusTaskIds.join(",")})` : undefined,
    milestone ? `milestone(${milestone})` : undefined,
  ].filter(Boolean).join("+");

  if (eligibleTaskIds.length > 0) {
    return {
      ready: true,
      reason: "ready",
      recommendationCode: EXECUTE_BOUNDED_SLICE_CODE,
      recommendation: `execute bounded slice for ${eligibleTaskIds[0]}; validate focal gate; commit; update board.`,
      selectionPolicy,
      milestone,
      focusTaskIds: focusTaskIds.length > 0 ? focusTaskIds : undefined,
      focusSource,
      nextTaskId: eligibleTaskIds[0],
      eligibleTaskIds: eligibleTaskIds.slice(0, sampleLimit),
      totals: {
        candidate: candidate.length,
        inProgress: candidate.filter((task) => task.status === "in-progress").length,
        planned: candidate.filter((task) => task.status === "planned").length,
        blockedByDependencies,
        skippedProtectedScope,
        skippedMissingRationale,
        skippedFocusMismatch,
      },
    };
  }

  const hasEligibleOutsideFocus = focusTaskIds.length > 0 && rationaleReady
    .filter((task) => {
      const deps = normalizeDependsOn(task.depends_on);
      return deps.every((dep) => completed.has(dep));
    })
    .some((task) => !focusSet.has(normalizeTaskId(task.id) ?? ""));
  const focusKnownTasks = focusTaskIds.length > 0
    ? tasks.filter((task) => focusSet.has(normalizeTaskId(task.id) ?? ""))
    : [];
  const focusAllComplete = focusTaskIds.length > 0
    && focusKnownTasks.length > 0
    && focusKnownTasks.every((task) => task.status === "completed");
  const reason = candidate.length === 0
    ? "no-candidate-tasks"
    : focusAllComplete
      ? "focus-complete"
      : hasEligibleOutsideFocus
        ? "focus-mismatch"
        : "no-eligible-tasks";

  const noEligibleGuidance = resolveNoEligibleTaskRecommendation({
    blockedByDependencies,
    skippedProtectedScope,
    skippedMissingRationale,
  });
  const recommendation = resolveSelectionRecommendation(reason, noEligibleGuidance);

  return {
    ready: false,
    reason,
    recommendationCode: recommendation.recommendationCode,
    recommendation: recommendation.recommendation,
    selectionPolicy,
    milestone,
    focusTaskIds: focusTaskIds.length > 0 ? focusTaskIds : undefined,
    focusSource,
    nextTaskId: undefined,
    eligibleTaskIds: [],
    totals: {
      candidate: candidate.length,
      inProgress: candidate.filter((task) => task.status === "in-progress").length,
      planned: candidate.filter((task) => task.status === "planned").length,
      blockedByDependencies,
      skippedProtectedScope,
      skippedMissingRationale,
      skippedFocusMismatch,
    },
  };
}

export interface AutonomyProtectedScopeReasonRow {
  id: string;
  status: "planned" | "in-progress";
  milestone?: string;
  protectedScope: boolean;
  primaryReasonCode: AutonomyProtectedScopeReasonCode | "local-safe";
  reasonCodes: AutonomyProtectedScopeReasonCode[];
  signals: string[];
  evidence: string[];
}

export interface AutonomyProtectedScopeReasonReport {
  milestone?: string;
  rows: AutonomyProtectedScopeReasonRow[];
  totals: {
    candidates: number;
    protected: number;
    localSafe: number;
  };
  summary: string;
}

export function buildAutonomyProtectedScopeReasonReport(
  tasks: ProjectTaskItem[],
  options?: { milestone?: string; limit?: number },
): AutonomyProtectedScopeReasonReport {
  const milestone = normalizeMilestone(options?.milestone);
  const limit = clampSampleLimit(options?.limit);

  const candidates = tasks.filter((task) => {
    if (!normalizeTaskId(task.id)) return false;
    if (task.status !== "in-progress" && task.status !== "planned") return false;
    if (!milestone) return true;
    return normalizeMilestone(task.milestone) === milestone;
  }).sort(compareTasks);

  const rows = candidates.slice(0, limit).map((task) => {
    const classified = classifyTaskProtectedScope(task);
    const reasonCodes = classified.reasonCodes;
    const evidence = classified.evidence.map((item) => `${item.source}:${item.signal} (${item.matchedOn})`);

    return {
      id: normalizeTaskId(task.id) ?? "?",
      status: task.status,
      milestone: normalizeMilestone(task.milestone),
      protectedScope: classified.protected,
      primaryReasonCode: reasonCodes[0] ?? "local-safe",
      reasonCodes,
      signals: classified.signals,
      evidence,
    } satisfies AutonomyProtectedScopeReasonRow;
  });

  const protectedCount = rows.filter((row) => row.protectedScope).length;
  const localSafeCount = rows.length - protectedCount;

  return {
    milestone,
    rows,
    totals: {
      candidates: candidates.length,
      protected: protectedCount,
      localSafe: localSafeCount,
    },
    summary: [
      "autonomy-protected-scope-report:",
      "ok=yes",
      milestone ? `milestone=${milestone}` : undefined,
      `candidates=${candidates.length}`,
      `protected=${protectedCount}`,
      `localSafe=${localSafeCount}`,
      `rows=${rows.length}`,
    ].filter(Boolean).join(" "),
  };
}

export function evaluateAutonomyProtectedScopeReasonReport(
  cwd: string,
  options?: { milestone?: string; limit?: number },
): AutonomyProtectedScopeReasonReport {
  return buildAutonomyProtectedScopeReasonReport(readProjectTasksBlock(cwd).tasks, options);
}

export function evaluateAutonomyLaneTaskSelection(
  cwd: string,
  options?: AutonomyTaskSelectorOptions,
): AutonomyTaskSelection {
  return selectAutonomyLaneTask(readProjectTasksBlock(cwd).tasks, options);
}
