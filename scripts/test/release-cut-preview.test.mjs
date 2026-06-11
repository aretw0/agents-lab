import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildReleaseCutPreview } from "../release-cut-preview.mjs";

function workspace() {
  const cwd = mkdtempSync(path.join(tmpdir(), "release-cut-preview-"));
  assert.equal(spawnSync("git", ["init"], { cwd, encoding: "utf8" }).status, 0);
  writeFileSync(path.join(cwd, "README.md"), "# test\n");
  assert.equal(spawnSync("git", ["add", "."], { cwd, encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", [
    "-c",
    "user.name=Release Cut Test",
    "-c",
    "user.email=release-cut@example.test",
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
    gates: {
      agentRunDrivers: true,
      packageSmoke: true,
      userSurface: true,
      worktreeClean: true,
    },
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
      tag: "v0.8.0",
      targetSha: gitHead,
      notesOutPath: ".artifacts/release-draft/v0.8.0-notes.md",
      notesWritten: true,
      changeCount: 3,
      reviewChecklist: [
        { id: "readiness-green", ok: true },
        { id: "notes-written", ok: true },
        { id: "changes-present", ok: true },
        { id: "operator-review-required", ok: true },
      ],
      tagAllowed: false,
      publishAllowed: false,
      workflowDispatchAllowed: false,
      processStartAllowed: false,
      blockers: [],
    },
  };
}

function readyArtifactAudit(gitHead) {
  return {
    mode: "release-artifact-audit",
    decision: "pass",
    target: "0.8.0",
    tag: "v0.8.0",
    head: gitHead,
    blockers: [],
  };
}

test("release cut preview emits protected operator packet when readiness and draft match head", () => {
  const cwd = workspace();
  try {
    const gitHead = head(cwd);
    const result = buildReleaseCutPreview({
      cwd,
      target: "0.8.0",
      readiness: readyReadiness(gitHead),
      draft: readyDraft(gitHead),
    });

    assert.equal(result.mode, "release-cut-preview");
    assert.equal(result.decision, "ready-for-operator-review");
    assert.equal(result.tag, "v0.8.0");
    assert.equal(result.targetSha, gitHead);
    assert.equal(result.tagAllowed, false);
    assert.equal(result.publishAllowed, false);
    assert.equal(result.workflowDispatchAllowed, false);
    assert.equal(result.processStartAllowed, false);
    assert.equal(result.draftNotesReview.mode, "release-draft-notes-review-packet");
    assert.equal(result.draftNotesReview.changeCount, 3);
    assert.deepEqual(result.draftNotesReview.reviewChecklist.map((row) => [row.id, row.ok]), [
      ["readiness-green", true],
      ["notes-written", true],
      ["changes-present", true],
      ["operator-review-required", true],
    ]);
    assert.equal(result.commandPreviews.createLocalTag.command, "git");
    assert.deepEqual(result.commandPreviews.createLocalTag.args.slice(0, 3), ["tag", "-a", "v0.8.0"]);
    assert.equal(result.commandPreviews.prepareDraftRelease.command, "gh");
    assert.equal(result.releaseCutOperatorPacket.mode, "release-cut-operator-packet");
    assert.equal(result.releaseCutOperatorPacket.decision, "ready-for-operator-review");
    assert.equal(result.releaseCutOperatorPacket.readinessDecision, "ready");
    assert.equal(result.releaseCutOperatorPacket.draftDecision, "ready-for-operator-review");
    assert.equal(result.releaseCutOperatorPacket.draftNotesReviewDecision, "ready-for-operator-review");
    assert.deepEqual(result.releaseCutOperatorPacket.approvalRows.map((row) => row.action), [
      "create-local-tag",
      "push-tag",
      "prepare-draft-release",
      "publish-release",
    ]);
    assert.deepEqual(result.releaseCutOperatorPacket.requiredApprovalPrompts, [
      "approve release tag create v0.8.0",
      "approve release tag push v0.8.0",
      "approve release draft prepare-draft-release v0.8.0",
      "approve release publish v0.8.0",
    ]);
    assert.equal(result.releaseCutOperatorPacket.tagAllowed, false);
    assert.equal(result.releaseCutOperatorPacket.publishAllowed, false);
    assert.equal(result.releaseCutOperatorPacket.workflowDispatchAllowed, false);
    assert.equal(result.releaseCutOperatorPacket.processStartAllowed, false);
    assert.ok(result.requiredApprovalPrompts.includes("approve release tag create v0.8.0"));
    assert.deepEqual(result.blockers, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release cut preview blocks ready draft without notes review packet", () => {
  const cwd = workspace();
  try {
    const gitHead = head(cwd);
    const draft = readyDraft(gitHead);
    delete draft.releaseDraftNotesReviewPacket;
    const result = buildReleaseCutPreview({
      cwd,
      target: "0.8.0",
      readiness: readyReadiness(gitHead),
      draft,
    });

    assert.equal(result.decision, "blocked");
    assert.ok(result.blockers.includes("release-draft-notes-review-missing"));
    assert.ok(result.releaseCutOperatorPacket.blockers.includes("release-draft-notes-review-missing"));
    assert.equal(result.releaseCutOperatorPacket.tagAllowed, false);
    assert.equal(result.tagAllowed, false);
    assert.equal(result.workflowDispatchAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release cut preview blocks stale readiness and draft evidence", () => {
  const cwd = workspace();
  try {
    const result = buildReleaseCutPreview({
      cwd,
      target: "0.8.0",
      readiness: readyReadiness("oldsha"),
      draft: readyDraft("oldsha"),
    });

    assert.equal(result.decision, "blocked");
    assert.ok(result.blockers.includes("release-readiness-stale-head"));
    assert.ok(result.blockers.includes("release-draft-stale-head"));
    assert.equal(result.tagAllowed, false);
    assert.equal(result.workflowDispatchAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release cut preview blocks non-ready release readiness", () => {
  const cwd = workspace();
  try {
    const gitHead = head(cwd);
    const result = buildReleaseCutPreview({
      cwd,
      target: "0.8.0",
      readiness: { ...readyReadiness(gitHead), ready: false, decision: "not-ready" },
      draft: readyDraft(gitHead),
    });

    assert.equal(result.decision, "blocked");
    assert.ok(result.blockers.includes("release-readiness-not-ready"));
    assert.ok(result.blockers.includes("release-readiness-decision-not-ready"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release cut preview blocks tag mismatch", () => {
  const cwd = workspace();
  try {
    const gitHead = head(cwd);
    const result = buildReleaseCutPreview({
      cwd,
      target: "0.8.0",
      tag: "v0.9.0",
      readiness: readyReadiness(gitHead),
      draft: readyDraft(gitHead),
    });

    assert.equal(result.decision, "blocked");
    assert.ok(result.blockers.includes("tag-target-mismatch"));
    assert.ok(result.blockers.includes("draft-tag-mismatch"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release cut preview writes output artifact when requested", () => {
  const cwd = workspace();
  try {
    const gitHead = head(cwd);
    const outPath = ".artifacts/release-cut/preview.json";
    const result = buildReleaseCutPreview({
      cwd,
      target: "0.8.0",
      readiness: readyReadiness(gitHead),
      draft: readyDraft(gitHead),
    });
    mkdirSync(path.join(cwd, ".artifacts", "release-cut"), { recursive: true });
    writeFileSync(path.join(cwd, outPath), `${JSON.stringify(result, null, 2)}\n`);

    assert.equal(result.decision, "ready-for-operator-review");
    assert.equal(result.releaseReadinessPath, ".artifacts/release-readiness/latest-ready-final-0.8.0.json");
    assert.equal(result.draftPreviewPath, ".artifacts/release-draft/v0.8.0-preview.json");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release cut preview accepts a passing artifact audit when provided", () => {
  const cwd = workspace();
  try {
    const gitHead = head(cwd);
    const result = buildReleaseCutPreview({
      cwd,
      target: "0.8.0",
      auditPath: ".artifacts/release-cut/v0.8.0-artifact-audit.json",
      readiness: readyReadiness(gitHead),
      draft: readyDraft(gitHead),
      artifactAudit: readyArtifactAudit(gitHead),
    });

    assert.equal(result.decision, "ready-for-operator-review");
    assert.equal(result.releaseArtifactAuditPath, ".artifacts/release-cut/v0.8.0-artifact-audit.json");
    assert.equal(result.artifactAuditDecision, "pass");
    assert.deepEqual(result.blockers, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release cut preview blocks stale or failing artifact audit when provided", () => {
  const cwd = workspace();
  try {
    const gitHead = head(cwd);
    const audit = {
      ...readyArtifactAudit("oldsha"),
      decision: "block",
      blockers: ["release-cut-stale-head"],
    };
    const result = buildReleaseCutPreview({
      cwd,
      target: "0.8.0",
      auditPath: ".artifacts/release-cut/v0.8.0-artifact-audit.json",
      readiness: readyReadiness(gitHead),
      draft: readyDraft(gitHead),
      artifactAudit: audit,
    });

    assert.equal(result.decision, "blocked");
    assert.equal(result.artifactAuditDecision, "block");
    assert.ok(result.blockers.includes("release-artifact-audit-not-pass"));
    assert.ok(result.blockers.includes("release-artifact-audit-stale-head"));
    assert.ok(result.blockers.includes("release-artifact-audit-has-blockers"));
    assert.equal(result.releaseCutOperatorPacket.tagAllowed, false);
    assert.equal(result.workflowDispatchAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
