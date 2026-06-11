import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildAgentRunPiProviderRecoveryNext } from "../agent-run-pi-provider-recovery-next.mjs";

function workspace(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function setMtime(filePath, iso) {
  const date = new Date(iso);
  utimesSync(filePath, date, date);
}

test("provider recovery next selects first recovery action from container canary evidence", () => {
  const cwd = workspace("pi-provider-recovery-next-");
  try {
    const evidencePath = path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-container-canary-report.json");
    const networkPath = path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-network-check.json");
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify({
      mode: "agent-run-pi-provider-container-canary-report",
      decision: "block",
      providerRecoveryPlan: {
        mode: "agent-run-pi-provider-recovery-plan",
        decision: "blocked",
        actions: [{
          diagnosticCode: "provider-fetch-failed",
          actionCode: "verify-provider-network",
          verificationScript: "agent-run:pi-provider-network-check",
          retryCanaryScript: "agent-run:pi-provider-canary:container",
          rerunReadinessScript: "agent-run:pi-provider-readiness",
        }],
      },
    })}\n`, "utf8");
    writeFileSync(networkPath, `${JSON.stringify({
      mode: "agent-run-pi-provider-network-check",
      decision: "ready-for-operator-decision",
      executeRequested: false,
      networkRequestAllowed: false,
      commandPreview: {
        command: "pnpm",
        args: [
          "run",
          "agent-run:pi-provider-network-check",
          "--",
          "--execute",
          "--endpoint",
          "https://api.openai.com/v1/models",
          "--timeout-ms",
          "10000",
        ],
        shellInterpolationAllowed: false,
      },
      blockers: [],
    })}\n`, "utf8");

    const result = buildAgentRunPiProviderRecoveryNext({ cwd });

    assert.equal(result.mode, "agent-run-pi-provider-recovery-next");
    assert.equal(result.decision, "next-action-ready");
    assert.equal(result.dispatchAllowed, false);
    assert.equal(result.processStartAllowed, false);
    assert.equal(result.automationAllowed, false);
    assert.equal(result.sourcePath, ".artifacts/agent-run-driver/pi-provider-container-canary-report.json");
    assert.equal(result.nextAction.actionCode, "verify-provider-network");
    assert.equal(result.actionStage, "run-network-check");
    assert.equal(result.providerNetworkCheck.decision, "ready-for-operator-decision");
    assert.deepEqual(result.selectedCommandPreview.args, [
      "run",
      "agent-run:pi-provider-network-check",
      "--",
      "--execute",
      "--endpoint",
      "https://api.openai.com/v1/models",
      "--timeout-ms",
      "10000",
    ]);
    assert.deepEqual(result.commandPreviews.verification, {
      command: "pnpm",
      args: ["run", "agent-run:pi-provider-network-check"],
      shellInterpolationAllowed: false,
    });
    assert.deepEqual(result.commandPreviews.retryCanary, {
      command: "pnpm",
      args: ["run", "agent-run:pi-provider-canary:container", "--", "--recovery-retry"],
      shellInterpolationAllowed: false,
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider recovery next advances to readiness rerun after network check passes", () => {
  const cwd = workspace("pi-provider-recovery-next-network-pass-");
  try {
    const evidencePath = path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-readiness.json");
    const networkPath = path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-network-check.json");
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify({
      mode: "agent-run-pi-provider-readiness",
      decision: "blocked",
      providerRecoveryPlan: {
        mode: "agent-run-pi-provider-recovery-plan",
        decision: "blocked",
        actions: [{
          diagnosticCode: "provider-fetch-failed",
          actionCode: "verify-provider-network",
          verificationScript: "agent-run:pi-provider-network-check",
          retryCanaryScript: "agent-run:pi-provider-canary:container",
          rerunReadinessScript: "agent-run:pi-provider-readiness",
        }],
      },
    })}\n`, "utf8");
    writeFileSync(networkPath, `${JSON.stringify({
      mode: "agent-run-pi-provider-network-check",
      decision: "pass",
      executeRequested: true,
      networkRequestAllowed: true,
      networkDecision: "reachable-auth-required",
      httpStatus: 401,
      blockers: [],
    })}\n`, "utf8");

    const result = buildAgentRunPiProviderRecoveryNext({ cwd, sourcePath: ".artifacts/agent-run-driver/pi-provider-readiness.json" });

    assert.equal(result.decision, "next-action-ready");
    assert.equal(result.actionStage, "rerun-readiness");
    assert.equal(result.providerNetworkCheck.decision, "pass");
    assert.equal(result.providerNetworkCheck.networkDecision, "reachable-auth-required");
    assert.deepEqual(result.selectedCommandPreview, {
      command: "pnpm",
      args: ["run", "agent-run:pi-provider-readiness"],
      shellInterpolationAllowed: false,
    });
    assert.match(result.nextActions.join("\n"), /rerun agent-run:pi-provider-readiness/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider recovery next retries canary when readiness already used current canary evidence", () => {
  const cwd = workspace("pi-provider-recovery-next-current-canary-");
  try {
    const evidencePath = path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-readiness.json");
    const networkPath = path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-network-check.json");
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify({
      mode: "agent-run-pi-provider-readiness",
      decision: "blocked",
      lastExecutionSource: "provider-canary",
      providerRecoveryPlan: {
        mode: "agent-run-pi-provider-recovery-plan",
        decision: "blocked",
        actions: [{
          diagnosticCode: "provider-fetch-failed",
          actionCode: "verify-provider-network",
          verificationScript: "agent-run:pi-provider-network-check",
          retryCanaryScript: "agent-run:pi-provider-canary:container",
          rerunReadinessScript: "agent-run:pi-provider-readiness",
        }],
      },
    })}\n`, "utf8");
    writeFileSync(networkPath, `${JSON.stringify({
      mode: "agent-run-pi-provider-network-check",
      decision: "pass",
      executeRequested: true,
      networkRequestAllowed: true,
      networkDecision: "reachable-auth-required",
      httpStatus: 401,
      blockers: [],
    })}\n`, "utf8");

    const result = buildAgentRunPiProviderRecoveryNext({ cwd, sourcePath: ".artifacts/agent-run-driver/pi-provider-readiness.json" });

    assert.equal(result.decision, "next-action-ready");
    assert.equal(result.actionStage, "retry-provider-canary");
    assert.deepEqual(result.selectedCommandPreview, {
      command: "pnpm",
      args: ["run", "agent-run:pi-provider-canary:container", "--", "--recovery-retry"],
      shellInterpolationAllowed: false,
    });
    assert.match(result.nextActions.join("\n"), /retry with agent-run:pi-provider-canary:container/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider recovery next keeps network blockers ahead of readiness rerun", () => {
  const cwd = workspace("pi-provider-recovery-next-network-block-");
  try {
    const evidencePath = path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-readiness.json");
    const networkPath = path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-network-check.json");
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify({
      mode: "agent-run-pi-provider-readiness",
      decision: "blocked",
      providerRecoveryPlan: {
        mode: "agent-run-pi-provider-recovery-plan",
        decision: "blocked",
        actions: [{
          diagnosticCode: "provider-fetch-failed",
          actionCode: "verify-provider-network",
          verificationScript: "agent-run:pi-provider-network-check",
          retryCanaryScript: "agent-run:pi-provider-canary:container",
          rerunReadinessScript: "agent-run:pi-provider-readiness",
        }],
      },
    })}\n`, "utf8");
    writeFileSync(networkPath, `${JSON.stringify({
      mode: "agent-run-pi-provider-network-check",
      decision: "blocked",
      executeRequested: true,
      networkRequestAllowed: true,
      networkDecision: "provider-network-failed",
      blockers: ["provider-network-failed"],
    })}\n`, "utf8");

    const result = buildAgentRunPiProviderRecoveryNext({ cwd, sourcePath: ".artifacts/agent-run-driver/pi-provider-readiness.json" });

    assert.equal(result.decision, "next-action-ready");
    assert.equal(result.actionStage, "resolve-network-blockers");
    assert.equal(result.providerNetworkCheck.decision, "blocked");
    assert.deepEqual(result.providerNetworkCheck.blockers, ["provider-network-failed"]);
    assert.deepEqual(result.selectedCommandPreview, {
      command: "pnpm",
      args: ["run", "agent-run:pi-provider-network-check"],
      shellInterpolationAllowed: false,
    });
    assert.match(result.nextActions.join("\n"), /resolve network reachability/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider recovery next selects provider canary preview when recovery is clear", () => {
  const cwd = workspace("pi-provider-recovery-next-clear-");
  try {
    const evidencePath = path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-readiness.json");
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify({
      mode: "agent-run-pi-provider-readiness",
      decision: "ready-for-operator-decision",
      providerRecoveryPlan: {
        mode: "agent-run-pi-provider-recovery-plan",
        decision: "ready",
        actions: [],
        blockers: [],
      },
    })}\n`, "utf8");

    const result = buildAgentRunPiProviderRecoveryNext({ cwd, sourcePath: ".artifacts/agent-run-driver/pi-provider-readiness.json" });

    assert.equal(result.decision, "next-action-ready");
    assert.deepEqual(result.blockers, []);
    assert.equal(result.actionStage, "retry-provider-canary");
    assert.equal(result.actionCount, 0);
    assert.equal(result.nextAction, null);
    assert.deepEqual(result.selectedCommandPreview, {
      command: "pnpm",
      args: ["run", "agent-run:pi-provider-canary"],
      shellInterpolationAllowed: false,
    });
    assert.match(result.nextActions.join("\n"), /provider recovery is clear/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider recovery next treats passing container canary as recovery clear", () => {
  const cwd = workspace("pi-provider-recovery-next-container-pass-");
  try {
    const evidencePath = path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-container-canary-report.json");
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify({
      mode: "agent-run-pi-provider-container-canary-report",
      decision: "pass",
      canaryReport: {
        mode: "agent-run-pi-provider-canary",
        decision: "dispatched",
        agentRunOutcomePacket: {
          mode: "agent-run-outcome-packet",
          contractDecision: "pass",
        },
      },
      blockers: [],
    })}\n`, "utf8");

    const result = buildAgentRunPiProviderRecoveryNext({ cwd });

    assert.equal(result.decision, "next-action-ready");
    assert.equal(result.sourcePath, ".artifacts/agent-run-driver/pi-provider-container-canary-report.json");
    assert.equal(result.providerRecoveryPlan.decision, "ready");
    assert.deepEqual(result.providerRecoveryPlan.blockers, []);
    assert.equal(result.actionStage, "retry-provider-canary");
    assert.deepEqual(result.selectedCommandPreview, {
      command: "pnpm",
      args: ["run", "agent-run:pi-provider-canary"],
      shellInterpolationAllowed: false,
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider recovery next uses newer readiness over older container pass", () => {
  const cwd = workspace("pi-provider-recovery-next-newer-readiness-");
  try {
    const containerPath = path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-container-canary-report.json");
    const readinessPath = path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-readiness.json");
    const networkPath = path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-network-check.json");
    mkdirSync(path.dirname(containerPath), { recursive: true });
    writeFileSync(containerPath, `${JSON.stringify({
      mode: "agent-run-pi-provider-container-canary-report",
      decision: "pass",
      canaryReport: {
        mode: "agent-run-pi-provider-canary",
        decision: "dispatched",
        agentRunOutcomePacket: {
          mode: "agent-run-outcome-packet",
          contractDecision: "pass",
        },
      },
      blockers: [],
    })}\n`, "utf8");
    writeFileSync(readinessPath, `${JSON.stringify({
      mode: "agent-run-pi-provider-readiness",
      decision: "blocked",
      lastExecutionSource: "provider-canary",
      providerRecoveryPlan: {
        mode: "agent-run-pi-provider-recovery-plan",
        decision: "blocked",
        actions: [{
          diagnosticCode: "provider-fetch-failed",
          actionCode: "verify-provider-network",
          verificationScript: "agent-run:pi-provider-network-check",
          retryCanaryScript: "agent-run:pi-provider-canary:container",
          rerunReadinessScript: "agent-run:pi-provider-readiness",
        }],
      },
    })}\n`, "utf8");
    writeFileSync(networkPath, `${JSON.stringify({
      mode: "agent-run-pi-provider-network-check",
      decision: "pass",
      executeRequested: true,
      networkRequestAllowed: true,
      networkDecision: "reachable-auth-required",
      httpStatus: 401,
      blockers: [],
    })}\n`, "utf8");
    setMtime(containerPath, "2026-06-01T00:00:00.000Z");
    setMtime(readinessPath, "2026-06-01T00:01:00.000Z");

    const result = buildAgentRunPiProviderRecoveryNext({ cwd });

    assert.equal(result.decision, "next-action-ready");
    assert.equal(result.sourcePath, ".artifacts/agent-run-driver/pi-provider-readiness.json");
    assert.equal(result.sourceMode, "agent-run-pi-provider-readiness");
    assert.equal(result.actionStage, "retry-provider-canary");
    assert.deepEqual(result.selectedCommandPreview, {
      command: "pnpm",
      args: ["run", "agent-run:pi-provider-canary:container", "--", "--recovery-retry"],
      shellInterpolationAllowed: false,
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider recovery next blocks when no recovery plan exists", () => {
  const cwd = workspace("pi-provider-recovery-next-missing-");
  try {
    const result = buildAgentRunPiProviderRecoveryNext({ cwd });

    assert.equal(result.decision, "blocked");
    assert.deepEqual(result.blockers, ["provider-recovery-plan-missing"]);
    assert.equal(result.dispatchAllowed, false);
    assert.equal(result.processStartAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
