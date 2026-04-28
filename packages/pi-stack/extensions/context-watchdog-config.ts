export type ContextWatchSteeringLevel = "warn" | "checkpoint" | "compact";

export type ContextWatchdogConfig = {
	enabled: boolean;
	checkpointPct?: number;
	compactPct?: number;
	cooldownMs: number;
	notify: boolean;
	modelSteeringFromLevel: ContextWatchSteeringLevel;
	userNotifyFromLevel: ContextWatchSteeringLevel;
	status: boolean;
	autoCheckpoint: boolean;
	autoCompact: boolean;
	autoCompactCooldownMs: number;
	autoCompactRequireIdle: boolean;
	autoResumeAfterCompact: boolean;
	autoResumeCooldownMs: number;
	handoffFreshMaxAgeMs: number;
};

export type ContextWatchThresholds = {
	warnPct: number;
	checkpointPct: number;
	compactPct: number;
};

export const DEFAULT_CONTEXT_WATCHDOG_CONFIG: ContextWatchdogConfig = {
	enabled: true,
	cooldownMs: 10 * 60 * 1000,
	notify: true,
	modelSteeringFromLevel: "compact",
	userNotifyFromLevel: "compact",
	status: true,
	autoCheckpoint: true,
	autoCompact: true,
	autoCompactCooldownMs: 20 * 60 * 1000,
	autoCompactRequireIdle: true,
	autoResumeAfterCompact: true,
	autoResumeCooldownMs: 30_000,
	handoffFreshMaxAgeMs: 30 * 60 * 1000,
};

function toFiniteNumber(value: unknown): number | undefined {
	const n = Number(value);
	if (!Number.isFinite(n)) return undefined;
	return n;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function steeringLevelRank(level: ContextWatchSteeringLevel): number {
	if (level === "warn") return 1;
	if (level === "checkpoint") return 2;
	return 3;
}

function parseSteeringLevel(value: unknown, fallback: ContextWatchSteeringLevel): ContextWatchSteeringLevel {
	const text = String(value ?? "").trim().toLowerCase();
	if (text === "warn" || text === "checkpoint" || text === "compact") {
		return text;
	}
	return fallback;
}

export function normalizeContextWatchdogConfig(input: unknown): ContextWatchdogConfig {
	const cfg = (input && typeof input === "object")
		? (input as Record<string, unknown>)
		: {};

	const checkpointPct = toFiniteNumber(cfg.checkpointPct);
	const compactPct = toFiniteNumber(cfg.compactPct);
	const cooldownMs = toFiniteNumber(cfg.cooldownMs);
	const autoCompactCooldownMs = toFiniteNumber(cfg.autoCompactCooldownMs);
	const autoResumeCooldownMs = toFiniteNumber(cfg.autoResumeCooldownMs);
	const handoffFreshMaxAgeMs = toFiniteNumber(cfg.handoffFreshMaxAgeMs);
	const modelSteeringFromLevel = parseSteeringLevel(
		cfg.modelSteeringFromLevel,
		DEFAULT_CONTEXT_WATCHDOG_CONFIG.modelSteeringFromLevel,
	);
	const userNotifyFromLevelRaw = parseSteeringLevel(
		cfg.userNotifyFromLevel,
		DEFAULT_CONTEXT_WATCHDOG_CONFIG.userNotifyFromLevel,
	);
	const userNotifyFromLevel = steeringLevelRank(userNotifyFromLevelRaw) < steeringLevelRank(modelSteeringFromLevel)
		? modelSteeringFromLevel
		: userNotifyFromLevelRaw;

	return {
		enabled: toBoolean(cfg.enabled, DEFAULT_CONTEXT_WATCHDOG_CONFIG.enabled),
		checkpointPct:
			checkpointPct !== undefined ? Math.max(1, Math.min(99, Math.floor(checkpointPct))) : undefined,
		compactPct:
			compactPct !== undefined ? Math.max(2, Math.min(100, Math.floor(compactPct))) : undefined,
		cooldownMs:
			cooldownMs !== undefined ? Math.max(60_000, Math.floor(cooldownMs)) : DEFAULT_CONTEXT_WATCHDOG_CONFIG.cooldownMs,
		notify: toBoolean(cfg.notify, DEFAULT_CONTEXT_WATCHDOG_CONFIG.notify),
		modelSteeringFromLevel,
		userNotifyFromLevel,
		status: toBoolean(cfg.status, DEFAULT_CONTEXT_WATCHDOG_CONFIG.status),
		autoCheckpoint: toBoolean(cfg.autoCheckpoint, DEFAULT_CONTEXT_WATCHDOG_CONFIG.autoCheckpoint),
		autoCompact: toBoolean(cfg.autoCompact, DEFAULT_CONTEXT_WATCHDOG_CONFIG.autoCompact),
		autoCompactCooldownMs: autoCompactCooldownMs !== undefined
			? Math.max(60_000, Math.floor(autoCompactCooldownMs))
			: DEFAULT_CONTEXT_WATCHDOG_CONFIG.autoCompactCooldownMs,
		autoCompactRequireIdle: toBoolean(cfg.autoCompactRequireIdle, DEFAULT_CONTEXT_WATCHDOG_CONFIG.autoCompactRequireIdle),
		autoResumeAfterCompact: toBoolean(cfg.autoResumeAfterCompact, DEFAULT_CONTEXT_WATCHDOG_CONFIG.autoResumeAfterCompact),
		autoResumeCooldownMs: autoResumeCooldownMs !== undefined
			? Math.max(5_000, Math.floor(autoResumeCooldownMs))
			: DEFAULT_CONTEXT_WATCHDOG_CONFIG.autoResumeCooldownMs,
		handoffFreshMaxAgeMs: handoffFreshMaxAgeMs !== undefined
			? Math.max(60_000, Math.floor(handoffFreshMaxAgeMs))
			: DEFAULT_CONTEXT_WATCHDOG_CONFIG.handoffFreshMaxAgeMs,
	};
}

export function deriveContextWatchThresholds(
	warningPct: number,
	errorPct: number,
	cfg: ContextWatchdogConfig,
): ContextWatchThresholds {
	const warn = Math.max(1, Math.min(99, Math.floor(warningPct)));
	// Default compact target keeps headroom before footer "error" pressure.
	// OpenAI-like defaults become ~72, Anthropic-like defaults ~82.
	const compactDefault = Math.max(warn + 4, Math.floor(errorPct) - 3);
	const compactRaw = cfg.compactPct ?? compactDefault;
	const compact = Math.max(warn + 2, Math.min(100, Math.floor(compactRaw)));

	// Default checkpoint is the pre-compact lane (4pp before compact).
	const checkpointDefault = Math.max(warn + 1, compact - 4);
	const checkpointRaw = cfg.checkpointPct ?? checkpointDefault;
	const checkpoint = Math.max(warn + 1, Math.min(compact - 1, Math.floor(checkpointRaw)));

	return {
		warnPct: warn,
		checkpointPct: checkpoint,
		compactPct: compact,
	};
}
