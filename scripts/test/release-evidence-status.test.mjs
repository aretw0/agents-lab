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
    readinessDecision: "ready",
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
