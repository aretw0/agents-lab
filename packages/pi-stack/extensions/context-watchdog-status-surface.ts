import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { ContextThresholdOverrides } from "./custom-footer";
import { applyContextWatchBootstrapToSettings, buildContextWatchBootstrapPlan } from "./context-watchdog-bootstrap";
import { buildAutoCompactDiagnostics } from "./context-watchdog-auto-compact";
import type { ContextWatchdogConfig } from "./context-watchdog-config";
import { normalizeContextWatchdogConfig } from "./context-watchdog-config";
import { formatContextWatchAutoResumePreviewSummary } from "./context-watchdog-continuation";
import { registerContextWatchdogContinuationSurface } from "./context-watchdog-continuation-surface";
import { registerContextWatchdogCheckpointBootstrapSurface } from "./context-watchdog-checkpoint-bootstrap-surface";
import { extractAutoResumePromptValue, readContextWatchFreshnessSignals, summarizeFocusMnemonicsForPreview } from "./context-watchdog-freshness";
import { contextWatchEventAgeMs, latestContextWatchEvent, resolveCompactCheckpointPersistence, summarizeContextWatchEvent, type ContextWatchHandoffReason } from "./context-watchdog-handoff-events";
import { buildAutoResumePromptEnvelopeFromHandoff, formatAutoResumeReloadHintShort, handoffFreshnessAdvice, handoffRefreshMode, resolveHandoffFreshness, summarizeAutoResumePromptDiagnostics, toAgeSec, type AutoResumePromptDiagnostics } from "./context-watchdog-handoff";
import { buildContextWatchOperatorBrief, readProjectPreferredActiveTaskIds, readProjectTaskDescriptionById, readProjectTaskStatusById, toOperatorTaskMnemonic } from "./context-watchdog-operator-brief";
import { describeContextWatchDeterministicStopHint, formatContextWatchSteeringStatus, resolveAutoCompactTimeoutPressureGuard, resolveContextWatchAutoCompactTriggerOrigin, resolveContextWatchDeterministicStopSignal, resolveContextWatchOperatingCadence, resolveContextWatchOperatorActionPlan, resolveContextWatchOperatorSignal, resolveContextWatchSignalNoiseExcessive, type ContextWatchAssessment, type ContextWatchdogLevel } from "./context-watchdog-operator-signals";
import { resolveContextWatchCompactStage } from "./context-watchdog-policy";
import { reconcileAutoResumeHandoffFocus, resolveAntiParalysisDispatch, resolveCheckpointEvidenceReadyForCalmClose, resolveContextEconomySignal, resolvePreCompactCalmCloseSignal, resolveProgressPreservationSignal, summarizeContextEconomySignal, summarizeProgressPreservationSignal } from "./context-watchdog-progress-signals";
import { readAutoResumeAfterReloadIntent } from "./context-watchdog-reload-intent";
import { describeAutoResumeDispatchHint, describeAutoResumeDispatchReason, resolveHandoffPrepDecision, resolvePreCompactReloadSignal, shouldEmitAutoResumeAfterCompact, type AutoResumeDecisionSnapshot } from "./context-watchdog-resume";
import { readHandoffJson, readProjectSettings, writeProjectSettings } from "./context-watchdog-storage";
import { formatContextWatchCommandStatusSummary, formatContextWatchCompactStageStatusSummary, formatContextWatchStatusToolSummary, formatTimeoutPressureSummary, resolveContextWatchAdaptiveStatusSummary } from "./context-watchdog-status-formatting";

export interface ContextWatchdogStatusSurfaceRuntime {
	getConfig(): ContextWatchdogConfig;
	setConfig(config: ContextWatchdogConfig): void;
	getThresholdOverrides(): ContextThresholdOverrides | undefined;
	setThresholdOverrides(overrides: ContextThresholdOverrides | undefined): void;
	readContextThresholdOverrides(cwd: string): ContextThresholdOverrides | undefined;
	buildAssessment(ctx: ExtensionContext): ContextWatchAssessment;
	run(ctx: ExtensionContext, reason: ContextWatchHandoffReason): void;
	readTimeoutPressureState(nowMs: number): any;
	isReloadRequiredForSourceUpdate(): boolean;
	clearAutoCompactRetryTimer(): void;
	setLastAssessment(assessment: ContextWatchAssessment | null): void;
	getLastAutoCompactAt(): number;
	getAutoCompactInFlight(): boolean;
	getAutoCompactRetryDueAt(): number;
	hasAutoCompactRetryTimer(): boolean;
	getLastAutoResumeDecision(): (AutoResumeDecisionSnapshot & { promptDiagnostics?: AutoResumePromptDiagnostics }) | null;
	getLastAutoResumeAt(): number;
	getLastSteeringSignal(): { atIso: string; reason: ContextWatchHandoffReason; level: ContextWatchdogLevel; action: string; delivery: string; notifyEnabled: boolean } | null;
	getCompactDeferCount(): number;
	getCompactDeferWindowStartedAt(): number;
	getLastAntiParalysisNotifyAt(): number;
	getAntiParalysisNotifyCountInWindow(): number;
	getAnnouncementsInWindow(nowMs: number): number;
	getFinalTurnSuppressionsInWindow(nowMs: number): number;
	resetState(ctx: ExtensionContext): void;
	applyPreset(ctx: ExtensionContext, presetInput?: unknown): { preset: string; settingsPath: string; patch: unknown; notes: string[] };
	constants: {
		AUTO_COMPACT_RETRY_DELAY_MS: number;
		SIGNAL_NOISE_WINDOW_MS: number;
		SIGNAL_NOISE_MAX_ANNOUNCEMENTS: number;
		FINAL_TURN_CLOSE_HEADROOM_PCT: number;
		CALM_CLOSE_DEFER_THRESHOLD: number;
		ANTI_PARALYSIS_GRACE_WINDOW_MS: number;
		ANTI_PARALYSIS_NOTIFY_COOLDOWN_MS: number;
		ANTI_PARALYSIS_MAX_NOTIFIES_PER_WINDOW: number;
	};
}

export function buildContextWatchdogApplyPreset(
	runtime: ContextWatchdogStatusSurfaceRuntime,
	ctx: ExtensionContext,
	presetInput?: unknown,
): { preset: string; settingsPath: string; patch: unknown; notes: string[] } {
	const merged = applyContextWatchBootstrapToSettings(
		readProjectSettings(ctx.cwd),
		presetInput,
	);
	const settingsPath = writeProjectSettings(ctx.cwd, merged.settings);
	const piStack = (merged.settings.piStack as Record<string, unknown> | undefined) ?? {};
	runtime.setConfig(normalizeContextWatchdogConfig(piStack.contextWatchdog));
	runtime.setThresholdOverrides(runtime.readContextThresholdOverrides(ctx.cwd));
	runtime.run(ctx, "message_end");
	return {
		preset: merged.preset,
		settingsPath,
		patch: merged.plan.patch,
		notes: merged.plan.notes,
	};
}

export function registerContextWatchdogStatusSurface(pi: ExtensionAPI, runtime: ContextWatchdogStatusSurfaceRuntime): void {
	let lastStatusToolLevel: ContextWatchdogLevel | undefined;
	let lastStatusToolAt = 0;
	const resetLocalStatusState = () => {
		lastStatusToolLevel = undefined;
		lastStatusToolAt = 0;
	};
	function currentAutoCompactState(
		ctx: ExtensionContext,
		assessment: ContextWatchAssessment,
		deferCount = runtime.getCompactDeferCount(),
	) {
		const nowMs = Date.now();
		const handoff = readHandoffJson(ctx.cwd);
		const handoffTimestamp = typeof handoff.timestamp === "string" ? handoff.timestamp : undefined;
		const autoResumeAfterReloadIntent = readAutoResumeAfterReloadIntent(handoff);
		const handoffFreshness = resolveHandoffFreshness(handoffTimestamp, nowMs, runtime.getConfig().handoffFreshMaxAgeMs);
		const handoffFreshnessAgeSec = toAgeSec(handoffFreshness.ageMs);
		const handoffLastEvent = latestContextWatchEvent(handoff);
		const handoffLastEventAgeMs = contextWatchEventAgeMs(handoffLastEvent, nowMs);
		const handoffLastEventAgeSec = toAgeSec(handoffLastEventAgeMs);
		const refreshMode = handoffRefreshMode(handoffFreshness.label, runtime.getConfig().autoResumeAfterCompact);
		const handoffPrep = resolveHandoffPrepDecision(assessment, runtime.getConfig(), handoffFreshness.label);
		const compactCheckpointPersistence = resolveCompactCheckpointPersistence({
			enabled: runtime.getConfig().autoResumeAfterCompact,
			assessmentLevel: assessment.level,
			handoffLastEventLevel: handoffLastEvent?.level,
			handoffLastEventAgeMs,
			maxCheckpointAgeMs: runtime.getConfig().handoffFreshMaxAgeMs,
		});
		const checkpointEvidenceReady = resolveCheckpointEvidenceReadyForCalmClose({
			handoffLastEventLevel: handoffLastEvent?.level,
			handoffLastEventAgeMs,
			maxCheckpointAgeMs: runtime.getConfig().handoffFreshMaxAgeMs,
		});
		const state = buildAutoCompactDiagnostics(assessment, runtime.getConfig(), {
			nowMs,
			lastAutoCompactAt: runtime.getLastAutoCompactAt(),
			inFlight: runtime.getAutoCompactInFlight(),
			isIdle: ctx.isIdle(),
			hasPendingMessages: ctx.hasPendingMessages(),
			checkpointEvidenceReady,
		}, runtime.constants.AUTO_COMPACT_RETRY_DELAY_MS);
		const timeoutPressure = runtime.readTimeoutPressureState(nowMs);
		const timeoutPressureGuard = resolveAutoCompactTimeoutPressureGuard({
			assessmentLevel: assessment.level,
			autoCompactTrigger: state.decision.trigger,
			timeoutPressureActive: timeoutPressure.active,
		});
		const retryInMs = runtime.getAutoCompactRetryDueAt() > 0 ? Math.max(0, runtime.getAutoCompactRetryDueAt() - nowMs) : undefined;
		const calmClose = resolvePreCompactCalmCloseSignal({
			assessmentLevel: assessment.level,
			decisionReason: state.decision.reason,
			checkpointEvidenceReady,
			deferCount,
			deferThreshold: runtime.constants.CALM_CLOSE_DEFER_THRESHOLD,
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
			autoResumeEnabled: runtime.getConfig().autoResumeAfterCompact,
		});
		const lastAutoResumeDecision = runtime.getLastAutoResumeDecision();
		const lastSteeringSignal = runtime.getLastSteeringSignal();
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
			deferWindowStartedAtMs: runtime.getCompactDeferWindowStartedAt(),
			graceWindowMs: runtime.constants.ANTI_PARALYSIS_GRACE_WINDOW_MS,
			lastNotifyAtMs: runtime.getLastAntiParalysisNotifyAt(),
			notifyCooldownMs: runtime.constants.ANTI_PARALYSIS_NOTIFY_COOLDOWN_MS,
			notifiesInWindow: runtime.getAntiParalysisNotifyCountInWindow(),
			maxNotifiesPerWindow: runtime.constants.ANTI_PARALYSIS_MAX_NOTIFIES_PER_WINDOW,
		});
		return {
			...state,
			retryScheduled: Boolean(runtime.hasAutoCompactRetryTimer()),
			retryInMs,
			autoResumeEnabled: runtime.getConfig().autoResumeAfterCompact,
			autoResumeCooldownMs: runtime.getConfig().autoResumeCooldownMs,
			autoResumeReady: shouldEmitAutoResumeAfterCompact(runtime.getConfig(), nowMs, runtime.getLastAutoResumeAt()),
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
			handoffFreshMaxAgeMs: runtime.getConfig().handoffFreshMaxAgeMs,
			handoffTimestamp,
			handoffFreshness,
			handoffFreshnessAgeSec,
			handoffAdvice: handoffFreshnessAdvice(handoffFreshness.label, runtime.getConfig().autoResumeAfterCompact),
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
			antiParalysisNotifyCountInWindow: runtime.getAntiParalysisNotifyCountInWindow(),
			antiParalysisMaxNotifiesPerWindow: runtime.constants.ANTI_PARALYSIS_MAX_NOTIFIES_PER_WINDOW,
			calmCloseRecommendation: calmClose.recommendation,
			compactCheckpointPersistRecommended: compactCheckpointPersistence.shouldPersist,
			compactCheckpointPersistReason: compactCheckpointPersistence.reason,
			timeoutPressure,
			timeoutPressureGuard,
		};
}

	pi.registerTool({
		name: "context_watch_status",
		label: "Context Watch Status",
		description:
			"Non-blocking context-window advisory (warn/checkpoint/compact) with model-aware thresholds.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const assessment = runtime.buildAssessment(ctx);
			runtime.setLastAssessment(assessment);
			const autoCompact = currentAutoCompactState(ctx, assessment);
			const nowMs = Date.now();
			const reloadRequired = runtime.isReloadRequiredForSourceUpdate();
			const preCompactReloadSignal = resolvePreCompactReloadSignal({
				assessmentLevel: assessment.level,
				reloadRequired,
			});
			const operatorSignal = resolveContextWatchOperatorSignal({
				reloadRequired,
				handoffManualRefreshRequired: autoCompact.handoffManualRefreshRequired,
				signalNoiseExcessive: resolveContextWatchSignalNoiseExcessive(
					runtime.getAnnouncementsInWindow(nowMs),
					runtime.constants.SIGNAL_NOISE_MAX_ANNOUNCEMENTS,
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
				windowMs: runtime.constants.SIGNAL_NOISE_WINDOW_MS,
				announcementsInWindow: runtime.getAnnouncementsInWindow(nowMs),
				maxAnnouncementsPerWindow: runtime.constants.SIGNAL_NOISE_MAX_ANNOUNCEMENTS,
				finalTurnSuppressionsInWindow: runtime.getFinalTurnSuppressionsInWindow(nowMs),
				excessive: resolveContextWatchSignalNoiseExcessive(
					runtime.getAnnouncementsInWindow(nowMs),
					runtime.constants.SIGNAL_NOISE_MAX_ANNOUNCEMENTS,
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
				cooldownMs: runtime.getConfig().cooldownMs,
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
					cooldownMs: runtime.getConfig().cooldownMs,
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
			const assessment = runtime.buildAssessment(ctx);
			runtime.setLastAssessment(assessment);
			const nowMs = Date.now();
			const autoCompact = currentAutoCompactState(ctx, assessment);
			const compactStage = resolveContextWatchCompactStage(assessment);
			const signalNoise = {
				windowMs: runtime.constants.SIGNAL_NOISE_WINDOW_MS,
				announcementsInWindow: runtime.getAnnouncementsInWindow(nowMs),
				maxAnnouncementsPerWindow: runtime.constants.SIGNAL_NOISE_MAX_ANNOUNCEMENTS,
				finalTurnSuppressionsInWindow: runtime.getFinalTurnSuppressionsInWindow(nowMs),
				excessive: resolveContextWatchSignalNoiseExcessive(
					runtime.getAnnouncementsInWindow(nowMs),
					runtime.constants.SIGNAL_NOISE_MAX_ANNOUNCEMENTS,
				),
			};
			const reloadRequired = runtime.isReloadRequiredForSourceUpdate();
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
				runtime.getConfig().handoffFreshMaxAgeMs,
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
			const reloadRequired = runtime.isReloadRequiredForSourceUpdate();
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

	registerContextWatchdogContinuationSurface(pi, {
		getConfig: () => runtime.getConfig(),
	});

	registerContextWatchdogCheckpointBootstrapSurface(pi, {
		isReloadRequiredForSourceUpdate: runtime.isReloadRequiredForSourceUpdate,
		applyPreset: runtime.applyPreset,
	});

	pi.registerCommand("context-watch", {
		description: "Show/reset status, show freshness, print bootstrap patch, or apply preset. Usage: /context-watch [status|freshness|reset|bootstrap [control-plane|agent-worker]|apply [control-plane|agent-worker]]",
		handler: async (args, ctx) => {
			const tokens = String(args ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
			const sub = tokens[0] ?? "status";
			if (sub === "reset") {
				runtime.resetState(ctx);
				resetLocalStatusState();
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
				const applied = runtime.applyPreset(ctx, tokens[1]);
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

			const assessment = runtime.buildAssessment(ctx);
			runtime.setLastAssessment(assessment);
			const autoCompact = currentAutoCompactState(ctx, assessment);
			const nowMs = Date.now();
			const reloadRequired = runtime.isReloadRequiredForSourceUpdate();
			const preCompactReloadSignal = resolvePreCompactReloadSignal({
				assessmentLevel: assessment.level,
				reloadRequired,
			});
			const announcementsInWindow = runtime.getAnnouncementsInWindow(nowMs);
			const finalTurnSuppressionsInWindow = runtime.getFinalTurnSuppressionsInWindow(nowMs);
			const signalNoiseExcessive = resolveContextWatchSignalNoiseExcessive(
				announcementsInWindow,
				runtime.constants.SIGNAL_NOISE_MAX_ANNOUNCEMENTS,
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
					`noise=${announcementsInWindow}/${runtime.constants.SIGNAL_NOISE_MAX_ANNOUNCEMENTS} suppressed=${finalTurnSuppressionsInWindow}${signalNoiseExcessive ? " excessive=yes" : " excessive=no"}`,
					"details=context_watch_status structured payload",
				].join("\n"),
				assessment.severity,
			);
		},
	});
}
