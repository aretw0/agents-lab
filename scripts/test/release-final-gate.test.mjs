import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildReleaseFinalGate } from "../release-final-gate.mjs";

function workspace() {
  const cwd = mkdtempSync(path.join(tmpdir(), "release-final-gate-"));
  assert.equal(spawnSync("git", ["init"], { cwd, encoding: "utf8" }).status, 0);
  writeFileSync(path.join(cwd, "README.md"), "# test\n");
  assert.equal(spawnSync("git", ["add", "."], { cwd, encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", [
    "-c",
    "user.name=Release Final Gate Test",
    "-c",
    "user.email=release-final-gate@example.test",
    "commit",
    "-m",
    "init",
  ], { cwd, encoding: "utf8" }).status, 0);
  return cwd;
}

function head(cwd) {
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" }).stdout.trim();
}

function readyReadiness(gitHead) {
  return {
    mode: "release-readiness-report",
    ready: true,
    decision: "ready",
    head: gitHead,
    blockers: [],
  };
}

function readyDraft(gitHead) {
  return {
    mode: "release-draft-preview",
    decision: "ready-for-operator-review",
    target: "0.8.0",
    tag: "v0.8.0",
    previousTag: "v0.7.0",
    targetSha: gitHead,
    releaseDraftNotesReviewPacket: {
      mode: "release-draft-notes-review-packet",
      decision: "ready-for-operator-review",
      target: "0.8.0",
      tag: "v0.8.0",
      targetSha: gitHead,
      notesWritten: true,
      tagAllowed: false,
      publishAllowed: false,
      workflowDispatchAllowed: false,
      processStartAllowed: false,
      blockers: [],
    },
    tagAllowed: false,
    publishAllowed: false,
    workflowDispatchAllowed: false,
    processStartAllowed: false,
    blockers: [],
  };
}

test("release final gate passes coherent readiness and draft without protected actions", () => {
  const cwd = workspace();
  try {
    const gitHead = head(cwd);
    const result = buildReleaseFinalGate({
      cwd,
      target: "0.8.0",
      readiness: readyReadiness(gitHead),
      draft: readyDraft(gitHead),
    });

    assert.equal(result.mode, "release-final-gate");
    assert.equal(result.decision, "pass");
    assert.equal(result.cutBaseDecision, "ready-for-operator-review");
    assert.equal(result.artifactAuditDecision, "pass");
    assert.equal(result.cutPreviewDecision, "ready-for-operator-review");
    assert.equal(result.cutPreview.artifactAuditDecision, "pass");
    assert.equal(result.protectedActionsAllowed, false);
    assert.equal(result.tagAllowed, false);
    assert.equal(result.publishAllowed, false);
    assert.equal(result.workflowDispatchAllowed, false);
    assert.equal(result.processStartAllowed, false);
    assert.deepEqual(result.blockers, []);
    assert.deepEqual(result.requiredApprovalPrompts, [
      "approve release tag create v0.8.0",
      "approve release tag push v0.8.0",
      "approve release draft prepare-draft-release v0.8.0",
      "approve release publish v0.8.0",
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release final gate blocks when readiness evidence is not ready", () => {
  const cwd = workspace();
  try {
    const gitHead = head(cwd);
    const result = buildReleaseFinalGate({
      cwd,
      target: "0.8.0",
      readiness: { ...readyReadiness(gitHead), ready: false, decision: "not-ready" },
      draft: readyDraft(gitHead),
    });

    assert.equal(result.decision, "block");
    assert.ok(result.blockers.includes("cut-base:release-readiness-not-ready"));
    assert.ok(result.blockers.includes("artifact-audit:release-readiness-not-ready"));
    assert.ok(result.blockers.includes("cut-preview:release-readiness-not-ready"));
    assert.equal(result.tagAllowed, false);
    assert.equal(result.workflowDispatchAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
