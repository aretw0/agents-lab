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

function makeWorkspace({
  version = "0.7.0",
  tasks = [],
  agentRunDriverScript = "node --test scripts/test/agent-run-driver-step.test.mjs scripts/test/agent-run-pi-driver.test.mjs scripts/test/agent-run-pi-driver-payload.test.mjs",
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "release-readiness-"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({
    scripts: {
      "test:agent-run:drivers": agentRunDriverScript,
    },
  }, null, 2));
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
      { id: "TASK-D", status: "planned", priority: "p0", description: "blocked by dep", depends_on: ["TASK-C"] },
      { id: "TASK-C", status: "blocked", priority: "p1", description: "blocked p1" },
    ],
  });

  try {
    const summary = summarizeBoard(workspace);
    assert.equal(summary.releaseReady, false);
    assert.deepEqual(summary.blockers, ["open-p0=2", "in-progress=1", "blocked=1"]);
    assert.equal(summary.byStatus["in-progress"], 1);
    assert.equal(summary.p0Ready.length, 1);
    assert.equal(summary.p0BlockedByDependency.length, 1);
    assert.match(summary.p0BlockedByDependency[0], /blockedBy=TASK-C/);
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
    assert.match(report.markdown, /\[x\] agent-run-driver-gate/);
    assert.match(report.markdown, /## Release Blockers/);
    assert.match(report.markdown, /target-version-ready \[operator-decision\]: target=v0\.8\.0/);
    assert.match(report.markdown, /board-release-clear \[board-state\]: open-p0=1/);
    assert.match(report.markdown, /agent-run-pi-driver-payload\.test\.mjs/);
    assert.match(report.markdown, /TASK-P0 \[p0\/planned\]/);
    assert.match(report.markdown, /### P0 Ready To Start/);
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
    assert.match(report.markdown, /\[x\] agent-run-driver-gate/);
    assert.match(report.markdown, /\[x\] board-release-clear/);
    assert.match(report.markdown, /## Release Blockers\n- none/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("buildReport lists local-safe evidence candidates without clearing the board gate", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [
      {
        id: "TASK-BUD-521",
        status: "in_progress",
        priority: "p3",
        description: "external isolation influence",
      },
    ],
  });
  const evidencePath = path.join(workspace, "docs", "research", "task-bud-521-local-isolation-canary-2026-06.md");
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, "# canary\n");

  try {
    const report = buildReport(gather("0.8.0", workspace));
    assert.equal(report.ready, false);
    assert.match(report.markdown, /\[ \] board-release-clear/);
    assert.match(report.markdown, /board-release-clear \[board-state\]: in-progress=1/);
    assert.match(report.markdown, /### Board Evidence Candidates/);
    assert.match(report.markdown, /TASK-BUD-521 \[p3\/in-progress\]/);
    assert.match(report.markdown, /external-influence-isolation/);
    assert.match(report.markdown, /task-bud-521-local-isolation-canary-2026-06\.md/);
    assert.match(report.markdown, /operator-may-park-for-0\.8/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("agent-run driver gate requires the full driver suite script", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
    agentRunDriverScript: "node --test scripts/test/agent-run-driver-step.test.mjs",
  });

  try {
    const report = buildReport(gather("0.8.0", workspace));
    assert.equal(report.ready, false);
    assert.match(report.markdown, /\[ \] agent-run-driver-gate/);
    assert.match(report.markdown, /agent-run-driver-gate \[technical-gate\]/);
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
