import type { ContextWatchAutoCompactDecision } from "./context-watchdog-auto-compact";
import { isAutoCompactDeferralReason } from "./context-watchdog-auto-compact";
import type { ContextWatchdogLevel } from "./context-watchdog-operator-signals";

export type PreCompactCalmCloseSignal = {
	calmCloseReady: boolean;
	checkpointEvidenceReady: boolean;
	deferCount: number;
	deferThreshold: number;
	antiParalysisTriggered: boolean;
	recommendation: string;
};

export type ProgressPreservationStatus =
	| "ready"
	| "fresh-handoff"
	| "will-auto-persist"
	| "needs-checkpoint"
	| "unknown";

export type ProgressPreservationSignal = {
	status: ProgressPreservationStatus;
	progressSaved: boolean;
	compactCheckpointReady: boolean;
	reason: string;
	recommendation: string;
};

export type ContextEconomyOpportunityKind =
	| "none"
	| "next-actions-truncated"
	| "large-handoff"
	| "many-next-actions"
	| "resume-prompt-truncated";

export type ContextEconomySignal = {
	passive: true;
	kind: ContextEconomyOpportunityKind;
	opportunity: boolean;
	severity: "none" | "info";
	recommendation: string;
	metrics: {
		handoffBytes?: number;
		nextActionCount?: number;
		autoResumeDroppedNextActions?: number;
		autoResumeGlobalTruncated?: boolean;
	};
};

export type AntiParalysisDispatchDecision = {
	shouldNotify: boolean;
	reason:
		| "not-triggered"
		| "missing-window"
		| "grace-window"
		| "cooldown"
		| "max-notifies-reached"
		| "emit";
	graceRemainingMs?: number;
	cooldownRemainingMs?: number;
};

export function resolveCheckpointEvidenceReadyForCalmClose(input: {
	handoffLastEventLevel?: ContextWatchdogLevel | null;
	handoffLastEventAgeMs?: number;
	maxCheckpointAgeMs: number;
}): boolean {
	const level = input.handoffLastEventLevel;
	if (level !== "checkpoint" && level !== "compact") return false;
	const ageMs = input.handoffLastEventAgeMs;
	if (ageMs === undefined || !Number.isFinite(ageMs)) return true;
	const maxAgeMs = Math.max(60_000, Math.floor(Number(input.maxCheckpointAgeMs ?? 0)));
	return ageMs <= maxAgeMs;
}

export function resolveProgressPreservationSignal(input: {
	assessmentLevel: ContextWatchdogLevel;
	handoffFreshnessLabel: "fresh" | "stale" | "unknown";
	checkpointEvidenceReady: boolean;
	compactCheckpointPersistRecommended: boolean;
	autoResumeEnabled: boolean;
}): ProgressPreservationSignal {
	if (input.checkpointEvidenceReady) {
		return {
			status: "ready",
			progressSaved: true,
			compactCheckpointReady: true,
			reason: "fresh-context-watch-checkpoint-evidence",
			recommendation: "progress-preservation: checkpoint evidence is fresh; compact/resume can proceed without another manual checkpoint.",
		};
	}

	if (input.assessmentLevel === "compact" && input.compactCheckpointPersistRecommended && input.autoResumeEnabled) {
		return {
			status: "will-auto-persist",
			progressSaved: input.handoffFreshnessLabel === "fresh",
			compactCheckpointReady: true,
			reason: "compact-lane-auto-persist-before-compact",
			recommendation: "progress-preservation: compact lane will persist a compact checkpoint before auto-compact; keep output short and let idle compact proceed.",
		};
	}

	if (input.handoffFreshnessLabel === "fresh") {
		return {
			status: "fresh-handoff",
			progressSaved: true,
			compactCheckpointReady: false,
			reason: "fresh-handoff-without-context-watch-checkpoint-event",
			recommendation: "progress-preservation: handoff is fresh, but no context-watch checkpoint event is recorded yet; refresh at checkpoint/near compact before large output.",
		};
	}

	if (input.handoffFreshnessLabel === "stale") {
		return {
			status: "needs-checkpoint",
			progressSaved: false,
			compactCheckpointReady: false,
			reason: "handoff-stale",
			recommendation: "progress-preservation: handoff is stale; write a short checkpoint before compact-risk work.",
		};
	}

	return {
		status: "unknown",
		progressSaved: false,
		compactCheckpointReady: false,
		reason: "handoff-missing-or-unreadable",
		recommendation: "progress-preservation: checkpoint evidence is unavailable; write a short handoff before compact-risk work.",
	};
}

export function summarizeProgressPreservationSignal(signal: ProgressPreservationSignal): string {
	return `progress-preservation: ${signal.status} saved=${signal.progressSaved ? "yes" : "no"} compactReady=${signal.compactCheckpointReady ? "yes" : "no"} reason=${signal.reason}`;
}

export function resolveContextEconomySignal(input: {
	handoffBytes?: number;
	nextActionCount?: number;
	autoResumeDroppedNextActions?: number;
	autoResumeGlobalTruncated?: boolean;
}): ContextEconomySignal {
	const handoffBytes = Number.isFinite(input.handoffBytes) ? Math.max(0, Math.floor(Number(input.handoffBytes))) : undefined;
	const nextActionCount = Number.isFinite(input.nextActionCount) ? Math.max(0, Math.floor(Number(input.nextActionCount))) : undefined;
	const autoResumeDroppedNextActions = Number.isFinite(input.autoResumeDroppedNextActions)
		? Math.max(0, Math.floor(Number(input.autoResumeDroppedNextActions)))
		: undefined;
	const metrics = {
		handoffBytes,
		nextActionCount,
		autoResumeDroppedNextActions,
		autoResumeGlobalTruncated: input.autoResumeGlobalTruncated === true,
	};
	if (input.autoResumeGlobalTruncated === true) {
		return {
			passive: true,
			kind: "resume-prompt-truncated",
			opportunity: true,
			severity: "info",
			recommendation: "context-economy: resume prompt was globally truncated; shape the next handoff/status into fewer canonical bullets.",
			metrics,
		};
	}
	if ((autoResumeDroppedNextActions ?? 0) > 0) {
		return {
			passive: true,
			kind: "next-actions-truncated",
			opportunity: true,
			severity: "info",
			recommendation: "context-economy: next-actions were truncated in auto-resume; consolidate repeated or low-priority actions in the next checkpoint.",
			metrics,
		};
	}
	if ((handoffBytes ?? 0) >= 8_000) {
		return {
			passive: true,
			kind: "large-handoff",
			opportunity: true,
			severity: "info",
			recommendation: "context-economy: handoff is large; prefer concise focus, validation, commits and blockers before the next compact lane.",
			metrics,
		};
	}
	if ((nextActionCount ?? 0) > 4) {
		return {
			passive: true,
			kind: "many-next-actions",
			opportunity: true,
			severity: "info",
			recommendation: "context-economy: many next-actions are present; keep only actionable priorities and move background ideas to backlog.",
			metrics,
		};
	}
	return {
		passive: true,
		kind: "none",
		opportunity: false,
		severity: "none",
		recommendation: "context-economy: no passive economy opportunity detected.",
		metrics,
	};
}

export function summarizeContextEconomySignal(signal: ContextEconomySignal): string {
	return `context-economy: ${signal.kind} opportunity=${signal.opportunity ? "yes" : "no"}`;
}

export function resolvePreCompactCalmCloseSignal(input: {
	assessmentLevel: ContextWatchdogLevel;
	decisionReason: ContextWatchAutoCompactDecision["reason"];
	checkpointEvidenceReady: boolean;
	deferCount: number;
	deferThreshold?: number;
}): PreCompactCalmCloseSignal {
	const deferCount = Math.max(0, Math.floor(Number(input.deferCount ?? 0)));
	const deferThreshold = Math.max(2, Math.floor(Number(input.deferThreshold ?? 3)));
	const inCompact = input.assessmentLevel === "compact";
	const calmCloseReady = inCompact
		&& input.checkpointEvidenceReady
		&& input.decisionReason !== "feature-disabled";
	const antiParalysisTriggered = calmCloseReady
		&& isAutoCompactDeferralReason(input.decisionReason)
		&& deferCount >= deferThreshold;

	let recommendation = "calm-close: not required (context outside compact lane).";
	if (inCompact && !input.checkpointEvidenceReady) {
		recommendation = "calm-close: capture checkpoint evidence first, then let idle auto-compact run.";
	} else if (antiParalysisTriggered) {
		recommendation = "anti-paralysis: compact has been deferred repeatedly; close the current slice now and let idle auto-compact proceed.";
	} else if (calmCloseReady && input.decisionReason === "trigger") {
		recommendation = "calm-close ready: compact trigger available now (idle + checkpoint evidence present).";
	} else if (calmCloseReady) {
		recommendation = "calm-close ready: finish the active micro-slice and keep the session idle to allow auto-compact.";
	}

	return {
		calmCloseReady,
		checkpointEvidenceReady: input.checkpointEvidenceReady,
		deferCount,
		deferThreshold,
		antiParalysisTriggered,
		recommendation,
	};
}

export function resolveAntiParalysisDispatch(input: {
	triggered: boolean;
	nowMs: number;
	deferWindowStartedAtMs: number;
	graceWindowMs: number;
	lastNotifyAtMs: number;
	notifyCooldownMs: number;
	notifiesInWindow: number;
	maxNotifiesPerWindow: number;
}): AntiParalysisDispatchDecision {
	if (!input.triggered) {
		return { shouldNotify: false, reason: "not-triggered" };
	}

	const startedAt = Math.floor(Number(input.deferWindowStartedAtMs ?? 0));
	if (!Number.isFinite(startedAt) || startedAt <= 0) {
		return { shouldNotify: false, reason: "missing-window" };
	}

	const nowMs = Math.floor(Number(input.nowMs ?? 0));
	const graceWindowMs = Math.max(0, Math.floor(Number(input.graceWindowMs ?? 0)));
	const elapsedInWindowMs = nowMs - startedAt;
	if (elapsedInWindowMs < graceWindowMs) {
		return {
			shouldNotify: false,
			reason: "grace-window",
			graceRemainingMs: Math.max(0, graceWindowMs - elapsedInWindowMs),
		};
	}

	const maxNotifiesPerWindow = Math.max(1, Math.floor(Number(input.maxNotifiesPerWindow ?? 1)));
	const notifiesInWindow = Math.max(0, Math.floor(Number(input.notifiesInWindow ?? 0)));
	if (notifiesInWindow >= maxNotifiesPerWindow) {
		return {
			shouldNotify: false,
			reason: "max-notifies-reached",
		};
	}

	const lastNotifyAtMs = Math.floor(Number(input.lastNotifyAtMs ?? 0));
	const notifyCooldownMs = Math.max(0, Math.floor(Number(input.notifyCooldownMs ?? 0)));
	if (lastNotifyAtMs > 0 && (nowMs - lastNotifyAtMs) < notifyCooldownMs) {
		return {
			shouldNotify: false,
			reason: "cooldown",
			cooldownRemainingMs: Math.max(0, notifyCooldownMs - (nowMs - lastNotifyAtMs)),
		};
	}

	return { shouldNotify: true, reason: "emit" };
}

export type PreCompactIdlePrepDispatchReason =
	| "not-precompact"
	| "trigger-ready"
	| "not-deferral"
	| "cooldown"
	| "emit"
	| "emit-timeout-pressure";

export type PreCompactIdlePrepDispatch = {
	shouldNotify: boolean;
	reason: PreCompactIdlePrepDispatchReason;
	recommendation?: string;
};

export function resolvePreCompactIdlePrepDispatch(input: {
	assessmentLevel: ContextWatchdogLevel;
	decisionReason: ContextWatchAutoCompactDecision["reason"];
	nowMs: number;
	lastNotifyAtMs: number;
	cooldownMs?: number;
	timeoutPressureActive?: boolean;
}): PreCompactIdlePrepDispatch {
	const level = input.assessmentLevel;
	const precompactLevel = level === "checkpoint" || level === "compact";
	if (!precompactLevel) return { shouldNotify: false, reason: "not-precompact" };
	if (input.decisionReason === "trigger") return { shouldNotify: false, reason: "trigger-ready" };

	const nowMs = Math.max(0, Math.floor(Number(input.nowMs ?? 0)));
	const timeoutPressureActive = input.timeoutPressureActive === true;
	if (!timeoutPressureActive && !isAutoCompactDeferralReason(input.decisionReason)) {
		return { shouldNotify: false, reason: "not-deferral" };
	}

	const lastNotifyAtMs = Math.max(0, Math.floor(Number(input.lastNotifyAtMs ?? 0)));
	const cooldownMs = Math.max(1_000, Math.floor(Number(input.cooldownMs ?? 60_000)));
	if (lastNotifyAtMs > 0 && (nowMs - lastNotifyAtMs) < cooldownMs) {
		return { shouldNotify: false, reason: "cooldown" };
	}

	const recommendation = timeoutPressureActive
		? "timeout-pressure: provider instability detected near compact boundary; stop starting new work, keep session idle, and let guarded compact/retry path recover."
		: level === "compact"
			? "pre-compact: close this micro-slice and keep the session idle so auto-compact can run."
			: "checkpoint-close: finish this slice and keep the session idle so graceful auto-compact can run before hard compact.";
	return {
		shouldNotify: true,
		reason: timeoutPressureActive ? "emit-timeout-pressure" : "emit",
		recommendation,
	};
}

export type AutoResumeHandoffFocusReconcileResult = {
	changed: boolean;
	reason: "unchanged" | "filtered-focus" | "preferred-fallback" | "cleared";
	previousFocus: string[];
	nextFocus: string[];
	droppedFocus: string[];
};

function normalizeTaskFocusList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((row): row is string => typeof row === "string")
		.map((row) => row.trim())
		.filter(Boolean);
}

function isActiveBoardStatus(status: string | undefined): boolean {
	return status === "in-progress" || status === "planned";
}

export function reconcileAutoResumeHandoffFocus(input: {
	handoff: Record<string, unknown>;
	taskStatusById: Record<string, string | undefined>;
	preferredTaskIds?: string[];
	maxTasks?: number;
}): AutoResumeHandoffFocusReconcileResult {
	const maxTasks = Math.max(1, Math.floor(Number(input.maxTasks ?? 3)));
	const previousFocus = normalizeTaskFocusList(input.handoff.current_tasks);
	const activeFocus = previousFocus.filter((taskId) => isActiveBoardStatus(input.taskStatusById[taskId]));
	const droppedFocus = previousFocus.filter((taskId) => !activeFocus.includes(taskId));
	if (activeFocus.length > 0 && droppedFocus.length === 0) {
		return {
			changed: false,
			reason: "unchanged",
			previousFocus,
			nextFocus: previousFocus.slice(0, maxTasks),
			droppedFocus,
		};
	}

	const preferred = normalizeTaskFocusList(input.preferredTaskIds)
		.filter((taskId) => isActiveBoardStatus(input.taskStatusById[taskId]));
	const nextFocus = (activeFocus.length > 0 ? activeFocus : preferred).slice(0, maxTasks);
	const reason: AutoResumeHandoffFocusReconcileResult["reason"] =
		nextFocus.length > 0
			? (activeFocus.length > 0 ? "filtered-focus" : "preferred-fallback")
			: "cleared";
	const changed = nextFocus.length !== previousFocus.length
		|| nextFocus.some((taskId, index) => previousFocus[index] !== taskId);
	return {
		changed,
		reason,
		previousFocus,
		nextFocus,
		droppedFocus,
	};
}
