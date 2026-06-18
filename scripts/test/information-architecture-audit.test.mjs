import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInformationArchitectureReport,
  computeIndexCoverage,
  formatInformationArchitectureReport,
} from "../information-architecture-audit.mjs";

test("computeIndexCoverage reports indexed, unindexed and stale markdown mentions", () => {
  const coverage = computeIndexCoverage(
    ["README.md", "a.md", "b.md"],
    "- [a.md](a.html)\n- [missing.md](missing.html)",
  );

  assert.equal(coverage.expectedCount, 2);
  assert.deepEqual(coverage.indexed, ["a.md"]);
  assert.deepEqual(coverage.unindexed, ["b.md"]);
  assert.deepEqual(coverage.staleMentions, ["missing.md"]);
});

test("computeIndexCoverage excludes explicitly retained unfeatured docs", () => {
  const coverage = computeIndexCoverage(
    ["README.md", "a.md", "draft.md"],
    "- [a.md](a.html)",
    { retained: ["draft.md"] },
  );

  assert.equal(coverage.expectedCount, 1);
  assert.deepEqual(coverage.indexed, ["a.md"]);
  assert.deepEqual(coverage.unindexed, []);
});

test("information architecture audit has no missing entrypoint blockers in this repo", () => {
  const report = buildInformationArchitectureReport(process.cwd());

  assert.notEqual(report.decision, "blocked");
  assert.equal(report.blockers.length, 0);
  assert.match(report.summary, /information-architecture-audit:/);
  assert.match(formatInformationArchitectureReport(report), /guides indexed:/);
});
