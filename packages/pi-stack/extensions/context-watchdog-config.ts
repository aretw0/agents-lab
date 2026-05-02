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
	checkpointPct: 55,
	compactPct: 65,
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
			checkpointPct !== undefined
				? Math.max(1, Math.min(99, Math.floor(checkpointPct)))
				: DEFAULT_CONTEXT_WATCHDOG_CONFIG.checkpointPct,
		compactPct:
			compactPct !== undefined
				? Math.max(2, Math.min(100, Math.floor(compactPct)))
				: DEFAULT_CONTEXT_WATCHDOG_CONFIG.compactPct,
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
	const warningBase = Math.max(1, Math.min(99, Math.floor(warningPct)));
	const error = Math.max(warningBase + 1, Math.min(100, Math.floor(errorPct)));

	// Sane global compact ceiling: keep a fixed upper cap unless caller overrides.
	const compactDefault = Math.max(2, error - 3);
	const compactRaw = cfg.compactPct ?? compactDefault;
	const compactCeiling = Math.max(2, error - 1);
	const compact = Math.max(2, Math.min(compactCeiling, Math.floor(compactRaw)));

	// Default checkpoint is a broader pre-compact lane (10pp before compact).
	const checkpointDefault = Math.max(1, compact - 10);
	const checkpointRaw = cfg.checkpointPct ?? checkpointDefault;
	const checkpoint = Math.max(1, Math.min(compact - 1, Math.floor(checkpointRaw)));

	// Preserve canonical order even when provider warning baseline is higher.
	const warn = Math.max(1, Math.min(warningBase, checkpoint - 1));

	return {
		warnPct: warn,
		checkpointPct: checkpoint,
		compactPct: compact,
	};
}
