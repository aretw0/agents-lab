import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildPiDevPressureReport,
  buildEntrypointBudget,
  buildSessionBudget,
  buildSessionBudgetCleanupPlan,
  collectEntrypointStats,
  collectSessionStats,
  collectSettingsStats,
  computeStrictFailures,
} from "../pi-dev-pressure.mjs";

function makeWorkspace() {
  return mkdtempSync(join(tmpdir(), "pi-dev-pressure-test-"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createMinimalPiStack(cwd, extensions) {
  const root = join(cwd, "packages", "pi-stack");
  const extRoot = join(root, "extensions");
  mkdirSync(extRoot, { recursive: true });
  writeJson(join(root, "package.json"), {
    name: "@aretw0/pi-stack",
    pi: { extensions },
  });
  return extRoot;
}

test("collectSessionStats reports largest isolated session without reading jsonl content", () => {
  const cwd = makeWorkspace();
  try {
    const sessions = join(cwd, ".sandbox", "pi-agent", "sessions", "workspace");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(join(sessions, "small.jsonl"), "x".repeat(1024), "utf8");
    writeFileSync(join(sessions, "large.jsonl"), "x".repeat(2048), "utf8");

    const stats = collectSessionStats(cwd);

    assert.equal(stats.count, 2);
    assert.equal(stats.largest.path, ".sandbox/pi-agent/sessions/workspace/large.jsonl");
    assert.equal(stats.largest.bytes, 2048);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("buildSessionBudget classifies oversized resume candidates", () => {
  const budget = buildSessionBudget({
    files: [
      { path: "small.jsonl", mb: 1 },
      { path: "warn.jsonl", mb: 60 },
      { path: "block.jsonl", mb: 160 },
    ],
  });

  assert.equal(budget.oversized.length, 2);
  assert.equal(budget.blockers.length, 1);
  assert.equal(budget.blockers[0].path, "block.jsonl");
  assert.equal(budget.recommendation, "do-not-resume-archive-or-delete-after-checkpoint");
});

test("buildSessionBudgetCleanupPlan only targets sandbox session blockers", () => {
  const cwd = makeWorkspace();
  try {
    const sessionDir = join(cwd, ".sandbox", "pi-agent", "sessions", "workspace");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, "huge.jsonl"), "x", "utf8");

    const plan = buildSessionBudgetCleanupPlan({
      cwd,
      sessionBudget: {
        blockers: [
          { path: ".sandbox/pi-agent/sessions/workspace/huge.jsonl", mb: 160 },
          { path: ".pi/settings.json", mb: 160 },
        ],
      },
    });

    assert.equal(plan.mode, "dry-run");
    assert.equal(plan.targets.length, 2);
    assert.equal(plan.targets[0].allowed, true);
    assert.equal(plan.targets[1].allowed, false);
    assert.equal(plan.targets[1].reason, "path-guard-blocked");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});


test("collectEntrypointStats measures transitive local extension imports", () => {
  const cwd = makeWorkspace();
  try {
    const extRoot = createMinimalPiStack(cwd, ["./extensions/main.ts"]);
    writeFileSync(join(extRoot, "main.ts"), 'import { value } from "./helper";\nexport const main = value;\n', "utf8");
    writeFileSync(join(extRoot, "helper.ts"), 'export const value = "ok";\n', "utf8");

    const stats = collectEntrypointStats(cwd);

    assert.equal(stats.length, 1);
    assert.equal(stats[0].entry, "./extensions/main.ts");
    assert.equal(stats[0].files, 2);
    assert.ok(stats[0].kb > 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("buildEntrypointBudget classifies hot-path bloat candidates", () => {
  const budget = buildEntrypointBudget([
    { entry: "./extensions/small.ts", files: 2, kb: 10 },
    { entry: "./extensions/big.ts", files: 90, kb: 900 },
  ]);

  assert.equal(budget.oversized.length, 1);
  assert.equal(budget.oversized[0].entry, "./extensions/big.ts");
  assert.equal(budget.recommendation, "split-hot-path-or-move-diagnostics-behind-opt-in");
});


test("collectSettingsStats counts suppressed package entries", () => {
  const cwd = makeWorkspace();
  try {
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    mkdirSync(join(cwd, ".sandbox", "pi-agent"), { recursive: true });
    writeJson(join(cwd, ".pi", "settings.json"), {
      packages: [
        "../packages/pi-stack",
        { source: "npm:@aretw0/pi-stack", extensions: [], skills: [], themes: [] },
      ],
    });
    writeJson(join(cwd, ".sandbox", "pi-agent", "settings.json"), {
      packages: ["npm:@ifi/pi-web-remote"],
    });

    const stats = collectSettingsStats(cwd);

    assert.equal(stats[0].path, ".pi/settings.json");
    assert.equal(stats[0].packageCount, 2);
    assert.equal(stats[0].suppressedSurfaceCount, 1);
    assert.equal(stats[1].npmPackageCount, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("buildPiDevPressureReport recommends new-session for large resume logs", () => {
  const cwd = makeWorkspace();
  try {
    createMinimalPiStack(cwd, ["./extensions/main.ts"]);
    writeFileSync(join(cwd, "packages", "pi-stack", "extensions", "main.ts"), "export const ok = true;\n", "utf8");
    const sessions = join(cwd, ".sandbox", "pi-agent", "sessions", "workspace");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(join(sessions, "resume.jsonl"), "x".repeat(2 * 1024 * 1024), "utf8");

    const report = buildPiDevPressureReport(cwd, {
      git: false,
      thresholds: {
        largeSessionMb: 0.001,
        blockingSessionMb: 99,
        heavyEntrypointKb: 999,
        heavyEntrypointFiles: 999,
      },
    });

    assert.equal(report.recommendation, "new-session");
    assert.ok(report.signals.some((signal) => signal.code === "large-resume-session"));
    assert.equal(report.sessionBudget.oversized.length, 1);
    assert.equal(report.sessionBudget.recommendation, "prefer-new-session-and-checkpoint-before-resume");
    assert.equal(report.entrypointBudget.recommendation, "within-budget");
    assert.deepEqual(computeStrictFailures(report), []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("computeStrictFailures fails only blocking pressure signals", () => {
  const failures = computeStrictFailures({
    signals: [
      { level: "warn", code: "large-resume-session" },
      { level: "block", code: "huge-resume-session" },
    ],
  });

  assert.deepEqual(failures, ["huge-resume-session"]);
});
