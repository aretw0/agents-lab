import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildContainerFanoutDockerArgs,
  runAgentRunDriverContainerFanoutRehearsal,
} from "../agent-run-driver-container-fanout-rehearsal.mjs";

function workspace(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

test("container fanout rehearsal builds a headless devcontainer command", () => {
  assert.deepEqual(
    buildContainerFanoutDockerArgs({
      container: "agents-lab-dev",
      rehearsalOutPath: ".artifacts\\agent-run-driver\\container-fanout-rehearsal.json",
      batchId: "container-fanout-smoke",
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
      "scripts/agent-run-driver-fanout-rehearsal.mjs",
      "--execute",
      "--batch-id",
      "container-fanout-smoke",
      "--out",
      ".artifacts/agent-run-driver/container-fanout-rehearsal.json",
    ],
  );
});

test("container fanout rehearsal blocks without a container name and does not write reports", () => {
  const cwd = workspace("agent-run-driver-container-fanout-missing-");
  try {
    const report = runAgentRunDriverContainerFanoutRehearsal({ cwd, container: "" });

    assert.equal(report.mode, "agent-run-driver-container-fanout-rehearsal-report");
    assert.equal(report.decision, "block");
    assert.deepEqual(report.blockers, ["container-missing"]);
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.equal(existsSync(path.join(cwd, ".artifacts/agent-run-driver/container-fanout-rehearsal-report.json")), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("container fanout rehearsal script documents the headless lab wrapper", () => {
  const script = readFileSync("scripts/agent-run-driver-container-fanout-rehearsal.mjs", "utf8");

  assert.match(script, /buildDockerExecArgs/);
  assert.match(script, /headless: true/);
  assert.match(script, /agent-run-driver-fanout-rehearsal\.mjs/);
});
