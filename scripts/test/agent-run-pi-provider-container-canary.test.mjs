import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildProviderContainerCanaryReport,
  buildProviderContainerCanaryDockerArgs,
  providerContainerCanaryBlockers,
  runAgentRunPiProviderContainerCanary,
} from "../agent-run-pi-provider-container-canary.mjs";

function workspace(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

test("provider container canary builds a headless devcontainer command", () => {
  assert.deepEqual(
    buildProviderContainerCanaryDockerArgs({
      container: "agents-lab-dev",
      canaryOutPath: ".artifacts\\agent-run-driver\\pi-provider-container-canary.json",
      workerIndex: 1,
      workerId: "worker-b",
      execute: true,
      approve: true,
    }),
    [
      "exec",
      "--user",
      "root",
      "agents-lab-dev",
      "lab",
      "vscode",
      "/workspaces/agents-lab",
      "node",
      "scripts/agent-run-pi-provider-canary.mjs",
      "--execute",
      "--worker-index",
      "1",
      "--out",
      ".artifacts/agent-run-driver/pi-provider-container-canary.json",
      "--worker-id",
      "worker-b",
      "--approve",
    ],
  );
});

test("provider container canary blocks without a container name and does not write reports", () => {
  const cwd = workspace("agent-run-pi-provider-container-canary-missing-");
  try {
    const report = runAgentRunPiProviderContainerCanary({ cwd, container: "" });

    assert.equal(report.mode, "agent-run-pi-provider-container-canary-report");
    assert.equal(report.decision, "block");
    assert.deepEqual(report.blockers, ["container-missing"]);
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.equal(existsSync(path.join(cwd, ".artifacts/agent-run-driver/pi-provider-container-canary-report.json")), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider container canary treats parsed blocked canary as semantic block not docker failure", () => {
  const canaryReport = {
    mode: "agent-run-pi-provider-canary",
    decision: "blocked",
    providerRecoveryPlan: {
      mode: "agent-run-pi-provider-recovery-plan",
      actions: [{
        diagnosticCode: "provider-fetch-failed",
        actionCode: "verify-provider-network",
        retryCanaryScript: "agent-run:pi-provider-canary:container",
      }],
    },
  };

  assert.deepEqual(
    providerContainerCanaryBlockers({ exitStatus: 1, canaryReport }),
    ["container-provider-canary-blocked"],
  );
  assert.equal(canaryReport.providerRecoveryPlan.mode, "agent-run-pi-provider-recovery-plan");
  assert.deepEqual(canaryReport.providerRecoveryPlan.actions.map((item) => [item.diagnosticCode, item.actionCode, item.retryCanaryScript]), [
    ["provider-fetch-failed", "verify-provider-network", "agent-run:pi-provider-canary:container"],
  ]);
});

test("provider container canary report exposes recovery plan at top level", () => {
  const report = buildProviderContainerCanaryReport({
    container: "agents-lab-dev",
    canaryReport: {
      decision: "blocked",
      providerRecoveryPlan: {
        mode: "agent-run-pi-provider-recovery-plan",
        actions: [{
          diagnosticCode: "provider-fetch-failed",
          actionCode: "verify-provider-network",
          retryCanaryScript: "agent-run:pi-provider-canary:container",
        }],
      },
    },
    blockers: ["container-provider-canary-blocked"],
  });

  assert.equal(report.decision, "block");
  assert.equal(report.providerRecoveryPlan.mode, "agent-run-pi-provider-recovery-plan");
  assert.deepEqual(report.providerRecoveryPlan.actions.map((item) => [item.diagnosticCode, item.actionCode, item.retryCanaryScript]), [
    ["provider-fetch-failed", "verify-provider-network", "agent-run:pi-provider-canary:container"],
  ]);
});

test("provider container canary script documents the headless lab wrapper", () => {
  const script = readFileSync("scripts/agent-run-pi-provider-container-canary.mjs", "utf8");

  assert.match(script, /buildDockerExecArgs/);
  assert.match(script, /headless: true/);
  assert.match(script, /agent-run-pi-provider-canary\.mjs/);
});
