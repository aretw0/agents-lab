import { shouldAnnounceContextWatch } from "./context-watchdog-policy";
import type { ContextThresholds } from "./context-watchdog-config";
import type { ContextWatchAutoCompactDecision } from "./context-watchdog-auto-compact";
import type { ContextWatchHandoffReason } from "./context-watchdog-handoff-events";

export type ContextWatchdogLevel = "ok" | "warn" | "checkpoint" | "compact";

export type ContextWatchAssessment = {
	percent: number;
	level: ContextWatchdogLevel;
	thresholds: ContextWatchThresholds;
	recommendation: string;
	action: string;
	severity: "info" | "warning";
};

export type ContextWatchOperatorSignalReason =
	| "reload-required"
	| "handoff-refresh-required"
	| "signal-noise-excessive"
	| "compact-checkpoint-required"
	| "timeout-pressure";

export type ContextWatchOperatorSignal = {
	reloadRequired: boolean;
	humanActionRequired: boolean;
	reasons: ContextWatchOperatorSignalReason[];
	noiseExcessive: boolean;
};

export type ContextWatchDeterministicStopReason = "none" | "reload-required" | "compact-checkpoint-required" | "compact-final-warning" | "timeout-pressure";

export type ContextWatchDeterministicStopSignal = {
	required: boolean;
	reason: ContextWatchDeterministicStopReason;
	action: "none" | "reload-and-resume" | "persist-checkpoint-and-compact" | "stop-and-let-auto-compact";
};

export type ContextWatchOperatorActionKind = "none" | "reload" | "checkpoint-compact" | "compact-final-warning" | "handoff-refresh" | "timeout-pressure";
export type ContextWatchOperatorActionPlan = {
	blocking: boolean;
	kind: ContextWatchOperatorActionKind;
	summary: string;
	commandHint?: string;
};

export type ContextWatchOperatingCadence = "standard-slices" | "bounded-slices" | "micro-slice-only";

export type ContextWatchOperatingCadenceSignal = {
	operatingCadence: ContextWatchOperatingCadence;
	postResumeRecalibrated: boolean;
	reason:
		| "healthy"
		| "level-warn"
		| "level-checkpoint"
		| "level-compact"
		| "recalibrated-from-warn"
		| "recalibrated-from-checkpoint"
		| "recalibrated-from-compact";
};

export type ContextWatchAutoCompactTriggerOrigin = "none" | "checkpoint-window" | "hard-compact";

export type AutoCompactTimeoutPressureGuardReason =
	| "not-triggered"
	| "level-not-precompact"
	| "no-timeout-pressure"
	| "guarded-timeout-pressure";

export type AutoCompactTimeoutPressureGuardDecision = {
	blocked: boolean;
	reason: AutoCompactTimeoutPressureGuardReason;
	reasonCode?: "guarded-precompact-timeout-pressure";
	recommendation?: string;
};

export function resolveAutoCompactTimeoutPressureGuard(input: {
	assessmentLevel: ContextWatchdogLevel;
	autoCompactTrigger: boolean;
	timeoutPressureActive: boolean;
}): AutoCompactTimeoutPressureGuardDecision {
	if (!input.autoCompactTrigger) {
		return { blocked: false, reason: "not-triggered" };
	}
	if (input.assessmentLevel !== "checkpoint" && input.assessmentLevel !== "compact") {
		return { blocked: false, reason: "level-not-precompact" };
	}
	if (!input.timeoutPressureActive) {
		return { blocked: false, reason: "no-timeout-pressure" };
	}
	return {
		blocked: true,
		reason: "guarded-timeout-pressure",
		reasonCode: "guarded-precompact-timeout-pressure",
		recommendation: "timeout-pressure guard active: block direct compact trigger, keep idle, and retry through guarded path.",
	};
}

export function resolveContextWatchAutoCompactTriggerOrigin(input: {
	assessmentLevel: ContextWatchdogLevel;
	autoCompactTrigger: boolean;
}): ContextWatchAutoCompactTriggerOrigin {
	if (!input.autoCompactTrigger) return "none";
	return input.assessmentLevel === "checkpoint" ? "checkpoint-window" : "hard-compact";
}

export function formatContextWatchSteeringStatus(
	assessment: Pick<ContextWatchAssessment, "level" | "action" | "recommendation">,
): string {
	return `[ctx-steer] ${assessment.level} · action=${assessment.action} · ${assessment.recommendation}`;
}

export type ContextWatchSteeringDelivery = "notify" | "fallback-status";

export type ContextWatchSteeringDispatch = {
	shouldSignal: boolean;
	shouldPersist: boolean;
	shouldNotify: boolean;
	delivery: ContextWatchSteeringDelivery;
};

function steeringLevelRank(level: ContextWatchdogLevel): number {
	if (level === "ok") return 0;
	if (level === "warn") return 1;
	if (level === "checkpoint") return 2;
	return 3;
}

function levelMeetsSteeringThreshold(
	level: ContextWatchdogLevel,
	threshold: "warn" | "checkpoint" | "compact",
): boolean {
	return steeringLevelRank(level) >= steeringLevelRank(threshold);
}

export type FinalTurnAnnouncementDispatchReason =
	| "not-final-turn-window"
	| "first-window-signal"
	| "state-changed"
	| "cooldown-elapsed"
	| "cooldown-active";

export type FinalTurnAnnouncementDispatch = {
	force: boolean;
	suppressed: boolean;
	reason: FinalTurnAnnouncementDispatchReason;
};

export function resolveFinalTurnAnnouncementDispatch(input: {
	reason: ContextWatchHandoffReason;
	finalTurnCloseWindow: boolean;
	nowMs: number;
	cooldownMs: number;
	assessmentLevel: ContextWatchdogLevel;
	assessmentAction: string;
	lastSteeringSignal?: {
		atIso: string;
		reason: ContextWatchHandoffReason;
		level: ContextWatchdogLevel;
		action: string;
	} | null;
}): FinalTurnAnnouncementDispatch {
	if (input.reason !== "message_end" || !input.finalTurnCloseWindow) {
		return { force: false, suppressed: false, reason: "not-final-turn-window" };
	}

	const previous = input.lastSteeringSignal;
	if (!previous) {
		return { force: true, suppressed: false, reason: "first-window-signal" };
	}
	if (
		previous.reason !== "message_end"
		|| previous.level !== input.assessmentLevel
		|| previous.action !== input.assessmentAction
	) {
		return { force: true, suppressed: false, reason: "state-changed" };
	}

	const nowMs = Math.max(0, Math.floor(Number(input.nowMs ?? 0)));
	const cooldownMs = Math.max(0, Math.floor(Number(input.cooldownMs ?? 0)));
	if (cooldownMs <= 0) {
		return { force: false, suppressed: true, reason: "cooldown-active" };
	}

	const previousAtMs = Date.parse(previous.atIso);
	if (!Number.isFinite(previousAtMs)) {
		return { force: true, suppressed: false, reason: "state-changed" };
	}

	if ((nowMs - previousAtMs) >= cooldownMs) {
		return { force: true, suppressed: false, reason: "cooldown-elapsed" };
	}

	return { force: false, suppressed: true, reason: "cooldown-active" };
}

export function resolveContextWatchSteeringDispatch(input: {
	notifyEnabled?: boolean;
	userNotifyEnabled?: boolean;
	assessmentLevel: ContextWatchdogLevel;
	modelSteeringFromLevel?: "warn" | "checkpoint" | "compact";
	userNotifyFromLevel?: "warn" | "checkpoint" | "compact";
	lastAnnouncedLevel: ContextWatchdogLevel | null;
	elapsedMs: number;
	cooldownMs: number;
	forceWarnCadenceAnnouncement: boolean;
	forceFinalTurnAnnouncement?: boolean;
}): ContextWatchSteeringDispatch {
	const announce = shouldAnnounceContextWatch(
		input.lastAnnouncedLevel,
		input.assessmentLevel,
		input.elapsedMs,
		input.cooldownMs,
	);
	const modelSteeringFromLevel = input.modelSteeringFromLevel ?? "compact";
	const userNotifyFromLevel = input.userNotifyFromLevel ?? "compact";
	const userNotifyEnabled = input.userNotifyEnabled ?? input.notifyEnabled ?? true;
	const forceFinalTurnAnnouncement = input.forceFinalTurnAnnouncement === true;
	const levelEligibleForSteering = levelMeetsSteeringThreshold(
		input.assessmentLevel,
		modelSteeringFromLevel,
	);
	const shouldSignal =
		(announce || input.forceWarnCadenceAnnouncement || forceFinalTurnAnnouncement)
		&& (levelEligibleForSteering || forceFinalTurnAnnouncement);
	if (!shouldSignal) {
		return {
			shouldSignal: false,
			shouldPersist: false,
			shouldNotify: false,
			delivery: "fallback-status",
		};
	}

	const shouldNotify = userNotifyEnabled
		&& (levelMeetsSteeringThreshold(input.assessmentLevel, userNotifyFromLevel) || forceFinalTurnAnnouncement);
	return {
		shouldSignal: true,
		shouldPersist: true,
		shouldNotify,
		delivery: shouldNotify ? "notify" : "fallback-status",
	};
}

export function applyWarnCadenceEscalation(
	assessment: ContextWatchAssessment,
	warnStreak: number,
): ContextWatchAssessment {
	if (assessment.level !== "warn" || warnStreak < 2) return assessment;
	return {
		...assessment,
		action: "continue-bounded",
		recommendation:
			"Warn cadence active: continue bounded work; checkpoint only at the checkpoint threshold and wrap up at compact.",
		severity: "info",
	};
}

export function resolveContextWatchSignalNoiseExcessive(
	announcementsInWindow: number,
	maxAnnouncementsPerWindow: number,
): boolean {
	const announcements = Math.max(0, Math.floor(Number(announcementsInWindow ?? 0)));
	const maxAllowed = Math.max(1, Math.floor(Number(maxAnnouncementsPerWindow ?? 1)));
	return announcements > maxAllowed;
}

export function resolveContextWatchOperatorSignal(input: {
	reloadRequired?: boolean;
	handoffManualRefreshRequired?: boolean;
	signalNoiseExcessive?: boolean;
	compactCheckpointPersistRequired?: boolean;
	timeoutPressureActive?: boolean;
}): ContextWatchOperatorSignal {
	const reloadRequired = input.reloadRequired === true;
	const handoffManualRefreshRequired = input.handoffManualRefreshRequired === true;
	const signalNoiseExcessive = input.signalNoiseExcessive === true;
	const compactCheckpointPersistRequired = input.compactCheckpointPersistRequired === true;
	const timeoutPressureActive = input.timeoutPressureActive === true;
	const reasons: ContextWatchOperatorSignalReason[] = [];
	if (reloadRequired) reasons.push("reload-required");
	if (handoffManualRefreshRequired) reasons.push("handoff-refresh-required");
	if (signalNoiseExcessive) reasons.push("signal-noise-excessive");
	if (compactCheckpointPersistRequired) reasons.push("compact-checkpoint-required");
	if (timeoutPressureActive) reasons.push("timeout-pressure");
	return {
		reloadRequired,
		humanActionRequired: reasons.length > 0,
		reasons,
		noiseExcessive: signalNoiseExcessive,
	};
}

export function resolveContextWatchDeterministicStopSignal(input: {
	assessmentLevel: ContextWatchdogLevel;
	operatorSignal: Pick<ContextWatchOperatorSignal, "reasons">;
	autoCompactDecision?: ContextWatchAutoCompactDecision["reason"];
}): ContextWatchDeterministicStopSignal {
	const reasons = Array.isArray(input.operatorSignal.reasons)
		? input.operatorSignal.reasons
		: [];
	if (reasons.includes("reload-required")) {
		return { required: true, reason: "reload-required", action: "reload-and-resume" };
	}
	if (input.assessmentLevel === "compact" && reasons.includes("compact-checkpoint-required")) {
		return {
			required: true,
			reason: "compact-checkpoint-required",
			action: "persist-checkpoint-and-compact",
		};
	}
	if ((input.assessmentLevel === "checkpoint" || input.assessmentLevel === "compact") && reasons.includes("timeout-pressure")) {
		return {
			required: true,
			reason: "timeout-pressure",
			action: "stop-and-let-auto-compact",
		};
	}
	if (input.assessmentLevel === "compact" && input.autoCompactDecision !== "trigger") {
		return {
			required: true,
			reason: "compact-final-warning",
			action: "stop-and-let-auto-compact",
		};
	}
	return { required: false, reason: "none", action: "none" };
}

export function describeContextWatchDeterministicStopHint(
	signal: ContextWatchDeterministicStopSignal,
): string | undefined {
	if (!signal.required) return undefined;
	if (signal.reason === "reload-required") {
		return "run /reload, then continue from handoff checkpoint.";
	}
	if (signal.reason === "compact-checkpoint-required") {
		return "persist checkpoint evidence and compact before continuing.";
	}
	if (signal.reason === "compact-final-warning") {
		return "stop the current slice; do not start another run until checkpoint evidence and auto-compact complete.";
	}
	if (signal.reason === "timeout-pressure") {
		return "provider timeout pressure detected near compact boundary; stop new work, keep session idle, and retry after provider stabilizes.";
	}
	return undefined;
}

export function resolveContextWatchOperatorActionPlan(input: {
	deterministicStop: ContextWatchDeterministicStopSignal;
	operatorSignal: Pick<ContextWatchOperatorSignal, "reasons">;
}): ContextWatchOperatorActionPlan {
	if (input.deterministicStop.reason === "reload-required") {
		return {
			blocking: true,
			kind: "reload",
			summary: "reload required before continuing long-run",
			commandHint: "/reload",
		};
	}
	if (input.deterministicStop.reason === "compact-checkpoint-required") {
		return {
			blocking: true,
			kind: "checkpoint-compact",
			summary: "persist checkpoint and compact before next slice",
		};
	}
	if (input.deterministicStop.reason === "compact-final-warning") {
		return {
			blocking: true,
			kind: "compact-final-warning",
			summary: "stop current slice and let auto-compact complete before next run",
		};
	}
	if (input.deterministicStop.reason === "timeout-pressure") {
		return {
			blocking: true,
			kind: "timeout-pressure",
			summary: "provider timeout pressure near compact boundary; pause new slices and retry when stable",
		};
	}
	if ((input.operatorSignal.reasons ?? []).includes("handoff-refresh-required")) {
		return {
			blocking: false,
			kind: "handoff-refresh",
			summary: "refresh handoff checkpoint before manual resume",
		};
	}
	return {
		blocking: false,
		kind: "none",
		summary: "no operator action required",
	};
}

export function shouldEmitDeterministicStopSignal(
	required: boolean,
	nowMs: number,
	lastSignalAtMs: number,
	cooldownMs: number,
): boolean {
	if (!required) return false;
	const now = Math.max(0, Math.floor(Number(nowMs ?? 0)));
	const last = Math.max(0, Math.floor(Number(lastSignalAtMs ?? 0)));
	const cooldown = Math.max(1_000, Math.floor(Number(cooldownMs ?? 60_000)));
	return (now - last) >= cooldown;
}

export function resolveContextWatchOperatingCadence(input: {
	assessmentLevel: ContextWatchdogLevel;
	handoffLastEventLevel?: ContextWatchdogLevel | null;
}): ContextWatchOperatingCadenceSignal {
	const level = input.assessmentLevel;
	if (level === "warn") {
		return {
			operatingCadence: "bounded-slices",
			postResumeRecalibrated: false,
			reason: "level-warn",
		};
	}
	if (level === "checkpoint") {
		return {
			operatingCadence: "micro-slice-only",
			postResumeRecalibrated: false,
			reason: "level-checkpoint",
		};
	}
	if (level === "compact") {
		return {
			operatingCadence: "micro-slice-only",
			postResumeRecalibrated: false,
			reason: "level-compact",
		};
	}

	const previous = input.handoffLastEventLevel;
	if (previous === "warn") {
		return {
			operatingCadence: "standard-slices",
			postResumeRecalibrated: true,
			reason: "recalibrated-from-warn",
		};
	}
	if (previous === "checkpoint") {
		return {
			operatingCadence: "standard-slices",
			postResumeRecalibrated: true,
			reason: "recalibrated-from-checkpoint",
		};
	}
	if (previous === "compact") {
		return {
			operatingCadence: "standard-slices",
			postResumeRecalibrated: true,
			reason: "recalibrated-from-compact",
		};
	}
	return {
		operatingCadence: "standard-slices",
		postResumeRecalibrated: false,
		reason: "healthy",
	};
}
