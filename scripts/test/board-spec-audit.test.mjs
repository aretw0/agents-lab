import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildBoardSpecAudit, parseArgs } from "../project/board-spec-audit.mjs";

function withBoard(tasks, fn) {
  const cwd = mkdtempSync(path.join(tmpdir(), "board-spec-audit-"));
  try {
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), `${JSON.stringify({ tasks }, null, 2)}\n`, "utf8");
    return fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("board spec audit classifies actionable local-safe tasks", () => withBoard([
  {
    id: "TASK-LOCAL",
    status: "planned",
    priority: "p1",
    description: "Implement local report-only helper",
    milestone: "0.8-board",
    files: ["scripts/local-helper.mjs"],
    acceptance_criteria: ["Report-only packet exists", "Focused test passes"],
  },
], (cwd) => {
  const report = buildBoardSpecAudit({ cwd });

  assert.equal(report.mode, "project-board-spec-audit");
  assert.equal(report.decision, "actionable");
  assert.equal(report.nextActionCode, "generate-fanout-manifest");
  assert.equal(report.dispatchAllowed, false);
  assert.equal(report.processStartAllowed, false);
  assert.deepEqual(report.actionableTaskIds, ["TASK-LOCAL"]);
  assert.deepEqual(report.specMaturationTaskIds, []);
  assert.deepEqual(report.protectedTaskIds, []);
}));

test("board spec audit separates protected parked tasks from missing specs", () => withBoard([
  {
    id: "TASK-PROTECTED",
    status: "planned",
    priority: "p3",
    description: "Research https://example.test later",
    milestone: "parked-for-0.8.0",
    files: ["docs/research/"],
    acceptance_criteria: ["Keep human-gated"],
  },
  {
    id: "TASK-NEEDS-SPEC",
    status: "planned",
    priority: "p1",
    description: "Needs sharper local spec",
    milestone: "0.8-board",
    files: [],
    acceptance_criteria: [],
  },
], (cwd) => {
  const report = buildBoardSpecAudit({ cwd });

  assert.equal(report.decision, "needs-spec");
  assert.equal(report.nextActionCode, "mature-board-specs");
  assert.deepEqual(report.protectedTaskIds, ["TASK-PROTECTED"]);
  assert.deepEqual(report.specMaturationTaskIds, ["TASK-NEEDS-SPEC"]);
  assert.equal(report.counts.bySpecStatus["protected-or-parked"], 1);
  assert.equal(report.counts.bySpecStatus["needs-spec"], 1);
  assert.ok(report.taskSpecs.find((row) => row.taskId === "TASK-NEEDS-SPEC").gaps.includes("files-missing"));
  assert.ok(report.taskSpecs.find((row) => row.taskId === "TASK-NEEDS-SPEC").gaps.includes("acceptance-criteria-missing"));
}));

test("board spec audit reports no local-safe work when only closed and parked tasks remain", () => withBoard([
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
    description: "External influence parked",
    milestone: "parked-for-0.8.0",
    files: ["docs/research/"],
    acceptance_criteria: ["Keep parked"],
  },
], (cwd) => {
  const report = buildBoardSpecAudit({ cwd });

  assert.equal(report.decision, "no-local-safe-work");
  assert.equal(report.nextActionCode, "review-next-scope-candidates");
  assert.deepEqual(report.actionableTaskIds, []);
  assert.deepEqual(report.specMaturationTaskIds, []);
  assert.deepEqual(report.protectedTaskIds, ["TASK-PARKED"]);
  assert.equal(report.nextScopeCandidates.length, 2);
  assert.equal(report.nextScopeCandidates[0].candidateId, "local-safe-board-next-scope-intake");
  assert.equal(report.nextScopeCandidates[0].dispatchAllowed, false);
  assert.equal(report.nextScopeCandidates[0].processStartAllowed, false);
  assert.equal(report.nextScopeCandidates[1].category, "operator-decision");
  assert.deepEqual(report.nextScopeCandidates[1].protectedTaskIds, ["TASK-PARKED"]);
}));

test("board spec audit parseArgs accepts report options", () => {
  const args = parseArgs(["--json", "--pretty", "--strict", "--board", ".project/other.json", "--out", ".artifacts/board.json"]);

  assert.equal(args.json, true);
  assert.equal(args.pretty, true);
  assert.equal(args.strict, true);
  assert.equal(args.boardPath, ".project/other.json");
  assert.equal(args.outPath, ".artifacts/board.json");
});
