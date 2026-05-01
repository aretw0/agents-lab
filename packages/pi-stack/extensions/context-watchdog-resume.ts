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

export function describeAutoResumeDispatchReason(reason: AutoResumeDispatchReason): string {
	switch (reason) {
		case "send":
			return "dispatched";
		case "reload-required":
			return "suppressed: reload-required";
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
			return "run /reload and continue from handoff checkpoint";
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
