import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildAgentRunProtectedReviewEvidence } from "../agent-run-protected-review-evidence.mjs";

const cliPath = fileURLToPath(new URL("../agent-run-protected-review-evidence.mjs", import.meta.url));

function workspace() {
  return mkdtempSync(path.join(tmpdir(), "agent-run-protected-review-evidence-"));
}

function writeJson(cwd, relPath, value) {
  const filePath = path.join(cwd, relPath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function seed(cwd, overrides = {}) {
  writeJson(cwd, "driver-step.json", {
    mode: "agent-run-driver-step-dispatch",
    dispatchAllowed: true,
    processStartAllowed: true,
    pid: 40432,
    runSpec: { runId: "protected-board-research-0-8-task-bud-480" },
    registryEntry: { state: "completed", exitCode: 0 },
    follow: { terminal: true, outputBytes: 2916, lines: ["PASS"] },
    agentRunOutcomePacket: {
      contractDecision: "pass",
      outputBytes: 2916,
      touchedFiles: [],
      blockers: [],
    },
    ...overrides.driverStep,
  });
  writeJson(cwd, "fanout-outcome.json", {
    mode: "agent-run-driver-fanout-outcome-report",
    decision: "block",
    workerCount: 3,
    passedWorkerCount: 2,
    blockers: ["task-bud-676:worker-output-fail"],
  });
  writeJson(cwd, "recovery-next.json", {
    mode: "agent-run-driver-fanout-recovery-next",
    decision: "next-action-ready",
    selectedWorker: {
      workerId: "task-bud-676",
      runId: "protected-board-research-0-8-task-bud-676",
    },
  });
  writeJson(cwd, "recovery-approval.json", {
    mode: "agent-run-driver-fanout-recovery-approval",
    decision: "approval-required",
    approvalScope: "protected-or-external-scope",
    selectedWorker: {
      workerId: "task-bud-676",
      runId: "protected-board-research-0-8-task-bud-676",
    },
    requiredApprovalPrompt: "approve recovery rerun protected-board-research-0-8-task-bud-676",
  });
}

function build(cwd) {
  return buildAgentRunProtectedReviewEvidence({
    cwd,
    driverStepResultPath: "driver-step.json",
    fanoutOutcomePath: "fanout-outcome.json",
    recoveryNextPath: "recovery-next.json",
    recoveryApprovalPath: "recovery-approval.json",
  });
}

test("protected review evidence summarizes one approved worker and next gate", () => {
  const cwd = workspace();
  try {
    seed(cwd);
    const result = build(cwd);

    assert.equal(result.mode, "agent-run-protected-review-evidence");
    assert.equal(result.decision, "pass");
    assert.equal(result.approvedWorker.workerId, "task-bud-480");
    assert.equal(result.approvedWorker.contractDecision, "pass");
    assert.equal(result.approvedWorker.touchedFiles.length, 0);
    assert.equal(result.fanoutProgress.passedWorkerCount, 2);
    assert.equal(result.nextProtectedReview.workerId, "task-bud-676");
    assert.equal(result.nextProtectedReview.requiredApprovalPrompt, "approve recovery rerun protected-board-research-0-8-task-bud-676");
    assert.equal(result.dispatchAllowed, false);
    assert.equal(result.processStartAllowed, false);
    assert.equal(result.protectedActionsAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("protected review evidence blocks failed approved worker outcome", () => {
  const cwd = workspace();
  try {
    seed(cwd, {
      driverStep: {
        agentRunOutcomePacket: {
          contractDecision: "fail",
          outputBytes: 100,
          touchedFiles: [],
          blockers: ["process-state-failed"],
        },
      },
    });
    const result = build(cwd);

    assert.equal(result.decision, "block");
    assert.ok(result.blockers.includes("approved-worker-contract-not-pass:fail"));
    assert.equal(result.dispatchAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("protected review evidence CLI writes report artifact", () => {
  const cwd = workspace();
  try {
    seed(cwd);
    const result = spawnSync(process.execPath, [
      cliPath,
      "--cwd",
      cwd,
      "--driver-step-result",
      "driver-step.json",
      "--fanout-outcome",
      "fanout-outcome.json",
      "--recovery-next",
      "recovery-next.json",
      "--recovery-approval",
      "recovery-approval.json",
      "--out",
      ".artifacts/agent-run-driver/protected-review-evidence.json",
    ], { cwd, encoding: "utf8" });

    assert.equal(result.status, 0);
    const stdout = JSON.parse(result.stdout);
    assert.equal(stdout.decision, "pass");
    const written = JSON.parse(readFileSync(path.join(cwd, ".artifacts", "agent-run-driver", "protected-review-evidence.json"), "utf8"));
    assert.equal(written.mode, "agent-run-protected-review-evidence");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
