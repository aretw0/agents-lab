import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildAgentRunPiProviderRecoveryNext } from "../agent-run-pi-provider-recovery-next.mjs";

function workspace(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

test("provider recovery next selects first recovery action from container canary evidence", () => {
  const cwd = workspace("pi-provider-recovery-next-");
  try {
    const evidencePath = path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-container-canary-report.json");
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
          verificationScript: "agent-run:pi-provider-readiness",
          retryCanaryScript: "agent-run:pi-provider-canary:container",
          rerunReadinessScript: "agent-run:pi-provider-readiness",
        }],
      },
    })}\n`, "utf8");

    const result = buildAgentRunPiProviderRecoveryNext({ cwd });

    assert.equal(result.mode, "agent-run-pi-provider-recovery-next");
    assert.equal(result.decision, "next-action-ready");
    assert.equal(result.dispatchAllowed, false);
    assert.equal(result.processStartAllowed, false);
    assert.equal(result.automationAllowed, false);
    assert.equal(result.sourcePath, ".artifacts/agent-run-driver/pi-provider-container-canary-report.json");
    assert.equal(result.nextAction.actionCode, "verify-provider-network");
    assert.deepEqual(result.commandPreviews.retryCanary, {
      command: "pnpm",
      args: ["run", "agent-run:pi-provider-canary:container"],
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
