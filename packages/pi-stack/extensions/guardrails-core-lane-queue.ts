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
};

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
    };
  } catch {
    return DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG;
  }
}

export function shouldQueueInputForLongRun(
  text: string,
  activeLongRun: boolean,
  cfg: LongRunIntentQueueConfig,
): boolean {
  if (!cfg.enabled) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.toLowerCase().startsWith(cfg.forceNowPrefix)) return false;
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
    "usage: /lane-queue [status|help|list|add <text>|pop|clear]",
    "examples: /lane-queue list · /lane-queue clear · /lane-queue add revisar isso depois",
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
