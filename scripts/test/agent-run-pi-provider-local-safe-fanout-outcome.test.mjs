import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildLocalSafeFanoutOutcome } from "../agent-run-pi-provider-local-safe-fanout-outcome.mjs";

function workspace() {
  const cwd = mkdtempSync(path.join(tmpdir(), "local-safe-fanout-outcome-"));
  mkdirSync(path.join(cwd, ".artifacts"), { recursive: true });
  return cwd;
}

function writeJson(cwd, relPath, value) {
  const fullPath = path.join(cwd, relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function plan() {
  return {
    mode: "agent-run-pi-provider-fanout-plan",
    decision: "ready-for-operator-decision",
    source: "local-safe-board",
    workerPackets: [
      {
        workerId: "task-local",
        payload: {
          run_spec: {
            run_id: "local-safe-task-local",
          },
        },
      },
    ],
  };
}

function dispatch(contractDecision = "pass", blockers = []) {
  return {
    mode: "agent-run-pi-provider-worker-dispatch",
    runId: "local-safe-task-local",
    terminalProcessState: "completed",
    agentRunOutcomePacket: {
      mode: "agent-run-outcome-packet",
      runId: "local-safe-task-local",
      contractDecision,
      outputBytes: 100,
      blockers,
    },
  };
}

test("local-safe fanout outcome passes only after all worker outcomes pass", () => {
  const cwd = workspace();
  try {
    writeJson(cwd, ".artifacts/plan.json", plan());
    writeJson(cwd, ".artifacts/dispatch.json", dispatch());

    const result = buildLocalSafeFanoutOutcome({
      cwd,
      planPath: ".artifacts/plan.json",
      dispatchPaths: [".artifacts/dispatch.json"],
    });

    assert.equal(result.mode, "agent-run-pi-provider-local-safe-fanout-outcome");
    assert.equal(result.decision, "pass");
    assert.equal(result.recommendation, "allow-parent-materialization-review");
    assert.equal(result.dispatchAllowed, false);
    assert.equal(result.processStartAllowed, false);
    assert.equal(result.workflowDispatchAllowed, false);
    assert.equal(result.workerCount, 1);
    assert.equal(result.passedWorkerCount, 1);
    assert.deepEqual(result.blockers, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("local-safe fanout outcome blocks worker outcome failures before board materialization", () => {
  const cwd = workspace();
  try {
    writeJson(cwd, ".artifacts/plan.json", plan());
    writeJson(cwd, ".artifacts/dispatch.json", dispatch("fail", ["worker-output-fail"]));

    const result = buildLocalSafeFanoutOutcome({
      cwd,
      planPath: ".artifacts/plan.json",
      dispatchPaths: [".artifacts/dispatch.json"],
    });

    assert.equal(result.decision, "block");
    assert.equal(result.recommendation, "block-parent-materialization");
    assert.equal(result.passedWorkerCount, 0);
    assert.ok(result.blockers.includes("task-local:outcome-contract-fail"));
    assert.ok(result.blockers.includes("task-local:outcome-blocker:worker-output-fail"));
    assert.equal(result.dispatchAllowed, false);
    assert.equal(result.processStartAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
