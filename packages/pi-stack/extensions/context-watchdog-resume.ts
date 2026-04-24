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
	| "pending-messages"
	| "recent-steer"
	| "lane-queue-pending"
	| "send";

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
	hasPendingMessages: boolean;
	hasRecentSteerInput: boolean;
	queuedLaneIntents: number;
}): { shouldDispatch: boolean; reason: AutoResumeDispatchReason } {
	if (!input.autoResumeReady) {
		return { shouldDispatch: false, reason: "auto-resume-off-or-cooldown" };
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
