import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { planDiskGuard } from "../host-disk-guard.mjs";

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function defaultOpts(overrides = {}) {
  return {
    json: false,
    apply: false,
    includeSessions: false,
    keepRecentSessions: 20,
    sessionAgeDays: 7,
    reportsAgeDays: 14,
    maxDeleteMb: 2048,
    warnFreeMb: 1024,
    blockFreeMb: 512,
    help: false,
    ...overrides,
  };
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
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
