import test from "node:test";
import assert from "node:assert/strict";
import {
  nextActionForStage,
  hasVerificationEvidence,
  resolveAgentWorkerLane,
  resolveStage,
  statusById,
  extractTaskIdsFromText,
  resolveLaneTaskStatuses,
  resolveStageFromLaneStatuses,
  resolveDecouplingState,
  nextActionForMaturityState,
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

test("decoupling lane doc parsing uses dynamic task IDs and current-board-derived status", () => {
  const text = "Task: `TASK-BUD-637`\\nTask: `TASK-BUD-638`\\nTask: `TASK-BUD-639`";
  const ids = extractTaskIdsFromText(text);
  assert.deepEqual(ids, ["TASK-BUD-637", "TASK-BUD-638", "TASK-BUD-639"]);

  const tasks = [
    { id: "TASK-BUD-638", status: "completed" },
    { id: "TASK-BUD-639", status: "completed" },
  ];
  const verifications = [
    { id: "VERIF-TASK-BUD-638-PASS", task_id: "TASK-BUD-638", evidence: "passed" },
  ];
  const phases = {
    stabilize: { id: "TASK-BUD-637" },
    delegate: { id: "TASK-BUD-638" },
    decouple: { id: "TASK-BUD-639" },
  };

  const laneStatuses = resolveLaneTaskStatuses(tasks, verifications, phases);
  assert.equal(resolveStageFromLaneStatuses(laneStatuses), "decouple");
  const state = resolveDecouplingState({
    laneStage: "decouple",
    laneStatuses,
    docsSignals: {
      colonyGap: false,
      multiWorkerBlocked: true,
    },
  });
  assert.equal(state, "multi-worker-not-ready");
});

test("decoupling maturity blocker for executor propagation gap recommends colony_plan_packet route", () => {
  const action = nextActionForMaturityState("colony-blocked-by-executor-propagation-gap");

  assert.equal(action.recommendationCode, "decoupling-colony-blocked-executor-propagation-gap");
  assert.equal(action.localSafeRoute?.tool, "colony_plan_packet");
  assert.equal(action.localSafeRoute?.mode, "report-only");
  assert.equal(action.localSafeRoute?.noDispatch, true);
  assert.match(
    action.nextAction,
    /colony_plan_packet.*report-only|fail-closed/i,
  );
});
