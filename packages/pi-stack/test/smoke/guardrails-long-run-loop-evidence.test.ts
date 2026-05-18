import { describe, expect, it } from "vitest";
import {
  buildLoopActivationBlockerHint,
  buildLoopActivationMarkersLabel,
  computeLoopEvidenceReadiness,
  resolveAutoDrainRuntimeGateReason,
  resolveBoardAutoAdvanceGateReason,
  resolveLoopActivationMarkers,
  resolveRuntimeCodeActivationState,
  shouldAnnounceLoopActivationReady,
  shouldAutoAdvanceBoardTask,
  shouldEmitAutoDrainDeferredAudit,
  shouldEmitBoardAutoAdvanceGateAudit,
  shouldEmitLoopActivationAudit,
  shouldRefreshLoopEvidenceFromRuntimeSnapshot,
  shouldSchedulePostDispatchAutoDrain,
} from "../../extensions/guardrails-core-exports";

describe("guardrails-core long-run loop evidence", () => {
  it("schedules post-dispatch backstop only when queue still has items", () => {
    expect(shouldSchedulePostDispatchAutoDrain(0, 3)).toBe(false);
    expect(shouldSchedulePostDispatchAutoDrain(1, 0)).toBe(false);
    expect(shouldSchedulePostDispatchAutoDrain(1, 2)).toBe(true);
  });

  it("throttles deferred auto-drain audit spam unless gate changes", () => {
    const nowMs = 10_000;
    const minIntervalMs = 1_500;

    expect(shouldEmitAutoDrainDeferredAudit(0, undefined, "cooldown", nowMs, minIntervalMs)).toBe(true);
    expect(shouldEmitAutoDrainDeferredAudit(9_400, "cooldown", "cooldown", nowMs, minIntervalMs)).toBe(false);
    expect(shouldEmitAutoDrainDeferredAudit(8_000, "cooldown", "cooldown", nowMs, minIntervalMs)).toBe(true);
    expect(shouldEmitAutoDrainDeferredAudit(9_400, "cooldown", "idle-stability", nowMs, minIntervalMs)).toBe(true);
  });

  it("throttles board auto-advance gate audit unless gate changes", () => {
    const nowMs = 10_000;
    const minIntervalMs = 1_500;

    expect(shouldEmitBoardAutoAdvanceGateAudit(0, undefined, "queued-intents", nowMs, minIntervalMs)).toBe(true);
    expect(shouldEmitBoardAutoAdvanceGateAudit(9_400, "queued-intents", "queued-intents", nowMs, minIntervalMs)).toBe(false);
    expect(shouldEmitBoardAutoAdvanceGateAudit(8_000, "queued-intents", "queued-intents", nowMs, minIntervalMs)).toBe(true);
    expect(shouldEmitBoardAutoAdvanceGateAudit(9_400, "queued-intents", "board-not-ready", nowMs, minIntervalMs)).toBe(true);
  });

  it("throttles loop activation audit unless label changes", () => {
    const nowMs = 10_000;
    const minIntervalMs = 1_500;
    const labelA = "READY=yes ACTIVE_HERE=no IN_LOOP=no blocker=runtime-reload-required";
    const labelB = "READY=yes ACTIVE_HERE=yes IN_LOOP=yes blocker=none";

    expect(shouldEmitLoopActivationAudit(0, undefined, labelA, nowMs, minIntervalMs)).toBe(true);
    expect(shouldEmitLoopActivationAudit(9_400, labelA, labelA, nowMs, minIntervalMs)).toBe(false);
    expect(shouldEmitLoopActivationAudit(8_000, labelA, labelA, nowMs, minIntervalMs)).toBe(true);
    expect(shouldEmitLoopActivationAudit(9_400, labelA, labelB, nowMs, minIntervalMs)).toBe(true);
  });

  it("detects whether runtime code is active or reload-required", () => {
    expect(resolveRuntimeCodeActivationState({ loadedSourceMtimeMs: 1000, currentSourceMtimeMs: 1000 })).toBe("active");
    expect(resolveRuntimeCodeActivationState({ loadedSourceMtimeMs: 1000, currentSourceMtimeMs: 1008, mtimeToleranceMs: 10 })).toBe("active");
    expect(resolveRuntimeCodeActivationState({ loadedSourceMtimeMs: 1000, currentSourceMtimeMs: 1020, mtimeToleranceMs: 10 })).toBe("reload-required");
    expect(resolveRuntimeCodeActivationState({ loadedSourceMtimeMs: undefined, currentSourceMtimeMs: 1000 })).toBe("unknown");
  });

  it("builds loop activation markers for READY/ACTIVE_HERE/IN_LOOP", () => {
    const readyMarkers = resolveLoopActivationMarkers({
      activeLongRun: false,
      queuedCount: 0,
      loopMode: "running",
      loopHealth: "healthy",
      stopCondition: "none",
      boardReady: true,
      nextTaskId: "TASK-BUD-125",
      boardAutoGate: "ready",
      runtimeCodeState: "active",
    });
    expect(readyMarkers.preparado).toBe(true);
    expect(readyMarkers.ativoAqui).toBe(true);
    expect(readyMarkers.emLoop).toBe(true);
    expect(readyMarkers.blocker).toBe("none");
    expect(buildLoopActivationMarkersLabel(readyMarkers)).toContain("READY=yes");
    expect(buildLoopActivationMarkersLabel(readyMarkers)).toContain("IN_LOOP=yes");
    expect(shouldAnnounceLoopActivationReady(false, readyMarkers.emLoop)).toBe(true);

    const reloadMarkers = resolveLoopActivationMarkers({
      activeLongRun: false,
      queuedCount: 0,
      loopMode: "running",
      loopHealth: "healthy",
      stopCondition: "none",
      boardReady: true,
      nextTaskId: "TASK-BUD-125",
      boardAutoGate: "ready",
      runtimeCodeState: "reload-required",
    });
    expect(reloadMarkers.preparado).toBe(true);
    expect(reloadMarkers.ativoAqui).toBe(false);
    expect(reloadMarkers.emLoop).toBe(false);
    expect(reloadMarkers.blocker).toBe("runtime-reload-required");
    expect(shouldAnnounceLoopActivationReady(true, reloadMarkers.emLoop)).toBe(false);

    const queueBlockedMarkers = resolveLoopActivationMarkers({
      activeLongRun: false,
      queuedCount: 2,
      loopMode: "running",
      loopHealth: "healthy",
      stopCondition: "none",
      boardReady: true,
      nextTaskId: "TASK-BUD-125",
      boardAutoGate: "queued-intents",
      runtimeCodeState: "active",
    });
    expect(queueBlockedMarkers.emLoop).toBe(false);
    expect(queueBlockedMarkers.blocker).toBe("queued-intents");

    expect(buildLoopActivationBlockerHint(reloadMarkers)).toContain("faça reload");
    expect(buildLoopActivationBlockerHint(queueBlockedMarkers)).toContain("esvazie fila");
    expect(buildLoopActivationBlockerHint(readyMarkers)).toBeUndefined();
  });

  it("computes deterministic loop evidence readiness for task-bud-125 closure", () => {
    const ready = computeLoopEvidenceReadiness({
      version: 1,
      updatedAtIso: "2026-04-23T19:00:00.000Z",
      lastBoardAutoAdvance: {
        atIso: "2026-04-23T19:00:00.000Z",
        taskId: "TASK-BUD-125",
        runtimeCodeState: "active",
        markersLabel: "READY=yes ACTIVE_HERE=yes IN_LOOP=yes blocker=none",
        emLoop: true,
      },
      lastLoopReady: {
        atIso: "2026-04-23T18:59:59.000Z",
        markersLabel: "READY=yes ACTIVE_HERE=yes IN_LOOP=yes blocker=none",
        runtimeCodeState: "active",
        boardAutoAdvanceGate: "ready",
        nextTaskId: "TASK-BUD-125",
      },
    });
    expect(ready.readyForLoopEvidence).toBe(true);
    expect(ready.readyForTaskBud125).toBe(true);
    expect(ready.criteria.join(" |")).toContain("boardAuto.runtime=active:yes");

    const blocked = computeLoopEvidenceReadiness({
      version: 1,
      updatedAtIso: "2026-04-23T19:00:00.000Z",
      lastBoardAutoAdvance: {
        atIso: "2026-04-23T19:00:00.000Z",
        taskId: "TASK-BUD-125",
        runtimeCodeState: "reload-required",
        markersLabel: "READY=yes ACTIVE_HERE=no IN_LOOP=no blocker=runtime-reload-required",
        emLoop: false,
      },
      lastLoopReady: undefined,
    });
    expect(blocked.readyForLoopEvidence).toBe(false);
    expect(blocked.criteria.join(" |")).toContain("boardAuto.runtime=active:no");
  });

  it("refreshes loop-evidence snapshot only when runtime lease is still active", () => {
    const nowMs = Date.parse("2026-04-24T00:45:00.000Z");

    expect(shouldRefreshLoopEvidenceFromRuntimeSnapshot({
      mode: "running",
      health: "healthy",
      stopCondition: "none",
      leaseExpiresAtIso: "2026-04-24T00:45:20.000Z",
    }, nowMs)).toBe(true);

    expect(shouldRefreshLoopEvidenceFromRuntimeSnapshot({
      mode: "running",
      health: "healthy",
      stopCondition: "none",
      leaseExpiresAtIso: "2026-04-24T00:44:30.000Z",
    }, nowMs)).toBe(false);

    expect(shouldRefreshLoopEvidenceFromRuntimeSnapshot({
      mode: "paused",
      health: "healthy",
      stopCondition: "manual-pause",
      leaseExpiresAtIso: "2026-04-24T00:45:20.000Z",
    }, nowMs)).toBe(false);
  });

  it("auto-advances board task only when lane is idle, empty and healthy", () => {
    const ready = {
      activeLongRun: false,
      queuedCount: 0,
      loopMode: "running" as const,
      loopHealth: "healthy" as const,
      stopCondition: "none" as const,
      boardReady: true,
      nextTaskId: "TASK-BUD-125",
    };

    expect(shouldAutoAdvanceBoardTask(ready)).toBe(true);
    expect(resolveBoardAutoAdvanceGateReason(ready)).toBe("ready");

    const activeLongRun = {
      ...ready,
      activeLongRun: true,
    };
    expect(shouldAutoAdvanceBoardTask(activeLongRun)).toBe(false);
    expect(resolveBoardAutoAdvanceGateReason(activeLongRun)).toBe("active-long-run");

    const queued = {
      ...ready,
      queuedCount: 1,
    };
    expect(shouldAutoAdvanceBoardTask(queued)).toBe(false);
    expect(resolveBoardAutoAdvanceGateReason(queued)).toBe("queued-intents");

    const paused = {
      ...ready,
      loopMode: "paused" as const,
      stopCondition: "manual-pause" as const,
    };
    expect(shouldAutoAdvanceBoardTask(paused)).toBe(false);
    expect(resolveBoardAutoAdvanceGateReason(paused)).toBe("loop-paused");

    const degraded = {
      ...ready,
      loopHealth: "degraded" as const,
      stopCondition: "dispatch-failure" as const,
    };
    expect(shouldAutoAdvanceBoardTask(degraded)).toBe(false);
    expect(resolveBoardAutoAdvanceGateReason(degraded)).toBe("loop-degraded");

    const notReady = {
      ...ready,
      boardReady: false,
      nextTaskId: undefined,
    };
    expect(shouldAutoAdvanceBoardTask(notReady)).toBe(false);
    expect(resolveBoardAutoAdvanceGateReason(notReady)).toBe("board-not-ready");

    const missingTask = {
      ...ready,
      nextTaskId: "",
    };
    expect(shouldAutoAdvanceBoardTask(missingTask)).toBe(false);
    expect(resolveBoardAutoAdvanceGateReason(missingTask)).toBe("missing-next-task-id");

    const deduped = {
      ...ready,
      nowMs: 12_000,
      lastTaskId: "TASK-BUD-125",
      lastTaskAtMs: 10_700,
      dedupeWindowMs: 2_000,
    };
    expect(shouldAutoAdvanceBoardTask(deduped)).toBe(false);
    expect(resolveBoardAutoAdvanceGateReason(deduped)).toBe("dedupe-window");

    const dedupeExpired = {
      ...deduped,
      nowMs: 13_100,
    };
    expect(shouldAutoAdvanceBoardTask(dedupeExpired)).toBe(true);
    expect(resolveBoardAutoAdvanceGateReason(dedupeExpired)).toBe("ready");
  });

  it("applies lease-expired as explicit runtime auto-drain gate", () => {
    const nowMs = Date.parse("2026-04-23T04:00:00.000Z");
    const expiredState = {
      leaseExpiresAtIso: "2026-04-23T03:59:59.000Z",
      stopCondition: "none" as const,
    };
    const healthyState = {
      leaseExpiresAtIso: "2026-04-23T04:10:00.000Z",
      stopCondition: "none" as const,
    };

    expect(resolveAutoDrainRuntimeGateReason("ready", expiredState, nowMs)).toBe("lease-expired");
    expect(resolveAutoDrainRuntimeGateReason("cooldown", expiredState, nowMs)).toBe("lease-expired");
    expect(resolveAutoDrainRuntimeGateReason("ready", healthyState, nowMs)).toBe("ready");
    expect(resolveAutoDrainRuntimeGateReason("active-long-run", healthyState, nowMs)).toBe("active-long-run");
  });
});
