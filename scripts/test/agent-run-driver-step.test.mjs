import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runAgentRunDriverStep } from "../agent-run-driver-step.mjs";

function structuredApproval() {
  return {
    packet_mode: "operator-approval-packet",
    approved: true,
    approval_state: "approved",
  };
}

function payload(cwd = ".") {
  return {
    run_spec: {
      run_id: "headless-driver-step-node-version",
      provider_model_ref: "local/process",
      cwd,
      declared_files: ["README.md"],
      log_path: ".pi/reports/headless-driver-step-node-version.log",
      timeout_ms: 30_000,
      execution_preview: {
        command: "node",
        args: ["--version"],
      },
    },
  };
}

test("headless driver step previews without dispatch", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-preview-"));
  const result = await runAgentRunDriverStep(payload(), cwd);

  assert.equal(result.mode, "agent-run-driver-step-packet");
  assert.equal(result.decision, "ready-for-operator-decision");
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.processStartAllowed, false);
});

test("headless driver step blocks execute without structured approval", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-approval-"));
  const result = await runAgentRunDriverStep({ ...payload(), execute: true }, cwd);

  assert.equal(result.mode, "agent-run-driver-step-dispatch");
  assert.equal(result.decision, "blocked");
  assert.equal(result.dispatchAllowed, false);
  assert.ok(result.blockers.includes("structured-operator-approval-missing"));
});

test("headless driver step blocks duplicate running run", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-running-"));
  const registryDir = path.join(cwd, ".pi", "reports");
  mkdirSync(registryDir, { recursive: true });
  writeFileSync(path.join(registryDir, "agent-runs.json"), JSON.stringify({
    runs: [{ runId: "headless-driver-step-node-version", state: "running", pid: 1234 }],
  }), "utf8");

  const result = await runAgentRunDriverStep({
    ...payload(),
    execute: true,
    operator_approval: structuredApproval(),
  }, cwd);

  assert.equal(result.decision, "blocked");
  assert.equal(result.dispatchAllowed, false);
  assert.ok(result.blockers.includes("run-already-running"));
});

test("headless driver step blocks cwd mismatch before dispatch", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-cwd-"));
  const otherCwd = mkdtempSync(path.join(tmpdir(), "headless-driver-other-cwd-"));
  const result = await runAgentRunDriverStep({
    ...payload(otherCwd),
    execute: true,
    operator_approval: structuredApproval(),
  }, cwd);

  assert.equal(result.decision, "blocked");
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.processStartAllowed, false);
  assert.ok(result.blockers.includes("execute-cwd-mismatch"));
});

test("headless driver step executes local process and materializes outcome", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-exec-"));
  writeFileSync(path.join(cwd, "README.md"), "fixture\n", "utf8");
  const result = await runAgentRunDriverStep({
    ...payload(),
    execute: true,
    operator_approval: structuredApproval(),
    follow: true,
    build_outcome: true,
    follow_max_wait_ms: 5_000,
  }, cwd);

  assert.equal(result.mode, "agent-run-driver-step-dispatch");
  assert.equal(result.decision, "dispatched");
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.follow?.terminal, true);
  assert.equal(result.follow?.status.state, "completed");
  assert.ok((result.follow?.outputBytes ?? 0) > 0);
  assert.equal(result.agentRunOutcomePacket?.mode, "agent-run-outcome-packet");
  assert.equal(result.agentRunOutcomePacket?.contractDecision, "pass");

  const registry = JSON.parse(readFileSync(path.join(cwd, ".pi", "reports", "agent-runs.json"), "utf8"));
  assert.equal(registry.runs[0].state, "completed");
});

test("headless driver step records timed-out runs distinctly", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-timeout-"));
  writeFileSync(path.join(cwd, "README.md"), "fixture\n", "utf8");
  const result = await runAgentRunDriverStep({
    run_spec: {
      ...payload().run_spec,
      run_id: "headless-driver-step-timeout",
      log_path: ".pi/reports/headless-driver-step-timeout.log",
      timeout_ms: 50,
      execution_preview: {
        command: "node",
        args: ["-e", "setTimeout(() => {}, 10000)"],
      },
    },
    execute: true,
    operator_approval: structuredApproval(),
    follow: true,
    build_outcome: true,
    follow_max_wait_ms: 5_000,
  }, cwd);

  assert.equal(result.decision, "dispatched");
  assert.equal(result.follow?.terminal, true);
  assert.equal(result.follow?.status.state, "timed-out");
  assert.equal(result.agentRunOutcomePacket?.contractDecision, "fail");
  assert.ok(result.agentRunOutcomePacket?.blockers.includes("process-state-timed-out"));

  const registry = JSON.parse(readFileSync(path.join(cwd, ".pi", "reports", "agent-runs.json"), "utf8"));
  assert.equal(registry.runs[0].state, "timed-out");
  assert.equal(registry.runs[0].exitCode, 124);
});
