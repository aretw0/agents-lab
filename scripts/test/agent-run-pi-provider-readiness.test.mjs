import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildAgentRunPiProviderReadiness } from "../agent-run-pi-provider-readiness.mjs";
import { writeAgentRunPiProviderFanoutPlan } from "../agent-run-pi-provider-fanout-plan.mjs";

function workspace(prefix) {
  const cwd = mkdtempSync(path.join(tmpdir(), prefix));
  const cliPath = path.join(cwd, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  mkdirSync(path.dirname(cliPath), { recursive: true });
  writeFileSync(cliPath, "console.log('pi')\n", "utf8");
  writeFileSync(path.join(cwd, "package.json"), "{}\n", "utf8");
  return cwd;
}

function writeLastExecution(cwd, lines) {
  const filePath = path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-worker-a-real-execute.json");
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({
    mode: "agent-run-pi-provider-worker-dispatch",
    decision: "dispatched",
    terminalProcessState: "failed",
    contractDecision: "fail",
    outcomeBlockers: ["process-state-failed"],
    driverStep: {
      registryEntry: { envKeys: ["PI_CODING_AGENT_DIR"] },
      follow: { lines },
    },
  }, null, 2)}\n`, "utf8");
}

function writeProviderCanary(cwd, lines) {
  const filePath = path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-canary.json");
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({
    mode: "agent-run-pi-provider-canary",
    decision: "dispatched",
    workerId: "worker-a",
    workerDispatch: {
      mode: "agent-run-pi-provider-worker-dispatch",
      decision: "dispatched",
      terminalProcessState: "failed",
      contractDecision: "fail",
      outcomeBlockers: ["process-state-failed"],
      driverStep: {
        registryEntry: { envKeys: ["PI_CODING_AGENT_DIR"] },
        follow: { lines },
      },
    },
  }, null, 2)}\n`, "utf8");
}

function writeProviderContainerCanaryPass(cwd) {
  const filePath = path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-container-canary-report.json");
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({
    mode: "agent-run-pi-provider-container-canary-report",
    decision: "pass",
    canaryReport: {
      mode: "agent-run-pi-provider-canary",
      decision: "dispatched",
      workerDispatch: {
        mode: "agent-run-pi-provider-worker-dispatch",
        decision: "dispatched",
        terminalProcessState: "completed",
        contractDecision: "pass",
        driverStep: {
          registryEntry: { envKeys: ["PI_CODING_AGENT_DIR"] },
          follow: { lines: ["PASS", "Blockers: None."] },
        },
      },
      agentRunOutcomePacket: {
        mode: "agent-run-outcome-packet",
        processState: "completed",
        contractDecision: "pass",
        blockers: [],
      },
    },
    blockers: [],
  }, null, 2)}\n`, "utf8");
}

function writeNetworkCheck(cwd, payload) {
  const filePath = path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-network-check.json");
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({
    mode: "agent-run-pi-provider-network-check",
    schemaVersion: 1,
    ...payload,
  }, null, 2)}\n`, "utf8");
}

test("provider readiness is ready when plan is isolated and no failing prior execution exists", () => {
  const cwd = workspace("pi-provider-readiness-ready-");
  try {
    writeAgentRunPiProviderFanoutPlan({ cwd, outPath: ".artifacts/agent-run-driver/pi-provider-fanout-plan.json" });
    const result = buildAgentRunPiProviderReadiness({ cwd, lastExecutionPath: ".artifacts/agent-run-driver/missing.json" });

    assert.equal(result.mode, "agent-run-pi-provider-readiness");
    assert.equal(result.decision, "ready-for-operator-decision");
    assert.equal(result.dispatchAllowed, false);
    assert.equal(result.processStartAllowed, false);
    assert.equal(result.workerEnvKeys[0].includes("PI_CODING_AGENT_DIR"), true);
    assert.ok(result.warnings.includes("last-provider-execution-missing"));
    assert.deepEqual(result.providerDiagnostics.find((item) => item.code === "last-provider-execution-missing"), {
      code: "last-provider-execution-missing",
      category: "evidence",
      severity: "warning",
      evidence: "no prior provider execution artifact was found",
      operatorAction: "run a single approved provider canary when all plan-level blockers are clear",
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider readiness blocks missing PI_CODING_AGENT_DIR in plan workers", () => {
  const cwd = workspace("pi-provider-readiness-env-");
  try {
    const report = writeAgentRunPiProviderFanoutPlan({ cwd, outPath: ".artifacts/agent-run-driver/pi-provider-fanout-plan.json" });
    delete report.workerPackets[0].payload.run_spec.env;
    writeFileSync(path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-fanout-plan.json"), `${JSON.stringify(report)}\n`, "utf8");

    const result = buildAgentRunPiProviderReadiness({ cwd, lastExecutionPath: ".artifacts/agent-run-driver/missing.json" });

    assert.equal(result.decision, "blocked");
    assert.ok(result.blockers.includes("pi-coding-agent-dir-missing"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider readiness blocks known provider auth and fetch failures", () => {
  const cwd = workspace("pi-provider-readiness-failure-");
  try {
    writeAgentRunPiProviderFanoutPlan({ cwd, outPath: ".artifacts/agent-run-driver/pi-provider-fanout-plan.json" });
    writeLastExecution(cwd, [
      "No API key found for openai-codex.",
      "fetch failed",
    ]);

    const result = buildAgentRunPiProviderReadiness({ cwd });

    assert.equal(result.decision, "blocked");
    assert.ok(result.providerSignals.includes("provider-auth-missing"));
    assert.ok(result.providerSignals.includes("provider-fetch-failed"));
    assert.ok(result.blockers.includes("provider-auth-missing"));
    assert.ok(result.blockers.includes("provider-fetch-failed"));
    assert.deepEqual(result.providerDiagnostics.map((item) => [item.code, item.category, item.severity]), [
      ["provider-auth-missing", "auth", "blocker"],
      ["provider-fetch-failed", "network-or-provider", "blocker"],
    ]);
    assert.equal(result.providerRecoveryPlan.mode, "agent-run-pi-provider-recovery-plan");
    assert.equal(result.providerRecoveryPlan.decision, "blocked");
    assert.equal(result.providerRecoveryPlan.dispatchAllowed, false);
    assert.equal(result.providerRecoveryPlan.processStartAllowed, false);
    assert.equal(result.providerRecoveryPlan.automationAllowed, false);
    assert.deepEqual(result.providerRecoveryPlan.blockers, ["provider-auth-missing", "provider-fetch-failed"]);
    assert.deepEqual(result.providerRecoveryPlan.actions.map((item) => [item.diagnosticCode, item.actionCode, item.retryCanaryScript]), [
      ["provider-auth-missing", "configure-provider-credentials", "agent-run:pi-provider-canary"],
      ["provider-fetch-failed", "verify-provider-network", "agent-run:pi-provider-canary:container"],
    ]);
    assert.equal(result.providerRecoveryPlan.actions.find((item) => item.actionCode === "verify-provider-network").verificationScript, "agent-run:pi-provider-network-check");
    assert.ok(result.nextActions.includes("configure provider credentials for the selected model before executing provider workers"));
    assert.ok(result.nextActions.includes("verify network, proxy, and provider endpoint reachability, then rerun readiness"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider readiness clears fetch failure when network check passes", () => {
  const cwd = workspace("pi-provider-readiness-network-cleared-");
  try {
    writeAgentRunPiProviderFanoutPlan({ cwd, outPath: ".artifacts/agent-run-driver/pi-provider-fanout-plan.json" });
    writeLastExecution(cwd, ["fetch failed"]);
    writeNetworkCheck(cwd, {
      decision: "pass",
      executeRequested: true,
      networkRequestAllowed: true,
      networkDecision: "reachable-auth-required",
      httpStatus: 401,
      blockers: [],
      summary: "agent-run-pi-provider-network-check: decision=pass host=api.openai.com network=reachable-auth-required status=401",
    });

    const result = buildAgentRunPiProviderReadiness({ cwd });

    assert.equal(result.decision, "ready-for-operator-decision");
    assert.ok(result.providerSignals.includes("provider-fetch-failed"));
    assert.equal(result.blockers.includes("provider-fetch-failed"), false);
    assert.ok(result.warnings.includes("provider-fetch-failed-cleared-by-network-check"));
    assert.equal(result.providerNetworkCheck.decision, "pass");
    assert.equal(result.providerNetworkCheck.networkDecision, "reachable-auth-required");
    assert.deepEqual(result.providerDiagnostics.map((item) => [item.code, item.category, item.severity]), [
      ["provider-fetch-failed-cleared-by-network-check", "network-or-provider", "warning"],
    ]);
    assert.equal(result.providerRecoveryPlan.decision, "ready");
    assert.deepEqual(result.providerRecoveryPlan.blockers, []);
    assert.deepEqual(result.providerRecoveryPlan.actions, []);
    assert.deepEqual(result.nextActions, [
      "execute exactly one provider worker through agent-run-pi-provider-worker-dispatch",
      "require agentRunOutcomePacket pass before selecting another worker",
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider readiness blocks current provider canary fetch failure even when network check passed", () => {
  const cwd = workspace("pi-provider-readiness-current-canary-fail-");
  try {
    writeAgentRunPiProviderFanoutPlan({ cwd, outPath: ".artifacts/agent-run-driver/pi-provider-fanout-plan.json" });
    writeLastExecution(cwd, ["fetch failed"]);
    writeProviderCanary(cwd, ["fetch failed"]);
    writeNetworkCheck(cwd, {
      decision: "pass",
      executeRequested: true,
      networkRequestAllowed: true,
      networkDecision: "reachable-auth-required",
      httpStatus: 401,
      blockers: [],
      summary: "agent-run-pi-provider-network-check: decision=pass host=api.openai.com network=reachable-auth-required status=401",
    });

    const result = buildAgentRunPiProviderReadiness({ cwd });

    assert.equal(result.decision, "blocked");
    assert.equal(result.lastExecutionSource, "provider-canary");
    assert.ok(result.providerSignals.includes("provider-fetch-failed"));
    assert.ok(result.blockers.includes("provider-fetch-failed"));
    assert.equal(result.providerNetworkCheck.decision, "pass");
    assert.deepEqual(result.providerDiagnostics.map((item) => [item.code, item.category, item.severity]), [
      ["provider-fetch-failed", "network-or-provider", "blocker"],
    ]);
    assert.equal(result.providerRecoveryPlan.decision, "blocked");
    assert.deepEqual(result.providerRecoveryPlan.blockers, ["provider-fetch-failed"]);
    assert.ok(result.nextActions.includes("verify network, proxy, and provider endpoint reachability, then rerun readiness"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider readiness prefers passing container canary over older local canary failure", () => {
  const cwd = workspace("pi-provider-readiness-container-pass-");
  try {
    writeAgentRunPiProviderFanoutPlan({ cwd, outPath: ".artifacts/agent-run-driver/pi-provider-fanout-plan.json" });
    writeProviderCanary(cwd, ["fetch failed"]);
    writeProviderContainerCanaryPass(cwd);
    writeNetworkCheck(cwd, {
      decision: "pass",
      executeRequested: true,
      networkRequestAllowed: true,
      networkDecision: "reachable-auth-required",
      httpStatus: 401,
      blockers: [],
    });

    const result = buildAgentRunPiProviderReadiness({ cwd });

    assert.equal(result.decision, "ready-for-operator-decision");
    assert.equal(result.lastExecutionSource, "provider-container-canary");
    assert.deepEqual(result.providerSignals, []);
    assert.deepEqual(result.blockers, []);
    assert.deepEqual(result.providerDiagnostics, []);
    assert.equal(result.providerRecoveryPlan.decision, "ready");
    assert.deepEqual(result.providerRecoveryPlan.blockers, []);
    assert.deepEqual(result.providerRecoveryPlan.actions, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider readiness blocks global settings lock regression", () => {
  const cwd = workspace("pi-provider-readiness-lock-");
  try {
    writeAgentRunPiProviderFanoutPlan({ cwd, outPath: ".artifacts/agent-run-driver/pi-provider-fanout-plan.json" });
    writeLastExecution(cwd, ["EPERM: operation not permitted, mkdir 'C:\\Users\\x\\.pi\\agent\\settings.json.lock'"]);

    const result = buildAgentRunPiProviderReadiness({ cwd });

    assert.equal(result.decision, "blocked");
    assert.ok(result.blockers.includes("provider-global-settings-lock-error"));
    assert.deepEqual(result.providerDiagnostics.map((item) => [item.code, item.category, item.severity]), [
      ["provider-global-settings-lock-error", "sandbox-or-settings", "blocker"],
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
