import test from "node:test";
import assert from "node:assert/strict";

import { applyLoopControlToState } from "../pi-loop-pause.mjs";

test("applyLoopControlToState pause sets mode and stop fields consistently", () => {
  const base = {
    mode: "running",
    health: "healthy",
    stopCondition: "none",
    stopReason: "running",
  };
  const next = applyLoopControlToState(base, "pause");
  assert.equal(next.mode, "paused");
  assert.equal(next.stopCondition, "manual-pause");
  assert.equal(next.stopReason, "manual-pause");
  assert.equal(next.lastTransitionReason, "manual-pause");
  assert.equal(typeof next.updatedAtIso, "string");
});

test("applyLoopControlToState resume restores running with healthy stop condition", () => {
  const base = {
    mode: "paused",
    health: "healthy",
    stopCondition: "manual-pause",
    stopReason: "manual-pause",
  };
  const next = applyLoopControlToState(base, "resume");
  assert.equal(next.mode, "running");
  assert.equal(next.stopCondition, "none");
  assert.equal(next.stopReason, "running");
  assert.equal(next.lastTransitionReason, "manual-resume");
});

test("applyLoopControlToState resume preserves dispatch-failure boundary when degraded", () => {
  const base = {
    mode: "paused",
    health: "degraded",
    stopCondition: "manual-pause",
    stopReason: "manual-pause",
  };
  const next = applyLoopControlToState(base, "resume");
  assert.equal(next.mode, "running");
  assert.equal(next.stopCondition, "dispatch-failure");
  assert.equal(next.stopReason, "dispatch-failure");
});
