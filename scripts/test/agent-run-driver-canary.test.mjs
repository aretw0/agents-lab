import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runAgentRunDriverCanary } from "../agent-run-driver-canary.mjs";

const cliPath = fileURLToPath(new URL("../agent-run-driver-canary.mjs", import.meta.url));

function workspace(prefix) {
  const cwd = mkdtempSync(path.join(tmpdir(), prefix));
  writeFileSync(path.join(cwd, "package.json"), "{}\n", "utf8");
  return cwd;
}

test("agent-run driver canary previews without process start", async () => {
  const cwd = workspace("agent-run-driver-canary-preview-");
  const report = await runAgentRunDriverCanary({ cwd, execute: false });

  assert.equal(report.mode, "agent-run-driver-canary-report");
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.decision, "ready-for-operator-decision");
  assert.equal(report.dispatchAllowed, false);
  assert.equal(report.processStartAllowed, false);
  assert.equal(report.contractDecision, undefined);
  assert.match(report.summary, /dispatch=no/);
});

test("agent-run driver canary executes local node version and passes outcome", async () => {
  const cwd = workspace("agent-run-driver-canary-exec-");
  const report = await runAgentRunDriverCanary({ cwd, runId: "driver-canary-test" });

  assert.equal(report.mode, "agent-run-driver-canary-report");
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.decision, "dispatched");
  assert.equal(report.dispatchAllowed, true);
  assert.equal(report.processStartAllowed, true);
  assert.equal(report.followTerminal, true);
  assert.equal(report.followState, "completed");
  assert.equal(report.contractDecision, "pass");
  assert.deepEqual(report.blockers, []);
  assert.ok((report.outputBytes ?? 0) > 0);
});

test("agent-run driver canary supports bounded mutation evidence", async () => {
  const cwd = workspace("agent-run-driver-canary-mutation-");
  const report = await runAgentRunDriverCanary({
    cwd,
    runId: "driver-canary-mutation-test",
    mode: "mutation",
  });

  assert.equal(report.mode, "agent-run-driver-canary-report");
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.canaryMode, "mutation");
  assert.equal(report.decision, "dispatched");
  assert.equal(report.contractDecision, "pass");
  assert.equal(report.fileContract, "mutation");
  assert.deepEqual(report.touchedFiles, [".artifacts/agent-run-driver/mutation-target.txt"]);
  assert.deepEqual(report.mutationTargetFiles, [".artifacts/agent-run-driver/mutation-target.txt"]);
  assert.equal(existsSync(path.join(cwd, ".artifacts", "agent-run-driver", "mutation-target.txt")), true);
});

test("agent-run driver canary CLI writes latest artifact", () => {
  const cwd = workspace("agent-run-driver-canary-cli-");
  const outPath = ".artifacts/agent-run-driver/latest.json";
  const stdout = execFileSync(process.execPath, [
    cliPath,
    "--cwd",
    cwd,
    "--run-id",
    "driver-canary-cli",
    "--out",
    outPath,
  ], { encoding: "utf8" });
  const report = JSON.parse(stdout);
  const writtenPath = path.join(cwd, outPath);

  assert.equal(existsSync(writtenPath), true);
  assert.deepEqual(JSON.parse(readFileSync(writtenPath, "utf8")), report);
  assert.equal(report.contractDecision, "pass");
});
