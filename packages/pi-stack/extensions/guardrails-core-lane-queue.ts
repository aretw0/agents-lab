import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface LongRunIntentQueueConfig {
  enabled: boolean;
  requireActiveLongRun: boolean;
  maxItems: number;
  forceNowPrefix: string;
  autoDrainOnIdle: boolean;
  autoDrainCooldownMs: number;
  autoDrainBatchSize: number;
  autoDrainIdleStableMs: number;
  dispatchFailureBlockAfter: number;
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

export type LongRunLoopRuntimeMode = "running" | "paused";
export type LongRunLoopRuntimeHealth = "healthy" | "degraded";
export type LongRunLoopRuntimeStopCondition = "none" | "manual-pause" | "dispatch-failure" | "lease-expired";

export interface LongRunLoopRuntimeState {
  version: number;
  mode: LongRunLoopRuntimeMode;
  health: LongRunLoopRuntimeHealth;
  leaseOwner: string;
  leaseTtlMs: number;
  leaseHeartbeatAtIso: string;
  leaseExpiresAtIso: string;
  stopCondition: LongRunLoopRuntimeStopCondition;
  stopReason: string;
  consecutiveDispatchFailures: number;
  updatedAtIso: string;
  lastTransitionIso: string;
  lastTransitionReason: string;
  lastDispatchAtIso?: string;
  lastDispatchItemId?: string;
  lastErrorAtIso?: string;
  lastError?: string;
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
};

const DEFAULT_LONG_RUN_LOOP_LEASE_TTL_MS = 30_000;

function deferredIntentQueuePath(cwd: string): string {
  return join(cwd, ".pi", "deferred-intents.json");
}

function longRunLoopStatePath(cwd: string): string {
  return join(cwd, ".pi", "long-run-loop-state.json");
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
    return {
      enabled: cfg?.enabled !== false,
      requireActiveLongRun: cfg?.requireActiveLongRun !== false,
      maxItems: Number.isFinite(maxItemsRaw) && maxItemsRaw > 0
        ? Math.max(1, Math.min(500, Math.floor(maxItemsRaw)))
        : DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG.maxItems,
      forceNowPrefix: typeof cfg?.forceNowPrefix === "string" && cfg.forceNowPrefix.trim().length > 0
        ? cfg.forceNowPrefix.trim().toLowerCase()
        : DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG.forceNowPrefix,
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

export function buildLaneQueueHelpLines(): string[] {
  return [
    "lane-queue: deferred intents for long-run continuity.",
    "usage: /lane-queue [status|help|list|add <text>|board-next|pop|clear|pause|resume|evidence]",
    "examples: /lane-queue list · /lane-queue board-next · /lane-queue evidence · /lane-queue add revisar isso depois",
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
  return `PREPARADO=${yesNo(markers.preparado)} ATIVO_AQUI=${yesNo(markers.ativoAqui)} EM_LOOP=${yesNo(markers.emLoop)} blocker=${markers.blocker}`;
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

export function enqueueDeferredIntent(
  cwd: string,
  text: string,
  source: string,
  maxItems: number,
): { queuePath: string; queuedCount: number; itemId: string } {
  const queue = readDeferredIntentQueue(cwd);
  const item: DeferredIntentItem = {
    id: `intent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    atIso: new Date().toISOString(),
    text: text.trim(),
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

function normalizeRuntimeMode(value: unknown): LongRunLoopRuntimeMode {
  return value === "paused" ? "paused" : "running";
}

function normalizeRuntimeHealth(value: unknown): LongRunLoopRuntimeHealth {
  return value === "degraded" ? "degraded" : "healthy";
}

function normalizeRuntimeStopCondition(value: unknown): LongRunLoopRuntimeStopCondition {
  if (value === "manual-pause") return "manual-pause";
  if (value === "dispatch-failure") return "dispatch-failure";
  if (value === "lease-expired") return "lease-expired";
  return "none";
}

function normalizeRuntimeReason(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 200) : fallback;
}

function normalizeRuntimeLeaseTtlMs(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_LONG_RUN_LOOP_LEASE_TTL_MS;
  return Math.max(1_000, Math.min(300_000, Math.floor(raw)));
}

function normalizeRuntimeLeaseOwner(value: unknown): string {
  if (typeof value !== "string") return currentLongRunLoopLeaseOwner();
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 120) : currentLongRunLoopLeaseOwner();
}

function normalizeRuntimeFailureCount(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.max(0, Math.min(999, Math.floor(raw)));
}

function addMsToIso(baseIso: string, ms: number): string {
  const baseMs = Date.parse(baseIso);
  const safeBaseMs = Number.isFinite(baseMs) ? baseMs : Date.now();
  return new Date(safeBaseMs + Math.max(0, Math.floor(ms))).toISOString();
}

function currentLongRunLoopLeaseOwner(): string {
  return `guardrails-core:${process.pid}`;
}

function defaultStopReason(condition: LongRunLoopRuntimeStopCondition): string {
  switch (condition) {
    case "manual-pause":
      return "manual-pause";
    case "dispatch-failure":
      return "dispatch-failure";
    case "lease-expired":
      return "lease-expired";
    default:
      return "running";
  }
}

function resolveRuntimeStopCondition(
  mode: LongRunLoopRuntimeMode,
  health: LongRunLoopRuntimeHealth,
  candidate: LongRunLoopRuntimeStopCondition,
  leaseExpiresAtIso: string,
): LongRunLoopRuntimeStopCondition {
  const expiryMs = Date.parse(leaseExpiresAtIso);
  if (Number.isFinite(expiryMs) && expiryMs <= Date.now()) return "lease-expired";
  if (mode === "paused") return "manual-pause";
  if (health === "degraded") return "dispatch-failure";
  return candidate === "none" ? "none" : candidate;
}

function defaultLongRunLoopRuntimeState(nowIso = new Date().toISOString()): LongRunLoopRuntimeState {
  const leaseTtlMs = DEFAULT_LONG_RUN_LOOP_LEASE_TTL_MS;
  return {
    version: 1,
    mode: "running",
    health: "healthy",
    leaseOwner: currentLongRunLoopLeaseOwner(),
    leaseTtlMs,
    leaseHeartbeatAtIso: nowIso,
    leaseExpiresAtIso: addMsToIso(nowIso, leaseTtlMs),
    stopCondition: "none",
    stopReason: "running",
    consecutiveDispatchFailures: 0,
    updatedAtIso: nowIso,
    lastTransitionIso: nowIso,
    lastTransitionReason: "init",
  };
}

function writeLongRunLoopRuntimeState(cwd: string, state: LongRunLoopRuntimeState): string {
  const p = longRunLoopStatePath(cwd);
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(p, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return p;
}

function refreshRuntimeLease(state: LongRunLoopRuntimeState, nowIso: string): void {
  const ttlMs = normalizeRuntimeLeaseTtlMs(state.leaseTtlMs);
  state.leaseOwner = currentLongRunLoopLeaseOwner();
  state.leaseTtlMs = ttlMs;
  state.leaseHeartbeatAtIso = nowIso;
  state.leaseExpiresAtIso = addMsToIso(nowIso, ttlMs);
}

export function readLongRunLoopRuntimeState(cwd: string): LongRunLoopRuntimeState {
  const p = longRunLoopStatePath(cwd);
  if (!existsSync(p)) return defaultLongRunLoopRuntimeState();
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    const fallback = defaultLongRunLoopRuntimeState();
    const leaseTtlMs = normalizeRuntimeLeaseTtlMs(raw.leaseTtlMs);
    const leaseHeartbeatAtIso =
      typeof raw.leaseHeartbeatAtIso === "string" && raw.leaseHeartbeatAtIso
        ? raw.leaseHeartbeatAtIso
        : fallback.leaseHeartbeatAtIso;
    const leaseExpiresAtIso =
      typeof raw.leaseExpiresAtIso === "string" && raw.leaseExpiresAtIso
        ? raw.leaseExpiresAtIso
        : addMsToIso(leaseHeartbeatAtIso, leaseTtlMs);
    const mode = normalizeRuntimeMode(raw.mode);
    const health = normalizeRuntimeHealth(raw.health);
    const stopCondition = resolveRuntimeStopCondition(
      mode,
      health,
      normalizeRuntimeStopCondition(raw.stopCondition),
      leaseExpiresAtIso,
    );
    return {
      version: 1,
      mode,
      health,
      leaseOwner: normalizeRuntimeLeaseOwner(raw.leaseOwner),
      leaseTtlMs,
      leaseHeartbeatAtIso,
      leaseExpiresAtIso,
      stopCondition,
      stopReason: normalizeRuntimeReason(raw.stopReason, defaultStopReason(stopCondition)),
      consecutiveDispatchFailures: normalizeRuntimeFailureCount(raw.consecutiveDispatchFailures),
      updatedAtIso:
        typeof raw.updatedAtIso === "string" && raw.updatedAtIso
          ? raw.updatedAtIso
          : fallback.updatedAtIso,
      lastTransitionIso:
        typeof raw.lastTransitionIso === "string" && raw.lastTransitionIso
          ? raw.lastTransitionIso
          : fallback.lastTransitionIso,
      lastTransitionReason: normalizeRuntimeReason(
        raw.lastTransitionReason,
        fallback.lastTransitionReason,
      ),
      lastDispatchAtIso:
        typeof raw.lastDispatchAtIso === "string" && raw.lastDispatchAtIso
          ? raw.lastDispatchAtIso
          : undefined,
      lastDispatchItemId:
        typeof raw.lastDispatchItemId === "string" && raw.lastDispatchItemId
          ? raw.lastDispatchItemId
          : undefined,
      lastErrorAtIso:
        typeof raw.lastErrorAtIso === "string" && raw.lastErrorAtIso
          ? raw.lastErrorAtIso
          : undefined,
      lastError:
        typeof raw.lastError === "string" && raw.lastError.trim().length > 0
          ? raw.lastError.trim().slice(0, 500)
          : undefined,
    };
  } catch {
    return defaultLongRunLoopRuntimeState();
  }
}

function mutateLongRunLoopRuntimeState(
  cwd: string,
  mutator: (state: LongRunLoopRuntimeState, nowIso: string) => void,
): { path: string; state: LongRunLoopRuntimeState } {
  const nowIso = new Date().toISOString();
  const state = readLongRunLoopRuntimeState(cwd);
  mutator(state, nowIso);
  state.consecutiveDispatchFailures = normalizeRuntimeFailureCount(state.consecutiveDispatchFailures);
  refreshRuntimeLease(state, nowIso);
  state.stopCondition = resolveRuntimeStopCondition(
    state.mode,
    state.health,
    normalizeRuntimeStopCondition(state.stopCondition),
    state.leaseExpiresAtIso,
  );
  state.stopReason = normalizeRuntimeReason(state.stopReason, defaultStopReason(state.stopCondition));
  if (state.stopCondition === "none") {
    state.stopReason = "running";
  }
  state.updatedAtIso = nowIso;
  const path = writeLongRunLoopRuntimeState(cwd, state);
  return { path, state };
}

export function setLongRunLoopRuntimeMode(
  cwd: string,
  mode: LongRunLoopRuntimeMode,
  reason: string,
): { path: string; state: LongRunLoopRuntimeState } {
  return mutateLongRunLoopRuntimeState(cwd, (state, nowIso) => {
    const nextMode = normalizeRuntimeMode(mode);
    if (state.mode !== nextMode) {
      state.mode = nextMode;
      state.lastTransitionIso = nowIso;
      state.lastTransitionReason = normalizeRuntimeReason(reason, `mode:${nextMode}`);
    }
    if (nextMode === "paused") {
      state.stopCondition = "manual-pause";
      state.stopReason = normalizeRuntimeReason(reason, defaultStopReason("manual-pause"));
      return;
    }
    state.stopCondition = state.health === "degraded" ? "dispatch-failure" : "none";
    state.stopReason = state.stopCondition === "none"
      ? "running"
      : normalizeRuntimeReason(reason, defaultStopReason(state.stopCondition));
  });
}

export function markLongRunLoopRuntimeDispatch(
  cwd: string,
  itemId: string,
): { path: string; state: LongRunLoopRuntimeState } {
  return mutateLongRunLoopRuntimeState(cwd, (state, nowIso) => {
    state.health = "healthy";
    state.lastDispatchAtIso = nowIso;
    state.lastDispatchItemId = itemId;
    state.lastErrorAtIso = undefined;
    state.lastError = undefined;
    state.consecutiveDispatchFailures = 0;
    state.stopCondition = state.mode === "paused" ? "manual-pause" : "none";
    state.stopReason = state.stopCondition === "none" ? "running" : defaultStopReason(state.stopCondition);
  });
}

export function markLongRunLoopRuntimeDegraded(
  cwd: string,
  reason: string,
  errorText?: string,
): { path: string; state: LongRunLoopRuntimeState } {
  return mutateLongRunLoopRuntimeState(cwd, (state, nowIso) => {
    state.health = "degraded";
    state.lastTransitionIso = nowIso;
    state.lastTransitionReason = normalizeRuntimeReason(reason, "degraded");
    state.lastErrorAtIso = nowIso;
    state.lastError =
      typeof errorText === "string" && errorText.trim().length > 0
        ? errorText.trim().slice(0, 500)
        : "unknown-error";
    state.consecutiveDispatchFailures = normalizeRuntimeFailureCount(state.consecutiveDispatchFailures) + 1;
    state.stopCondition = "dispatch-failure";
    state.stopReason = normalizeRuntimeReason(reason, defaultStopReason("dispatch-failure"));
  });
}

export function markLongRunLoopRuntimeHealthy(
  cwd: string,
  reason: string,
): { path: string; state: LongRunLoopRuntimeState } {
  return mutateLongRunLoopRuntimeState(cwd, (state, nowIso) => {
    if (state.health !== "healthy") {
      state.lastTransitionIso = nowIso;
      state.lastTransitionReason = normalizeRuntimeReason(reason, "recovered");
    }
    state.health = "healthy";
    state.lastErrorAtIso = undefined;
    state.lastError = undefined;
    state.consecutiveDispatchFailures = 0;
    state.stopCondition = state.mode === "paused" ? "manual-pause" : "none";
    state.stopReason = state.stopCondition === "none" ? "running" : defaultStopReason(state.stopCondition);
  });
}
