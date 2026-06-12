import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runAgentRunDriverFanoutOutcome } from "../agent-run-driver-fanout-outcome.mjs";

function workspace(prefix) {
  const cwd = mkdtempSync(path.join(tmpdir(), prefix));
  writeFileSync(path.join(cwd, "package.json"), "{}\n", "utf8");
  return cwd;
}

function workerPacket({ workerId, runId }) {
  return {
    workerId,
    driverStepCall: {
      tool: "agent_run_driver_step_dispatch",
      params: {
        run_spec: {
          run_id: runId,
          provider_model_ref: "local/process",
          cwd: ".",
          declared_files: ["package.json"],
          log_path: `.pi/reports/${runId}.log`,
          timeout_ms: 30_000,
          file_contract: "read-only",
          execution_preview: {
            command: process.execPath,
            args: ["--version"],
          },
        },
      },
    },
  };
}

function writeCompletedRun(cwd, runId, output) {
  const logPath = path.join(cwd, ".pi", "reports", `${runId}.log`);
  mkdirSync(path.dirname(logPath), { recursive: true });
  writeFileSync(logPath, output, "utf8");
  return {
    runId,
    state: "completed",
    pid: 1111,
    exitCode: 0,
    providerModelRef: "local/process",
    cwd,
    declaredFiles: ["package.json"],
    logPath,
    outputBytes: statSync(logPath).size,
  };
}

function writePlanAndRegistry(cwd, workers, runs) {
  const planPath = path.join(cwd, ".artifacts", "agent-run-driver", "fanout-plan.json");
  const registryPath = path.join(cwd, ".pi", "reports", "agent-runs.json");
  mkdirSync(path.dirname(planPath), { recursive: true });
  mkdirSync(path.dirname(registryPath), { recursive: true });
  writeFileSync(planPath, `${JSON.stringify({
    mode: "agent-run-driver-fanout-plan",
    batchId: "fanout-outcome-test",
    workerPackets: workers,
  }, null, 2)}\n`, "utf8");
  writeFileSync(registryPath, `${JSON.stringify({ runs }, null, 2)}\n`, "utf8");
  return ".artifacts/agent-run-driver/fanout-plan.json";
}

test("fanout outcome re-evaluates existing registry and blocks failed worker output", async () => {
  const cwd = workspace("agent-run-driver-fanout-outcome-fail-");
  try {
    const workers = [
      workerPacket({ workerId: "worker-a", runId: "fanout-outcome-worker-a" }),
      workerPacket({ workerId: "worker-b", runId: "fanout-outcome-worker-b" }),
    ];
    const planPath = writePlanAndRegistry(cwd, workers, [
      writeCompletedRun(cwd, "fanout-outcome-worker-a", "PASS/FAIL: PASS\n"),
      writeCompletedRun(cwd, "fanout-outcome-worker-b", "PASS/FAIL: **FAIL (blocked)**\nBlockers: missing acceptance criteria\n"),
    ]);

    const report = await runAgentRunDriverFanoutOutcome({ cwd, planPath });

    assert.equal(report.mode, "agent-run-driver-fanout-outcome-report");
    assert.equal(report.decision, "block");
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.equal(report.batchExecutionAllowed, false);
    assert.equal(report.workerCount, 2);
    assert.equal(report.passedWorkerCount, 1);
    assert.equal(report.workerSummaries[1].contractDecision, "fail");
    assert.ok(report.workerSummaries[1].markerFailures.includes("worker-output-fail"));
    assert.ok(report.blockers.includes("worker-b:worker-output-fail"));
    assert.ok(report.blockers.includes("worker-b:contract-not-pass:fail"));
    assert.equal(report.batchOutcomePacket.decision, "block");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout outcome passes when all existing worker outcomes pass", async () => {
  const cwd = workspace("agent-run-driver-fanout-outcome-pass-");
  try {
    const workers = [
      workerPacket({ workerId: "worker-a", runId: "fanout-outcome-pass-worker-a" }),
      workerPacket({ workerId: "worker-b", runId: "fanout-outcome-pass-worker-b" }),
    ];
    const planPath = writePlanAndRegistry(cwd, workers, [
      writeCompletedRun(cwd, "fanout-outcome-pass-worker-a", "PASS/FAIL: PASS\n"),
      writeCompletedRun(cwd, "fanout-outcome-pass-worker-b", "**PASS/FAIL (research-readiness): PASS**\n"),
    ]);

    const report = await runAgentRunDriverFanoutOutcome({ cwd, planPath });

    assert.equal(report.decision, "pass");
    assert.equal(report.workerCount, 2);
    assert.equal(report.passedWorkerCount, 2);
    assert.deepEqual(report.blockers, []);
    assert.deepEqual(report.workerSummaries.map((worker) => worker.contractDecision), ["pass", "pass"]);
    assert.equal(report.batchOutcomePacket.decision, "pass");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout outcome blocks missing plan without dispatch", async () => {
  const cwd = workspace("agent-run-driver-fanout-outcome-missing-plan-");
  try {
    const report = await runAgentRunDriverFanoutOutcome({
      cwd,
      planPath: ".artifacts/agent-run-driver/missing-plan.json",
    });

    assert.equal(report.decision, "block");
    assert.equal(report.workerCount, 0);
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.ok(report.blockers.includes("fanout-plan-missing"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
