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

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
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
	formatContextWatchCommandStatusSummary,
	formatContextWatchCompactStageStatusSummary,
	formatContextWatchDeterministicStopSummary,
	formatContextWatchStatusToolSummary,
	formatTimeoutPressureSummary,
	resolveContextWatchAdaptiveStatusSummary,
} from "./context-watchdog-status-formatting";
import {
	makeContextWatchdogSourceMtimeReader,
	readContextThresholdOverrides,
	readDeferredLaneQueueCount,
	readWatchdogConfig,
} from "./context-watchdog-runtime-status";
import { buildContextWatchdogApplyPreset, registerContextWatchdogStatusSurface } from "./context-watchdog-status-surface";
import {
	applyEmergencyContextWindowFallbackConfig,
	composeAutoResumeSuppressionHint,
	isContextWindowOverflowErrorMessage,
	isProviderRequestTimeoutError,
	persistContextWatchHandoffEvent,
} from "./context-watchdog-runtime-helpers";
export {
	applyEmergencyContextWindowFallbackConfig,
	composeAutoResumeSuppressionHint,
	isContextWindowOverflowErrorMessage,
	isProviderRequestTimeoutError,
	persistContextWatchHandoffEvent,
	writeLocalSliceHandoffCheckpoint,
} from "./context-watchdog-runtime-helpers";
export {
	formatContextWatchCommandStatusSummary,
	formatContextWatchCompactStageStatusSummary,
	formatContextWatchDeterministicStopSummary,
	formatContextWatchStatusToolSummary,
	formatTimeoutPressureSummary,
	resolveContextWatchAdaptiveStatusSummary,
} from "./context-watchdog-status-formatting";
import {
	clearAutoResumeAfterReloadIntent,
	readAutoResumeAfterReloadIntent,
	withAutoResumeAfterReloadIntent,
	type AutoResumeAfterReloadIntent,
} from "./context-watchdog-reload-intent";
export {
	clearAutoResumeAfterReloadIntent,
	readAutoResumeAfterReloadIntent,
	withAutoResumeAfterReloadIntent,
} from "./context-watchdog-reload-intent";

export type {
	AutoResumeAfterReloadIntent,
	AutoResumeAfterReloadIntentReason,
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
	applyCheckpointTaskStatusFocus,
	resolveHandoffGrowthMaturitySnapshot,
	type HandoffGrowthMaturitySnapshot,
} from "./context-watchdog-growth-checkpoint";
export {
	applyCheckpointTaskStatusFocus,
	resolveHandoffGrowthMaturitySnapshot,
} from "./context-watchdog-growth-checkpoint";
export type { HandoffGrowthMaturitySnapshot } from "./context-watchdog-growth-checkpoint";
import {
	extractAutoResumePromptValue,
	readContextWatchFreshnessSignals,
	summarizeFocusMnemonicsForPreview,
} from "./context-watchdog-freshness";
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
} from "./context-watchdog-handoff";
import { formatContextWatchAutoResumePreviewSummary } from "./context-watchdog-continuation";
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
	resolvePostReloadPendingNotifyDecision,
	shouldNotifyAutoResumeSuppression,
	resolveAutoResumeDispatchDecision,
	resolveHandoffPrepDecision,
	resolvePreCompactReloadSignal,
	shouldEmitAutoResumeAfterCompact,
	shouldRefreshHandoffBeforeAutoCompact,
	type AutoResumeDecisionSnapshot,
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

import {
	reconcileAutoResumeHandoffFocus,
	resolveAntiParalysisDispatch,
	resolveCheckpointEvidenceReadyForCalmClose,
	resolveContextEconomySignal,
	resolvePreCompactCalmCloseSignal,
	resolvePreCompactIdlePrepDispatch,
	resolveProgressPreservationSignal,
	summarizeContextEconomySignal,
	summarizeProgressPreservationSignal,
} from "./context-watchdog-progress-signals";

export {
	reconcileAutoResumeHandoffFocus,
	resolveAntiParalysisDispatch,
	resolveCheckpointEvidenceReadyForCalmClose,
	resolveContextEconomySignal,
	resolvePreCompactCalmCloseSignal,
	resolvePreCompactIdlePrepDispatch,
	resolveProgressPreservationSignal,
	summarizeContextEconomySignal,
	summarizeProgressPreservationSignal,
} from "./context-watchdog-progress-signals";

export type {
	AntiParalysisDispatchDecision,
	AutoResumeHandoffFocusReconcileResult,
	ContextEconomyOpportunityKind,
	ContextEconomySignal,
	PreCompactCalmCloseSignal,
	PreCompactIdlePrepDispatch,
	PreCompactIdlePrepDispatchReason,
	ProgressPreservationSignal,
	ProgressPreservationStatus,
} from "./context-watchdog-progress-signals";

const readContextWatchdogSourceMtimeMs = makeContextWatchdogSourceMtimeReader(import.meta.url);

const DEFAULT_CONFIG: ContextWatchdogConfig = DEFAULT_CONTEXT_WATCHDOG_CONFIG;

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
							const resumeStateLabel = autoResumeSnapshot.reason === "reload-required" ? "deferred" : "suppressed";
							ctx.ui.notify(
								`context-watch: auto resume ${resumeStateLabel} (${autoResumeSnapshot.reason})${autoResumeSnapshot.hint ? ` · ${autoResumeSnapshot.hint}` : ""}`,
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

	const statusRuntime = {
		getConfig: () => config,
		setConfig: (next: ContextWatchdogConfig) => { config = next; },
		getThresholdOverrides: () => thresholdOverrides,
		setThresholdOverrides: (next: ContextThresholdOverrides | undefined) => { thresholdOverrides = next; },
		readContextThresholdOverrides,
		buildAssessment: (ctx: ExtensionContext) => buildAssessment(ctx, config, thresholdOverrides),
		run,
		readTimeoutPressureState,
		isReloadRequiredForSourceUpdate,
		clearAutoCompactRetryTimer,
		setLastAssessment: (assessment: ContextWatchAssessment | null) => { lastAssessment = assessment; },
		getLastAutoCompactAt: () => lastAutoCompactAt,
		getAutoCompactInFlight: () => autoCompactInFlight,
		getAutoCompactRetryDueAt: () => autoCompactRetryDueAt,
		hasAutoCompactRetryTimer: () => Boolean(autoCompactRetryTimer),
		getLastAutoResumeDecision: () => lastAutoResumeDecision,
		getLastAutoResumeAt: () => lastAutoResumeAt,
		getLastSteeringSignal: () => lastSteeringSignal,
		getCompactDeferCount: () => compactDeferCount,
		getCompactDeferWindowStartedAt: () => compactDeferWindowStartedAt,
		getLastAntiParalysisNotifyAt: () => lastAntiParalysisNotifyAt,
		getAntiParalysisNotifyCountInWindow: () => antiParalysisNotifyCountInWindow,
		getAnnouncementsInWindow,
		getFinalTurnSuppressionsInWindow,
		resetState: (ctx: ExtensionContext) => {
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
			lastPreCompactPrepNotifyAt = 0;
			announceWindowStartAt = 0;
			announceCountInWindow = 0;
			finalTurnSuppressionCountInWindow = 0;
			lastDeterministicStopSignalAt = 0;
			timeoutPressureWindowStartedAt = 0;
			timeoutPressureCount = 0;
			timeoutPressureLastSeenAt = 0;
			timeoutPressureLastMessage = "";
		},
		applyPreset: (ctx: ExtensionContext, presetInput?: unknown) => buildContextWatchdogApplyPreset(statusRuntime, ctx, presetInput),
		constants: {
			AUTO_COMPACT_RETRY_DELAY_MS,
			SIGNAL_NOISE_WINDOW_MS,
			SIGNAL_NOISE_MAX_ANNOUNCEMENTS,
			FINAL_TURN_CLOSE_HEADROOM_PCT,
			CALM_CLOSE_DEFER_THRESHOLD,
			ANTI_PARALYSIS_GRACE_WINDOW_MS,
			ANTI_PARALYSIS_NOTIFY_COOLDOWN_MS,
			ANTI_PARALYSIS_MAX_NOTIFIES_PER_WINDOW,
		},
	};
	registerContextWatchdogStatusSurface(pi, statusRuntime);
}
