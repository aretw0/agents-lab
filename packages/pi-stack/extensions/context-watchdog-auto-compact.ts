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
		| "checkpoint-evidence-missing"
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

export type ContextWatchAutoCompactIdleState = {
	observedIdle: boolean;
	effectiveIdle: boolean;
	hasPendingMessages: boolean;
	eligibleByMessageEnd: boolean;
};

export type ContextWatchAutoCompactDiagnostics = {
	decision: ContextWatchAutoCompactDecision;
	retryRecommended: boolean;
	retryDelayMs?: number;
	idle: ContextWatchAutoCompactIdleState;
};

export type AutoCompactCheckpointGateDecision = {
	proceed: boolean;
	reason: "checkpoint-ready" | "checkpoint-written" | "checkpoint-evidence-missing";
};

export function resolveAutoCompactCheckpointGate(input: {
	handoffPath?: string;
	checkpointEvidenceReady: boolean;
}): AutoCompactCheckpointGateDecision {
	if (input.handoffPath) return { proceed: true, reason: "checkpoint-written" };
	if (input.checkpointEvidenceReady) return { proceed: true, reason: "checkpoint-ready" };
	return { proceed: false, reason: "checkpoint-evidence-missing" };
}

export function resolveAutoCompactEffectiveIdle(input: {
	autoCompactRequireIdle: boolean;
	reason?: string;
	isIdle: boolean;
	hasPendingMessages: boolean;
}): ContextWatchAutoCompactIdleState {
	const eligibleByMessageEnd = input.autoCompactRequireIdle
		&& input.reason === "message_end"
		&& !input.hasPendingMessages;
	return {
		observedIdle: input.isIdle,
		effectiveIdle: input.isIdle || eligibleByMessageEnd,
		hasPendingMessages: input.hasPendingMessages,
		eligibleByMessageEnd,
	};
}

export function buildAutoCompactDiagnostics(
	assessment: AutoCompactAssessmentLike,
	config: AutoCompactConfigLike,
	state: {
		nowMs: number;
		lastAutoCompactAt: number;
		inFlight: boolean;
		isIdle: boolean;
		hasPendingMessages: boolean;
		checkpointEvidenceReady?: boolean;
		reason?: string;
	},
	defaultRetryMs = 2_000,
): ContextWatchAutoCompactDiagnostics {
	const idle = resolveAutoCompactEffectiveIdle({
		autoCompactRequireIdle: config.autoCompactRequireIdle,
		reason: state.reason,
		isIdle: state.isIdle,
		hasPendingMessages: state.hasPendingMessages,
	});
	const decision = shouldTriggerAutoCompact(assessment, config, {
		...state,
		isIdle: idle.effectiveIdle,
	});
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
		idle,
	};
}

function isAutoCompactCandidateLevel(level: ContextWatchdogLevel): boolean {
	return level === "compact" || level === "checkpoint";
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
		checkpointEvidenceReady?: boolean;
	},
): ContextWatchAutoCompactDecision {
	if (!isAutoCompactCandidateLevel(assessment.level)) return { trigger: false, reason: "level-not-compact" };
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
	if (state.checkpointEvidenceReady === false) {
		return { trigger: false, reason: "checkpoint-evidence-missing" };
	}
	return { trigger: true, reason: "trigger" };
}
