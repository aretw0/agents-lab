import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runReleaseEvidenceRefresh } from "../release-evidence-refresh.mjs";

function workspace() {
  const cwd = mkdtempSync(path.join(tmpdir(), "release-evidence-refresh-"));
  assert.equal(spawnSync("git", ["init"], { cwd, encoding: "utf8" }).status, 0);
  writeFileSync(path.join(cwd, "README.md"), "# test\n");
  writeFileSync(path.join(cwd, ".gitignore"), ".artifacts/\n");
  assert.equal(spawnSync("git", ["add", "."], { cwd, encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", [
    "-c",
    "user.name=Release Evidence Refresh Test",
    "-c",
    "user.email=release-evidence-refresh@example.test",
    "commit",
    "-m",
    "init",
  ], { cwd, encoding: "utf8" }).status, 0);
  return cwd;
}

function head(cwd) {
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" }).stdout.trim();
}

function canarySuite(decision = "pass") {
  return {
    mode: "agent-run-driver-canary-suite-report",
    decision,
    blockers: decision === "pass" ? [] : ["read-only-canary-not-pass"],
  };
}

function readiness(gitHead, ready = true) {
  return {
    mode: "release-readiness-report",
    ready,
    decision: ready ? "ready" : "not-ready",
    head: gitHead,
    blockers: [],
  };
}

test("release evidence refresh writes canary, readiness, draft, and final gate artifacts", async () => {
  const cwd = workspace();
  try {
    const gitHead = head(cwd);
    const result = await runReleaseEvidenceRefresh({
      cwd,
      target: "0.8.0",
      canarySuite: canarySuite(),
      readiness: readiness(gitHead),
      outPath: ".artifacts/release-cut/refresh.json",
    });

    assert.equal(result.mode, "release-evidence-refresh");
    assert.equal(result.decision, "pass");
    assert.equal(result.canarySuiteDecision, "pass");
    assert.equal(result.readinessDecision, "ready");
    assert.equal(result.draftDecision, "ready-for-operator-review");
    assert.equal(result.finalGateDecision, "pass");
    assert.equal(result.protectedActionsAllowed, false);
    assert.equal(result.tagAllowed, false);
    assert.equal(result.workflowDispatchAllowed, false);
    assert.deepEqual(result.blockers, []);
    assert.equal(existsSync(path.join(cwd, result.paths.canarySuitePath)), true);
    assert.equal(existsSync(path.join(cwd, result.paths.readinessPath)), true);
    assert.equal(existsSync(path.join(cwd, result.paths.draftPath)), true);
    assert.equal(existsSync(path.join(cwd, result.paths.cutPreviewPath)), true);
    assert.equal(existsSync(path.join(cwd, result.paths.artifactAuditPath)), true);
    assert.equal(existsSync(path.join(cwd, result.paths.finalGatePath)), true);
    assert.deepEqual(JSON.parse(readFileSync(path.join(cwd, ".artifacts/release-cut/refresh.json"), "utf8")), result);
    assert.equal(JSON.parse(readFileSync(path.join(cwd, result.paths.readinessPath), "utf8")).mode, "release-readiness-report");
    const finalGate = JSON.parse(readFileSync(path.join(cwd, result.paths.finalGatePath), "utf8"));
    assert.deepEqual(JSON.parse(readFileSync(path.join(cwd, result.paths.cutPreviewPath), "utf8")), finalGate.cutPreview);
    assert.deepEqual(JSON.parse(readFileSync(path.join(cwd, result.paths.artifactAuditPath), "utf8")), finalGate.artifactAudit);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release evidence refresh blocks when canary suite or readiness are not ready", async () => {
  const cwd = workspace();
  try {
    const gitHead = head(cwd);
    const result = await runReleaseEvidenceRefresh({
      cwd,
      target: "0.8.0",
      canarySuite: canarySuite("block"),
      readiness: readiness(gitHead, false),
    });

    assert.equal(result.decision, "block");
    assert.ok(result.blockers.includes("canary-suite-not-pass"));
    assert.ok(result.blockers.includes("release-readiness-not-ready"));
    assert.ok(result.blockers.includes("release-draft-not-ready-for-review"));
    assert.ok(result.blockers.includes("release-final-gate-not-pass"));
    assert.equal(result.publishAllowed, false);
    assert.equal(result.processStartAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release evidence refresh defaults output path from arbitrary target tag", async () => {
  const cwd = workspace();
  try {
    const gitHead = head(cwd);
    const result = await runReleaseEvidenceRefresh({
      cwd,
      target: "1.2.3",
      canarySuite: canarySuite(),
      readiness: readiness(gitHead),
    });

    assert.equal(result.target, "1.2.3");
    assert.equal(result.tag, "v1.2.3");
    assert.equal(result.decision, "pass");
    assert.equal(existsSync(path.join(cwd, ".artifacts/release-cut/v1.2.3-evidence-refresh.json")), true);
    assert.equal(existsSync(path.join(cwd, ".artifacts/release-cut/v0.8.0-evidence-refresh.json")), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
