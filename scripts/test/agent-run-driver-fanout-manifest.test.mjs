import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function writeBoard(cwd, tasks) {
  mkdirSync(path.join(cwd, ".project"), { recursive: true });
  writeFileSync(path.join(cwd, ".project", "tasks.json"), `${JSON.stringify({ tasks }, null, 2)}\n`, "utf8");
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

test("fanout manifest can derive local-safe workers from the board", () => {
  const cwd = workspace("agent-run-driver-fanout-manifest-board-");
  try {
    writeBoard(cwd, [
      {
        id: "TASK-LOCAL-1",
        status: "planned",
        priority: "p1",
        description: "Local safe task",
        files: ["scripts/example-one.mjs"],
      },
      {
        id: "TASK-PROTECTED",
        status: "planned",
        priority: "p1",
        description: "Publish workflow task",
        files: [".github/workflows/publish.yml"],
      },
      {
        id: "TASK-LOCAL-2",
        status: "in_progress",
        priority: "p1",
        description: "Second local task",
        files: ["docs/example.md"],
      },
    ]);

    const report = buildAgentRunDriverFanoutManifest({
      cwd,
      fromBoard: true,
      priority: "p1",
      limit: 2,
      batchId: "board-fanout",
    });

    assert.equal(report.decision, "ready-for-operator-decision");
    assert.equal(report.source, "board");
    assert.equal(report.workerCount, 2);
    assert.equal(report.boardSelection.scannedTaskCount, 3);
    assert.equal(report.boardSelection.eligibleCount, 2);
    assert.deepEqual(report.boardSelection.selectedTaskIds, ["TASK-LOCAL-1", "TASK-LOCAL-2"]);
    assert.equal(report.boardSelection.skippedProtected, 1);
    assert.equal(report.boardSelection.skippedByReason["protected-scope"], 1);
    assert.deepEqual(report.workerSpecs.map((worker) => worker.workerId), ["task-local-1", "task-local-2"]);
    assert.deepEqual(report.workerSpecs.map((worker) => worker.runSpec.declared_files), [["scripts/example-one.mjs"], ["docs/example.md"]]);
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.deepEqual(report.blockers, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout manifest blocks board mode with no local-safe workers", () => {
  const cwd = workspace("agent-run-driver-fanout-manifest-board-empty-");
  try {
    writeBoard(cwd, [
      {
        id: "TASK-PROTECTED",
        status: "planned",
        priority: "p1",
        description: "External research https://example.test",
        files: ["docs/research/"],
      },
    ]);

    const report = buildAgentRunDriverFanoutManifest({ cwd, fromBoard: true, priority: "p1" });

    assert.equal(report.decision, "blocked");
    assert.ok(report.blockers.includes("board-workers-missing"));
    assert.equal(report.boardSelection.scannedTaskCount, 1);
    assert.equal(report.boardSelection.eligibleCount, 0);
    assert.equal(report.boardSelection.skippedProtected, 1);
    assert.equal(report.boardSelection.skippedByReason["protected-scope"], 1);
    assert.deepEqual(report.boardSelection.skippedSamples.map((item) => item.taskId), ["TASK-PROTECTED"]);
    assert.equal(report.workerCount, 0);
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fanout manifest explains board skip reasons", () => {
  const cwd = workspace("agent-run-driver-fanout-manifest-board-skips-");
  try {
    writeBoard(cwd, [
      {
        id: "TASK-DONE",
        status: "done",
        priority: "p1",
        files: ["docs/done.md"],
      },
      {
        id: "TASK-P2",
        status: "planned",
        priority: "p2",
        files: ["docs/p2.md"],
      },
      {
        id: "TASK-NO-FILES",
        status: "planned",
        priority: "p1",
        files: [],
      },
      {
        id: "TASK-FILE-PROTECTED",
        status: "planned",
        priority: "p1",
        files: [".github/workflows/release.yml"],
      },
    ]);

    const report = buildAgentRunDriverFanoutManifest({ cwd, fromBoard: true, priority: "p1" });

    assert.equal(report.decision, "blocked");
    assert.ok(report.blockers.includes("board-workers-missing"));
    assert.equal(report.boardSelection.skippedByReason["status-not-eligible:done"], 1);
    assert.equal(report.boardSelection.skippedByReason["priority-mismatch:p2"], 1);
    assert.equal(report.boardSelection.skippedByReason["files-missing"], 1);
    assert.equal(report.boardSelection.skippedByReason["files-protected"], 1);
    assert.equal(report.boardSelection.skippedSamples.length, 4);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
