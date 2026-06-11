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
  const args = buildContainerFanoutDockerArgs({
    container: "agents-lab-dev",
    manifestOutPath: ".artifacts\\agent-run-driver\\container-fanout-manifest.json",
    rehearsalOutPath: ".artifacts\\agent-run-driver\\container-fanout-rehearsal.json",
    batchId: "container-fanout-smoke",
    execute: true,
  });

  assert.deepEqual(args.slice(0, 7), [
    "exec",
    "--user",
    "root",
    "agents-lab-dev",
    "lab",
    "vscode",
    "/workspaces/agents-lab",
  ]);
  assert.equal(args[7], "sh");
  assert.equal(args[8], "-lc");
  assert.match(args[9], /agent-run-driver-fanout-manifest\.mjs/);
  assert.match(args[9], /agent-run-driver-fanout-rehearsal\.mjs/);
  assert.match(args[9], /--manifest/);
  assert.match(args[9], /container-fanout-manifest\.json/);
  assert.match(args[9], /container-fanout-rehearsal\.json/);
  assert.match(args[9], /&&/);
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
    assert.equal(report.manifestOutPath, ".artifacts/agent-run-driver/container-fanout-manifest.json");
    assert.equal(existsSync(path.join(cwd, ".artifacts/agent-run-driver/container-fanout-rehearsal-report.json")), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("container fanout rehearsal script documents the headless lab wrapper", () => {
  const script = readFileSync("scripts/agent-run-driver-container-fanout-rehearsal.mjs", "utf8");

  assert.match(script, /buildDockerExecArgs/);
  assert.match(script, /headless: true/);
  assert.match(script, /agent-run-driver-fanout-manifest\.mjs/);
  assert.match(script, /agent-run-driver-fanout-rehearsal\.mjs/);
});
