import test from "node:test";
import assert from "node:assert/strict";

import { detectSessionResumeIntent, resolvePiDevPressureGate, resolvePiDevStartupState } from "../pi-isolated.mjs";

test("detectSessionResumeIntent recognizes explicit --resume", () => {
  assert.equal(detectSessionResumeIntent(["--resume"]), true);
  assert.equal(detectSessionResumeIntent(["--dev", "--resume", "--foo"]), true);
});

test("detectSessionResumeIntent ignores non-resume args", () => {
  assert.equal(detectSessionResumeIntent(["--dev"]), false);
  assert.equal(detectSessionResumeIntent(["resume"]), false);
  assert.equal(detectSessionResumeIntent(undefined), false);
});

test("resolvePiDevStartupState suppresses auto-resume while factory loop is paused", () => {
  assert.deepEqual(resolvePiDevStartupState({
    devPauseResult: "already-paused",
    sessionResumeRequested: true,
  }), {
    factoryState: "paused",
    sessionState: "resume",
    nextAction: "pnpm run pi:loop:resume",
    autoResumeState: "suppressed",
  });
});

test("resolvePiDevStartupState reports unknown auto-resume state without loop state", () => {
  assert.deepEqual(resolvePiDevStartupState({
    devPauseResult: "state-missing",
    sessionResumeRequested: false,
  }), {
    factoryState: "unknown",
    sessionState: "new",
    nextAction: "pnpm run pi:loop:status",
    autoResumeState: "unknown",
  });
});

test("resolvePiDevPressureGate treats strict pressure as advisory for new sessions", () => {
  const report = {
    signals: [
      { level: "warn", code: "heavy-extension-entrypoint" },
      { level: "block", code: "huge-resume-session" },
    ],
  };

  assert.deepEqual(resolvePiDevPressureGate(report), {
    allowed: true,
    failures: ["huge-resume-session"],
    reason: "new-session-advisory",
  });
});

test("resolvePiDevPressureGate blocks resume strict failures unless explicitly forced", () => {
  const report = {
    signals: [
      { level: "warn", code: "heavy-extension-entrypoint" },
      { level: "block", code: "huge-resume-session" },
    ],
  };

  assert.deepEqual(resolvePiDevPressureGate(report, { resume: true }), {
    allowed: false,
    failures: ["huge-resume-session"],
    reason: "strict-failures",
  });
  assert.deepEqual(resolvePiDevPressureGate(report, { resume: true, force: true }), {
    allowed: true,
    failures: ["huge-resume-session"],
    reason: "forced",
  });
});

test("resolvePiDevPressureGate blocks machine pressure for new sessions", () => {
  const report = {
    signals: [
      { level: "block", code: "machine-disk-pressure" },
    ],
  };

  assert.deepEqual(resolvePiDevPressureGate(report), {
    allowed: false,
    failures: ["machine-disk-pressure"],
    reason: "machine-pressure-strict",
  });
  assert.deepEqual(resolvePiDevPressureGate(report, { force: true }), {
    allowed: true,
    failures: ["machine-disk-pressure"],
    reason: "forced",
  });
});
