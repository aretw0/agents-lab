import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildPiDriverSummary, runPiDriver } from "../agent-run-pi-driver.mjs";

const cliPath = fileURLToPath(new URL("../agent-run-pi-driver.mjs", import.meta.url));

function writeFakePi(cwd) {
  const cliPath = path.join(cwd, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  mkdirSync(path.dirname(cliPath), { recursive: true });
  writeFileSync(cliPath, "console.error('fake pi help')\n", "utf8");
  writeFileSync(path.join(cwd, "package.json"), "{}\n", "utf8");
  writeFileSync(path.join(cwd, "README.md"), "fixture\n", "utf8");
  return cliPath;
}

function structuredApproval() {
  return {
    packet_mode: "operator-approval-packet",
    approved: true,
    approval_state: "approved",
  };
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

test("pi driver accepts explicit structured operator approval", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-driver-explicit-approval-"));
  writeFakePi(cwd);

  const result = await runPiDriver({
    cwd,
    mode: "help",
    runId: "pi-driver-explicit-approval",
    execute: true,
    operatorApproval: structuredApproval(),
    follow: true,
    buildOutcome: true,
  });

  assert.equal(result.decision, "dispatched");
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.driverStep.structuredOperatorApproval, true);
  assert.equal(result.driverStep.agentRunOutcomePacket.contractDecision, "pass");
});

test("pi driver CLI accepts structured operator approval file", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-driver-approval-file-"));
  writeFakePi(cwd);
  const approvalPath = path.join(cwd, "approval.json");
  writeFileSync(approvalPath, JSON.stringify(structuredApproval()), "utf8");

  const stdout = execFileSync(process.execPath, [
    cliPath,
    "--cwd",
    cwd,
    "--mode",
    "help",
    "--run-id",
    "pi-driver-approval-file",
    "--execute",
    "--operator-approval-file",
    approvalPath,
    "--follow",
    "--build-outcome",
    "--summary",
  ], { encoding: "utf8" });
  const summary = JSON.parse(stdout);

  assert.equal(summary.decision, "dispatched");
  assert.equal(summary.dispatchAllowed, true);
  assert.equal(summary.processStartAllowed, true);
  assert.equal(summary.contractDecision, "pass");
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
  assert.match(summary.driverStepSummary, /agent-run-driver-step: decision=dispatched/);
  assert.match(summary.driverStepSummary, /contract=pass/);
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
  assert.equal(result.payloadPacket.payload.run_spec.file_contract, "mutation");
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
