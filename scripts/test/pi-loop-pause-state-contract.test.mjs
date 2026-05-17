import test from "node:test";
import assert from "node:assert/strict";

import { applyLoopControlToState, resolveLoopLeaseStatus } from "../pi-loop-pause.mjs";

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

test("resolveLoopLeaseStatus classifies stale and fresh leases", () => {
  const now = new Date("2026-05-17T12:00:00.000Z");

  assert.deepEqual(
    resolveLoopLeaseStatus({ leaseExpiresAtIso: "2026-05-17T11:59:59.000Z" }, now),
    { known: true, expired: true, label: "expired" },
  );
  assert.deepEqual(
    resolveLoopLeaseStatus({ leaseExpiresAtIso: "2026-05-17T12:00:01.000Z" }, now),
    { known: true, expired: false, label: "fresh" },
  );
  assert.deepEqual(
    resolveLoopLeaseStatus({}, now),
    { known: false, expired: undefined, label: "unknown" },
  );
});
