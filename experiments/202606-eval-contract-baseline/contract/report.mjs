import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Aggregate task results into a dated, tier-rolled report.
 * @param {Array<object>} results
 * @param {object} [opts]
 * @param {string} [opts.generatedAtIso]
 */
export function buildReport(results, { generatedAtIso = new Date().toISOString() } = {}) {
  const byTier = {};
  for (const r of results) {
    const bucket = (byTier[r.tier] ??= { tasks: 0, passes: 0, attempts: 0 });
    bucket.tasks += 1;
    bucket.passes += r.passes;
    bucket.attempts += r.attempts;
  }
  const passRate = results.length ? results.reduce((acc, r) => acc + r.passRate, 0) / results.length : 0;
  return { schemaVersion: 1, generatedAtIso, results, summary: { tasks: results.length, passRate, byTier } };
}

/** Write a report as pretty JSON, creating parent dirs. @returns {string} the path. */
export function writeReport(report, path) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2));
  return path;
}
