import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { writeAgentRunPiProviderFanoutPlan } from "../agent-run-pi-provider-fanout-plan.mjs";
import { runAgentRunPiProviderWorkerDispatch } from "../agent-run-pi-provider-worker-dispatch.mjs";

function workspace(prefix) {
  const cwd = mkdtempSync(path.join(tmpdir(), prefix));
  const cliPath = path.join(cwd, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  mkdirSync(path.dirname(cliPath), { recursive: true });
  writeFileSync(cliPath, "console.log('provider worker pass')\n", "utf8");
  writeFileSync(path.join(cwd, "package.json"), "{}\n", "utf8");
  return cwd;
}

function failingWorkspace(prefix) {
  const cwd = workspace(prefix);
  const cliPath = path.join(cwd, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  writeFileSync(cliPath, "console.error('provider missing'); process.exit(1)\n", "utf8");
  return cwd;
}

function plan(cwd) {
  return writeAgentRunPiProviderFanoutPlan({
    cwd,
    outPath: ".artifacts/agent-run-driver/pi-provider-fanout-plan.json",
  });
}

function writeBlockedReadinessExecution(cwd) {
  const filePath = path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-worker-a-real-execute.json");
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({
    mode: "agent-run-pi-provider-worker-dispatch",
    decision: "dispatched",
    terminalProcessState: "failed",
    contractDecision: "fail",
    outcomeBlockers: ["process-state-failed"],
    driverStep: {
      registryEntry: { envKeys: ["PI_CODING_AGENT_DIR"] },
      follow: { lines: ["fetch failed"] },
    },
  })}\n`, "utf8");
}

test("provider worker dispatch previews one selected worker without dispatch", async () => {
  const cwd = workspace("pi-provider-worker-preview-");
  try {
    plan(cwd);
    const result = await runAgentRunPiProviderWorkerDispatch({ cwd });

    assert.equal(result.mode, "agent-run-pi-provider-worker-dispatch");
    assert.equal(result.decision, "ready-for-operator-decision");
    assert.equal(result.workerId, "worker-a");
    assert.equal(result.workerCount, 1);
    assert.equal(result.dispatchAllowed, false);
    assert.equal(result.processStartAllowed, false);
    assert.equal(result.batchExecutionAllowed, false);
    assert.equal(result.singleRunOnly, true);
    assert.equal(result.driverStepCall.tool, "agent_run_driver_step_dispatch");
    assert.equal(result.driverStepCall.params.execute, undefined);
    assert.equal(existsSync(path.join(cwd, ".pi", "reports", "agent-runs.json")), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider worker dispatch blocks execute without structured approval", async () => {
  const cwd = workspace("pi-provider-worker-no-approval-");
  try {
    plan(cwd);
    const result = await runAgentRunPiProviderWorkerDispatch({ cwd, execute: true });

    assert.equal(result.decision, "blocked");
    assert.equal(result.dispatchAllowed, false);
    assert.equal(result.processStartAllowed, false);
    assert.ok(result.blockers.includes("structured-operator-approval-missing"));
    assert.equal(existsSync(path.join(cwd, ".pi", "reports", "agent-runs.json")), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider worker dispatch executes only one selected worker with approval", async () => {
  const cwd = workspace("pi-provider-worker-approved-");
  try {
    const report = plan(cwd);
    const result = await runAgentRunPiProviderWorkerDispatch({
      cwd,
      workerId: "worker-b",
      execute: true,
      approve: true,
      skipReadiness: true,
    });

    assert.equal(result.decision, "dispatched");
    assert.equal(result.workerId, "worker-b");
    assert.equal(result.workerCount, 1);
    assert.equal(result.dispatchAllowed, true);
    assert.equal(result.processStartAllowed, true);
    assert.equal(result.agentRunOutcomePacket?.mode, "agent-run-outcome-packet");
    assert.equal(result.agentRunOutcomePacket?.contractDecision, "pass");

    const registry = JSON.parse(readFileSync(path.join(cwd, ".pi", "reports", "agent-runs.json"), "utf8"));
    assert.equal(registry.runs.length, 1);
    assert.equal(registry.runs[0].runId, report.workerPackets[1].payload.run_spec.run_id);
    assert.equal(registry.runs[0].state, "completed");
    assert.equal(registry.runs.some((run) => run.runId === report.workerPackets[0].payload.run_spec.run_id), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider worker dispatch surfaces terminal outcome failure at top level", async () => {
  const cwd = failingWorkspace("pi-provider-worker-fail-");
  try {
    plan(cwd);
    const result = await runAgentRunPiProviderWorkerDispatch({
      cwd,
      execute: true,
      approve: true,
      skipReadiness: true,
    });

    assert.equal(result.decision, "dispatched");
    assert.equal(result.dispatchAllowed, true);
    assert.equal(result.terminalProcessState, "failed");
    assert.equal(result.contractDecision, "fail");
    assert.deepEqual(result.outcomeBlockers, ["process-state-failed"]);
    assert.match(result.summary, /contract=fail/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider worker dispatch blocks execute when readiness is blocked", async () => {
  const cwd = workspace("pi-provider-worker-readiness-blocked-");
  try {
    plan(cwd);
    writeBlockedReadinessExecution(cwd);
    const result = await runAgentRunPiProviderWorkerDispatch({
      cwd,
      execute: true,
      approve: true,
    });

    assert.equal(result.decision, "blocked");
    assert.equal(result.dispatchAllowed, false);
    assert.equal(result.processStartAllowed, false);
    assert.ok(result.blockers.includes("provider-readiness:provider-fetch-failed"));
    assert.equal(result.providerReadiness.decision, "blocked");
    assert.equal(existsSync(path.join(cwd, ".pi", "reports", "agent-runs.json")), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider worker dispatch blocks invalid worker selection", async () => {
  const cwd = workspace("pi-provider-worker-missing-");
  try {
    plan(cwd);
    const result = await runAgentRunPiProviderWorkerDispatch({ cwd, workerIndex: 9 });

    assert.equal(result.decision, "blocked");
    assert.ok(result.blockers.includes("worker-selection-missing"));
    assert.equal(result.dispatchAllowed, false);
    assert.equal(result.processStartAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
