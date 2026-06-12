import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildBoardNextScopeIntake } from "../project/board-next-scope-intake.mjs";

function withBoard(tasks, fn) {
  const cwd = mkdtempSync(path.join(tmpdir(), "board-next-scope-intake-"));
  try {
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), `${JSON.stringify({ tasks }, null, 2)}\n`, "utf8");
    return fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("board next scope intake proposes report-only task when no local-safe work remains", () => withBoard([
  {
    id: "TASK-DONE",
    status: "completed",
    priority: "p1",
    description: "Done",
    milestone: "0.8-board",
  },
  {
    id: "TASK-PARKED",
    status: "planned",
    priority: "p3",
    description: "External influence parked https://example.test",
    milestone: "parked-for-0.8.0",
    files: ["docs/research/"],
    acceptance_criteria: ["Keep parked"],
  },
], (cwd) => {
  const report = buildBoardNextScopeIntake({ cwd });

  assert.equal(report.mode, "board-next-scope-intake");
  assert.equal(report.decision, "ready-for-operator-decision");
  assert.equal(report.recommendationCode, "board-next-scope-intake-ready");
  assert.equal(report.dispatchAllowed, false);
  assert.equal(report.processStartAllowed, false);
  assert.equal(report.workflowDispatchAllowed, false);
  assert.equal(report.tagAllowed, false);
  assert.equal(report.publishAllowed, false);
  assert.ok(report.proposedBoardTasks.length >= 2);
  assert.ok(report.proposedBoardTasks.length <= 3);
  assert.deepEqual(report.proposedBoardTasks.map((task) => task.id), [
    "TASK-BUD-DRAFT-CORE-WORKER-QUEUE",
    "TASK-BUD-DRAFT-BOARD-FANOUT-ASSIMILATION",
    "TASK-BUD-DRAFT-OPERATIONAL-MEMORY-GATE",
  ]);
  for (const task of report.proposedBoardTasks) {
    assert.ok(Array.isArray(task.corePrimitives));
    assert.ok(task.corePrimitives.length > 0);
    assert.ok(Array.isArray(task.adapterExtensions));
    assert.ok(task.adapterExtensions.length > 0);
    assert.ok(Array.isArray(task.validationFocus));
    assert.ok(task.validationFocus.length > 0);
    assert.ok(task.acceptance_criteria.some((criterion) => criterion.includes("release tag")));
  }
  assert.deepEqual(report.protectedTaskIds, ["TASK-PARKED"]);
  assert.match(report.summary, /dispatch=no/);
}));

test("board next scope intake defers when local-safe board work already exists", () => withBoard([
  {
    id: "TASK-LOCAL",
    status: "planned",
    priority: "p1",
    description: "Implement local helper",
    milestone: "0.8-board",
    files: ["scripts/local-helper.mjs"],
    acceptance_criteria: ["Helper exists"],
  },
], (cwd) => {
  const report = buildBoardNextScopeIntake({ cwd });

  assert.equal(report.decision, "defer-to-existing-board-work");
  assert.equal(report.recommendationCode, "board-next-scope-intake-defer-existing-work");
  assert.deepEqual(report.proposedBoardTasks, []);
  assert.equal(report.dispatchAllowed, false);
  assert.equal(report.processStartAllowed, false);
}));
