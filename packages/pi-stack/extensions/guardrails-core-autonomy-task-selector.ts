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
  | "protected-ci-keyword"
  | "protected-parked-milestone";

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
  source: "file" | "description" | "milestone";
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

  const milestone = normalizeMilestone(task.milestone)?.toLowerCase();
  if (milestone && /(^|[-_])protected[-_]parked/.test(milestone)) {
    evidence.push({
      reasonCode: "protected-parked-milestone",
      signal: "protected-parked-milestone",
      source: "milestone",
      matchedOn: milestone,
    });
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

function containsRollbackSignal(task: ProjectTaskItem): boolean {
  const text = [task.notes ?? "", ...(task.acceptance_criteria ?? [])].join("\n").toLowerCase();
  return /\b(rollback|revers[ãa]o|reverter|undo|revert)\b/.test(text);
}

function resolveValuePotential(task: ProjectTaskItem): "high" | "medium" | "low" {
  const rank = priorityRank(task);
  if (rank <= 1) return "high";
  if (rank <= 3) return "medium";
  return "low";
}

function resolveEffortLevel(task: ProjectTaskItem): "high" | "medium" | "low" {
  const files = task.files?.length ?? 0;
  const acceptance = task.acceptance_criteria?.length ?? 0;
  const score = files + Math.ceil(acceptance / 2);
  if (score >= 7) return "high";
  if (score >= 3) return "medium";
  return "low";
}

function resolveRiskLevel(reasonCodes: AutonomyProtectedScopeReasonCode[]): "high" | "medium" | "low" {
  if (reasonCodes.length <= 0) return "low";
  if (reasonCodes.some((code) => code === "protected-external-url" || code === "protected-external-research")) {
    return "medium";
  }
  return "high";
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

export interface AutonomyProtectedFocusOptionPreview {
  option: "promote" | "skip" | "defer";
  suitability: "recommended" | "viable" | "blocked";
  recommendationCode: string;
  rationale: string;
  nextAction: string;
  blockers: string[];
}

export interface AutonomyProtectedFocusDecisionPreview {
  recommendedOption: "promote" | "skip" | "defer";
  options: AutonomyProtectedFocusOptionPreview[];
  pragmaticRecommendation: string;
}

export interface AutonomyProtectedFocusDecisionPacket {
  taskId: string;
  decision: "ready-for-human-decision" | "blocked";
  recommendedOption: "promote" | "skip" | "defer";
  options: ["promote", "skip", "defer"];
  recommendationCode:
    | "protected-focus-promote-canary"
    | "protected-focus-skip-local-safe"
    | "protected-focus-defer-missing-evidence"
    | "protected-focus-defer-high-risk"
    | "protected-focus-blocked-task-not-found";
  nextAction: string;
  valuePotential: "high" | "medium" | "low";
  riskLevel: "high" | "medium" | "low";
  effortLevel: "high" | "medium" | "low";
  protectedScope: boolean;
  reasonCodes: AutonomyProtectedScopeReasonCode[];
  signals: string[];
  evidence: string[];
  declaredFilesKnown: boolean;
  validationGateKnown: boolean;
  rollbackPlanKnown: boolean;
  blockers: string[];
  decisionPreview: AutonomyProtectedFocusDecisionPreview;
  reviewMode: "read-only";
  mutationAllowed: false;
  dispatchAllowed: false;
  authorization: "none";
  mode: "report-only";
  summary: string;
}

function buildProtectedFocusDecisionPreview(input: {
  decision: "ready-for-human-decision" | "blocked";
  recommendedOption: "promote" | "skip" | "defer";
  protectedScope: boolean;
  riskLevel: "high" | "medium" | "low";
  valuePotential: "high" | "medium" | "low";
  blockers: string[];
}): AutonomyProtectedFocusDecisionPreview {
  const promoteBlockedReasons = !input.protectedScope
    ? ["local-safe-task"]
    : input.blockers.length > 0
      ? [...input.blockers]
      : [];
  const promoteSuitability: "recommended" | "viable" | "blocked" =
    promoteBlockedReasons.length > 0
      ? "blocked"
      : (input.riskLevel === "high" && input.valuePotential !== "high")
        ? "viable"
        : input.recommendedOption === "promote"
          ? "recommended"
          : "viable";

  const skipSuitability: "recommended" | "viable" | "blocked" =
    input.recommendedOption === "skip"
      ? "recommended"
      : !input.protectedScope
        ? "recommended"
        : "viable";

  const deferSuitability: "recommended" | "viable" | "blocked" =
    input.recommendedOption === "defer" || input.decision === "blocked"
      ? "recommended"
      : "viable";

  const options: AutonomyProtectedFocusOptionPreview[] = [
    {
      option: "promote",
      suitability: promoteSuitability,
      recommendationCode: `protected-focus-option-promote-${promoteSuitability}`,
      rationale:
        promoteSuitability === "blocked"
          ? "promote blocked until protected evidence is explicit."
          : promoteSuitability === "recommended"
            ? "promote is pragmatic for one protected canary with rollback."
            : "promote is possible but requires extra caution/risk acceptance.",
      nextAction:
        promoteSuitability === "blocked"
          ? "add missing declared files/validation/rollback evidence before promote."
          : "run one protected canary slice with explicit rollback and focal validation.",
      blockers: promoteBlockedReasons,
    },
    {
      option: "skip",
      suitability: skipSuitability,
      recommendationCode: `protected-focus-option-skip-${skipSuitability}`,
      rationale:
        skipSuitability === "recommended"
          ? "skip keeps the lane local-safe and avoids protected promotion now."
          : "skip is valid but may delay protected value capture.",
      nextAction: "continue via local-safe lane without protected execution.",
      blockers: [],
    },
    {
      option: "defer",
      suitability: deferSuitability,
      recommendationCode: `protected-focus-option-defer-${deferSuitability}`,
      rationale:
        deferSuitability === "recommended"
          ? "defer is pragmatic while risk/evidence conditions remain constrained."
          : "defer is viable, but may postpone high-value protected learning.",
      nextAction: "defer protected execution and revisit once evidence/value is clearer.",
      blockers: input.blockers,
    },
  ];

  const pragmaticRecommendation = input.recommendedOption === "promote"
    ? "pragmatic recommendation: promote only one protected canary slice with explicit rollback and focal validation."
    : input.recommendedOption === "skip"
      ? "pragmatic recommendation: skip protected promotion and keep local-safe throughput."
      : "pragmatic recommendation: defer now; harden evidence/rollback and reassess on next boundary.";

  return {
    recommendedOption: input.recommendedOption,
    options,
    pragmaticRecommendation,
  };
}

export function buildAutonomyProtectedFocusDecisionPacket(
  tasks: ProjectTaskItem[],
  taskIdInput: string,
): AutonomyProtectedFocusDecisionPacket {
  const taskId = normalizeTaskId(taskIdInput) ?? "";
  const task = tasks.find((row) => normalizeTaskId(row.id) === taskId);
  if (!task) {
    const decisionPreview = buildProtectedFocusDecisionPreview({
      decision: "blocked",
      recommendedOption: "defer",
      protectedScope: false,
      riskLevel: "low",
      valuePotential: "low",
      blockers: ["task-not-found"],
    });
    const previewCompact = decisionPreview.options.map((option) => `${option.option}:${option.suitability}`).join(",");
    return {
      taskId,
      decision: "blocked",
      recommendedOption: "defer",
      options: ["promote", "skip", "defer"],
      recommendationCode: "protected-focus-blocked-task-not-found",
      nextAction: "task not found; choose a valid task id before protected focus decision.",
      valuePotential: "low",
      riskLevel: "low",
      effortLevel: "low",
      protectedScope: false,
      reasonCodes: [],
      signals: [],
      evidence: [],
      declaredFilesKnown: false,
      validationGateKnown: false,
      rollbackPlanKnown: false,
      blockers: ["task-not-found"],
      decisionPreview,
      reviewMode: "read-only",
      mutationAllowed: false,
      dispatchAllowed: false,
      authorization: "none",
      mode: "report-only",
      summary: `autonomy-protected-focus-packet: ok=no task=${taskId || "?"} decision=blocked option=defer code=protected-focus-blocked-task-not-found preview=${previewCompact}`,
    };
  }

  const protectedClassification = classifyTaskProtectedScope(task);
  const reasonCodes = protectedClassification.reasonCodes;
  const signals = protectedClassification.signals;
  const evidence = protectedClassification.evidence.map((row) => `${row.source}:${row.signal} (${row.matchedOn})`);
  const valuePotential = resolveValuePotential(task);
  const effortLevel = resolveEffortLevel(task);
  const riskLevel = resolveRiskLevel(reasonCodes);

  const declaredFilesKnown = (task.files?.length ?? 0) > 0;
  const validationGateKnown = (task.acceptance_criteria?.length ?? 0) > 0;
  const rollbackPlanKnown = containsRollbackSignal(task);

  const blockers = [
    protectedClassification.protected && !declaredFilesKnown ? "missing-declared-files" : undefined,
    protectedClassification.protected && !validationGateKnown ? "missing-validation-gate" : undefined,
    protectedClassification.protected && riskLevel === "high" && !rollbackPlanKnown ? "missing-rollback-plan" : undefined,
  ].filter(Boolean) as string[];

  let decision: AutonomyProtectedFocusDecisionPacket["decision"] = "ready-for-human-decision";
  let recommendedOption: AutonomyProtectedFocusDecisionPacket["recommendedOption"] = "promote";
  let recommendationCode: AutonomyProtectedFocusDecisionPacket["recommendationCode"] = "protected-focus-promote-canary";
  let nextAction = "ask human to choose promote/skip/defer; if promote, run one protected canary slice with explicit rollback and focal validation.";

  if (!protectedClassification.protected) {
    recommendedOption = "skip";
    recommendationCode = "protected-focus-skip-local-safe";
    nextAction = "task is local-safe; continue via normal local-safe lane without protected focus promotion.";
  } else if (blockers.length > 0) {
    decision = "blocked";
    recommendedOption = "defer";
    recommendationCode = "protected-focus-defer-missing-evidence";
    nextAction = "defer protected focus until declared files, validation gate, and rollback evidence are explicit.";
  } else if (riskLevel === "high" && valuePotential !== "high") {
    recommendedOption = "defer";
    recommendationCode = "protected-focus-defer-high-risk";
    nextAction = "risk is high for current value potential; defer and/or decompose before protected canary execution.";
  }

  const decisionPreview = buildProtectedFocusDecisionPreview({
    decision,
    recommendedOption,
    protectedScope: protectedClassification.protected,
    riskLevel,
    valuePotential,
    blockers,
  });
  const previewCompact = decisionPreview.options.map((option) => `${option.option}:${option.suitability}`).join(",");

  return {
    taskId,
    decision,
    recommendedOption,
    options: ["promote", "skip", "defer"],
    recommendationCode,
    nextAction,
    valuePotential,
    riskLevel,
    effortLevel,
    protectedScope: protectedClassification.protected,
    reasonCodes,
    signals,
    evidence,
    declaredFilesKnown,
    validationGateKnown,
    rollbackPlanKnown,
    blockers,
    decisionPreview,
    reviewMode: "read-only",
    mutationAllowed: false,
    dispatchAllowed: false,
    authorization: "none",
    mode: "report-only",
    summary: [
      "autonomy-protected-focus-packet:",
      `ok=${decision === "ready-for-human-decision" ? "yes" : "no"}`,
      `task=${taskId}`,
      `decision=${decision}`,
      `option=${recommendedOption}`,
      `code=${recommendationCode}`,
      `risk=${riskLevel}`,
      `value=${valuePotential}`,
      `preview=${previewCompact}`,
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    ].filter(Boolean).join(" "),
  };
}

export function evaluateAutonomyProtectedFocusDecisionPacket(
  cwd: string,
  taskIdInput: string,
): AutonomyProtectedFocusDecisionPacket {
  return buildAutonomyProtectedFocusDecisionPacket(readProjectTasksBlock(cwd).tasks, taskIdInput);
}

export function evaluateAutonomyLaneTaskSelection(
  cwd: string,
  options?: AutonomyTaskSelectorOptions,
): AutonomyTaskSelection {
  return selectAutonomyLaneTask(readProjectTasksBlock(cwd).tasks, options);
}
