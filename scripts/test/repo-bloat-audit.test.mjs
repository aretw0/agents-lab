import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyTrackedBloat,
  normalizeRepoPath,
} from "../repo-bloat-audit.mjs";

test("normalizeRepoPath normalizes separators and leading dot", () => {
  assert.equal(normalizeRepoPath(".\\docs\\research\\data\\run\\raw\\a.log"), "docs/research/data/run/raw/a.log");
});

test("classifyTrackedBloat blocks raw research logs", () => {
  const report = classifyTrackedBloat([
    { path: "docs/research/data/web-benchmark/run/raw/A1.log", bytes: 10 },
    { path: "docs/research/data/web-benchmark/run/results.json", bytes: 10 },
  ]);

  assert.deepEqual(report.violations.map((row) => row.reason), ["tracked-raw-research-log"]);
});

test("classifyTrackedBloat blocks large tracked research data", () => {
  const report = classifyTrackedBloat([
    { path: "docs/research/data/run/results.json", bytes: 2 * 1024 * 1024 },
  ]);

  assert.deepEqual(report.violations.map((row) => row.reason), ["tracked-large-research-data"]);
});

test("classifyTrackedBloat blocks generated Jekyll site output", () => {
  const report = classifyTrackedBloat([
    { path: "docs/_site/index.html", bytes: 10 },
    { path: ".jekyll-cache/Jekyll/Cache/foo", bytes: 10 },
    { path: ".sass-cache/foo.scssc", bytes: 10 },
  ]);

  assert.deepEqual(report.violations.map((row) => row.reason), [
    "tracked-generated-site-output",
    "tracked-generated-site-output",
    "tracked-generated-site-output",
  ]);
});

test("classifyTrackedBloat warns on large canonical board files without blocking", () => {
  const report = classifyTrackedBloat([
    { path: ".project/tasks.json", bytes: 2 * 1024 * 1024 },
  ]);

  assert.equal(report.violations.length, 0);
  assert.deepEqual(report.warnings.map((row) => row.reason), ["large-canonical-board-file"]);
});
