import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildReleaseEvidenceStatus } from "../release-evidence-status.mjs";

function workspace() {
  return mkdtempSync(path.join(tmpdir(), "release-evidence-status-"));
}

function writeJson(cwd, relPath, value) {
  const fullPath = path.join(cwd, relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function refresh(overrides = {}) {
  return {
    mode: "release-evidence-refresh",
    decision: "pass",
    target: "0.8.0",
    tag: "v0.8.0",
    paths: {
      finalGatePath: ".artifacts/release-cut/v0.8.0-final-gate.json",
    },
    canarySuiteDecision: "pass",
    protectedReviewEvidenceDecision: "pass",
    protectedReviewEvidenceApprovedWorkerId: "task-bud-480",
    protectedReviewEvidenceApprovedRunId: "protected-board-research-0-8-task-bud-480",
    protectedReviewEvidenceApprovedContractDecision: "pass",
    protectedReviewEvidenceFanoutPassedWorkerCount: 2,
    protectedReviewEvidenceFanoutWorkerCount: 3,
    readinessDecision: "ready",
    protectedBoardRecoveryApprovalDecision: "approval-required",
    protectedBoardRecoveryApprovalPrompt: "approve recovery rerun protected-board-task",
    protectedBoardRecoveryApprovalSelectedWorkerId: "task-bud-480",
    protectedBoardRecoveryApprovalScope: "protected-or-external-scope",
    draftDecision: "ready-for-operator-review",
    finalGateDecision: "pass",
    finalGateHead: "abc1234",
    requiredApprovalPrompts: [
      "approve release tag create v0.8.0",
      "approve release tag push v0.8.0",
      "approve release draft prepare-draft-release v0.8.0",
      "approve release publish v0.8.0",
    ],
    protectedActionsAllowed: false,
    tagAllowed: false,
    publishAllowed: false,
    workflowDispatchAllowed: false,
    processStartAllowed: false,
    ...overrides,
  };
}

function finalGate(overrides = {}) {
  return {
    mode: "release-final-gate",
    decision: "pass",
    target: "0.8.0",
    tag: "v0.8.0",
    head: "abc1234",
    requiredApprovalPrompts: [
      "approve release tag create v0.8.0",
      "approve release tag push v0.8.0",
      "approve release draft prepare-draft-release v0.8.0",
      "approve release publish v0.8.0",
    ],
    protectedActionsAllowed: false,
    tagAllowed: false,
    publishAllowed: false,
    workflowDispatchAllowed: false,
    processStartAllowed: false,
    cutPreview: {
      target: "0.8.0",
      tag: "v0.8.0",
    },
    artifactAudit: {
      target: "0.8.0",
      tag: "v0.8.0",
    },
    ...overrides,
  };
}

test("release evidence status passes coherent materialized evidence without running refresh", () => {
  const cwd = workspace();
  try {
    writeJson(cwd, ".artifacts/release-cut/v0.8.0-evidence-refresh.json", refresh());
    writeJson(cwd, ".artifacts/release-cut/v0.8.0-final-gate.json", finalGate());

    const result = buildReleaseEvidenceStatus({ cwd, target: "0.8.0", head: "abc1234" });

    assert.equal(result.mode, "release-evidence-status");
    assert.equal(result.decision, "pass");
    assert.equal(result.recommendation, "ready-for-protected-operator-review");
    assert.equal(result.evidencePath, ".artifacts/release-cut/v0.8.0-evidence-refresh.json");
    assert.equal(result.finalGatePath, ".artifacts/release-cut/v0.8.0-final-gate.json");
    assert.equal(result.headMatches, true);
    assert.equal(result.refreshDecision, "pass");
    assert.equal(result.finalGateDecision, "pass");
    assert.equal(result.protectedReviewEvidenceDecision, "pass");
    assert.equal(result.protectedReviewEvidenceApprovedWorkerId, "task-bud-480");
    assert.equal(result.protectedReviewEvidenceApprovedRunId, "protected-board-research-0-8-task-bud-480");
    assert.equal(result.protectedReviewEvidenceApprovedContractDecision, "pass");
    assert.equal(result.protectedReviewEvidenceFanoutPassedWorkerCount, 2);
    assert.equal(result.protectedReviewEvidenceFanoutWorkerCount, 3);
    assert.equal(result.protectedBoardRecoveryApprovalDecision, "approval-required");
    assert.equal(result.protectedBoardRecoveryApprovalPrompt, "approve recovery rerun protected-board-task");
    assert.equal(result.protectedBoardRecoveryApprovalSelectedWorkerId, "task-bud-480");
    assert.equal(result.protectedBoardRecoveryApprovalScope, "protected-or-external-scope");
    assert.equal(result.approvalPromptCount, 4);
    assert.equal(result.protectedReviewPromptCount, 5);
    assert.deepEqual(result.protectedReviewPrompts, [
      "approve recovery rerun protected-board-task",
      "approve release tag create v0.8.0",
      "approve release tag push v0.8.0",
      "approve release draft prepare-draft-release v0.8.0",
      "approve release publish v0.8.0",
    ]);
    assert.deepEqual(result.protectedReviewRows[0], {
      action: "rerun-protected-recovery-worker",
      source: "protected-board-recovery-approval",
      requiredApprovalPrompt: "approve recovery rerun protected-board-task",
      selectedWorkerId: "task-bud-480",
      approvalScope: "protected-or-external-scope",
      dispatchAllowed: false,
      processStartAllowed: false,
    });
    assert.deepEqual(result.protectedReviewRows[1], {
      action: "tag create v0.8.0",
      source: "release-final-gate",
      requiredApprovalPrompt: "approve release tag create v0.8.0",
      dispatchAllowed: false,
      processStartAllowed: false,
    });
    assert.deepEqual(result.nextProtectedReviewRow, result.protectedReviewRows[0]);
    assert.match(result.summary, /protectedRecoveryApproval=approval-required/);
    assert.deepEqual(result.blockers, []);
    assert.equal(result.protectedActionsAllowed, false);
    assert.equal(result.processStartAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release evidence status blocks missing or stale evidence", () => {
  const cwd = workspace();
  try {
    writeJson(cwd, ".artifacts/release-cut/v0.8.0-evidence-refresh.json", refresh({ finalGateDecision: "block" }));
    writeJson(cwd, ".artifacts/release-cut/v0.8.0-final-gate.json", finalGate({ head: "oldsha" }));

    const result = buildReleaseEvidenceStatus({ cwd, target: "0.8.0", head: "abc1234" });

    assert.equal(result.decision, "block");
    assert.equal(result.recommendation, "refresh-or-repair-release-evidence");
    assert.ok(result.blockers.includes("release-evidence-final-gate-not-pass"));
    assert.ok(result.blockers.includes("release-final-gate-stale-head"));
    assert.equal(result.tagAllowed, false);
    assert.equal(result.workflowDispatchAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release evidence status blocks when refresh artifact is absent", () => {
  const cwd = workspace();
  try {
    const result = buildReleaseEvidenceStatus({ cwd, target: "0.8.0", head: "abc1234" });

    assert.equal(result.decision, "block");
    assert.ok(result.blockers.includes("release-evidence-refresh-missing"));
    assert.ok(result.blockers.includes("release-final-gate-missing"));
    assert.equal(result.refreshDecision, "missing");
    assert.equal(result.finalGateDecision, "missing");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release evidence status blocks when current head is unavailable", () => {
  const cwd = workspace();
  try {
    writeJson(cwd, ".artifacts/release-cut/v0.8.0-evidence-refresh.json", refresh());
    writeJson(cwd, ".artifacts/release-cut/v0.8.0-final-gate.json", finalGate());

    const result = buildReleaseEvidenceStatus({ cwd, target: "0.8.0", head: "" });

    assert.equal(result.decision, "block");
    assert.ok(result.blockers.includes("release-current-head-missing"));
    assert.equal(result.headMatches, false);
    assert.equal(result.protectedActionsAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release evidence status blocks when refresh final gate head is stale or mismatched", () => {
  const cwd = workspace();
  try {
    writeJson(cwd, ".artifacts/release-cut/v0.8.0-evidence-refresh.json", refresh({ finalGateHead: "oldsha" }));
    writeJson(cwd, ".artifacts/release-cut/v0.8.0-final-gate.json", finalGate({ head: "abc1234" }));

    const result = buildReleaseEvidenceStatus({ cwd, target: "0.8.0", head: "abc1234" });

    assert.equal(result.decision, "block");
    assert.ok(result.blockers.includes("release-evidence-final-gate-stale-head"));
    assert.ok(result.blockers.includes("release-evidence-final-gate-head-mismatch"));
    assert.equal(result.finalGateHead, "abc1234");
    assert.equal(result.protectedActionsAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release evidence status blocks when protected approval prompts are incomplete", () => {
  const cwd = workspace();
  try {
    writeJson(cwd, ".artifacts/release-cut/v0.8.0-evidence-refresh.json", refresh({ requiredApprovalPrompts: [] }));
    writeJson(cwd, ".artifacts/release-cut/v0.8.0-final-gate.json", finalGate({ requiredApprovalPrompts: [] }));

    const result = buildReleaseEvidenceStatus({ cwd, target: "0.8.0", head: "abc1234" });

    assert.equal(result.decision, "block");
    assert.equal(result.approvalPromptCount, 0);
    assert.ok(result.blockers.includes("release-approval-prompt-missing:approve release tag create v0.8.0"));
    assert.ok(result.blockers.includes("release-approval-prompt-missing:approve release publish v0.8.0"));
    assert.equal(result.workflowDispatchAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release evidence status requires approval prompts in refresh and final gate artifacts", () => {
  const cwd = workspace();
  try {
    writeJson(cwd, ".artifacts/release-cut/v0.8.0-evidence-refresh.json", refresh());
    writeJson(cwd, ".artifacts/release-cut/v0.8.0-final-gate.json", finalGate({ requiredApprovalPrompts: [] }));

    const result = buildReleaseEvidenceStatus({ cwd, target: "0.8.0", head: "abc1234" });

    assert.equal(result.decision, "block");
    assert.equal(result.approvalPromptCount, 4);
    assert.ok(result.blockers.includes("release-final-gate-approval-prompt-missing:approve release tag create v0.8.0"));
    assert.ok(result.blockers.includes("release-final-gate-approval-prompt-missing:approve release publish v0.8.0"));
    assert.equal(result.processStartAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release evidence status blocks protected action flags in source artifacts", () => {
  const cwd = workspace();
  try {
    writeJson(cwd, ".artifacts/release-cut/v0.8.0-evidence-refresh.json", refresh({ publishAllowed: true }));
    writeJson(cwd, ".artifacts/release-cut/v0.8.0-final-gate.json", finalGate({ workflowDispatchAllowed: true }));

    const result = buildReleaseEvidenceStatus({ cwd, target: "0.8.0", head: "abc1234" });

    assert.equal(result.decision, "block");
    assert.ok(result.blockers.includes("release-evidence-publishAllowed-not-false"));
    assert.ok(result.blockers.includes("release-final-gate-workflowDispatchAllowed-not-false"));
    assert.equal(result.publishAllowed, false);
    assert.equal(result.workflowDispatchAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release evidence status blocks final gate target or tag mismatch", () => {
  const cwd = workspace();
  try {
    writeJson(cwd, ".artifacts/release-cut/v0.8.0-evidence-refresh.json", refresh());
    writeJson(cwd, ".artifacts/release-cut/v0.8.0-final-gate.json", finalGate({ target: "1.2.3", tag: "v1.2.3" }));

    const result = buildReleaseEvidenceStatus({ cwd, target: "0.8.0", head: "abc1234" });

    assert.equal(result.decision, "block");
    assert.ok(result.blockers.includes("release-final-gate-target-mismatch"));
    assert.ok(result.blockers.includes("release-final-gate-tag-mismatch"));
    assert.equal(result.protectedActionsAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release evidence status blocks nested final gate artifact target or tag mismatch", () => {
  const cwd = workspace();
  try {
    writeJson(cwd, ".artifacts/release-cut/v0.8.0-evidence-refresh.json", refresh());
    writeJson(cwd, ".artifacts/release-cut/v0.8.0-final-gate.json", finalGate({
      cutPreview: { target: "1.2.3", tag: "v0.8.0" },
      artifactAudit: { target: "0.8.0", tag: "v1.2.3" },
    }));

    const result = buildReleaseEvidenceStatus({ cwd, target: "0.8.0", head: "abc1234" });

    assert.equal(result.decision, "block");
    assert.ok(result.blockers.includes("release-final-gate-cut-preview-target-mismatch"));
    assert.ok(result.blockers.includes("release-final-gate-artifact-audit-tag-mismatch"));
    assert.equal(result.tagAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release evidence status derives protected prompts from arbitrary release tags", () => {
  const cwd = workspace();
  try {
    writeJson(cwd, ".artifacts/release-cut/v1.2.3-evidence-refresh.json", refresh({
      target: "1.2.3",
      tag: "v1.2.3",
      paths: {
        finalGatePath: ".artifacts/release-cut/v1.2.3-final-gate.json",
      },
      requiredApprovalPrompts: [
        "approve release tag create v1.2.3",
        "approve release tag push v1.2.3",
        "approve release draft prepare-draft-release v1.2.3",
        "approve release publish v1.2.3",
      ],
    }));
    writeJson(cwd, ".artifacts/release-cut/v1.2.3-final-gate.json", finalGate({
      target: "1.2.3",
      tag: "v1.2.3",
      cutPreview: {
        target: "1.2.3",
        tag: "v1.2.3",
      },
      artifactAudit: {
        target: "1.2.3",
        tag: "v1.2.3",
      },
      requiredApprovalPrompts: [
        "approve release tag create v1.2.3",
        "approve release tag push v1.2.3",
        "approve release draft prepare-draft-release v1.2.3",
        "approve release publish v1.2.3",
      ],
    }));

    const result = buildReleaseEvidenceStatus({ cwd, target: "1.2.3", head: "abc1234" });

    assert.equal(result.decision, "pass");
    assert.equal(result.tag, "v1.2.3");
    assert.equal(result.evidencePath, ".artifacts/release-cut/v1.2.3-evidence-refresh.json");
    assert.equal(result.finalGatePath, ".artifacts/release-cut/v1.2.3-final-gate.json");
    assert.deepEqual(result.blockers, []);
    assert.deepEqual(result.requiredApprovalPrompts, [
      "approve release tag create v1.2.3",
      "approve release tag push v1.2.3",
      "approve release draft prepare-draft-release v1.2.3",
      "approve release publish v1.2.3",
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
