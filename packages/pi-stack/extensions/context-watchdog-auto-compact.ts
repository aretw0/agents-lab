export type ContextWatchdogLevel = "ok" | "warn" | "checkpoint" | "compact";

export type AutoCompactAssessmentLike = {
	level: ContextWatchdogLevel;
};

export type AutoCompactConfigLike = {
	autoCompact: boolean;
	autoCompactCooldownMs: number;
	autoCompactRequireIdle: boolean;
};

export type ContextWatchAutoCompactDecision = {
	trigger: boolean;
	reason:
		| "level-not-compact"
		| "feature-disabled"
		| "in-flight"
		| "cooldown"
		| "not-idle"
		| "pending-messages"
		| "trigger";
};

export function isAutoCompactDeferralReason(
	reason: ContextWatchAutoCompactDecision["reason"],
): boolean {
	return reason === "not-idle"
		|| reason === "pending-messages"
		|| reason === "in-flight"
		|| reason === "cooldown";
}

export function shouldScheduleAutoCompactRetry(decision: ContextWatchAutoCompactDecision): boolean {
	if (decision.trigger) return false;
	return decision.reason === "not-idle"
		|| decision.reason === "pending-messages"
		|| decision.reason === "in-flight";
}

export function resolveAutoCompactRetryDelayMs(
	decision: ContextWatchAutoCompactDecision,
	state: { nowMs: number; lastAutoCompactAt: number },
	config: AutoCompactConfigLike,
	defaultRetryMs: number,
): number | undefined {
	if (decision.trigger) return undefined;
	if (decision.reason === "cooldown") {
		const remaining = config.autoCompactCooldownMs - (state.nowMs - state.lastAutoCompactAt);
		return Math.max(250, Math.floor(remaining));
	}
	if (shouldScheduleAutoCompactRetry(decision)) {
		return Math.max(250, Math.floor(defaultRetryMs));
	}
	return undefined;
}

export type ContextWatchAutoCompactDiagnostics = {
	decision: ContextWatchAutoCompactDecision;
	retryRecommended: boolean;
	retryDelayMs?: number;
};

export function buildAutoCompactDiagnostics(
	assessment: AutoCompactAssessmentLike,
	config: AutoCompactConfigLike,
	state: {
		nowMs: number;
		lastAutoCompactAt: number;
		inFlight: boolean;
		isIdle: boolean;
		hasPendingMessages: boolean;
	},
	defaultRetryMs = 2_000,
): ContextWatchAutoCompactDiagnostics {
	const decision = shouldTriggerAutoCompact(assessment, config, state);
	const retryDelayMs = resolveAutoCompactRetryDelayMs(
		decision,
		{ nowMs: state.nowMs, lastAutoCompactAt: state.lastAutoCompactAt },
		config,
		defaultRetryMs,
	);
	return {
		decision,
		retryRecommended: retryDelayMs !== undefined,
		retryDelayMs,
	};
}

export function shouldTriggerAutoCompact(
	assessment: AutoCompactAssessmentLike,
	config: AutoCompactConfigLike,
	state: {
		nowMs: number;
		lastAutoCompactAt: number;
		inFlight: boolean;
		isIdle: boolean;
		hasPendingMessages: boolean;
	},
): ContextWatchAutoCompactDecision {
	if (assessment.level !== "compact") return { trigger: false, reason: "level-not-compact" };
	if (!config.autoCompact) return { trigger: false, reason: "feature-disabled" };
	if (state.inFlight) return { trigger: false, reason: "in-flight" };
	if ((state.nowMs - state.lastAutoCompactAt) < config.autoCompactCooldownMs) {
		return { trigger: false, reason: "cooldown" };
	}
	if (config.autoCompactRequireIdle && !state.isIdle) {
		return { trigger: false, reason: "not-idle" };
	}
	if (config.autoCompactRequireIdle && state.hasPendingMessages) {
		return { trigger: false, reason: "pending-messages" };
	}
	return { trigger: true, reason: "trigger" };
}
