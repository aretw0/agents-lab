import { describe, expect, it } from "vitest";
import {
  evaluateAutonomyLaneReadiness,
  evaluateDelegationLaneCapabilitySnapshot,
  type AutonomyLaneReadinessInput,
} from "../../extensions/guardrails-core-autonomy-lane";

function baseInput(overrides: Partial<AutonomyLaneReadinessInput> = {}): AutonomyLaneReadinessInput {
  return {
    context: { level: "ok", action: "continue", percent: 20, ...overrides.context },
    machine: { severity: "ok", canStartLongRun: true, canEvaluateMonitors: true, ...overrides.machine },
    provider: { ready: 1, blocked: 0, degraded: 0, ...overrides.provider },
    quota: { blockAlerts: 0, warnAlerts: 0, ...overrides.quota },
    board: { ready: true, nextTaskId: "TASK-NEXT", ...overrides.board },
    monitors: { classifyFailures: 0, sovereignDivergence: 0, ...overrides.monitors },
    subagents: { ready: true, ...overrides.subagents },
    workspace: { unexpectedDirty: false, ...overrides.workspace },
  };
}

describe("autonomy lane readiness", () => {
  it("allows normal bounded autonomous work when all gates are green", () => {
    const result = evaluateAutonomyLaneReadiness(baseInput());
    expect(result.ready).toBe(true);
    expect(result.decision).toBe("go");
    expect(result.allowedWork).toBe("normal-bounded");
    expect(result.nextAction).toContain("TASK-NEXT");
  });

  it("treats context warn as bounded steering, not a stop", () => {
    const result = evaluateAutonomyLaneReadiness(baseInput({ context: { level: "warn", percent: 60 } }));
    expect(result.ready).toBe(true);
    expect(result.decision).toBe("bounded");
    expect(result.allowedWork).toBe("bounded-only");
    expect(result.stopReasons).toEqual([]);
    expect(result.steering).toContain("context-warn: continue bounded work; do not soft-stop");
  });

  it("reserves checkpoint and compact for explicit lifecycle transitions", () => {
    const checkpoint = evaluateAutonomyLaneReadiness(baseInput({ context: { level: "checkpoint", percent: 69 } }));
    expect(checkpoint.ready).toBe(true);
    expect(checkpoint.decision).toBe("checkpoint");
    expect(checkpoint.allowedWork).toBe("checkpoint-only");

    const compact = evaluateAutonomyLaneReadiness(baseInput({ context: { level: "compact", percent: 72 } }));
    expect(compact.ready).toBe(false);
    expect(compact.decision).toBe("wrap-up");
    expect(compact.allowedWork).toBe("wrap-up-only");
    expect(compact.nextAction).toContain("auto-compact");
  });

  it("blocks autonomous continuation on hard safety gates", () => {
    const result = evaluateAutonomyLaneReadiness(baseInput({
      machine: { severity: "block", canStartLongRun: false },
      quota: { blockAlerts: 1 },
      monitors: { classifyFailures: 1 },
    }));
    expect(result.ready).toBe(false);
    expect(result.decision).toBe("blocked");
    expect(result.stopReasons).toEqual(expect.arrayContaining([
      "machine-block",
      "machine-long-run-disabled",
      "quota-block",
      "monitor-classify-failures",
    ]));
  });

  it("requires an eligible board lane before unattended continuation", () => {
    const result = evaluateAutonomyLaneReadiness(baseInput({ board: { ready: false } }));
    expect(result.ready).toBe(false);
    expect(result.decision).toBe("blocked");
    expect(result.stopReasons).toContain("board-not-ready");
  });

  it("marks delegation capability ready when freshness/monitor/subagent signals are clean", () => {
    const snapshot = evaluateDelegationLaneCapabilitySnapshot({
      preloadDecision: "use-pack",
      dirtySignal: "clean",
      monitorClassifyFailures: 0,
      subagentsReady: true,
    });
    expect(snapshot.decision).toBe("ready");
    expect(snapshot.recommendationCode).toBe("delegation-capability-ready");
    expect(snapshot.blockers).toEqual([]);
    expect(snapshot.evidenceGaps).toEqual([]);
  });

  it("marks delegation capability needs-evidence on fallback preload or dirty workspace", () => {
    const snapshot = evaluateDelegationLaneCapabilitySnapshot({
      preloadDecision: "fallback-canonical",
      dirtySignal: "dirty",
      monitorClassifyFailures: 1,
      subagentsReady: true,
    });
    expect(snapshot.decision).toBe("needs-evidence");
    expect(snapshot.recommendationCode).toBe("delegation-capability-needs-evidence-dirty");
    expect(snapshot.evidenceGaps).toEqual(expect.arrayContaining([
      "preload-fallback-canonical",
      "workspace-dirty",
      "monitor-classify-failures-warn",
    ]));
  });

  it("blocks delegation capability on hard blockers", () => {
    const snapshot = evaluateDelegationLaneCapabilitySnapshot({
      preloadDecision: "use-pack",
      dirtySignal: "clean",
      monitorClassifyFailures: 5,
      subagentsReady: false,
    });
    expect(snapshot.decision).toBe("blocked");
    expect(snapshot.blockers).toEqual(expect.arrayContaining([
      "subagents-not-ready",
      "monitor-classify-failures-block",
    ]));
  });
});
