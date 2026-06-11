import assert from "node:assert/strict";
import test from "node:test";

import { buildReleaseArtifactAudit } from "../release-artifact-audit.mjs";

function readiness(head = "abc1234") {
  return {
    mode: "release-readiness-report",
    ready: true,
    decision: "ready",
    head,
    blockers: [],
  };
}

function draft(head = "abc1234") {
  return {
    mode: "release-draft-preview",
    decision: "ready-for-operator-review",
    target: "0.8.0",
    tag: "v0.8.0",
    targetSha: head,
    notesWritten: true,
    releaseDraftNotesReviewPacket: {
      mode: "release-draft-notes-review-packet",
      decision: "ready-for-operator-review",
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

function cut(head = "abc1234") {
  return {
    mode: "release-cut-preview",
    decision: "ready-for-operator-review",
    target: "0.8.0",
    tag: "v0.8.0",
    targetSha: head,
    releaseCutOperatorPacket: {
      mode: "release-cut-operator-packet",
      decision: "ready-for-operator-review",
      requiredApprovalPrompts: [
        "approve release tag create v0.8.0",
        "approve release tag push v0.8.0",
        "approve release draft prepare-draft-release v0.8.0",
        "approve release publish v0.8.0",
      ],
      approvalRows: [
        { action: "create-local-tag", requiredApprovalPrompt: "approve release tag create v0.8.0" },
        { action: "push-tag", requiredApprovalPrompt: "approve release tag push v0.8.0" },
        { action: "prepare-draft-release", requiredApprovalPrompt: "approve release draft prepare-draft-release v0.8.0" },
        { action: "publish-release", requiredApprovalPrompt: "approve release publish v0.8.0" },
      ],
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

test("release artifact audit passes coherent readiness, draft, and cut artifacts", () => {
  const result = buildReleaseArtifactAudit({
    cwd: process.cwd(),
    target: "0.8.0",
    head: "abc1234",
    readiness: readiness(),
    draft: draft(),
    cut: cut(),
  });

  assert.equal(result.mode, "release-artifact-audit");
  assert.equal(result.decision, "pass");
  assert.equal(result.recommendation, "ready-for-protected-operator-review");
  assert.equal(result.protectedActionsAllowed, false);
  assert.equal(result.tagAllowed, false);
  assert.equal(result.publishAllowed, false);
  assert.equal(result.workflowDispatchAllowed, false);
  assert.equal(result.processStartAllowed, false);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.evidence.approvalPromptCount, 4);
});

test("release artifact audit blocks stale or divergent release artifacts", () => {
  const result = buildReleaseArtifactAudit({
    cwd: process.cwd(),
    target: "0.8.0",
    head: "abc1234",
    readiness: readiness("oldsha"),
    draft: draft("abc1234"),
    cut: cut("oldsha"),
  });

  assert.equal(result.decision, "block");
  assert.ok(result.blockers.includes("release-readiness-stale-head"));
  assert.ok(result.blockers.includes("release-cut-stale-head"));
  assert.ok(result.blockers.includes("release-draft-cut-sha-mismatch"));
});

test("release artifact audit blocks missing draft notes review packet", () => {
  const releaseDraft = draft();
  delete releaseDraft.releaseDraftNotesReviewPacket;

  const result = buildReleaseArtifactAudit({
    cwd: process.cwd(),
    target: "0.8.0",
    head: "abc1234",
    readiness: readiness(),
    draft: releaseDraft,
    cut: cut(),
  });

  assert.equal(result.decision, "block");
  assert.ok(result.blockers.includes("release-draft-notes-review-missing"));
});

test("release artifact audit blocks any protected action flag set true", () => {
  const releaseCut = cut();
  releaseCut.releaseCutOperatorPacket.workflowDispatchAllowed = true;

  const result = buildReleaseArtifactAudit({
    cwd: process.cwd(),
    target: "0.8.0",
    head: "abc1234",
    readiness: readiness(),
    draft: draft(),
    cut: releaseCut,
  });

  assert.equal(result.decision, "block");
  assert.ok(result.blockers.includes("release-cut-operator-workflowDispatchAllowed-not-false"));
  assert.equal(result.workflowDispatchAllowed, false);
});
