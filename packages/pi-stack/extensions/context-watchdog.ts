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
	resolveContextWatchCompactStage,
	shouldAnnounceContextWatch,
	shouldAutoCheckpoint,
} from "./context-watchdog-policy";
import {
	applyWarnCadenceEscalation,
	describeContextWatchDeterministicStopHint,
	formatContextWatchSteeringStatus,
	resolveAutoCompactTimeoutPressureGuard,
	resolveContextWatchAutoCompactTriggerOrigin,
	resolveContextWatchDeterministicStopSignal,
	resolveContextWatchOperatingCadence,
	resolveContextWatchOperatorActionPlan,
	resolveContextWatchOperatorSignal,
	resolveContextWatchSignalNoiseExcessive,
	resolveContextWatchSteeringDispatch,
	resolveFinalTurnAnnouncementDispatch,
	shouldEmitDeterministicStopSignal,
	type ContextWatchAssessment,
	type ContextWatchDeterministicStopSignal,
	type ContextWatchdogLevel,
	type ContextWatchOperatingCadenceSignal,
	type ContextWatchOperatorSignal,
} from "./context-watchdog-operator-signals";
import {
	clearAutoResumeAfterReloadIntent,
	readAutoResumeAfterReloadIntent,
	withAutoResumeAfterReloadIntent,
	type AutoResumeAfterReloadIntent,
} from "./context-watchdog-reload-intent";
import {
	buildContextWatchOperatorBrief,
	readProjectPreferredActiveTaskIds,
	readProjectTaskDescriptionById,
	readProjectTasksArray,
	readProjectTaskStatusById,
	toOperatorTaskMnemonic,
} from "./context-watchdog-operator-brief";
import {
	assessLocalSliceHandoffBudget,
	buildAutoResumePromptEnvelopeFromHandoff,
	buildAutoResumePromptFromHandoff,
	buildLocalSliceHandoffCheckpoint,
	LOCAL_SLICE_HANDOFF_MAX_JSON_CHARS,
	handoffFreshnessAdvice,
	handoffRefreshMode,
	formatAutoResumeReloadHintShort,
	resolveHandoffBoardReconciliation,
	resolveHandoffFreshness,
	summarizeAutoResumePromptDiagnostics,
	toAgeSec,
	type AutoResumePromptDiagnostics,
	type HandoffFreshnessLabel,
	type HandoffRefreshMode,
	type LocalSliceHandoffCheckpointInput,
} from "./context-watchdog-handoff";
import {
	buildTurnBoundaryDecisionPacket,
	consumeContextPreloadPack,
	formatContextWatchAutoResumePreviewSummary,
	formatContextWatchContinuationReadinessSummary,
	formatContextWatchOneSliceCanaryPreviewSummary,
	formatContextWatchOneSliceOperatorPacketPreviewSummary,
	resolveContextWatchContinuationRecommendation,
	TURN_BOUNDARY_DIRECTION_PROMPT,
} from "./context-watchdog-continuation";
export {
	buildTurnBoundaryDecisionPacket,
	consumeContextPreloadPack,
	formatContextWatchAutoResumePreviewSummary,
	formatContextWatchContinuationReadinessSummary,
	formatContextWatchOneSliceCanaryPreviewSummary,
	formatContextWatchOneSliceOperatorPacketPreviewSummary,
	resolveContextWatchContinuationRecommendation,
	TURN_BOUNDARY_DIRECTION_PROMPT,
	type ContextPreloadProfile,
	type ContextPreloadConsumeReport,
	type ContextWatchContinuationRecommendationCode,
	type TurnBoundaryDecision,
	type TurnBoundaryDecisionPacket,
	type TurnBoundaryReasonCode,
} from "./context-watchdog-continuation";
import {
	buildAutoResumeDecisionSnapshot,
	describeAutoResumeDispatchReason,
	describeAutoResumeDispatchHint,
	composeAutoResumeSuppressionHint as composeAutoResumeSuppressionHintFromResume,
	resolvePostReloadPendingNotifyDecision,
	shouldNotifyAutoResumeSuppression,
	resolveAutoResumeDispatchDecision,
	resolveHandoffPrepDecision,
	resolvePreCompactReloadSignal,
	shouldEmitAutoResumeAfterCompact,
	shouldRefreshHandoffBeforeAutoCompact,
	type AutoResumeDecisionSnapshot,
	type AutoResumeDispatchReason,
	type HandoffPrepReason,
	type PostReloadPendingNotifyMemory,
	type PreCompactReloadSignal,
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
import { buildOneSliceLocalCanaryDispatchDecisionPacket, resolveOneSliceLocalCanaryPlan, reviewOneSliceLocalHumanConfirmedContract } from "./guardrails-core-unattended-continuation";
import {
	buildLocalContinuityAudit,
	formatLocalContinuityAuditSummary,
	localContinuityAuditReasons,
	localContinuityProtectedPaths,
} from "./guardrails-core-unattended-continuation-surface";
import { buildUnavailableGitDirtySnapshot, readGitDirtySnapshot } from "./guardrails-core-git-maintenance-surface";

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
	resolveContextWatchCompactStage,
	handoffFreshnessAdvice,
	handoffRefreshMode,
	formatAutoResumeReloadHintShort,
	resolveHandoffBoardReconciliation,
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
	resolvePreCompactReloadSignal,
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
	PreCompactReloadSignal,
};

export {
	applyWarnCadenceEscalation,
	describeContextWatchDeterministicStopHint,
	formatContextWatchSteeringStatus,
	resolveAutoCompactTimeoutPressureGuard,
	resolveContextWatchAutoCompactTriggerOrigin,
	resolveContextWatchDeterministicStopSignal,
	resolveContextWatchOperatingCadence,
	resolveContextWatchOperatorActionPlan,
	resolveContextWatchOperatorSignal,
	resolveContextWatchSignalNoiseExcessive,
	resolveContextWatchSteeringDispatch,
	resolveFinalTurnAnnouncementDispatch,
	shouldEmitDeterministicStopSignal,
} from "./context-watchdog-operator-signals";

export type {
	AutoCompactTimeoutPressureGuardDecision,
	AutoCompactTimeoutPressureGuardReason,
	ContextWatchAssessment,
	ContextWatchAutoCompactTriggerOrigin,
	ContextWatchDeterministicStopReason,
	ContextWatchDeterministicStopSignal,
	ContextWatchdogLevel,
	ContextWatchOperatingCadence,
	ContextWatchOperatingCadenceSignal,
	ContextWatchOperatorActionKind,
	ContextWatchOperatorActionPlan,
	ContextWatchOperatorSignal,
	ContextWatchOperatorSignalReason,
	ContextWatchSteeringDelivery,
	ContextWatchSteeringDispatch,
	FinalTurnAnnouncementDispatch,
	FinalTurnAnnouncementDispatchReason,
} from "./context-watchdog-operator-signals";

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

const CONTEXT_WATCHDOG_SOURCE_PATH = fileURLToPath(import.meta.url);

function readContextWatchdogSourceMtimeMs(): number | undefined {
	try {
		return statSync(CONTEXT_WATCHDOG_SOURCE_PATH).mtimeMs;
	} catch {
		return undefined;
	}
}

const DEFAULT_CONFIG: ContextWatchdogConfig = DEFAULT_CONTEXT_WATCHDOG_CONFIG;

export function isProviderRequestTimeoutError(message: string): boolean {
	const normalized = String(message ?? "").toLowerCase();
	return normalized.includes("request timed out") || normalized.includes("request timeout") || normalized.includes("timed out");
}

export function composeAutoResumeSuppressionHint(input: {
	reason: AutoResumeDispatchReason;
	timeoutPressureActive?: boolean;
	timeoutPressureCount?: number;
	timeoutPressureThreshold?: number;
}): string | undefined {
	return composeAutoResumeSuppressionHintFromResume(input);
}

function extractAutoResumePromptValue(prompt: string, label: string, fallback: string): string {
	const line = prompt.split(/\r?\n/).find((row) => row.startsWith(`${label}:`));
	return line ? line.slice(label.length + 1).trim() : fallback;
}

function summarizeFocusMnemonicsForPreview(values: string[]): string {
	if (!Array.isArray(values) || values.length <= 0) return "none";
	const maxItems = 2;
	const compact = values
		.slice(0, maxItems)
		.map((value) => value.trim())
		.filter(Boolean)
		.map((value) => value.length > 64 ? `${value.slice(0, 61)}...` : value);
	if (compact.length <= 0) return "none";
	const extra = Math.max(0, values.length - compact.length);
	return extra > 0 ? `${compact.join(", ")} (+${extra} more)` : compact.join(", ");
}

type ContextWatchGitDirtySignal = {
	available: boolean;
	clean: boolean | null;
	rowCount: number;
	summary: string;
	error?: "not-a-git-repo" | "git-dirty-snapshot-error";
};

function readContextWatchGitDirtySignal(cwd: string): ContextWatchGitDirtySignal {
	try {
		const snapshot = readGitDirtySnapshot(cwd);
		return {
			available: true,
			clean: snapshot.clean,
			rowCount: snapshot.rows.length,
			summary: snapshot.summary,
		};
	} catch (error) {
		const unavailable = buildUnavailableGitDirtySnapshot(error);
		return {
			available: unavailable.available,
			clean: unavailable.clean,
			rowCount: unavailable.rows.length,
			summary: unavailable.summary,
			error: unavailable.error,
		};
	}
}

type ContextWatchFreshnessSignals = {
	preload: ReturnType<typeof consumeContextPreloadPack>;
	preloadDecision: ReturnType<typeof consumeContextPreloadPack>["decision"];
	gitDirty: ContextWatchGitDirtySignal;
	dirtySignal: "clean" | "dirty" | "unknown";
};

function readContextWatchFreshnessSignals(
	cwd: string,
	profile: "control-plane-core" | "agent-worker-lean" | "swarm-scout-min" = "control-plane-core",
): ContextWatchFreshnessSignals {
	const preload = consumeContextPreloadPack(cwd, { profile });
	const gitDirty = readContextWatchGitDirtySignal(cwd);
	const dirtySignal = !gitDirty.available ? "unknown" : gitDirty.clean ? "clean" : "dirty";
	return {
		preload,
		preloadDecision: preload.decision,
		gitDirty,
		dirtySignal,
	};
}

export type HandoffGrowthMaturitySnapshot = {
	source: "handoff";
	decision?: "go" | "hold" | "needs-evidence";
	score?: number;
	recommendationCode?: string;
	freshness?: "fresh" | "stale" | "unknown";
};

export {
	clearAutoResumeAfterReloadIntent,
	readAutoResumeAfterReloadIntent,
	withAutoResumeAfterReloadIntent,
} from "./context-watchdog-reload-intent";

export type {
	AutoResumeAfterReloadIntent,
	AutoResumeAfterReloadIntentReason,
} from "./context-watchdog-reload-intent";

function resolveHandoffGrowthMaturitySnapshot(handoff: Record<string, unknown>): HandoffGrowthMaturitySnapshot | undefined {
	const contextWatch = handoff.context_watch && typeof handoff.context_watch === "object"
		? handoff.context_watch as Record<string, unknown>
		: undefined;
	const direct = contextWatch?.growth_maturity && typeof contextWatch.growth_maturity === "object"
		? contextWatch.growth_maturity as Record<string, unknown>
		: undefined;
	const events = Array.isArray(handoff.context_watch_events)
		? handoff.context_watch_events
		: [];
	const eventSnapshot = events
		.slice()
		.reverse()
		.find((entry) => entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).growth_maturity === "object");
	const eventGrowth = eventSnapshot && typeof eventSnapshot === "object"
		? (eventSnapshot as Record<string, unknown>).growth_maturity as Record<string, unknown>
		: undefined;
	const source = direct ?? eventGrowth;
	if (!source) return undefined;

	const decisionRaw = source.decision;
	const decision = decisionRaw === "go" || decisionRaw === "hold" || decisionRaw === "needs-evidence"
		? decisionRaw
		: undefined;
	const scoreRaw = source.score;
	const score = typeof scoreRaw === "number" && Number.isFinite(scoreRaw)
		? Math.max(0, Math.min(100, Math.round(scoreRaw)))
		: undefined;
	const recommendationCode = typeof source.recommendationCode === "string" && source.recommendationCode.trim().length > 0
		? source.recommendationCode.trim()
		: undefined;
	if (!decision && score === undefined && !recommendationCode) return undefined;
	return {
		source: "handoff",
		decision,
		score,
		recommendationCode,
	};
}

type AfkMaterialReadinessDecision = "continue" | "seed-backlog" | "blocked";

interface AfkMaterialReadinessSnapshot {
	decision: AfkMaterialReadinessDecision;
	recommendationCode:
		| "afk-material-continue-stock-healthy"
		| "afk-material-seed-backlog-low-stock"
		| "afk-material-blocked-focus-invalid";
	nextAction: string;
	blockedReasons: string[];
	stock: {
		minReadySlices: number;
		targetSlices: number;
		localSafeCount: number;
		validationKnownCount: number;
	};
}

function taskHasProtectedSignalForAfkMaterial(task: { description?: unknown; files?: unknown }): boolean {
	const files = Array.isArray(task.files) ? task.files.filter((item): item is string => typeof item === "string") : [];
	const haystack = [typeof task.description === "string" ? task.description : "", ...files].join("\n").toLowerCase();
	return /(\.github\/|\.obsidian\/|\.pi\/settings\.json|\bgithub actions\b|\bremote\b|\bpublish\b|https?:\/\/|\bci\b)/i.test(haystack);
}

function taskHasRiskSignalForAfkMaterial(task: { description?: unknown; notes?: unknown; acceptance_criteria?: unknown; files?: unknown }): boolean {
	if (taskHasProtectedSignalForAfkMaterial(task)) return true;
	const files = Array.isArray(task.files) ? task.files.filter((item): item is string => typeof item === "string") : [];
	if (files.length >= 9) return true;
	const acceptance = Array.isArray(task.acceptance_criteria)
		? task.acceptance_criteria.filter((item): item is string => typeof item === "string")
		: [];
	const text = [
		typeof task.description === "string" ? task.description : "",
		typeof task.notes === "string" ? task.notes : "",
		...acceptance,
		...files,
	].join("\n").toLowerCase();
	return /\b(delete|destroy|drop\s+table|rm\s+-rf|force\s+push|destructive|irreversible|dangerous)\b/i.test(text);
}

function taskValidationGateKnownForAfkMaterial(task: { description?: unknown; acceptance_criteria?: unknown; files?: unknown }): boolean {
	const files = Array.isArray(task.files) ? task.files.filter((item): item is string => typeof item === "string") : [];
	const acceptance = Array.isArray(task.acceptance_criteria)
		? task.acceptance_criteria.filter((item): item is string => typeof item === "string")
		: [];
	const text = [typeof task.description === "string" ? task.description : "", ...acceptance, ...files].join("\n").toLowerCase();
	return /(smoke|test|spec|vitest|marker-check|inspection|lint|typecheck|build)/i.test(text);
}

function buildAfkMaterialReadinessSnapshot(cwd: string, focusTasks: string, minReadySlices = 3, targetSlices = 7): AfkMaterialReadinessSnapshot {
	const tasks = readProjectTasksArray(cwd)
		.filter((task): task is Record<string, unknown> => Boolean(task) && typeof task === "object");
	const candidates = tasks.filter((task) => {
		const status = typeof task.status === "string" ? task.status : "";
		if (status !== "in-progress" && status !== "planned") return false;
		if (taskHasProtectedSignalForAfkMaterial(task)) return false;
		if (taskHasRiskSignalForAfkMaterial(task)) return false;
		return true;
	});
	const validationKnown = candidates.filter((task) => taskValidationGateKnownForAfkMaterial(task));

	const focusIds = focusTasks === "none-listed"
		? []
		: focusTasks
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
	const focusMap = new Map(
		tasks
			.map((task) => {
				const id = typeof task.id === "string" ? task.id.trim() : "";
				return id ? [id, task] as const : undefined;
			})
			.filter((item): item is readonly [string, Record<string, unknown>] => Boolean(item)),
	);
	const blockedReasons: string[] = [];
	if (focusIds.length <= 0) blockedReasons.push("focus-missing");
	for (const id of focusIds) {
		const task = focusMap.get(id) ?? focusMap.get(id.toUpperCase());
		if (!task) {
			blockedReasons.push("focus-task-not-found");
			continue;
		}
		if (!taskValidationGateKnownForAfkMaterial(task)) blockedReasons.push("focus-validation-unknown");
	}

	const minReady = Math.max(1, Math.min(20, Math.floor(minReadySlices)));
	const targetReady = Math.max(minReady, Math.min(20, Math.floor(targetSlices)));

	if (blockedReasons.length > 0) {
		return {
			decision: "blocked",
			recommendationCode: "afk-material-blocked-focus-invalid",
			nextAction: "fix focus/validation before AFK continuation.",
			blockedReasons: [...new Set(blockedReasons)],
			stock: {
				minReadySlices: minReady,
				targetSlices: targetReady,
				localSafeCount: candidates.length,
				validationKnownCount: validationKnown.length,
			},
		};
	}

	if (validationKnown.length < minReady) {
		return {
			decision: "seed-backlog",
			recommendationCode: "afk-material-seed-backlog-low-stock",
			nextAction: "seed backlog now (brainstorm packet + seed preview + human decision).",
			blockedReasons: [],
			stock: {
				minReadySlices: minReady,
				targetSlices: targetReady,
				localSafeCount: candidates.length,
				validationKnownCount: validationKnown.length,
			},
		};
	}

	return {
		decision: "continue",
		recommendationCode: "afk-material-continue-stock-healthy",
		nextAction: "continue bounded AFK slice; stock is healthy.",
		blockedReasons: [],
		stock: {
			minReadySlices: minReady,
			targetSlices: targetReady,
			localSafeCount: candidates.length,
			validationKnownCount: validationKnown.length,
		},
	};
}

export function formatTimeoutPressureSummary(input: {
	active?: boolean;
	count?: number;
	threshold?: number;
	windowMs?: number;
} | undefined): string {
	if (!input || input.active !== true) return "none";
	const count = Math.max(0, Math.floor(Number(input.count ?? 0)));
	const threshold = Math.max(1, Math.floor(Number(input.threshold ?? 2)));
	const windowSec = Math.max(1, Math.floor(Number(input.windowMs ?? 600_000) / 1000));
	return `${count}/${threshold}@${windowSec}s`;
}

export function formatContextWatchStatusToolSummary(input: {
	level: ContextWatchdogLevel;
	percent?: number;
	action?: string;
	autoCompactDecision?: string;
	operatorActionKind?: string;
	operatingCadence?: string;
	handoffFreshness?: HandoffFreshnessLabel;
	handoffAgeSec?: number;
	handoffFreshThresholdSec?: number;
	reloadGate?: string;
	timeoutPressureSummary?: string;
	postReloadResume?: "pending";
}): string {
	const handoffAgeSec = Number.isFinite(Number(input.handoffAgeSec))
		? Math.max(0, Math.floor(Number(input.handoffAgeSec)))
		: undefined;
	const handoffFreshThresholdSec = Number.isFinite(Number(input.handoffFreshThresholdSec))
		? Math.max(0, Math.floor(Number(input.handoffFreshThresholdSec)))
		: undefined;
	return [
		"context-watch-status:",
		`level=${input.level}`,
		input.percent !== undefined ? `percent=${Math.floor(Number(input.percent))}` : undefined,
		input.action ? `action=${input.action}` : undefined,
		input.autoCompactDecision ? `autoCompact=${input.autoCompactDecision}` : undefined,
		input.operatorActionKind ? `operator=${input.operatorActionKind}` : undefined,
		input.operatingCadence ? `cadence=${input.operatingCadence}` : undefined,
		input.handoffFreshness ? `handoff=${input.handoffFreshness}` : undefined,
		handoffAgeSec !== undefined && handoffFreshThresholdSec !== undefined
			? `handoffAgeSec=${handoffAgeSec}/${handoffFreshThresholdSec}`
			: undefined,
		input.reloadGate ? `reloadGate=${input.reloadGate}` : undefined,
		input.timeoutPressureSummary ? `timeoutPressure=${input.timeoutPressureSummary}` : undefined,
		input.postReloadResume ? `postReloadResume=${input.postReloadResume}` : undefined,
	].filter(Boolean).join(" ");
}

export function formatContextWatchCompactStageStatusSummary(input: {
	stage: string;
	level: ContextWatchdogLevel;
	checkpointPct: number;
	compactPct: number;
	reloadGate: string;
	nextAction: string;
}): string {
	return [
		"context-watch-compact-stage-status:",
		`stage=${input.stage}`,
		`level=${input.level}`,
		`checkpoint=${Math.floor(Number(input.checkpointPct))}`,
		`compact=${Math.floor(Number(input.compactPct))}`,
		`reloadGate=${input.reloadGate}`,
		`next=${input.nextAction.replace(/\s+/g, "_")}`,
		"authorization=none",
	].join(" ");
}

export function resolveContextWatchAdaptiveStatusSummary(input: {
	level: ContextWatchdogLevel;
	summary: string;
	nowMs: number;
	lastLevel?: ContextWatchdogLevel;
	lastEmittedAtMs?: number;
	cooldownMs?: number;
}): {
	summary: string;
	mode: "full" | "compact";
	cooldownRemainingSec: number;
} {
	const cooldownMs = Number.isFinite(Number(input.cooldownMs))
		? Math.max(1_000, Math.floor(Number(input.cooldownMs)))
		: 90_000;
	const shapeEligible = input.level === "warn" || input.level === "checkpoint";
	if (!shapeEligible) {
		return {
			summary: input.summary,
			mode: "full",
			cooldownRemainingSec: 0,
		};
	}
	const lastAt = Number.isFinite(Number(input.lastEmittedAtMs))
		? Math.max(0, Math.floor(Number(input.lastEmittedAtMs)))
		: 0;
	const elapsedMs = lastAt > 0 ? Math.max(0, Math.floor(input.nowMs - lastAt)) : cooldownMs;
	if (input.lastLevel === input.level && elapsedMs < cooldownMs) {
		const remainingSec = Math.max(1, Math.ceil((cooldownMs - elapsedMs) / 1000));
		return {
			summary: `context-watch-status: level=${input.level} mode=compact-output cooldown=active remainingSec=${remainingSec}`,
			mode: "compact",
			cooldownRemainingSec: remainingSec,
		};
	}
	return {
		summary: input.summary,
		mode: "full",
		cooldownRemainingSec: 0,
	};
}

export function formatContextWatchCommandStatusSummary(input: {
	level: ContextWatchdogLevel;
	percent?: number;
	action?: string;
	autoCompactDecision?: string;
	autoCompactTrigger?: boolean;
	autoCompactTriggerOrigin?: ContextWatchAutoCompactTriggerOrigin;
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
		input.autoCompactTriggerOrigin && input.autoCompactTriggerOrigin !== "none" ? `triggerOrigin=${input.autoCompactTriggerOrigin}` : undefined,
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
		const growthDecision = input.growthDecision;
		const growthScore = Number.isFinite(input.growthScore) ? Math.max(0, Math.min(100, Math.round(Number(input.growthScore)))) : undefined;
		const growthCompact = [
			growthDecision ? `growthDecision=${growthDecision}` : undefined,
			growthScore !== undefined ? `growthScore=${growthScore}` : undefined,
		].filter(Boolean).join(" ");
		return {
			ok: true,
			summary: [
				`context-watch-checkpoint: ok=yes task=${taskId} path=.project/handoff.json`,
				growthCompact,
			].filter(Boolean).join(" "),
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

function isContextWindowOverflowErrorMessage(message: string): boolean {
	const text = String(message ?? "").toLowerCase();
	return text.includes("input exceeds the context window")
		|| text.includes("exceeds the context window")
		|| text.includes("context window of this model");
}

function applyEmergencyContextWindowFallbackConfig(
	config: ContextWatchdogConfig,
): ContextWatchdogConfig {
	const currentCheckpoint = Number.isFinite(config.checkpointPct) ? Number(config.checkpointPct) : 68;
	const currentCompact = Number.isFinite(config.compactPct) ? Number(config.compactPct) : 72;
	return {
		...config,
		checkpointPct: Math.min(currentCheckpoint, 65),
		compactPct: Math.min(currentCompact, 69),
	};
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
	let lastStatusToolLevel: ContextWatchdogLevel | undefined;
	let lastStatusToolAt = 0;
	let lastAutoCheckpointAt = 0;
	let lastAutoCompactAt = 0;
	let lastAutoResumeAt = 0;
	let lastAutoResumeDecision: (AutoResumeDecisionSnapshot & {
		promptDiagnostics?: AutoResumePromptDiagnostics;
	}) | null = null;
	let postReloadPendingNotifyMemory: PostReloadPendingNotifyMemory = {};
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
	let lastPreCompactPrepNotifyAt = 0;
	let announceWindowStartAt = 0;
	let announceCountInWindow = 0;
	let finalTurnSuppressionCountInWindow = 0;
	let lastDeterministicStopSignalAt = 0;
	let timeoutPressureWindowStartedAt = 0;
	let timeoutPressureCount = 0;
	let timeoutPressureLastSeenAt = 0;
	let timeoutPressureLastMessage = "";
	const SIGNAL_NOISE_WINDOW_MS = 10 * 60 * 1000;
	const SIGNAL_NOISE_MAX_ANNOUNCEMENTS = 4;
	const FINAL_TURN_CLOSE_HEADROOM_PCT = 10;
	const CALM_CLOSE_DEFER_THRESHOLD = 3;
	const ANTI_PARALYSIS_GRACE_WINDOW_MS = 2 * 60 * 1000;
	const ANTI_PARALYSIS_NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;
	const ANTI_PARALYSIS_MAX_NOTIFIES_PER_WINDOW = 1;
	const TIMEOUT_PRESSURE_WINDOW_MS = 10 * 60 * 1000;
	const TIMEOUT_PRESSURE_THRESHOLD = 2;
	const POST_RELOAD_PENDING_NOTIFY_MIN_COOLDOWN_MS = 5 * 60 * 1000;

	const getAnnouncementsInWindow = (nowMs: number): number => {
		if (announceWindowStartAt <= 0) return 0;
		if ((nowMs - announceWindowStartAt) > SIGNAL_NOISE_WINDOW_MS) return 0;
		return announceCountInWindow;
	};

	const markAnnouncement = (nowMs: number): void => {
		if (announceWindowStartAt <= 0 || (nowMs - announceWindowStartAt) > SIGNAL_NOISE_WINDOW_MS) {
			announceWindowStartAt = nowMs;
			announceCountInWindow = 0;
			finalTurnSuppressionCountInWindow = 0;
		}
		announceCountInWindow += 1;
	};

	const markFinalTurnSuppression = (nowMs: number): void => {
		if (announceWindowStartAt <= 0 || (nowMs - announceWindowStartAt) > SIGNAL_NOISE_WINDOW_MS) {
			announceWindowStartAt = nowMs;
			announceCountInWindow = 0;
			finalTurnSuppressionCountInWindow = 0;
		}
		finalTurnSuppressionCountInWindow += 1;
	};

	const getFinalTurnSuppressionsInWindow = (nowMs: number): number => {
		if (announceWindowStartAt <= 0) return 0;
		if ((nowMs - announceWindowStartAt) > SIGNAL_NOISE_WINDOW_MS) return 0;
		return finalTurnSuppressionCountInWindow;
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

	const decayTimeoutPressureWindow = (nowMs: number) => {
		if (timeoutPressureWindowStartedAt <= 0) return;
		if ((nowMs - timeoutPressureWindowStartedAt) <= TIMEOUT_PRESSURE_WINDOW_MS) return;
		timeoutPressureWindowStartedAt = 0;
		timeoutPressureCount = 0;
	};

	const readTimeoutPressureState = (nowMs: number) => {
		decayTimeoutPressureWindow(nowMs);
		const active = timeoutPressureCount >= TIMEOUT_PRESSURE_THRESHOLD;
		const ageMs = timeoutPressureLastSeenAt > 0
			? Math.max(0, nowMs - timeoutPressureLastSeenAt)
			: undefined;
		return {
			active,
			count: timeoutPressureCount,
			threshold: TIMEOUT_PRESSURE_THRESHOLD,
			windowMs: TIMEOUT_PRESSURE_WINDOW_MS,
			windowStartedAtMs: timeoutPressureWindowStartedAt,
			lastSeenAtMs: timeoutPressureLastSeenAt,
			ageMs,
			lastMessage: timeoutPressureLastMessage,
		};
	};

	const recordTimeoutPressure = (message: string, nowMs: number) => {
		if (!isProviderRequestTimeoutError(message)) {
			return { matched: false, state: readTimeoutPressureState(nowMs) };
		}
		if (timeoutPressureWindowStartedAt <= 0 || (nowMs - timeoutPressureWindowStartedAt) > TIMEOUT_PRESSURE_WINDOW_MS) {
			timeoutPressureWindowStartedAt = nowMs;
			timeoutPressureCount = 0;
		}
		timeoutPressureCount += 1;
		timeoutPressureLastSeenAt = nowMs;
		timeoutPressureLastMessage = String(message ?? "").slice(0, 240);
		return { matched: true, state: readTimeoutPressureState(nowMs) };
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
		const timeoutPressure = readTimeoutPressureState(now);
		let handoffPath: string | undefined;
		const reloadRequiredAtRunStart = isReloadRequiredForSourceUpdate();
		const handoffForPostReloadResume = readHandoffJson(ctx.cwd);
		const pendingAutoResumeAfterReload = readAutoResumeAfterReloadIntent(handoffForPostReloadResume);
		if (!pendingAutoResumeAfterReload) {
			postReloadPendingNotifyMemory = {};
		}
		if (pendingAutoResumeAfterReload && !reloadRequiredAtRunStart) {
			const hasPendingMessages = ctx.hasPendingMessages();
			const queuedLaneIntents = readDeferredLaneQueueCount(ctx.cwd);
			let handoffForDispatch = handoffForPostReloadResume;
			const taskStatusById = readProjectTaskStatusById(ctx.cwd);
			const preferredTaskIds = readProjectPreferredActiveTaskIds(ctx.cwd, 3);
			let handoffBoardReconciliation = resolveHandoffBoardReconciliation({
				handoff: handoffForDispatch,
				taskStatusById,
				nowMs: now,
				maxFreshAgeMs: config.handoffFreshMaxAgeMs,
			});
			if (!handoffBoardReconciliation.ok) {
				const reconcile = reconcileAutoResumeHandoffFocus({
					handoff: handoffForDispatch,
					taskStatusById,
					preferredTaskIds,
					maxTasks: 3,
				});
				if (reconcile.changed) {
					handoffForDispatch = {
						...handoffForDispatch,
						timestamp: new Date(now).toISOString(),
						current_tasks: reconcile.nextFocus,
					};
					writeHandoffJson(ctx.cwd, handoffForDispatch);
					handoffBoardReconciliation = resolveHandoffBoardReconciliation({
						handoff: handoffForDispatch,
						taskStatusById,
						nowMs: now,
						maxFreshAgeMs: config.handoffFreshMaxAgeMs,
					});
				}
			}
			const handoffEvent = latestContextWatchEvent(handoffForDispatch);
			const checkpointEvidenceReady = resolveCheckpointEvidenceReadyForCalmClose({
				handoffLastEventLevel: handoffEvent?.level,
				handoffLastEventAgeMs: contextWatchEventAgeMs(handoffEvent, now),
				maxCheckpointAgeMs: config.handoffFreshMaxAgeMs,
			});
			const autoResumeDecision = resolveAutoResumeDispatchDecision({
				autoResumeReady: true,
				reloadRequired: false,
				checkpointEvidenceReady,
				handoffBoardReconciled: handoffBoardReconciliation.ok,
				hasPendingMessages,
				hasRecentSteerInput: false,
				queuedLaneIntents,
			});
			const autoResumeSnapshot = buildAutoResumeDecisionSnapshot({
				nowMs: now,
				decision: autoResumeDecision,
				reloadRequired: false,
				checkpointEvidenceReady,
				handoffBoardReconciled: handoffBoardReconciliation.ok,
				handoffBoardReconciliationSummary: handoffBoardReconciliation.summary,
				hasPendingMessages,
				hasRecentSteerInput: false,
				queuedLaneIntents,
				timeoutPressureActive: timeoutPressure.active,
				timeoutPressureCount: timeoutPressure.count,
				timeoutPressureThreshold: timeoutPressure.threshold,
			});
			if (autoResumeDecision.shouldDispatch) {
				lastAutoResumeAt = now;
				postReloadPendingNotifyMemory = {};
				const resumeEnvelope = buildAutoResumePromptEnvelopeFromHandoff(
					handoffForDispatch,
					config.handoffFreshMaxAgeMs,
					now,
					{ taskStatusById, preferredTaskIds: preferredTaskIds.slice(0, 1) },
				);
				autoResumeSnapshot.promptDiagnostics = resumeEnvelope.diagnostics;
				const clearedHandoff = clearAutoResumeAfterReloadIntent(handoffForDispatch);
				writeHandoffJson(ctx.cwd, clearedHandoff);
				(pi as unknown as { appendEntry?: (type: string, payload: unknown) => void }).appendEntry?.(
					"context-watchdog.auto-resume-post-reload-dispatch",
					{
						atIso: autoResumeSnapshot.atIso,
						reason: pendingAutoResumeAfterReload.reason,
						focusTasks: pendingAutoResumeAfterReload.focusTasks,
						diagnosticsSummary: summarizeAutoResumePromptDiagnostics(resumeEnvelope.diagnostics),
						preview: resumeEnvelope.prompt.slice(0, 240),
					},
				);
				pi.sendUserMessage(resumeEnvelope.prompt, { deliverAs: "followUp" });
				if (config.notify) {
					ctx.ui.notify("context-watch: post-reload auto resume queued", "info");
				}
			} else {
				const pendingNotifyDecision = resolvePostReloadPendingNotifyDecision({
					nowMs: now,
					intentCreatedAtIso: pendingAutoResumeAfterReload.createdAtIso,
					reason: autoResumeSnapshot.reason,
					previous: postReloadPendingNotifyMemory,
					cooldownMs: config.cooldownMs,
					minCooldownMs: POST_RELOAD_PENDING_NOTIFY_MIN_COOLDOWN_MS,
				});
				if (pendingNotifyDecision.shouldEmit) {
					(pi as unknown as { appendEntry?: (type: string, payload: unknown) => void }).appendEntry?.(
						"context-watchdog.auto-resume-post-reload-pending",
						{
							atIso: autoResumeSnapshot.atIso,
							reason: autoResumeSnapshot.reason,
							hint: autoResumeSnapshot.hint,
							hasPendingMessages: autoResumeSnapshot.hasPendingMessages,
							queuedLaneIntents: autoResumeSnapshot.queuedLaneIntents,
							checkpointEvidenceReady: autoResumeSnapshot.checkpointEvidenceReady,
							handoffBoardReconciled: autoResumeSnapshot.handoffBoardReconciled,
							handoffBoardReconciliationSummary: autoResumeSnapshot.handoffBoardReconciliationSummary,
						},
					);
					if (config.notify && shouldNotifyAutoResumeSuppression(autoResumeSnapshot.reason)) {
						ctx.ui.notify(
							`context-watch: post-reload auto resume pending (${autoResumeSnapshot.reason})${autoResumeSnapshot.hint ? ` · ${autoResumeSnapshot.hint}` : ""}`,
							"warning",
						);
					}
					postReloadPendingNotifyMemory = pendingNotifyDecision.next;
				}
			}
			lastAutoResumeDecision = autoResumeSnapshot;
		}

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

		const handoffForCalmClose = readHandoffJson(ctx.cwd);
		const handoffEventForCalmClose = latestContextWatchEvent(handoffForCalmClose);
		const handoffEventAgeForCalmClose = contextWatchEventAgeMs(handoffEventForCalmClose, now);
		const checkpointEvidenceReadyForAutoCompact = resolveCheckpointEvidenceReadyForCalmClose({
			handoffLastEventLevel: handoffEventForCalmClose?.level,
			handoffLastEventAgeMs: handoffEventAgeForCalmClose,
			maxCheckpointAgeMs: config.handoffFreshMaxAgeMs,
		});
		const autoCompactCandidateLevel = assessment.level === "compact" || assessment.level === "checkpoint";
		const autoCompactState = buildAutoCompactDiagnostics(assessment, config, {
			nowMs: now,
			lastAutoCompactAt,
			inFlight: autoCompactInFlight,
			isIdle: ctx.isIdle(),
			hasPendingMessages: ctx.hasPendingMessages(),
			checkpointEvidenceReady: checkpointEvidenceReadyForAutoCompact,
			reason,
		}, AUTO_COMPACT_RETRY_DELAY_MS);
		if (
			autoCompactCandidateLevel
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
			lastPreCompactPrepNotifyAt = 0;
		}
		const preCompactIdlePrep = resolvePreCompactIdlePrepDispatch({
			assessmentLevel: assessment.level,
			decisionReason: autoCompactState.decision.reason,
			nowMs: now,
			lastNotifyAtMs: lastPreCompactPrepNotifyAt,
			cooldownMs: config.cooldownMs,
			timeoutPressureActive: timeoutPressure.active,
		});
		if (preCompactIdlePrep.shouldNotify) {
			lastPreCompactPrepNotifyAt = now;
		}
		if (preCompactIdlePrep.shouldNotify || timeoutPressure.active) {
			(pi as unknown as { appendEntry?: (type: string, payload: unknown) => void }).appendEntry?.(
				"context-watchdog.pre-compact-idle-prep",
				{
					atIso: new Date(now).toISOString(),
					assessmentLevel: assessment.level,
					decisionReason: autoCompactState.decision.reason,
					dispatchReason: preCompactIdlePrep.reason,
					recommendation: preCompactIdlePrep.recommendation,
					compactDeferCount,
					timeoutPressure,
				},
			);
		}
		if (config.notify && preCompactIdlePrep.shouldNotify) {
			ctx.ui.notify(preCompactIdlePrep.recommendation ?? "context-watch: keep session idle so auto-compact can proceed.", "info");
		}
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
		const reloadRequired = reloadRequiredAtRunStart;
		const preCompactReloadSignal = resolvePreCompactReloadSignal({
			assessmentLevel: assessment.level,
			reloadRequired,
		});
		const operatorSignal = resolveContextWatchOperatorSignal({
			reloadRequired,
			handoffManualRefreshRequired: handoffRefreshModeForSignal === "manual",
			signalNoiseExcessive: resolveContextWatchSignalNoiseExcessive(
				getAnnouncementsInWindow(now),
				SIGNAL_NOISE_MAX_ANNOUNCEMENTS,
			),
			compactCheckpointPersistRequired: compactCheckpointPersistence.shouldPersist,
			timeoutPressureActive: timeoutPressure.active && autoCompactCandidateLevel,
		});
		const deterministicStop = resolveContextWatchDeterministicStopSignal({
			assessmentLevel: assessment.level,
			operatorSignal,
			autoCompactDecision: autoCompactState.decision.reason,
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
					preCompactReloadSignal,
					timeoutPressure,
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
			checkpointEvidenceReady: checkpointEvidenceReadyForAutoCompact,
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
		const timeoutPressureGuard = resolveAutoCompactTimeoutPressureGuard({
			assessmentLevel: assessment.level,
			autoCompactTrigger: autoCompactState.decision.trigger,
			timeoutPressureActive: timeoutPressure.active,
		});
		if (autoCompactState.decision.trigger && !timeoutPressureGuard.blocked) {
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
					let handoffAfterCompact = readHandoffJson(ctx.cwd);
					const handoffEventAfterCompact = latestContextWatchEvent(handoffAfterCompact);
					const handoffEventAgeAfterCompact = contextWatchEventAgeMs(handoffEventAfterCompact, nowAfterCompact);
					const checkpointEvidenceReady = resolveCheckpointEvidenceReadyForCalmClose({
						handoffLastEventLevel: handoffEventAfterCompact?.level,
						handoffLastEventAgeMs: handoffEventAgeAfterCompact,
						maxCheckpointAgeMs: config.handoffFreshMaxAgeMs,
					});
					const taskStatusById = readProjectTaskStatusById(ctx.cwd);
					const preferredTaskIds = readProjectPreferredActiveTaskIds(ctx.cwd, 3);
					let handoffBoardReconciliation = resolveHandoffBoardReconciliation({
						handoff: handoffAfterCompact,
						taskStatusById,
						nowMs: nowAfterCompact,
						maxFreshAgeMs: config.handoffFreshMaxAgeMs,
					});
					if (!handoffBoardReconciliation.ok) {
						const reconcile = reconcileAutoResumeHandoffFocus({
							handoff: handoffAfterCompact,
							taskStatusById,
							preferredTaskIds,
							maxTasks: 3,
						});
						if (reconcile.changed) {
							handoffAfterCompact = {
								...handoffAfterCompact,
								timestamp: new Date(nowAfterCompact).toISOString(),
								current_tasks: reconcile.nextFocus,
							};
							writeHandoffJson(ctx.cwd, handoffAfterCompact);
							handoffBoardReconciliation = resolveHandoffBoardReconciliation({
								handoff: handoffAfterCompact,
								taskStatusById,
								nowMs: nowAfterCompact,
								maxFreshAgeMs: config.handoffFreshMaxAgeMs,
							});
							(pi as unknown as { appendEntry?: (type: string, payload: unknown) => void }).appendEntry?.(
								"context-watchdog.auto-resume-handoff-reconciled",
								{
									atIso: new Date(nowAfterCompact).toISOString(),
									reason: reconcile.reason,
									previousFocus: reconcile.previousFocus,
									nextFocus: reconcile.nextFocus,
									droppedFocus: reconcile.droppedFocus,
									handoffBoardReconciliationSummary: handoffBoardReconciliation.summary,
								},
							);
							if (config.notify) {
								ctx.ui.notify(
									`context-watch: handoff focus reconciled before auto-resume (${reconcile.reason})`,
									"info",
								);
							}
						}
					}
					const timeoutPressureAfterCompact = readTimeoutPressureState(nowAfterCompact);
					const autoResumeReady = shouldEmitAutoResumeAfterCompact(config, nowAfterCompact, lastAutoResumeAt);
					const reloadRequired = isReloadRequiredForSourceUpdate();
					const autoResumeDecision = resolveAutoResumeDispatchDecision({
						autoResumeReady,
						reloadRequired,
						checkpointEvidenceReady,
						handoffBoardReconciled: handoffBoardReconciliation.ok,
						hasPendingMessages,
						hasRecentSteerInput,
						queuedLaneIntents,
					});
					const autoResumeSnapshot: AutoResumeDecisionSnapshot & {
						promptDiagnostics?: AutoResumePromptDiagnostics;
					} = buildAutoResumeDecisionSnapshot({
						nowMs: nowAfterCompact,
						decision: autoResumeDecision,
						reloadRequired,
						checkpointEvidenceReady,
						handoffBoardReconciled: handoffBoardReconciliation.ok,
						handoffBoardReconciliationSummary: handoffBoardReconciliation.summary,
						hasPendingMessages,
						hasRecentSteerInput,
						queuedLaneIntents,
						timeoutPressureActive: timeoutPressureAfterCompact.active,
						timeoutPressureCount: timeoutPressureAfterCompact.count,
						timeoutPressureThreshold: timeoutPressureAfterCompact.threshold,
					});
					if (autoResumeDecision.shouldDispatch) {
						lastAutoResumeAt = nowAfterCompact;
						handoffAfterCompact = clearAutoResumeAfterReloadIntent(handoffAfterCompact);
						writeHandoffJson(ctx.cwd, handoffAfterCompact);
						const resumeEnvelope = buildAutoResumePromptEnvelopeFromHandoff(
							handoffAfterCompact,
							config.handoffFreshMaxAgeMs,
							Date.now(),
							{ taskStatusById, preferredTaskIds: preferredTaskIds.slice(0, 1) },
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
						if (autoResumeSnapshot.reason === "reload-required") {
							const focusTasks = Array.isArray(handoffAfterCompact.current_tasks)
								? handoffAfterCompact.current_tasks
									.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
									.slice(0, 3)
								: [];
							handoffAfterCompact = withAutoResumeAfterReloadIntent(handoffAfterCompact, {
								pending: true,
								createdAtIso: autoResumeSnapshot.atIso,
								reason: "reload-required-after-compact",
								focusTasks,
							});
							writeHandoffJson(ctx.cwd, handoffAfterCompact);
							(pi as unknown as { appendEntry?: (type: string, payload: unknown) => void }).appendEntry?.(
								"context-watchdog.auto-resume-deferred-reload",
								{
									atIso: autoResumeSnapshot.atIso,
									reason: "reload-required-after-compact",
									focusTasks,
									nextAction: "run /reload to dispatch deferred auto-resume from handoff",
								},
							);
						}
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
								handoffBoardReconciled: autoResumeSnapshot.handoffBoardReconciled,
								handoffBoardReconciliationSummary: autoResumeSnapshot.handoffBoardReconciliationSummary,
								timeoutPressureActive: autoResumeSnapshot.timeoutPressureActive,
								timeoutPressureCount: autoResumeSnapshot.timeoutPressureCount,
								timeoutPressureThreshold: autoResumeSnapshot.timeoutPressureThreshold,
								timeoutPressureHint: autoResumeSnapshot.timeoutPressureHint,
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
					const nowOnError = Date.now();
					const message = String(error?.message ?? "unknown-error");
					const timeoutPressureEvent = recordTimeoutPressure(message, nowOnError);
					if (timeoutPressureEvent.matched) {
						(pi as unknown as { appendEntry?: (type: string, payload: unknown) => void }).appendEntry?.(
							"context-watchdog.timeout-pressure",
							{
								atIso: new Date(nowOnError).toISOString(),
								message,
								timeoutPressure: timeoutPressureEvent.state,
							},
						);
					}
					if (isContextWindowOverflowErrorMessage(message)) {
						config = applyEmergencyContextWindowFallbackConfig(config);
						(pi as unknown as { appendEntry?: (type: string, payload: unknown) => void }).appendEntry?.(
							"context-watchdog.context-window-overflow-fallback",
							{
								atIso: new Date(nowOnError).toISOString(),
								message,
								fallbackCheckpointPct: config.checkpointPct,
								fallbackCompactPct: config.compactPct,
							},
						);
						ctx.ui.notify(
							"context-watch: provider context-window overflow detected; emergency thresholds enabled (checkpoint<=65 / compact<=69) for this session.",
							"warning",
						);
					}
					ctx.ui.notify(`context-watch: auto compact failed (${message})`, "warning");
				},
			});
		} else if (autoCompactCandidateLevel && timeoutPressureGuard.blocked) {
			(pi as unknown as { appendEntry?: (type: string, payload: unknown) => void }).appendEntry?.(
				"context-watchdog.auto-compact-guarded-timeout-pressure",
				{
					atIso: new Date(now).toISOString(),
					reasonCode: timeoutPressureGuard.reasonCode,
					reason: timeoutPressureGuard.reason,
					recommendation: timeoutPressureGuard.recommendation,
					timeoutPressure,
				},
			);
			if (config.notify) {
				ctx.ui.notify(
					timeoutPressureGuard.recommendation
						?? "context-watch: timeout-pressure guard active; keep idle and retry guarded compact path.",
					"warning",
				);
			}
			scheduleAutoCompactRetry(ctx, AUTO_COMPACT_RETRY_DELAY_MS);
		} else if (autoCompactCandidateLevel && autoCompactState.retryDelayMs !== undefined) {
			scheduleAutoCompactRetry(ctx, autoCompactState.retryDelayMs);
		} else {
			clearAutoCompactRetryTimer();
		}

		const elapsed = now - lastAnnouncedAt;
		const forceWarnCadenceAnnouncement =
			assessment.level === "warn" &&
			assessment.action === "write-checkpoint" &&
			consecutiveWarnCount === 2;
		const compactHeadroomPct = Math.max(0, assessment.thresholds.compactPct - assessment.percent);
		const finalTurnCloseWindow = assessment.level === "compact"
			|| (assessment.level === "checkpoint" && compactHeadroomPct <= FINAL_TURN_CLOSE_HEADROOM_PCT);
		const finalTurnDispatch = resolveFinalTurnAnnouncementDispatch({
			reason,
			finalTurnCloseWindow,
			nowMs: now,
			cooldownMs: config.cooldownMs,
			assessmentLevel: assessment.level,
			assessmentAction: assessment.action,
			lastSteeringSignal,
		});
		const forceFinalTurnAnnouncement = finalTurnDispatch.force;
		if (finalTurnDispatch.suppressed) {
			markFinalTurnSuppression(now);
		}
		const steeringDispatch = resolveContextWatchSteeringDispatch({
			userNotifyEnabled: config.notify,
			assessmentLevel: assessment.level,
			modelSteeringFromLevel: config.modelSteeringFromLevel,
			userNotifyFromLevel: config.userNotifyFromLevel,
			lastAnnouncedLevel,
			elapsedMs: elapsed,
			cooldownMs: config.cooldownMs,
			forceWarnCadenceAnnouncement,
			forceFinalTurnAnnouncement,
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
		const finalTurnCloseLine = forceFinalTurnAnnouncement
			? "context-watch-final-turn: use this turn only to close the current slice (checkpoint curto) and then stay idle for auto-compact."
			: undefined;
		const lines = [
			formatContextWatchCommandStatusSummary({
				level: assessment.level,
				percent: assessment.percent,
				action: assessment.action,
				autoCompactDecision: autoCompactState.decision.reason,
				autoCompactTrigger: autoCompactState.decision.trigger,
				retryScheduled: autoCompactState.retryDelayMs !== undefined,
				calmCloseReady: calmCloseSignal.calmCloseReady,
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
			finalTurnCloseLine,
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
				finalTurnCloseWindow,
				compactHeadroomPct,
				forceFinalTurnAnnouncement,
				finalTurnCloseHeadroomPct: FINAL_TURN_CLOSE_HEADROOM_PCT,
				finalTurnAnnouncementSuppressed: finalTurnDispatch.suppressed,
				finalTurnAnnouncementReason: finalTurnDispatch.reason,
			},
		);
		if (steeringDispatch.shouldNotify) {
			const steeringSeverity = forceFinalTurnAnnouncement ? "info" : assessment.severity;
			ctx.ui.notify(lines.join("\n"), steeringSeverity);
		}
	};

	const currentAutoCompactState = (
		ctx: ExtensionContext,
		assessment: ContextWatchAssessment,
		deferCount = compactDeferCount,
	) => {
		const nowMs = Date.now();
		const handoff = readHandoffJson(ctx.cwd);
		const handoffTimestamp = typeof handoff.timestamp === "string" ? handoff.timestamp : undefined;
		const autoResumeAfterReloadIntent = readAutoResumeAfterReloadIntent(handoff);
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
		const state = buildAutoCompactDiagnostics(assessment, config, {
			nowMs,
			lastAutoCompactAt,
			inFlight: autoCompactInFlight,
			isIdle: ctx.isIdle(),
			hasPendingMessages: ctx.hasPendingMessages(),
			checkpointEvidenceReady,
		}, AUTO_COMPACT_RETRY_DELAY_MS);
		const timeoutPressure = readTimeoutPressureState(nowMs);
		const timeoutPressureGuard = resolveAutoCompactTimeoutPressureGuard({
			assessmentLevel: assessment.level,
			autoCompactTrigger: state.decision.trigger,
			timeoutPressureActive: timeoutPressure.active,
		});
		const retryInMs = autoCompactRetryDueAt > 0 ? Math.max(0, autoCompactRetryDueAt - nowMs) : undefined;
		const calmClose = resolvePreCompactCalmCloseSignal({
			assessmentLevel: assessment.level,
			decisionReason: state.decision.reason,
			checkpointEvidenceReady,
			deferCount,
			deferThreshold: CALM_CLOSE_DEFER_THRESHOLD,
		});
		const autoCompactTriggerOrigin = resolveContextWatchAutoCompactTriggerOrigin({
			assessmentLevel: assessment.level,
			autoCompactTrigger: state.decision.trigger,
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
			autoResumeAfterReloadPending: Boolean(autoResumeAfterReloadIntent),
			autoResumeAfterReloadIntent,
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
			autoCompactTriggerOrigin,
			autoCompactCheckpointWindowEligible: assessment.level === "checkpoint",
			autoCompactCandidateOrigin: assessment.level === "checkpoint"
				? "checkpoint-window"
				: assessment.level === "compact"
					? "hard-compact"
					: "none",
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
			timeoutPressure,
			timeoutPressureGuard,
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
		lastPreCompactPrepNotifyAt = 0;
		announceWindowStartAt = 0;
		announceCountInWindow = 0;
		finalTurnSuppressionCountInWindow = 0;
		lastDeterministicStopSignalAt = 0;
		timeoutPressureWindowStartedAt = 0;
		timeoutPressureCount = 0;
		timeoutPressureLastSeenAt = 0;
		timeoutPressureLastMessage = "";
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
			const reloadRequired = isReloadRequiredForSourceUpdate();
			const preCompactReloadSignal = resolvePreCompactReloadSignal({
				assessmentLevel: assessment.level,
				reloadRequired,
			});
			const operatorSignal = resolveContextWatchOperatorSignal({
				reloadRequired,
				handoffManualRefreshRequired: autoCompact.handoffManualRefreshRequired,
				signalNoiseExcessive: resolveContextWatchSignalNoiseExcessive(
					getAnnouncementsInWindow(nowMs),
					SIGNAL_NOISE_MAX_ANNOUNCEMENTS,
				),
				compactCheckpointPersistRequired: autoCompact.compactCheckpointPersistRecommended,
				timeoutPressureActive: autoCompact.timeoutPressure?.active === true
					&& (assessment.level === "checkpoint" || assessment.level === "compact"),
			});
			const deterministicStop = resolveContextWatchDeterministicStopSignal({
				assessmentLevel: assessment.level,
				operatorSignal,
				autoCompactDecision: autoCompact.decision.reason,
			});
			const deterministicStopHint = describeContextWatchDeterministicStopHint(deterministicStop);
			const operatorAction = resolveContextWatchOperatorActionPlan({ deterministicStop, operatorSignal });
			const operatingCadence = resolveContextWatchOperatingCadence({
				assessmentLevel: assessment.level,
				handoffLastEventLevel: autoCompact.handoffLastEvent?.level,
			});
			const compactStage = resolveContextWatchCompactStage(assessment);
			const signalNoise = {
				windowMs: SIGNAL_NOISE_WINDOW_MS,
				announcementsInWindow: getAnnouncementsInWindow(nowMs),
				maxAnnouncementsPerWindow: SIGNAL_NOISE_MAX_ANNOUNCEMENTS,
				finalTurnSuppressionsInWindow: getFinalTurnSuppressionsInWindow(nowMs),
				excessive: resolveContextWatchSignalNoiseExcessive(
					getAnnouncementsInWindow(nowMs),
					SIGNAL_NOISE_MAX_ANNOUNCEMENTS,
				),
			};
			const freshness = readContextWatchFreshnessSignals(ctx.cwd, "control-plane-core");
			const handoffFreshThresholdSec = Math.max(60, Math.floor(autoCompact.handoffFreshMaxAgeMs / 1000));
			const handoffForOperatorBrief = readHandoffJson(ctx.cwd);
			const operatorBrief = buildContextWatchOperatorBrief({
				cwd: ctx.cwd,
				handoff: handoffForOperatorBrief,
				operatorActionKind: operatorAction.kind,
				deterministicStopReason: deterministicStop.reason,
				timeoutPressureActive: autoCompact.timeoutPressure?.active === true,
				timeoutPressureCount: autoCompact.timeoutPressure?.count,
				timeoutPressureThreshold: autoCompact.timeoutPressure?.threshold,
			});
			const timeoutPressureSummary = formatTimeoutPressureSummary(autoCompact.timeoutPressure);
			const reloadGate = preCompactReloadSignal.reason;
			const fullSummary = formatContextWatchStatusToolSummary({
				level: assessment.level,
				percent: assessment.percent,
				action: assessment.action,
				autoCompactDecision: autoCompact.decision.reason,
				operatorActionKind: operatorAction.kind,
				operatingCadence: operatingCadence.operatingCadence,
				handoffFreshness: autoCompact.handoffFreshness.label,
				handoffAgeSec: autoCompact.handoffFreshnessAgeSec,
				handoffFreshThresholdSec,
				reloadGate,
				timeoutPressureSummary,
				postReloadResume: autoCompact.autoResumeAfterReloadPending ? "pending" : undefined,
			});
			const adaptiveSummary = resolveContextWatchAdaptiveStatusSummary({
				level: assessment.level,
				summary: fullSummary,
				nowMs,
				lastLevel: lastStatusToolLevel,
				lastEmittedAtMs: lastStatusToolAt,
				cooldownMs: config.cooldownMs,
			});
			lastStatusToolLevel = assessment.level;
			lastStatusToolAt = nowMs;
			const payload = {
				...assessment,
				summary: adaptiveSummary.summary,
				fullSummary,
				handoffAgeSec: autoCompact.handoffFreshnessAgeSec,
				handoffFreshThresholdSec,
				reloadGate,
				timeoutPressureSummary,
				outputShape: {
					mode: adaptiveSummary.mode,
					cooldownMs: config.cooldownMs,
					cooldownRemainingSec: adaptiveSummary.cooldownRemainingSec,
				},
				steeringStatus: formatContextWatchSteeringStatus(assessment),
				autoCompact,
				operatorSignal,
				deterministicStop,
				deterministicStopHint,
				operatorAction,
				operatorBrief,
				operatingCadence,
				compactStage,
				signalNoise,
				preCompactReloadSignal,
				dirtySignal: freshness.dirtySignal,
				preloadDecision: freshness.preloadDecision,
				gitDirty: freshness.gitDirty,
				preload: freshness.preload,
			};
			return {
				content: [{ type: "text", text: adaptiveSummary.summary }],
				details: payload,
			};
		},
	});

	pi.registerTool({
		name: "context_watch_compact_stage_status",
		label: "Context Watch Compact Stage Status",
		description:
			"Read-only compact-stage status with graceful-vs-force stage, reload gate, and deterministic next action.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const assessment = buildAssessment(ctx, config, thresholdOverrides);
			lastAssessment = assessment;
			const nowMs = Date.now();
			const autoCompact = currentAutoCompactState(ctx, assessment);
			const compactStage = resolveContextWatchCompactStage(assessment);
			const signalNoise = {
				windowMs: SIGNAL_NOISE_WINDOW_MS,
				announcementsInWindow: getAnnouncementsInWindow(nowMs),
				maxAnnouncementsPerWindow: SIGNAL_NOISE_MAX_ANNOUNCEMENTS,
				finalTurnSuppressionsInWindow: getFinalTurnSuppressionsInWindow(nowMs),
				excessive: resolveContextWatchSignalNoiseExcessive(
					getAnnouncementsInWindow(nowMs),
					SIGNAL_NOISE_MAX_ANNOUNCEMENTS,
				),
			};
			const reloadRequired = isReloadRequiredForSourceUpdate();
			const preCompactReloadSignal = resolvePreCompactReloadSignal({
				assessmentLevel: assessment.level,
				reloadRequired,
			});
			const nextAction = preCompactReloadSignal.active
				? (preCompactReloadSignal.hint ?? "run /reload and continue from handoff checkpoint")
				: compactStage.shouldForceCompact
					? "compact now and continue from checkpoint"
					: compactStage.shouldGracefulStop
						? "close current slice and checkpoint before compact threshold"
						: "continue bounded work";
			const summary = formatContextWatchCompactStageStatusSummary({
				stage: compactStage.stage,
				level: assessment.level,
				checkpointPct: assessment.thresholds.checkpointPct,
				compactPct: assessment.thresholds.compactPct,
				reloadGate: preCompactReloadSignal.reason,
				nextAction,
			});
			return {
				content: [{ type: "text", text: summary }],
				details: {
					summary,
					level: assessment.level,
					percent: assessment.percent,
					thresholds: assessment.thresholds,
					compactStage,
					autoCompactTelemetry: {
						decision: autoCompact.decision.reason,
						trigger: autoCompact.decision.trigger,
						triggerOrigin: autoCompact.autoCompactTriggerOrigin,
						candidateOrigin: autoCompact.autoCompactCandidateOrigin,
						checkpointWindowEligible: autoCompact.autoCompactCheckpointWindowEligible,
						checkpointEvidenceReady: autoCompact.checkpointEvidenceReady,
					},
					signalNoise,
					preCompactReloadSignal,
					nextAction,
					effect: "none",
					mode: "read-only-compact-stage",
					authorization: "none",
					dispatchAllowed: false,
				},
			};
		},
	});

	pi.registerTool({
		name: "context_watch_freshness_status",
		label: "Context Watch Freshness Status",
		description:
			"Read-only freshness snapshot with preload decision and git dirty signal in one call.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const freshness = readContextWatchFreshnessSignals(ctx.cwd, "control-plane-core");
			const summary = [
				"context-watch-freshness-status:",
				`preload=${freshness.preloadDecision}`,
				`dirty=${freshness.dirtySignal}`,
				"authorization=none",
			].join(" ");
			return {
				content: [{ type: "text", text: summary }],
				details: {
					summary,
					preloadDecision: freshness.preloadDecision,
					dirtySignal: freshness.dirtySignal,
					preload: freshness.preload,
					gitDirty: freshness.gitDirty,
					effect: "none",
					mode: "read-only-freshness",
					authorization: "none",
					dispatchAllowed: false,
				},
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
				{ taskStatusById: readProjectTaskStatusById(ctx.cwd), preferredTaskIds: readProjectPreferredActiveTaskIds(ctx.cwd, 1) },
			);
			const diagnosticsSummary = summarizeAutoResumePromptDiagnostics(envelope.diagnostics);
			const focusTaskIds = Array.isArray(envelope.diagnostics.focusTasksListed)
				? envelope.diagnostics.focusTasksListed
				: [];
			const focusTasks = focusTaskIds.length > 0
				? focusTaskIds.join(", ")
				: extractAutoResumePromptValue(envelope.prompt, "focusTasks", "none-listed");
			const focusMnemonics = summarizeFocusMnemonicsForPreview(
				focusTaskIds.map((taskId) => (
					toOperatorTaskMnemonic(taskId, readProjectTaskDescriptionById(ctx.cwd, taskId)) ?? taskId
				)),
			);
			const staleFocus = extractAutoResumePromptValue(envelope.prompt, "staleFocus", "none");
			const staleFocusCount = envelope.diagnostics.staleFocusTasks?.length ?? 0;
			const reloadRequired = isReloadRequiredForSourceUpdate();
			const reloadHint = reloadRequired ? formatAutoResumeReloadHintShort() : undefined;
			const summary = formatContextWatchAutoResumePreviewSummary({
				focusTasks,
				focusMnemonics,
				staleFocusCount,
				diagnosticsSummary,
				reloadGate: reloadRequired ? "required" : "clear",
				reloadHint,
			});
			return {
				content: [{ type: "text", text: summary }],
				details: {
					summary,
					prompt: envelope.prompt,
					focusTasks,
					focusMnemonics,
					staleFocus,
					diagnostics: envelope.diagnostics,
					diagnosticsSummary,
					reloadGate: {
						reloadRequired,
						reason: reloadRequired ? "reload-required" : "clear",
						hint: reloadHint,
					},
					effect: "none",
					mode: "read-only-preview",
					authorization: "none",
				},
			};
		},
	});

	pi.registerTool({
		name: "context_preload_consume",
		label: "Context Preload Consume",
		description:
			"Read-only fresh-context pack consumer with fail-closed fallback to canonical handoff/tasks/verification when stale.",
		parameters: Type.Object({
			profile: Type.Optional(Type.Union([
				Type.Literal("control-plane-core"),
				Type.Literal("agent-worker-lean"),
				Type.Literal("swarm-scout-min"),
			])),
			max_age_hours: Type.Optional(Type.Number()),
			pack_path: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = (params ?? {}) as { profile?: string; max_age_hours?: number; pack_path?: string };
			const report = consumeContextPreloadPack(ctx.cwd, {
				profile: p.profile,
				maxAgeHours: p.max_age_hours,
				packPath: p.pack_path,
			});
			return {
				content: [{ type: "text", text: report.summary }],
				details: report,
			};
		},
	});

	pi.registerTool({
		name: "context_watch_continuation_readiness",
		label: "Context Watch Continuation Readiness",
		description:
			"Read-only continuation readiness packet combining auto-resume primary focus with local continuity audit. Never dispatches resume, compact, scheduler, remote, or automation.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const handoff = readHandoffJson(ctx.cwd);
			const postReloadResumeIntent = readAutoResumeAfterReloadIntent(handoff);
			const growthSnapshotBase = resolveHandoffGrowthMaturitySnapshot(handoff);
			const handoffFreshness = resolveHandoffFreshness(
				typeof handoff.timestamp === "string" ? handoff.timestamp : undefined,
				Date.now(),
				config.handoffFreshMaxAgeMs,
			).label;
			const growthSnapshot = growthSnapshotBase
				? {
					...growthSnapshotBase,
					freshness: handoffFreshness,
				}
				: undefined;
			const resumeEnvelope = buildAutoResumePromptEnvelopeFromHandoff(
				handoff,
				config.handoffFreshMaxAgeMs,
				Date.now(),
				{ taskStatusById: readProjectTaskStatusById(ctx.cwd), preferredTaskIds: readProjectPreferredActiveTaskIds(ctx.cwd, 1) },
			);
			const diagnosticsSummary = summarizeAutoResumePromptDiagnostics(resumeEnvelope.diagnostics);
			const focusTasks = extractAutoResumePromptValue(resumeEnvelope.prompt, "focusTasks", "none-listed");
			const staleFocus = extractAutoResumePromptValue(resumeEnvelope.prompt, "staleFocus", "none");
			const staleFocusCount = resumeEnvelope.diagnostics.staleFocusTasks?.length ?? 0;
			const localAudit = buildLocalContinuityAudit(ctx.cwd);
			const localAuditReasons = localContinuityAuditReasons(localAudit);
			const protectedPaths = localContinuityProtectedPaths(localAudit);
			const localContinuitySummary = formatLocalContinuityAuditSummary(localAudit, localAuditReasons);
			const localAuditDecision = localAudit.envelope.packet.gate.decision;
			const ready = focusTasks !== "none-listed" && localAudit.envelope.eligibleForAuditedRuntimeSurface;
			const recommendation = resolveContextWatchContinuationRecommendation({
				ready,
				focusTasks,
				staleFocusCount,
				localAuditReasons,
			});
			const materialReadiness = buildAfkMaterialReadinessSnapshot(ctx.cwd, focusTasks);
			const decisionCue = materialReadiness.decision === "continue"
				? {
					humanDecisionNeeded: false,
					reasonCode: "none",
					recommendedAction: ready ? "continue-local-safe" : "stabilize-local-safe",
				}
				: {
					humanDecisionNeeded: true,
					reasonCode: "seed-local-safe-required",
					recommendedAction: "seed-local-safe",
				};
			const freshness = readContextWatchFreshnessSignals(ctx.cwd, "control-plane-core");
			const collectorStatus = (fact: string) => localAudit.collectorResults.find((entry) => entry.fact === fact)?.status;
			const validationKnown = collectorStatus("validation") === "observed";
			const protectedScopesClear = collectorStatus("protected-scopes") === "observed" && protectedPaths.length === 0;
			const reloadRequired = isReloadRequiredForSourceUpdate();
			const autoAdvanceBlockedReasons = [
				reloadRequired ? "reload-required" : undefined,
				freshness.dirtySignal !== "clean" ? "git-not-clean" : undefined,
				!protectedScopesClear ? "protected-scope" : undefined,
				!validationKnown ? "validation-failed-or-unknown" : undefined,
			].filter((reason): reason is string => Boolean(reason));
			const autoAdvanceDecision = ready && autoAdvanceBlockedReasons.length === 0
				? "eligible"
				: "blocked";
			const readinessSummary = formatContextWatchContinuationReadinessSummary({
				ready,
				focusTasks,
				localAuditDecision,
				localAuditReasons,
				protectedPaths,
				staleFocusCount,
			});
			const summary = [
				readinessSummary,
				`preload=${freshness.preloadDecision}`,
				`dirty=${freshness.dirtySignal}`,
				`autoAdvance=${autoAdvanceDecision}`,
				`material=${materialReadiness.decision}`,
				`decisionCue=${decisionCue.reasonCode}`,
				postReloadResumeIntent ? "postReloadResume=pending" : undefined,
				growthSnapshot?.decision ? `growthDecision=${growthSnapshot.decision}` : undefined,
				growthSnapshot?.score !== undefined ? `growthScore=${growthSnapshot.score}` : undefined,
				growthSnapshot ? `growthSource=${growthSnapshot.source}` : undefined,
				growthSnapshot?.freshness ? `growthFresh=${growthSnapshot.freshness}` : undefined,
			].filter(Boolean).join(" ");
			return {
				content: [{ type: "text", text: summary }],
				details: {
					summary,
					ready,
					focusTasks,
					staleFocus,
					staleFocusCount,
					diagnosticsSummary,
					postReloadResumePending: Boolean(postReloadResumeIntent),
					postReloadResumeReason: postReloadResumeIntent?.reason,
					localContinuitySummary,
					localContinuityReasons: localAuditReasons,
					protectedPaths,
					recommendationCode: recommendation.recommendationCode,
					nextAction: recommendation.nextAction,
					materialReadiness: {
						decision: materialReadiness.decision,
						recommendationCode: materialReadiness.recommendationCode,
						nextAction: materialReadiness.nextAction,
						blockedReasons: materialReadiness.blockedReasons,
						stock: materialReadiness.stock,
					},
					decisionCue,
					growthMaturitySnapshot: growthSnapshot,
					autoAdvanceContract: {
						enabled: true,
						intent: "hard-intent",
						mode: "fail-closed",
						decision: autoAdvanceDecision,
						blockedReasons: autoAdvanceBlockedReasons,
						reloadRequired,
						validationKnown,
						protectedScopesClear,
						gitDirtySignal: freshness.dirtySignal,
					},
					preload: freshness.preload,
					gitDirty: freshness.gitDirty,
					localContinuity: localAudit,
					autoResumePrompt: resumeEnvelope.prompt,
					effect: "none",
					mode: "read-only-readiness",
					authorization: "none",
				},
			};
		},
	});

	pi.registerTool({
		name: "turn_boundary_decision_packet",
		label: "Turn Boundary Decision Packet",
		description:
			"Report-only packet for turn boundary continuation decisions (continue|checkpoint|pause|ask-human) with explicit humanActionRequired, nextAutoStep, directionPrompt, directionPreview, and optional growth maturity go/hold snapshot.",
		parameters: Type.Object({
			safety_score: Type.Optional(Type.Number({ description: "Optional safety maturity score (0..100)." })),
			calibration_score: Type.Optional(Type.Number({ description: "Optional calibration maturity score (0..100)." })),
			throughput_score: Type.Optional(Type.Number({ description: "Optional throughput maturity score (0..100)." })),
			simplicity_score: Type.Optional(Type.Number({ description: "Optional simplicity maturity score (0..100)." })),
			go_threshold: Type.Optional(Type.Number({ description: "Optional go threshold for growth maturity snapshot." })),
			hold_threshold: Type.Optional(Type.Number({ description: "Optional hold threshold for growth maturity snapshot." })),
			debt_budget_ok: Type.Optional(Type.Boolean({ description: "Optional debt-budget signal for growth maturity snapshot." })),
			critical_blockers: Type.Optional(Type.Number({ description: "Optional critical blocker count for growth maturity snapshot." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = (params ?? {}) as Record<string, unknown>;
			const growthInputProvided = [
				"safety_score",
				"calibration_score",
				"throughput_score",
				"simplicity_score",
				"go_threshold",
				"hold_threshold",
				"debt_budget_ok",
				"critical_blockers",
			].some((key) => p[key] !== undefined);
			const handoff = readHandoffJson(ctx.cwd);
			const fallbackGrowthSnapshotBase = growthInputProvided
				? undefined
				: resolveHandoffGrowthMaturitySnapshot(handoff);
			const handoffFreshness = resolveHandoffFreshness(
				typeof handoff.timestamp === "string" ? handoff.timestamp : undefined,
				Date.now(),
				config.handoffFreshMaxAgeMs,
			).label;
			const fallbackGrowthSnapshot = fallbackGrowthSnapshotBase
				? {
					...fallbackGrowthSnapshotBase,
					freshness: handoffFreshness,
				}
				: undefined;
			const resumeEnvelope = buildAutoResumePromptEnvelopeFromHandoff(
				handoff,
				config.handoffFreshMaxAgeMs,
				Date.now(),
				{ taskStatusById: readProjectTaskStatusById(ctx.cwd), preferredTaskIds: readProjectPreferredActiveTaskIds(ctx.cwd, 1) },
			);
			const focusTasks = extractAutoResumePromptValue(resumeEnvelope.prompt, "focusTasks", "none-listed");
			const staleFocusCount = resumeEnvelope.diagnostics.staleFocusTasks?.length ?? 0;
			const localAudit = buildLocalContinuityAudit(ctx.cwd);
			const localAuditReasons = localContinuityAuditReasons(localAudit);
			const ready = focusTasks !== "none-listed" && localAudit.envelope.eligibleForAuditedRuntimeSurface;
			const packet = buildTurnBoundaryDecisionPacket({
				ready,
				focusTasks,
				staleFocusCount,
				localAuditReasons,
				growthMaturity: growthInputProvided
					? {
						safetyScore: typeof p.safety_score === "number" ? p.safety_score : undefined,
						calibrationScore: typeof p.calibration_score === "number" ? p.calibration_score : undefined,
						throughputScore: typeof p.throughput_score === "number" ? p.throughput_score : undefined,
						simplicityScore: typeof p.simplicity_score === "number" ? p.simplicity_score : undefined,
						goThreshold: typeof p.go_threshold === "number" ? p.go_threshold : undefined,
						holdThreshold: typeof p.hold_threshold === "number" ? p.hold_threshold : undefined,
						debtBudgetOk: typeof p.debt_budget_ok === "boolean" ? p.debt_budget_ok : undefined,
						criticalBlockers: typeof p.critical_blockers === "number" ? p.critical_blockers : undefined,
					}
					: undefined,
				growthMaturitySnapshot: fallbackGrowthSnapshot,
			});
			return {
				content: [{ type: "text", text: packet.summary }],
				details: {
					...packet,
					focusTasks,
					staleFocusCount,
					localAuditReasons,
					directionPromptCanonical: TURN_BOUNDARY_DIRECTION_PROMPT,
					mode: "report-only",
					effect: "none",
					authorization: "none",
					dispatchAllowed: false,
					mutationAllowed: false,
				},
			};
		},
	});

	pi.registerTool({
		name: "context_watch_one_slice_canary_preview",
		label: "Context Watch One-Slice Canary Preview",
		description:
			"Read-only preview that composes continuation readiness with the one-slice local canary plan. Never dispatches automation, staging, commits, checkpoints, remote, or scheduler work.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const taskStatusById = readProjectTaskStatusById(ctx.cwd);
			const handoff = readHandoffJson(ctx.cwd);
			const postReloadResumeIntent = readAutoResumeAfterReloadIntent(handoff);
			const resumeEnvelope = buildAutoResumePromptEnvelopeFromHandoff(
				handoff,
				config.handoffFreshMaxAgeMs,
				Date.now(),
				{ taskStatusById, preferredTaskIds: readProjectPreferredActiveTaskIds(ctx.cwd, 1) },
			);
			const diagnosticsSummary = summarizeAutoResumePromptDiagnostics(resumeEnvelope.diagnostics);
			const focusTasks = extractAutoResumePromptValue(resumeEnvelope.prompt, "focusTasks", "none-listed");
			const localAudit = buildLocalContinuityAudit(ctx.cwd);
			const localAuditReasons = localContinuityAuditReasons(localAudit);
			const protectedPaths = localContinuityProtectedPaths(localAudit);
			const localContinuitySummary = formatLocalContinuityAuditSummary(localAudit, localAuditReasons);
			const collectorStatus = (fact: string) => localAudit.collectorResults.find((entry) => entry.fact === fact)?.status;
			const focusStatus = focusTasks !== "none-listed" && !focusTasks.includes(",") ? taskStatusById[focusTasks] ?? taskStatusById[focusTasks.toUpperCase()] : undefined;
			const readinessReady = focusTasks !== "none-listed" && localAudit.envelope.eligibleForAuditedRuntimeSurface;
			const checkpointFresh = collectorStatus("checkpoint") === "observed";
			const handoffBudgetOk = collectorStatus("handoff-budget") === "observed";
			const gitStateExpected = collectorStatus("git-state") === "observed";
			const protectedScopesClear = collectorStatus("protected-scopes") === "observed" && protectedPaths.length === 0;
			const validationKnown = collectorStatus("validation") === "observed";
			const stopConditionsClear = collectorStatus("stop-conditions") === "observed";
			const singleFocus = focusTasks !== "none-listed" && !focusTasks.includes(",");
			const plan = resolveOneSliceLocalCanaryPlan({
				readinessReady,
				authorization: "none",
				checkpointFresh,
				handoffBudgetOk,
				gitStateExpected,
				protectedScopesClear,
				validationKnown,
				stopConditionsClear,
				risk: false,
				ambiguous: false,
				repeatRequested: false,
				sliceAlreadyCompleted: focusStatus === "completed",
			});
			const decisionPacket = buildOneSliceLocalCanaryDispatchDecisionPacket({
				plan,
				rollbackPlanKnown: gitStateExpected,
				validationGateKnown: validationKnown,
				stagingScopeKnown: singleFocus && protectedScopesClear,
				commitScopeKnown: singleFocus && gitStateExpected,
				checkpointPlanned: checkpointFresh && handoffBudgetOk,
				stopContractKnown: plan.mustStopAfterSlice && plan.oneSliceOnly,
			});
			const summary = [
				formatContextWatchOneSliceCanaryPreviewSummary({
					...plan,
					decisionPacketDecision: decisionPacket.decision,
					dispatchAllowed: decisionPacket.dispatchAllowed,
					decisionPacketReasons: decisionPacket.reasons,
				}),
				postReloadResumeIntent ? "postReloadResume=pending" : undefined,
			].filter(Boolean).join(" ");
			return {
				content: [{ type: "text", text: summary }],
				details: {
					summary,
					plan,
					decisionPacket,
					focusTasks,
					focusStatus,
					diagnosticsSummary,
					postReloadResumePending: Boolean(postReloadResumeIntent),
					postReloadResumeReason: postReloadResumeIntent?.reason,
					localContinuitySummary,
					localContinuityReasons: localAuditReasons,
					protectedPaths,
					localContinuity: localAudit,
					autoResumePrompt: resumeEnvelope.prompt,
					effect: "none",
					mode: "read-only-preview",
					activation: "none",
					authorization: "none",
				},
			};
		},
	});

	pi.registerTool({
		name: "context_watch_one_slice_operator_packet_preview",
		label: "Context Watch One-Slice Operator Packet Preview",
		description:
			"Read-only operator packet composing continuation readiness, one-slice preview, decision packet, and human contract review. Never dispatches execution and defaults human confirmation to missing.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const taskStatusById = readProjectTaskStatusById(ctx.cwd);
			const resumeEnvelope = buildAutoResumePromptEnvelopeFromHandoff(
				readHandoffJson(ctx.cwd),
				config.handoffFreshMaxAgeMs,
				Date.now(),
				{ taskStatusById, preferredTaskIds: readProjectPreferredActiveTaskIds(ctx.cwd, 1) },
			);
			const diagnosticsSummary = summarizeAutoResumePromptDiagnostics(resumeEnvelope.diagnostics);
			const focusTasks = extractAutoResumePromptValue(resumeEnvelope.prompt, "focusTasks", "none-listed");
			const localAudit = buildLocalContinuityAudit(ctx.cwd);
			const localAuditReasons = localContinuityAuditReasons(localAudit);
			const protectedPaths = localContinuityProtectedPaths(localAudit);
			const localContinuitySummary = formatLocalContinuityAuditSummary(localAudit, localAuditReasons);
			const collectorStatus = (fact: string) => localAudit.collectorResults.find((entry) => entry.fact === fact)?.status;
			const focusStatus = focusTasks !== "none-listed" && !focusTasks.includes(",") ? taskStatusById[focusTasks] ?? taskStatusById[focusTasks.toUpperCase()] : undefined;
			const readinessReady = focusTasks !== "none-listed" && localAudit.envelope.eligibleForAuditedRuntimeSurface;
			const checkpointFresh = collectorStatus("checkpoint") === "observed";
			const handoffBudgetOk = collectorStatus("handoff-budget") === "observed";
			const gitStateExpected = collectorStatus("git-state") === "observed";
			const protectedScopesClear = collectorStatus("protected-scopes") === "observed" && protectedPaths.length === 0;
			const validationKnown = collectorStatus("validation") === "observed";
			const stopConditionsClear = collectorStatus("stop-conditions") === "observed";
			const singleFocus = focusTasks !== "none-listed" && !focusTasks.includes(",");
			const plan = resolveOneSliceLocalCanaryPlan({
				readinessReady,
				authorization: "none",
				checkpointFresh,
				handoffBudgetOk,
				gitStateExpected,
				protectedScopesClear,
				validationKnown,
				stopConditionsClear,
				risk: false,
				ambiguous: false,
				repeatRequested: false,
				sliceAlreadyCompleted: focusStatus === "completed",
			});
			const decisionPacket = buildOneSliceLocalCanaryDispatchDecisionPacket({
				plan,
				rollbackPlanKnown: gitStateExpected,
				validationGateKnown: validationKnown,
				stagingScopeKnown: singleFocus && protectedScopesClear,
				commitScopeKnown: singleFocus && gitStateExpected,
				checkpointPlanned: checkpointFresh && handoffBudgetOk,
				stopContractKnown: plan.mustStopAfterSlice && plan.oneSliceOnly,
			});
			const declaredFilesKnown = Number(localAudit.packetInput?.candidate?.estimatedFiles ?? 0) > 0;
			const contractReview = reviewOneSliceLocalHumanConfirmedContract({
				decisionPacket,
				humanConfirmation: "missing",
				singleFocus,
				localSafeScope: protectedScopesClear,
				declaredFilesKnown,
				protectedScopesClear,
				rollbackPlanKnown: gitStateExpected,
				validationGateKnown: validationKnown,
				stagingScopeKnown: singleFocus && protectedScopesClear,
				commitScopeKnown: singleFocus && gitStateExpected,
				checkpointPlanned: checkpointFresh && handoffBudgetOk,
				stopContractKnown: plan.mustStopAfterSlice && plan.oneSliceOnly,
			});
			const summary = formatContextWatchOneSliceOperatorPacketPreviewSummary({
				readinessReady,
				previewDecision: plan.decision,
				packetDecision: decisionPacket.decision,
				contractDecision: contractReview.decision,
				dispatchAllowed: decisionPacket.dispatchAllowed || contractReview.dispatchAllowed,
				executorApproved: contractReview.executorApproved,
				contractReasons: contractReview.reasons,
			});
			return {
				content: [{ type: "text", text: summary }],
				details: {
					summary,
					readinessReady,
					plan,
					decisionPacket,
					contractReview,
					focusTasks,
					focusStatus,
					diagnosticsSummary,
					localContinuitySummary,
					localContinuityReasons: localAuditReasons,
					protectedPaths,
					localContinuity: localAudit,
					autoResumePrompt: resumeEnvelope.prompt,
					effect: "none",
					mode: "read-only-operator-packet",
					activation: "none",
					authorization: "none",
					dispatchAllowed: false,
					executorApproved: false,
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
			growth_decision: Type.Optional(Type.Union([
				Type.Literal("go"),
				Type.Literal("hold"),
				Type.Literal("needs-evidence"),
			])),
			growth_score: Type.Optional(Type.Number()),
			growth_code: Type.Optional(Type.String()),
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
				growth_decision?: "go" | "hold" | "needs-evidence";
				growth_score?: number;
				growth_code?: string;
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
				growthDecision: p.growth_decision,
				growthScore: p.growth_score,
				growthRecommendationCode: p.growth_code,
			});
			const reloadRequired = isReloadRequiredForSourceUpdate();
			const details = {
				ok: result.ok,
				reason: result.reason,
				summary: result.summary,
				path: result.ok ? ".project/handoff.json" : undefined,
				jsonChars: result.jsonChars,
				maxJsonChars: result.maxJsonChars,
				reloadRequired,
				reloadHint: reloadRequired
					? "run /reload before relying on updated tool/runtime behavior."
					: undefined,
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
		description: "Show/reset status, show freshness, print bootstrap patch, or apply preset. Usage: /context-watch [status|freshness|reset|bootstrap [control-plane|agent-worker]|apply [control-plane|agent-worker]]",
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
				lastStatusToolLevel = undefined;
				lastStatusToolAt = 0;
				autoCompactInFlight = false;
				clearAutoCompactRetryTimer();
				consecutiveWarnCount = 0;
				compactDeferCount = 0;
				compactDeferWindowStartedAt = 0;
				antiParalysisNotifyCountInWindow = 0;
				lastAntiParalysisNotifyAt = 0;
				lastPreCompactPrepNotifyAt = 0;
				announceWindowStartAt = 0;
				announceCountInWindow = 0;
				finalTurnSuppressionCountInWindow = 0;
				lastDeterministicStopSignalAt = 0;
				timeoutPressureWindowStartedAt = 0;
				timeoutPressureCount = 0;
				timeoutPressureLastSeenAt = 0;
				timeoutPressureLastMessage = "";
				ctx.ui.setStatus?.("context-watch-steering", "[ctx-steer] reset");
				ctx.ui.setStatus?.("context-watch-operator", "[ctx-op] reset");
				ctx.ui.notify("context-watch: state reset", "info");
				return;
			}

			if (sub === "freshness") {
				const freshness = readContextWatchFreshnessSignals(ctx.cwd, "control-plane-core");
				ctx.ui.notify(
					[
						"context-watch freshness:",
						`preload=${freshness.preloadDecision}`,
						`dirty=${freshness.dirtySignal}`,
						`rows=${freshness.gitDirty.rowCount}`,
						`authorization=none`,
					].join("\n"),
					"info",
				);
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
			const reloadRequired = isReloadRequiredForSourceUpdate();
			const preCompactReloadSignal = resolvePreCompactReloadSignal({
				assessmentLevel: assessment.level,
				reloadRequired,
			});
			const announcementsInWindow = getAnnouncementsInWindow(nowMs);
			const finalTurnSuppressionsInWindow = getFinalTurnSuppressionsInWindow(nowMs);
			const signalNoiseExcessive = resolveContextWatchSignalNoiseExcessive(
				announcementsInWindow,
				SIGNAL_NOISE_MAX_ANNOUNCEMENTS,
			);
			const operatorSignal = resolveContextWatchOperatorSignal({
				reloadRequired,
				handoffManualRefreshRequired: autoCompact.handoffManualRefreshRequired,
				signalNoiseExcessive,
				compactCheckpointPersistRequired: autoCompact.compactCheckpointPersistRecommended,
				timeoutPressureActive: autoCompact.timeoutPressure?.active === true
					&& (assessment.level === "checkpoint" || assessment.level === "compact"),
			});
			const deterministicStop = resolveContextWatchDeterministicStopSignal({
				assessmentLevel: assessment.level,
				operatorSignal,
				autoCompactDecision: autoCompact.decision.reason,
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
						autoCompactTriggerOrigin: autoCompact.autoCompactTriggerOrigin,
						retryScheduled: autoCompact.retryScheduled,
						calmCloseReady: autoCompact.calmCloseReady,
						checkpointEvidenceReady: autoCompact.checkpointEvidenceReady,
						operatorActionKind: operatorAction.kind,
						handoffFreshness: autoCompact.handoffFreshness.label,
					}),
					`recommendation=${assessment.recommendation}`,
					preCompactReloadSignal.active
						? `reloadGate=${preCompactReloadSignal.reason} hint=${(preCompactReloadSignal.hint ?? "run_/reload").replace(/\s+/g, "_")}`
						: `reloadGate=${preCompactReloadSignal.reason}`,
					`noise=${announcementsInWindow}/${SIGNAL_NOISE_MAX_ANNOUNCEMENTS} suppressed=${finalTurnSuppressionsInWindow}${signalNoiseExcessive ? " excessive=yes" : " excessive=no"}`,
					"details=context_watch_status structured payload",
				].join("\n"),
				assessment.severity,
			);
		},
	});
}
