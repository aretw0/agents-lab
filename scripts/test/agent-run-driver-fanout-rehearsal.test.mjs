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
    assert.equal(report.manifestSource, "default");
    assert.equal(report.maxConcurrency, 2);
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.ok(report.blockers.includes("execute-not-requested"));
    assert.equal(report.workerSummaries.length, 2);
    assert.equal(report.batchOutcomePacket.decision, "block");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout rehearsal runs two local read-only workers with bounded concurrency and aggregates pass", async () => {
  const cwd = workspace("agent-run-driver-fanout-execute-");
  try {
    const report = await runAgentRunDriverFanoutRehearsal({ cwd, maxConcurrency: 1 });

    assert.equal(report.decision, "pass");
    assert.equal(report.dispatchAllowed, true);
    assert.equal(report.processStartAllowed, true);
    assert.equal(report.manifestSource, "default");
    assert.equal(report.maxConcurrency, 1);
    assert.equal(report.workerCount, 2);
    assert.equal(report.passedWorkerCount, 2);
    assert.deepEqual(report.blockers, []);
    assert.deepEqual(report.workerSummaries.map((worker) => worker.contractDecision), ["pass", "pass"]);
    assert.deepEqual(report.workerSummaries.map((worker) => worker.followTerminal), [true, true]);
    assert.equal(report.batchOutcomePacket.mode, "agent-run-batch-outcome-packet");
    assert.equal(report.batchOutcomePacket.decision, "pass");
    assert.equal(report.batchOutcomePacket.maxConcurrency, 1);
    assert.equal(existsSync(path.join(cwd, ".artifacts/agent-run-driver/fanout-rehearsal.json")), true);

    const registry = JSON.parse(readFileSync(path.join(cwd, ".pi/reports/agent-runs.json"), "utf8"));
    assert.equal(registry.runs.length, 2);
    assert.deepEqual(registry.runs.map((run) => run.state).sort(), ["completed", "completed"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout rehearsal runs custom manifest workers with bounded concurrency", async () => {
  const cwd = workspace("agent-run-driver-fanout-manifest-");
  try {
    const report = await runAgentRunDriverFanoutRehearsal({
      cwd,
      maxConcurrency: 2,
      workerSpecs: ["alpha", "beta", "gamma"].map((workerId) => ({
        workerId,
        runSpec: {
          provider_model_ref: "local/process",
          cwd,
          declared_files: ["package.json"],
          log_path: `.pi/reports/custom-${workerId}.log`,
          timeout_ms: 30_000,
          file_contract: "read-only",
          execution_preview: {
            command: process.execPath,
            args: ["-e", `console.log(${JSON.stringify(`custom:${workerId}`)})`],
          },
        },
      })),
    });

    assert.equal(report.decision, "pass");
    assert.equal(report.manifestSource, "custom");
    assert.equal(report.maxConcurrency, 2);
    assert.equal(report.workerCount, 3);
    assert.equal(report.passedWorkerCount, 3);
    assert.deepEqual(report.workerSummaries.map((worker) => worker.workerId), ["alpha", "beta", "gamma"]);
    assert.deepEqual(report.workerSummaries.map((worker) => worker.contractDecision), ["pass", "pass", "pass"]);
    assert.deepEqual(report.blockers, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout rehearsal blocks when any terminal worker reports FAIL output", async () => {
  const cwd = workspace("agent-run-driver-fanout-worker-fail-");
  try {
    const report = await runAgentRunDriverFanoutRehearsal({
      cwd,
      maxConcurrency: 2,
      workerSpecs: [
        {
          workerId: "pass-worker",
          runSpec: {
            provider_model_ref: "local/process",
            cwd,
            declared_files: ["package.json"],
            log_path: ".pi/reports/pass-worker.log",
            timeout_ms: 30_000,
            file_contract: "read-only",
            execution_preview: {
              command: process.execPath,
              args: ["-e", "console.log('PASS/FAIL: PASS')"],
            },
          },
        },
        {
          workerId: "fail-worker",
          runSpec: {
            provider_model_ref: "local/process",
            cwd,
            declared_files: ["package.json"],
            log_path: ".pi/reports/fail-worker.log",
            timeout_ms: 30_000,
            file_contract: "read-only",
            execution_preview: {
              command: process.execPath,
              args: ["-e", "console.log('PASS/FAIL: FAIL')"],
            },
          },
        },
      ],
    });

    assert.equal(report.decision, "block");
    assert.equal(report.workerCount, 2);
    assert.equal(report.passedWorkerCount, 1);
    assert.ok(report.blockers.includes("fail-worker:worker-output-fail"));
    assert.ok(report.blockers.includes("fail-worker:contract-not-pass:fail"));
    assert.equal(report.batchOutcomePacket.decision, "block");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout rehearsal blocks read-only workers that report touched files", async () => {
  const cwd = workspace("agent-run-driver-fanout-readonly-touched-");
  try {
    const report = await runAgentRunDriverFanoutRehearsal({
      cwd,
      maxConcurrency: 1,
      workerSpecs: [
        {
          workerId: "readonly-touch",
          runSpec: {
            provider_model_ref: "local/process",
            cwd,
            declared_files: ["package.json"],
            log_path: ".pi/reports/readonly-touch.log",
            timeout_ms: 30_000,
            file_contract: "read-only",
            touched_files: ["package.json"],
            execution_preview: {
              command: process.execPath,
              args: ["-e", "console.log('read-only touched evidence')"],
            },
          },
        },
      ],
    });

    assert.equal(report.decision, "block");
    assert.equal(report.workerCount, 1);
    assert.equal(report.passedWorkerCount, 0);
    assert.ok(report.blockers.includes("readonly-touch:read-only-touched-files"));
    assert.ok(report.blockers.includes("readonly-touch:contract-not-pass:fail"));
    assert.equal(report.batchOutcomePacket.decision, "block");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout rehearsal preserves registry rows under concurrent worker completion", async () => {
  const cwd = workspace("agent-run-driver-fanout-registry-concurrent-");
  try {
    const workerIds = ["alpha", "beta", "gamma", "delta", "epsilon"];
    const report = await runAgentRunDriverFanoutRehearsal({
      cwd,
      maxConcurrency: workerIds.length,
      workerSpecs: workerIds.map((workerId) => ({
        workerId,
        runSpec: {
          provider_model_ref: "local/process",
          cwd,
          declared_files: ["package.json"],
          log_path: `.pi/reports/concurrent-${workerId}.log`,
          timeout_ms: 30_000,
          file_contract: "read-only",
          execution_preview: {
            command: process.execPath,
            args: ["-e", `setTimeout(() => console.log(${JSON.stringify(`concurrent:${workerId}`)}), 50)`],
          },
        },
      })),
    });

    assert.equal(report.decision, "pass");
    assert.equal(report.workerCount, workerIds.length);
    assert.equal(report.passedWorkerCount, workerIds.length);
    const registry = JSON.parse(readFileSync(path.join(cwd, ".pi/reports/agent-runs.json"), "utf8"));
    assert.equal(registry.runs.length, workerIds.length);
    assert.deepEqual(registry.runs.map((run) => run.runId).sort(), workerIds.map((workerId) => `agent-run-driver-local-fanout-rehearsal-${workerId}`).sort());
    assert.deepEqual(registry.runs.map((run) => run.state).sort(), Array.from({ length: workerIds.length }, () => "completed"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout rehearsal blocks duplicate manifest run ids before dispatch", async () => {
  const cwd = workspace("agent-run-driver-fanout-duplicate-run-");
  try {
    const duplicateRunId = "custom-duplicate-run";
    const report = await runAgentRunDriverFanoutRehearsal({
      cwd,
      workerSpecs: ["one", "two"].map((workerId) => ({
        workerId,
        runSpec: {
          run_id: duplicateRunId,
          provider_model_ref: "local/process",
          cwd,
          declared_files: ["package.json"],
          log_path: `.pi/reports/${workerId}.log`,
          execution_preview: {
            command: process.execPath,
            args: ["--version"],
          },
        },
      })),
    });

    assert.equal(report.decision, "block");
    assert.equal(report.workerCount, 0);
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.ok(report.blockers.includes(`duplicate-run-id:${duplicateRunId}`));
    assert.equal(existsSync(path.join(cwd, ".pi/reports/agent-runs.json")), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout rehearsal blocks invalid concurrency before dispatch", async () => {
  const cwd = workspace("agent-run-driver-fanout-invalid-concurrency-");
  try {
    const report = await runAgentRunDriverFanoutRehearsal({ cwd, maxConcurrency: 0 });

    assert.equal(report.decision, "block");
    assert.equal(report.workerCount, 0);
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.ok(report.blockers.includes("max-concurrency-invalid"));
    assert.equal(existsSync(path.join(cwd, ".pi/reports/agent-runs.json")), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
