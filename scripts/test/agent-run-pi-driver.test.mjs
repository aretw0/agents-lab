import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runPiDriver } from "../agent-run-pi-driver.mjs";

function writeFakePi(cwd) {
  const cliPath = path.join(cwd, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  mkdirSync(path.dirname(cliPath), { recursive: true });
  writeFileSync(cliPath, "console.error('fake pi help')\n", "utf8");
  writeFileSync(path.join(cwd, "package.json"), "{}\n", "utf8");
  writeFileSync(path.join(cwd, "README.md"), "fixture\n", "utf8");
  return cliPath;
}

test("pi driver previews help without dispatch by default", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-driver-preview-"));
  writeFakePi(cwd);

  const result = await runPiDriver({ cwd, mode: "help", runId: "pi-driver-preview" });

  assert.equal(result.mode, "agent-run-pi-driver");
  assert.equal(result.decision, "ready-for-operator-decision");
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.driverStep.processStartAllowed, false);
});

test("pi driver blocks execute without approval", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-driver-no-approval-"));
  writeFakePi(cwd);

  const result = await runPiDriver({ cwd, mode: "help", runId: "pi-driver-no-approval", execute: true });

  assert.equal(result.decision, "blocked");
  assert.equal(result.dispatchAllowed, false);
  assert.ok(result.driverStep.blockers.includes("structured-operator-approval-missing"));
});

test("pi driver executes approved local help and materializes outcome", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-driver-execute-"));
  writeFakePi(cwd);

  const result = await runPiDriver({
    cwd,
    mode: "help",
    runId: "pi-driver-execute",
    execute: true,
    approve: true,
    follow: true,
    buildOutcome: true,
  });

  assert.equal(result.decision, "dispatched");
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.driverStep.follow.terminal, true);
  assert.equal(result.driverStep.follow.status.state, "completed");
  assert.equal(result.driverStep.agentRunOutcomePacket.contractDecision, "pass");

  const registry = JSON.parse(readFileSync(path.join(cwd, ".pi", "reports", "agent-runs.json"), "utf8"));
  assert.equal(registry.runs[0].state, "completed");
});

test("pi driver previews print-readonly payload without provider execution", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-driver-print-preview-"));
  const cliPath = writeFakePi(cwd);

  const result = await runPiDriver({
    cwd,
    mode: "print-readonly",
    runId: "pi-driver-print-preview",
    model: "local/test-model",
    files: ["README.md"],
    prompt: "Return PASS.",
  });

  assert.equal(result.decision, "ready-for-operator-decision");
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.payloadPacket.payloadMode, "print-readonly");
  assert.deepEqual(result.driverStep.runSpec.executionPreview.args, [
    cliPath,
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--model",
    "local/test-model",
    "--tools",
    "read,grep,find,ls",
    "--print",
    "@README.md",
    "Return PASS.",
  ]);
});
