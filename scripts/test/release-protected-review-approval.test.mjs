import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildReleaseProtectedReviewApproval } from "../release-protected-review-approval.mjs";

const cliPath = fileURLToPath(new URL("../release-protected-review-approval.mjs", import.meta.url));

function workspace() {
  return mkdtempSync(path.join(tmpdir(), "release-protected-review-approval-"));
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

test("protected review approval requires exact prompt without dispatch", () => {
  const result = buildReleaseProtectedReviewApproval({ status: status() });

  assert.equal(result.mode, "release-protected-review-approval");
  assert.equal(result.decision, "approval-required");
  assert.equal(result.requiredApprovalPrompt, "approve recovery rerun protected-board-task");
  assert.equal(result.operatorApprovalMatched, false);
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.processStartAllowed, false);
  assert.equal(result.protectedActionsAllowed, false);
  assert.deepEqual(result.approvalValidationCommandPreview, {
    command: "node",
    args: [
      "scripts/release-protected-review-approval.mjs",
      "--target",
      "0.8.0",
      "--tag",
      "v0.8.0",
      "--operator-approval",
      "approve recovery rerun protected-board-task",
    ],
    shellInterpolationAllowed: false,
    dispatchAllowed: false,
    processStartAllowed: false,
  });
  assert.equal(result.approvedHandoff, null);
  assert.deepEqual(result.blockers, []);
});

test("protected review approval accepts the next protected review prompt", () => {
  const result = buildReleaseProtectedReviewApproval({
    status: status(),
    operatorApproval: "approve recovery rerun protected-board-task",
  });

  assert.equal(result.decision, "approved-for-next-protected-review");
  assert.equal(result.operatorApprovalMatched, true);
  assert.equal(result.nextProtectedReviewRow.selectedWorkerId, "task-bud-480");
  assert.deepEqual(result.approvedHandoff, {
    source: "protected-board-recovery-approval",
    action: "rerun-protected-recovery-worker",
    selectedWorkerId: "task-bud-480",
    approvalScope: "protected-or-external-scope",
    requiredApprovalPrompt: "approve recovery rerun protected-board-task",
    dispatchAllowed: false,
    processStartAllowed: false,
    nextActionCode: "use-source-specific-gate",
  });
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.processStartAllowed, false);
});

test("protected review approval blocks mismatched operator approval", () => {
  const result = buildReleaseProtectedReviewApproval({
    status: status(),
    operatorApproval: "approve release tag create v0.8.0",
  });

  assert.equal(result.decision, "blocked");
  assert.ok(result.blockers.includes("operator-approval-mismatch"));
  assert.equal(result.operatorApprovalMatched, false);
  assert.equal(result.dispatchAllowed, false);
});

test("protected review approval CLI writes report artifact", () => {
  const cwd = workspace();
  try {
    const outPath = ".artifacts/release-cut/protected-review-approval.json";
    mkdirSync(path.join(cwd, ".git"), { recursive: true });
    const result = spawnSync(process.execPath, [
      cliPath,
      "--cwd",
      cwd,
      "--out",
      outPath,
      "--operator-approval",
      "approve release tag create v0.8.0",
    ], { cwd, encoding: "utf8" });

    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.decision, "blocked");
    assert.equal(JSON.parse(readFileSync(path.join(cwd, outPath), "utf8")).decision, "blocked");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("protected review approval CLI can read materialized status evidence", () => {
  const cwd = workspace();
  try {
    const statusPath = ".artifacts/release-cut/status.json";
    const fullStatusPath = path.join(cwd, statusPath);
    mkdirSync(path.dirname(fullStatusPath), { recursive: true });
    writeFileSync(fullStatusPath, `${JSON.stringify(status(), null, 2)}\n`, "utf8");
    const result = spawnSync(process.execPath, [
      cliPath,
      "--cwd",
      cwd,
      "--status",
      statusPath,
      "--operator-approval",
      "approve recovery rerun protected-board-task",
    ], { cwd, encoding: "utf8" });

    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.decision, "approved-for-next-protected-review");
    assert.equal(report.operatorApprovalMatched, true);
    assert.equal(report.approvedHandoff.selectedWorkerId, "task-bud-480");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
