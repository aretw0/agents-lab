import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface LongRunProviderTransientRetryConfig {
  enabled: boolean;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_LONG_RUN_PROVIDER_TRANSIENT_RETRY_CONFIG: LongRunProviderTransientRetryConfig = {
  enabled: true,
  maxAttempts: 10,
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
  backoffMultiplier: 2,
};

const PROVIDER_TRANSIENT_ERROR_RE =
  /(server[_-]?is[_-]?overload|overload(ed)?|\b429\b|rate.?limit|too\s+many\s+requests|capacity\s*reached|resource\s*exhausted|temporar(y|ily)\s*unavailable|\b5\d\d\b|internal\s*server\s*error)/i;

const TOOL_OUTPUT_ORPHAN_ERROR_RE =
  /(no\s+tool\s+call\s+found\s+for\s+function\s+call\s+output|function[_-]?call[_-]?output[^\n]*call[_-]?id|orphan(ed)?\s+function[_-]?call[_-]?output)/i;

export type DispatchFailureClass = "provider-transient" | "tool-output-orphan" | "other";

export function resolveDispatchFailurePauseAfter(
  errorClass: DispatchFailureClass,
  configuredPauseAfter: number,
  orphanPauseAfter = 1,
): number {
  const base = Number.isFinite(Number(configuredPauseAfter)) && Number(configuredPauseAfter) > 0
    ? Math.max(1, Math.floor(Number(configuredPauseAfter)))
    : 3;
  const orphan = Number.isFinite(Number(orphanPauseAfter)) && Number(orphanPauseAfter) > 0
    ? Math.max(1, Math.floor(Number(orphanPauseAfter)))
    : 1;
  return errorClass === "tool-output-orphan" ? orphan : base;
}

export function resolveDispatchFailureWindowMs(
  errorClass: DispatchFailureClass,
  configuredWindowMs: number,
  orphanWindowMs = configuredWindowMs,
): number {
  const base = Number.isFinite(Number(configuredWindowMs)) && Number(configuredWindowMs) >= 1_000
    ? Math.max(1_000, Math.floor(Number(configuredWindowMs)))
    : 120_000;
  const orphan = Number.isFinite(Number(orphanWindowMs)) && Number(orphanWindowMs) >= 1_000
    ? Math.max(1_000, Math.floor(Number(orphanWindowMs)))
    : base;
  return errorClass === "tool-output-orphan" ? orphan : base;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value !== "boolean") return fallback;
  return value;
}

function normalizeInt(value: unknown, min: number, max: number, fallback: number): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

function normalizeFloat(value: unknown, min: number, max: number, fallback: number): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

export function resolveLongRunProviderTransientRetryConfig(cwd: string): LongRunProviderTransientRetryConfig {
  try {
    const p = join(cwd, ".pi", "settings.json");
    if (!existsSync(p)) return DEFAULT_LONG_RUN_PROVIDER_TRANSIENT_RETRY_CONFIG;
    const json = JSON.parse(readFileSync(p, "utf8"));
    const cfg = json?.piStack?.guardrailsCore?.longRunIntentQueue?.providerTransientRetry ?? {};

    const baseDelayMs = normalizeInt(
      cfg?.baseDelayMs,
      250,
      120_000,
      DEFAULT_LONG_RUN_PROVIDER_TRANSIENT_RETRY_CONFIG.baseDelayMs,
    );
    const maxDelayMs = normalizeInt(
      cfg?.maxDelayMs,
      1_000,
      300_000,
      DEFAULT_LONG_RUN_PROVIDER_TRANSIENT_RETRY_CONFIG.maxDelayMs,
    );

    return {
      enabled: normalizeBoolean(
        cfg?.enabled,
        DEFAULT_LONG_RUN_PROVIDER_TRANSIENT_RETRY_CONFIG.enabled,
      ),
      maxAttempts: normalizeInt(
        cfg?.maxAttempts,
        10,
        50,
        DEFAULT_LONG_RUN_PROVIDER_TRANSIENT_RETRY_CONFIG.maxAttempts,
      ),
      baseDelayMs,
      maxDelayMs: Math.max(baseDelayMs, maxDelayMs),
      backoffMultiplier: normalizeFloat(
        cfg?.backoffMultiplier,
        1,
        5,
        DEFAULT_LONG_RUN_PROVIDER_TRANSIENT_RETRY_CONFIG.backoffMultiplier,
      ),
    };
  } catch {
    return DEFAULT_LONG_RUN_PROVIDER_TRANSIENT_RETRY_CONFIG;
  }
}

export function classifyLongRunDispatchFailure(errorText: string | undefined): DispatchFailureClass {
  const text = String(errorText ?? "").trim();
  if (!text) return "other";
  if (TOOL_OUTPUT_ORPHAN_ERROR_RE.test(text)) return "tool-output-orphan";
  if (PROVIDER_TRANSIENT_ERROR_RE.test(text)) return "provider-transient";
  return "other";
}

export function resolveProviderTransientRetryDelayMs(
  consecutiveFailures: number,
  cfg: LongRunProviderTransientRetryConfig,
): number {
  const failures = Math.max(1, Math.floor(Number(consecutiveFailures) || 1));
  const exponent = Math.max(0, failures - 1);
  const raw = cfg.baseDelayMs * Math.pow(cfg.backoffMultiplier, exponent);
  return Math.max(cfg.baseDelayMs, Math.min(cfg.maxDelayMs, Math.floor(raw)));
}

export function resolveDispatchFailureBlockAfter(
  state: { lastError?: string } | undefined,
  fallbackThreshold: number,
  cfg: LongRunProviderTransientRetryConfig,
): number {
  const threshold = Math.max(1, Math.floor(Number(fallbackThreshold) || 1));
  if (!cfg.enabled) return threshold;
  if (classifyLongRunDispatchFailure(state?.lastError) !== "provider-transient") return threshold;
  return Math.max(threshold, cfg.maxAttempts);
}

export function isProviderTransientRetryExhausted(
  state: { consecutiveDispatchFailures?: number; lastError?: string } | undefined,
  effectiveBlockAfter: number,
  cfg: LongRunProviderTransientRetryConfig,
): boolean {
  if (!cfg.enabled) return false;
  if (classifyLongRunDispatchFailure(state?.lastError) !== "provider-transient") return false;
  const failures = Math.max(0, Math.floor(Number(state?.consecutiveDispatchFailures) || 0));
  const threshold = Math.max(1, Math.floor(Number(effectiveBlockAfter) || 1));
  return failures >= threshold;
}

export function buildProviderRetryExhaustedActionLines(): string[] {
  return [
    "action: run /provider-readiness-matrix to inspect healthy providers",
    "action: optionally switch via /handoff --execute --reason runtime-transient-overload",
    "action: after provider recovery, run /lane-queue resume",
  ];
}

export function buildToolOutputOrphanRecoveryActionLines(): string[] {
  return [
    "action: run /reload to clear stale function_call_output context",
    "action: run /lane-queue status to confirm failSig/failClass reset",
    "action: resume dispatch via /lane-queue resume (or npm run pi:loop:resume)",
  ];
}
