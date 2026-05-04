import { describe, expect, it, vi } from "vitest";

import {
  refreshLoopEvidenceHeartbeat,
  refreshLoopEvidenceHeartbeatFromSnapshot,
  refreshLoopLeaseOnActivity,
} from "../../extensions/guardrails-core-lane-queue-heartbeat";

describe("guardrails-core lane queue heartbeat helpers", () => {
  it("refreshLoopLeaseOnActivity skips when mode is paused", () => {
    const setRuntimeMode = vi.fn();
    const result = refreshLoopLeaseOnActivity({
      cwd: "/tmp/project",
      nowMs: 5_000,
      lastLeaseRefreshAt: 0,
      minIntervalMs: 1_000,
      mode: "paused",
      reason: "lease-heartbeat-timer",
      setRuntimeMode,
    });

    expect(result.updated).toBe(false);
    expect(setRuntimeMode).not.toHaveBeenCalled();
  });

  it("refreshLoopLeaseOnActivity updates runtime when running and interval elapsed", () => {
    const setRuntimeMode = vi.fn(() => ({
      state: {
        mode: "running",
        health: "healthy",
        stopCondition: "none",
        leaseExpiresAtIso: new Date(Date.now() + 30_000).toISOString(),
      },
    }));

    const result = refreshLoopLeaseOnActivity({
      cwd: "/tmp/project",
      nowMs: 20_000,
      lastLeaseRefreshAt: 0,
      minIntervalMs: 1_000,
      mode: "running",
      reason: "lease-heartbeat-timer",
      setRuntimeMode,
    });

    expect(result.updated).toBe(true);
    expect(result.nextState?.mode).toBe("running");
    expect(setRuntimeMode).toHaveBeenCalledWith("/tmp/project", "running", "lease-heartbeat-timer");
  });

  it("refreshLoopEvidenceHeartbeat updates evidence and emits audit payload", () => {
    const evidence = {
      version: 1,
      updatedAtIso: "2026-05-04T00:00:00.000Z",
      lastLoopReady: {
        atIso: "2026-05-04T00:00:00.000Z",
        markersLabel: "old",
        runtimeCodeState: "active",
        boardAutoAdvanceGate: "ready",
      },
      lastBoardAutoAdvance: {
        atIso: "2026-05-04T00:00:00.000Z",
        taskId: "TASK-BUD-1",
        runtimeCodeState: "active",
        markersLabel: "old",
        emLoop: true,
      },
    } as const;

    const writeEvidence = vi.fn();
    const result = refreshLoopEvidenceHeartbeat({
      cwd: "/tmp/project",
      nowMs: Date.parse("2026-05-04T00:10:00.000Z"),
      lastHeartbeatAt: 0,
      heartbeatIntervalMs: 1_000,
      markersLabel: "new-markers",
      runtimeCodeState: "active",
      boardAutoAdvanceGate: "ready",
      nextTaskId: "TASK-BUD-2",
      milestone: "runtime-hardening-2026-05",
      readEvidence: () => ({ ...evidence }),
      computeReadiness: () => ({ readyForLoopEvidence: true, readyForTaskBud125: true, criteria: [] }),
      writeEvidence,
    });

    expect(result.updated).toBe(true);
    expect(result.auditPayload).toMatchObject({
      markersLabel: "new-markers",
      runtimeCodeState: "active",
      boardAutoAdvanceGate: "ready",
      nextTaskId: "TASK-BUD-2",
      milestone: "runtime-hardening-2026-05",
    });
    expect(writeEvidence).toHaveBeenCalledTimes(1);
  });

  it("refreshLoopEvidenceHeartbeatFromSnapshot emits source=snapshot-refresh", () => {
    const evidence = {
      version: 1,
      updatedAtIso: "2026-05-04T00:00:00.000Z",
      lastLoopReady: {
        atIso: "2026-05-04T00:00:00.000Z",
        markersLabel: "snapshot",
        runtimeCodeState: "active",
        boardAutoAdvanceGate: "ready",
      },
      lastBoardAutoAdvance: {
        atIso: "2026-05-04T00:00:00.000Z",
        taskId: "TASK-BUD-3",
        runtimeCodeState: "active",
        markersLabel: "snapshot",
        emLoop: true,
      },
    } as const;

    const result = refreshLoopEvidenceHeartbeatFromSnapshot({
      cwd: "/tmp/project",
      nowMs: Date.parse("2026-05-04T00:20:00.000Z"),
      lastHeartbeatAt: 0,
      heartbeatIntervalMs: 1_000,
      readRuntime: () => ({ mode: "running", health: "healthy", stopCondition: "none", leaseExpiresAtIso: "2099-01-01T00:00:00.000Z" }),
      shouldRefreshRuntime: () => true,
      readEvidence: () => ({ ...evidence }),
      computeReadiness: () => ({ readyForLoopEvidence: true, readyForTaskBud125: true, criteria: [] }),
      writeEvidence: () => "/tmp/project/.pi/guardrails-loop-evidence.json",
    });

    expect(result.updated).toBe(true);
    expect(result.auditPayload?.source).toBe("snapshot-refresh");
  });
});
