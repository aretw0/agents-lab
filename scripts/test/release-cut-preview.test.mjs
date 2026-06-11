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
    assert.equal(result.commandPreviews.createLocalTag.command, "git");
    assert.deepEqual(result.commandPreviews.createLocalTag.args.slice(0, 3), ["tag", "-a", "v0.8.0"]);
    assert.equal(result.commandPreviews.prepareDraftRelease.command, "gh");
    assert.ok(result.requiredApprovalPrompts.includes("approve release tag create v0.8.0"));
    assert.deepEqual(result.blockers, []);
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
