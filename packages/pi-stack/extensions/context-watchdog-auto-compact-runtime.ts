import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ContextWatchdogConfig } from "./context-watchdog-config";
import {
	buildAutoResumePromptEnvelopeFromHandoff,
	resolveHandoffBoardReconciliation,
	summarizeAutoResumePromptDiagnostics,
	type AutoResumePromptDiagnostics,
} from "./context-watchdog-handoff";
import {
	contextWatchEventAgeMs,
	latestContextWatchEvent,
} from "./context-watchdog-handoff-events";
import {
	readProjectPreferredActiveTaskIds,
	readProjectTaskStatusById,
} from "./context-watchdog-operator-brief";
import {
	clearAutoResumeAfterReloadIntent,
	withAutoResumeAfterReloadIntent,
} from "./context-watchdog-reload-intent";
import {
	applyEmergencyContextWindowFallbackConfig,
	isContextWindowOverflowErrorMessage,
} from "./context-watchdog-runtime-helpers";
import {
	readDeferredLaneQueueCount,
} from "./context-watchdog-runtime-status";
import {
	buildAutoResumeDecisionSnapshot,
	resolveAutoResumeDispatchDecision,
	shouldEmitAutoResumeAfterCompact,
	shouldNotifyAutoResumeSuppression,
	type AutoResumeDecisionSnapshot,
} from "./context-watchdog-resume";
import {
	reconcileAutoResumeHandoffFocus,
	resolveCheckpointEvidenceReadyForCalmClose,
} from "./context-watchdog-progress-signals";
import {
	readHandoffJson,
	writeHandoffJson,
} from "./context-watchdog-storage";
import type {
	ContextWatchTimeoutPressureEvent,
	ContextWatchTimeoutPressureState,
} from "./context-watchdog-runtime-state";

export interface ContextWatchAutoCompactCompleteResult {
	lastAutoResumeAt?: number;
	lastAutoResumeDecision?: AutoResumeDecisionSnapshot & {
		promptDiagnostics?: AutoResumePromptDiagnostics;
	};
}

export function handleAutoCompactComplete(params: {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
	config: ContextWatchdogConfig;
	lastAutoResumeAt: number;
	lastInputAt: number;
	lastAutoCompactTriggerAt: number;
	readTimeoutPressureState: (nowMs: number) => ContextWatchTimeoutPressureState;
	isReloadRequiredForSourceUpdate: () => boolean;
}): ContextWatchAutoCompactCompleteResult {
	const { pi, ctx, config } = params;
	ctx.ui.notify("context-watch: auto compact completed", "info");
	const nowAfterCompact = Date.now();
	const hasPendingMessages = ctx.hasPendingMessages();
	const hasRecentSteerInput = params.lastInputAt > params.lastAutoCompactTriggerAt;
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
	const timeoutPressureAfterCompact = params.readTimeoutPressureState(nowAfterCompact);
	const autoResumeReady = shouldEmitAutoResumeAfterCompact(config, nowAfterCompact, params.lastAutoResumeAt);
	const reloadRequired = params.isReloadRequiredForSourceUpdate();
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
		return { lastAutoResumeAt: nowAfterCompact, lastAutoResumeDecision: autoResumeSnapshot };
	}
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
	return { lastAutoResumeDecision: autoResumeSnapshot };
}

export function handleAutoCompactError(params: {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
	config: ContextWatchdogConfig;
	error: { message?: unknown } | undefined;
	recordTimeoutPressure: (message: string, nowMs: number) => ContextWatchTimeoutPressureEvent;
}): { config: ContextWatchdogConfig } {
	const { pi, ctx } = params;
	let config = params.config;
	const nowOnError = Date.now();
	const message = String(params.error?.message ?? "unknown-error");
	const timeoutPressureEvent = params.recordTimeoutPressure(message, nowOnError);
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
	return { config };
}
