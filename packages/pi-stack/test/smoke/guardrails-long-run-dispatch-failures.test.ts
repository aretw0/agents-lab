import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearDeferredIntentQueue,
  dequeueDeferredIntent,
  enqueueDeferredIntent,
  estimateAutoDrainWaitMs,
  listDeferredIntents,
  oldestDeferredIntentAgeMs,
  parseLaneQueueAddText,
  parseLaneQueueMilestoneScope,
  parseLaneQueueBoardNextMilestone,
  resolveLaneQueueBoardNextMilestoneSelection,
  evaluateLaneEvidenceMilestoneParity,
  shouldWarnLaneEvidence,
  buildLaneQueueHelpLines,
  buildLaneQueueStatusUsage,
  buildLaneQueueBoardNextUsage,
  buildLaneQueueEvidenceUsage,
  buildLaneQueueStatusTips,
  resolveAutoDrainGateReason,
  resolveAutoDrainRuntimeGateReason,
  resolveLongRunLoopStopBoundary,
  resolveDispatchFailureRuntimeGate,
  resolveAutoDrainRetryDelayMs,
  resolveLongRunIntentQueueConfig,
  extractForceNowText,
  resolvePragmaticAutonomyConfig,
  resolveGuardrailsRuntimeConfigSpec,
  coerceGuardrailsRuntimeConfigValue,
  readGuardrailsRuntimeConfigSnapshot,
  buildGuardrailsRuntimeConfigSetResult,
  resolveBloatSmellConfig,
  shouldAutoDrainDeferredIntent,
  shouldQueueInputForLongRun,
  buildPragmaticAutonomySystemPrompt,
  summarizeAssumptionText,
  evaluateTextBloatSmell,
  evaluateCodeBloatSmell,
  evaluateWideSingleFileSlice,
  estimateCodeBloatFromEditInput,
  estimateCodeBloatFromWriteInput,
  extractAssistantTextFromTurnMessage,
  buildTextBloatStatusLabel,
  buildCodeBloatStatusLabel,
  buildWideSingleFileSliceStatusLabel,
  shouldEmitBloatSmellSignal,
  shouldSchedulePostDispatchAutoDrain,
  resolveBoardAutoAdvanceGateReason,
  resolveLoopActivationMarkers,
  buildLoopActivationMarkersLabel,
  shouldAnnounceLoopActivationReady,
  buildLoopActivationBlockerHint,
  shouldAutoAdvanceBoardTask,
  resolveRuntimeCodeActivationState,
  shouldEmitAutoDrainDeferredAudit,
  shouldEmitBoardAutoAdvanceGateAudit,
  shouldEmitLoopActivationAudit,
  computeLoopEvidenceReadiness,
  shouldRefreshLoopEvidenceFromRuntimeSnapshot,
  readLongRunLoopRuntimeState,
  setLongRunLoopRuntimeMode,
  markLongRunLoopRuntimeDegraded,
  markLongRunLoopRuntimeDispatch,
  markLongRunLoopRuntimeHealthy,
  buildProviderRetryExhaustedActionLines,
  buildToolOutputOrphanRecoveryActionLines,
  classifyLongRunDispatchFailure,
  extractToolOutputOrphanCallId,
  resolveToolOutputOrphanRedispatchDecision,
  isProviderTransientRetryExhausted,
  resolveDispatchFailureBlockAfter,
  resolveDispatchFailurePauseAfter,
  resolveDispatchFailureWindowMs,
  resolveLongRunProviderTransientRetryConfig,
  resolveProviderTransientRetryDelayMs,
  shouldBlockRapidSameTaskRedispatch,
  BOARD_RAPID_REDISPATCH_WINDOW_MS,
  normalizeDispatchFailureFingerprint,
  computeIdenticalFailureStreak,
  shouldPauseOnIdenticalFailure,
} from "../../extensions/guardrails-core";


describe("guardrails-core long-run dispatch failure gates", () => {
  it("classifies stop-condition boundary as blocking vs advisory", () => {
    expect(resolveLongRunLoopStopBoundary({ mode: "running", stopCondition: "none" })).toBe("none");
    expect(resolveLongRunLoopStopBoundary({ mode: "running", stopCondition: "dispatch-failure" })).toBe("advisory");
    expect(
      resolveLongRunLoopStopBoundary({ mode: "running", stopCondition: "dispatch-failure", consecutiveDispatchFailures: 3 }),
    ).toBe("blocking");
    expect(
      resolveLongRunLoopStopBoundary(
        { mode: "running", stopCondition: "dispatch-failure", consecutiveDispatchFailures: 3 },
        5,
      ),
    ).toBe("advisory");
    expect(resolveLongRunLoopStopBoundary({ mode: "running", stopCondition: "lease-expired" })).toBe("blocking");
    expect(resolveLongRunLoopStopBoundary({ mode: "paused", stopCondition: "manual-pause" })).toBe("blocking");
  });

  it("resolves dispatch-failure runtime gate based on failure streak threshold", () => {
    expect(resolveDispatchFailureRuntimeGate({ mode: "running", stopCondition: "none" }, 3)).toBeUndefined();
    expect(
      resolveDispatchFailureRuntimeGate(
        { mode: "running", stopCondition: "dispatch-failure", consecutiveDispatchFailures: 2 },
        3,
      ),
    ).toBe("dispatch-failure-advisory");
    expect(
      resolveDispatchFailureRuntimeGate(
        { mode: "running", stopCondition: "dispatch-failure", consecutiveDispatchFailures: 3 },
        3,
      ),
    ).toBe("dispatch-failure-blocking");
  });

  it("supports prolonged advisory retries when threshold is configured to 10", () => {
    const threshold = 10;
    for (let failures = 1; failures < threshold; failures += 1) {
      expect(
        resolveDispatchFailureRuntimeGate(
          { mode: "running", stopCondition: "dispatch-failure", consecutiveDispatchFailures: failures },
          threshold,
        ),
      ).toBe("dispatch-failure-advisory");
      expect(
        resolveLongRunLoopStopBoundary(
          { mode: "running", stopCondition: "dispatch-failure", consecutiveDispatchFailures: failures },
          threshold,
        ),
      ).toBe("advisory");
    }

    expect(
      resolveDispatchFailureRuntimeGate(
        { mode: "running", stopCondition: "dispatch-failure", consecutiveDispatchFailures: threshold },
        threshold,
      ),
    ).toBe("dispatch-failure-blocking");
    expect(
      resolveLongRunLoopStopBoundary(
        { mode: "running", stopCondition: "dispatch-failure", consecutiveDispatchFailures: threshold },
        threshold,
      ),
    ).toBe("blocking");
  });

  it("classifies provider transient errors and escalates block threshold to retry budget", () => {
    expect(classifyLongRunDispatchFailure("server_is_overload")).toBe("provider-transient");
    expect(classifyLongRunDispatchFailure("HTTP 429 too many requests")).toBe("provider-transient");
    expect(classifyLongRunDispatchFailure("No tool call found for function call output with call_id call_abc123")).toBe("tool-output-orphan");
    expect(classifyLongRunDispatchFailure("unexpected parser error")).toBe("other");
    expect(extractToolOutputOrphanCallId("No tool call found for function call output with call_id call_abc123")).toBe("call_abc123");
    expect(extractToolOutputOrphanCallId("No tool call found for function call output with tool_call_id='call_QJlU6a2DGglAm3NntokWyBwo'")).toBe("call_QJlU6a2DGglAm3NntokWyBwo");
    expect(extractToolOutputOrphanCallId("No tool call found for function call output with call_QJlU6a2DGglAm3NntokWyBwo after compact")).toBe("call_QJlU6a2DGglAm3NntokWyBwo");
    expect(extractToolOutputOrphanCallId("server_is_overload call_abc123")).toBeUndefined();

    const firstOrphan = resolveToolOutputOrphanRedispatchDecision(new Set(), "No tool call found for function call output with call_id call_QJlU6a2DGglAm3NntokWyBwo");
    expect(firstOrphan).toMatchObject({
      callId: "call_QJlU6a2DGglAm3NntokWyBwo",
      repeated: false,
      retryDiscarded: false,
      action: "allow-retry",
    });
    const repeatedOrphan = resolveToolOutputOrphanRedispatchDecision(new Set(["call_QJlU6a2DGglAm3NntokWyBwo"]), "No tool call found for function call output with call_id call_QJlU6a2DGglAm3NntokWyBwo after Session compacted 4 times");
    expect(repeatedOrphan).toMatchObject({
      callId: "call_QJlU6a2DGglAm3NntokWyBwo",
      repeated: true,
      retryDiscarded: true,
      action: "discard-retry-before-redispatch",
    });
    expect(resolveDispatchFailurePauseAfter("tool-output-orphan", 3)).toBe(1);
    expect(resolveDispatchFailurePauseAfter("tool-output-orphan", 3, 2)).toBe(2);
    expect(resolveDispatchFailurePauseAfter("provider-transient", 3)).toBe(3);
    expect(resolveDispatchFailurePauseAfter("other", 0)).toBe(3);
    expect(resolveDispatchFailureWindowMs("tool-output-orphan", 120_000, 70_000)).toBe(70_000);
    expect(resolveDispatchFailureWindowMs("provider-transient", 120_000, 70_000)).toBe(120_000);

    const cfg = {
      enabled: true,
      maxAttempts: 10,
      baseDelayMs: 1000,
      maxDelayMs: 8000,
      backoffMultiplier: 2,
    };

    expect(
      resolveDispatchFailureBlockAfter({ lastError: "server_is_overload" }, 3, cfg),
    ).toBe(10);
    expect(resolveDispatchFailureBlockAfter({ lastError: "bad json" }, 3, cfg)).toBe(3);

    expect(
      isProviderTransientRetryExhausted(
        { consecutiveDispatchFailures: 10, lastError: "server_is_overload" },
        10,
        cfg,
      ),
    ).toBe(true);
    expect(
      isProviderTransientRetryExhausted(
        { consecutiveDispatchFailures: 9, lastError: "server_is_overload" },
        10,
        cfg,
      ),
    ).toBe(false);
    expect(
      isProviderTransientRetryExhausted(
        { consecutiveDispatchFailures: 11, lastError: "bad json" },
        10,
        cfg,
      ),
    ).toBe(false);

    const actionLines = buildProviderRetryExhaustedActionLines();
    expect(actionLines).toHaveLength(3);
    expect(actionLines.join("\n")).toContain("/provider-readiness-matrix");
    expect(actionLines.join("\n")).toContain("/lane-queue resume");

    const orphanActions = buildToolOutputOrphanRecoveryActionLines();
    expect(orphanActions).toHaveLength(3);
    expect(orphanActions.join("\n")).toContain("/reload");
    expect(orphanActions.join("\n")).toContain("/lane-queue status");
  });

  it("computes deterministic exponential retry delay for transient provider failures", () => {
    const cfg = {
      enabled: true,
      maxAttempts: 10,
      baseDelayMs: 1000,
      maxDelayMs: 8000,
      backoffMultiplier: 2,
    };

    expect(resolveProviderTransientRetryDelayMs(1, cfg)).toBe(1000);
    expect(resolveProviderTransientRetryDelayMs(2, cfg)).toBe(2000);
    expect(resolveProviderTransientRetryDelayMs(3, cfg)).toBe(4000);
    expect(resolveProviderTransientRetryDelayMs(5, cfg)).toBe(8000);
  });

  it("normalizes dispatch failure fingerprints deterministically", () => {
    const raw = "No tool call found for function call output with call_id call_QJlU6a2DGglAm3NntokWyBwo and hash 0123456789abcdef0123456789abcdef";
    const variant = "No tool call found for function call output with tool_call_id='alt-run-777' and hash 0123456789abcdef0123456789abcdef";
    const jsonVariant = "No tool call found for function call output payload={\"tool_call_id\":\"alt.run/777\"} and hash 0123456789abcdef0123456789abcdef";
    const normalized = normalizeDispatchFailureFingerprint(raw, 200);
    const normalizedVariant = normalizeDispatchFailureFingerprint(variant, 200);
    const normalizedJsonVariant = normalizeDispatchFailureFingerprint(jsonVariant, 200);
    expect(normalized).toContain("call_*");
    expect(normalized).toContain("hex_*");
    expect(normalized).not.toContain("call_QJlU6a2DGglAm3NntokWyBwo");
    expect(normalized).toBe(normalizedVariant);
    expect(normalizedJsonVariant).toContain("call_*=call_*");
    expect(normalizedJsonVariant).toContain("hex_*");
    expect(normalizedJsonVariant).not.toContain("alt.run/777");
  });

  it("increments identical failure streak only inside configured window", () => {
    const first = computeIdenticalFailureStreak({
      nextErrorText: "No tool call found for function call output with call_id call_abc123",
      nowMs: 10_000,
      windowMs: 60_000,
    });
    expect(first.streak).toBe(1);

    const second = computeIdenticalFailureStreak({
      lastFingerprint: first.fingerprint,
      lastFailureAtMs: 10_000,
      streak: first.streak,
      nextErrorText: "No tool call found for function call output with tool_call_id='xyz.999/phase-a'",
      nowMs: 20_000,
      windowMs: 60_000,
    });
    expect(second.withinWindow).toBe(true);
    expect(second.streak).toBe(2);

    const third = computeIdenticalFailureStreak({
      lastFingerprint: second.fingerprint,
      lastFailureAtMs: 20_000,
      streak: second.streak,
      nextErrorText: "No tool call found for function call output with call_id call_zzz",
      nowMs: 90_500,
      windowMs: 60_000,
    });
    expect(third.withinWindow).toBe(false);
    expect(third.streak).toBe(1);
  });

  it("pauses only when identical failure streak reaches threshold", () => {
    expect(shouldPauseOnIdenticalFailure(1, 3)).toBe(false);
    expect(shouldPauseOnIdenticalFailure(2, 3)).toBe(false);
    expect(shouldPauseOnIdenticalFailure(3, 3)).toBe(true);
    expect(shouldPauseOnIdenticalFailure(4, 3)).toBe(true);
  });

  it("auto-drains only when idle, enabled and after cooldown", () => {
    const cfg = {
      enabled: true,
      requireActiveLongRun: true,
      maxItems: 50,
      forceNowPrefix: "lane-now:",
      autoDrainOnIdle: true,
      autoDrainCooldownMs: 1000,
      autoDrainBatchSize: 1,
      autoDrainIdleStableMs: 800,
      dispatchFailureBlockAfter: 3,
      rapidRedispatchWindowMs: BOARD_RAPID_REDISPATCH_WINDOW_MS,
      dedupeWindowMs: 120_000,
      identicalFailurePauseAfter: 3,
      orphanFailurePauseAfter: 1,
      identicalFailureWindowMs: 120_000,
      orphanFailureWindowMs: 120_000,
    };

    expect(estimateAutoDrainWaitMs(false, 1, 2_000, 0, 1_200, cfg)).toBe(0);
    expect(estimateAutoDrainWaitMs(false, 1, 500, 0, 1_200, cfg)).toBe(500);
    expect(estimateAutoDrainWaitMs(false, 1, 2_000, 0, 200, cfg)).toBe(600);
    expect(estimateAutoDrainWaitMs(true, 1, 2_000, 0, 1_200, cfg)).toBeUndefined();

    expect(resolveAutoDrainGateReason(true, 1, 2_000, 0, 1_200, cfg)).toBe("active-long-run");
    expect(resolveAutoDrainGateReason(false, 1, 500, 0, 1_200, cfg)).toBe("cooldown");
    expect(resolveAutoDrainGateReason(false, 1, 2_000, 0, 200, cfg)).toBe("idle-stability");
    expect(resolveAutoDrainGateReason(false, 1, 2_000, 0, 1_200, cfg)).toBe("ready");

    expect(resolveAutoDrainRetryDelayMs(false, 1, 500, 0, 1_200, cfg)).toBe(500);
    expect(resolveAutoDrainRetryDelayMs(false, 1, 2_000, 0, 200, cfg)).toBe(600);
    expect(resolveAutoDrainRetryDelayMs(false, 1, 2_000, 0, 1_200, cfg)).toBeUndefined();
    expect(resolveAutoDrainRetryDelayMs(true, 1, 2_000, 0, 1_200, cfg)).toBe(800);

    expect(shouldAutoDrainDeferredIntent(false, 1, 2_000, 0, 1_200, cfg)).toBe(true);
    expect(shouldAutoDrainDeferredIntent(true, 1, 2_000, 0, 1_200, cfg)).toBe(false);
    expect(shouldAutoDrainDeferredIntent(false, 0, 2_000, 0, 1_200, cfg)).toBe(false);
    expect(shouldAutoDrainDeferredIntent(false, 1, 500, 0, 1_200, cfg)).toBe(false);
    expect(shouldAutoDrainDeferredIntent(false, 1, 2_000, 0, 200, cfg)).toBe(false);
  });

  it("blocks rapid same-task re-dispatch to catch silent execution failures", () => {
    const nowMs = Date.now();
    const recentIso = new Date(nowMs - 60_000).toISOString(); // 1 min ago (within 5 min window)
    const staleIso = new Date(nowMs - 6 * 60_000).toISOString(); // 6 min ago (outside window)

    // Should block: same task, within window
    expect(shouldBlockRapidSameTaskRedispatch({
      taskId: "TASK-BUD-067",
      lastDispatchItemId: "board-auto-TASK-BUD-067",
      lastDispatchAtIso: recentIso,
      nowMs,
    })).toBe(true);

    // Should NOT block: different task
    expect(shouldBlockRapidSameTaskRedispatch({
      taskId: "TASK-BUD-068",
      lastDispatchItemId: "board-auto-TASK-BUD-067",
      lastDispatchAtIso: recentIso,
      nowMs,
    })).toBe(false);

    // Should NOT block: same task but stale (outside 5 min window)
    expect(shouldBlockRapidSameTaskRedispatch({
      taskId: "TASK-BUD-067",
      lastDispatchItemId: "board-auto-TASK-BUD-067",
      lastDispatchAtIso: staleIso,
      nowMs,
    })).toBe(false);

    // Should NOT block: no prior dispatch
    expect(shouldBlockRapidSameTaskRedispatch({
      taskId: "TASK-BUD-067",
      lastDispatchItemId: undefined,
      lastDispatchAtIso: undefined,
      nowMs,
    })).toBe(false);

    // Should NOT block: lastDispatchItemId format doesn't match board-auto-* prefix
    expect(shouldBlockRapidSameTaskRedispatch({
      taskId: "TASK-BUD-067",
      lastDispatchItemId: "intent-TASK-BUD-067",
      lastDispatchAtIso: recentIso,
      nowMs,
    })).toBe(false);

    // Respects custom windowMs
    expect(shouldBlockRapidSameTaskRedispatch({
      taskId: "TASK-BUD-067",
      lastDispatchItemId: "board-auto-TASK-BUD-067",
      lastDispatchAtIso: recentIso,
      nowMs,
      windowMs: 30_000, // 30s window — 60s ago is outside
    })).toBe(false);

    // Constant is 5 minutes
    expect(BOARD_RAPID_REDISPATCH_WINDOW_MS).toBe(5 * 60 * 1000);
  });
});
