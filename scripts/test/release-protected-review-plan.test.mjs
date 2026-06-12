import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildReleaseProtectedReviewPlan } from "../release-protected-review-plan.mjs";

const cliPath = fileURLToPath(new URL("../release-protected-review-plan.mjs", import.meta.url));

function workspace() {
  return mkdtempSync(path.join(tmpdir(), "release-protected-review-plan-"));
}

function status(overrides = {}) {
  return {
    mode: "release-evidence-status",
    decision: "pass",
    target: "0.8.0",
    tag: "v0.8.0",
    nextProtectedReviewRow: {
      action: "rerun-protected-recovery-worker",
      source: "protected-board-recovery-approval",
      requiredApprovalPrompt: "approve recovery rerun protected-board-task",
      selectedWorkerId: "task-bud-480",
      approvalScope: "protected-or-external-scope",
      dispatchAllowed: false,
      processStartAllowed: false,
    },
    ...overrides,
  };
}

function approval(overrides = {}) {
  return {
    mode: "release-protected-review-approval",
    decision: "approval-required",
    target: "0.8.0",
    tag: "v0.8.0",
    requiredApprovalPrompt: "approve recovery rerun protected-board-task",
    nextProtectedReviewRow: status().nextProtectedReviewRow,
    dispatchAllowed: false,
    processStartAllowed: false,
    blockers: [],
    ...overrides,
  };
}

test("protected review plan starts with one protected worker approval required", () => {
  const result = buildReleaseProtectedReviewPlan({ status: status(), approval: approval() });

  assert.equal(result.mode, "release-protected-review-plan");
  assert.equal(result.decision, "single-worker-approval-required");
  assert.equal(result.requiredApprovalPrompt, "approve recovery rerun protected-board-task");
  assert.equal(result.maxConcurrentProtectedWorkersAllowedNow, 1);
  assert.equal(result.workerVolumeAllowedNow, false);
  assert.equal(result.singleWorkerAllowedAfterApproval, false);
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.processStartAllowed, false);
  assert.equal(result.protectedRamp[0].stage, "single-protected-worker");
  assert.equal(result.protectedRamp[0].allowedNow, true);
  assert.equal(result.protectedRamp[1].allowedNow, false);
  assert.match(result.nextActions.join("\n"), /approve exactly one protected action first/);
});

test("protected review plan recognizes one approved protected action without enabling volume", () => {
  const result = buildReleaseProtectedReviewPlan({
    status: status(),
    approval: approval({ decision: "approved-for-next-protected-review" }),
  });

  assert.equal(result.decision, "single-worker-approved");
  assert.equal(result.maxConcurrentProtectedWorkersAllowedNow, 1);
  assert.equal(result.workerVolumeAllowedNow, false);
  assert.equal(result.singleWorkerAllowedAfterApproval, true);
  assert.match(result.nextActions.join("\n"), /run only the approved source-specific path/);
});

test("protected review plan blocks when status is not pass", () => {
  const result = buildReleaseProtectedReviewPlan({
    status: status({ decision: "block" }),
    approval: approval(),
  });

  assert.equal(result.decision, "blocked");
  assert.ok(result.blockers.includes("release-evidence-status-not-pass:block"));
  assert.equal(result.maxConcurrentProtectedWorkersAllowedNow, 0);
  assert.equal(result.dispatchAllowed, false);
});

test("protected review plan CLI writes report artifact", () => {
  const cwd = workspace();
  try {
    const statusPath = ".artifacts/release-cut/status.json";
    const approvalPath = ".artifacts/release-cut/approval.json";
    const outPath = ".artifacts/release-cut/protected-review-plan.json";
    mkdirSync(path.join(cwd, ".artifacts", "release-cut"), { recursive: true });
    writeFileSync(path.join(cwd, statusPath), `${JSON.stringify(status(), null, 2)}\n`, "utf8");
    writeFileSync(path.join(cwd, approvalPath), `${JSON.stringify(approval(), null, 2)}\n`, "utf8");
    const result = spawnSync(process.execPath, [
      cliPath,
      "--cwd",
      cwd,
      "--status",
      statusPath,
      "--approval",
      approvalPath,
      "--out",
      outPath,
    ], { cwd, encoding: "utf8" });

    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.decision, "single-worker-approval-required");
    assert.equal(JSON.parse(readFileSync(path.join(cwd, outPath), "utf8")).mode, "release-protected-review-plan");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
