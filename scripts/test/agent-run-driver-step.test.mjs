import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runAgentRunDriverStep } from "../agent-run-driver-step.mjs";

const cliPath = fileURLToPath(new URL("../agent-run-driver-step.mjs", import.meta.url));

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
      file_contract: "read-only",
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
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.decision, "ready-for-operator-decision");
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.processStartAllowed, false);
  assert.match(result.summary, /agent-run-driver-step: decision=ready-for-operator-decision/);
  assert.match(result.summary, /dispatch=no/);
});

test("headless driver step blocks execute without structured approval", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-approval-"));
  const result = await runAgentRunDriverStep({ ...payload(), execute: true }, cwd);

  assert.equal(result.mode, "agent-run-driver-step-dispatch");
  assert.equal(result.decision, "blocked");
  assert.equal(result.dispatchAllowed, false);
  assert.ok(result.blockers.includes("structured-operator-approval-missing"));
  assert.match(result.summary, /decision=blocked/);
  assert.match(result.summary, /blockers=1/);
});

test("headless driver step blocks duplicate running run", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-running-"));
  const registryDir = path.join(cwd, ".pi", "reports");
  mkdirSync(registryDir, { recursive: true });
  writeFileSync(path.join(registryDir, "agent-runs.json"), JSON.stringify({
    runs: [{ runId: "headless-driver-step-node-version", state: "running", pid: process.pid }],
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

test("headless driver step recovers stale running registry rows", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-stale-running-"));
  writeFileSync(path.join(cwd, "README.md"), "fixture\n", "utf8");
  const registryDir = path.join(cwd, ".pi", "reports");
  mkdirSync(registryDir, { recursive: true });
  writeFileSync(path.join(registryDir, "agent-runs.json"), JSON.stringify({
    runs: [{ runId: "headless-driver-step-node-version", state: "running", pid: 99999999 }],
  }), "utf8");

  const result = await runAgentRunDriverStep({
    ...payload(),
    execute: true,
    operator_approval: structuredApproval(),
    follow: true,
    build_outcome: true,
    follow_max_wait_ms: 5_000,
  }, cwd);

  assert.equal(result.decision, "dispatched");
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.follow?.status.state, "completed");
  assert.equal(result.agentRunOutcomePacket?.contractDecision, "pass");
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
  assert.equal(result.agentRunOutcomePacket?.schemaVersion, 1);
  assert.equal(result.agentRunOutcomePacket?.contractDecision, "pass");
  assert.match(result.summary, /decision=dispatched/);
  assert.match(result.summary, /follow=terminal/);
  assert.match(result.summary, /contract=pass/);

  const registry = JSON.parse(readFileSync(path.join(cwd, ".pi", "reports", "agent-runs.json"), "utf8"));
  assert.equal(registry.runs[0].state, "completed");
});

test("headless driver step fails outcome when worker output declares FAIL", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-output-fail-"));
  writeFileSync(path.join(cwd, "README.md"), "fixture\n", "utf8");
  const result = await runAgentRunDriverStep({
    run_spec: {
      ...payload().run_spec,
      run_id: "headless-driver-step-output-fail",
      log_path: ".pi/reports/headless-driver-step-output-fail.log",
      execution_preview: {
        command: "node",
        args: ["-e", "console.log('FAIL'); console.log('Blockers:'); console.log('- explicit worker blocker')"],
      },
    },
    execute: true,
    operator_approval: structuredApproval(),
    follow: true,
    build_outcome: true,
    follow_max_wait_ms: 5_000,
  }, cwd);

  assert.equal(result.decision, "dispatched");
  assert.equal(result.follow?.status.state, "completed");
  assert.equal(result.agentRunOutcomePacket?.contractDecision, "fail");
  assert.ok(result.agentRunOutcomePacket?.blockers.includes("worker-output-fail"));
  assert.ok(result.agentRunOutcomePacket?.markerFailures.includes("worker-output-fail"));
  assert.match(result.summary, /contract=fail/);
});

test("headless driver step fails outcome when worker output declares PASS/FAIL FAIL", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-pass-fail-output-fail-"));
  writeFileSync(path.join(cwd, "README.md"), "fixture\n", "utf8");
  const result = await runAgentRunDriverStep({
    run_spec: {
      ...payload().run_spec,
      run_id: "headless-driver-step-pass-fail-output-fail",
      log_path: ".pi/reports/headless-driver-step-pass-fail-output-fail.log",
      execution_preview: {
        command: "node",
        args: ["-e", "console.log('**PASS/FAIL: FAIL**'); console.log('Blockers: missing acceptance criteria')"],
      },
    },
    execute: true,
    operator_approval: structuredApproval(),
    follow: true,
    build_outcome: true,
    follow_max_wait_ms: 5_000,
  }, cwd);

  assert.equal(result.decision, "dispatched");
  assert.equal(result.follow?.status.state, "completed");
  assert.equal(result.agentRunOutcomePacket?.contractDecision, "fail");
  assert.ok(result.agentRunOutcomePacket?.blockers.includes("worker-output-fail"));
  assert.ok(result.agentRunOutcomePacket?.markerFailures.includes("worker-output-fail"));
});

test("headless driver step passes allowed run_spec env to subprocess", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-env-"));
  writeFileSync(path.join(cwd, "README.md"), "fixture\n", "utf8");
  const result = await runAgentRunDriverStep({
    run_spec: {
      ...payload().run_spec,
      run_id: "headless-driver-step-env",
      log_path: ".pi/reports/headless-driver-step-env.log",
      env: {
        PI_CODING_AGENT_DIR: path.join(cwd, ".sandbox", "pi-agent"),
        SHOULD_NOT_PASS: "no",
      },
      execution_preview: {
        command: "node",
        args: ["-e", "console.log(process.env.PI_CODING_AGENT_DIR); console.log(process.env.SHOULD_NOT_PASS || 'unset')"],
      },
    },
    execute: true,
    operator_approval: structuredApproval(),
    follow: true,
    build_outcome: true,
    follow_max_wait_ms: 5_000,
  }, cwd);

  assert.equal(result.decision, "dispatched");
  assert.equal(result.agentRunOutcomePacket?.contractDecision, "pass");
  assert.equal(result.runSpec.env.PI_CODING_AGENT_DIR, path.join(cwd, ".sandbox", "pi-agent"));
  assert.equal(result.runSpec.env.SHOULD_NOT_PASS, undefined);
  assert.deepEqual(result.registryEntry.envKeys, ["PI_CODING_AGENT_DIR"]);
  const log = readFileSync(path.join(cwd, ".pi", "reports", "headless-driver-step-env.log"), "utf8");
  assert.match(log, /PI_CODING_AGENT_DIR/);
  assert.match(log, /\.sandbox/);
  assert.match(log, /unset/);
});

test("headless driver step replaces log content for each dispatch", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-log-replace-"));
  writeFileSync(path.join(cwd, "README.md"), "fixture\n", "utf8");
  const logPath = path.join(cwd, ".pi", "reports", "headless-driver-step-log-replace.log");
  mkdirSync(path.dirname(logPath), { recursive: true });
  writeFileSync(logPath, "stale previous run\n", "utf8");

  const result = await runAgentRunDriverStep({
    run_spec: {
      ...payload().run_spec,
      run_id: "headless-driver-step-log-replace",
      log_path: ".pi/reports/headless-driver-step-log-replace.log",
    },
    execute: true,
    operator_approval: structuredApproval(),
    follow: true,
    build_outcome: true,
    follow_max_wait_ms: 5_000,
  }, cwd);

  assert.equal(result.decision, "dispatched");
  const log = readFileSync(logPath, "utf8");
  assert.doesNotMatch(log, /stale previous run/);
  assert.match(log, /^\[agent-runner\] starting command=/);
});

test("headless driver step accepts next driver step call wrapper", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-call-wrapper-"));
  writeFileSync(path.join(cwd, "README.md"), "fixture\n", "utf8");
  const result = await runAgentRunDriverStep({
    tool: "agent_run_driver_step_dispatch",
    operatorApprovalRequired: true,
    operator_approval: structuredApproval(),
    params: {
      ...payload(),
      execute: true,
      follow: true,
      build_outcome: true,
      follow_max_wait_ms: 5_000,
    },
  }, cwd);

  assert.equal(result.mode, "agent-run-driver-step-dispatch");
  assert.equal(result.decision, "dispatched");
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.follow?.terminal, true);
  assert.equal(result.agentRunOutcomePacket?.contractDecision, "pass");
});

test("headless driver step accepts payload packet with embedded driver step call", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-payload-packet-wrapper-"));
  writeFileSync(path.join(cwd, "README.md"), "fixture\n", "utf8");
  const params = {
    ...payload(),
    execute: true,
    follow: true,
    build_outcome: true,
    follow_max_wait_ms: 5_000,
  };
  const result = await runAgentRunDriverStep({
    mode: "agent-run-pi-driver-payload",
    decision: "ready-for-driver-step",
    payload: params,
    driverStepCall: {
      tool: "agent_run_driver_step_dispatch",
      operatorApprovalRequired: true,
      operator_approval: structuredApproval(),
      params,
    },
  }, cwd);

  assert.equal(result.mode, "agent-run-driver-step-dispatch");
  assert.equal(result.decision, "dispatched");
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.structuredOperatorApproval, true);
  assert.equal(result.agentRunOutcomePacket?.contractDecision, "pass");
});

test("headless driver step accepts payload packet with top-level approval", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-payload-packet-top-approval-"));
  writeFileSync(path.join(cwd, "README.md"), "fixture\n", "utf8");
  const params = {
    ...payload(),
    execute: true,
    follow: true,
    build_outcome: true,
    follow_max_wait_ms: 5_000,
  };
  const result = await runAgentRunDriverStep({
    mode: "agent-run-pi-driver-payload",
    decision: "ready-for-driver-step",
    operator_approval: structuredApproval(),
    payload: params,
    driverStepCall: {
      tool: "agent_run_driver_step_dispatch",
      operatorApprovalRequired: true,
      params,
    },
  }, cwd);

  assert.equal(result.mode, "agent-run-driver-step-dispatch");
  assert.equal(result.decision, "dispatched");
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.structuredOperatorApproval, true);
  assert.equal(result.agentRunOutcomePacket?.contractDecision, "pass");
});

test("headless driver step CLI accepts payload packet input file", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-payload-packet-cli-"));
  writeFileSync(path.join(cwd, "README.md"), "fixture\n", "utf8");
  const params = {
    ...payload(),
    execute: true,
    follow: true,
    build_outcome: true,
    follow_max_wait_ms: 5_000,
  };
  const inputPath = path.join(cwd, "driver-packet.json");
  writeFileSync(inputPath, JSON.stringify({
    mode: "agent-run-pi-driver-payload",
    decision: "ready-for-driver-step",
    operator_approval: structuredApproval(),
    payload: params,
    driverStepCall: {
      tool: "agent_run_driver_step_dispatch",
      operatorApprovalRequired: true,
      params,
    },
  }), "utf8");

  const stdout = execFileSync(process.execPath, [
    cliPath,
    "--cwd",
    cwd,
    "--input",
    inputPath,
  ], { encoding: "utf8" });
  const result = JSON.parse(stdout);

  assert.equal(result.mode, "agent-run-driver-step-dispatch");
  assert.equal(result.decision, "dispatched");
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.structuredOperatorApproval, true);
  assert.equal(result.agentRunOutcomePacket.contractDecision, "pass");
});

test("headless driver step CLI writes result file", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-result-out-"));
  writeFileSync(path.join(cwd, "README.md"), "fixture\n", "utf8");
  const inputPath = path.join(cwd, "driver-packet.json");
  const outputPath = path.join(cwd, "nested", "driver-result.json");
  writeFileSync(inputPath, JSON.stringify({
    ...payload(),
    execute: true,
    operator_approval: structuredApproval(),
    follow: true,
    build_outcome: true,
    follow_max_wait_ms: 5_000,
  }), "utf8");

  const stdout = execFileSync(process.execPath, [
    cliPath,
    "--cwd",
    cwd,
    "--input",
    inputPath,
    "--out",
    outputPath,
  ], { encoding: "utf8" });

  assert.equal(existsSync(outputPath), true);
  assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), JSON.parse(stdout));
  const result = JSON.parse(stdout);
  assert.equal(result.decision, "dispatched");
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.agentRunOutcomePacket.contractDecision, "pass");
  assert.match(result.summary, /agent-run-driver-step: decision=dispatched/);
});

test("headless driver step accepts wrapper approval in declared params field", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-call-wrapper-param-"));
  writeFileSync(path.join(cwd, "README.md"), "fixture\n", "utf8");
  const result = await runAgentRunDriverStep({
    tool: "agent_run_driver_step_dispatch",
    operatorApprovalRequired: true,
    operatorApprovalParam: "operator_approval",
    params: {
      ...payload(),
      execute: true,
      follow: true,
      build_outcome: true,
      operator_approval: structuredApproval(),
      follow_max_wait_ms: 5_000,
    },
  }, cwd);

  assert.equal(result.decision, "dispatched");
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.structuredOperatorApproval, true);
  assert.equal(result.agentRunOutcomePacket?.contractDecision, "pass");
});

test("headless driver step accepts wrapper approval in declared top-level field", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-call-wrapper-top-param-"));
  writeFileSync(path.join(cwd, "README.md"), "fixture\n", "utf8");
  const result = await runAgentRunDriverStep({
    tool: "agent_run_driver_step_dispatch",
    operatorApprovalRequired: true,
    operatorApprovalParam: "approval",
    approval: structuredApproval(),
    params: {
      ...payload(),
      execute: true,
      follow: true,
      build_outcome: true,
      follow_max_wait_ms: 5_000,
    },
  }, cwd);

  assert.equal(result.decision, "dispatched");
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.structuredOperatorApproval, true);
  assert.equal(result.agentRunOutcomePacket?.contractDecision, "pass");
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

test("headless driver step follows existing runs with relative log paths", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-relative-log-"));
  const reportsDir = path.join(cwd, ".pi", "reports");
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(path.join(reportsDir, "relative-log.log"), "existing output\n", "utf8");
  writeFileSync(path.join(reportsDir, "agent-runs.json"), JSON.stringify({
    runs: [{
      runId: "headless-driver-step-relative-log",
      state: "completed",
      exitCode: 0,
      cwd,
      declaredFiles: ["README.md"],
      logPath: ".pi/reports/relative-log.log",
      timeoutMs: 30_000,
    }],
  }, null, 2), "utf8");

  const result = await runAgentRunDriverStep({
    run_spec: {
      ...payload().run_spec,
      run_id: "headless-driver-step-relative-log",
      log_path: ".pi/reports/relative-log.log",
    },
    follow: true,
    build_outcome: true,
    follow_max_wait_ms: 0,
  }, cwd);

  assert.equal(result.follow?.terminal, true);
  assert.equal(result.follow?.outputBytes, Buffer.byteLength("existing output\n"));
  assert.equal(result.agentRunOutcomePacket?.contractDecision, "pass");
});

test("headless driver step preserves mutation outcome without touched evidence as partial", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-mutation-partial-"));
  writeFileSync(path.join(cwd, "README.md"), "fixture\n", "utf8");
  const result = await runAgentRunDriverStep({
    run_spec: {
      ...payload().run_spec,
      file_contract: "mutation",
    },
    execute: true,
    operator_approval: structuredApproval(),
    follow: true,
    build_outcome: true,
    follow_max_wait_ms: 5_000,
  }, cwd);

  assert.equal(result.nextAgentRunOutcomePacket?.params.file_contract, "mutation");
  assert.equal(result.agentRunOutcomePacket?.fileContract, "mutation");
  assert.equal(result.agentRunOutcomePacket?.contractDecision, "partial");
  assert.equal(result.agentRunOutcomePacket?.recommendation, "ask-operator");
});

test("headless driver step passes mutation touched evidence into outcome", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "headless-driver-mutation-pass-"));
  writeFileSync(path.join(cwd, "README.md"), "fixture\n", "utf8");
  const result = await runAgentRunDriverStep({
    run_spec: {
      ...payload().run_spec,
      file_contract: "mutation",
    },
    execute: true,
    operator_approval: structuredApproval(),
    follow: true,
    build_outcome: true,
    touched_files: ["README.md"],
    mutation_target_files: ["README.md"],
    marker_results: [{ label: "acceptance", ok: true }],
    follow_max_wait_ms: 5_000,
  }, cwd);

  assert.deepEqual(result.nextAgentRunOutcomePacket?.params.touched_files, ["README.md"]);
  assert.deepEqual(result.nextAgentRunOutcomePacket?.params.mutation_target_files, ["README.md"]);
  assert.deepEqual(result.nextAgentRunOutcomePacket?.params.marker_results, [{ label: "acceptance", ok: true }]);
  assert.equal(result.agentRunOutcomePacket?.fileContract, "mutation");
  assert.equal(result.agentRunOutcomePacket?.contractDecision, "pass");
  assert.equal(result.agentRunOutcomePacket?.recommendation, "stop");
  assert.deepEqual(result.agentRunOutcomePacket?.touchedFiles, ["README.md"]);
  assert.deepEqual(result.agentRunOutcomePacket?.markerFailures, []);
});
