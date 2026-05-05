import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

const DEFAULT_LONG_RUN_LOOP_LEASE_TTL_MS = 30_000;

function longRunLoopStatePath(cwd: string): string {
  return join(cwd, ".pi", "long-run-loop-state.json");
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

export function normalizeRuntimeFailureCount(value: unknown): number {
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
