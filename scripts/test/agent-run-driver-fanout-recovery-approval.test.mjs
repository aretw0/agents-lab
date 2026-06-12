import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildAgentRunDriverFanoutRecoveryApproval } from "../agent-run-driver-fanout-recovery-approval.mjs";

const cliPath = fileURLToPath(new URL("../agent-run-driver-fanout-recovery-approval.mjs", import.meta.url));

function workspace(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function writeRecoveryNext(cwd, payload) {
  const relPath = ".artifacts/agent-run-driver/fanout-recovery-next.json";
  const fullPath = path.join(cwd, relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${JSON.stringify({
    mode: "agent-run-driver-fanout-recovery-next",
    schemaVersion: 1,
    decision: "next-action-ready",
    dispatchAllowed: false,
    processStartAllowed: false,
    automationAllowed: false,
    sourcePath: ".artifacts/agent-run-driver/fanout-outcome.json",
    failureKind: "worker-output-fail",
    ...payload,
  }, null, 2)}\n`, "utf8");
  return relPath;
}

test("fanout recovery approval requires exact operator approval without dispatch", () => {
  const cwd = workspace("agent-run-driver-fanout-recovery-approval-");
  try {
    const sourcePath = writeRecoveryNext(cwd, {
      selectedWorker: {
        workerId: "task-bud-480",
        runId: "protected-board-task-bud-480",
        logPath: ".pi/reports/protected-board-task-bud-480.log",
        blockers: ["worker-output-fail"],
      },
      selectedWorkerLogTail: {
        lines: ["Blockers:", "- protected scope requires human approval"],
      },
    });

    const report = buildAgentRunDriverFanoutRecoveryApproval({ cwd, sourcePath });

    assert.equal(report.mode, "agent-run-driver-fanout-recovery-approval");
    assert.equal(report.decision, "approval-required");
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.equal(report.automationAllowed, false);
    assert.equal(report.approvalScope, "protected-or-external-scope");
    assert.equal(report.requiredApprovalPrompt, "approve recovery rerun protected-board-task-bud-480");
    assert.equal(report.operatorApprovalMatched, false);
    assert.equal(report.singleRunOnly, true);
    assert.match(report.nextActions.join("\n"), /present approval prompt exactly/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout recovery approval accepts only the selected worker approval prompt", () => {
  const cwd = workspace("agent-run-driver-fanout-recovery-approved-");
  try {
    const sourcePath = writeRecoveryNext(cwd, {
      selectedWorker: {
        workerId: "worker-a",
        runId: "fanout-worker-a",
        logPath: ".pi/reports/fanout-worker-a.log",
        blockers: ["worker-output-fail"],
      },
    });

    const report = buildAgentRunDriverFanoutRecoveryApproval({
      cwd,
      sourcePath,
      operatorApproval: "approve recovery rerun fanout-worker-a",
    });

    assert.equal(report.decision, "approved-for-single-rerun");
    assert.equal(report.operatorApprovalMatched, true);
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.match(report.nextActions.join("\n"), /exactly one selected worker/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout recovery approval blocks incomplete recovery-next evidence", () => {
  const cwd = workspace("agent-run-driver-fanout-recovery-approval-block-");
  try {
    const sourcePath = writeRecoveryNext(cwd, {
      decision: "complete",
      selectedWorker: null,
    });

    const report = buildAgentRunDriverFanoutRecoveryApproval({ cwd, sourcePath });

    assert.equal(report.decision, "blocked");
    assert.ok(report.blockers.includes("fanout-recovery-next-not-ready:complete"));
    assert.ok(report.blockers.includes("fanout-recovery-selected-worker-missing"));
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout recovery approval CLI writes report artifact", () => {
  const cwd = workspace("agent-run-driver-fanout-recovery-approval-cli-");
  try {
    const sourcePath = writeRecoveryNext(cwd, {
      selectedWorker: {
        workerId: "worker-a",
        runId: "fanout-worker-a",
        logPath: ".pi/reports/fanout-worker-a.log",
        blockers: ["worker-output-fail"],
      },
    });
    const outPath = ".artifacts/agent-run-driver/fanout-recovery-approval.json";
    const result = spawnSync(process.execPath, [
      cliPath,
      "--cwd",
      cwd,
      "--source",
      sourcePath,
      "--out",
      outPath,
      "--operator-approval",
      "approve recovery rerun fanout-worker-a",
    ], { cwd, encoding: "utf8" });

    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.decision, "approved-for-single-rerun");
    assert.equal(JSON.parse(readFileSync(path.join(cwd, outPath), "utf8")).decision, "approved-for-single-rerun");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
