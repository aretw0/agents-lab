import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeRuntimeFailureCount,
  type LongRunLoopRuntimeHealth,
  type LongRunLoopRuntimeMode,
  type LongRunLoopRuntimeState,
  type LongRunLoopRuntimeStopCondition,
} from "./guardrails-core-lane-queue-runtime";

export {
  markLongRunLoopRuntimeDegraded,
  markLongRunLoopRuntimeDispatch,
  markLongRunLoopRuntimeHealthy,
  readLongRunLoopRuntimeState,
  setLongRunLoopRuntimeMode,
} from "./guardrails-core-lane-queue-runtime";
export type {
  LongRunLoopRuntimeHealth,
  LongRunLoopRuntimeMode,
  LongRunLoopRuntimeState,
  LongRunLoopRuntimeStopCondition,
} from "./guardrails-core-lane-queue-runtime";

export interface LongRunIntentQueueConfig {
  enabled: boolean;
  requireActiveLongRun: boolean;
  maxItems: number;
  forceNowPrefix: string;
  defaultBoardMilestone?: string;
  autoDrainOnIdle: boolean;
  autoDrainCooldownMs: number;
  autoDrainBatchSize: number;
  autoDrainIdleStableMs: number;
  dispatchFailureBlockAfter: number;
  rapidRedispatchWindowMs: number;
  dedupeWindowMs: number;
  identicalFailurePauseAfter: number;
  orphanFailurePauseAfter: number;
  identicalFailureWindowMs: number;
  orphanFailureWindowMs: number;
}

export interface DeferredIntentItem {
  id: string;
  atIso: string;
  text: string;
  source: string;
}

interface DeferredIntentQueueStore {
  version: number;
  items: DeferredIntentItem[];
}

export const DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG: LongRunIntentQueueConfig = {
  enabled: true,
  requireActiveLongRun: true,
  maxItems: 50,
  forceNowPrefix: "lane-now:",
  autoDrainOnIdle: true,
  autoDrainCooldownMs: 3000,
  autoDrainBatchSize: 1,
  autoDrainIdleStableMs: 1500,
  dispatchFailureBlockAfter: 3,
  rapidRedispatchWindowMs: 5 * 60 * 1000,
  dedupeWindowMs: 2 * 60 * 1000,
  identicalFailurePauseAfter: 3,
  orphanFailurePauseAfter: 1,
  identicalFailureWindowMs: 2 * 60 * 1000,
  orphanFailureWindowMs: 2 * 60 * 1000,
};

function normalizeMilestoneLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const unwrapped = trimmed.length >= 2
    && ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ? trimmed.slice(1, -1)
    : trimmed;
  const normalized = unwrapped.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length <= 120 ? normalized : `${normalized.slice(0, 119)}…`;
}

function deferredIntentQueuePath(cwd: string): string {
  return join(cwd, ".pi", "deferred-intents.json");
}

function readDeferredIntentQueue(cwd: string): DeferredIntentQueueStore {
  const p = deferredIntentQueuePath(cwd);
  if (!existsSync(p)) return { version: 1, items: [] };
  try {
    const json = JSON.parse(readFileSync(p, "utf8"));
    if (!Array.isArray(json?.items)) return { version: 1, items: [] };
    const items = json.items
      .filter((item: unknown): item is DeferredIntentItem => {
        const row = item as DeferredIntentItem;
        return Boolean(row?.id && typeof row?.text === "string" && row.text.trim().length > 0);
      })
      .map((row: DeferredIntentItem) => ({
        id: row.id,
        atIso: typeof row.atIso === "string" && row.atIso ? row.atIso : new Date().toISOString(),
        text: row.text,
        source: typeof row.source === "string" ? row.source : "interactive",
      }));
    return { version: 1, items };
  } catch {
    return { version: 1, items: [] };
  }
}

function writeDeferredIntentQueue(cwd: string, store: DeferredIntentQueueStore): string {
  const p = deferredIntentQueuePath(cwd);
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(p, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  return p;
}

export function resolveLongRunIntentQueueConfig(cwd: string): LongRunIntentQueueConfig {
  try {
    const p = join(cwd, ".pi", "settings.json");
    if (!existsSync(p)) return DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG;
    const json = JSON.parse(readFileSync(p, "utf8"));
    const cfg = json?.piStack?.guardrailsCore?.longRunIntentQueue ?? {};
    const maxItemsRaw = Number(cfg?.maxItems);
    const autoDrainCooldownMsRaw = Number(cfg?.autoDrainCooldownMs);
    const autoDrainBatchSizeRaw = Number(cfg?.autoDrainBatchSize);
    const autoDrainIdleStableMsRaw = Number(cfg?.autoDrainIdleStableMs);
    const dispatchFailureBlockAfterRaw = Number(cfg?.dispatchFailureBlockAfter);
    const rapidRedispatchWindowMsRaw = Number(cfg?.rapidRedispatchWindowMs);
    const dedupeWindowMsRaw = Number(cfg?.dedupeWindowMs);
    const identicalFailurePauseAfterRaw = Number(cfg?.identicalFailurePauseAfter);
    const orphanFailurePauseAfterRaw = Number(cfg?.orphanFailurePauseAfter);
    const identicalFailureWindowMsRaw = Number(cfg?.identicalFailureWindowMs);
    const orphanFailureWindowMsRaw = Number(cfg?.orphanFailureWindowMs);
    return {
      enabled: cfg?.enabled !== false,
      requireActiveLongRun: cfg?.requireActiveLongRun !== false,
      maxItems: Number.isFinite(maxItemsRaw) && maxItemsRaw > 0
        ? Math.max(1, Math.min(500, Math.floor(maxItemsRaw)))
        : DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG.maxItems,
      forceNowPrefix: typeof cfg?.forceNowPrefix === "string" && cfg.forceNowPrefix.trim().length > 0
        ? cfg.forceNowPrefix.trim().toLowerCase()
        : DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG.forceNowPrefix,
      defaultBoardMilestone: normalizeMilestoneLabel(cfg?.defaultBoardMilestone),
      autoDrainOnIdle: cfg?.autoDrainOnIdle !== false,
      autoDrainCooldownMs: Number.isFinite(autoDrainCooldownMsRaw) && autoDrainCooldownMsRaw >= 0
        ? Math.max(0, Math.floor(autoDrainCooldownMsRaw))
        : DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG.autoDrainCooldownMs,
      autoDrainBatchSize: Number.isFinite(autoDrainBatchSizeRaw) && autoDrainBatchSizeRaw > 0
        ? Math.max(1, Math.min(10, Math.floor(autoDrainBatchSizeRaw)))
        : DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG.autoDrainBatchSize,
      autoDrainIdleStableMs: Number.isFinite(autoDrainIdleStableMsRaw) && autoDrainIdleStableMsRaw >= 0
        ? Math.max(0, Math.floor(autoDrainIdleStableMsRaw))
        : DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG.autoDrainIdleStableMs,
      dispatchFailureBlockAfter:
        Number.isFinite(dispatchFailureBlockAfterRaw) && dispatchFailureBlockAfterRaw > 0
          ? Math.max(1, Math.min(20, Math.floor(dispatchFailureBlockAfterRaw)))
          : DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG.dispatchFailureBlockAfter,
      rapidRedispatchWindowMs:
        Number.isFinite(rapidRedispatchWindowMsRaw) && rapidRedispatchWindowMsRaw >= 1_000
          ? Math.max(1_000, Math.min(30 * 60 * 1000, Math.floor(rapidRedispatchWindowMsRaw)))
          : DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG.rapidRedispatchWindowMs,
      dedupeWindowMs:
        Number.isFinite(dedupeWindowMsRaw) && dedupeWindowMsRaw >= 1_000
          ? Math.max(1_000, Math.min(30 * 60 * 1000, Math.floor(dedupeWindowMsRaw)))
          : DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG.dedupeWindowMs,
      identicalFailurePauseAfter:
        Number.isFinite(identicalFailurePauseAfterRaw) && identicalFailurePauseAfterRaw > 0
          ? Math.max(1, Math.min(20, Math.floor(identicalFailurePauseAfterRaw)))
          : DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG.identicalFailurePauseAfter,
      orphanFailurePauseAfter:
        Number.isFinite(orphanFailurePauseAfterRaw) && orphanFailurePauseAfterRaw > 0
          ? Math.max(1, Math.min(5, Math.floor(orphanFailurePauseAfterRaw)))
          : DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG.orphanFailurePauseAfter,
      identicalFailureWindowMs:
        Number.isFinite(identicalFailureWindowMsRaw) && identicalFailureWindowMsRaw >= 1_000
          ? Math.max(1_000, Math.min(10 * 60 * 1000, Math.floor(identicalFailureWindowMsRaw)))
          : DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG.identicalFailureWindowMs,
      orphanFailureWindowMs:
        Number.isFinite(orphanFailureWindowMsRaw) && orphanFailureWindowMsRaw >= 1_000
          ? Math.max(1_000, Math.min(10 * 60 * 1000, Math.floor(orphanFailureWindowMsRaw)))
          : DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG.orphanFailureWindowMs,
    };
  } catch {
    return DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG;
  }
}

export function extractForceNowText(
  text: string,
  cfg: Pick<LongRunIntentQueueConfig, "forceNowPrefix">,
): string | undefined {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return undefined;
  if (!trimmed.toLowerCase().startsWith(cfg.forceNowPrefix)) return undefined;
  return trimmed.slice(cfg.forceNowPrefix.length).trim();
}

export function shouldQueueInputForLongRun(
  text: string,
  activeLongRun: boolean,
  cfg: LongRunIntentQueueConfig,
): boolean {
  if (!cfg.enabled) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (extractForceNowText(trimmed, cfg) !== undefined) return false;
  if (trimmed.startsWith("/")) return false;
  if (cfg.requireActiveLongRun && !activeLongRun) return false;
  return true;
}

export function parseLaneQueueAddText(args: string): string | undefined {
  const trimmed = String(args ?? "").trim();
  if (!/^add(\s+|$)/i.test(trimmed)) return undefined;
  const text = trimmed.replace(/^add\b/i, "").trim();
  return text.length > 0 ? text : undefined;
}

export interface LaneQueueBoardNextMilestoneParseResult {
  milestone?: string;
  clearMilestone?: boolean;
  error?: "invalid-board-next-args";
}

export type LaneQueueBoardNextMilestoneSource = "explicit" | "default" | "cleared" | "none";

export type LaneEvidenceMilestoneParityReason = "no-expectation" | "match" | "mismatch";

export interface LaneEvidenceMilestoneParity {
  expectedMilestone?: string;
  boardAutoMilestone?: string;
  loopReadyMilestone?: string;
  matches: boolean;
  reason: LaneEvidenceMilestoneParityReason;
}

export function parseLaneQueueMilestoneScope(args: string): LaneQueueBoardNextMilestoneParseResult {
  const trimmed = String(args ?? "").trim();
  if (!/^(board-next|status|evidence)(\s+|$)/i.test(trimmed)) return {};
  const rest = trimmed.replace(/^(?:board-next|status|evidence)\b/i, "").trim();
  if (!rest) return {};

  const stripWrappedQuotes = (value: string): string | undefined => {
    const text = value.trim();
    if (!text) return text;
    const first = text[0];
    const last = text[text.length - 1];
    const firstIsQuote = first === "\"" || first === "'";
    const lastIsQuote = last === "\"" || last === "'";
    if ((firstIsQuote || lastIsQuote) && !(firstIsQuote && lastIsQuote && first === last)) return undefined;
    if (firstIsQuote) return text.slice(1, -1).trim();
    return text;
  };

  if (/^--no-milestone$/i.test(rest)) {
    return { clearMilestone: true };
  }
  if (/^--no-milestone\s+/i.test(rest)) {
    return { error: "invalid-board-next-args" };
  }

  const fromFlag = rest.match(/^--milestone\s+(.+)$/i)?.[1];
  if (fromFlag) {
    const unwrapped = stripWrappedQuotes(fromFlag);
    const milestone = normalizeMilestoneLabel(unwrapped);
    return milestone ? { milestone } : { error: "invalid-board-next-args" };
  }

  const fromShortFlag = rest.match(/^-m\s+(.+)$/i)?.[1];
  if (fromShortFlag) {
    const unwrapped = stripWrappedQuotes(fromShortFlag);
    const milestone = normalizeMilestoneLabel(unwrapped);
    return milestone ? { milestone } : { error: "invalid-board-next-args" };
  }

  const fromShortFlagInline = rest.match(/^-m=(.+)$/i)?.[1];
  if (fromShortFlagInline) {
    const unwrapped = stripWrappedQuotes(fromShortFlagInline);
    const milestone = normalizeMilestoneLabel(unwrapped);
    return milestone ? { milestone } : { error: "invalid-board-next-args" };
  }

  const fromFlagInline = rest.match(/^--milestone=(.+)$/i)?.[1];
  if (fromFlagInline) {
    const unwrapped = stripWrappedQuotes(fromFlagInline);
    const milestone = normalizeMilestoneLabel(unwrapped);
    return milestone ? { milestone } : { error: "invalid-board-next-args" };
  }

  const fromInline = rest.match(/^milestone=(.+)$/i)?.[1];
  if (fromInline) {
    const unwrapped = stripWrappedQuotes(fromInline);
    const milestone = normalizeMilestoneLabel(unwrapped);
    return milestone ? { milestone } : { error: "invalid-board-next-args" };
  }

  return { error: "invalid-board-next-args" };
}

export function parseLaneQueueBoardNextMilestone(args: string): LaneQueueBoardNextMilestoneParseResult {
  return parseLaneQueueMilestoneScope(args);
}

export function resolveLaneQueueBoardNextMilestoneSelection(
  parsed: LaneQueueBoardNextMilestoneParseResult,
  defaultMilestone: string | undefined,
): { milestone?: string; source: LaneQueueBoardNextMilestoneSource } {
  if (parsed.clearMilestone) return { source: "cleared" };
  if (parsed.milestone) return { milestone: parsed.milestone, source: "explicit" };
  const normalizedDefault = normalizeMilestoneLabel(defaultMilestone);
  if (normalizedDefault) return { milestone: normalizedDefault, source: "default" };
  return { source: "none" };
}

export function evaluateLaneEvidenceMilestoneParity(
  expectedMilestone: string | undefined,
  boardAutoMilestone: string | undefined,
  loopReadyMilestone: string | undefined,
): LaneEvidenceMilestoneParity {
  const expected = normalizeMilestoneLabel(expectedMilestone);
  if (!expected) return { matches: true, reason: "no-expectation" };
  const boardAuto = normalizeMilestoneLabel(boardAutoMilestone);
  const loopReady = normalizeMilestoneLabel(loopReadyMilestone);
  const matches = boardAuto === expected && loopReady === expected;
  return {
    expectedMilestone: expected,
    boardAutoMilestone: boardAuto,
    loopReadyMilestone: loopReady,
    matches,
    reason: matches ? "match" : "mismatch",
  };
}

export function shouldWarnLaneEvidence(
  readyForLoopEvidence: boolean,
  parity: Pick<LaneEvidenceMilestoneParity, "matches">,
): boolean {
  return !readyForLoopEvidence || !parity.matches;
}

export function buildLaneQueueStatusUsage(): string {
  return "/lane-queue status [--milestone <label>|-m <label>|-m=<label>|--no-milestone]";
}

export function buildLaneQueueBoardNextUsage(): string {
  return "/lane-queue board-next [--milestone <label>|-m <label>|-m=<label>|--no-milestone]";
}

export function buildLaneQueueEvidenceUsage(): string {
  return "/lane-queue evidence [--milestone <label>|-m <label>|-m=<label>|--no-milestone]";
}

export function buildLaneQueueHelpLines(): string[] {
  return [
    "lane-queue: deferred intents for long-run continuity.",
    `usage: /lane-queue [status [--milestone <label>|-m <label>|-m=<label>|--no-milestone]|help|list|add <text>|board-next [--milestone <label>|-m <label>|-m=<label>|--no-milestone]|pop|clear|pause|resume|evidence [--milestone <label>|-m <label>|-m=<label>|--no-milestone]]`,
    "scope: lane-queue mantém backlog entre turns (deferred intents + board-next); follow-up/steering nativos seguem caminho padrão para ação imediata no mesmo turno.",
    "decision(2026-05): manter contrato mínimo; list/clear/pause/resume ficam como controles operacionais de fila (não como primitiva de steering).",
    "instant override: use 'lane-now:<mensagem>' to bypass queue and send immediate follow-up.",
    "examples: /lane-queue status --no-milestone · /lane-queue list · /lane-queue board-next -m \"MS-LOCAL\" · /lane-queue board-next --no-milestone · /lane-queue evidence -m=MS-LOCAL",
  ];
}

export function buildLaneQueueStatusTips(queued: number): string[] {
  const tips = [
    "tip: for same-turn streaming queue use native follow-up (Alt+Enter / app.message.followUp).",
  ];
  if (queued > 0) {
    tips.push("tip: use /lane-queue list to inspect pending items and /lane-queue clear to reset queue.");
  } else {
    tips.push("tip: use /lane-queue add <text> to defer a request without breaking current long-run focus.");
  }
  return tips;
}

export type AutoDrainGateReason =
  | "disabled"
  | "empty"
  | "active-long-run"
  | "cooldown"
  | "idle-stability"
  | "lease-expired"
  | "dispatch-failure-advisory"
  | "dispatch-failure-blocking"
  | "ready";

export function resolveAutoDrainGateReason(
  activeLongRun: boolean,
  queuedCount: number,
  nowMs: number,
  lastAutoDrainAt: number,
  idleSinceMs: number,
  cfg: LongRunIntentQueueConfig,
): AutoDrainGateReason {
  if (!cfg.enabled || !cfg.autoDrainOnIdle) return "disabled";
  if (queuedCount <= 0) return "empty";
  if (activeLongRun) return "active-long-run";
  const cooldownRemaining = Math.max(0, cfg.autoDrainCooldownMs - (nowMs - lastAutoDrainAt));
  const idleRemaining = Math.max(0, cfg.autoDrainIdleStableMs - idleSinceMs);
  if (cooldownRemaining > 0 || idleRemaining > 0) {
    return cooldownRemaining >= idleRemaining ? "cooldown" : "idle-stability";
  }
  return "ready";
}

export function isLongRunLoopLeaseExpired(
  state: Pick<LongRunLoopRuntimeState, "leaseExpiresAtIso" | "stopCondition"> | undefined,
  nowMs = Date.now(),
): boolean {
  if (!state) return false;
  if (state.stopCondition === "lease-expired") return true;
  const expiresAtMs = Date.parse(state.leaseExpiresAtIso);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
}

export function resolveAutoDrainRuntimeGateReason(
  gate: AutoDrainGateReason,
  state: Pick<LongRunLoopRuntimeState, "leaseExpiresAtIso" | "stopCondition"> | undefined,
  nowMs = Date.now(),
): AutoDrainGateReason {
  if (isLongRunLoopLeaseExpired(state, nowMs)) return "lease-expired";
  return gate;
}

export type LongRunLoopStopBoundary = "none" | "advisory" | "blocking";

export function resolveLongRunLoopStopBoundary(
  state:
    | (Pick<LongRunLoopRuntimeState, "mode" | "stopCondition"> & {
      consecutiveDispatchFailures?: number;
    })
    | undefined,
  dispatchFailureBlockAfter = 3,
): LongRunLoopStopBoundary {
  if (!state) return "none";
  if (state.mode === "paused") return "blocking";
  if (state.stopCondition === "manual-pause" || state.stopCondition === "lease-expired") {
    return "blocking";
  }
  if (state.stopCondition === "dispatch-failure") {
    const threshold = Math.max(1, Math.floor(Number(dispatchFailureBlockAfter) || 3));
    const failures = normalizeRuntimeFailureCount(state.consecutiveDispatchFailures);
    return failures >= threshold ? "blocking" : "advisory";
  }
  return "none";
}

export function resolveDispatchFailureRuntimeGate(
  state:
    | (Pick<LongRunLoopRuntimeState, "mode" | "stopCondition"> & {
      consecutiveDispatchFailures?: number;
    })
    | undefined,
  dispatchFailureBlockAfter = 3,
): AutoDrainGateReason | undefined {
  if (!state || state.stopCondition !== "dispatch-failure") return undefined;
  const boundary = resolveLongRunLoopStopBoundary(state, dispatchFailureBlockAfter);
  if (boundary === "blocking") return "dispatch-failure-blocking";
  if (boundary === "advisory") return "dispatch-failure-advisory";
  return undefined;
}

export function estimateAutoDrainWaitMs(
  activeLongRun: boolean,
  queuedCount: number,
  nowMs: number,
  lastAutoDrainAt: number,
  idleSinceMs: number,
  cfg: LongRunIntentQueueConfig,
): number | undefined {
  const gate = resolveAutoDrainGateReason(
    activeLongRun,
    queuedCount,
    nowMs,
    lastAutoDrainAt,
    idleSinceMs,
    cfg,
  );
  if (gate !== "cooldown" && gate !== "idle-stability" && gate !== "ready") return undefined;
  const cooldownRemaining = Math.max(0, cfg.autoDrainCooldownMs - (nowMs - lastAutoDrainAt));
  const idleRemaining = Math.max(0, cfg.autoDrainIdleStableMs - idleSinceMs);
  return Math.max(cooldownRemaining, idleRemaining);
}

export function shouldAutoDrainDeferredIntent(
  activeLongRun: boolean,
  queuedCount: number,
  nowMs: number,
  lastAutoDrainAt: number,
  idleSinceMs: number,
  cfg: LongRunIntentQueueConfig,
): boolean {
  const waitMs = estimateAutoDrainWaitMs(
    activeLongRun,
    queuedCount,
    nowMs,
    lastAutoDrainAt,
    idleSinceMs,
    cfg,
  );
  return waitMs !== undefined && waitMs === 0;
}

export function resolveAutoDrainRetryDelayMs(
  activeLongRun: boolean,
  queuedCount: number,
  nowMs: number,
  lastAutoDrainAt: number,
  idleSinceMs: number,
  cfg: LongRunIntentQueueConfig,
): number | undefined {
  const gate = resolveAutoDrainGateReason(
    activeLongRun,
    queuedCount,
    nowMs,
    lastAutoDrainAt,
    idleSinceMs,
    cfg,
  );
  if (gate === "active-long-run") {
    return Math.max(250, cfg.autoDrainIdleStableMs);
  }
  if (gate !== "cooldown" && gate !== "idle-stability") return undefined;
  const waitMs = estimateAutoDrainWaitMs(
    activeLongRun,
    queuedCount,
    nowMs,
    lastAutoDrainAt,
    idleSinceMs,
    cfg,
  );
  if (waitMs === undefined || waitMs <= 0) return undefined;
  return waitMs;
}

export function shouldSchedulePostDispatchAutoDrain(
  dispatched: number,
  remainingQueuedCount: number,
): boolean {
  return dispatched > 0 && remainingQueuedCount > 0;
}

// Default window for detecting rapid same-task re-dispatch (silent execution failure).
// If the same board task is dispatched again within this window, it's likely that the
// previous execution failed silently (e.g. orphaned function_call_output from a
// compacted session) and the counter needs to be incremented rather than reset.
export const BOARD_RAPID_REDISPATCH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export function shouldBlockRapidSameTaskRedispatch(options: {
  taskId: string;
  lastDispatchItemId?: string;
  lastDispatchAtIso?: string;
  nowMs?: number;
  windowMs?: number;
}): boolean {
  const taskId = (options.taskId ?? "").trim();
  if (!taskId) return false;
  const lastItemId = (options.lastDispatchItemId ?? "").trim();
  if (lastItemId !== `board-auto-${taskId}`) return false;
  const lastAtMs = options.lastDispatchAtIso ? Date.parse(options.lastDispatchAtIso) : NaN;
  if (!Number.isFinite(lastAtMs)) return false;
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const windowMs = Number.isFinite(Number(options.windowMs)) && Number(options.windowMs) > 0
    ? Number(options.windowMs)
    : BOARD_RAPID_REDISPATCH_WINDOW_MS;
  return nowMs - lastAtMs < windowMs;
}

export function normalizeDispatchFailureFingerprint(errorText: string, maxChars = 160): string {
  const cap = Math.max(40, Math.floor(Number(maxChars) || 160));
  const normalized = String(errorText ?? "")
    .toLowerCase()
    .replace(/\b(?:tool[_-]?)?call[_-]?id\b["']?(?:\s*[:=]\s*|\s+)["']?[a-z0-9._:/-]{3,}["']?/g, "call_id=call_*")
    .replace(/call_[a-z0-9_-]+/g, "call_*")
    .replace(/[0-9a-f]{12,}/g, "hex_*")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, cap);
  return normalized || "unknown-error";
}

export interface IdenticalFailureStreakInput {
  lastFingerprint?: string;
  lastFailureAtMs?: number;
  streak?: number;
  nextErrorText: string;
  nowMs?: number;
  windowMs?: number;
}

export interface IdenticalFailureStreakResult {
  fingerprint: string;
  streak: number;
  matchedPrevious: boolean;
  withinWindow: boolean;
}

export function computeIdenticalFailureStreak(
  input: IdenticalFailureStreakInput,
): IdenticalFailureStreakResult {
  const fingerprint = normalizeDispatchFailureFingerprint(input.nextErrorText);
  const previousFingerprint = (input.lastFingerprint ?? "").trim();
  const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now();
  const previousAtMs = Number(input.lastFailureAtMs);
  const windowMs = Number.isFinite(Number(input.windowMs)) && Number(input.windowMs) >= 1_000
    ? Math.floor(Number(input.windowMs))
    : DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG.identicalFailureWindowMs;

  const matchedPrevious = previousFingerprint.length > 0 && previousFingerprint === fingerprint;
  const withinWindow =
    matchedPrevious
    && Number.isFinite(previousAtMs)
    && nowMs - previousAtMs <= windowMs;
  const previousStreak = Number.isFinite(Number(input.streak)) ? Math.max(0, Math.floor(Number(input.streak))) : 0;

  return {
    fingerprint,
    streak: withinWindow ? previousStreak + 1 : 1,
    matchedPrevious,
    withinWindow,
  };
}

export function shouldPauseOnIdenticalFailure(streak: number, pauseAfter: number): boolean {
  const safeStreak = Number.isFinite(Number(streak)) ? Math.max(0, Math.floor(Number(streak))) : 0;
  const threshold = Number.isFinite(Number(pauseAfter)) ? Math.max(1, Math.floor(Number(pauseAfter))) : 3;
  return safeStreak >= threshold;
}

export type BoardAutoAdvanceGateReason =
  | "active-long-run"
  | "queued-intents"
  | "loop-paused"
  | "loop-degraded"
  | "stop-condition"
  | "board-not-ready"
  | "missing-next-task-id"
  | "dedupe-window"
  | "ready";

export function resolveBoardAutoAdvanceGateReason(options: {
  activeLongRun: boolean;
  queuedCount: number;
  loopMode: LongRunLoopRuntimeMode;
  loopHealth: LongRunLoopRuntimeHealth;
  stopCondition: LongRunLoopRuntimeStopCondition;
  boardReady: boolean;
  nextTaskId?: string;
  nowMs?: number;
  lastTaskId?: string;
  lastTaskAtMs?: number;
  dedupeWindowMs?: number;
}): BoardAutoAdvanceGateReason {
  if (options.activeLongRun) return "active-long-run";
  if (options.queuedCount !== 0) return "queued-intents";
  if (options.loopMode !== "running") return "loop-paused";
  if (options.loopHealth !== "healthy") return "loop-degraded";
  if (options.stopCondition !== "none") return "stop-condition";
  if (!options.boardReady) return "board-not-ready";
  const nextTaskId = typeof options.nextTaskId === "string" ? options.nextTaskId.trim() : "";
  if (!nextTaskId) return "missing-next-task-id";

  const dedupeWindowMs = Math.max(0, Math.floor(Number(options.dedupeWindowMs) || 0));
  const nowMs = Number(options.nowMs);
  const lastTaskAtMs = Number(options.lastTaskAtMs);
  const lastTaskId = typeof options.lastTaskId === "string" ? options.lastTaskId.trim() : "";
  if (
    dedupeWindowMs > 0
    && Number.isFinite(nowMs)
    && Number.isFinite(lastTaskAtMs)
    && lastTaskId.length > 0
    && lastTaskId === nextTaskId
    && nowMs - lastTaskAtMs < dedupeWindowMs
  ) {
    return "dedupe-window";
  }

  return "ready";
}

export function shouldAutoAdvanceBoardTask(options: {
  activeLongRun: boolean;
  queuedCount: number;
  loopMode: LongRunLoopRuntimeMode;
  loopHealth: LongRunLoopRuntimeHealth;
  stopCondition: LongRunLoopRuntimeStopCondition;
  boardReady: boolean;
  nextTaskId?: string;
  nowMs?: number;
  lastTaskId?: string;
  lastTaskAtMs?: number;
  dedupeWindowMs?: number;
}): boolean {
  return resolveBoardAutoAdvanceGateReason(options) === "ready";
}

export type RuntimeCodeActivationState = "active" | "reload-required" | "unknown";

export function resolveRuntimeCodeActivationState(options: {
  loadedSourceMtimeMs?: number;
  currentSourceMtimeMs?: number;
  mtimeToleranceMs?: number;
}): RuntimeCodeActivationState {
  const loadedMtimeMs = Number(options.loadedSourceMtimeMs);
  const currentMtimeMs = Number(options.currentSourceMtimeMs);
  if (!Number.isFinite(loadedMtimeMs) || !Number.isFinite(currentMtimeMs)) return "unknown";
  const toleranceMs = Math.max(0, Math.floor(Number(options.mtimeToleranceMs) || 0));
  if (currentMtimeMs - loadedMtimeMs > toleranceMs) return "reload-required";
  return "active";
}

export function shouldEmitAutoDrainDeferredAudit(
  lastAuditAtMs: number,
  previousGate: AutoDrainGateReason | undefined,
  nextGate: AutoDrainGateReason,
  nowMs: number,
  minIntervalMs: number,
): boolean {
  if (previousGate !== nextGate) return true;
  if (lastAuditAtMs <= 0) return true;
  return nowMs - lastAuditAtMs >= Math.max(0, Math.floor(minIntervalMs));
}

export function shouldEmitBoardAutoAdvanceGateAudit(
  lastAuditAtMs: number,
  previousGate: BoardAutoAdvanceGateReason | undefined,
  nextGate: BoardAutoAdvanceGateReason,
  nowMs: number,
  minIntervalMs: number,
): boolean {
  if (previousGate !== nextGate) return true;
  if (lastAuditAtMs <= 0) return true;
  return nowMs - lastAuditAtMs >= Math.max(0, Math.floor(minIntervalMs));
}

export interface LoopActivationMarkers {
  preparado: boolean;
  ativoAqui: boolean;
  emLoop: boolean;
  blocker:
    | "loop-not-ready"
    | "runtime-reload-required"
    | "runtime-state-unknown"
    | "active-long-run"
    | "queued-intents"
    | "board-auto-gate"
    | "none";
}

export function resolveLoopActivationMarkers(options: {
  activeLongRun: boolean;
  queuedCount: number;
  loopMode: LongRunLoopRuntimeMode;
  loopHealth: LongRunLoopRuntimeHealth;
  stopCondition: LongRunLoopRuntimeStopCondition;
  boardReady: boolean;
  nextTaskId?: string;
  boardAutoGate: BoardAutoAdvanceGateReason;
  runtimeCodeState: RuntimeCodeActivationState;
}): LoopActivationMarkers {
  const hasNextTaskId = typeof options.nextTaskId === "string" && options.nextTaskId.trim().length > 0;
  const preparado =
    options.loopMode === "running"
    && options.loopHealth === "healthy"
    && options.stopCondition === "none"
    && options.boardReady
    && hasNextTaskId;

  const ativoAqui = options.runtimeCodeState === "active";

  const emLoop =
    preparado
    && ativoAqui
    && !options.activeLongRun
    && options.queuedCount === 0
    && options.boardAutoGate === "ready";

  let blocker: LoopActivationMarkers["blocker"] = "none";
  if (!preparado) blocker = "loop-not-ready";
  else if (options.runtimeCodeState === "reload-required") blocker = "runtime-reload-required";
  else if (options.runtimeCodeState === "unknown") blocker = "runtime-state-unknown";
  else if (options.activeLongRun) blocker = "active-long-run";
  else if (options.queuedCount > 0) blocker = "queued-intents";
  else if (options.boardAutoGate !== "ready") blocker = "board-auto-gate";

  return {
    preparado,
    ativoAqui,
    emLoop,
    blocker,
  };
}

export function buildLoopActivationMarkersLabel(markers: LoopActivationMarkers): string {
  const yesNo = (value: boolean): string => (value ? "yes" : "no");
  return `READY=${yesNo(markers.preparado)} ACTIVE_HERE=${yesNo(markers.ativoAqui)} IN_LOOP=${yesNo(markers.emLoop)} blocker=${markers.blocker}`;
}

export function shouldAnnounceLoopActivationReady(
  previousEmLoop: boolean,
  nextEmLoop: boolean,
): boolean {
  return !previousEmLoop && nextEmLoop;
}

export function buildLoopActivationBlockerHint(markers: LoopActivationMarkers): string | undefined {
  switch (markers.blocker) {
    case "runtime-reload-required":
      return "loopHint: runtime carregado está atrás do código local; faça reload para ativar aqui.";
    case "runtime-state-unknown":
      return "loopHint: não foi possível confirmar ativação runtime; verifique /lane-queue status novamente.";
    case "active-long-run":
      return "loopHint: aguarde lane ficar idle para auto-advance board-first.";
    case "queued-intents":
      return "loopHint: esvazie fila deferred (pop/clear) para liberar auto-advance.";
    case "board-auto-gate":
      return "loopHint: board ainda não está em gate=ready; confira boardAutoGate/boardHint.";
    case "loop-not-ready":
      return "loopHint: loop/board ainda não está pronto (mode/health/stop/deps).";
    default:
      return undefined;
  }
}

export function shouldEmitLoopActivationAudit(
  lastAuditAtMs: number,
  previousLabel: string | undefined,
  nextLabel: string,
  nowMs: number,
  minIntervalMs: number,
): boolean {
  if (previousLabel !== nextLabel) return true;
  if (lastAuditAtMs <= 0) return true;
  return nowMs - lastAuditAtMs >= Math.max(0, Math.floor(minIntervalMs));
}

export interface DeferredIntentEnqueueOptions {
  dedupeKey?: string;
  dedupeWindowMs?: number;
}

function normalizeDeferredIntentDedupeKey(text: string): string {
  const normalized = String(text ?? "").replace(/\r/g, "").trim();
  if (!normalized) return "";

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length > 0 && /^\[intent:[a-z0-9._-]+\]$/i.test(lines[0])) {
    const header = lines[0].toLowerCase();
    const fields = lines
      .slice(1)
      .filter((line) => line.includes("="))
      .map((line) => {
        const eq = line.indexOf("=");
        const key = line.slice(0, eq).trim().toLowerCase();
        const value = line.slice(eq + 1).trim();
        return `${key}=${value}`;
      })
      .sort();
    return [header, ...fields].join("\n");
  }

  return normalized.replace(/\s+/g, " ");
}

export function enqueueDeferredIntent(
  cwd: string,
  text: string,
  source: string,
  maxItems: number,
  options?: DeferredIntentEnqueueOptions,
): { queuePath: string; queuedCount: number; itemId: string; deduped: boolean } {
  const queue = readDeferredIntentQueue(cwd);
  const trimmedText = text.trim();
  const dedupeKey = typeof options?.dedupeKey === "string"
    ? normalizeDeferredIntentDedupeKey(options.dedupeKey)
    : "";
  const dedupeWindowMs = Number.isFinite(Number(options?.dedupeWindowMs))
    ? Math.max(0, Math.floor(Number(options?.dedupeWindowMs)))
    : 0;

  if (dedupeKey && dedupeWindowMs > 0) {
    const nowMs = Date.now();
    for (let index = queue.items.length - 1; index >= 0; index -= 1) {
      const existing = queue.items[index];
      if (normalizeDeferredIntentDedupeKey(existing.text ?? "") !== dedupeKey) continue;
      const existingAtMs = Date.parse(existing.atIso);
      if (!Number.isFinite(existingAtMs)) continue;
      if (nowMs - existingAtMs <= dedupeWindowMs) {
        return {
          queuePath: deferredIntentQueuePath(cwd),
          queuedCount: queue.items.length,
          itemId: existing.id,
          deduped: true,
        };
      }
    }
  }

  const item: DeferredIntentItem = {
    id: `intent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    atIso: new Date().toISOString(),
    text: trimmedText,
    source,
  };
  queue.items.push(item);
  if (queue.items.length > maxItems) {
    queue.items = queue.items.slice(-maxItems);
  }
  const queuePath = writeDeferredIntentQueue(cwd, queue);
  return {
    queuePath,
    queuedCount: queue.items.length,
    itemId: item.id,
    deduped: false,
  };
}

export function dequeueDeferredIntent(
  cwd: string,
): { queuePath: string; queuedCount: number; item?: DeferredIntentItem } {
  const queue = readDeferredIntentQueue(cwd);
  const item = queue.items.shift();
  const queuePath = writeDeferredIntentQueue(cwd, queue);
  return {
    queuePath,
    queuedCount: queue.items.length,
    item,
  };
}

export function clearDeferredIntentQueue(cwd: string): { queuePath: string; cleared: number } {
  const queue = readDeferredIntentQueue(cwd);
  const cleared = queue.items.length;
  const queuePath = writeDeferredIntentQueue(cwd, { version: 1, items: [] });
  return { queuePath, cleared };
}

export function listDeferredIntents(cwd: string): DeferredIntentItem[] {
  return readDeferredIntentQueue(cwd).items;
}

export function oldestDeferredIntentAgeMs(items: DeferredIntentItem[], nowMs = Date.now()): number | undefined {
  let maxAge = -1;
  for (const item of items) {
    const ts = Date.parse(item.atIso);
    if (!Number.isFinite(ts)) continue;
    const age = Math.max(0, nowMs - ts);
    if (age > maxAge) maxAge = age;
  }
  return maxAge >= 0 ? maxAge : undefined;
}

export function getDeferredIntentQueueCount(cwd: string): number {
  return readDeferredIntentQueue(cwd).items.length;
}
