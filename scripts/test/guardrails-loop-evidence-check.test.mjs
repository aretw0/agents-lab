import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { assessLoopEvidence, computeEvidenceReadiness } from "../guardrails-loop-evidence-check.mjs";

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
        runtimeCodeState: "active",
        markersLabel: "PREPARADO=yes ATIVO_AQUI=yes EM_LOOP=yes blocker=none",
        emLoop: true,
      },
      lastLoopReady: {
        atIso: "2026-04-23T19:59:20.000Z",
        markersLabel: "PREPARADO=yes ATIVO_AQUI=yes EM_LOOP=yes blocker=none",
        runtimeCodeState: "active",
        boardAutoAdvanceGate: "ready",
        nextTaskId: "TASK-BUD-125",
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
