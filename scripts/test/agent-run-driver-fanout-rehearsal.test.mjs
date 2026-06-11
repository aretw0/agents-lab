import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runAgentRunDriverFanoutRehearsal } from "../agent-run-driver-fanout-rehearsal.mjs";

function workspace(prefix) {
  const cwd = mkdtempSync(path.join(tmpdir(), prefix));
  writeFileSync(path.join(cwd, "package.json"), "{}\n", "utf8");
  return cwd;
}

test("fanout rehearsal previews fail-closed without starting workers", async () => {
  const cwd = workspace("agent-run-driver-fanout-preview-");
  try {
    const report = await runAgentRunDriverFanoutRehearsal({ cwd, execute: false });

    assert.equal(report.mode, "agent-run-driver-fanout-rehearsal-report");
    assert.equal(report.decision, "block");
    assert.equal(report.executeRequested, false);
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.ok(report.blockers.includes("execute-not-requested"));
    assert.equal(report.workerSummaries.length, 2);
    assert.equal(report.batchOutcomePacket.decision, "block");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout rehearsal runs two local read-only workers and aggregates pass", async () => {
  const cwd = workspace("agent-run-driver-fanout-execute-");
  try {
    const report = await runAgentRunDriverFanoutRehearsal({ cwd });

    assert.equal(report.decision, "pass");
    assert.equal(report.dispatchAllowed, true);
    assert.equal(report.processStartAllowed, true);
    assert.equal(report.workerCount, 2);
    assert.equal(report.passedWorkerCount, 2);
    assert.deepEqual(report.blockers, []);
    assert.deepEqual(report.workerSummaries.map((worker) => worker.contractDecision), ["pass", "pass"]);
    assert.deepEqual(report.workerSummaries.map((worker) => worker.followTerminal), [true, true]);
    assert.equal(report.batchOutcomePacket.mode, "agent-run-batch-outcome-packet");
    assert.equal(report.batchOutcomePacket.decision, "pass");
    assert.equal(existsSync(path.join(cwd, ".artifacts/agent-run-driver/fanout-rehearsal.json")), true);

    const registry = JSON.parse(readFileSync(path.join(cwd, ".pi/reports/agent-runs.json"), "utf8"));
    assert.equal(registry.runs.length, 2);
    assert.deepEqual(registry.runs.map((run) => run.state).sort(), ["completed", "completed"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
