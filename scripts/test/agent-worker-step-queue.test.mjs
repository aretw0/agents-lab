import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildAgentWorkerStepQueue } from "../agent-worker-step-queue.mjs";

function runSpec(cwd) {
  return {
    run_id: "queue-worker-1",
    provider_model_ref: "local/process",
    cwd,
    declared_files: ["README.md"],
    log_path: ".pi/reports/queue-worker-1.log",
    execution_preview: {
      command: "node",
      args: ["--version"],
    },
  };
}

test("agent worker step queue normalizes agnostic single-run steps", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "agent-worker-step-queue-"));
  const queue = buildAgentWorkerStepQueue({
    queueId: "queue-test",
    cwd,
    steps: [
      {
        worker_id: "worker-1",
        source_adapter: "local-test",
        run_spec: runSpec(cwd),
        driver_step_call: {
          tool: "agent_run_driver_step_dispatch",
        },
      },
    ],
  });

  assert.equal(queue.mode, "agent-worker-step-queue");
  assert.equal(queue.decision, "ready-for-operator-decision");
  assert.equal(queue.dispatchAllowed, false);
  assert.equal(queue.processStartAllowed, false);
  assert.equal(queue.batchExecutionAllowed, false);
  assert.equal(queue.workerCount, 1);
  assert.equal(queue.steps[0].stepId, "worker-1");
  assert.equal(queue.steps[0].singleRunOnly, true);
  assert.equal(queue.steps[0].dispatchAllowed, false);
  assert.equal(queue.steps[0].processStartAllowed, false);
  assert.equal(queue.steps[0].runSpec.runId, "queue-worker-1");
  assert.equal(queue.steps[0].runSpec.fileContract, "read-only");
  assert.equal(queue.steps[0].driverStepCall.tool, "agent_run_driver_step_dispatch");
});

test("agent worker step queue fails closed for empty or incomplete queues", () => {
  const empty = buildAgentWorkerStepQueue({ steps: [] });
  assert.equal(empty.decision, "blocked");
  assert.ok(empty.blockers.includes("worker-steps-missing"));

  const incomplete = buildAgentWorkerStepQueue({
    steps: [
      {
        workerId: "worker-missing-files",
        runSpec: {
          runId: "worker-missing-files",
          providerModelRef: "local/process",
          cwd: ".",
          logPath: ".pi/reports/worker-missing-files.log",
          executionPreview: { command: "node" },
        },
      },
    ],
  });

  assert.equal(incomplete.decision, "blocked");
  assert.ok(incomplete.blockers.includes("worker-missing-files:declared-files-missing"));
});

test("agent worker step queue does not inherit adapter dispatch flags", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "agent-worker-step-queue-flags-"));
  const queue = buildAgentWorkerStepQueue({
    cwd,
    steps: [
      {
        workerId: "worker-preview-only",
        dispatchAllowed: true,
        processStartAllowed: true,
        runSpec: runSpec(cwd),
      },
    ],
  });

  assert.equal(queue.decision, "ready-for-operator-decision");
  assert.equal(queue.dispatchAllowed, false);
  assert.equal(queue.processStartAllowed, false);
  assert.equal(queue.steps[0].dispatchAllowed, false);
  assert.equal(queue.steps[0].processStartAllowed, false);
});
