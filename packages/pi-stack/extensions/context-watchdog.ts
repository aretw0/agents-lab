/**
 * context-watchdog — non-blocking context-window advisory for long-running sessions.
 * @capability-id context-watchdog
 * @capability-criticality medium
 *
 * Purpose:
 * - warn early before context gets expensive
 * - suggest checkpoint at a configurable threshold
 * - suggest compact near hard pressure
 *
 * Supports autonomous checkpoint/compact actions with cooldown + idle guards.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	resolveContextThresholds,
	type ContextThresholdOverrides,
} from "./custom-footer";
import {
	buildAutoCompactDiagnostics,
	resolveAutoCompactCheckpointGate,
	resolveAutoCompactEffectiveIdle,
	resolveAutoCompactRetryDelayMs,
	isAutoCompactDeferralReason,
	shouldScheduleAutoCompactRetry,
	shouldTriggerAutoCompact,
	type ContextWatchAutoCompactDecision,
	type ContextWatchAutoCompactDiagnostics,
	type ContextWatchAutoCompactIdleState,
} from "./context-watchdog-auto-compact";
import {
	DEFAULT_CONTEXT_WATCHDOG_CONFIG,
	deriveContextWatchThresholds,
	normalizeContextWatchdogConfig,
	type ContextWatchdogConfig,
	type ContextWatchThresholds,
} from "./context-watchdog-config";
import {
	applyContextWatchBootstrapToSettings,
	buildContextWatchBootstrapPlan,
	parseContextBootstrapPreset,
	type ContextWatchBootstrapPlan,
	type ContextWatchBootstrapPreset,
	deepMergeSettings,
} from "./context-watchdog-bootstrap";
import {
	contextWatchActionForLevel,
	evaluateContextWatch,
	formatContextWatchStatus,
	shouldAnnounceContextWatch,
	shouldAutoCheckpoint,
} from "./context-watchdog-policy";
import {
	assessLocalSliceHandoffBudget,
	buildAutoResumePromptEnvelopeFromHandoff,
	buildAutoResumePromptFromHandoff,
	buildLocalSliceHandoffCheckpoint,
	LOCAL_SLICE_HANDOFF_MAX_JSON_CHARS,
	handoffFreshnessAdvice,
	handoffRefreshMode,
	resolveHandoffFreshness,
	summarizeAutoResumePromptDiagnostics,
	toAgeSec,
	type AutoResumePromptDiagnostics,
	type HandoffFreshnessLabel,
	type HandoffRefreshMode,
	type LocalSliceHandoffCheckpointInput,
} from "./context-watchdog-handoff";
import {
	describeAutoResumeDispatchReason,
	describeAutoResumeDispatchHint,
	shouldNotifyAutoResumeSuppression,
	resolveAutoResumeDispatchDecision,
	resolveHandoffPrepDecision,
	shouldEmitAutoResumeAfterCompact,
	shouldRefreshHandoffBeforeAutoCompact,
	type AutoResumeDispatchReason,
	type HandoffPrepReason,
} from "./context-watchdog-resume";
import {
	applyContextWatchToHandoff,
	contextWatchEventAgeMs,
	latestContextWatchEvent,
	resolveCompactCheckpointPersistence,
	summarizeContextWatchEvent,
	type ContextWatchHandoffEvent,
	type ContextWatchHandoffReason,
} from "./context-watchdog-handoff-events";
import {
	readHandoffJson,
	readProjectSettings,
	readSettingsJson,
	writeHandoffJson,
	writeProjectSettings,
} from "./context-watchdog-storage";

export {
	applyContextWatchBootstrapToSettings,
	applyContextWatchToHandoff,
	assessLocalSliceHandoffBudget,
	buildAutoCompactDiagnostics,
	buildAutoResumePromptEnvelopeFromHandoff,
	buildAutoResumePromptFromHandoff,
	buildContextWatchBootstrapPlan,
	buildLocalSliceHandoffCheckpoint,
	LOCAL_SLICE_HANDOFF_MAX_JSON_CHARS,
	contextWatchActionForLevel,
	contextWatchEventAgeMs,
	deepMergeSettings,
	deriveContextWatchThresholds,
	evaluateContextWatch,
	formatContextWatchStatus,
	handoffFreshnessAdvice,
	handoffRefreshMode,
	summarizeAutoResumePromptDiagnostics,
	latestContextWatchEvent,
	resolveCompactCheckpointPersistence,
	normalizeContextWatchdogConfig,
	parseContextBootstrapPreset,
	resolveAutoCompactCheckpointGate,
	resolveAutoCompactEffectiveIdle,
	resolveAutoCompactRetryDelayMs,
	describeAutoResumeDispatchReason,
	describeAutoResumeDispatchHint,
	shouldNotifyAutoResumeSuppression,
	resolveAutoResumeDispatchDecision,
	resolveHandoffFreshness,
	resolveHandoffPrepDecision,
	shouldAnnounceContextWatch,
	shouldAutoCheckpoint,
	shouldEmitAutoResumeAfterCompact,
	shouldRefreshHandoffBeforeAutoCompact,
	shouldScheduleAutoCompactRetry,
	shouldTriggerAutoCompact,
	summarizeContextWatchEvent,
	toAgeSec,
	isAutoCompactDeferralReason,
};

export type {
	ContextWatchAutoCompactDecision,
	ContextWatchAutoCompactDiagnostics,
	ContextWatchAutoCompactIdleState,
	ContextWatchBootstrapPlan,
	ContextWatchBootstrapPreset,
	ContextWatchHandoffEvent,
	ContextWatchHandoffReason,
	ContextWatchdogConfig,
	ContextWatchThresholds,
	HandoffFreshnessLabel,
	HandoffPrepReason,
	HandoffRefreshMode,
};

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
	| "compact-checkpoint-required";

export type ContextWatchOperatorSignal = {
	reloadRequired: boolean;
	humanActionRequired: boolean;
	reasons: ContextWatchOperatorSignalReason[];
	noiseExcessive: boolean;
};

export type ContextWatchDeterministicStopReason = "none" | "reload-required" | "compact-checkpoint-required";

export type ContextWatchDeterministicStopSignal = {
	required: boolean;
	reason: ContextWatchDeterministicStopReason;
	action: "none" | "reload-and-resume" | "persist-checkpoint-and-compact";
};

export type ContextWatchOperatorActionKind = "none" | "reload" | "checkpoint-compact" | "handoff-refresh";

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
	const levelEligibleForSteering = levelMeetsSteeringThreshold(
		input.assessmentLevel,
		modelSteeringFromLevel,
	);
	const shouldSignal = (announce || input.forceWarnCadenceAnnouncement) && levelEligibleForSteering;
	if (!shouldSignal) {
		return {
			shouldSignal: false,
			shouldPersist: false,
			shouldNotify: false,
			delivery: "fallback-status",
		};
	}

	const shouldNotify = userNotifyEnabled && levelMeetsSteeringThreshold(
		input.assessmentLevel,
		userNotifyFromLevel,
	);
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
}): ContextWatchOperatorSignal {
	const reloadRequired = input.reloadRequired === true;
	const handoffManualRefreshRequired = input.handoffManualRefreshRequired === true;
	const signalNoiseExcessive = input.signalNoiseExcessive === true;
	const compactCheckpointPersistRequired = input.compactCheckpointPersistRequired === true;
	const reasons: ContextWatchOperatorSignalReason[] = [];
	if (reloadRequired) reasons.push("reload-required");
	if (handoffManualRefreshRequired) reasons.push("handoff-refresh-required");
	if (signalNoiseExcessive) reasons.push("signal-noise-excessive");
	if (compactCheckpointPersistRequired) reasons.push("compact-checkpoint-required");
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

const CONTEXT_WATCHDOG_SOURCE_PATH = fileURLToPath(import.meta.url);

function readContextWatchdogSourceMtimeMs(): number | undefined {
	try {
		return statSync(CONTEXT_WATCHDOG_SOURCE_PATH).mtimeMs;
	} catch {
		return undefined;
	}
}

const DEFAULT_CONFIG: ContextWatchdogConfig = DEFAULT_CONTEXT_WATCHDOG_CONFIG;

function readProjectTasksArray(cwd: string): unknown[] {
	const filePath = path.join(cwd, ".project", "tasks.json");
	if (!existsSync(filePath)) return [];
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		const tasks = Array.isArray(parsed) ? parsed : (parsed as { tasks?: unknown[] } | undefined)?.tasks;
		return Array.isArray(tasks) ? tasks : [];
	} catch {
		return [];
	}
}

function readProjectTaskStatusById(cwd: string): Record<string, string | undefined> {
	const statuses: Record<string, string | undefined> = {};
	for (const task of readProjectTasksArray(cwd)) {
		const id = (task as { id?: unknown } | undefined)?.id;
		const status = (task as { status?: unknown } | undefined)?.status;
		if (typeof id !== "string" || typeof status !== "string") continue;
		statuses[id] = status;
		statuses[id.toUpperCase()] = status;
	}
	return statuses;
}

function isProtectedAutoResumeTaskPath(value: unknown): boolean {
	const normalized = String(value ?? "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
	return normalized === ".pi/settings.json" || normalized === ".obsidian" || normalized.startsWith(".obsidian/") || normalized.startsWith(".github/");
}

function taskIdNumericSuffix(id: string): number {
	const match = id.match(/(\d+)(?!.*\d)/);
	return match ? Number(match[1]) : -1;
}

function readProjectPreferredActiveTaskIds(cwd: string, limit = 3): string[] {
	return readProjectTasksArray(cwd)
		.filter((task): task is { id: string; status: string; files?: unknown[] } => {
			const id = (task as { id?: unknown }).id;
			const status = (task as { status?: unknown }).status;
			if (typeof id !== "string" || typeof status !== "string") return false;
			if (status !== "in-progress" && status !== "planned") return false;
			const files = (task as { files?: unknown }).files;
			return !Array.isArray(files) || !files.some(isProtectedAutoResumeTaskPath);
		})
		.sort((a, b) => {
			const statusRank = (row: { status: string }) => row.status === "in-progress" ? 0 : 1;
			const byStatus = statusRank(a) - statusRank(b);
			if (byStatus !== 0) return byStatus;
			return taskIdNumericSuffix(b.id) - taskIdNumericSuffix(a.id);
		})
		.slice(0, limit)
		.map((task) => task.id);
}

function extractAutoResumePromptValue(prompt: string, label: string, fallback: string): string {
	const line = prompt.split(/\r?\n/).find((row) => row.startsWith(`${label}:`));
	return line ? line.slice(label.length + 1).trim() : fallback;
}

export function formatContextWatchAutoResumePreviewSummary(input: {
	focusTasks: string;
	staleFocusCount: number;
	diagnosticsSummary: string;
}): string {
	return [
		"context-watch-auto-resume-preview:",
		`focusTasks=${input.focusTasks.replace(/\s+/g, "_")}`,
		`staleFocus=${input.staleFocusCount}`,
		`diagnostics=${input.diagnosticsSummary.replace(/\s+/g, ";")}`,
	].join(" ");
}

export function formatContextWatchStatusToolSummary(input: {
	level: ContextWatchdogLevel;
	percent?: number;
	action?: string;
	autoCompactDecision?: string;
	operatorActionKind?: string;
	operatingCadence?: string;
	handoffFreshness?: HandoffFreshnessLabel;
}): string {
	return [
		"context-watch-status:",
		`level=${input.level}`,
		input.percent !== undefined ? `percent=${Math.floor(Number(input.percent))}` : undefined,
		input.action ? `action=${input.action}` : undefined,
		input.autoCompactDecision ? `autoCompact=${input.autoCompactDecision}` : undefined,
		input.operatorActionKind ? `operator=${input.operatorActionKind}` : undefined,
		input.operatingCadence ? `cadence=${input.operatingCadence}` : undefined,
		input.handoffFreshness ? `handoff=${input.handoffFreshness}` : undefined,
	].filter(Boolean).join(" ");
}

export function formatContextWatchCommandStatusSummary(input: {
	level: ContextWatchdogLevel;
	percent?: number;
	action?: string;
	autoCompactDecision?: string;
	autoCompactTrigger?: boolean;
	retryScheduled?: boolean;
	calmCloseReady?: boolean;
	checkpointEvidenceReady?: boolean;
	operatorActionKind?: string;
	handoffFreshness?: HandoffFreshnessLabel;
	deterministicStopReason?: ContextWatchDeterministicStopReason;
	deterministicStopAction?: string;
	handoffPath?: string;
}): string {
	return [
		"context-watch:",
		`level=${input.level}`,
		input.percent !== undefined ? `percent=${Math.floor(Number(input.percent))}` : undefined,
		input.action ? `action=${input.action}` : undefined,
		input.autoCompactDecision ? `autoCompact=${input.autoCompactDecision}` : undefined,
		input.autoCompactTrigger !== undefined ? `trigger=${input.autoCompactTrigger ? "yes" : "no"}` : undefined,
		input.retryScheduled !== undefined ? `retry=${input.retryScheduled ? "yes" : "no"}` : undefined,
		input.calmCloseReady !== undefined ? `calm=${input.calmCloseReady ? "ready" : "no"}` : undefined,
		input.checkpointEvidenceReady !== undefined ? `checkpoint=${input.checkpointEvidenceReady ? "ready" : "missing"}` : undefined,
		input.operatorActionKind ? `operator=${input.operatorActionKind}` : undefined,
		input.deterministicStopReason && input.deterministicStopReason !== "none" ? `stop=${input.deterministicStopReason}` : undefined,
		input.deterministicStopAction && input.deterministicStopAction !== "none" ? `next=${input.deterministicStopAction}` : undefined,
		input.handoffPath ? `handoff=${input.handoffPath}` : input.handoffFreshness ? `handoff=${input.handoffFreshness}` : undefined,
	].filter(Boolean).join(" ");
}

export function formatContextWatchDeterministicStopSummary(input: {
	required: boolean;
	reason: ContextWatchDeterministicStopReason;
	action: string;
	operatorActionKind?: string;
	handoffPath?: string;
}): string {
	return [
		"context-watch-stop:",
		`required=${input.required ? "yes" : "no"}`,
		input.required ? `reason=${input.reason}` : undefined,
		input.required ? `action=${input.action}` : undefined,
		input.operatorActionKind ? `operator=${input.operatorActionKind}` : undefined,
		input.handoffPath ? `handoff=${input.handoffPath}` : undefined,
	].filter(Boolean).join(" ");
}

function applyCheckpointTaskStatusFocus(
	cwd: string,
	checkpoint: Record<string, unknown>,
	taskId: string,
): void {
	if (!taskId || taskId === "n/a") return;
	const taskStatusById = readProjectTaskStatusById(cwd);
	const status = taskStatusById[taskId] ?? taskStatusById[taskId.toUpperCase()];
	if (status !== "completed") return;
	delete checkpoint.current_tasks;
	checkpoint.completed_tasks = [taskId];
	const contextWatch = checkpoint.context_watch;
	if (contextWatch && typeof contextWatch === "object") {
		(contextWatch as Record<string, unknown>).focus_task_status = "completed";
	}
}

export function writeLocalSliceHandoffCheckpoint(
	cwd: string,
	input: LocalSliceHandoffCheckpointInput,
	options: { maxJsonChars?: number } = {},
): { ok: boolean; summary: string; path?: string; checkpoint?: Record<string, unknown>; reason?: string; jsonChars?: number; maxJsonChars?: number } {
	const taskId = input.taskId || "n/a";
	if (typeof input.context !== "string" || input.context.trim().length <= 0) {
		return {
			ok: false,
			reason: "missing-context",
			summary: `context-watch-checkpoint: ok=no task=${taskId} reason=missing-context`,
		};
	}
	try {
		const current = readHandoffJson(cwd);
		const currentTimestamp = typeof current.timestamp === "string" ? Date.parse(current.timestamp) : NaN;
		const nextTimestamp = Date.parse(input.timestampIso);
		if (Number.isFinite(currentTimestamp) && Number.isFinite(nextTimestamp) && nextTimestamp < currentTimestamp) {
			return {
				ok: false,
				reason: "stale-checkpoint",
				summary: `context-watch-checkpoint: ok=no task=${taskId} reason=stale-checkpoint`,
			};
		}
		const checkpoint = buildLocalSliceHandoffCheckpoint(input);
		applyCheckpointTaskStatusFocus(cwd, checkpoint, taskId);
		const budget = assessLocalSliceHandoffBudget(checkpoint, options.maxJsonChars);
		if (!budget.ok) {
			return {
				ok: false,
				reason: budget.reason,
				summary: `context-watch-checkpoint: ok=no task=${taskId} reason=${budget.reason}`,
				jsonChars: budget.jsonChars,
				maxJsonChars: budget.maxJsonChars,
			};
		}
		const handoffPath = writeHandoffJson(cwd, checkpoint);
		return {
			ok: true,
			summary: `context-watch-checkpoint: ok=yes task=${taskId} path=.project/handoff.json`,
			path: handoffPath,
			checkpoint,
			jsonChars: budget.jsonChars,
			maxJsonChars: budget.maxJsonChars,
		};
	} catch (error) {
		const reason = error instanceof Error ? error.message : "write-failed";
		return {
			ok: false,
			reason,
			summary: `context-watch-checkpoint: ok=no task=${taskId} reason=write-failed`,
		};
	}
}

function persistContextWatchHandoffEvent(
	ctx: ExtensionContext,
	assessment: ContextWatchAssessment,
	reason: ContextWatchHandoffReason,
): string | undefined {
	if (assessment.level === "ok") return undefined;
	const nowIso = new Date().toISOString();
	const current = readHandoffJson(ctx.cwd);
	const next = applyContextWatchToHandoff(current, assessment, reason, nowIso);
	return writeHandoffJson(ctx.cwd, next);
}

function readContextThresholdOverrides(cwd: string): ContextThresholdOverrides | undefined {
	const settings = readSettingsJson(cwd);
	const cfg = (settings.piStack as Record<string, unknown> | undefined)?.customFooter;
	const pressure = (cfg as Record<string, unknown> | undefined)?.contextPressure;
	if (!pressure || typeof pressure !== "object") return undefined;
	const parsed = pressure as ContextThresholdOverrides;
	return {
		default: parsed.default,
		byProvider: parsed.byProvider,
		byProviderModel: parsed.byProviderModel,
	};
}

function readWatchdogConfig(cwd: string): ContextWatchdogConfig {
	const settings = readSettingsJson(cwd);
	const piStack = (settings.piStack as Record<string, unknown> | undefined) ?? {};
	return normalizeContextWatchdogConfig(piStack.contextWatchdog);
}

function readDeferredLaneQueueCount(cwd: string): number {
	const queuePath = path.join(cwd, ".pi", "deferred-intents.json");
	if (!existsSync(queuePath)) return 0;
	try {
		const json = JSON.parse(readFileSync(queuePath, "utf8"));
		if (!Array.isArray(json?.items)) return 0;
		return json.items.filter((item: unknown) => {
			if (!item || typeof item !== "object") return false;
			const row = item as { text?: unknown };
			return typeof row.text === "string" && row.text.trim().length > 0;
		}).length;
	} catch {
		return 0;
	}
}

function buildAssessment(
	ctx: ExtensionContext,
	config: ContextWatchdogConfig,
	overrides?: ContextThresholdOverrides,
): ContextWatchAssessment {
	const usage = ctx.getContextUsage();
	const percent = Number(usage?.percent ?? 0);
	const modelProvider = (ctx.model as Record<string, unknown> | undefined)?.provider;
	const provider = typeof modelProvider === "string" && modelProvider ? modelProvider : null;
	const modelId = ctx.model?.id ?? "no-model";
	const modelThresholds = resolveContextThresholds(provider, modelId, overrides);
	const thresholds = deriveContextWatchThresholds(
		modelThresholds.warningPct,
		modelThresholds.errorPct,
		config,
	);
	return evaluateContextWatch(percent, thresholds);
}

export default function contextWatchdogExtension(pi: ExtensionAPI) {
	const AUTO_COMPACT_RETRY_DELAY_MS = 2_000;
	let config = DEFAULT_CONFIG;
	let thresholdOverrides: ContextThresholdOverrides | undefined;
	let sourceMtimeMsAtSessionStart: number | undefined;
	let lastAssessment: ContextWatchAssessment | null = null;
	let lastAnnouncedLevel: ContextWatchdogLevel | null = null;
	let lastAnnouncedAt = 0;
	let lastAutoCheckpointAt = 0;
	let lastAutoCompactAt = 0;
	let lastAutoResumeAt = 0;
	let lastAutoResumeDecision: {
		atIso: string;
		reason: AutoResumeDispatchReason;
		dispatched: boolean;
		reloadRequired: boolean;
		checkpointEvidenceReady: boolean;
		hasPendingMessages: boolean;
		hasRecentSteerInput: boolean;
		queuedLaneIntents: number;
		promptDiagnostics?: AutoResumePromptDiagnostics;
	} | null = null;
	let lastSteeringSignal: {
		atIso: string;
		reason: ContextWatchHandoffReason;
		level: ContextWatchdogLevel;
		action: string;
		delivery: ContextWatchSteeringDelivery;
		notifyEnabled: boolean;
	} | null = null;
	let lastInputAt = 0;
	let lastAutoCompactTriggerAt = 0;
	let autoCompactInFlight = false;
	let autoCompactRetryTimer: NodeJS.Timeout | undefined;
	let autoCompactRetryDueAt = 0;
	let consecutiveWarnCount = 0;
	let compactDeferCount = 0;
	let compactDeferWindowStartedAt = 0;
	let antiParalysisNotifyCountInWindow = 0;
	let lastAntiParalysisNotifyAt = 0;
	let announceWindowStartAt = 0;
	let announceCountInWindow = 0;
	let lastDeterministicStopSignalAt = 0;
	const SIGNAL_NOISE_WINDOW_MS = 10 * 60 * 1000;
	const SIGNAL_NOISE_MAX_ANNOUNCEMENTS = 4;
	const CALM_CLOSE_DEFER_THRESHOLD = 3;
	const ANTI_PARALYSIS_GRACE_WINDOW_MS = 2 * 60 * 1000;
	const ANTI_PARALYSIS_NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;
	const ANTI_PARALYSIS_MAX_NOTIFIES_PER_WINDOW = 1;

	const getAnnouncementsInWindow = (nowMs: number): number => {
		if (announceWindowStartAt <= 0) return 0;
		if ((nowMs - announceWindowStartAt) > SIGNAL_NOISE_WINDOW_MS) return 0;
		return announceCountInWindow;
	};

	const markAnnouncement = (nowMs: number): void => {
		if (announceWindowStartAt <= 0 || (nowMs - announceWindowStartAt) > SIGNAL_NOISE_WINDOW_MS) {
			announceWindowStartAt = nowMs;
			announceCountInWindow = 0;
		}
		announceCountInWindow += 1;
	};

	const isReloadRequiredForSourceUpdate = (): boolean => {
		if (!Number.isFinite(sourceMtimeMsAtSessionStart)) return false;
		const current = readContextWatchdogSourceMtimeMs();
		if (!Number.isFinite(current)) return false;
		return (current as number) > (sourceMtimeMsAtSessionStart as number);
	};

	const clearAutoCompactRetryTimer = () => {
		if (!autoCompactRetryTimer) return;
		clearTimeout(autoCompactRetryTimer);
		autoCompactRetryTimer = undefined;
		autoCompactRetryDueAt = 0;
	};

	const scheduleAutoCompactRetry = (ctx: ExtensionContext, delayMs: number) => {
		const safeDelayMs = Math.max(250, Math.floor(delayMs));
		const dueAt = Date.now() + safeDelayMs;
		if (autoCompactRetryTimer && autoCompactRetryDueAt > 0 && autoCompactRetryDueAt <= dueAt) {
			return;
		}
		clearAutoCompactRetryTimer();
		autoCompactRetryDueAt = dueAt;
		autoCompactRetryTimer = setTimeout(() => {
			autoCompactRetryTimer = undefined;
			autoCompactRetryDueAt = 0;
			run(ctx, "message_end");
		}, safeDelayMs);
	};

	const run = (ctx: ExtensionContext, reason: ContextWatchHandoffReason) => {
		if (!config.enabled) {
			ctx.ui.setStatus?.("context-watch", "[ctx] disabled");
			ctx.ui.setStatus?.("context-watch-steering", "[ctx-steer] disabled");
			ctx.ui.setStatus?.("context-watch-operator", "[ctx-op] disabled");
			return;
		}

		const baseAssessment = buildAssessment(ctx, config, thresholdOverrides);
		if (baseAssessment.level === "warn") {
			consecutiveWarnCount += 1;
		} else {
			consecutiveWarnCount = 0;
		}
		const assessment = applyWarnCadenceEscalation(baseAssessment, consecutiveWarnCount);
		lastAssessment = assessment;
		const now = Date.now();
		let handoffPath: string | undefined;

		if (config.status) {
			ctx.ui.setStatus?.("context-watch", formatContextWatchStatus(assessment));
		}
		ctx.ui.setStatus?.("context-watch-steering", formatContextWatchSteeringStatus(assessment));

		const shouldCheckpointFromWarnCadence =
			assessment.level === "warn" &&
			assessment.action === "write-checkpoint" &&
			(now - lastAutoCheckpointAt) >= config.cooldownMs;
		if (
			shouldAutoCheckpoint(assessment, config, now, lastAutoCheckpointAt) ||
			shouldCheckpointFromWarnCadence
		) {
			handoffPath = persistContextWatchHandoffEvent(ctx, assessment, reason);
			lastAutoCheckpointAt = now;
		}

		const autoCompactState = buildAutoCompactDiagnostics(assessment, config, {
			nowMs: now,
			lastAutoCompactAt,
			inFlight: autoCompactInFlight,
			isIdle: ctx.isIdle(),
			hasPendingMessages: ctx.hasPendingMessages(),
			reason,
		}, AUTO_COMPACT_RETRY_DELAY_MS);
		if (
			assessment.level === "compact"
			&& !autoCompactState.decision.trigger
			&& isAutoCompactDeferralReason(autoCompactState.decision.reason)
		) {
			if (compactDeferCount === 0) {
				compactDeferWindowStartedAt = now;
				antiParalysisNotifyCountInWindow = 0;
			}
			compactDeferCount += 1;
		} else {
			compactDeferCount = 0;
			compactDeferWindowStartedAt = 0;
			antiParalysisNotifyCountInWindow = 0;
			lastAntiParalysisNotifyAt = 0;
		}
		const handoffForCalmClose = readHandoffJson(ctx.cwd);
		const handoffEventForCalmClose = latestContextWatchEvent(handoffForCalmClose);
		const handoffEventAgeForCalmClose = contextWatchEventAgeMs(handoffEventForCalmClose, now);
		const compactCheckpointPersistence = resolveCompactCheckpointPersistence({
			enabled: config.autoResumeAfterCompact,
			assessmentLevel: assessment.level,
			handoffLastEventLevel: handoffEventForCalmClose?.level,
			handoffLastEventAgeMs: handoffEventAgeForCalmClose,
			maxCheckpointAgeMs: config.handoffFreshMaxAgeMs,
		});
		if (compactCheckpointPersistence.shouldPersist && !handoffPath) {
			handoffPath = persistContextWatchHandoffEvent(ctx, assessment, reason);
			lastAutoCheckpointAt = now;
			(pi as unknown as { appendEntry?: (type: string, payload: unknown) => void }).appendEntry?.(
				"context-watchdog.compact-checkpoint-persist",
				{
					atIso: new Date(now).toISOString(),
					reason: compactCheckpointPersistence.reason,
					eventLevel: handoffEventForCalmClose?.level ?? "none",
					eventAgeMs: handoffEventAgeForCalmClose,
					maxCheckpointAgeMs: config.handoffFreshMaxAgeMs,
				},
			);
		}
		const handoffTsForSignal = typeof handoffForCalmClose.timestamp === "string" ? handoffForCalmClose.timestamp : undefined;
		const handoffFreshnessForSignal = resolveHandoffFreshness(handoffTsForSignal, now, config.handoffFreshMaxAgeMs);
		const handoffRefreshModeForSignal = handoffRefreshMode(handoffFreshnessForSignal.label, config.autoResumeAfterCompact);
		const operatorSignal = resolveContextWatchOperatorSignal({
			reloadRequired: isReloadRequiredForSourceUpdate(),
			handoffManualRefreshRequired: handoffRefreshModeForSignal === "manual",
			signalNoiseExcessive: resolveContextWatchSignalNoiseExcessive(
				getAnnouncementsInWindow(now),
				SIGNAL_NOISE_MAX_ANNOUNCEMENTS,
			),
			compactCheckpointPersistRequired: compactCheckpointPersistence.shouldPersist,
		});
		const deterministicStop = resolveContextWatchDeterministicStopSignal({
			assessmentLevel: assessment.level,
			operatorSignal,
		});
		const deterministicStopHint = describeContextWatchDeterministicStopHint(deterministicStop);
		const operatorAction = resolveContextWatchOperatorActionPlan({ deterministicStop, operatorSignal });
		ctx.ui.setStatus?.(
			"context-watch-operator",
			operatorAction.kind === "none"
				? "[ctx-op] ok"
				: `[ctx-op] ${operatorAction.kind}${operatorAction.blocking ? "!" : ""} ${operatorAction.summary}`,
		);
		if (shouldEmitDeterministicStopSignal(deterministicStop.required, now, lastDeterministicStopSignalAt, config.cooldownMs)) {
			lastDeterministicStopSignalAt = now;
			(pi as unknown as { appendEntry?: (type: string, payload: unknown) => void }).appendEntry?.(
				"context-watchdog.deterministic-stop-signal",
				{
					atIso: new Date(now).toISOString(),
					reason,
					assessmentLevel: assessment.level,
					stopReason: deterministicStop.reason,
					stopAction: deterministicStop.action,
					stopHint: deterministicStopHint,
					operatorAction,
					operatorReasons: operatorSignal.reasons,
				},
			);
			if (config.notify && deterministicStop.reason !== "compact-checkpoint-required") {
				ctx.ui.notify(
					formatContextWatchDeterministicStopSummary({
						required: deterministicStop.required,
						reason: deterministicStop.reason,
						action: deterministicStop.action,
						operatorActionKind: operatorAction.kind,
					}),
					"warning",
				);
			}
		}
		const calmCloseSignal = resolvePreCompactCalmCloseSignal({
			assessmentLevel: assessment.level,
			decisionReason: autoCompactState.decision.reason,
			checkpointEvidenceReady: resolveCheckpointEvidenceReadyForCalmClose({
				handoffLastEventLevel: handoffEventForCalmClose?.level,
				handoffLastEventAgeMs: handoffEventAgeForCalmClose,
				maxCheckpointAgeMs: config.handoffFreshMaxAgeMs,
			}),
			deferCount: compactDeferCount,
			deferThreshold: CALM_CLOSE_DEFER_THRESHOLD,
		});
		const antiParalysisDispatch = resolveAntiParalysisDispatch({
			triggered: calmCloseSignal.antiParalysisTriggered,
			nowMs: now,
			deferWindowStartedAtMs: compactDeferWindowStartedAt,
			graceWindowMs: ANTI_PARALYSIS_GRACE_WINDOW_MS,
			lastNotifyAtMs: lastAntiParalysisNotifyAt,
			notifyCooldownMs: ANTI_PARALYSIS_NOTIFY_COOLDOWN_MS,
			notifiesInWindow: antiParalysisNotifyCountInWindow,
			maxNotifiesPerWindow: ANTI_PARALYSIS_MAX_NOTIFIES_PER_WINDOW,
		});
		if (antiParalysisDispatch.shouldNotify) {
			lastAntiParalysisNotifyAt = now;
			antiParalysisNotifyCountInWindow += 1;
			(pi as unknown as { appendEntry?: (type: string, payload: unknown) => void }).appendEntry?.(
				"context-watchdog.pre-compact-calm-close",
				{
					atIso: new Date(now).toISOString(),
					deferCount: compactDeferCount,
					deferThreshold: CALM_CLOSE_DEFER_THRESHOLD,
					decisionReason: autoCompactState.decision.reason,
					recommendation: calmCloseSignal.recommendation,
					dispatchReason: antiParalysisDispatch.reason,
					graceWindowMs: ANTI_PARALYSIS_GRACE_WINDOW_MS,
					notifyCooldownMs: ANTI_PARALYSIS_NOTIFY_COOLDOWN_MS,
					notifyCountInWindow: antiParalysisNotifyCountInWindow,
					maxNotifiesPerWindow: ANTI_PARALYSIS_MAX_NOTIFIES_PER_WINDOW,
				},
			);
			ctx.ui.notify(calmCloseSignal.recommendation, "warning");
		}
		if (autoCompactState.decision.trigger) {
			const handoffForPrep = readHandoffJson(ctx.cwd);
			const handoffTsForPrep = typeof handoffForPrep.timestamp === "string" ? handoffForPrep.timestamp : undefined;
			const handoffFreshnessForPrep = resolveHandoffFreshness(handoffTsForPrep, now, config.handoffFreshMaxAgeMs);
			if (shouldRefreshHandoffBeforeAutoCompact(assessment, config, handoffFreshnessForPrep.label) && !handoffPath) {
				handoffPath = persistContextWatchHandoffEvent(ctx, assessment, "auto_compact_prep");
			}
			const handoffAfterPrep = handoffPath ? readHandoffJson(ctx.cwd) : handoffForPrep;
			const handoffEventAfterPrep = latestContextWatchEvent(handoffAfterPrep);
			const checkpointGate = resolveAutoCompactCheckpointGate({
				handoffPath,
				checkpointEvidenceReady: resolveCheckpointEvidenceReadyForCalmClose({
					handoffLastEventLevel: handoffEventAfterPrep?.level,
					handoffLastEventAgeMs: contextWatchEventAgeMs(handoffEventAfterPrep, now),
					maxCheckpointAgeMs: config.handoffFreshMaxAgeMs,
				}),
			});
			if (!checkpointGate.proceed) {
				(pi as unknown as { appendEntry?: (type: string, payload: unknown) => void }).appendEntry?.(
					"context-watchdog.auto-compact-suppressed",
					{
						atIso: new Date(now).toISOString(),
						reason: checkpointGate.reason,
						freshness: handoffFreshnessForPrep.label,
					},
				);
				if (config.notify) {
					ctx.ui.notify("context-watch: auto compact waiting for fresh handoff checkpoint", "warning");
				}
				return;
			}
			clearAutoCompactRetryTimer();
			autoCompactInFlight = true;
			lastAutoCompactAt = now;
			lastAutoCompactTriggerAt = now;
			ctx.ui.notify("context-watch: autoCompact=triggered action=compact-now checkpoint=ready", "info");
			ctx.compact({
				onComplete: () => {
					autoCompactInFlight = false;
					ctx.ui.notify("context-watch: auto compact completed", "info");
					const nowAfterCompact = Date.now();
					const hasPendingMessages = ctx.hasPendingMessages();
					const hasRecentSteerInput = lastInputAt > lastAutoCompactTriggerAt;
					const queuedLaneIntents = readDeferredLaneQueueCount(ctx.cwd);
					const handoffAfterCompact = readHandoffJson(ctx.cwd);
					const handoffEventAfterCompact = latestContextWatchEvent(handoffAfterCompact);
					const handoffEventAgeAfterCompact = contextWatchEventAgeMs(handoffEventAfterCompact, nowAfterCompact);
					const checkpointEvidenceReady = resolveCheckpointEvidenceReadyForCalmClose({
						handoffLastEventLevel: handoffEventAfterCompact?.level,
						handoffLastEventAgeMs: handoffEventAgeAfterCompact,
						maxCheckpointAgeMs: config.handoffFreshMaxAgeMs,
					});
					const autoResumeReady = shouldEmitAutoResumeAfterCompact(config, nowAfterCompact, lastAutoResumeAt);
					const reloadRequired = isReloadRequiredForSourceUpdate();
					const autoResumeDecision = resolveAutoResumeDispatchDecision({
						autoResumeReady,
						reloadRequired,
						checkpointEvidenceReady,
						hasPendingMessages,
						hasRecentSteerInput,
						queuedLaneIntents,
					});
					const autoResumeSnapshot: {
						atIso: string;
						reason: AutoResumeDispatchReason;
						hint?: string;
						dispatched: boolean;
						reloadRequired: boolean;
						checkpointEvidenceReady: boolean;
						hasPendingMessages: boolean;
						hasRecentSteerInput: boolean;
						queuedLaneIntents: number;
						promptDiagnostics?: AutoResumePromptDiagnostics;
					} = {
						atIso: new Date(nowAfterCompact).toISOString(),
						reason: autoResumeDecision.reason,
						hint: describeAutoResumeDispatchHint(autoResumeDecision.reason),
						dispatched: autoResumeDecision.shouldDispatch,
						reloadRequired,
						checkpointEvidenceReady,
						hasPendingMessages,
						hasRecentSteerInput,
						queuedLaneIntents,
					};
					if (autoResumeDecision.shouldDispatch) {
						lastAutoResumeAt = nowAfterCompact;
						const resumeEnvelope = buildAutoResumePromptEnvelopeFromHandoff(
							readHandoffJson(ctx.cwd),
							config.handoffFreshMaxAgeMs,
							Date.now(),
							{ taskStatusById: readProjectTaskStatusById(ctx.cwd), preferredTaskIds: readProjectPreferredActiveTaskIds(ctx.cwd) },
						);
						autoResumeSnapshot.promptDiagnostics = resumeEnvelope.diagnostics;
						(pi as unknown as { appendEntry?: (type: string, payload: unknown) => void }).appendEntry?.(
							"context-watchdog.auto-resume-prompt",
							{
								atIso: autoResumeSnapshot.atIso,
								diagnostics: resumeEnvelope.diagnostics,
								diagnosticsSummary: summarizeAutoResumePromptDiagnostics(resumeEnvelope.diagnostics),
								preview: resumeEnvelope.prompt.slice(0, 240),
							},
						);
						pi.sendUserMessage(resumeEnvelope.prompt, { deliverAs: "followUp" });
						ctx.ui.notify("context-watch: auto resume queued", "info");
					} else {
						(pi as unknown as { appendEntry?: (type: string, payload: unknown) => void }).appendEntry?.(
							"context-watchdog.auto-resume-suppressed",
							{
								atIso: autoResumeSnapshot.atIso,
								reason: autoResumeSnapshot.reason,
								hint: autoResumeSnapshot.hint,
								hasPendingMessages: autoResumeSnapshot.hasPendingMessages,
								hasRecentSteerInput: autoResumeSnapshot.hasRecentSteerInput,
								queuedLaneIntents: autoResumeSnapshot.queuedLaneIntents,
								reloadRequired: autoResumeSnapshot.reloadRequired,
								checkpointEvidenceReady: autoResumeSnapshot.checkpointEvidenceReady,
							},
						);
						if (config.notify && shouldNotifyAutoResumeSuppression(autoResumeSnapshot.reason)) {
							ctx.ui.notify(
								`context-watch: auto resume suppressed (${autoResumeSnapshot.reason})${autoResumeSnapshot.hint ? ` · ${autoResumeSnapshot.hint}` : ""}`,
								"warning",
							);
						}
					}
					lastAutoResumeDecision = autoResumeSnapshot;
				},
				onError: (error) => {
					autoCompactInFlight = false;
					ctx.ui.notify(`context-watch: auto compact failed (${error.message})`, "warning");
				},
			});
		} else if (assessment.level === "compact" && autoCompactState.retryDelayMs !== undefined) {
			scheduleAutoCompactRetry(ctx, autoCompactState.retryDelayMs);
		} else {
			clearAutoCompactRetryTimer();
		}

		const elapsed = now - lastAnnouncedAt;
		const forceWarnCadenceAnnouncement =
			assessment.level === "warn" &&
			assessment.action === "write-checkpoint" &&
			consecutiveWarnCount === 2;
		const steeringDispatch = resolveContextWatchSteeringDispatch({
			userNotifyEnabled: config.notify,
			assessmentLevel: assessment.level,
			modelSteeringFromLevel: config.modelSteeringFromLevel,
			userNotifyFromLevel: config.userNotifyFromLevel,
			lastAnnouncedLevel,
			elapsedMs: elapsed,
			cooldownMs: config.cooldownMs,
			forceWarnCadenceAnnouncement,
		});
		lastAnnouncedLevel = assessment.level;
		if (!steeringDispatch.shouldSignal) return;
		lastAnnouncedAt = now;
		markAnnouncement(now);

		const persistedPath = steeringDispatch.shouldPersist
			? (handoffPath ?? persistContextWatchHandoffEvent(ctx, assessment, reason))
			: handoffPath;
		const persistedRelPath = persistedPath ? path.relative(ctx.cwd, persistedPath).replace(/\\/g, "/") : undefined;
		const inlineCompactCheckpointStop = deterministicStop.required && deterministicStop.reason === "compact-checkpoint-required";
		const lines = [
			formatContextWatchCommandStatusSummary({
				level: assessment.level,
				percent: assessment.percent,
				action: assessment.action,
				autoCompactDecision: autoCompactState.decision.reason,
				autoCompactTrigger: autoCompactState.decision.trigger,
				retryScheduled: autoCompactState.retryDelayMs !== undefined,
				calmCloseReady: calmCloseSignal.readyForCompact,
				checkpointEvidenceReady: calmCloseSignal.checkpointEvidenceReady,
				operatorActionKind: operatorAction.kind,
				deterministicStopReason: inlineCompactCheckpointStop ? deterministicStop.reason : undefined,
				deterministicStopAction: inlineCompactCheckpointStop ? deterministicStop.action : undefined,
				handoffPath: inlineCompactCheckpointStop ? persistedRelPath : undefined,
			}),
			inlineCompactCheckpointStop ? undefined : formatContextWatchDeterministicStopSummary({
				required: deterministicStop.required,
				reason: deterministicStop.reason,
				action: deterministicStop.action,
				operatorActionKind: operatorAction.kind,
				handoffPath: persistedRelPath,
			}),
		].filter(Boolean);
		const signalAtIso = new Date(now).toISOString();
		lastSteeringSignal = {
			atIso: signalAtIso,
			reason,
			level: assessment.level,
			action: assessment.action,
			delivery: steeringDispatch.delivery,
			notifyEnabled: config.notify,
		};
		(pi as unknown as { appendEntry?: (type: string, payload: unknown) => void }).appendEntry?.(
			"context-watchdog.passive-steering-signal",
			{
				atIso: signalAtIso,
				reason,
				level: assessment.level,
				action: assessment.action,
				delivery: steeringDispatch.delivery,
				notifyEnabled: config.notify,
				persisted: Boolean(persistedPath),
				compactCheckpointPersistRecommended: compactCheckpointPersistence.shouldPersist,
				compactCheckpointPersistReason: compactCheckpointPersistence.reason,
				deterministicStopRequired: deterministicStop.required,
				deterministicStopReason: deterministicStop.reason,
				deterministicStopAction: deterministicStop.action,
				deterministicStopHint,
				operatorActionKind: operatorAction.kind,
				operatorActionBlocking: operatorAction.blocking,
				operatorActionSummary: operatorAction.summary,
				operatorActionCommandHint: operatorAction.commandHint,
			},
		);
		if (steeringDispatch.shouldNotify) {
			ctx.ui.notify(lines.join("\n"), assessment.severity);
		}
	};

	const currentAutoCompactState = (
		ctx: ExtensionContext,
		assessment: ContextWatchAssessment,
		deferCount = compactDeferCount,
	) => {
		const nowMs = Date.now();
		const state = buildAutoCompactDiagnostics(assessment, config, {
			nowMs,
			lastAutoCompactAt,
			inFlight: autoCompactInFlight,
			isIdle: ctx.isIdle(),
			hasPendingMessages: ctx.hasPendingMessages(),
		}, AUTO_COMPACT_RETRY_DELAY_MS);
		const retryInMs = autoCompactRetryDueAt > 0 ? Math.max(0, autoCompactRetryDueAt - nowMs) : undefined;
		const handoff = readHandoffJson(ctx.cwd);
		const handoffTimestamp = typeof handoff.timestamp === "string" ? handoff.timestamp : undefined;
		const handoffFreshness = resolveHandoffFreshness(handoffTimestamp, nowMs, config.handoffFreshMaxAgeMs);
		const handoffFreshnessAgeSec = toAgeSec(handoffFreshness.ageMs);
		const handoffLastEvent = latestContextWatchEvent(handoff);
		const handoffLastEventAgeMs = contextWatchEventAgeMs(handoffLastEvent, nowMs);
		const handoffLastEventAgeSec = toAgeSec(handoffLastEventAgeMs);
		const refreshMode = handoffRefreshMode(handoffFreshness.label, config.autoResumeAfterCompact);
		const handoffPrep = resolveHandoffPrepDecision(assessment, config, handoffFreshness.label);
		const compactCheckpointPersistence = resolveCompactCheckpointPersistence({
			enabled: config.autoResumeAfterCompact,
			assessmentLevel: assessment.level,
			handoffLastEventLevel: handoffLastEvent?.level,
			handoffLastEventAgeMs,
			maxCheckpointAgeMs: config.handoffFreshMaxAgeMs,
		});
		const checkpointEvidenceReady = resolveCheckpointEvidenceReadyForCalmClose({
			handoffLastEventLevel: handoffLastEvent?.level,
			handoffLastEventAgeMs,
			maxCheckpointAgeMs: config.handoffFreshMaxAgeMs,
		});
		const calmClose = resolvePreCompactCalmCloseSignal({
			assessmentLevel: assessment.level,
			decisionReason: state.decision.reason,
			checkpointEvidenceReady,
			deferCount,
			deferThreshold: CALM_CLOSE_DEFER_THRESHOLD,
		});
		const progressPreservation = resolveProgressPreservationSignal({
			assessmentLevel: assessment.level,
			handoffFreshnessLabel: handoffFreshness.label,
			checkpointEvidenceReady,
			compactCheckpointPersistRecommended: compactCheckpointPersistence.shouldPersist,
			autoResumeEnabled: config.autoResumeAfterCompact,
		});
		const autoResumePromptDiagnostics = lastAutoResumeDecision?.promptDiagnostics;
		const contextEconomy = resolveContextEconomySignal({
			handoffBytes: JSON.stringify(handoff).length,
			nextActionCount: Array.isArray(handoff.next_actions) ? handoff.next_actions.length : undefined,
			autoResumeDroppedNextActions: autoResumePromptDiagnostics?.nextActions.droppedByLimitCount,
			autoResumeGlobalTruncated: autoResumePromptDiagnostics?.globalTruncated,
		});
		const antiParalysisDispatch = resolveAntiParalysisDispatch({
			triggered: calmClose.antiParalysisTriggered,
			nowMs,
			deferWindowStartedAtMs: compactDeferWindowStartedAt,
			graceWindowMs: ANTI_PARALYSIS_GRACE_WINDOW_MS,
			lastNotifyAtMs: lastAntiParalysisNotifyAt,
			notifyCooldownMs: ANTI_PARALYSIS_NOTIFY_COOLDOWN_MS,
			notifiesInWindow: antiParalysisNotifyCountInWindow,
			maxNotifiesPerWindow: ANTI_PARALYSIS_MAX_NOTIFIES_PER_WINDOW,
		});
		return {
			...state,
			retryScheduled: Boolean(autoCompactRetryTimer),
			retryInMs,
			autoResumeEnabled: config.autoResumeAfterCompact,
			autoResumeCooldownMs: config.autoResumeCooldownMs,
			autoResumeReady: shouldEmitAutoResumeAfterCompact(config, nowMs, lastAutoResumeAt),
			autoResumeLastDecision: lastAutoResumeDecision,
			autoResumeLastDecisionReason: lastAutoResumeDecision?.reason ?? "none",
			autoResumeLastDecisionSummary: lastAutoResumeDecision
				? describeAutoResumeDispatchReason(lastAutoResumeDecision.reason)
				: "none",
			autoResumeLastDecisionHint: lastAutoResumeDecision?.hint
				?? describeAutoResumeDispatchHint(lastAutoResumeDecision?.reason ?? "send"),
			autoResumeLastPromptDiagnosticsSummary: summarizeAutoResumePromptDiagnostics(
				lastAutoResumeDecision?.promptDiagnostics,
			),
			autoResumeLastDecisionAtIso: lastAutoResumeDecision?.atIso,
			autoResumeLastDispatched: lastAutoResumeDecision?.dispatched ?? false,
			autoResumeLastReloadRequired: lastAutoResumeDecision?.reloadRequired ?? false,
			autoResumeLastCheckpointEvidenceReady: lastAutoResumeDecision?.checkpointEvidenceReady ?? true,
			steeringLastSignal: lastSteeringSignal,
			steeringLastSignalSummary: lastSteeringSignal
				? `${lastSteeringSignal.reason} level=${lastSteeringSignal.level} action=${lastSteeringSignal.action} delivery=${lastSteeringSignal.delivery} at=${lastSteeringSignal.atIso}`
				: "none",
			handoffFreshMaxAgeMs: config.handoffFreshMaxAgeMs,
			handoffTimestamp,
			handoffFreshness,
			handoffFreshnessAgeSec,
			handoffAdvice: handoffFreshnessAdvice(handoffFreshness.label, config.autoResumeAfterCompact),
			handoffRefreshMode: refreshMode,
			handoffManualRefreshRequired: refreshMode === "manual",
			handoffPrepRefreshOnTrigger: handoffPrep.refreshOnTrigger,
			handoffPrepReason: handoffPrep.reason,
			handoffLastEvent: handoffLastEvent ?? null,
			handoffLastEventSummary: summarizeContextWatchEvent(handoffLastEvent),
			handoffLastEventAgeMs,
			handoffLastEventAgeSec,
			progressPreservation,
			progressPreservationSummary: summarizeProgressPreservationSignal(progressPreservation),
			contextEconomy,
			contextEconomySummary: summarizeContextEconomySignal(contextEconomy),
			calmCloseReady: calmClose.calmCloseReady,
			checkpointEvidenceReady: calmClose.checkpointEvidenceReady,
			deferCount: calmClose.deferCount,
			deferThreshold: calmClose.deferThreshold,
			antiParalysisTriggered: calmClose.antiParalysisTriggered,
			antiParalysisDispatchReason: antiParalysisDispatch.reason,
			antiParalysisGraceRemainingMs: antiParalysisDispatch.graceRemainingMs,
			antiParalysisCooldownRemainingMs: antiParalysisDispatch.cooldownRemainingMs,
			antiParalysisNotifyCountInWindow,
			antiParalysisMaxNotifiesPerWindow: ANTI_PARALYSIS_MAX_NOTIFIES_PER_WINDOW,
			calmCloseRecommendation: calmClose.recommendation,
			compactCheckpointPersistRecommended: compactCheckpointPersistence.shouldPersist,
			compactCheckpointPersistReason: compactCheckpointPersistence.reason,
		};
	};

	const applyPreset = (ctx: ExtensionContext, presetInput?: unknown) => {
		const merged = applyContextWatchBootstrapToSettings(
			readProjectSettings(ctx.cwd),
			presetInput,
		);
		const settingsPath = writeProjectSettings(ctx.cwd, merged.settings);
		const piStack = (merged.settings.piStack as Record<string, unknown> | undefined) ?? {};
		config = normalizeContextWatchdogConfig(piStack.contextWatchdog);
		thresholdOverrides = readContextThresholdOverrides(ctx.cwd);
		run(ctx, "message_end");
		return {
			preset: merged.preset,
			settingsPath,
			patch: merged.plan.patch,
			notes: merged.plan.notes,
		};
	};

	pi.on("session_start", (_event, ctx) => {
		config = readWatchdogConfig(ctx.cwd);
		thresholdOverrides = readContextThresholdOverrides(ctx.cwd);
		sourceMtimeMsAtSessionStart = readContextWatchdogSourceMtimeMs();
		lastAssessment = null;
		lastAnnouncedLevel = null;
		lastAnnouncedAt = 0;
		lastAutoCheckpointAt = 0;
		lastAutoCompactAt = 0;
		lastAutoResumeAt = 0;
		lastAutoResumeDecision = null;
		lastSteeringSignal = null;
		lastInputAt = 0;
		lastAutoCompactTriggerAt = 0;
		autoCompactInFlight = false;
		clearAutoCompactRetryTimer();
		consecutiveWarnCount = 0;
		compactDeferCount = 0;
		compactDeferWindowStartedAt = 0;
		antiParalysisNotifyCountInWindow = 0;
		lastAntiParalysisNotifyAt = 0;
		announceWindowStartAt = 0;
		announceCountInWindow = 0;
		lastDeterministicStopSignalAt = 0;
		run(ctx, "session_start");
	});

	pi.on("input", (event) => {
		const text = String(event.text ?? "").trim();
		if (!text) return;
		lastInputAt = Date.now();
	});

	pi.on("message_end", (_event, ctx) => {
		run(ctx, "message_end");
	});

	pi.registerTool({
		name: "context_watch_status",
		label: "Context Watch Status",
		description:
			"Non-blocking context-window advisory (warn/checkpoint/compact) with model-aware thresholds.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const assessment = buildAssessment(ctx, config, thresholdOverrides);
			lastAssessment = assessment;
			const autoCompact = currentAutoCompactState(ctx, assessment);
			const nowMs = Date.now();
			const operatorSignal = resolveContextWatchOperatorSignal({
				reloadRequired: isReloadRequiredForSourceUpdate(),
				handoffManualRefreshRequired: autoCompact.handoffManualRefreshRequired,
				signalNoiseExcessive: resolveContextWatchSignalNoiseExcessive(
					getAnnouncementsInWindow(nowMs),
					SIGNAL_NOISE_MAX_ANNOUNCEMENTS,
				),
				compactCheckpointPersistRequired: autoCompact.compactCheckpointPersistRecommended,
			});
			const deterministicStop = resolveContextWatchDeterministicStopSignal({
				assessmentLevel: assessment.level,
				operatorSignal,
			});
			const deterministicStopHint = describeContextWatchDeterministicStopHint(deterministicStop);
			const operatorAction = resolveContextWatchOperatorActionPlan({ deterministicStop, operatorSignal });
			const operatingCadence = resolveContextWatchOperatingCadence({
				assessmentLevel: assessment.level,
				handoffLastEventLevel: autoCompact.handoffLastEvent?.level,
			});
			const summary = formatContextWatchStatusToolSummary({
				level: assessment.level,
				percent: assessment.percent,
				action: assessment.action,
				autoCompactDecision: autoCompact.decision.reason,
				operatorActionKind: operatorAction.kind,
				operatingCadence: operatingCadence.operatingCadence,
				handoffFreshness: autoCompact.handoffFreshness.label,
			});
			const payload = {
				...assessment,
				summary,
				steeringStatus: formatContextWatchSteeringStatus(assessment),
				autoCompact,
				operatorSignal,
				deterministicStop,
				deterministicStopHint,
				operatorAction,
				operatingCadence,
			};
			return {
				content: [{ type: "text", text: summary }],
				details: payload,
			};
		},
	});

	pi.registerTool({
		name: "context_watch_auto_resume_preview",
		label: "Context Watch Auto-Resume Preview",
		description:
			"Read-only preview of the auto-resume prompt from .project/handoff.json and .project/tasks.json. Never dispatches resume, compact, scheduler, remote, or automation.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const envelope = buildAutoResumePromptEnvelopeFromHandoff(
				readHandoffJson(ctx.cwd),
				config.handoffFreshMaxAgeMs,
				Date.now(),
				{ taskStatusById: readProjectTaskStatusById(ctx.cwd), preferredTaskIds: readProjectPreferredActiveTaskIds(ctx.cwd) },
			);
			const diagnosticsSummary = summarizeAutoResumePromptDiagnostics(envelope.diagnostics);
			const focusTasks = extractAutoResumePromptValue(envelope.prompt, "focusTasks", "none-listed");
			const staleFocus = extractAutoResumePromptValue(envelope.prompt, "staleFocus", "none");
			const staleFocusCount = envelope.diagnostics.staleFocusTasks?.length ?? 0;
			const summary = formatContextWatchAutoResumePreviewSummary({
				focusTasks,
				staleFocusCount,
				diagnosticsSummary,
			});
			return {
				content: [{ type: "text", text: summary }],
				details: {
					summary,
					prompt: envelope.prompt,
					focusTasks,
					staleFocus,
					diagnostics: envelope.diagnostics,
					diagnosticsSummary,
					effect: "none",
					mode: "read-only-preview",
					authorization: "none",
				},
			};
		},
	});

	pi.registerTool({
		name: "context_watch_checkpoint",
		label: "Context Watch Checkpoint",
		description:
			"Write a compact bounded local-slice handoff checkpoint to .project/handoff.json.",
		parameters: Type.Object({
			task_id: Type.Optional(Type.String()),
			context: Type.String(),
			validation: Type.Optional(Type.Array(Type.String())),
			commits: Type.Optional(Type.Array(Type.String())),
			next_actions: Type.Optional(Type.Array(Type.String())),
			blockers: Type.Optional(Type.Array(Type.String())),
			context_level: Type.Optional(Type.Union([
				Type.Literal("ok"),
				Type.Literal("warn"),
				Type.Literal("checkpoint"),
				Type.Literal("compact"),
			])),
			context_percent: Type.Optional(Type.Number()),
			recommendation: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as {
				task_id?: string;
				context?: string;
				validation?: string[];
				commits?: string[];
				next_actions?: string[];
				blockers?: string[];
				context_level?: "ok" | "warn" | "checkpoint" | "compact";
				context_percent?: number;
				recommendation?: string;
			};
			const result = writeLocalSliceHandoffCheckpoint(ctx.cwd, {
				timestampIso: new Date().toISOString(),
				taskId: p.task_id,
				context: String(p.context ?? ""),
				validation: p.validation,
				commits: p.commits,
				nextActions: p.next_actions,
				blockers: p.blockers,
				contextLevel: p.context_level,
				contextPercent: p.context_percent,
				recommendation: p.recommendation,
			});
			const details = {
				ok: result.ok,
				reason: result.reason,
				summary: result.summary,
				path: result.ok ? ".project/handoff.json" : undefined,
				jsonChars: result.jsonChars,
				maxJsonChars: result.maxJsonChars,
			};
			return {
				content: [{ type: "text", text: result.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "context_watch_bootstrap",
		label: "Context Watch Bootstrap",
		description:
			"Returns (or applies) a portable long-run context-watch preset patch (control-plane or agent-worker).",
		parameters: Type.Object({
			preset: Type.Optional(Type.String({ description: "control-plane | agent-worker" })),
			apply: Type.Optional(Type.Boolean()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as { preset?: string; apply?: boolean };
			if (p.apply) {
				const applied = applyPreset(ctx, p.preset);
				return {
					content: [{
						type: "text",
						text: JSON.stringify({ ...applied, applied: true, reloadRequired: false }, null, 2),
					}],
					details: { ...applied, applied: true, reloadRequired: false },
				};
			}
			const plan = buildContextWatchBootstrapPlan(p.preset);
			return {
				content: [{ type: "text", text: JSON.stringify({ ...plan, applied: false }, null, 2) }],
				details: { ...plan, applied: false },
			};
		},
	});

	pi.registerCommand("context-watch", {
		description: "Show/reset status, print bootstrap patch, or apply preset. Usage: /context-watch [status|reset|bootstrap [control-plane|agent-worker]|apply [control-plane|agent-worker]]",
		handler: async (args, ctx) => {
			const tokens = String(args ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
			const sub = tokens[0] ?? "status";
			if (sub === "reset") {
				lastAssessment = null;
				lastAnnouncedLevel = null;
				lastAnnouncedAt = 0;
				lastAutoCheckpointAt = 0;
				lastAutoCompactAt = 0;
				lastAutoResumeAt = 0;
				lastAutoResumeDecision = null;
				lastSteeringSignal = null;
				autoCompactInFlight = false;
				clearAutoCompactRetryTimer();
				consecutiveWarnCount = 0;
				compactDeferCount = 0;
				compactDeferWindowStartedAt = 0;
				antiParalysisNotifyCountInWindow = 0;
				lastAntiParalysisNotifyAt = 0;
				announceWindowStartAt = 0;
				announceCountInWindow = 0;
				lastDeterministicStopSignalAt = 0;
				ctx.ui.setStatus?.("context-watch-steering", "[ctx-steer] reset");
				ctx.ui.setStatus?.("context-watch-operator", "[ctx-op] reset");
				ctx.ui.notify("context-watch: state reset", "info");
				return;
			}

			if (sub === "bootstrap") {
				const plan = buildContextWatchBootstrapPlan(tokens[1]);
				ctx.ui.notify(
					[
						`context-watch bootstrap (${plan.preset})`,
						JSON.stringify(plan.patch, null, 2),
						...plan.notes.map((n) => `- ${n}`),
					].join("\n"),
					"info",
				);
				return;
			}

			if (sub === "apply") {
				const applied = applyPreset(ctx, tokens[1]);
				ctx.ui.notify(
					[
						`context-watch preset applied (${applied.preset})`,
						`settings: ${applied.settingsPath}`,
						"effective now for context-watchdog (no /reload required).",
						...applied.notes.map((n) => `- ${n}`),
					].join("\n"),
					"info",
				);
				return;
			}

			const assessment = buildAssessment(ctx, config, thresholdOverrides);
			lastAssessment = assessment;
			const autoCompact = currentAutoCompactState(ctx, assessment);
			const nowMs = Date.now();
			const operatorSignal = resolveContextWatchOperatorSignal({
				reloadRequired: isReloadRequiredForSourceUpdate(),
				handoffManualRefreshRequired: autoCompact.handoffManualRefreshRequired,
				signalNoiseExcessive: resolveContextWatchSignalNoiseExcessive(
					getAnnouncementsInWindow(nowMs),
					SIGNAL_NOISE_MAX_ANNOUNCEMENTS,
				),
				compactCheckpointPersistRequired: autoCompact.compactCheckpointPersistRecommended,
			});
			const deterministicStop = resolveContextWatchDeterministicStopSignal({
				assessmentLevel: assessment.level,
				operatorSignal,
			});
			const deterministicStopHint = describeContextWatchDeterministicStopHint(deterministicStop);
			const operatorAction = resolveContextWatchOperatorActionPlan({ deterministicStop, operatorSignal });
			const operatingCadence = resolveContextWatchOperatingCadence({
				assessmentLevel: assessment.level,
				handoffLastEventLevel: autoCompact.handoffLastEvent?.level,
			});
			ctx.ui.notify(
				[
					formatContextWatchCommandStatusSummary({
						level: assessment.level,
						percent: assessment.percent,
						action: assessment.action,
						autoCompactDecision: autoCompact.decision.reason,
						autoCompactTrigger: autoCompact.decision.trigger,
						retryScheduled: autoCompact.retryScheduled,
						calmCloseReady: autoCompact.calmCloseReady,
						checkpointEvidenceReady: autoCompact.checkpointEvidenceReady,
						operatorActionKind: operatorAction.kind,
						handoffFreshness: autoCompact.handoffFreshness.label,
					}),
					`recommendation=${assessment.recommendation}`,
					"details=context_watch_status structured payload",
				].join("\n"),
				assessment.severity,
			);
		},
	});
}
