import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { buildBoardReadinessStatusLabel, evaluateBoardLongRunReadiness } from "./guardrails-core-board-readiness";
import {
  buildLaneQueueHelpLines,
  buildLaneQueueStatusUsage,
  buildLaneQueueBoardNextUsage,
  buildLaneQueueEvidenceUsage,
  buildLaneQueueStatusTips,
  buildLoopActivationMarkersLabel,
  buildLoopActivationBlockerHint,
  clearDeferredIntentQueue,
  dequeueDeferredIntent,
  enqueueDeferredIntent,
  evaluateLaneEvidenceMilestoneParity,
  estimateAutoDrainWaitMs,
  getDeferredIntentQueueCount,
  listDeferredIntents,
  oldestDeferredIntentAgeMs,
  parseLaneQueueAddText,
  parseLaneQueueMilestoneScope,
  resolveAutoDrainGateReason,
  resolveAutoDrainRuntimeGateReason,
  resolveBoardAutoAdvanceGateReason,
  resolveLaneQueueBoardNextMilestoneSelection,
  resolveLongRunLoopStopBoundary,
  resolveDispatchFailureRuntimeGate,
  shouldWarnLaneEvidence,
  type AutoDrainGateReason,
  type LongRunIntentQueueConfig,
  type LongRunLoopRuntimeMode,
  type LongRunLoopRuntimeState,
  type RuntimeCodeActivationState,
} from "./guardrails-core-lane-queue";
import {
  buildProviderRetryExhaustedActionLines,
  buildToolOutputOrphanRecoveryActionLines,
  isProviderTransientRetryExhausted,
  resolveDispatchFailureBlockAfter,
  type DispatchFailureClass,
  type LongRunProviderTransientRetryConfig,
} from "./guardrails-core-provider-retry";
import {
  buildBoardExecuteNextIntent,
  encodeGuardrailsIntent,
  summarizeGuardrailsIntent,
} from "./guardrails-core-intent-bus";
import {
  computeLoopEvidenceReadiness,
  readLoopActivationEvidence,
} from "./guardrails-core-lane-queue-evidence";

export interface GuardrailsLaneQueueSurfaceRuntimeSnapshot {
  lastLongRunBusyAt: number;
  lastAutoDrainAt: number;
  lastBoardAutoAdvanceTaskId?: string;
  lastBoardAutoAdvanceAt: number;
  lastForceNowAt: number;
  lastForceNowTextPreview?: string;
  lastLoopActivationReadyAt: number;
  lastLoopActivationReadyLabel?: string;
  lastDispatchFailureFingerprint?: string;
  lastDispatchFailureClass: DispatchFailureClass;
  lastDispatchFailurePauseAfterUsed: number;
  lastDispatchFailureWindowMsUsed: number;
  identicalDispatchFailureStreak: number;
}

export interface GuardrailsLaneQueueSurfaceRuntime {
  getLongRunIntentQueueConfig(): LongRunIntentQueueConfig;
  getLongRunProviderRetryConfig(): LongRunProviderTransientRetryConfig;
  getLongRunLoopRuntimeState(): LongRunLoopRuntimeState;
  getDiagnosticsSnapshot(): GuardrailsLaneQueueSurfaceRuntimeSnapshot;

  updateLongRunLaneStatus(ctx: ExtensionContext, activeLongRun: boolean, runtimeState?: LongRunLoopRuntimeState): void;
  clearAutoDrainTimer(): void;
  setLoopMode(ctx: ExtensionContext, mode: LongRunLoopRuntimeMode, reason: string): void;
  markLoopHealthy(ctx: ExtensionContext, reason: string): void;
  scheduleAutoDrainDeferredIntent(ctx: ExtensionContext, reason: "agent_end" | "lane_pop" | "idle_timer", delayOverrideMs?: number): void;
  markLoopDispatch(ctx: ExtensionContext, itemId: string): void;
  markLoopDegraded(ctx: ExtensionContext, reason: string, errorText?: string): void;
  trackClassifiedDispatchFailure(ctx: ExtensionContext, reason: string, errorText: string): {
    fingerprint: string;
    streak: number;
    pauseTriggered: boolean;
    errorClass: DispatchFailureClass;
    pauseAfterUsed: number;
    windowMsUsed: number;
  };
  refreshLoopLeaseOnActivity(ctx: ExtensionContext, reason: string, minIntervalMs?: number): void;
  currentRuntimeCodeState(): RuntimeCodeActivationState;
}

export interface RegisterGuardrailsLaneQueueSurfaceInput {
  pi: ExtensionAPI;
  appendAuditEntry: (ctx: ExtensionContext, type: string, payload: Record<string, unknown>) => void;
  runtime: GuardrailsLaneQueueSurfaceRuntime;
}

export function registerGuardrailsLaneQueueSurface(input: RegisterGuardrailsLaneQueueSurfaceInput): void {
  const { pi, appendAuditEntry, runtime } = input;

  pi.registerCommand("lane-queue", {
    description: "Manage deferred intents that should not interrupt the current long-run lane. Usage: /lane-queue [status [--milestone <label>|-m <label>|-m=<label>|--no-milestone]|help|list|add <text>|board-next [--milestone <label>|-m <label>|-m=<label>|--no-milestone]|pop|clear|pause|resume|evidence [--milestone <label>|-m <label>|-m=<label>|--no-milestone]]",
    handler: async (args, ctx) => {
      const rawArgs = String(args ?? "").trim();
      const sub = rawArgs.toLowerCase().split(/\s+/)[0] || "status";
      const knownSubcommands = new Set(["status", "help", "list", "add", "board-next", "pop", "clear", "pause", "resume", "evidence"]);
      const activeLongRun = !ctx.isIdle() || ctx.hasPendingMessages();

      if (sub === "help") {
        ctx.ui.notify(buildLaneQueueHelpLines().join("\n"), "info");
        return;
      }

      if (rawArgs.length > 0 && !knownSubcommands.has(sub)) {
        ctx.ui.notify(
          [`lane-queue: unknown subcommand '${sub}'.`, ...buildLaneQueueHelpLines()].join("\n"),
          "warning",
        );
        return;
      }

      if (sub === "clear") {
        const cleared = clearDeferredIntentQueue(ctx.cwd);
        runtime.updateLongRunLaneStatus(ctx, activeLongRun, runtime.getLongRunLoopRuntimeState());
        ctx.ui.notify(`lane-queue: cleared ${cleared.cleared} item(s).`, "info");
        return;
      }

      if (sub === "pause") {
        runtime.clearAutoDrainTimer();
        runtime.setLoopMode(ctx, "paused", "manual-pause");
        runtime.updateLongRunLaneStatus(ctx, activeLongRun, runtime.getLongRunLoopRuntimeState());
        const state = runtime.getLongRunLoopRuntimeState();
        appendAuditEntry(ctx, "guardrails-core.long-run-loop-mode", {
          atIso: new Date().toISOString(),
          mode: state.mode,
          health: state.health,
          reason: state.lastTransitionReason,
        });
        ctx.ui.notify("lane-queue: long-run loop paused (auto-drain off until resume)", "info");
        return;
      }

      if (sub === "resume") {
        runtime.setLoopMode(ctx, "running", "manual-resume");
        runtime.markLoopHealthy(ctx, "manual-resume");
        runtime.updateLongRunLaneStatus(ctx, activeLongRun, runtime.getLongRunLoopRuntimeState());
        const state = runtime.getLongRunLoopRuntimeState();
        appendAuditEntry(ctx, "guardrails-core.long-run-loop-mode", {
          atIso: new Date().toISOString(),
          mode: state.mode,
          health: state.health,
          reason: state.lastTransitionReason,
        });
        runtime.scheduleAutoDrainDeferredIntent(ctx, "lane_pop");
        ctx.ui.notify("lane-queue: long-run loop resumed", "info");
        return;
      }

      if (sub === "add") {
        const text = parseLaneQueueAddText(rawArgs);
        if (!text) {
          ctx.ui.notify("lane-queue: usage /lane-queue add <text> (tip: /lane-queue help)", "warning");
          return;
        }

        const queueConfig = runtime.getLongRunIntentQueueConfig();
        const queued = enqueueDeferredIntent(
          ctx.cwd,
          text,
          "interactive-command",
          queueConfig.maxItems,
        );
        appendAuditEntry(ctx, "guardrails-core.long-run-intent-queued", {
          atIso: new Date().toISOString(),
          itemId: queued.itemId,
          queuedCount: queued.queuedCount,
          queuePath: queued.queuePath,
          activeLongRun,
          manual: true,
        });
        runtime.updateLongRunLaneStatus(ctx, activeLongRun, runtime.getLongRunLoopRuntimeState());
        ctx.ui.notify(`lane-queue: queued ${queued.itemId} (total=${queued.queuedCount})`, "info");
        return;
      }

      if (sub === "board-next") {
        const queueConfig = runtime.getLongRunIntentQueueConfig();
        const parsedBoardNext = parseLaneQueueMilestoneScope(rawArgs);
        if (parsedBoardNext.error) {
          ctx.ui.notify(`lane-queue: usage ${buildLaneQueueBoardNextUsage()}`, "warning");
          return;
        }
        const boardNextSelection = resolveLaneQueueBoardNextMilestoneSelection(parsedBoardNext, queueConfig.defaultBoardMilestone);
        const boardNextMilestone = boardNextSelection.milestone;
        const boardReadiness = evaluateBoardLongRunReadiness(ctx.cwd, { sampleLimit: 5, milestone: boardNextMilestone });
        if (!boardReadiness.ready || !boardReadiness.nextTaskId) {
          appendAuditEntry(ctx, "guardrails-core.board-intent-blocked", {
            atIso: new Date().toISOString(),
            reason: boardReadiness.reason,
            recommendation: boardReadiness.recommendation,
            blockedByDependencies: boardReadiness.blockedByDependencies,
            planned: boardReadiness.totals.planned,
            milestone: boardNextMilestone,
            milestoneSource: boardNextSelection.source,
          });
          ctx.ui.notify([
            `lane-queue: board-next blocked (${boardReadiness.reason}${boardNextMilestone ? `; milestone=${boardNextMilestone}` : ""})`,
            `boardHint: ${boardReadiness.recommendation}`,
          ].join("\n"), "warning");
          return;
        }
        const nextTaskId = boardReadiness.nextTaskId;
        if (activeLongRun) {
          const queuedIntent = buildBoardExecuteNextIntent(boardNextMilestone);
          const queuedText = encodeGuardrailsIntent(queuedIntent);
          const queuedSummary = summarizeGuardrailsIntent(queuedIntent);
          const queued = enqueueDeferredIntent(
            ctx.cwd,
            queuedText,
            "board-first-intent",
            queueConfig.maxItems,
            {
              dedupeKey: queuedText,
              dedupeWindowMs: queueConfig.dedupeWindowMs,
            },
          );
          appendAuditEntry(ctx, "guardrails-core.board-intent-queued", {
            atIso: new Date().toISOString(),
            itemId: queued.itemId,
            taskId: nextTaskId,
            queuePath: queued.queuePath,
            queuedCount: queued.queuedCount,
            selectionPolicy: boardReadiness.selectionPolicy,
            milestone: boardNextMilestone,
            milestoneSource: boardNextSelection.source,
            intentType: queuedIntent.type,
            intentVersion: queuedIntent.version,
            intentSummary: queuedSummary,
            deduped: queued.deduped,
          });
          runtime.updateLongRunLaneStatus(ctx, activeLongRun, runtime.getLongRunLoopRuntimeState());
          ctx.ui.notify(
            queued.deduped
              ? `lane-queue: board-next intent já estava na fila (next=${nextTaskId}; total=${queued.queuedCount})`
              : `lane-queue: board-next queued next=${nextTaskId} (total=${queued.queuedCount})`,
            "info",
          );
          return;
        }

        const intent = buildBoardExecuteNextIntent(boardNextMilestone);
        const intentText = encodeGuardrailsIntent(intent);
        const intentSummary = summarizeGuardrailsIntent(intent);
        appendAuditEntry(ctx, "guardrails-core.board-intent-dispatch", {
          atIso: new Date().toISOString(),
          taskId: nextTaskId,
          selectionPolicy: boardReadiness.selectionPolicy,
          milestone: boardNextMilestone,
          milestoneSource: boardNextSelection.source,
          deliverAs: "followUp",
          intentType: intent.type,
          intentVersion: intent.version,
          intentSummary,
        });
        ctx.ui.notify(`lane-queue: board-next dispatch ${nextTaskId}`, "info");
        try {
          pi.sendUserMessage(intentText, { deliverAs: "followUp" });
          runtime.markLoopDispatch(ctx, `board-${nextTaskId}`);
          runtime.scheduleAutoDrainDeferredIntent(ctx, "lane_pop");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error ?? "unknown-error");
          const fallbackIntent = buildBoardExecuteNextIntent(boardNextMilestone);
          const fallbackText = encodeGuardrailsIntent(fallbackIntent);
          const fallbackSummary = summarizeGuardrailsIntent(fallbackIntent);
          const queued = enqueueDeferredIntent(
            ctx.cwd,
            fallbackText,
            "board-first-intent-fallback",
            queueConfig.maxItems,
            {
              dedupeKey: fallbackText,
              dedupeWindowMs: queueConfig.dedupeWindowMs,
            },
          );
          runtime.markLoopDegraded(ctx, "board-intent-dispatch-failed", message);
          const failureTrack = runtime.trackClassifiedDispatchFailure(ctx, "board-intent-dispatch-failed", message);
          const errorClass = failureTrack.errorClass;
          appendAuditEntry(ctx, "guardrails-core.board-intent-dispatch-failed", {
            atIso: new Date().toISOString(),
            taskId: nextTaskId,
            error: message,
            errorClass,
            errorFingerprint: failureTrack.fingerprint,
            identicalFailureStreak: failureTrack.streak,
            pauseAfterUsed: failureTrack.pauseAfterUsed,
            windowMsUsed: failureTrack.windowMsUsed,
            pauseTriggered: failureTrack.pauseTriggered,
            fallbackQueued: true,
            queuedCount: queued.queuedCount,
            deduped: queued.deduped,
            selectionPolicy: boardReadiness.selectionPolicy,
            milestone: boardNextMilestone,
            milestoneSource: boardNextSelection.source,
            intentType: fallbackIntent.type,
            intentVersion: fallbackIntent.version,
            intentSummary: fallbackSummary,
          });
          ctx.ui.notify(
            queued.deduped
              ? `lane-queue: board-next dispatch failed (${message}). fallback já estava em fila para next=${nextTaskId} (total=${queued.queuedCount})`
              : `lane-queue: board-next dispatch failed (${message}). fallback queued next=${nextTaskId} (total=${queued.queuedCount})`,
            "warning",
          );
        }
        return;
      }

      if (sub === "list") {
        const items = listDeferredIntents(ctx.cwd);
        if (items.length === 0) {
          ctx.ui.notify("lane-queue: empty", "info");
          return;
        }
        const lines = [
          `lane-queue: ${items.length} pending`,
          ...items.slice(-10).map((item) => `- ${item.id} ${item.atIso} :: ${item.text.slice(0, 120)}`),
        ];
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      if (sub === "evidence") {
        const evidenceMilestoneParsed = parseLaneQueueMilestoneScope(rawArgs);
        if (evidenceMilestoneParsed.error) {
          ctx.ui.notify(`lane-queue: usage ${buildLaneQueueEvidenceUsage()}`, "warning");
          return;
        }
        const queueConfig = runtime.getLongRunIntentQueueConfig();
        const evidenceMilestoneSelection = resolveLaneQueueBoardNextMilestoneSelection(evidenceMilestoneParsed, queueConfig.defaultBoardMilestone);
        const boardReadiness = evaluateBoardLongRunReadiness(ctx.cwd, { sampleLimit: 3, milestone: evidenceMilestoneSelection.milestone });
        const evidence = readLoopActivationEvidence(ctx.cwd);
        const loopReady = evidence.lastLoopReady;
        const boardAuto = evidence.lastBoardAutoAdvance;
        const readiness = computeLoopEvidenceReadiness(evidence);
        const milestoneParity = evaluateLaneEvidenceMilestoneParity(evidenceMilestoneSelection.milestone, boardAuto?.milestone, loopReady?.milestone);
        const lines = [
          "lane-queue: loop evidence",
          `updatedAt: ${evidence.updatedAtIso}`,
          `statusMilestone: ${evidenceMilestoneSelection.milestone ?? "n/a"}@${evidenceMilestoneSelection.source}`,
          `boardReadiness: ${buildBoardReadinessStatusLabel(boardReadiness)}`,
          `readyForLoopEvidence: ${readiness.readyForLoopEvidence ? "yes" : "no"}`,
          `readyForTaskBud125(deprecated): ${readiness.readyForTaskBud125 ? "yes" : "no"}`,
          `scopeParity: expected=${milestoneParity.expectedMilestone ?? "n/a"} boardAuto=${milestoneParity.boardAutoMilestone ?? "n/a"} loopReady=${milestoneParity.loopReadyMilestone ?? "n/a"} matches=${milestoneParity.matches ? "yes" : "no"} reason=${milestoneParity.reason}`,
          boardAuto
            ? `boardAuto: task=${boardAuto.taskId}${boardAuto.milestone ? ` milestone=${boardAuto.milestone}` : ""} at=${boardAuto.atIso} runtime=${boardAuto.runtimeCodeState} emLoop=${boardAuto.emLoop ? "yes" : "no"}`
            : "boardAuto: n/a",
          loopReady
            ? `loopReady: at=${loopReady.atIso}${loopReady.milestone ? ` milestone=${loopReady.milestone}` : ""} runtime=${loopReady.runtimeCodeState} gate=${loopReady.boardAutoAdvanceGate} next=${loopReady.nextTaskId ?? "n/a"}`
            : "loopReady: n/a",
          `criteria: ${readiness.criteria.join(" | ")}`,
          ...(boardReadiness.ready ? [] : [`boardHint: ${boardReadiness.recommendation}`]),
        ];
        appendAuditEntry(ctx, "guardrails-core.loop-evidence-status", {
          atIso: new Date().toISOString(),
          readyForLoopEvidence: readiness.readyForLoopEvidence,
          readyForTaskBud125: readiness.readyForTaskBud125,
          statusMilestone: evidenceMilestoneSelection.milestone,
          statusMilestoneSource: evidenceMilestoneSelection.source,
          boardReadiness,
          milestoneParity,
          boardAuto,
          loopReady,
          criteria: readiness.criteria,
        });
        ctx.ui.notify(lines.join("\n"), shouldWarnLaneEvidence(readiness.readyForLoopEvidence, milestoneParity) ? "warning" : "info");
        return;
      }

      if (sub === "pop") {
        if (activeLongRun) {
          ctx.ui.notify("lane-queue: long-run still active; pop blocked to avoid focus drift.", "warning");
          return;
        }
        const popped = dequeueDeferredIntent(ctx.cwd);
        runtime.updateLongRunLaneStatus(ctx, false, runtime.getLongRunLoopRuntimeState());
        if (!popped.item) {
          ctx.ui.notify("lane-queue: empty", "info");
          return;
        }
        appendAuditEntry(ctx, "guardrails-core.long-run-intent-pop", {
          atIso: new Date().toISOString(),
          itemId: popped.item.id,
          queuedCount: popped.queuedCount,
        });
        ctx.ui.notify(`lane-queue: dispatching ${popped.item.id}`, "info");
        pi.sendUserMessage(popped.item.text, { deliverAs: "followUp" });
        runtime.markLoopDispatch(ctx, popped.item.id);
        runtime.scheduleAutoDrainDeferredIntent(ctx, "lane_pop");
        return;
      }

      if (activeLongRun) {
        runtime.refreshLoopLeaseOnActivity(ctx, "lane-status-lease-heartbeat", 10_000);
      }
      const queueConfig = runtime.getLongRunIntentQueueConfig();
      const providerRetryConfig = runtime.getLongRunProviderRetryConfig();
      const state = runtime.getLongRunLoopRuntimeState();
      const diagnostics = runtime.getDiagnosticsSnapshot();
      const items = listDeferredIntents(ctx.cwd);
      const queued = items.length;
      const nowMs = Date.now();
      const idleSinceMs = Math.max(0, nowMs - diagnostics.lastLongRunBusyAt);
      const dispatchFailureBlockAfter = resolveDispatchFailureBlockAfter(
        state,
        queueConfig.dispatchFailureBlockAfter,
        providerRetryConfig,
      );
      const stopBoundary = resolveLongRunLoopStopBoundary(
        state,
        dispatchFailureBlockAfter,
      );
      const dispatchFailureGate = resolveDispatchFailureRuntimeGate(
        state,
        dispatchFailureBlockAfter,
      );
      const runtimeGate = resolveAutoDrainRuntimeGateReason(
        resolveAutoDrainGateReason(
          activeLongRun,
          queued,
          nowMs,
          diagnostics.lastAutoDrainAt,
          idleSinceMs,
          queueConfig,
        ),
        state,
        nowMs,
      );
      const gate: AutoDrainGateReason =
        dispatchFailureGate === "dispatch-failure-blocking"
          ? "dispatch-failure-blocking"
          : runtimeGate;
      const providerRetryExhausted =
        gate === "dispatch-failure-blocking" &&
        isProviderTransientRetryExhausted(
          state,
          dispatchFailureBlockAfter,
          providerRetryConfig,
        );
      const waitMs = estimateAutoDrainWaitMs(
        activeLongRun,
        queued,
        nowMs,
        diagnostics.lastAutoDrainAt,
        idleSinceMs,
        queueConfig,
      );
      const oldestAgeMs = oldestDeferredIntentAgeMs(items, nowMs);
      const nextDrain = gate === "lease-expired"
        ? "stopped:lease-expired"
        : gate === "dispatch-failure-blocking"
          ? providerRetryExhausted
            ? "stopped:retry-exhausted"
            : "stopped:dispatch-failure"
          : activeLongRun
            ? "after-idle"
            : waitMs === undefined
              ? "n/a"
              : waitMs === 0
                ? "now"
                : `${Math.ceil(waitMs / 1000)}s`;
      const oldest = oldestAgeMs === undefined ? "n/a" : `${Math.ceil(oldestAgeMs / 1000)}s`;
      const loopError = state.lastError
        ? ` lastError=${state.lastError.slice(0, 120)}`
        : "";
      const providerRetryPolicy = providerRetryConfig.enabled
        ? `${providerRetryConfig.maxAttempts}x@${Math.ceil(providerRetryConfig.baseDelayMs / 1000)}s→${Math.ceil(providerRetryConfig.maxDelayMs / 1000)}s`
        : "off";
      const statusMilestoneParsed = parseLaneQueueMilestoneScope(rawArgs);
      if (statusMilestoneParsed.error) {
        ctx.ui.notify(`lane-queue: usage ${buildLaneQueueStatusUsage()}`, "warning");
        return;
      }
      const statusMilestoneSelection = resolveLaneQueueBoardNextMilestoneSelection(statusMilestoneParsed, queueConfig.defaultBoardMilestone);
      const boardReadiness = evaluateBoardLongRunReadiness(ctx.cwd, { sampleLimit: 3, milestone: statusMilestoneSelection.milestone });
      const boardReadinessLabel = buildBoardReadinessStatusLabel(boardReadiness);
      const autoAdvanceDedupeMs = Math.max(30_000, queueConfig.autoDrainIdleStableMs * 4);
      const boardAutoGate = resolveBoardAutoAdvanceGateReason({
        activeLongRun,
        queuedCount: queued,
        loopMode: state.mode,
        loopHealth: state.health,
        stopCondition: state.stopCondition,
        boardReady: boardReadiness.ready,
        nextTaskId: boardReadiness.nextTaskId,
        nowMs,
        lastTaskId: diagnostics.lastBoardAutoAdvanceTaskId,
        lastTaskAtMs: diagnostics.lastBoardAutoAdvanceAt,
        dedupeWindowMs: autoAdvanceDedupeMs,
      });
      const boardAutoLast = diagnostics.lastBoardAutoAdvanceTaskId
        ? `${diagnostics.lastBoardAutoAdvanceTaskId}@${Math.max(0, Math.ceil((nowMs - diagnostics.lastBoardAutoAdvanceAt) / 1000))}s`
        : "n/a";
      const laneNowLast = diagnostics.lastForceNowAt > 0
        ? `${Math.max(0, Math.ceil((nowMs - diagnostics.lastForceNowAt) / 1000))}s${diagnostics.lastForceNowTextPreview ? ` text='${diagnostics.lastForceNowTextPreview}'` : ""}`
        : "n/a";
      const runtimeCodeState: RuntimeCodeActivationState = runtime.currentRuntimeCodeState();
      const loopEvidence = readLoopActivationEvidence(ctx.cwd);
      const loopMarkers = resolveLoopActivationMarkers({
        activeLongRun,
        queuedCount: queued,
        loopMode: state.mode,
        loopHealth: state.health,
        stopCondition: state.stopCondition,
        boardReady: boardReadiness.ready,
        nextTaskId: boardReadiness.nextTaskId,
        boardAutoGate,
        runtimeCodeState,
      });
      const loopMarkersLabel = buildLoopActivationMarkersLabel(loopMarkers);
      const loopBlockerHint = buildLoopActivationBlockerHint(loopMarkers);
      const loopReadyLast = diagnostics.lastLoopActivationReadyAt > 0
        ? `${Math.max(0, Math.ceil((nowMs - diagnostics.lastLoopActivationReadyAt) / 1000))}s`
        : "n/a";
      const evidenceBoardAuto = loopEvidence.lastBoardAutoAdvance;
      const evidenceBoardAutoAge = evidenceBoardAuto
        ? `${Math.max(0, Math.ceil((nowMs - Date.parse(evidenceBoardAuto.atIso)) / 1000))}s`
        : "n/a";
      const evidenceBoardAutoSummary = evidenceBoardAuto
        ? `${evidenceBoardAuto.taskId}${evidenceBoardAuto.milestone ? `[${evidenceBoardAuto.milestone}]` : ""}@${evidenceBoardAutoAge} runtime=${evidenceBoardAuto.runtimeCodeState} emLoop=${evidenceBoardAuto.emLoop ? "yes" : "no"}`
        : "n/a";
      const evidenceLoopReady = loopEvidence.lastLoopReady;
      const evidenceLoopReadyAge = evidenceLoopReady
        ? `${Math.max(0, Math.ceil((nowMs - Date.parse(evidenceLoopReady.atIso)) / 1000))}s`
        : "n/a";
      const evidenceLoopReadySummary = evidenceLoopReady
        ? `${evidenceLoopReadyAge}${evidenceLoopReady.milestone ? ` milestone=${evidenceLoopReady.milestone}` : ""} runtime=${evidenceLoopReady.runtimeCodeState} gate=${evidenceLoopReady.boardAutoAdvanceGate}`
        : "n/a";
      const failSignature = !diagnostics.lastDispatchFailureFingerprint
        ? "n/a"
        : diagnostics.lastDispatchFailureFingerprint.length > 72
          ? `${diagnostics.lastDispatchFailureFingerprint.slice(0, 72)}…`
          : diagnostics.lastDispatchFailureFingerprint;
      const failClass = diagnostics.lastDispatchFailureFingerprint ? diagnostics.lastDispatchFailureClass : "n/a";
      const failPolicy = diagnostics.lastDispatchFailureFingerprint
        && diagnostics.lastDispatchFailurePauseAfterUsed > 0
        && diagnostics.lastDispatchFailureWindowMsUsed > 0
        ? `${diagnostics.lastDispatchFailurePauseAfterUsed}@${diagnostics.lastDispatchFailureWindowMsUsed}ms`
        : "n/a";

      ctx.ui.notify(
        [
          `lane-queue: ${activeLongRun ? "active" : "idle"} queued=${queued} oldest=${oldest} autoDrain=${queueConfig.autoDrainOnIdle ? "on" : "off"} batch=${queueConfig.autoDrainBatchSize} cooldownMs=${queueConfig.autoDrainCooldownMs} idleStableMs=${queueConfig.autoDrainIdleStableMs} rapidWindowMs=${queueConfig.rapidRedispatchWindowMs} dedupeWindowMs=${queueConfig.dedupeWindowMs} defaultMilestone=${queueConfig.defaultBoardMilestone ?? "n/a"} statusMilestone=${statusMilestoneSelection.milestone ?? "n/a"}@${statusMilestoneSelection.source} gate=${gate} nextDrain=${nextDrain} stop=${state.stopCondition}/${stopBoundary} failStreak=${state.consecutiveDispatchFailures}/${dispatchFailureBlockAfter} identicalFail=${diagnostics.identicalDispatchFailureStreak}/${queueConfig.identicalFailurePauseAfter}@${queueConfig.identicalFailureWindowMs}ms orphanPauseAfter=${queueConfig.orphanFailurePauseAfter}@${queueConfig.orphanFailureWindowMs}ms failClass=${failClass} failPolicy=${failPolicy} failSig=${failSignature} providerRetry=${providerRetryPolicy} runtimeCode=${runtimeCodeState} ${boardReadinessLabel} boardAutoGate=${boardAutoGate} boardAutoLast=${boardAutoLast} laneNowLast=${laneNowLast} loopReadyLast=${loopReadyLast} evidenceBoardAuto=${evidenceBoardAutoSummary} evidenceLoopReady=${evidenceLoopReadySummary} ${loopMarkersLabel} loop=${state.mode}/${state.health} transition=${state.lastTransitionReason}${loopError}`,
          ...(boardReadiness.ready ? [] : [`boardHint: ${boardReadiness.recommendation}`]),
          ...(boardReadiness.ready && boardReadiness.eligibleTaskIds.length > 0
            ? [`boardNext: ${boardReadiness.eligibleTaskIds.join(", ")}`]
            : []),
          ...(providerRetryExhausted ? buildProviderRetryExhaustedActionLines() : []),
          ...(diagnostics.lastDispatchFailureClass === "tool-output-orphan" ? buildToolOutputOrphanRecoveryActionLines() : []),
          ...(runtimeCodeState === "reload-required"
            ? ["runtimeCodeHint: local guardrails-core mudou após session_start; faça reload para ativar tudo aqui no control plane."]
            : []),
          ...(loopBlockerHint ? [loopBlockerHint] : []),
          ...(diagnostics.lastLoopActivationReadyLabel ? [`loopReadyLabel: ${diagnostics.lastLoopActivationReadyLabel}`] : []),
          ...buildLaneQueueStatusTips(queued),
        ].join("\n"),
        "info",
      );
    },
  });
}
