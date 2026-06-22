import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReport, writeReport } from "../contract/report.mjs";

const results = [
  { taskId: "a", tier: "T0", attempts: 2, passes: 2, passRate: 1, outcomes: [] },
  { taskId: "b", tier: "T0", attempts: 2, passes: 1, passRate: 0.5, outcomes: [] },
  { taskId: "c", tier: "T1", attempts: 1, passes: 0, passRate: 0, outcomes: [] },
];

test("buildReport aggregates summary and per-tier rollup", () => {
  const report = buildReport(results, { generatedAtIso: "2026-06-22T00:00:00.000Z" });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.generatedAtIso, "2026-06-22T00:00:00.000Z");
  assert.equal(report.summary.tasks, 3);
  assert.equal(report.summary.passRate, (1 + 0.5 + 0) / 3);
  assert.deepEqual(report.summary.byTier.T0, { tasks: 2, passes: 3, attempts: 4 });
  assert.deepEqual(report.summary.byTier.T1, { tasks: 1, passes: 0, attempts: 1 });
});

test("writeReport persists JSON to a created directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "eval-report-"));
  try {
    const path = join(dir, "nested", "report.json");
    const report = buildReport(results, { generatedAtIso: "2026-06-22T00:00:00.000Z" });
    const written = writeReport(report, path);
    assert.equal(written, path);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(parsed.summary.tasks, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
