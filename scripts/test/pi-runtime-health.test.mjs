import assert from "node:assert/strict";
import test from "node:test";

import { buildPiRuntimeHealthReport } from "../pi-runtime-health.mjs";

function makeDevPressure(overrides = {}) {
  return {
    cwd: "/tmp/agents-lab",
    recommendation: "continue",
    summary: "pi-dev-pressure: recommendation=continue signals=0 largestSessionMb=0 heaviestConfiguredEntrypoint=n/a",
    signals: [],
    sessions: { largest: { mb: 0 } },
    configuredEntrypoints: [],
    performanceWatchdog: { persistedEventCount: 0 },
    ...overrides,
  };
}

function makeArtifactAudit(overrides = {}) {
  return {
    trackedCount: 10,
    violations: [],
    remediation: [],
    ...overrides,
  };
}

test("runtime health continues for clean read-only preflight", () => {
  const report = buildPiRuntimeHealthReport("/tmp/agents-lab", {
    devPressure: makeDevPressure(),
    artifactAudit: makeArtifactAudit(),
  });

  assert.equal(report.decision, "continue");
  assert.equal(report.liveWatchdogMetricsAvailable, false);
  assert.match(report.summary, /liveWatchdog=unavailable/);
});

test("runtime health recommends safe-mode for persisted watchdog pressure", () => {
  const report = buildPiRuntimeHealthReport("/tmp/agents-lab", {
    devPressure: makeDevPressure({
      signals: [{ level: "warn", code: "recent-performance-watchdog-event", detail: "persistedEvents=2" }],
      performanceWatchdog: { persistedEventCount: 2 },
    }),
    artifactAudit: makeArtifactAudit(),
  });

  assert.equal(report.decision, "safe-mode");
  assert.deepEqual(report.reasons, ["recent-performance-watchdog-event"]);
});

test("runtime health stops for tracked runtime artifacts", () => {
  const report = buildPiRuntimeHealthReport("/tmp/agents-lab", {
    devPressure: makeDevPressure(),
    artifactAudit: makeArtifactAudit({
      violations: [{ path: ".sandbox/pi-agent/sessions/run.jsonl", reason: "sandbox-runtime-artifact" }],
      remediation: ['git rm --cached -- ".sandbox/pi-agent/sessions/run.jsonl"'],
    }),
  });

  assert.equal(report.decision, "stop-and-investigate");
  assert.deepEqual(report.reasons, ["runtime-artifacts-tracked"]);
  assert.equal(report.artifactAudit.violations.length, 1);
});

test("runtime health stops for invalid runtime shell path", () => {
  const report = buildPiRuntimeHealthReport("/tmp/agents-lab", {
    devPressure: makeDevPressure({
      recommendation: "block-and-clean",
      signals: [{ level: "block", code: "invalid-runtime-shell-path", detail: "shellPath=C:/missing/bash.exe" }],
    }),
    artifactAudit: makeArtifactAudit(),
  });

  assert.equal(report.decision, "stop-and-investigate");
  assert.ok(report.reasons.includes("dev-pressure-block"));
  assert.ok(report.reasons.includes("invalid-runtime-shell-path"));
});
