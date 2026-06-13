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

test("board next scope intake skips proposals already materialized in the board", () => withBoard([
  {
    id: "TASK-DONE",
    status: "completed",
    priority: "p1",
    description: "Done",
    milestone: "0.8-board",
  },
  {
    id: "TASK-MATERIALIZED",
    status: "completed",
    priority: "p1",
    description: "Implemented worker queue",
    milestone: "0.8-worker-orchestration",
    notes: "Materialized from TASK-BUD-DRAFT-CORE-WORKER-QUEUE.",
  },
], (cwd) => {
  const report = buildBoardNextScopeIntake({ cwd });

  assert.equal(report.decision, "ready-for-operator-decision");
  assert.deepEqual(report.proposedBoardTasks.map((task) => task.id), [
    "TASK-BUD-DRAFT-BOARD-FANOUT-ASSIMILATION",
    "TASK-BUD-DRAFT-OPERATIONAL-MEMORY-GATE",
  ]);
  assert.equal(report.dispatchAllowed, false);
  assert.equal(report.processStartAllowed, false);
}));

test("board next scope intake reports exhausted scope when every known proposal is materialized", () => withBoard([
  {
    id: "TASK-DONE",
    status: "completed",
    priority: "p1",
    description: "Done",
    milestone: "0.8-board",
  },
  {
    id: "TASK-QUEUE",
    status: "completed",
    priority: "p1",
    description: "Implemented worker queue",
    milestone: "0.8-worker-orchestration",
    notes: "Materialized from TASK-BUD-DRAFT-CORE-WORKER-QUEUE.",
  },
  {
    id: "TASK-FANOUT",
    status: "completed",
    priority: "p1",
    description: "Implemented board fanout",
    milestone: "0.8-potential-completeness",
    notes: "Materialized from TASK-BUD-DRAFT-BOARD-FANOUT-ASSIMILATION.",
  },
  {
    id: "TASK-MEMORY",
    status: "completed",
    priority: "p2",
    description: "Implemented operational memory gate",
    milestone: "0.8-operational-memory",
    notes: "Materialized from TASK-BUD-DRAFT-OPERATIONAL-MEMORY-GATE.",
  },
], (cwd) => {
  const report = buildBoardNextScopeIntake({ cwd });

  assert.equal(report.decision, "scope-exhausted");
  assert.equal(report.recommendationCode, "board-next-scope-intake-scope-exhausted");
  assert.deepEqual(report.proposedBoardTasks, []);
  assert.equal(report.materializedProposalCount, 3);
  assert.equal(report.dispatchAllowed, false);
  assert.equal(report.processStartAllowed, false);
  assert.equal(report.workflowDispatchAllowed, false);
  assert.equal(report.automationAllowed, false);
  assert.equal(report.nextScopeCandidates.length, 2);
  assert.deepEqual(report.nextScopeCandidates.map((candidate) => candidate.candidateId), [
    "local-safe-external-influence-assimilation",
    "local-safe-worker-volume-canary",
  ]);
  for (const candidate of report.nextScopeCandidates) {
    assert.ok(candidate.files.length > 0);
    assert.ok(candidate.acceptanceCriteria.length > 0);
    assert.ok(candidate.validationCommands.length > 0);
    assert.ok(candidate.blockers.includes("operator-review-required-before-board-edit"));
    assert.deepEqual(candidate.filesTouched, []);
    assert.equal(candidate.dispatchAllowed, false);
    assert.equal(candidate.processStartAllowed, false);
    assert.equal(candidate.workflowDispatchAllowed, false);
    assert.equal(candidate.tagAllowed, false);
    assert.equal(candidate.publishAllowed, false);
  }
  assert.ok(report.nextActions.some((action) => action.includes("define a new local-safe scope")));
}));

test("board next scope intake suppresses exhausted-scope candidates already materialized", () => withBoard([
  {
    id: "TASK-DONE",
    status: "completed",
    priority: "p1",
    description: "Done",
    milestone: "0.8-board",
  },
  {
    id: "TASK-QUEUE",
    status: "completed",
    priority: "p1",
    description: "Implemented worker queue",
    milestone: "0.8-worker-orchestration",
    notes: "Materialized from TASK-BUD-DRAFT-CORE-WORKER-QUEUE.",
  },
  {
    id: "TASK-FANOUT",
    status: "completed",
    priority: "p1",
    description: "Implemented board fanout",
    milestone: "0.8-potential-completeness",
    notes: "Materialized from TASK-BUD-DRAFT-BOARD-FANOUT-ASSIMILATION.",
  },
  {
    id: "TASK-MEMORY",
    status: "completed",
    priority: "p2",
    description: "Implemented operational memory gate",
    milestone: "0.8-operational-memory",
    notes: "Materialized from TASK-BUD-DRAFT-OPERATIONAL-MEMORY-GATE.",
  },
  {
    id: "TASK-INFLUENCE",
    status: "completed",
    priority: "p2",
    description: "Assimilated external influence",
    milestone: "0.8-worker-orchestration",
    notes: "source_candidate=local-safe-external-influence-assimilation",
  },
  {
    id: "TASK-VOLUME",
    status: "completed",
    priority: "p1",
    description: "Implemented worker volume canary",
    milestone: "0.8-worker-orchestration",
    notes: "source_candidate=local-safe-worker-volume-canary",
  },
], (cwd) => {
  const report = buildBoardNextScopeIntake({ cwd });

  assert.equal(report.decision, "scope-exhausted");
  assert.deepEqual(report.proposedBoardTasks, []);
  assert.deepEqual(report.nextScopeCandidates, []);
  assert.equal(report.dispatchAllowed, false);
  assert.equal(report.processStartAllowed, false);
}));

test("board next scope intake proposes target-agnostic reference curation when local map exists", () => withBoard([
  {
    id: "TASK-DONE",
    status: "completed",
    priority: "p1",
    description: "Done",
    milestone: "target-current",
  },
  {
    id: "TASK-QUEUE",
    status: "completed",
    priority: "p1",
    description: "Implemented worker queue",
    milestone: "target-current",
    notes: "Materialized from TASK-BUD-DRAFT-CORE-WORKER-QUEUE.",
  },
  {
    id: "TASK-FANOUT",
    status: "completed",
    priority: "p1",
    description: "Implemented board fanout",
    milestone: "target-current",
    notes: "Materialized from TASK-BUD-DRAFT-BOARD-FANOUT-ASSIMILATION.",
  },
  {
    id: "TASK-MEMORY",
    status: "completed",
    priority: "p2",
    description: "Implemented operational memory gate",
    milestone: "target-current",
    notes: "Materialized from TASK-BUD-DRAFT-OPERATIONAL-MEMORY-GATE.",
  },
  {
    id: "TASK-INFLUENCE",
    status: "completed",
    priority: "p2",
    description: "Assimilated external influence",
    milestone: "target-current",
    notes: "source_candidate=local-safe-external-influence-assimilation",
  },
  {
    id: "TASK-VOLUME",
    status: "completed",
    priority: "p1",
    description: "Implemented worker volume canary",
    milestone: "target-current",
    notes: "source_candidate=local-safe-worker-volume-canary",
  },
], (cwd) => {
  mkdirSync(path.join(cwd, "docs", "research"), { recursive: true });
  writeFileSync(
    path.join(cwd, "docs", "research", "world-class-agentic-engineering-reference-map-2026-06.md"),
    "# World-class agentic engineering reference map\n\n## Invariante target-agnostic\n",
    "utf8",
  );

  const report = buildBoardNextScopeIntake({ cwd });

  assert.equal(report.decision, "scope-exhausted");
  assert.deepEqual(report.proposedBoardTasks, []);
  assert.deepEqual(report.nextScopeCandidates.map((candidate) => candidate.candidateId), [
    "local-safe-target-agnostic-reference-curation",
  ]);
  const [candidate] = report.nextScopeCandidates;
  assert.equal(candidate.category, "local-safe");
  assert.ok(candidate.files.includes("docs/research/world-class-agentic-engineering-reference-map-2026-06.md"));
  assert.ok(candidate.acceptanceCriteria.some((criterion) => criterion.includes("target-agnostic")));
  assert.ok(candidate.validationCommands.includes("node --test scripts/test/board-next-scope-intake.test.mjs"));
  assert.deepEqual(candidate.filesTouched, []);
  assert.equal(candidate.dispatchAllowed, false);
  assert.equal(candidate.processStartAllowed, false);
  assert.equal(candidate.workflowDispatchAllowed, false);
  assert.equal(candidate.tagAllowed, false);
  assert.equal(candidate.publishAllowed, false);
}));
