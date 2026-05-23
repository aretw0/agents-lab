import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBoardSummary,
  buildGoalPrompt,
  collectEligibleTaskEntries,
  extractPriority,
  normalizeTaskPriority,
  selectNextTask,
  taskTouchesProtectedScope,
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

test("scheduler skips planned p3 work unless explicitly filtered", () => {
  const tasks = [
    { id: "TASK-P3", status: "planned", priority: "p3", description: "low priority planned work" },
    { id: "TASK-P2", status: "planned", priority: "p2", description: "local work" },
  ];

  assert.equal(selectNextTask(tasks, null)?.id, "TASK-P2");
  assert.equal(selectNextTask([tasks[0]], null), null);
  assert.equal(selectNextTask([tasks[0]], "p3")?.id, "TASK-P3");
});

test("scheduler uses task id as deterministic tie-breaker", () => {
  const tasks = [
    { id: "TASK-B", status: "planned", priority: "p2", description: "second" },
    { id: "TASK-A", status: "planned", priority: "p2", description: "first" },
  ];

  assert.equal(selectNextTask(tasks, null)?.id, "TASK-A");
});

test("scheduler skips protected external/parked work unless explicitly included", () => {
  const tasks = [
    { id: "TASK-URL", status: "planned", priority: "p2", description: "pesquisa externa https://example.com" },
    { id: "TASK-PARKED", status: "planned", priority: "p2", milestone: "protected-parked-legacy", description: "parked" },
    { id: "TASK-LOCAL", status: "planned", priority: "p2", description: "local work" },
  ];

  assert.equal(taskTouchesProtectedScope(tasks[0]), true);
  assert.equal(taskTouchesProtectedScope(tasks[1]), true);
  assert.equal(taskTouchesProtectedScope(tasks[2]), false);
  assert.equal(selectNextTask(tasks, null)?.id, "TASK-LOCAL");
  assert.deepEqual(collectEligibleTaskEntries(tasks.slice(0, 2), { includeProtectedScopes: false }), []);
  assert.equal(selectNextTask(tasks.slice(0, 2), null, { includeProtectedScopes: true })?.id, "TASK-PARKED");
});

test("current parked external backlog is not eligible by default", () => {
  const tasks = [
    { id: "TASK-BUD-480", status: "planned", priority: "p3", milestone: "protected-parked-legacy", description: "Pesquisa futura (externa) de influências: analisar https://github.com/nousresearch/hermes-agent" },
    { id: "TASK-BUD-521", status: "planned", priority: "p3", milestone: "protected-parked-legacy", description: "Influência externa parked" },
  ];

  assert.equal(selectNextTask(tasks, null), null);
  assert.equal(selectNextTask(tasks, "p3"), null);
  assert.equal(selectNextTask(tasks, "p3", { includeProtectedScopes: true })?.id, "TASK-BUD-480");
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
