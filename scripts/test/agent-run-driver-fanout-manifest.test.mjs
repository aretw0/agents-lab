import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildAgentRunDriverFanoutManifest,
  writeAgentRunDriverFanoutManifest,
} from "../agent-run-driver-fanout-manifest.mjs";
import { runAgentRunDriverFanoutRehearsal } from "../agent-run-driver-fanout-rehearsal.mjs";

function workspace(prefix) {
  const cwd = mkdtempSync(path.join(tmpdir(), prefix));
  writeFileSync(path.join(cwd, "package.json"), "{}\n", "utf8");
  return cwd;
}

test("fanout manifest builds report-only default worker specs", () => {
  const cwd = workspace("agent-run-driver-fanout-manifest-default-");
  try {
    const report = buildAgentRunDriverFanoutManifest({ cwd });

    assert.equal(report.mode, "agent-run-driver-fanout-manifest");
    assert.equal(report.decision, "ready-for-operator-decision");
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.equal(report.batchExecutionAllowed, false);
    assert.equal(report.workerCount, 2);
    assert.deepEqual(report.workerSpecs.map((worker) => worker.workerId), ["worker-a", "worker-b"]);
    assert.deepEqual(report.workerSpecs.map((worker) => worker.runSpec.file_contract), ["read-only", "read-only"]);
    assert.deepEqual(report.blockers, []);
    assert.equal(report.rehearsalPreview.dispatchAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout manifest writes artifact consumable by fanout rehearsal", async () => {
  const cwd = workspace("agent-run-driver-fanout-manifest-write-");
  try {
    const outPath = ".artifacts/agent-run-driver/fanout-manifest.json";
    const report = writeAgentRunDriverFanoutManifest({
      cwd,
      outPath,
      workerIds: ["one", "two", "three"],
      files: ["package.json"],
    });

    assert.equal(existsSync(path.join(cwd, outPath)), true);
    assert.deepEqual(JSON.parse(readFileSync(path.join(cwd, outPath), "utf8")), report);

    const rehearsal = await runAgentRunDriverFanoutRehearsal({
      cwd,
      manifestPath: outPath,
      maxConcurrency: 1,
    });
    assert.equal(rehearsal.decision, "pass");
    assert.equal(rehearsal.manifestSource, "custom");
    assert.equal(rehearsal.workerCount, 3);
    assert.equal(rehearsal.passedWorkerCount, 3);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout manifest blocks direct execute requests", () => {
  const cwd = workspace("agent-run-driver-fanout-manifest-execute-");
  try {
    const report = buildAgentRunDriverFanoutManifest({ cwd, execute: true });

    assert.equal(report.decision, "blocked");
    assert.ok(report.blockers.includes("execute-not-supported-by-fanout-manifest"));
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout manifest blocks duplicate worker ids", () => {
  const cwd = workspace("agent-run-driver-fanout-manifest-duplicate-");
  try {
    const report = buildAgentRunDriverFanoutManifest({ cwd, workerIds: ["one", "one"] });

    assert.equal(report.decision, "blocked");
    assert.ok(report.blockers.includes("duplicate-worker-id:one"));
    assert.ok(report.blockers.includes("duplicate-run-id:agent-run-driver-local-fanout-rehearsal-one"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
