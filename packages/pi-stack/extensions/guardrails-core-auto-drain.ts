import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { evaluateBoardLongRunReadiness } from "./guardrails-core-board-readiness";
import type { GuardrailsCoreAppendAuditEntry } from "./guardrails-core-surface-registration";
import { buildBoardExecuteNextIntent, encodeGuardrailsIntent, summarizeGuardrailsIntent } from "./guardrails-core-intent-bus";
import {
	buildLoopActivationMarkersLabel,
	computeIdenticalFailureStreak,
	dequeueDeferredIntent,
	enqueueDeferredIntent,
	getDeferredIntentQueueCount,
	resolveAutoDrainGateReason,
	resolveAutoDrainRetryDelayMs,
	resolveAutoDrainRuntimeGateReason,
	resolveBoardAutoAdvanceGateReason,
	resolveDispatchFailureRuntimeGate,
	resolveLoopActivationMarkers,
	shouldAutoAdvanceBoardTask,
	shouldAutoDrainDeferredIntent,
	shouldBlockRapidSameTaskRedispatch,
	shouldEmitAutoDrainDeferredAudit,
	shouldEmitBoardAutoAdvanceGateAudit,
	shouldEmitLoopActivationAudit,
	shouldAnnounceLoopActivationReady,
	shouldSchedulePostDispatchAutoDrain,
	type AutoDrainGateReason,
	type BoardAutoAdvanceGateReason,
	type LongRunIntentQueueConfig,
	type LongRunLoopRuntimeState,
	type RuntimeCodeActivationState,
} from "./guardrails-core-lane-queue";
import {
	buildProviderRetryExhaustedActionLines,
	resolveDispatchFailureBlockAfter,
	resolveDispatchFailurePauseAfter,
	resolveDispatchFailureWindowMs,
	resolveProviderTransientRetryDelayMs,
	resolveToolOutputOrphanRedispatchDecision,
	isProviderTransientRetryExhausted,
	type DispatchFailureClass,
	type LongRunProviderTransientRetryConfig,
} from "./guardrails-core-provider-retry";

export type GuardrailsCoreAutoDrainReason = "agent_end" | "lane_pop" | "idle_timer";

export interface GuardrailsCoreDispatchFailureTrackResult {
	fingerprint: string;
	streak: number;
	pauseTriggered: boolean;
	errorClass: DispatchFailureClass;
	pauseAfterUsed: number;
	windowMsUsed: number;
}

export interface GuardrailsCoreAutoDrainState {
	longRunIntentQueueConfig: LongRunIntentQueueConfig;
	longRunProviderRetryConfig: LongRunProviderTransientRetryConfig;
	longRunLoopRuntimeState: LongRunLoopRuntimeState;
	lastLongRunBusyAt: number;
	lastAutoDrainAt: number;
	lastAutoDrainDeferredAuditAt: number;
	lastAutoDrainDeferredGate: AutoDrainGateReason | undefined;
	lastBoardAutoAdvanceTaskId: string | undefined;
	lastBoardAutoAdvanceAt: number;
	lastBoardAutoAdvanceGateAuditAt: number;
	lastBoardAutoAdvanceGate: BoardAutoAdvanceGateReason | undefined;
	lastLoopActivationAuditAt: number;
	lastLoopActivationLabel: string | undefined;
	lastLoopActivationEmLoop: boolean;
	lastLoopActivationReadyAt: number;
	lastLoopActivationReadyLabel: string | undefined;
}

export interface GuardrailsCoreAutoDrainRuntime {
	pi: ExtensionAPI;
	appendAuditEntry: GuardrailsCoreAppendAuditEntry;
	state: GuardrailsCoreAutoDrainState;
	updateLongRunLaneStatus(ctx: ExtensionContext, activeLongRun: boolean, runtimeState?: LongRunLoopRuntimeState): void;
	scheduleAutoDrainDeferredIntent(ctx: ExtensionContext, reason: GuardrailsCoreAutoDrainReason, delayOverrideMs?: number): void;
	markLoopDispatch(ctx: ExtensionContext, itemId: string): void;
	markLoopHealthy(ctx: ExtensionContext, reason: string): void;
	markLoopDegraded(ctx: ExtensionContext, reason: string, errorText?: string): void;
	trackDispatchFailureFingerprint(ctx: ExtensionContext, reason: string, errorText: string, options?: { errorClass?: DispatchFailureClass; pauseAfterOverride?: number; windowMsOverride?: number }): GuardrailsCoreDispatchFailureTrackResult;
	trackClassifiedDispatchFailure(ctx: ExtensionContext, reason: string, errorText: string): GuardrailsCoreDispatchFailureTrackResult;
	trackToolOutputOrphanCallId(errorText: string): ReturnType<typeof resolveToolOutputOrphanRedispatchDecision>;
	recordLoopReadyEvidence(ctx: ExtensionContext, markersLabel: string, runtimeCodeState: RuntimeCodeActivationState, boardAutoAdvanceGate: BoardAutoAdvanceGateReason, nextTaskId?: string, milestone?: string): void;
	recordBoardAutoAdvanceEvidence(ctx: ExtensionContext, taskId: string, milestone: string | undefined, runtimeCodeState: RuntimeCodeActivationState, markersLabel: string, emLoop: boolean): void;
	refreshLoopEvidenceHeartbeat(ctx: ExtensionContext, markersLabel: string, runtimeCodeState: RuntimeCodeActivationState, boardAutoAdvanceGate: BoardAutoAdvanceGateReason, nextTaskId?: string, milestone?: string): void;
	currentRuntimeCodeState(): RuntimeCodeActivationState;
}

export function createGuardrailsCoreAutoDrain(runtime: GuardrailsCoreAutoDrainRuntime): (ctx: ExtensionContext, reason: GuardrailsCoreAutoDrainReason) => boolean {
	const {
		pi,
		appendAuditEntry,
		state,
		updateLongRunLaneStatus,
		scheduleAutoDrainDeferredIntent,
		markLoopDispatch,
		markLoopHealthy,
		markLoopDegraded,
		trackDispatchFailureFingerprint,
		trackClassifiedDispatchFailure,
		trackToolOutputOrphanCallId,
		recordLoopReadyEvidence,
		recordBoardAutoAdvanceEvidence,
		refreshLoopEvidenceHeartbeat,
		currentRuntimeCodeState,
	} = runtime;

	function tryAutoDrainDeferredIntent(ctx: ExtensionContext, reason: GuardrailsCoreAutoDrainReason): boolean {
	  const activeLongRun = !ctx.isIdle() || ctx.hasPendingMessages();
	  const queuedCount = getDeferredIntentQueueCount(ctx.cwd);
	  const nowMs = Date.now();
	  const runtimeCodeState = currentRuntimeCodeState();
	  const idleSinceMs = Math.max(0, nowMs - state.lastLongRunBusyAt);
	  const dispatchFailureBlockAfter = resolveDispatchFailureBlockAfter(
	    state.longRunLoopRuntimeState,
	    state.longRunIntentQueueConfig.dispatchFailureBlockAfter,
	    state.longRunProviderRetryConfig,
	  );
	
	  if (state.longRunLoopRuntimeState.mode === "paused") {
	    updateLongRunLaneStatus(ctx, activeLongRun, state.longRunLoopRuntimeState);
	    return false;
	  }
	
	  const dispatchFailureGate = resolveDispatchFailureRuntimeGate(
	    state.longRunLoopRuntimeState,
	    dispatchFailureBlockAfter,
	  );
	  if (dispatchFailureGate === "dispatch-failure-advisory" && queuedCount > 0) {
	    if (shouldEmitAutoDrainDeferredAudit(
	      state.lastAutoDrainDeferredAuditAt,
	      state.lastAutoDrainDeferredGate,
	      dispatchFailureGate,
	      nowMs,
	      Math.max(1_000, state.longRunIntentQueueConfig.autoDrainIdleStableMs),
	    )) {
	      appendAuditEntry(ctx, "guardrails-core.long-run-intent-auto-drain-advisory", {
	        atIso: new Date().toISOString(),
	        reason,
	        gate: dispatchFailureGate,
	        queuedCount,
	        stopCondition: state.longRunLoopRuntimeState.stopCondition,
	        stopReason: state.longRunLoopRuntimeState.stopReason,
	      });
	      state.lastAutoDrainDeferredAuditAt = nowMs;
	    }
	    state.lastAutoDrainDeferredGate = dispatchFailureGate;
	  }
	
	  const runtimeGate = resolveAutoDrainRuntimeGateReason(
	    resolveAutoDrainGateReason(
	      activeLongRun,
	      queuedCount,
	      nowMs,
	      state.lastAutoDrainAt,
	      idleSinceMs,
	      state.longRunIntentQueueConfig,
	    ),
	    state.longRunLoopRuntimeState,
	    nowMs,
	  );
	  const gate: AutoDrainGateReason =
	    dispatchFailureGate === "dispatch-failure-blocking"
	      ? "dispatch-failure-blocking"
	      : runtimeGate;
	  const providerRetryExhausted =
	    gate === "dispatch-failure-blocking" &&
	    isProviderTransientRetryExhausted(
	      state.longRunLoopRuntimeState,
	      dispatchFailureBlockAfter,
	      state.longRunProviderRetryConfig,
	    );
	
	  if (gate === "lease-expired" || gate === "dispatch-failure-blocking") {
	    if (shouldEmitAutoDrainDeferredAudit(
	      state.lastAutoDrainDeferredAuditAt,
	      state.lastAutoDrainDeferredGate,
	      gate,
	      nowMs,
	      Math.max(1_000, state.longRunIntentQueueConfig.autoDrainIdleStableMs),
	    )) {
	      appendAuditEntry(ctx, "guardrails-core.long-run-intent-auto-drain-stopped", {
	        atIso: new Date().toISOString(),
	        reason,
	        gate,
	        queuedCount,
	        stopCondition: state.longRunLoopRuntimeState.stopCondition,
	        stopReason: state.longRunLoopRuntimeState.stopReason,
	        leaseOwner: state.longRunLoopRuntimeState.leaseOwner,
	        leaseExpiresAtIso: state.longRunLoopRuntimeState.leaseExpiresAtIso,
	        consecutiveDispatchFailures: state.longRunLoopRuntimeState.consecutiveDispatchFailures,
	        blockAfterFailures: dispatchFailureBlockAfter,
	        providerRetryExhausted,
	        actionHint: providerRetryExhausted
	          ? "provider transient retry exhausted"
	          : undefined,
	        actionLines: providerRetryExhausted
	          ? buildProviderRetryExhaustedActionLines()
	          : undefined,
	      });
	      state.lastAutoDrainDeferredAuditAt = nowMs;
	    }
	    state.lastAutoDrainDeferredGate = gate;
	    updateLongRunLaneStatus(ctx, activeLongRun, state.longRunLoopRuntimeState);
	    return false;
	  }
	
	  const retryDelayMs = resolveAutoDrainRetryDelayMs(
	    activeLongRun,
	    queuedCount,
	    nowMs,
	    state.lastAutoDrainAt,
	    idleSinceMs,
	    state.longRunIntentQueueConfig,
	  );
	  if (retryDelayMs !== undefined) {
	    scheduleAutoDrainDeferredIntent(ctx, "idle_timer", retryDelayMs);
	    if (shouldEmitAutoDrainDeferredAudit(
	      state.lastAutoDrainDeferredAuditAt,
	      state.lastAutoDrainDeferredGate,
	      gate,
	      nowMs,
	      Math.max(1_000, state.longRunIntentQueueConfig.autoDrainIdleStableMs),
	    )) {
	      appendAuditEntry(ctx, "guardrails-core.long-run-intent-auto-drain-deferred", {
	        atIso: new Date().toISOString(),
	        reason,
	        gate,
	        queuedCount,
	        retryDelayMs,
	      });
	      state.lastAutoDrainDeferredAuditAt = nowMs;
	    }
	    state.lastAutoDrainDeferredGate = gate;
	    updateLongRunLaneStatus(ctx, activeLongRun, state.longRunLoopRuntimeState);
	    return false;
	  }
	
	  state.lastAutoDrainDeferredGate = undefined;
	
	  const boardReadiness = evaluateBoardLongRunReadiness(ctx.cwd, { sampleLimit: 3, milestone: state.longRunIntentQueueConfig.defaultBoardMilestone });
	  const autoAdvanceDedupeMs = Math.max(
	    30_000,
	    state.longRunIntentQueueConfig.autoDrainIdleStableMs * 4,
	  );
	  const boardAutoAdvanceGate = resolveBoardAutoAdvanceGateReason({
	    activeLongRun,
	    queuedCount,
	    loopMode: state.longRunLoopRuntimeState.mode,
	    loopHealth: state.longRunLoopRuntimeState.health,
	    stopCondition: state.longRunLoopRuntimeState.stopCondition,
	    boardReady: boardReadiness.ready,
	    nextTaskId: boardReadiness.nextTaskId,
	    nowMs,
	    lastTaskId: state.lastBoardAutoAdvanceTaskId,
	    lastTaskAtMs: state.lastBoardAutoAdvanceAt,
	    dedupeWindowMs: autoAdvanceDedupeMs,
	  });
	  const boardAutoAdvanceAllowed = shouldAutoAdvanceBoardTask({
	    activeLongRun,
	    queuedCount,
	    loopMode: state.longRunLoopRuntimeState.mode,
	    loopHealth: state.longRunLoopRuntimeState.health,
	    stopCondition: state.longRunLoopRuntimeState.stopCondition,
	    boardReady: boardReadiness.ready,
	    nextTaskId: boardReadiness.nextTaskId,
	    nowMs,
	    lastTaskId: state.lastBoardAutoAdvanceTaskId,
	    lastTaskAtMs: state.lastBoardAutoAdvanceAt,
	    dedupeWindowMs: autoAdvanceDedupeMs,
	  });
	  const loopMarkers = resolveLoopActivationMarkers({
	    activeLongRun,
	    queuedCount,
	    loopMode: state.longRunLoopRuntimeState.mode,
	    loopHealth: state.longRunLoopRuntimeState.health,
	    stopCondition: state.longRunLoopRuntimeState.stopCondition,
	    boardReady: boardReadiness.ready,
	    nextTaskId: boardReadiness.nextTaskId,
	    boardAutoGate: boardAutoAdvanceGate,
	    runtimeCodeState,
	  });
	  const loopMarkersLabel = buildLoopActivationMarkersLabel(loopMarkers);
	  if (shouldEmitLoopActivationAudit(
	    state.lastLoopActivationAuditAt,
	    state.lastLoopActivationLabel,
	    loopMarkersLabel,
	    nowMs,
	    Math.max(1_000, state.longRunIntentQueueConfig.autoDrainIdleStableMs),
	  )) {
	    appendAuditEntry(ctx, "guardrails-core.loop-activation-state", {
	      atIso: new Date().toISOString(),
	      reason,
	      markers: loopMarkers,
	      markersLabel: loopMarkersLabel,
	      runtimeCodeState,
	      boardAutoAdvanceGate,
	      boardReady: boardReadiness.ready,
	      nextTaskId: boardReadiness.nextTaskId,
	      queuedCount,
	    });
	    state.lastLoopActivationAuditAt = nowMs;
	  }
	  state.lastLoopActivationLabel = loopMarkersLabel;
	  const announceLoopReady = shouldAnnounceLoopActivationReady(
	    state.lastLoopActivationEmLoop,
	    loopMarkers.emLoop,
	  );
	  if (announceLoopReady) {
	    appendAuditEntry(ctx, "guardrails-core.loop-activation-ready", {
	      atIso: new Date().toISOString(),
	      reason,
	      markers: loopMarkers,
	      markersLabel: loopMarkersLabel,
	      runtimeCodeState,
	      boardAutoAdvanceGate,
	      nextTaskId: boardReadiness.nextTaskId,
	    });
	    recordLoopReadyEvidence(
	      ctx,
	      loopMarkersLabel,
	      runtimeCodeState,
	      boardAutoAdvanceGate,
	      boardReadiness.nextTaskId,
	      boardReadiness.milestone,
	    );
	    state.lastLoopActivationReadyAt = nowMs;
	    state.lastLoopActivationReadyLabel = loopMarkersLabel;
	    ctx.ui.notify(`loop-ready: ${loopMarkersLabel}`, "info");
	  }
	  state.lastLoopActivationEmLoop = loopMarkers.emLoop;
	
	  if (loopMarkers.emLoop) {
	    refreshLoopEvidenceHeartbeat(
	      ctx,
	      loopMarkersLabel,
	      runtimeCodeState,
	      boardAutoAdvanceGate,
	      boardReadiness.nextTaskId,
	      boardReadiness.milestone,
	    );
	  }
	
	  if (boardAutoAdvanceGate === "ready" && boardAutoAdvanceAllowed) {
	    const nextTaskId = boardReadiness.nextTaskId ?? "";
	    if (!nextTaskId) {
	      appendAuditEntry(ctx, "guardrails-core.board-intent-auto-advance-blocked", {
	        atIso: new Date().toISOString(),
	        reason,
	        boardReason: boardReadiness.reason,
	        nextTaskId: boardReadiness.nextTaskId,
	        selectionPolicy: boardReadiness.selectionPolicy,
	        runtimeCodeState,
	      });
	      updateLongRunLaneStatus(ctx, activeLongRun, state.longRunLoopRuntimeState);
	      return false;
	    }
	
	    const intent = buildBoardExecuteNextIntent(boardReadiness.milestone); const intentText = encodeGuardrailsIntent(intent);
	    const intentSummary = summarizeGuardrailsIntent(intent);
	
	    // Detect silent execution failure: same task dispatched again within the rapid
	    // re-dispatch window. Happens when a compacted session leaves orphaned
	    // function_call_output messages that cause pi to error on execution without
	    // the dispatch itself throwing (so consecutiveDispatchFailures stays at 0).
	    if (shouldBlockRapidSameTaskRedispatch({
	      taskId: nextTaskId,
	      lastDispatchItemId: state.longRunLoopRuntimeState.lastDispatchItemId,
	      lastDispatchAtIso: state.longRunLoopRuntimeState.lastDispatchAtIso,
	      nowMs,
	      windowMs: state.longRunIntentQueueConfig.rapidRedispatchWindowMs,
	    })) {
	      const sinceMs = nowMs - new Date(state.longRunLoopRuntimeState.lastDispatchAtIso!).getTime();
	      const message = `task ${nextTaskId} re-dispatched ${Math.round(sinceMs / 1000)}s after last — possible silent execution failure (orphaned function_call_output?)`;
	      markLoopDegraded(ctx, `board-auto-rapid-redispatch:${nextTaskId}`, message);
	      const failureTrack = trackDispatchFailureFingerprint(ctx, `board-auto-rapid-redispatch:${nextTaskId}`, message, {
	        errorClass: "tool-output-orphan",
	        pauseAfterOverride: resolveDispatchFailurePauseAfter("tool-output-orphan", state.longRunIntentQueueConfig.identicalFailurePauseAfter, state.longRunIntentQueueConfig.orphanFailurePauseAfter),
	        windowMsOverride: resolveDispatchFailureWindowMs("tool-output-orphan", state.longRunIntentQueueConfig.identicalFailureWindowMs, state.longRunIntentQueueConfig.orphanFailureWindowMs),
	      });
	      appendAuditEntry(ctx, "guardrails-core.board-intent-rapid-redispatch-blocked", {
	        atIso: new Date(nowMs).toISOString(),
	        reason,
	        taskId: nextTaskId,
	        sinceLastDispatchMs: sinceMs,
	        rapidRedispatchWindowMs: state.longRunIntentQueueConfig.rapidRedispatchWindowMs,
	        consecutiveFailuresNow: state.longRunLoopRuntimeState.consecutiveDispatchFailures,
	        errorClass: failureTrack.errorClass,
	        errorFingerprint: failureTrack.fingerprint,
	        identicalFailureStreak: failureTrack.streak,
	        pauseAfterUsed: failureTrack.pauseAfterUsed,
	        windowMsUsed: failureTrack.windowMsUsed,
	        pauseTriggered: failureTrack.pauseTriggered,
	        runtimeCodeState,
	      });
	      updateLongRunLaneStatus(ctx, activeLongRun, state.longRunLoopRuntimeState);
	      if (!failureTrack.pauseTriggered) ctx.ui.notify(`lane-queue: rapid re-dispatch blocked for ${nextTaskId} (${Math.round(sinceMs / 1000)}s since last dispatch) — possible silent execution failure. Investigate session state then run: npm run pi:loop:resume`, "warning");
	      return false;
	    }
	
	    try {
	      pi.sendUserMessage(intentText, { deliverAs: "followUp" });
	      appendAuditEntry(ctx, "guardrails-core.board-intent-auto-advance", {
	        atIso: new Date().toISOString(),
	        reason,
	        taskId: nextTaskId,
	        selectionPolicy: boardReadiness.selectionPolicy,
	        milestone: boardReadiness.milestone,
	        intentType: intent.type,
	        intentVersion: intent.version,
	        intentSummary,
	        runtimeCodeState,
	        loopMarkers,
	        loopMarkersLabel,
	      });
	      state.lastBoardAutoAdvanceTaskId = nextTaskId;
	      state.lastBoardAutoAdvanceAt = nowMs;
	      state.lastAutoDrainAt = nowMs;
	      recordBoardAutoAdvanceEvidence(
	        ctx,
	        nextTaskId,
	        boardReadiness.milestone,
	        runtimeCodeState,
	        loopMarkersLabel,
	        loopMarkers.emLoop,
	      );
	      markLoopDispatch(ctx, `board-auto-${nextTaskId}`);
	      updateLongRunLaneStatus(ctx, false, state.longRunLoopRuntimeState);
	      ctx.ui.notify(
	        runtimeCodeState === "reload-required"
	          ? `lane-queue: auto-advance board task ${nextTaskId} (runtimeCode=${runtimeCodeState}; considere reload para ativar código mais novo)`
	          : `lane-queue: auto-advance board task ${nextTaskId}`,
	        "info",
	      );
	      return true;
	    } catch (error) {
	      const message = error instanceof Error ? error.message : String(error ?? "unknown-error");
	      const orphanCall = trackToolOutputOrphanCallId(message);
	      const retryDiscarded = orphanCall.repeated;
	      const queued = retryDiscarded
	        ? { queuedCount: getDeferredIntentQueueCount(ctx.cwd), deduped: false }
	        : enqueueDeferredIntent(
	          ctx.cwd,
	          intentText,
	          "board-auto-advance-fallback",
	          state.longRunIntentQueueConfig.maxItems,
	          {
	            dedupeKey: intentText,
	            dedupeWindowMs: state.longRunIntentQueueConfig.dedupeWindowMs,
	          },
	        );
	      markLoopDegraded(ctx, "board-auto-advance-dispatch-failed", message);
	      const failureTrack = trackClassifiedDispatchFailure(ctx, "board-auto-advance-dispatch-failed", message);
	      const errorClass = failureTrack.errorClass;
	      if (retryDiscarded) {
	        appendAuditEntry(ctx, "guardrails-core.tool-output-orphan-redispatch-discarded", {
	          atIso: new Date().toISOString(),
	          reason,
	          source: "board-auto-advance",
	          taskId: nextTaskId,
	          callId: orphanCall.callId,
	          errorClass,
	          action: "discard-retry-before-redispatch",
	        });
	      }
	      appendAuditEntry(ctx, "guardrails-core.board-intent-auto-advance-failed", {
	        atIso: new Date().toISOString(),
	        reason,
	        taskId: nextTaskId,
	        error: message,
	        errorClass,
	        errorFingerprint: failureTrack.fingerprint,
	        identicalFailureStreak: failureTrack.streak,
	        pauseAfterUsed: failureTrack.pauseAfterUsed,
	        windowMsUsed: failureTrack.windowMsUsed,
	        pauseTriggered: failureTrack.pauseTriggered,
	        toolOutputOrphanCallId: orphanCall.callId,
	        repeatedToolOutputOrphanCallId: orphanCall.repeated,
	        retryDiscarded,
	        queuedCount: queued.queuedCount,
	        deduped: queued.deduped,
	        selectionPolicy: boardReadiness.selectionPolicy,
	        intentType: intent.type,
	        intentVersion: intent.version,
	        intentSummary,
	        runtimeCodeState,
	        loopMarkers,
	        loopMarkersLabel,
	      });
	      if (!failureTrack.pauseTriggered) scheduleAutoDrainDeferredIntent(ctx, "idle_timer", state.longRunIntentQueueConfig.autoDrainIdleStableMs);
	      updateLongRunLaneStatus(ctx, activeLongRun, state.longRunLoopRuntimeState);
	      return false;
	    }
	  }
	
	  if (boardAutoAdvanceGate !== "ready") {
	    if (shouldEmitBoardAutoAdvanceGateAudit(
	      state.lastBoardAutoAdvanceGateAuditAt,
	      state.lastBoardAutoAdvanceGate,
	      boardAutoAdvanceGate,
	      nowMs,
	      Math.max(1_000, state.longRunIntentQueueConfig.autoDrainIdleStableMs),
	    )) {
	      appendAuditEntry(ctx, "guardrails-core.board-intent-auto-advance-deferred", {
	        atIso: new Date().toISOString(),
	        reason,
	        boardAutoAdvanceGate,
	        boardReady: boardReadiness.ready,
	        boardReason: boardReadiness.reason,
	        queuedCount,
	        nextTaskId: boardReadiness.nextTaskId,
	        selectionPolicy: boardReadiness.selectionPolicy,
	        runtimeCodeState,
	        loopMarkers,
	        loopMarkersLabel,
	      });
	      state.lastBoardAutoAdvanceGateAuditAt = nowMs;
	    }
	    state.lastBoardAutoAdvanceGate = boardAutoAdvanceGate;
	  } else {
	    state.lastBoardAutoAdvanceGate = "ready";
	    state.lastBoardAutoAdvanceGateAuditAt = nowMs;
	  }
	
	  if (!boardReadiness.nextTaskId || !boardReadiness.ready || boardReadiness.nextTaskId !== state.lastBoardAutoAdvanceTaskId) {
	    state.lastBoardAutoAdvanceTaskId = undefined;
	    state.lastBoardAutoAdvanceAt = 0;
	  }
	
	  if (!shouldAutoDrainDeferredIntent(activeLongRun, queuedCount, nowMs, state.lastAutoDrainAt, idleSinceMs, state.longRunIntentQueueConfig)) {
	    updateLongRunLaneStatus(ctx, activeLongRun, state.longRunLoopRuntimeState);
	    return false;
	  }
	
	  const maxBatch = Math.max(1, state.longRunIntentQueueConfig.autoDrainBatchSize);
	  let dispatched = 0;
	
	  while (dispatched < maxBatch) {
	    const popped = dequeueDeferredIntent(ctx.cwd);
	    if (!popped.item) break;
	
	    appendAuditEntry(ctx, "guardrails-core.long-run-intent-auto-pop", {
	      atIso: new Date().toISOString(),
	      itemId: popped.item.id,
	      reason,
	      queuedCount: popped.queuedCount,
	      batchIndex: dispatched + 1,
	      batchSize: maxBatch,
	    });
	
	    try {
	      pi.sendUserMessage(popped.item.text, { deliverAs: "followUp" });
	      markLoopDispatch(ctx, popped.item.id);
	      dispatched += 1;
	    } catch (error) {
	      const message = error instanceof Error ? error.message : String(error ?? "unknown-error");
	      const orphanCall = trackToolOutputOrphanCallId(message);
	      const retryDiscarded = orphanCall.repeated;
	      const retryQueued = retryDiscarded
	        ? { queuedCount: getDeferredIntentQueueCount(ctx.cwd), deduped: false }
	        : enqueueDeferredIntent(
	          ctx.cwd,
	          popped.item.text,
	          `auto-drain-retry:${reason}`,
	          state.longRunIntentQueueConfig.maxItems,
	          {
	            dedupeKey: popped.item.text,
	            dedupeWindowMs: state.longRunIntentQueueConfig.dedupeWindowMs,
	          },
	        );
	      markLoopDegraded(ctx, `dispatch-failed:${reason}`, message);
	      const failureTrack = trackClassifiedDispatchFailure(ctx, `dispatch-failed:${reason}`, message);
	      const errorClass = failureTrack.errorClass;
	      if (retryDiscarded) {
	        appendAuditEntry(ctx, "guardrails-core.tool-output-orphan-redispatch-discarded", {
	          atIso: new Date().toISOString(),
	          reason,
	          source: "auto-drain",
	          itemId: popped.item.id,
	          callId: orphanCall.callId,
	          errorClass,
	          action: "discard-retry-before-redispatch",
	        });
	      }
	      const retryDelayMs =
	        errorClass === "provider-transient" && state.longRunProviderRetryConfig.enabled
	          ? resolveProviderTransientRetryDelayMs(
	            state.longRunLoopRuntimeState.consecutiveDispatchFailures,
	            state.longRunProviderRetryConfig,
	          )
	          : state.longRunIntentQueueConfig.autoDrainIdleStableMs;
	      appendAuditEntry(ctx, "guardrails-core.long-run-intent-auto-dispatch-failed", {
	        atIso: new Date().toISOString(),
	        reason,
	        itemId: popped.item.id,
	        error: message,
	        errorFingerprint: failureTrack.fingerprint,
	        identicalFailureStreak: failureTrack.streak,
	        pauseTriggered: failureTrack.pauseTriggered,
	        errorClass,
	        pauseAfterUsed: failureTrack.pauseAfterUsed,
	        windowMsUsed: failureTrack.windowMsUsed,
	        toolOutputOrphanCallId: orphanCall.callId,
	        repeatedToolOutputOrphanCallId: orphanCall.repeated,
	        retryDiscarded,
	        retryDelayMs,
	        retryQueuedCount: retryQueued.queuedCount,
	        retryDeduped: retryQueued.deduped,
	      });
	      if (!failureTrack.pauseTriggered) scheduleAutoDrainDeferredIntent(ctx, "idle_timer", retryDelayMs);
	      updateLongRunLaneStatus(ctx, activeLongRun, state.longRunLoopRuntimeState);
	      return false;
	    }
	
	    if (!ctx.isIdle() || ctx.hasPendingMessages()) {
	      break;
	    }
	  }
	
	  if (dispatched <= 0) {
	    updateLongRunLaneStatus(ctx, activeLongRun, state.longRunLoopRuntimeState);
	    return false;
	  }
	
	  const remainingQueuedCount = getDeferredIntentQueueCount(ctx.cwd);
	  if (shouldSchedulePostDispatchAutoDrain(dispatched, remainingQueuedCount)) {
	    scheduleAutoDrainDeferredIntent(ctx, "idle_timer");
	    appendAuditEntry(ctx, "guardrails-core.long-run-intent-auto-drain-backstop", {
	      atIso: new Date().toISOString(),
	      reason,
	      dispatched,
	      remainingQueuedCount,
	    });
	  }
	
	  state.lastAutoDrainAt = nowMs;
	  markLoopHealthy(ctx, "auto-drain-dispatch");
	  updateLongRunLaneStatus(ctx, false, state.longRunLoopRuntimeState);
	  ctx.ui.notify(`lane-queue: auto-dispatch ${dispatched} item(s)`, "info");
	  return true;
	}

	return tryAutoDrainDeferredIntent;
}
