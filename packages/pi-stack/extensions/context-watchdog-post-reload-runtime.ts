import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ContextWatchdogConfig } from "./context-watchdog-config";
import {
	buildAutoResumePromptEnvelopeFromHandoff,
	summarizeAutoResumePromptDiagnostics,
	type AutoResumePromptDiagnostics,
} from "./context-watchdog-handoff";
import {
	latestContextWatchEvent,
	contextWatchEventAgeMs,
} from "./context-watchdog-handoff-events";
import {
	readProjectPreferredActiveTaskIds,
	readProjectTaskStatusById,
} from "./context-watchdog-operator-brief";
import {
	clearAutoResumeAfterReloadIntent,
	readAutoResumeAfterReloadIntent,
} from "./context-watchdog-reload-intent";
import {
	buildAutoResumeDecisionSnapshot,
	resolveAutoResumeDispatchDecision,
	resolvePostReloadPendingNotifyDecision,
	shouldNotifyAutoResumeSuppression,
	type AutoResumeDecisionSnapshot,
	type PostReloadPendingNotifyMemory,
} from "./context-watchdog-resume";
import {
	resolveHandoffBoardReconciliation,
} from "./context-watchdog-handoff";
import {
	reconcileAutoResumeHandoffFocus,
	resolveCheckpointEvidenceReadyForCalmClose,
} from "./context-watchdog-progress-signals";
import {
	readDeferredLaneQueueCount,
} from "./context-watchdog-runtime-status";
import {
	readHandoffJson,
	writeHandoffJson,
} from "./context-watchdog-storage";
import type { ContextWatchTimeoutPressureState } from "./context-watchdog-runtime-state";

export interface ContextWatchPostReloadAutoResumeResult {
	postReloadPendingNotifyMemory: PostReloadPendingNotifyMemory;
	lastAutoResumeAt?: number;
	lastAutoResumeDecision?: AutoResumeDecisionSnapshot & {
		promptDiagnostics?: AutoResumePromptDiagnostics;
	};
}

export function handlePostReloadAutoResume(params: {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
	config: ContextWatchdogConfig;
	nowMs: number;
	reloadRequiredAtRunStart: boolean;
	timeoutPressure: ContextWatchTimeoutPressureState;
	postReloadPendingNotifyMemory: PostReloadPendingNotifyMemory;
	postReloadPendingNotifyMinCooldownMs: number;
}): ContextWatchPostReloadAutoResumeResult {
	const { pi, ctx, config, nowMs, reloadRequiredAtRunStart, timeoutPressure } = params;
	let postReloadPendingNotifyMemory = params.postReloadPendingNotifyMemory;
	const handoffForPostReloadResume = readHandoffJson(ctx.cwd);
	const pendingAutoResumeAfterReload = readAutoResumeAfterReloadIntent(handoffForPostReloadResume);
	if (!pendingAutoResumeAfterReload) {
		return { postReloadPendingNotifyMemory: {} };
	}
	if (reloadRequiredAtRunStart) {
		return { postReloadPendingNotifyMemory };
	}

	const hasPendingMessages = ctx.hasPendingMessages();
	const queuedLaneIntents = readDeferredLaneQueueCount(ctx.cwd);
	let handoffForDispatch = handoffForPostReloadResume;
	const taskStatusById = readProjectTaskStatusById(ctx.cwd);
	const preferredTaskIds = readProjectPreferredActiveTaskIds(ctx.cwd, 3);
	let handoffBoardReconciliation = resolveHandoffBoardReconciliation({
		handoff: handoffForDispatch,
		taskStatusById,
		nowMs,
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
				timestamp: new Date(nowMs).toISOString(),
				current_tasks: reconcile.nextFocus,
			};
			writeHandoffJson(ctx.cwd, handoffForDispatch);
			handoffBoardReconciliation = resolveHandoffBoardReconciliation({
				handoff: handoffForDispatch,
				taskStatusById,
				nowMs,
				maxFreshAgeMs: config.handoffFreshMaxAgeMs,
			});
		}
	}
	const handoffEvent = latestContextWatchEvent(handoffForDispatch);
	const checkpointEvidenceReady = resolveCheckpointEvidenceReadyForCalmClose({
		handoffLastEventLevel: handoffEvent?.level,
		handoffLastEventAgeMs: contextWatchEventAgeMs(handoffEvent, nowMs),
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
		nowMs,
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
		postReloadPendingNotifyMemory = {};
		const resumeEnvelope = buildAutoResumePromptEnvelopeFromHandoff(
			handoffForDispatch,
			config.handoffFreshMaxAgeMs,
			nowMs,
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
		return {
			postReloadPendingNotifyMemory,
			lastAutoResumeAt: nowMs,
			lastAutoResumeDecision: autoResumeSnapshot,
		};
	}

	const pendingNotifyDecision = resolvePostReloadPendingNotifyDecision({
		nowMs,
		intentCreatedAtIso: pendingAutoResumeAfterReload.createdAtIso,
		reason: autoResumeSnapshot.reason,
		previous: postReloadPendingNotifyMemory,
		cooldownMs: config.cooldownMs,
		minCooldownMs: params.postReloadPendingNotifyMinCooldownMs,
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
	return {
		postReloadPendingNotifyMemory,
		lastAutoResumeDecision: autoResumeSnapshot,
	};
}
