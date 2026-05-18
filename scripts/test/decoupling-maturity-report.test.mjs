import test from "node:test";
import assert from "node:assert/strict";
import {
  nextActionForStage,
  hasVerificationEvidence,
  resolveAgentWorkerLane,
  resolveStage,
  statusById,
} from "../decoupling-maturity-report.mjs";

test("resolveStage preserves the original decoupling ladder", () => {
  assert.equal(resolveStage("planned", "planned", "planned"), "bootstrap");
  assert.equal(resolveStage("completed", "planned", "planned"), "stabilize");
  assert.equal(resolveStage("completed", "completed", "planned"), "delegate");
  assert.equal(resolveStage("completed", "completed", "completed"), "decouple");
  assert.equal(nextActionForStage("decouple").recommendationCode, "decoupling-stage-decouple-maintain");
});

test("statusById returns unknown when the board row is absent", () => {
  assert.equal(statusById([{ id: "TASK-A", status: "completed" }], "TASK-A"), "completed");
  assert.equal(statusById([{ id: "TASK-A", status: "completed" }], "TASK-B"), "unknown");
});

test("resolveAgentWorkerLane promotes only bounded single-worker evidence", () => {
  const lane = resolveAgentWorkerLane({
    docs: {
      singleWorkerMaturity: true,
      agentRunnerMaturity: true,
      agentFirstMode: true,
    },
    tasks: {
      "TASK-BUD-1066": "in-progress",
      "TASK-BUD-1068": "completed",
      "TASK-BUD-1075": "completed",
    },
  });

  assert.equal(lane.stage, "single-worker-operational");
  assert.equal(lane.recommendationCode, "agent-worker-lane-use-single-worker-hold-subprocess");
  assert.equal(lane.gates.subprocessBlocked, true);
});

test("resolveAgentWorkerLane flags pass evidence when board remains open", () => {
  const lane = resolveAgentWorkerLane({
    docs: {
      singleWorkerMaturity: true,
      agentRunnerMaturity: true,
      agentFirstMode: true,
    },
    tasks: {
      "TASK-BUD-1066": "completed",
      "TASK-BUD-1068": "completed",
      "TASK-BUD-1075": "in-progress",
    },
    verification: {
      task1075OneFileMutationPass: true,
      task1075RungCodified: true,
    },
  });

  assert.equal(lane.stage, "single-worker-evidence-ready-board-open");
  assert.equal(lane.recommendationCode, "agent-worker-lane-align-board-before-expansion");
  assert.equal(lane.gates.boardAligned, false);
  assert.equal(lane.gates.task1075PassEvidence, true);
});

test("resolveAgentWorkerLane fails closed without maturity docs or canary evidence", () => {
  const lane = resolveAgentWorkerLane({
    docs: {
      singleWorkerMaturity: true,
      agentRunnerMaturity: false,
    },
    tasks: {
      "TASK-BUD-1075": "planned",
    },
  });

  assert.equal(lane.stage, "needs-evidence");
  assert.equal(lane.recommendationCode, "agent-worker-lane-needs-evidence");
});

test("hasVerificationEvidence matches task-specific verification markers", () => {
  const rows = [
    { id: "VERIF-TASK-BUD-1075-SDK-ONE-FILE-MUTATION-PASS-20260514", evidence: "passed" },
    { id: "VERIF-TASK-BUD-1075-OTHER", evidence: "contains SDK-MUTATION-RUNG-CODIFIED marker" },
  ];

  assert.equal(hasVerificationEvidence(rows, "TASK-BUD-1075", "SDK-ONE-FILE-MUTATION-PASS"), true);
  assert.equal(hasVerificationEvidence(rows, "TASK-BUD-1075", "SDK-MUTATION-RUNG-CODIFIED"), true);
  assert.equal(hasVerificationEvidence(rows, "TASK-BUD-1068", "SDK-ONE-FILE-MUTATION-PASS"), false);
});
