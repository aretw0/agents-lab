import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBoardSummary,
  buildGoalPrompt,
  extractPriority,
  normalizeTaskPriority,
  selectNextTask,
} from "../autonomous-scheduler.mjs";

test("scheduler uses explicit priority field before description markers", () => {
  const tasks = [
    { id: "TASK-CONFLICT", status: "planned", priority: "p3", description: "[P0] legacy marker" },
    { id: "TASK-P2", status: "planned", priority: "p2", description: "plain field priority" },
  ];

  assert.equal(normalizeTaskPriority(tasks[0]), "p3");
  assert.equal(selectNextTask(tasks, null)?.id, "TASK-P2");
  assert.equal(selectNextTask(tasks, "p3")?.id, "TASK-CONFLICT");
});

test("scheduler parses bracket priority variants as fallback", () => {
  assert.equal(extractPriority("[P2/UI] footer quota follow-up"), "p2");
  assert.equal(extractPriority("[P3] parked research"), "p3");
  assert.equal(extractPriority("no marker"), "unknown");
});

test("board summary excludes cancelled tasks from open priority counts", () => {
  const summary = buildBoardSummary([
    { id: "TASK-P3", status: "planned", priority: "p3", description: "external research" },
    { id: "TASK-CANCELLED", status: "cancelled", priority: "p2", description: "[P2/UI] cancelled" },
    { id: "TASK-DONE", status: "completed", priority: "p0", description: "done" },
  ]);

  assert.equal(summary.byStatus.planned, 1);
  assert.equal(summary.byStatus.cancelled, 1);
  assert.deepEqual(summary.openByPriority, { p0: 0, p1: 0, p2: 0, p3: 1, unknown: 0 });
});

test("goal prompt strips extended priority markers", () => {
  const prompt = buildGoalPrompt(
    { id: "TASK-UI", status: "planned", priority: "p2", description: "[P2/UI] Fix footer semantics" },
    2,
  );

  assert.match(prompt, /^Task: TASK-UI$/m);
  assert.match(prompt, /^Goal: Fix footer semantics$/m);
  assert.doesNotMatch(prompt, /\[P2\/UI\]/);
});
