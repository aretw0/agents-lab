import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPiDriverSummary, runPiDriver } from "../agent-run-pi-driver.mjs";

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

test("pi driver summary keeps compact execution evidence", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-driver-summary-"));
  writeFakePi(cwd);

  const result = await runPiDriver({
    cwd,
    mode: "help",
    runId: "pi-driver-summary",
    execute: true,
    approve: true,
    follow: true,
    buildOutcome: true,
  });
  const summary = buildPiDriverSummary(result);

  assert.equal(summary.mode, "agent-run-pi-driver-summary");
  assert.equal(summary.decision, "dispatched");
  assert.equal(summary.dispatchAllowed, true);
  assert.equal(summary.processStartAllowed, true);
  assert.equal(summary.runId, "pi-driver-summary");
  assert.equal(summary.payloadMode, "help");
  assert.equal(summary.followTerminal, true);
  assert.equal(summary.followState, "completed");
  assert.equal(summary.contractDecision, "pass");
  assert.equal(summary.fileContract, "read-only");
  assert.ok(summary.outputBytes > 0);
  assert.ok(Array.isArray(summary.logTail));
});

test("pi driver forwards mutation outcome evidence to the headless driver", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-driver-mutation-evidence-"));
  writeFakePi(cwd);

  const result = await runPiDriver({
    cwd,
    mode: "help",
    runId: "pi-driver-mutation-evidence",
    fileContract: "mutation",
    touchedFiles: ["README.md"],
    mutationTargetFiles: ["README.md"],
    markerResults: [{ label: "acceptance", ok: true }],
    execute: true,
    approve: true,
    follow: true,
    buildOutcome: true,
  });
  const summary = buildPiDriverSummary(result);

  assert.equal(result.driverStep.runSpec.fileContract, "mutation");
  assert.equal(result.driverStep.nextAgentRunOutcomePacket.params.file_contract, "mutation");
  assert.deepEqual(result.driverStep.nextAgentRunOutcomePacket.params.touched_files, ["README.md"]);
  assert.deepEqual(result.driverStep.nextAgentRunOutcomePacket.params.mutation_target_files, ["README.md"]);
  assert.deepEqual(result.driverStep.nextAgentRunOutcomePacket.params.marker_results, [{ label: "acceptance", ok: true }]);
  assert.equal(result.driverStep.agentRunOutcomePacket.contractDecision, "pass");
  assert.equal(result.driverStep.agentRunOutcomePacket.fileContract, "mutation");
  assert.equal(summary.fileContract, "mutation");
  assert.equal(summary.touchedFileCount, 1);
  assert.equal(summary.markerFailureCount, 0);
});

test("pi driver summary reports blockers compactly", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-driver-summary-blocked-"));
  writeFakePi(cwd);

  const result = await runPiDriver({ cwd, mode: "help", runId: "pi-driver-summary-blocked", execute: true });
  const summary = buildPiDriverSummary(result);

  assert.equal(summary.decision, "blocked");
  assert.equal(summary.dispatchAllowed, false);
  assert.ok(summary.blockers.includes("structured-operator-approval-missing"));
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
