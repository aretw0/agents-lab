import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runAgentRunDriverCanarySuite } from "../agent-run-driver-canary-suite.mjs";

const cliPath = fileURLToPath(new URL("../agent-run-driver-canary-suite.mjs", import.meta.url));

function workspace(prefix) {
  const cwd = mkdtempSync(path.join(tmpdir(), prefix));
  writeFileSync(path.join(cwd, "package.json"), "{}\n", "utf8");
  return cwd;
}

test("agent-run driver canary suite previews both canaries without dispatch", async () => {
  const cwd = workspace("agent-run-driver-canary-suite-preview-");
  const report = await runAgentRunDriverCanarySuite({ cwd, execute: false });

  assert.equal(report.mode, "agent-run-driver-canary-suite-report");
  assert.equal(report.schemaVersion, 1);
  assert.match(report.generatedAtIso, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(report.gitHead, "");
  assert.equal(report.decision, "block");
  assert.equal(report.executeRequested, false);
  assert.equal(report.dispatchAllowed, false);
  assert.equal(report.processStartAllowed, false);
  assert.deepEqual(report.blockers, ["read-only-canary-not-pass", "mutation-canary-not-pass"]);
  assert.equal(report.canaries.readOnly.decision, "ready-for-operator-decision");
  assert.equal(report.canaries.mutation.decision, "ready-for-operator-decision");
});

test("agent-run driver canary suite executes read-only and mutation evidence", async () => {
  const cwd = workspace("agent-run-driver-canary-suite-exec-");
  const report = await runAgentRunDriverCanarySuite({ cwd });

  assert.equal(report.mode, "agent-run-driver-canary-suite-report");
  assert.equal(report.schemaVersion, 1);
  assert.match(report.generatedAtIso, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(report.gitHead, "");
  assert.equal(report.decision, "pass");
  assert.equal(report.dispatchAllowed, true);
  assert.equal(report.processStartAllowed, true);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.canaries.readOnly.contractDecision, "pass");
  assert.equal(report.canaries.mutation.contractDecision, "pass");
  assert.equal(report.canaries.mutation.fileContract, "mutation");
  assert.equal(existsSync(path.join(cwd, report.outputs.readOnly)), true);
  assert.equal(existsSync(path.join(cwd, report.outputs.mutation)), true);
});

test("agent-run driver canary suite CLI writes suite artifact", () => {
  const cwd = workspace("agent-run-driver-canary-suite-cli-");
  const outPath = ".artifacts/agent-run-driver/suite.json";
  const stdout = execFileSync(process.execPath, [
    cliPath,
    "--cwd",
    cwd,
    "--out",
    outPath,
  ], { encoding: "utf8" });
  const report = JSON.parse(stdout);
  const writtenPath = path.join(cwd, outPath);

  assert.equal(existsSync(writtenPath), true);
  assert.deepEqual(JSON.parse(readFileSync(writtenPath, "utf8")), report);
  assert.match(report.generatedAtIso, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(report.gitHead, "");
  assert.equal(report.decision, "pass");
});
