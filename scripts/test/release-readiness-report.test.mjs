import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildReport, gather, summarizeBoard } from "../release-readiness-report.mjs";

const PACKAGES = [
  "packages/pi-stack/package.json",
  "packages/git-skills/package.json",
  "packages/web-skills/package.json",
  "packages/pi-skills/package.json",
  "packages/lab-skills/package.json",
];

function makeWorkspace({ version = "0.7.0", tasks = [] } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "release-readiness-"));
  for (const relPath of PACKAGES) {
    const fullPath = path.join(root, relPath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, JSON.stringify({ version }, null, 2));
  }
  for (const workflow of ["ci.yml", "publish.yml", "release-draft.yml"]) {
    const fullPath = path.join(root, ".github", "workflows", workflow);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, "name: test\n");
  }
  mkdirSync(path.join(root, ".project"), { recursive: true });
  writeFileSync(path.join(root, ".project", "tasks.json"), JSON.stringify({ tasks }, null, 2));
  return root;
}

test("summarizeBoard normalizes active release blockers", () => {
  const workspace = makeWorkspace({
    tasks: [
      { id: "TASK-A", status: "completed", priority: "p0", description: "done" },
      { id: "TASK-B", status: "in_progress", priority: "p0", description: "active p0" },
      { id: "TASK-C", status: "blocked", priority: "p1", description: "blocked p1" },
    ],
  });

  try {
    const summary = summarizeBoard(workspace);
    assert.equal(summary.releaseReady, false);
    assert.deepEqual(summary.blockers, ["open-p0=1", "in-progress=1", "blocked=1"]);
    assert.equal(summary.byStatus["in-progress"], 1);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("buildReport marks target release not ready until version and board gates are clear", () => {
  const workspace = makeWorkspace({
    version: "0.7.0",
    tasks: [{ id: "TASK-P0", status: "planned", priority: "p0", description: "release blocker" }],
  });

  try {
    const report = buildReport(gather("0.8.0", workspace));
    assert.equal(report.ready, false);
    assert.match(report.markdown, /decision: not-ready/);
    assert.match(report.markdown, /\[ \] target-version-ready/);
    assert.match(report.markdown, /\[ \] board-release-clear/);
    assert.match(report.markdown, /TASK-P0 \[p0\/planned\]/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("buildReport marks release ready when versions and board gates are clear", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [{ id: "TASK-DONE", status: "completed", priority: "p0", description: "done" }],
  });

  try {
    const report = buildReport(gather("0.8.0", workspace));
    assert.equal(report.ready, true);
    assert.match(report.markdown, /decision: ready/);
    assert.match(report.markdown, /\[x\] target-version-ready/);
    assert.match(report.markdown, /\[x\] board-release-clear/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("cli strict exits non-zero when release is not ready", () => {
  const workspace = makeWorkspace({
    version: "0.7.0",
    tasks: [{ id: "TASK-P0", status: "planned", priority: "p0", description: "release blocker" }],
  });

  try {
    const result = spawnSync(process.execPath, [
      path.resolve("scripts/release-readiness-report.mjs"),
      "--target",
      "0.8.0",
      "--strict",
      "--out",
      path.join(workspace, "readiness.md"),
    ], {
      cwd: workspace,
      encoding: "utf8",
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /release-readiness-report: wrote/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
