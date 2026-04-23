import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { planDiskGuard } from "../host-disk-guard.mjs";

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
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

    const report = planDiskGuard(cwd, {
      json: false,
      apply: false,
      includeSessions: false,
      keepRecentSessions: 0,
      sessionAgeDays: 7,
      reportsAgeDays: 14,
      maxDeleteMb: 2048,
      help: false,
    });

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

    const report = planDiskGuard(cwd, {
      json: false,
      apply: false,
      includeSessions: true,
      keepRecentSessions: 0,
      sessionAgeDays: 7,
      reportsAgeDays: 14,
      maxDeleteMb: 2048,
      help: false,
    });

    const paths = report.deletable.map((row) => row.path);
    assert.ok(paths.some((p) => p.endsWith("old-session.jsonl")));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
