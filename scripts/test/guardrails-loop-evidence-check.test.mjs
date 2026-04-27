import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { assessLoopEvidence, computeEvidenceReadiness, evaluateMilestoneScopeMatch } from "../guardrails-loop-evidence-check.mjs";

test("computeEvidenceReadiness returns ready only when active+emLoop criteria are met", () => {
  const ready = computeEvidenceReadiness({
    lastBoardAutoAdvance: {
      runtimeCodeState: "active",
      emLoop: true,
    },
    lastLoopReady: {
      runtimeCodeState: "active",
    },
  });

  assert.equal(ready.readyForTaskBud125, true);
  assert.ok(ready.criteria.includes("boardAuto.runtime=active:yes"));

  const notReady = computeEvidenceReadiness({
    lastBoardAutoAdvance: {
      runtimeCodeState: "reload-required",
      emLoop: false,
    },
    lastLoopReady: {
      runtimeCodeState: "unknown",
    },
  });

  assert.equal(notReady.readyForTaskBud125, false);
  assert.ok(notReady.criteria.includes("boardAuto.runtime=active:no"));
});

test("assessLoopEvidence reports missing evidence file", () => {
  const cwd = mkdtempSync(join(tmpdir(), "loop-evidence-missing-"));
  try {
    const report = assessLoopEvidence({ cwd, nowMs: Date.parse("2026-04-23T20:00:00.000Z") });
    assert.equal(report.status, "missing");
    assert.equal(report.readyForTaskBud125, false);
    assert.equal(report.stale, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("assessLoopEvidence reports ready and fresh state", () => {
  const cwd = mkdtempSync(join(tmpdir(), "loop-evidence-ready-"));
  try {
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "guardrails-loop-evidence.json"), `${JSON.stringify({
      version: 1,
      updatedAtIso: "2026-04-23T19:59:30.000Z",
      lastBoardAutoAdvance: {
        atIso: "2026-04-23T19:59:30.000Z",
        taskId: "TASK-BUD-125",
        milestone: "MS-LOCAL",
        runtimeCodeState: "active",
        markersLabel: "READY=yes ACTIVE_HERE=yes IN_LOOP=yes blocker=none",
        emLoop: true,
      },
      lastLoopReady: {
        atIso: "2026-04-23T19:59:20.000Z",
        markersLabel: "READY=yes ACTIVE_HERE=yes IN_LOOP=yes blocker=none",
        runtimeCodeState: "active",
        boardAutoAdvanceGate: "ready",
        nextTaskId: "TASK-BUD-125",
        milestone: "MS-LOCAL",
      },
    }, null, 2)}\n`, "utf8");

    const report = assessLoopEvidence({
      cwd,
      nowMs: Date.parse("2026-04-23T20:00:00.000Z"),
      maxAgeMin: 30,
    });

    assert.equal(report.status, "ok");
    assert.equal(report.stale, false);
    assert.equal(report.readyForTaskBud125, true);
    assert.equal(report.boardAuto?.milestone, "MS-LOCAL");
    assert.equal(report.loopReady?.milestone, "MS-LOCAL");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("assessLoopEvidence keeps readiness criteria task-agnostic (real board auto task may differ)", () => {
  const cwd = mkdtempSync(join(tmpdir(), "loop-evidence-task-agnostic-"));
  try {
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "guardrails-loop-evidence.json"), `${JSON.stringify({
      version: 1,
      updatedAtIso: "2026-04-23T21:52:43.461Z",
      lastBoardAutoAdvance: {
        atIso: "2026-04-23T21:52:43.461Z",
        taskId: "TASK-BUD-028",
        runtimeCodeState: "active",
        markersLabel: "READY=yes ACTIVE_HERE=yes IN_LOOP=yes blocker=none",
        emLoop: true,
      },
      lastLoopReady: {
        atIso: "2026-04-23T21:52:43.446Z",
        markersLabel: "READY=yes ACTIVE_HERE=yes IN_LOOP=yes blocker=none",
        runtimeCodeState: "active",
        boardAutoAdvanceGate: "ready",
        nextTaskId: "TASK-BUD-028",
      },
    }, null, 2)}\n`, "utf8");

    const report = assessLoopEvidence({
      cwd,
      nowMs: Date.parse("2026-04-23T22:00:00.000Z"),
      maxAgeMin: 30,
    });

    assert.equal(report.status, "ok");
    assert.equal(report.readyForTaskBud125, true);
    assert.equal(report.boardAuto?.taskId, "TASK-BUD-028");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("evaluateMilestoneScopeMatch requires parity between boardAuto and loopReady milestones", () => {
  const matched = evaluateMilestoneScopeMatch({
    boardAuto: { milestone: "MS LOCAL" },
    loopReady: { milestone: "MS LOCAL" },
  }, "MS   LOCAL");
  assert.equal(matched.matches, true);

  const mismatched = evaluateMilestoneScopeMatch({
    boardAuto: { milestone: "MS-1" },
    loopReady: { milestone: "MS-2" },
  }, "MS-1");
  assert.equal(mismatched.matches, false);
});

test("cli json output includes milestoneCheck when expect-milestone is provided", () => {
  const cwd = mkdtempSync(join(tmpdir(), "loop-evidence-cli-ms-"));
  try {
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "guardrails-loop-evidence.json"), `${JSON.stringify({
      version: 1,
      updatedAtIso: "2026-04-23T19:59:30.000Z",
      lastBoardAutoAdvance: {
        atIso: "2026-04-23T19:59:30.000Z",
        taskId: "TASK-BUD-125",
        milestone: "MS-LOCAL",
        runtimeCodeState: "active",
        markersLabel: "READY=yes ACTIVE_HERE=yes IN_LOOP=yes blocker=none",
        emLoop: true,
      },
      lastLoopReady: {
        atIso: "2026-04-23T19:59:20.000Z",
        markersLabel: "READY=yes ACTIVE_HERE=yes IN_LOOP=yes blocker=none",
        runtimeCodeState: "active",
        boardAutoAdvanceGate: "ready",
        nextTaskId: "TASK-BUD-125",
        milestone: "MS-LOCAL",
      },
    }, null, 2)}\n`, "utf8");

    const cli = spawnSync(process.execPath, [
      join(process.cwd(), "scripts", "guardrails-loop-evidence-check.mjs"),
      "--cwd",
      cwd,
      "--json",
      "--expect-milestone",
      "MS-LOCAL",
    ], { encoding: "utf8" });

    assert.equal(cli.status, 0);
    const parsed = JSON.parse(cli.stdout);
    assert.equal(parsed.milestoneCheck.expectedMilestone, "MS-LOCAL");
    assert.equal(parsed.milestoneCheck.matches, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("cli strict mode fails on milestone mismatch", () => {
  const cwd = mkdtempSync(join(tmpdir(), "loop-evidence-cli-ms-fail-"));
  try {
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "guardrails-loop-evidence.json"), `${JSON.stringify({
      version: 1,
      updatedAtIso: "2026-04-23T19:59:30.000Z",
      lastBoardAutoAdvance: {
        atIso: "2026-04-23T19:59:30.000Z",
        taskId: "TASK-BUD-125",
        milestone: "MS-A",
        runtimeCodeState: "active",
        markersLabel: "READY=yes ACTIVE_HERE=yes IN_LOOP=yes blocker=none",
        emLoop: true,
      },
      lastLoopReady: {
        atIso: "2026-04-23T19:59:20.000Z",
        markersLabel: "READY=yes ACTIVE_HERE=yes IN_LOOP=yes blocker=none",
        runtimeCodeState: "active",
        boardAutoAdvanceGate: "ready",
        nextTaskId: "TASK-BUD-125",
        milestone: "MS-B",
      },
    }, null, 2)}\n`, "utf8");

    const cli = spawnSync(process.execPath, [
      join(process.cwd(), "scripts", "guardrails-loop-evidence-check.mjs"),
      "--cwd",
      cwd,
      "--strict",
      "--expect-milestone",
      "MS-A",
    ], { encoding: "utf8" });

    assert.equal(cli.status, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("assessLoopEvidence reports stale when updatedAt exceeds freshness window", () => {
  const cwd = mkdtempSync(join(tmpdir(), "loop-evidence-stale-"));
  try {
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "guardrails-loop-evidence.json"), `${JSON.stringify({
      version: 1,
      updatedAtIso: "2026-04-23T18:00:00.000Z",
      lastBoardAutoAdvance: {
        atIso: "2026-04-23T18:00:00.000Z",
        taskId: "TASK-BUD-125",
        runtimeCodeState: "active",
        markersLabel: "...",
        emLoop: true,
      },
      lastLoopReady: {
        atIso: "2026-04-23T18:00:00.000Z",
        markersLabel: "...",
        runtimeCodeState: "active",
        boardAutoAdvanceGate: "ready",
      },
    }, null, 2)}\n`, "utf8");

    const report = assessLoopEvidence({
      cwd,
      nowMs: Date.parse("2026-04-23T20:00:00.000Z"),
      maxAgeMin: 30,
    });

    assert.equal(report.status, "stale");
    assert.equal(report.stale, true);
    assert.equal(report.readyForTaskBud125, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
