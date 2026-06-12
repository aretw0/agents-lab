import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildAgentRunDriverFanoutRecoveryNext } from "../agent-run-driver-fanout-recovery-next.mjs";

const cliPath = fileURLToPath(new URL("../agent-run-driver-fanout-recovery-next.mjs", import.meta.url));

function workspace(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function writeOutcome(cwd, payload) {
  const relPath = ".artifacts/agent-run-driver/fanout-outcome.json";
  const fullPath = path.join(cwd, relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${JSON.stringify({
    mode: "agent-run-driver-fanout-outcome-report",
    schemaVersion: 1,
    planPath: ".artifacts/agent-run-driver/fanout-plan.json",
    batchId: "fanout-recovery-test",
    ...payload,
  }, null, 2)}\n`, "utf8");
  return relPath;
}

test("fanout recovery next selects the first failed worker without dispatch", () => {
  const cwd = workspace("agent-run-driver-fanout-recovery-next-");
  try {
    const sourcePath = writeOutcome(cwd, {
      decision: "block",
      workerCount: 3,
      passedWorkerCount: 1,
      workerSummaries: [
        {
          workerId: "worker-a",
          runId: "fanout-worker-a",
          logPath: ".pi/reports/fanout-worker-a.log",
          processState: "completed",
          contractDecision: "fail",
          blockers: ["worker-output-fail"],
          markerFailures: ["worker-output-fail"],
        },
        {
          workerId: "worker-b",
          runId: "fanout-worker-b",
          processState: "completed",
          contractDecision: "pass",
          blockers: [],
          markerFailures: [],
        },
      ],
    });

    const report = buildAgentRunDriverFanoutRecoveryNext({ cwd, sourcePath });

    assert.equal(report.mode, "agent-run-driver-fanout-recovery-next");
    assert.equal(report.decision, "next-action-ready");
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.equal(report.automationAllowed, false);
    assert.equal(report.failedWorkerCount, 1);
    assert.equal(report.selectedWorker.workerId, "worker-a");
    assert.equal(report.selectedWorker.runId, "fanout-worker-a");
    assert.equal(report.selectedWorker.logPath, ".pi/reports/fanout-worker-a.log");
    assert.equal(report.failureKind, "worker-output-fail");
    assert.deepEqual(report.selectedCommandPreview.args, [
      "scripts/agent-run-driver-fanout-outcome.mjs",
      "--plan",
      ".artifacts/agent-run-driver/fanout-plan.json",
      "--out",
      sourcePath,
      "--exit-zero-on-block",
    ]);
    assert.match(report.nextActions.join("\n"), /\.pi\/reports\/fanout-worker-a\.log/);
    assert.match(report.nextActions.join("\n"), /resolve the declared FAIL/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout recovery next completes when fanout outcome passes", () => {
  const cwd = workspace("agent-run-driver-fanout-recovery-complete-");
  try {
    const sourcePath = writeOutcome(cwd, {
      decision: "pass",
      workerCount: 1,
      passedWorkerCount: 1,
      workerSummaries: [{
        workerId: "worker-a",
        runId: "fanout-worker-a",
        processState: "completed",
        contractDecision: "pass",
        blockers: [],
      }],
    });

    const report = buildAgentRunDriverFanoutRecoveryNext({ cwd, sourcePath });

    assert.equal(report.decision, "complete");
    assert.equal(report.failedWorkerCount, 0);
    assert.equal(report.selectedWorker, null);
    assert.deepEqual(report.blockers, []);
    assert.match(report.nextActions.join("\n"), /no recovery action is pending/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout recovery next blocks when outcome evidence is missing", () => {
  const cwd = workspace("agent-run-driver-fanout-recovery-missing-");
  try {
    const report = buildAgentRunDriverFanoutRecoveryNext({ cwd });

    assert.equal(report.decision, "blocked");
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.ok(report.blockers.includes("fanout-outcome-missing"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout recovery next CLI writes report artifact", () => {
  const cwd = workspace("agent-run-driver-fanout-recovery-cli-");
  try {
    const sourcePath = writeOutcome(cwd, {
      decision: "block",
      workerCount: 1,
      passedWorkerCount: 0,
      workerSummaries: [{
        workerId: "worker-a",
        runId: "fanout-worker-a",
        processState: "completed",
        contractDecision: "fail",
        blockers: ["worker-output-fail"],
      }],
    });
    const outPath = ".artifacts/agent-run-driver/fanout-recovery-next.json";
    const result = spawnSync(process.execPath, [
      cliPath,
      "--cwd",
      cwd,
      "--source",
      sourcePath,
      "--out",
      outPath,
    ], { cwd, encoding: "utf8" });

    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.decision, "next-action-ready");
    assert.equal(JSON.parse(readFileSync(path.join(cwd, outPath), "utf8")).decision, "next-action-ready");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
