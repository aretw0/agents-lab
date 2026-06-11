import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildContainerCanaryDockerArgs,
  runAgentRunDriverContainerCanarySuite,
} from "../agent-run-driver-container-canary-suite.mjs";

function workspace(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

test("container canary suite builds a headless devcontainer command", () => {
  assert.deepEqual(
    buildContainerCanaryDockerArgs({
      container: "agents-lab-dev",
      suiteOutPath: ".artifacts\\agent-run-driver\\container-suite.json",
      execute: true,
    }),
    [
      "exec",
      "--user",
      "root",
      "agents-lab-dev",
      "lab",
      "vscode",
      "/workspaces/agents-lab",
      "node",
      "scripts/agent-run-driver-canary-suite.mjs",
      "--execute",
      "--out",
      ".artifacts/agent-run-driver/container-suite.json",
    ],
  );
});

test("container canary suite blocks without a container name and does not write reports", () => {
  const cwd = workspace("agent-run-driver-container-canary-missing-");
  try {
    const report = runAgentRunDriverContainerCanarySuite({ cwd, container: "" });

    assert.equal(report.mode, "agent-run-driver-container-canary-suite-report");
    assert.equal(report.decision, "block");
    assert.deepEqual(report.blockers, ["container-missing"]);
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.equal(existsSync(path.join(cwd, ".artifacts/agent-run-driver/container-suite-report.json")), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("container canary suite script documents the headless lab wrapper", () => {
  const script = readFileSync("scripts/agent-run-driver-container-canary-suite.mjs", "utf8");

  assert.match(script, /buildDockerExecArgs/);
  assert.match(script, /headless: true/);
  assert.match(script, /agent-run-driver-canary-suite\.mjs/);
});
