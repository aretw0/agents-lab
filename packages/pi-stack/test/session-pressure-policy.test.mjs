import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSessionBudget,
  computeStrictFailures,
  detectSessionResumeIntent,
  resolveSessionPressureGate,
} from "../extensions/session-pressure-policy.mjs";

test("detectSessionResumeIntent recognizes only explicit resume flags", () => {
  assert.equal(detectSessionResumeIntent(["--resume"]), true);
  assert.equal(detectSessionResumeIntent(["--dev", "--resume"]), true);
  assert.equal(detectSessionResumeIntent(["resume"]), false);
  assert.equal(detectSessionResumeIntent(undefined), false);
});

test("buildSessionBudget classifies warn and block session files", () => {
  const budget = buildSessionBudget({
    files: [
      { path: "small.jsonl", mb: 1 },
      { path: "warn.jsonl", mb: 60 },
      { path: "block.jsonl", mb: 160 },
    ],
  });

  assert.equal(budget.oversized.length, 2);
  assert.deepEqual(budget.oversized.map((row) => row.level), ["warn", "block"]);
  assert.equal(budget.blockers[0].path, "block.jsonl");
  assert.equal(budget.recommendation, "do-not-resume-archive-or-delete-after-checkpoint");
});

test("computeStrictFailures returns block signal codes", () => {
  assert.deepEqual(computeStrictFailures({
    signals: [
      { level: "warn", code: "large-resume-session" },
      { level: "block", code: "huge-resume-session" },
      { level: "block", code: "machine-disk-pressure" },
    ],
  }), ["huge-resume-session", "machine-disk-pressure"]);
});

test("resolveSessionPressureGate allows new sessions for resume-only pressure", () => {
  const report = {
    signals: [{ level: "block", code: "huge-resume-session" }],
  };

  assert.deepEqual(resolveSessionPressureGate(report), {
    allowed: true,
    failures: ["huge-resume-session"],
    reason: "new-session-advisory",
  });
  assert.deepEqual(resolveSessionPressureGate(report, { resume: true }), {
    allowed: false,
    failures: ["huge-resume-session"],
    reason: "strict-failures",
  });
});

test("resolveSessionPressureGate keeps machine pressure strict", () => {
  const report = {
    signals: [{ level: "block", code: "machine-disk-pressure" }],
  };

  assert.deepEqual(resolveSessionPressureGate(report), {
    allowed: false,
    failures: ["machine-disk-pressure"],
    reason: "machine-pressure-strict",
  });
  assert.deepEqual(resolveSessionPressureGate(report, { force: true }), {
    allowed: true,
    failures: ["machine-disk-pressure"],
    reason: "forced",
  });
});
