import type { HandoffFreshnessLabel } from "./context-watchdog-handoff";

export type ContextWatchdogLevel = "ok" | "warn" | "checkpoint" | "compact";

export type ResumeAssessmentLike = {
	level: ContextWatchdogLevel;
};

export type ResumeConfigLike = {
	autoResumeAfterCompact: boolean;
	autoResumeCooldownMs: number;
};

export type HandoffPrepReason = "level-not-compact" | "auto-resume-off" | "fresh" | "stale" | "unknown";

export type AutoResumeDispatchReason =
	| "auto-resume-off-or-cooldown"
	| "reload-required"
	| "checkpoint-evidence-missing"
	| "board-handoff-divergence"
	| "pending-messages"
	| "recent-steer"
	| "lane-queue-pending"
	| "send";

export type PreCompactReloadSignalReason =
	| "reload-not-required"
	| "level-not-precompact"
	| "reload-required-checkpoint"
	| "reload-required-compact";

export type PreCompactReloadSignal = {
	active: boolean;
	reason: PreCompactReloadSignalReason;
	level: ContextWatchdogLevel;
	hint?: string;
	summary: string;
};

export function describeAutoResumeDispatchReason(reason: AutoResumeDispatchReason): string {
	switch (reason) {
		case "send":
			return "dispatched";
		case "reload-required":
			return "deferred: reload-required";
		case "checkpoint-evidence-missing":
			return "suppressed: checkpoint-evidence-missing";
		case "board-handoff-divergence":
			return "suppressed: board-handoff-divergence";
		case "pending-messages":
			return "suppressed: pending-messages";
		case "recent-steer":
			return "suppressed: recent-steer";
		case "lane-queue-pending":
			return "suppressed: lane-queue-pending";
		case "auto-resume-off-or-cooldown":
		default:
			return "suppressed: cooldown-or-disabled";
	}
}

export function describeAutoResumeDispatchHint(reason: AutoResumeDispatchReason): string | undefined {
	switch (reason) {
		case "reload-required":
			return "auto-resume deferred until /reload, then continue from handoff checkpoint";
		case "checkpoint-evidence-missing":
			return "persist or refresh handoff checkpoint evidence before resume";
		case "board-handoff-divergence":
			return "reconcile stale/divergent handoff focus with board state before resume";
		case "pending-messages":
			return "wait until pending messages drain before auto-resume";
		case "recent-steer":
			return "recent user steer detected: wait for next idle window";
		case "lane-queue-pending":
			return "drain lane queue before auto-resume dispatch";
		case "auto-resume-off-or-cooldown":
			return "auto-resume disabled or still in cooldown window";
		case "send":
		default:
			return undefined;
	}
}

export function shouldNotifyAutoResumeSuppression(reason: AutoResumeDispatchReason): boolean {
	return reason === "reload-required" || reason === "checkpoint-evidence-missing" || reason === "board-handoff-divergence";
}

export function composeAutoResumeSuppressionHint(input: {
	reason: AutoResumeDispatchReason;
	timeoutPressureActive?: boolean;
	timeoutPressureCount?: number;
	timeoutPressureThreshold?: number;
}): string | undefined {
	const baseHint = describeAutoResumeDispatchHint(input.reason);
	if (input.timeoutPressureActive !== true) return baseHint;
	const count = Math.max(0, Math.floor(Number(input.timeoutPressureCount ?? 0)));
	const threshold = Math.max(1, Math.floor(Number(input.timeoutPressureThreshold ?? 2)));
	const timeoutHint = `provider timeout pressure observed (${count}/${threshold})`;
	return baseHint ? `${baseHint}; ${timeoutHint}` : timeoutHint;
}

export type AutoResumeDecisionSnapshot = {
	atIso: string;
	reason: AutoResumeDispatchReason;
	hint?: string;
	dispatched: boolean;
	reloadRequired: boolean;
	checkpointEvidenceReady: boolean;
	handoffBoardReconciled: boolean;
	handoffBoardReconciliationSummary: string;
	hasPendingMessages: boolean;
	hasRecentSteerInput: boolean;
	queuedLaneIntents: number;
	timeoutPressureActive: boolean;
	timeoutPressureCount: number;
	timeoutPressureThreshold: number;
	timeoutPressureHint?: string;
};

export function buildAutoResumeDecisionSnapshot(input: {
	nowMs: number;
	decision: { shouldDispatch: boolean; reason: AutoResumeDispatchReason };
	reloadRequired: boolean;
	checkpointEvidenceReady: boolean;
	handoffBoardReconciled: boolean;
	handoffBoardReconciliationSummary: string;
	hasPendingMessages: boolean;
	hasRecentSteerInput: boolean;
	queuedLaneIntents: number;
	timeoutPressureActive?: boolean;
	timeoutPressureCount?: number;
	timeoutPressureThreshold?: number;
}): AutoResumeDecisionSnapshot {
	const timeoutPressureActive = input.timeoutPressureActive === true;
	const timeoutPressureCount = Math.max(0, Math.floor(Number(input.timeoutPressureCount ?? 0)));
	const timeoutPressureThreshold = Math.max(1, Math.floor(Number(input.timeoutPressureThreshold ?? 2)));
	return {
		atIso: new Date(input.nowMs).toISOString(),
		reason: input.decision.reason,
		hint: composeAutoResumeSuppressionHint({
			reason: input.decision.reason,
			timeoutPressureActive,
			timeoutPressureCount,
			timeoutPressureThreshold,
		}),
		dispatched: input.decision.shouldDispatch,
		reloadRequired: input.reloadRequired,
		checkpointEvidenceReady: input.checkpointEvidenceReady,
		handoffBoardReconciled: input.handoffBoardReconciled,
		handoffBoardReconciliationSummary: input.handoffBoardReconciliationSummary,
		hasPendingMessages: input.hasPendingMessages,
		hasRecentSteerInput: input.hasRecentSteerInput,
		queuedLaneIntents: input.queuedLaneIntents,
		timeoutPressureActive,
		timeoutPressureCount,
		timeoutPressureThreshold,
		timeoutPressureHint: timeoutPressureActive
			? `provider timeout pressure observed (${timeoutPressureCount}/${timeoutPressureThreshold})`
			: undefined,
	};
}

export type PostReloadPendingNotifyMemory = {
	reason?: AutoResumeDispatchReason;
	intentCreatedAtIso?: string;
	lastNotifyAtMs?: number;
};

export function resolvePostReloadPendingNotifyDecision(input: {
	nowMs: number;
	intentCreatedAtIso: string;
	reason: AutoResumeDispatchReason;
	previous?: PostReloadPendingNotifyMemory;
	cooldownMs: number;
	minCooldownMs?: number;
}): {
	shouldEmit: boolean;
	notifyCooldownMs: number;
	reasonChanged: boolean;
	intentChanged: boolean;
	next: PostReloadPendingNotifyMemory;
} {
	const previousReason = input.previous?.reason;
	const previousIntentCreatedAtIso = input.previous?.intentCreatedAtIso;
	const previousNotifyAt = Math.max(0, Math.floor(Number(input.previous?.lastNotifyAtMs ?? 0)));
	const intentChanged = input.intentCreatedAtIso !== previousIntentCreatedAtIso;
	const reasonChanged = input.reason !== previousReason;
	const notifyCooldownMs = Math.max(
		Math.max(1_000, Math.floor(Number(input.cooldownMs ?? 60_000))),
		Math.max(1_000, Math.floor(Number(input.minCooldownMs ?? 0))),
	);
	const cooldownElapsed = previousNotifyAt <= 0 || (Math.floor(Number(input.nowMs ?? 0)) - previousNotifyAt) >= notifyCooldownMs;
	const shouldEmit = intentChanged || reasonChanged || cooldownElapsed;
	const next: PostReloadPendingNotifyMemory = shouldEmit
		? {
			reason: input.reason,
			intentCreatedAtIso: input.intentCreatedAtIso,
			lastNotifyAtMs: Math.floor(Number(input.nowMs ?? 0)),
		}
		: {
			reason: previousReason ?? input.reason,
			intentCreatedAtIso: previousIntentCreatedAtIso ?? input.intentCreatedAtIso,
			lastNotifyAtMs: previousNotifyAt,
		};
	return {
		shouldEmit,
		notifyCooldownMs,
		reasonChanged,
		intentChanged,
		next,
	};
}

export function resolvePreCompactReloadSignal(input: {
	assessmentLevel: ContextWatchdogLevel;
	reloadRequired?: boolean;
}): PreCompactReloadSignal {
	const level = input.assessmentLevel;
	const reloadRequired = input.reloadRequired === true;
	if (!reloadRequired) {
		return {
			active: false,
			reason: "reload-not-required",
			level,
			summary: "pre-compact-reload: clear",
		};
	}
	if (level !== "checkpoint" && level !== "compact") {
		return {
			active: false,
			reason: "level-not-precompact",
			level,
			hint: describeAutoResumeDispatchHint("reload-required"),
			summary: `pre-compact-reload: deferred level=${level}`,
		};
	}
	const reason: PreCompactReloadSignalReason = level === "checkpoint"
		? "reload-required-checkpoint"
		: "reload-required-compact";
	const hint = describeAutoResumeDispatchHint("reload-required");
	return {
		active: true,
		reason,
		level,
		hint,
		summary: `pre-compact-reload: active level=${level}`,
	};
}

export function shouldEmitAutoResumeAfterCompact(
	config: ResumeConfigLike,
	nowMs: number,
	lastAutoResumeAt: number,
): boolean {
	if (!config.autoResumeAfterCompact) return false;
	return (nowMs - lastAutoResumeAt) >= config.autoResumeCooldownMs;
}

export function resolveAutoResumeDispatchDecision(input: {
	autoResumeReady: boolean;
	reloadRequired?: boolean;
	checkpointEvidenceReady?: boolean;
	handoffBoardReconciled?: boolean;
	hasPendingMessages: boolean;
	hasRecentSteerInput: boolean;
	queuedLaneIntents: number;
}): { shouldDispatch: boolean; reason: AutoResumeDispatchReason } {
	if (!input.autoResumeReady) {
		return { shouldDispatch: false, reason: "auto-resume-off-or-cooldown" };
	}
	if (input.reloadRequired === true) {
		return { shouldDispatch: false, reason: "reload-required" };
	}
	if (input.checkpointEvidenceReady === false) {
		return { shouldDispatch: false, reason: "checkpoint-evidence-missing" };
	}
	if (input.handoffBoardReconciled === false) {
		return { shouldDispatch: false, reason: "board-handoff-divergence" };
	}
	if (input.hasPendingMessages) {
		return { shouldDispatch: false, reason: "pending-messages" };
	}
	if (input.hasRecentSteerInput) {
		return { shouldDispatch: false, reason: "recent-steer" };
	}
	const queuedLaneIntents = Math.max(0, Math.floor(Number(input.queuedLaneIntents ?? 0)));
	if (queuedLaneIntents > 0) {
		return { shouldDispatch: false, reason: "lane-queue-pending" };
	}
	return { shouldDispatch: true, reason: "send" };
}

export function resolveHandoffPrepDecision(
	assessment: ResumeAssessmentLike,
	config: ResumeConfigLike,
	freshnessLabel: HandoffFreshnessLabel,
): { refreshOnTrigger: boolean; reason: HandoffPrepReason } {
	if (assessment.level !== "compact") return { refreshOnTrigger: false, reason: "level-not-compact" };
	if (!config.autoResumeAfterCompact) return { refreshOnTrigger: false, reason: "auto-resume-off" };
	if (freshnessLabel === "fresh") return { refreshOnTrigger: false, reason: "fresh" };
	if (freshnessLabel === "stale") return { refreshOnTrigger: true, reason: "stale" };
	return { refreshOnTrigger: true, reason: "unknown" };
}

export function shouldRefreshHandoffBeforeAutoCompact(
	assessment: ResumeAssessmentLike,
	config: ResumeConfigLike,
	freshnessLabel: HandoffFreshnessLabel = "unknown",
): boolean {
	return resolveHandoffPrepDecision(assessment, config, freshnessLabel).refreshOnTrigger;
}
