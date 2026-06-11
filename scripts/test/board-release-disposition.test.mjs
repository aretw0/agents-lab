import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildBoardReleaseDisposition } from "../board-release-disposition.mjs";

function workspace() {
  const cwd = mkdtempSync(path.join(tmpdir(), "board-release-disposition-"));
  const tasksPath = path.join(cwd, ".project", "tasks.json");
  mkdirSync(path.dirname(tasksPath), { recursive: true });
  writeFileSync(tasksPath, JSON.stringify({
    tasks: [{
      id: "TASK-BUD-521",
      description: "Influência externa parked",
      status: "in_progress",
      priority: "p3",
      milestone: "colony-experiment-phase1",
      notes: "existing note",
    }],
  }, null, 2));
  const evidencePath = path.join(cwd, "docs", "research", "task-bud-521-local-isolation-canary-2026-06.md");
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, "# evidence\n");
  return cwd;
}

test("board release disposition previews evidence-backed parking without editing tasks", () => {
  const cwd = workspace();
  try {
    const before = readFileSync(path.join(cwd, ".project", "tasks.json"), "utf8");
    const result = buildBoardReleaseDisposition({
      cwd,
      target: "0.8.0",
      action: "park-for-target-release",
    });
    const after = readFileSync(path.join(cwd, ".project", "tasks.json"), "utf8");

    assert.equal(result.mode, "board-release-disposition");
    assert.equal(result.decision, "ready-for-operator-decision");
    assert.equal(result.dispatchAllowed, false);
    assert.equal(result.processStartAllowed, false);
    assert.deepEqual(result.taskIds, ["TASK-BUD-521"]);
    assert.equal(result.requiredApprovalPrompt, "approve board release disposition park-for-target-release TASK-BUD-521");
    assert.deepEqual(result.blockers, []);
    assert.equal(after, before);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("board release disposition blocks execute without approval", () => {
  const cwd = workspace();
  try {
    const result = buildBoardReleaseDisposition({
      cwd,
      target: "0.8.0",
      action: "park-for-target-release",
      execute: true,
    });

    assert.equal(result.decision, "blocked");
    assert.ok(result.blockers.includes("structured-operator-approval-missing"));
    assert.deepEqual(result.changedTaskIds, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("board release disposition applies approved parking to selected tasks", () => {
  const cwd = workspace();
  try {
    const result = buildBoardReleaseDisposition({
      cwd,
      target: "0.8.0",
      action: "park-for-target-release",
      taskIds: ["TASK-BUD-521"],
      execute: true,
      approve: true,
    });
    const tasks = JSON.parse(readFileSync(path.join(cwd, ".project", "tasks.json"), "utf8")).tasks;

    assert.equal(result.decision, "applied");
    assert.deepEqual(result.changedTaskIds, ["TASK-BUD-521"]);
    assert.equal(tasks[0].status, "planned");
    assert.equal(tasks[0].milestone, "parked-for-0.8.0");
    assert.match(tasks[0].notes, /board release disposition = park-for-target-release for 0\.8\.0/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("board release disposition blocks parking when evidence is missing", () => {
  const cwd = workspace();
  try {
    rmSync(path.join(cwd, "docs"), { recursive: true, force: true });
    const result = buildBoardReleaseDisposition({
      cwd,
      target: "0.8.0",
      action: "park-for-target-release",
      taskIds: ["TASK-BUD-521"],
    });

    assert.equal(result.decision, "blocked");
    assert.ok(result.blockers.includes("evidence-missing:TASK-BUD-521"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
