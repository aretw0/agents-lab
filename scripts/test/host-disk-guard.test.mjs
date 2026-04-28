import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { computeDiskGuardStrictFailures, planDiskGuard } from "../host-disk-guard.mjs";

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function defaultOpts(overrides = {}) {
  return {
    json: false,
    apply: false,
    includeSessions: false,
    includeGlobalSessions: false,
    keepRecentSessions: 20,
    sessionAgeDays: 7,
    reportsAgeDays: 14,
    maxDeleteMb: 2048,
    warnFreeMb: 1024,
    blockFreeMb: 512,
    strict: false,
    strictOn: "block-long-run",
    classes: ["bg-artifact", "pi-report", "session-jsonl", "global-session-jsonl"],
    help: false,
    ...overrides,
  };
}

function encodeSessionNamespaceFromPath(inputPath) {
  const normalized = String(inputPath || "").replace(/\\/g, "/");
  const win = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (win) {
    const drive = win[1].toUpperCase();
    const rest = win[2].split("/").filter(Boolean).join("-");
    return `--${drive}--${rest}--`;
  }
  const mntWin = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(normalized);
  if (mntWin) {
    const drive = mntWin[1].toUpperCase();
    const rest = mntWin[2].split("/").filter(Boolean).join("-");
    return `--${drive}--${rest}--`;
  }
  const unix = normalized.split("/").filter(Boolean).join("-");
  return `--${unix}--`;
}

test("planDiskGuard keeps sessions protected by default", () => {
  const cwd = mkdtempSync(join(tmpdir(), "disk-guard-test-"));
  try {
    const reportsDir = join(cwd, ".pi", "reports");
    const sessionsDir = join(cwd, ".sandbox", "pi-agent", "sessions", "w1");
    mkdirSync(reportsDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });

    const oldReport = join(reportsDir, "old-report.json");
    const oldSession = join(sessionsDir, "old-session.jsonl");
    writeFileSync(oldReport, "{}\n", "utf8");
    writeFileSync(oldSession, "{}\n", "utf8");

    const oldDate = daysAgo(21);
    utimesSync(oldReport, oldDate, oldDate);
    utimesSync(oldSession, oldDate, oldDate);

    const report = planDiskGuard(cwd, defaultOpts({ keepRecentSessions: 0 }));

    const paths = report.deletable.map((row) => row.path);
    assert.ok(paths.includes(".pi/reports/old-report.json"));
    assert.ok(!paths.some((p) => p.endsWith("old-session.jsonl")));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("planDiskGuard class filter can isolate bg artifacts", () => {
  const cwd = mkdtempSync(join(tmpdir(), "disk-guard-test-"));
  try {
    const reportsDir = join(cwd, ".pi", "reports");
    mkdirSync(reportsDir, { recursive: true });
    const oldReport = join(reportsDir, "old-report.json");
    writeFileSync(oldReport, "{}\n", "utf8");
    const oldDate = daysAgo(21);
    utimesSync(oldReport, oldDate, oldDate);

    const report = planDiskGuard(cwd, defaultOpts({ classes: ["bg-artifact"] }));
    const reportRows = report.deletable.filter((row) => row.class === "pi-report");
    assert.equal(reportRows.length, 0);
    assert.ok(report.candidateSummary.byClass);
    assert.ok(Array.isArray(report.candidateSummary.byClass.protected));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("planDiskGuard can include old global workspace sessions when explicitly enabled", () => {
  const cwd = mkdtempSync(join(tmpdir(), "disk-guard-test-"));
  const fakeHome = mkdtempSync(join(tmpdir(), "disk-guard-home-"));
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  try {
    const namespace = encodeSessionNamespaceFromPath(cwd);
    const globalDir = join(fakeHome, ".pi", "agent", "sessions", namespace);
    mkdirSync(globalDir, { recursive: true });

    const oldGlobalSession = join(globalDir, "old-global.jsonl");
    writeFileSync(oldGlobalSession, "{}\n", "utf8");
    const oldDate = daysAgo(21);
    utimesSync(oldGlobalSession, oldDate, oldDate);

    const report = planDiskGuard(cwd, defaultOpts({
      classes: ["global-session-jsonl"],
      includeGlobalSessions: true,
      keepRecentSessions: 0,
      sessionAgeDays: 14,
    }));

    const globalRows = report.deletable.filter((row) => row.class === "global-session-jsonl");
    assert.equal(globalRows.length, 1);
    assert.ok(globalRows[0].path.endsWith("old-global.jsonl"));
  } finally {
    process.env.HOME = previousHome;
    process.env.USERPROFILE = previousUserProfile;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test("planDiskGuard includes old sessions when includeSessions=true", () => {
  const cwd = mkdtempSync(join(tmpdir(), "disk-guard-test-"));
  try {
    const sessionsDir = join(cwd, ".sandbox", "pi-agent", "sessions", "w1");
    mkdirSync(sessionsDir, { recursive: true });

    const oldSession = join(sessionsDir, "old-session.jsonl");
    writeFileSync(oldSession, "{}\n", "utf8");
    const oldDate = daysAgo(21);
    utimesSync(oldSession, oldDate, oldDate);

    const report = planDiskGuard(cwd, defaultOpts({ includeSessions: true, keepRecentSessions: 0 }));

    const paths = report.deletable.map((row) => row.path);
    assert.ok(paths.some((p) => p.endsWith("old-session.jsonl")));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("computeDiskGuardStrictFailures enforces deterministic strict thresholds", () => {
  const reportBlock = { disk: { severity: "block-long-run" } };
  const reportWarn = { disk: { severity: "warn" } };
  const reportOk = { disk: { severity: "ok" } };
  const reportUnknown = { disk: { severity: "unknown" } };

  assert.deepEqual(computeDiskGuardStrictFailures(reportBlock, defaultOpts({ strict: true })), ["disk-pressure-block-long-run"]);
  assert.deepEqual(computeDiskGuardStrictFailures(reportWarn, defaultOpts({ strict: true })), []);
  assert.deepEqual(computeDiskGuardStrictFailures(reportWarn, defaultOpts({ strict: true, strictOn: "warn" })), ["disk-pressure-warn"]);
  assert.deepEqual(computeDiskGuardStrictFailures(reportOk, defaultOpts({ strict: true, strictOn: "warn" })), []);
  assert.deepEqual(computeDiskGuardStrictFailures(reportUnknown, defaultOpts({ strict: true })), ["disk-severity-unknown"]);
  assert.deepEqual(computeDiskGuardStrictFailures(reportBlock, defaultOpts({ strict: false })), []);
});

test("planDiskGuard reports bounded workspace disk pressure", () => {
  const cwd = mkdtempSync(join(tmpdir(), "disk-guard-test-"));
  try {
    const report = planDiskGuard(cwd, defaultOpts());

    assert.ok(report.disk);
    assert.equal(typeof report.disk.freeMb, "number");
    assert.equal(typeof report.disk.usedPct, "number");
    assert.ok(["ok", "warn", "block-long-run", "unknown"].includes(report.disk.severity));
    assert.equal(typeof report.inventory.bgArtifactTotalMb, "number");
    assert.equal(typeof report.inventory.reportTotalMb, "number");
    assert.equal(typeof report.inventory.sessionTotalMb, "number");
    assert.equal(typeof report.inventory.globalSessionTotalMb, "number");
    assert.ok(Array.isArray(report.inventory.topGlobalSessions));
    assert.equal(report.disk.warnFreeMb, 1024);
    assert.equal(report.disk.blockFreeMb, 512);
    assert.ok(report.disk.recommendation.length > 0);
    assert.ok(Array.isArray(report.candidateSummary.byClass.deletable));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
