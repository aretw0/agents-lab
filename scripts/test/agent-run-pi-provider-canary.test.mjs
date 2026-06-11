import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runAgentRunPiProviderCanary } from "../agent-run-pi-provider-canary.mjs";

function workspace(prefix) {
  const cwd = mkdtempSync(path.join(tmpdir(), prefix));
  const cliPath = path.join(cwd, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  mkdirSync(path.dirname(cliPath), { recursive: true });
  writeFileSync(cliPath, "console.log('provider canary pass')\n", "utf8");
  writeFileSync(path.join(cwd, "package.json"), "{}\n", "utf8");
  return cwd;
}

function writeBlockedReadinessExecution(cwd) {
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
      follow: { lines: ["fetch failed"] },
    },
  })}\n`, "utf8");
}

test("provider canary previews plan readiness and selected worker without dispatch", async () => {
  const cwd = workspace("pi-provider-canary-preview-");
  try {
    const result = await runAgentRunPiProviderCanary({ cwd });

    assert.equal(result.mode, "agent-run-pi-provider-canary");
    assert.equal(result.decision, "ready-for-operator-decision");
    assert.equal(result.executeRequested, false);
    assert.equal(result.dispatchAllowed, false);
    assert.equal(result.processStartAllowed, false);
    assert.equal(result.batchExecutionAllowed, false);
    assert.equal(result.singleRunOnly, true);
    assert.equal(result.fanoutPlan.decision, "ready-for-operator-decision");
    assert.equal(result.providerReadiness.decision, "ready-for-operator-decision");
    assert.equal(result.workerDispatch.decision, "ready-for-operator-decision");
    assert.equal(existsSync(path.join(cwd, ".pi", "reports", "agent-runs.json")), false);
    assert.equal(existsSync(path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-fanout-plan.json")), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider canary blocks execute when readiness is blocked", async () => {
  const cwd = workspace("pi-provider-canary-readiness-blocked-");
  try {
    writeBlockedReadinessExecution(cwd);
    const result = await runAgentRunPiProviderCanary({ cwd, execute: true, approve: true });

    assert.equal(result.decision, "blocked");
    assert.equal(result.dispatchAllowed, false);
    assert.equal(result.processStartAllowed, false);
    assert.ok(result.blockers.includes("provider-readiness:provider-fetch-failed"));
    assert.ok(result.blockers.includes("worker-dispatch:provider-readiness:provider-fetch-failed"));
    assert.deepEqual(result.providerDiagnostics.map((item) => [item.code, item.category, item.severity]), [
      ["provider-fetch-failed", "network-or-provider", "blocker"],
    ]);
    assert.equal(result.providerRecoveryPlan.mode, "agent-run-pi-provider-recovery-plan");
    assert.equal(result.providerRecoveryPlan.processStartAllowed, false);
    assert.deepEqual(result.providerRecoveryPlan.actions.map((item) => [item.diagnosticCode, item.actionCode, item.retryCanaryScript]), [
      ["provider-fetch-failed", "verify-provider-network", "agent-run:pi-provider-canary:container"],
    ]);
    assert.ok(result.nextActions.includes("verify network, proxy, and provider endpoint reachability, then rerun readiness"));
    assert.equal(existsSync(path.join(cwd, ".pi", "reports", "agent-runs.json")), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider canary executes exactly one worker with approval when readiness is clear", async () => {
  const cwd = workspace("pi-provider-canary-execute-");
  try {
    const result = await runAgentRunPiProviderCanary({ cwd, workerId: "worker-b", execute: true, approve: true });

    assert.equal(result.decision, "dispatched");
    assert.equal(result.workerId, "worker-b");
    assert.equal(result.dispatchAllowed, true);
    assert.equal(result.processStartAllowed, true);
    assert.equal(result.agentRunOutcomePacket?.mode, "agent-run-outcome-packet");
    assert.equal(result.agentRunOutcomePacket?.contractDecision, "pass");

    const registry = JSON.parse(readFileSync(path.join(cwd, ".pi", "reports", "agent-runs.json"), "utf8"));
    assert.equal(registry.runs.length, 1);
    assert.match(registry.runs[0].runId, /worker-b$/);
    assert.equal(registry.runs[0].state, "completed");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
