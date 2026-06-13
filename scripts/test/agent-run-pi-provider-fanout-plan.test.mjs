import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildAgentRunPiProviderFanoutPlan,
  writeAgentRunPiProviderFanoutPlan,
} from "../agent-run-pi-provider-fanout-plan.mjs";

function workspace(prefix) {
  const cwd = mkdtempSync(path.join(tmpdir(), prefix));
  const cliPath = path.join(cwd, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  mkdirSync(path.dirname(cliPath), { recursive: true });
  writeFileSync(cliPath, "console.log('pi')\n", "utf8");
  writeFileSync(path.join(cwd, "package.json"), "{}\n", "utf8");
  return cwd;
}

test("provider fanout plan prepares two report-only pi print workers", () => {
  const cwd = workspace("pi-provider-fanout-plan-");
  try {
    const report = buildAgentRunPiProviderFanoutPlan({ cwd });

    assert.equal(report.mode, "agent-run-pi-provider-fanout-plan");
    assert.equal(report.decision, "ready-for-operator-decision");
    assert.equal(report.model, "openai-codex/gpt-5.3-codex-spark");
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.equal(report.workerDispatchAllowed, false);
    assert.equal(report.batchExecutionAllowed, false);
    assert.equal(report.workerCount, 2);
    assert.equal(report.workerStepQueue.mode, "agent-worker-step-queue");
    assert.equal(report.workerStepQueue.decision, "ready-for-operator-decision");
    assert.equal(report.workerStepQueue.workerCount, 2);
    assert.equal(report.workerStepQueue.dispatchAllowed, false);
    assert.equal(report.workerStepQueue.processStartAllowed, false);
    assert.deepEqual(report.workerStepQueue.steps.map((step) => step.stepId), ["worker-a", "worker-b"]);
    assert.equal(report.workerStepQueue.steps[0].sourceAdapter, "manual-pi-provider");
    assert.equal(report.workerStepQueue.steps[0].driverStepCall.tool, "agent_run_driver_step_dispatch");
    assert.deepEqual(report.workerPackets.map((packet) => packet.decision), ["ready-for-driver-step", "ready-for-driver-step"]);
    assert.deepEqual(report.workerPackets.map((packet) => packet.payload.run_spec.file_contract), ["read-only", "read-only"]);
    assert.deepEqual(report.workerPackets.map((packet) => packet.payload.run_spec.provider_model_ref), [
      "openai-codex/gpt-5.3-codex-spark",
      "openai-codex/gpt-5.3-codex-spark",
    ]);
    assert.equal(report.workerPackets[0].driverStepCall.tool, "agent_run_driver_step_dispatch");
    assert.equal(report.workerPackets[0].driverStepCall.params.execute, undefined);
    assert.match(report.workerPackets[0].payload.run_spec.execution_preview.args.join(" "), /--print/);
    assert.match(report.workerPackets[0].payload.run_spec.execution_preview.args.join(" "), /--no-session/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider fanout plan blocks direct execute requests", () => {
  const cwd = workspace("pi-provider-fanout-plan-execute-");
  try {
    const report = buildAgentRunPiProviderFanoutPlan({ cwd, execute: true });

    assert.equal(report.decision, "blocked");
    assert.ok(report.blockers.includes("execute-not-supported-by-provider-fanout-plan"));
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider fanout plan writes evidence artifact", () => {
  const cwd = workspace("pi-provider-fanout-plan-write-");
  try {
    const report = writeAgentRunPiProviderFanoutPlan({ cwd, outPath: ".artifacts/agent-run-driver/pi-provider-fanout-plan.json" });
    const outPath = path.join(cwd, ".artifacts/agent-run-driver/pi-provider-fanout-plan.json");

    assert.equal(existsSync(outPath), true);
    assert.deepEqual(JSON.parse(readFileSync(outPath, "utf8")), report);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider fanout plan derives protected board research workers without dispatch", () => {
  const cwd = workspace("pi-provider-fanout-plan-protected-board-");
  try {
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    mkdirSync(path.join(cwd, "docs", "research"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), `${JSON.stringify({
      tasks: [
        {
          id: "TASK-PROTECTED-1",
          status: "planned",
          priority: "p3",
          milestone: "parked-for-0.8.0",
          description: "Evaluate https://example.test later",
          files: ["docs/research/"],
          acceptance_criteria: ["Keep protected"],
        },
        {
          id: "TASK-LOCAL",
          status: "planned",
          priority: "p1",
          description: "Local safe",
          files: ["package.json"],
        },
      ],
    }, null, 2)}\n`, "utf8");

    const report = buildAgentRunPiProviderFanoutPlan({
      cwd,
      fromBoardProtected: true,
      batchId: "protected-research",
    });

    assert.equal(report.decision, "ready-for-operator-decision");
    assert.equal(report.source, "protected-board");
    assert.equal(report.workerCount, 1);
    assert.deepEqual(report.boardSelection.selectedTaskIds, ["TASK-PROTECTED-1"]);
    assert.equal(report.workerPackets[0].workerId, "task-protected-1");
    assert.equal(report.workerPackets[0].taskId, "TASK-PROTECTED-1");
    assert.equal(report.workerPackets[0].payload.run_spec.file_contract, "read-only");
    assert.match(report.workerPackets[0].payload.run_spec.execution_preview.args.join(" "), /Protected research planning contract/);
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.equal(report.batchExecutionAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider fanout plan derives local-safe board workers and respects dependencies", () => {
  const cwd = workspace("pi-provider-fanout-plan-local-board-");
  try {
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), `${JSON.stringify({
      tasks: [
        {
          id: "TASK-DONE",
          status: "completed",
          priority: "p1",
          milestone: "done",
          description: "Done",
          files: ["package.json"],
          acceptance_criteria: ["Done"],
        },
        {
          id: "TASK-LOCAL-1",
          status: "planned",
          priority: "p1",
          milestone: "worker",
          description: "Assimilate local evidence",
          depends_on: ["TASK-DONE"],
          files: ["package.json"],
          acceptance_criteria: ["Read local files only"],
        },
        {
          id: "TASK-BLOCKED-DEP",
          status: "planned",
          priority: "p1",
          milestone: "worker",
          description: "Wait for dependency",
          depends_on: ["TASK-LOCAL-1"],
          files: ["package.json"],
          acceptance_criteria: ["Wait"],
        },
        {
          id: "TASK-PROTECTED",
          status: "planned",
          priority: "p3",
          milestone: "parked-for-0.8.0",
          description: "Evaluate https://example.test later",
          files: ["docs/research/"],
          acceptance_criteria: ["Keep protected"],
        },
        {
          id: "TASK-PARKED-NO-URL",
          status: "planned",
          priority: "p3",
          milestone: "parked-for-0.8.0",
          description: "Parked without URL signal",
          files: ["package.json"],
          acceptance_criteria: ["Keep parked"],
        },
      ],
    }, null, 2)}\n`, "utf8");

    const report = buildAgentRunPiProviderFanoutPlan({
      cwd,
      fromBoardLocalSafe: true,
      batchId: "local-safe-board",
    });

    assert.equal(report.decision, "ready-for-operator-decision");
    assert.equal(report.source, "local-safe-board");
    assert.equal(report.workerCount, 1);
    assert.deepEqual(report.boardSelection.selectedTaskIds, ["TASK-LOCAL-1"]);
    assert.equal(report.workerPackets[0].workerId, "task-local-1");
    assert.equal(report.workerPackets[0].taskId, "TASK-LOCAL-1");
    assert.equal(report.workerPackets[0].declaredFilesSource, "task-files");
    assert.equal(report.workerStepQueue.mode, "agent-worker-step-queue");
    assert.equal(report.workerStepQueue.steps[0].stepId, "task-local-1");
    assert.equal(report.workerStepQueue.steps[0].sourceAdapter, "local-safe-board-pi-provider");
    assert.deepEqual(report.workerStepQueue.steps[0].runSpec.declaredFiles, ["package.json"]);
    assert.match(report.workerPackets[0].payload.run_spec.execution_preview.args.join(" "), /Local-safe board worker contract/);
    assert.ok(report.boardSelection.skippedSamples.some((item) => item.taskId === "TASK-BLOCKED-DEP" && item.reason.includes("dependencies-not-completed")));
    assert.ok(report.boardSelection.skippedSamples.some((item) => item.taskId === "TASK-PARKED-NO-URL" && item.reason === "protected-or-parked"));
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.equal(report.batchExecutionAllowed, false);
    assert.ok(report.nextActions.some((action) => action.includes("agent-run-pi-provider-local-safe-fanout-outcome")));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider fanout plan blocks local-safe board mode when no actionable workers exist", () => {
  const cwd = workspace("pi-provider-fanout-plan-local-board-empty-");
  try {
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), `${JSON.stringify({
      tasks: [
        {
          id: "TASK-PROTECTED",
          status: "planned",
          priority: "p3",
          milestone: "parked-for-0.8.0",
          description: "Evaluate https://example.test later",
          files: ["docs/research/"],
          acceptance_criteria: ["Keep protected"],
        },
        {
          id: "TASK-MISSING-SPEC",
          status: "planned",
          priority: "p1",
          milestone: "worker",
          description: "Missing spec",
        },
      ],
    }, null, 2)}\n`, "utf8");

    const report = buildAgentRunPiProviderFanoutPlan({ cwd, fromBoardLocalSafe: true });

    assert.equal(report.decision, "blocked");
    assert.ok(report.blockers.includes("local-safe-board-workers-missing"));
    assert.equal(report.workerCount, 0);
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider fanout plan blocks local-safe board workers with missing declared files", () => {
  const cwd = workspace("pi-provider-fanout-plan-local-board-missing-file-");
  try {
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), `${JSON.stringify({
      tasks: [
        {
          id: "TASK-MISSING-FILE",
          status: "planned",
          priority: "p1",
          milestone: "worker",
          description: "Uses a missing file",
          files: ["missing.md"],
          acceptance_criteria: ["Read local files only"],
        },
      ],
    }, null, 2)}\n`, "utf8");

    const report = buildAgentRunPiProviderFanoutPlan({
      cwd,
      fromBoardLocalSafe: true,
      batchId: "local-safe-board",
    });

    assert.equal(report.decision, "blocked");
    assert.ok(report.blockers.includes("task-missing-file:isolation:declared-file-missing"));
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.equal(report.workerPackets[0].decision, "blocked");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider fanout plan narrows protected board files to local task evidence when present", () => {
  const cwd = workspace("pi-provider-fanout-plan-protected-board-evidence-");
  try {
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    mkdirSync(path.join(cwd, "docs", "research"), { recursive: true });
    writeFileSync(path.join(cwd, "docs", "research", "task-protected-1-local-canary.md"), "# local evidence\n", "utf8");
    writeFileSync(path.join(cwd, ".project", "tasks.json"), `${JSON.stringify({
      tasks: [
        {
          id: "TASK-PROTECTED-1",
          status: "planned",
          priority: "p3",
          milestone: "parked-for-0.8.0",
          description: "Evaluate https://example.test later",
          files: ["docs/research/"],
          acceptance_criteria: ["Keep protected"],
        },
      ],
    }, null, 2)}\n`, "utf8");

    const report = buildAgentRunPiProviderFanoutPlan({
      cwd,
      fromBoardProtected: true,
      batchId: "protected-research",
      requireLocalTaskEvidence: true,
    });

    assert.equal(report.decision, "ready-for-operator-decision");
    assert.equal(report.requireLocalTaskEvidence, true);
    assert.equal(report.workerPackets[0].declaredFilesSource, "local-task-evidence");
    assert.deepEqual(report.workerPackets[0].payload.run_spec.declared_files, ["docs/research/task-protected-1-local-canary.md"]);
    assert.match(report.workerPackets[0].payload.run_spec.execution_preview.args.join(" "), /@docs\/research\/task-protected-1-local-canary\.md/);
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider fanout plan blocks when local task evidence is required but missing", () => {
  const cwd = workspace("pi-provider-fanout-plan-protected-board-required-evidence-");
  try {
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), `${JSON.stringify({
      tasks: [
        {
          id: "TASK-PROTECTED-1",
          status: "planned",
          priority: "p3",
          milestone: "parked-for-0.8.0",
          description: "Evaluate https://example.test later",
          files: ["docs/research/"],
          acceptance_criteria: ["Keep protected"],
        },
      ],
    }, null, 2)}\n`, "utf8");

    const report = buildAgentRunPiProviderFanoutPlan({
      cwd,
      fromBoardProtected: true,
      requireLocalTaskEvidence: true,
    });

    assert.equal(report.decision, "blocked");
    assert.equal(report.requireLocalTaskEvidence, true);
    assert.ok(report.blockers.includes("local-task-evidence-missing:TASK-PROTECTED-1"));
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider fanout plan blocks protected board mode when no protected workers exist", () => {
  const cwd = workspace("pi-provider-fanout-plan-protected-board-empty-");
  try {
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), `${JSON.stringify({
      tasks: [{
        id: "TASK-LOCAL",
        status: "planned",
        priority: "p1",
        description: "Local safe",
        files: ["package.json"],
      }],
    }, null, 2)}\n`, "utf8");

    const report = buildAgentRunPiProviderFanoutPlan({ cwd, fromBoardProtected: true });

    assert.equal(report.decision, "blocked");
    assert.ok(report.blockers.includes("protected-board-workers-missing"));
    assert.equal(report.workerCount, 0);
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider fanout plan uses research docs fallback for protected tasks without files", () => {
  const cwd = workspace("pi-provider-fanout-plan-protected-board-fallback-");
  try {
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    mkdirSync(path.join(cwd, "docs", "research"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), `${JSON.stringify({
      tasks: [{
        id: "TASK-PROTECTED-NO-FILES",
        status: "planned",
        priority: "p3",
        milestone: "parked-for-0.8.0",
        description: "Evaluate https://example.test later",
      }],
    }, null, 2)}\n`, "utf8");

    const report = buildAgentRunPiProviderFanoutPlan({ cwd, fromBoardProtected: true });

    assert.equal(report.decision, "ready-for-operator-decision");
    assert.deepEqual(report.workerPackets[0].payload.run_spec.declared_files, ["docs/research/"]);
    assert.match(report.workerPackets[0].payload.run_spec.execution_preview.args.join(" "), /@docs\/research\//);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
