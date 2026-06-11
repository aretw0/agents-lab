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
    assert.ok(result.nextActions.includes("configure provider credentials for the selected model before executing provider workers"));
    assert.ok(result.nextActions.includes("verify network, proxy, and provider endpoint reachability, then rerun readiness"));
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
