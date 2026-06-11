import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildReleaseDraftPreview } from "../release-draft-preview.mjs";

function workspace() {
  const cwd = mkdtempSync(path.join(tmpdir(), "release-draft-preview-"));
  assert.equal(spawnSync("git", ["init"], { cwd, encoding: "utf8" }).status, 0);
  writeFileSync(path.join(cwd, "README.md"), "# test\n");
  assert.equal(spawnSync("git", ["add", "."], { cwd, encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", [
    "-c",
    "user.name=Release Draft Test",
    "-c",
    "user.email=release-draft@example.test",
    "commit",
    "-m",
    "initial release",
  ], { cwd, encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", ["tag", "v0.7.0"], { cwd, encoding: "utf8" }).status, 0);
  writeFileSync(path.join(cwd, "CHANGE.md"), "change\n");
  assert.equal(spawnSync("git", ["add", "."], { cwd, encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", [
    "-c",
    "user.name=Release Draft Test",
    "-c",
    "user.email=release-draft@example.test",
    "commit",
    "-m",
    "feat: add change",
  ], { cwd, encoding: "utf8" }).status, 0);
  return cwd;
}

const readyReadiness = {
  ready: true,
  decision: "ready",
  gates: {
    agentRunDrivers: true,
    packageSmoke: true,
    userSurface: true,
    worktreeClean: true,
  },
};

test("release draft preview writes local notes when readiness is green", () => {
  const cwd = workspace();
  try {
    const result = buildReleaseDraftPreview({ cwd, target: "0.8.0", readiness: readyReadiness });
    const notesPath = path.join(cwd, result.notesOutPath);
    const notes = readFileSync(notesPath, "utf8");

    assert.equal(result.mode, "release-draft-preview");
    assert.equal(result.decision, "ready-for-operator-review");
    assert.equal(result.previousTag, "v0.7.0");
    assert.equal(result.notesWritten, true);
    assert.equal(result.tagAllowed, false);
    assert.equal(result.publishAllowed, false);
    assert.equal(result.workflowDispatchAllowed, false);
    assert.equal(result.processStartAllowed, false);
    assert.match(notes, /^# Release draft v0\.8\.0/m);
    assert.match(notes, /previousTag: v0\.7\.0/);
    assert.match(notes, /feat: add change/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release draft preview blocks when readiness is not green", () => {
  const cwd = workspace();
  try {
    const result = buildReleaseDraftPreview({
      cwd,
      target: "0.8.0",
      readiness: { ready: false, decision: "not-ready", gates: {} },
    });

    assert.equal(result.decision, "blocked");
    assert.ok(result.blockers.includes("release-readiness-not-ready"));
    assert.equal(result.notesWritten, false);
    assert.equal(existsSync(path.join(cwd, result.notesOutPath)), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release draft preview blocks tag target mismatch", () => {
  const cwd = workspace();
  try {
    const result = buildReleaseDraftPreview({
      cwd,
      target: "0.8.0",
      tag: "v0.9.0",
      readiness: readyReadiness,
    });

    assert.equal(result.decision, "blocked");
    assert.ok(result.blockers.includes("tag-target-mismatch"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
