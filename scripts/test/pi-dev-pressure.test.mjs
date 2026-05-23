import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildPiDevPressureReport,
  buildEntrypointBudget,
  collectConfiguredEntrypointStats,
  buildSessionBudget,
  buildSessionBudgetCleanupPlan,
  collectEntrypointStats,
  collectSessionStats,
  collectSettingsStats,
  computeStrictFailures,
  buildDevelopmentVelocityPressure,
  buildVelocityPressureSignals,
  collectAgentRunPressureStats,
  collectPerformanceWatchdogStats,
} from "../pi-dev-pressure.mjs";
import { PI_STACK_CONTROL_PLANE_EXTENSION_EXCLUDES } from "../../packages/pi-stack/install.mjs";

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

test("collectPerformanceWatchdogStats reads config and persisted session events", () => {
  const cwd = makeWorkspace();
  try {
    const configPath = join(cwd, ".pi", "agent", "extensions", "watchdog", "config.json");
    mkdirSync(join(cwd, ".pi", "agent", "extensions", "watchdog"), { recursive: true });
    writeJson(configPath, {
      enabled: true,
      thresholds: {
        eventLoopMaxMs: 300,
        eventLoopP99Ms: 150,
        heapUsedMb: 512,
        rssMb: 768,
      },
    });
    const sessions = join(cwd, ".sandbox", "pi-agent", "sessions", "workspace");
    mkdirSync(sessions, { recursive: true });
    const sessionPath = join(sessions, "latest.jsonl");
    writeFileSync(
      sessionPath,
      [
        "normal line",
        "Error: Performance watchdog critical: event-loop max 300ms. Run /watchdog:status",
        "Warning: Watchdog enabled safe mode automatically: safe mode is on (watchdog: event-loop max 319ms).",
      ].join("\n"),
      "utf8",
    );

    const stats = collectPerformanceWatchdogStats(cwd, { configPath, sessionPath });

    assert.equal(stats.available, true);
    assert.equal(stats.thresholdSummary.eventLoopMaxMs, 300);
    assert.equal(stats.persistedEventCount, 2);
    assert.deepEqual(stats.criticalEvents, ["event-loop max 300ms. Run /watchdog:status"]);
    assert.deepEqual(stats.safeModeEvents, ["watchdog: event-loop max 319ms"]);
    assert.equal(stats.liveEventLoopVisibleExternally, false);
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
    assert.equal(stats[0].reachableFiles, 2);
    assert.equal(stats[0].lazyFiles, 0);
    assert.ok(stats[0].kb > 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("collectEntrypointStats separates eager imports from dynamic reachable imports", () => {
  const cwd = makeWorkspace();
  try {
    const extRoot = createMinimalPiStack(cwd, ["./extensions/main.ts"]);
    writeFileSync(
      join(extRoot, "main.ts"),
      'import { value } from "./helper";\nexport async function load() { return import("./lazy"); }\nexport const main = value;\n',
      "utf8",
    );
    writeFileSync(join(extRoot, "helper.ts"), 'export const value = "ok";\n', "utf8");
    writeFileSync(join(extRoot, "lazy.ts"), 'export const lazy = "cold";\n', "utf8");

    const stats = collectEntrypointStats(cwd);

    assert.equal(stats[0].files, 2);
    assert.equal(stats[0].reachableFiles, 3);
    assert.equal(stats[0].lazyFiles, 1);
    assert.ok(stats[0].reachableKb >= stats[0].kb);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("collectConfiguredEntrypointStats applies settings extension excludes", () => {
  const cwd = makeWorkspace();
  try {
    const extRoot = createMinimalPiStack(cwd, [
      "./extensions/core.ts",
      "./extensions/guardrails-agent-run.ts",
    ]);
    writeFileSync(join(extRoot, "core.ts"), "export const core = true;\n", "utf8");
    writeFileSync(join(extRoot, "guardrails-agent-run.ts"), "export const lane = true;\n", "utf8");
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeJson(join(cwd, ".pi", "settings.json"), {
      packages: [
        {
          source: "../packages/pi-stack",
          extensions: ["!extensions/guardrails-agent-run.ts"],
        },
      ],
    });

    const stats = collectConfiguredEntrypointStats(cwd);

    assert.deepEqual(stats.map((row) => row.entry), ["./extensions/core.ts"]);
    assert.equal(stats[0].settings, ".pi/settings.json");
    assert.equal(stats[0].package, "../packages/pi-stack");
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

test("curated custom-footer keeps optional panels out of eager graph", () => {
  const stats = collectEntrypointStats(process.cwd());
  const footer = stats.find((row) => row.entry === "./extensions/custom-footer.ts");

  assert.ok(footer, "custom-footer entrypoint should be measured");
  assert.ok(footer.files <= 25, `custom-footer eager graph has ${footer.files} files`);
  assert.ok(footer.kb <= 200, `custom-footer eager graph is ${footer.kb}kb`);
  assert.ok(footer.reachableFiles > footer.files, "lazy panel/status modules should remain reachable but cold");
});

test("configured guardrails-core stays within hot-path budget", () => {
  const stats = collectConfiguredEntrypointStats(process.cwd());
  const core = stats.find((row) =>
    row.package === "../packages/pi-stack" && row.entry === "./extensions/guardrails-core.ts"
  );

  assert.ok(core, "configured guardrails-core entrypoint should be measured");
  assert.ok(core.files <= 45, `guardrails-core eager graph has ${core.files} files`);
  assert.ok(core.kb <= 400, `guardrails-core eager graph is ${core.kb}kb`);
});

test("control-plane profile keeps expensive optional entrypoints cold", () => {
  const stats = collectEntrypointStats(process.cwd());
  const excludes = new Set(
    PI_STACK_CONTROL_PLANE_EXTENSION_EXCLUDES.map((entry) =>
      entry.startsWith("!") ? `./${entry.slice(1)}` : entry,
    ),
  );
  const missing = stats
    .filter((row) => row.entry !== "./extensions/guardrails-core.ts")
    .filter((row) => row.kb > 400)
    .filter((row) => !excludes.has(row.entry))
    .map((row) => `${row.entry} ${row.kb}kb`);

  assert.deepEqual(missing, []);
});

test("collectEntrypointStats ignores type-only imports in eager graph", () => {
  const cwd = makeWorkspace();
  try {
    const extRoot = createMinimalPiStack(cwd, ["./extensions/main.ts"]);
    writeFileSync(
      join(extRoot, "main.ts"),
      'import type { ColdType } from "./type-only";\nexport const main = "hot";\n',
      "utf8",
    );
    writeFileSync(join(extRoot, "type-only.ts"), 'export interface ColdType { value: string; }\n', "utf8");

    const stats = collectEntrypointStats(cwd);

    assert.equal(stats[0].files, 1);
    assert.equal(stats[0].reachableFiles, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("collectSettingsStats counts suppressed package entries", () => {
  const cwd = makeWorkspace();
  try {
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    mkdirSync(join(cwd, ".sandbox", "pi-agent"), { recursive: true });
    writeJson(join(cwd, ".pi", "settings.json"), {
      packages: [
        "../packages/pi-stack",
        { source: "../packages/pi-stack", extensions: ["!extensions/guardrails-agent-run.ts"] },
        { source: "npm:@aretw0/pi-stack", extensions: [], skills: [], themes: [] },
      ],
    });
    writeJson(join(cwd, ".sandbox", "pi-agent", "settings.json"), {
      packages: ["npm:@ifi/pi-web-remote"],
    });

    const stats = collectSettingsStats(cwd);

    assert.equal(stats[0].path, ".pi/settings.json");
    assert.equal(stats[0].packageCount, 3);
    assert.equal(stats[0].suppressedSurfaceCount, 1);
    assert.equal(stats[0].extensionExcludeCount, 1);
    assert.deepEqual(stats[0].suppressedExtensions, [
      "../packages/pi-stack:!extensions/guardrails-agent-run.ts",
    ]);
    assert.equal(stats[1].npmPackageCount, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("collectSettingsStats marks cross-platform shellPath as invalid", () => {
  const cwd = makeWorkspace();
  try {
    mkdirSync(join(cwd, ".sandbox", "pi-agent"), { recursive: true });
    writeJson(join(cwd, ".sandbox", "pi-agent", "settings.json"), {
      shellPath: "Z:\\DefinitelyMissing\\Git\\bin\\bash.exe",
      packages: [],
    });

    const stats = collectSettingsStats(cwd);
    const sandbox = stats.find((row) => row.path === ".sandbox/pi-agent/settings.json");

    assert.equal(sandbox.shellPath.configured, true);
    assert.equal(sandbox.shellPath.valid, false);
    assert.equal(sandbox.shellPath.reason, process.platform === "win32" ? "path-not-found" : "windows-path-on-non-windows");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("buildPiDevPressureReport blocks invalid runtime shellPath", () => {
  const cwd = makeWorkspace();
  try {
    mkdirSync(join(cwd, ".sandbox", "pi-agent"), { recursive: true });
    writeJson(join(cwd, ".sandbox", "pi-agent", "settings.json"), {
      shellPath: "Z:\\DefinitelyMissing\\Git\\bin\\bash.exe",
      packages: [],
    });

    const report = buildPiDevPressureReport(cwd, {
      git: false,
      velocityStats: {
        machine: {},
        board: {},
        handoff: {},
        commit: { available: false },
        runtime: {},
        agentRuns: {},
        ceremony: {},
      },
      performanceWatchdog: {
        available: false,
        criticalEvents: [],
        safeModeEvents: [],
        persistedEventCount: 0,
        thresholdSummary: {},
        summary: "performance-watchdog: config=missing",
      },
    });

    assert.equal(report.recommendation, "block-and-clean");
    assert.ok(report.signals.some((signal) => signal.code === "invalid-runtime-shell-path"));
    assert.deepEqual(computeStrictFailures(report), ["invalid-runtime-shell-path"]);
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
        boardWarnMb: 999,
        memoryWarnUsedPct: 101,
        diskWarnFreeMb: 0,
        handoffWarnMinutes: 999_999,
        usefulCommitWarnMinutes: 999_999,
      },
      velocityStats: {
        machine: { memory: { usedPct: 0, freeMb: 999 }, disk: { available: true, freeMb: 999_999, usedPct: 0 } },
        board: { exists: false },
        handoff: { exists: false },
        commit: { available: false },
        agentRuns: { available: true, activeCount: 0, danglingProcessCount: 0 },
        ceremony: { available: false },
        runtime: { processUptimeMinutes: 0 },
      },
    });

    assert.equal(report.recommendation, "new-session");
    assert.ok(report.signals.some((signal) => signal.code === "large-resume-session"));
    assert.equal(report.velocityPressure.severity, "warn");
    assert.equal(report.velocityPressure.recommendation, "continue-with-bounded-slices");
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

test("buildPiDevPressureReport surfaces sensitive watchdog threshold externally", () => {
  const cwd = makeWorkspace();
  try {
    const report = buildPiDevPressureReport(cwd, {
      git: false,
      performanceWatchdog: {
        available: true,
        criticalEvents: [],
        safeModeEvents: [],
        persistedEventCount: 0,
        thresholdSummary: {
          eventLoopMaxMs: 300,
          eventLoopP99Ms: 150,
        },
        summary: "performance-watchdog: config=present eventLoopMaxMs=300 eventLoopP99Ms=150 persistedEvents=0 liveEventLoopExternal=no",
      },
      velocityStats: {
        machine: {},
        board: {},
        handoff: {},
        commit: { available: false },
        runtime: {},
        agentRuns: {},
        ceremony: {},
      },
    });

    assert.ok(report.signals.some((signal) => signal.code === "sensitive-performance-watchdog-max-threshold"));
    assert.equal(report.performanceWatchdog.thresholdSummary.eventLoopMaxMs, 300);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("buildDevelopmentVelocityPressure keeps clean sessions in continue mode", () => {
  const pressure = buildDevelopmentVelocityPressure({ signals: [] });

  assert.equal(pressure.severity, "ok");
  assert.equal(pressure.score, 0);
  assert.equal(pressure.recommendation, "continue");
  assert.deepEqual(pressure.stopConditions, []);
});

test("buildDevelopmentVelocityPressure pauses when pressure accumulates across warnings", () => {
  const pressure = buildDevelopmentVelocityPressure({
    signals: [
      { level: "warn", code: "heavy-configured-extension-entrypoint" },
      { level: "warn", code: "wide-dirty-scope" },
    ],
  });

  assert.equal(pressure.severity, "pause");
  assert.equal(pressure.score, 70);
  assert.equal(pressure.recommendation, "checkpoint-and-reduce-pressure");
  assert.deepEqual(pressure.stopConditions, [
    "checkpoint-before-more-work",
    "reduce-runtime-surface",
  ]);
});

test("buildDevelopmentVelocityPressure blocks huge resume sessions", () => {
  const pressure = buildDevelopmentVelocityPressure({
    signals: [
      { level: "block", code: "huge-resume-session" },
    ],
  });

  assert.equal(pressure.severity, "block");
  assert.equal(pressure.recommendation, "stop-and-clean-before-continuing");
  assert.deepEqual(pressure.stopConditions, [
    "block-signal-present",
    "checkpoint-before-more-work",
    "avoid-resume-heavy-session",
  ]);
});

test("buildVelocityPressureSignals classifies local-first velocity pressure inputs", () => {
  const signals = buildVelocityPressureSignals({
    machine: {
      memory: { usedPct: 90, freeMb: 512 },
      disk: { available: true, freeMb: 2048, usedPct: 95 },
    },
    board: { exists: true, path: ".project/tasks.json", mb: 2 },
    handoff: { exists: true, ageMinutes: 1500 },
    commit: { available: true, minutesSinceUsefulCommit: 300 },
    runtime: { processUptimeMinutes: 400 },
    agentRuns: { available: true, activeCount: 2, danglingProcessCount: 1 },
    ceremony: { available: true, toolCallsSinceUsefulCommit: 45, boardReadCount: 9, slowToolCount: 3 },
  }, {
    memoryWarnUsedPct: 85,
    memoryBlockUsedPct: 96,
    diskWarnFreeMb: 10_240,
    diskBlockFreeMb: 1024,
    boardWarnMb: 1,
    handoffWarnMinutes: 1440,
    usefulCommitWarnMinutes: 240,
    processAgeWarnMinutes: 360,
    danglingProcessWarn: 1,
    ceremonyToolCallWarn: 40,
    ceremonyBoardReadWarn: 8,
  });

  assert.deepEqual(signals.map((signal) => signal.code), [
    "machine-memory-pressure",
    "machine-disk-pressure",
    "large-board-state",
    "stale-handoff",
    "stale-useful-commit",
    "long-dev-process",
    "dangling-agent-run-process",
    "excessive-control-plane-ceremony",
  ]);
});

test("collectAgentRunPressureStats reports stale active runs as dangling", () => {
  const cwd = makeWorkspace();
  try {
    const reports = join(cwd, ".pi", "reports");
    mkdirSync(reports, { recursive: true });
    writeJson(join(reports, "agent-runs.json"), {
      runs: [
        {
          runId: "active-fresh",
          state: "running",
          timeoutMs: 90_000,
          lastEventAtIso: "2026-05-19T05:00:00.000Z",
        },
        {
          runId: "active-stale",
          state: "running",
          timeoutMs: 90_000,
          lastEventAtIso: "2026-05-19T04:00:00.000Z",
        },
        {
          runId: "completed-stale",
          state: "completed",
          timeoutMs: 90_000,
          lastEventAtIso: "2026-05-19T04:00:00.000Z",
        },
      ],
    });

    const stats = collectAgentRunPressureStats(cwd, Date.parse("2026-05-19T05:01:00.000Z"));

    assert.equal(stats.activeCount, 2);
    assert.equal(stats.danglingProcessCount, 1);
    assert.deepEqual(stats.danglingRunIds, ["active-stale"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
