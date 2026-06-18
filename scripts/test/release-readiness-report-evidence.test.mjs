import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildReport, gather } from "../release-readiness-report.mjs";
import { makeWorkspace } from "./fixtures/release-readiness-workspace.mjs";

test("package smoke gate blocks release readiness with structured evidence", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
  });

  try {
    const rootPackagePath = path.join(workspace, "package.json");
    const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
    writeFileSync(rootPackagePath, JSON.stringify({ ...rootPackage, private: false }, null, 2));

    const data = gather("0.8.0", workspace);
    const report = buildReport(data);

    assert.equal(data.gates.packageSmoke, false);
    assert.equal(data.packageSmoke.decision, "block");
    assert.deepEqual(data.packageSmoke.packageBlockers.map((blocker) => blocker.id), ["root-package-not-private"]);
    assert.equal(report.ready, false);
    assert.deepEqual(report.releaseBlockers.map((blocker) => blocker.id), ["release-package-smoke"]);
    assert.deepEqual(report.releaseBlockers.map((blocker) => blocker.evidence), ["root-package-not-private"]);
    assert.match(report.markdown, /\[ \] release-package-smoke/);
    assert.match(report.markdown, /release-package-smoke \[technical-gate\]: root-package-not-private/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("user surface gate blocks release readiness for unclassified root scripts", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
    rootScripts: {
      "mystery:tool": "node scripts/mystery.mjs",
    },
  });

  try {
    const data = gather("0.8.0", workspace);
    const report = buildReport(data);

    assert.equal(data.gates.userSurface, false);
    assert.equal(data.userSurface.ok, false);
    assert.deepEqual(data.userSurface.labOnlyScripts, ["mystery:tool"]);
    assert.deepEqual(data.userSurface.distributionCandidates, []);
    assert.equal(report.ready, false);
    assert.deepEqual(report.releaseBlockers.map((blocker) => blocker.id), ["pi-stack-user-surface"]);
    assert.deepEqual(report.releaseBlockers.map((blocker) => blocker.evidence), ["lab-only:mystery:tool"]);
    assert.match(report.markdown, /\[ \] pi-stack-user-surface/);
    assert.match(report.markdown, /pi-stack-user-surface \[technical-gate\]: lab-only:mystery:tool/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("readiness exposes last agent-run driver canary evidence when present", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
  });

  try {
    const evidencePath = path.join(workspace, ".artifacts", "agent-run-driver", "latest.json");
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, JSON.stringify({
      mode: "agent-run-pi-driver-summary",
      schemaVersion: 1,
      decision: "dispatched",
      runId: "agent-run-driver-local-canary",
      followTerminal: true,
      contractDecision: "pass",
      outputBytes: 512,
      summary: "agent-run-pi-driver-summary: decision=dispatched",
    }, null, 2));

    const data = gather("0.8.0", workspace);

    assert.equal(data.agentRunDrivers.lastCanaryEvidence.present, true);
    assert.equal(data.agentRunDrivers.lastCanaryEvidence.decision, "pass");
    assert.equal(data.agentRunDrivers.lastCanaryEvidence.runId, "agent-run-driver-local-canary");
    assert.equal(data.agentRunDrivers.lastCanaryEvidence.contractDecision, "pass");
    assert.equal(data.agentRunDrivers.lastCanaryEvidence.followTerminal, true);
    assert.equal(data.agentRunDrivers.lastCanaryEvidence.schemaVersion, 1);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("readiness exposes last agent-run driver mutation canary evidence when present", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
  });

  try {
    const evidencePath = path.join(workspace, ".artifacts", "agent-run-driver", "latest-mutation.json");
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, JSON.stringify({
      mode: "agent-run-driver-canary-report",
      schemaVersion: 1,
      canaryMode: "mutation",
      decision: "dispatched",
      runId: "agent-run-driver-local-mutation-canary",
      followTerminal: true,
      contractDecision: "pass",
      fileContract: "mutation",
      outputBytes: 512,
      summary: "agent-run-driver-canary: decision=dispatched",
    }, null, 2));

    const data = gather("0.8.0", workspace);

    assert.equal(data.agentRunDrivers.lastMutationCanaryEvidence.present, true);
    assert.equal(data.agentRunDrivers.lastMutationCanaryEvidence.decision, "pass");
    assert.equal(data.agentRunDrivers.lastMutationCanaryEvidence.mode, "agent-run-driver-canary-report");
    assert.equal(data.agentRunDrivers.lastMutationCanaryEvidence.runId, "agent-run-driver-local-mutation-canary");
    assert.equal(data.agentRunDrivers.lastMutationCanaryEvidence.contractDecision, "pass");
    assert.equal(data.agentRunDrivers.lastMutationCanaryEvidence.followTerminal, true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("readiness exposes agent-run driver canary suite evidence when present", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
  });

  try {
    const evidencePath = path.join(workspace, ".artifacts", "agent-run-driver", "suite.json");
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, JSON.stringify({
      mode: "agent-run-driver-canary-suite-report",
      schemaVersion: 1,
      decision: "pass",
      canaries: {
        readOnly: { contractDecision: "pass" },
        mutation: { contractDecision: "pass" },
      },
      blockers: [],
      summary: "agent-run-driver-canary-suite: decision=pass readOnly=pass mutation=pass",
    }, null, 2));

    const data = gather("0.8.0", workspace);

    assert.equal(data.agentRunDrivers.canarySuiteEvidence.present, true);
    assert.equal(data.agentRunDrivers.canarySuiteEvidence.decision, "pass");
    assert.equal(data.agentRunDrivers.canarySuiteEvidence.mode, "agent-run-driver-canary-suite-report");
    assert.equal(data.agentRunDrivers.canarySuiteEvidence.readOnlyDecision, "pass");
    assert.equal(data.agentRunDrivers.canarySuiteEvidence.mutationDecision, "pass");
    assert.deepEqual(data.agentRunDrivers.canarySuiteEvidence.blockers, []);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("readiness exposes provider readiness diagnostics when present", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
  });

  try {
    const evidencePath = path.join(workspace, ".artifacts", "agent-run-driver", "pi-provider-readiness.json");
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, JSON.stringify({
      mode: "agent-run-pi-provider-readiness",
      schemaVersion: 1,
      decision: "blocked",
      model: "openai-codex/gpt-5.3-codex-spark",
      lastExecutionSource: "provider-canary",
      blockers: ["provider-fetch-failed"],
      providerDiagnostics: [{
        code: "provider-fetch-failed",
        category: "network-or-provider",
        severity: "blocker",
      }],
      providerRecoveryPlan: {
        mode: "agent-run-pi-provider-recovery-plan",
        decision: "blocked",
        dispatchAllowed: false,
        processStartAllowed: false,
        automationAllowed: false,
        blockers: ["provider-fetch-failed"],
        actions: [{
          diagnosticCode: "provider-fetch-failed",
          actionCode: "verify-provider-network",
          retryCanaryScript: "agent-run:pi-provider-canary:container",
        }],
      },
      nextActions: ["verify network, proxy, and provider endpoint reachability, then rerun readiness"],
      summary: "agent-run-pi-provider-readiness: decision=blocked",
    }, null, 2));

    const data = gather("0.8.0", workspace);

    assert.equal(data.agentRunDrivers.providerReadinessEvidence.present, true);
    assert.equal(data.agentRunDrivers.providerReadinessEvidence.decision, "blocked");
    assert.equal(data.agentRunDrivers.providerReadinessEvidence.lastExecutionSource, "provider-canary");
    assert.deepEqual(data.agentRunDrivers.providerReadinessEvidence.blockers, ["provider-fetch-failed"]);
    assert.deepEqual(data.agentRunDrivers.providerReadinessEvidence.providerDiagnostics.map((item) => [item.code, item.category, item.severity]), [
      ["provider-fetch-failed", "network-or-provider", "blocker"],
    ]);
    assert.equal(data.agentRunDrivers.providerReadinessEvidence.providerRecoveryPlan.mode, "agent-run-pi-provider-recovery-plan");
    assert.equal(data.agentRunDrivers.providerReadinessEvidence.providerRecoveryPlan.dispatchAllowed, false);
    assert.equal(data.agentRunDrivers.providerReadinessEvidence.providerRecoveryPlan.automationAllowed, false);
    assert.deepEqual(data.agentRunDrivers.providerReadinessEvidence.providerRecoveryPlan.actions.map((item) => [item.diagnosticCode, item.actionCode, item.retryCanaryScript]), [
      ["provider-fetch-failed", "verify-provider-network", "agent-run:pi-provider-canary:container"],
    ]);
    assert.equal(data.agentRunDrivers.ok, true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("readiness exposes provider canary evidence when present", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
  });

  try {
    const evidencePath = path.join(workspace, ".artifacts", "agent-run-driver", "pi-provider-canary.json");
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, JSON.stringify({
      mode: "agent-run-pi-provider-canary",
      schemaVersion: 1,
      decision: "blocked",
      executeRequested: false,
      dispatchAllowed: false,
      processStartAllowed: false,
      workerId: "worker-a",
      runId: "agent-run-pi-provider-fanout-rehearsal-worker-a",
      providerDiagnostics: [{
        code: "provider-fetch-failed",
        category: "network-or-provider",
        severity: "blocker",
      }],
      providerRecoveryPlan: {
        mode: "agent-run-pi-provider-recovery-plan",
        decision: "blocked",
        dispatchAllowed: false,
        processStartAllowed: false,
        automationAllowed: false,
        actions: [{
          diagnosticCode: "provider-fetch-failed",
          actionCode: "verify-provider-network",
          retryCanaryScript: "agent-run:pi-provider-canary:container",
        }],
      },
      blockers: ["provider-readiness:provider-fetch-failed"],
      summary: "agent-run-pi-provider-canary: decision=blocked",
    }, null, 2));

    const data = gather("0.8.0", workspace);

    assert.equal(data.agentRunDrivers.providerCanaryEvidence.present, true);
    assert.equal(data.agentRunDrivers.providerCanaryEvidence.decision, "blocked");
    assert.equal(data.agentRunDrivers.providerCanaryEvidence.workerId, "worker-a");
    assert.equal(data.agentRunDrivers.providerCanaryEvidence.dispatchAllowed, false);
    assert.deepEqual(data.agentRunDrivers.providerCanaryEvidence.blockers, ["provider-readiness:provider-fetch-failed"]);
    assert.deepEqual(data.agentRunDrivers.providerCanaryEvidence.providerDiagnostics.map((item) => [item.code, item.category, item.severity]), [
      ["provider-fetch-failed", "network-or-provider", "blocker"],
    ]);
    assert.equal(data.agentRunDrivers.providerCanaryEvidence.providerRecoveryPlan.mode, "agent-run-pi-provider-recovery-plan");
    assert.deepEqual(data.agentRunDrivers.providerCanaryEvidence.providerRecoveryPlan.actions.map((item) => [item.diagnosticCode, item.actionCode, item.retryCanaryScript]), [
      ["provider-fetch-failed", "verify-provider-network", "agent-run:pi-provider-canary:container"],
    ]);
    assert.equal(data.agentRunDrivers.ok, true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("readiness exposes provider container canary evidence when present", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
  });

  try {
    const evidencePath = path.join(workspace, ".artifacts", "agent-run-driver", "pi-provider-container-canary-report.json");
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, JSON.stringify({
      mode: "agent-run-pi-provider-container-canary-report",
      schemaVersion: 1,
      decision: "block",
      container: "goofy_nightingale",
      executeRequested: false,
      dispatchAllowed: false,
      processStartAllowed: false,
      canaryOutPath: ".artifacts/agent-run-driver/pi-provider-container-canary.json",
      providerRecoveryPlan: {
        mode: "agent-run-pi-provider-recovery-plan",
        decision: "blocked",
        dispatchAllowed: false,
        processStartAllowed: false,
        automationAllowed: false,
        actions: [{
          diagnosticCode: "provider-fetch-failed",
          actionCode: "verify-provider-network",
          retryCanaryScript: "agent-run:pi-provider-canary:container",
        }],
      },
      canaryReport: {
        decision: "blocked",
        providerRecoveryPlan: {
          mode: "agent-run-pi-provider-recovery-plan",
          decision: "blocked",
          dispatchAllowed: false,
          processStartAllowed: false,
          automationAllowed: false,
          actions: [{
            diagnosticCode: "provider-fetch-failed",
            actionCode: "verify-provider-network",
            retryCanaryScript: "agent-run:pi-provider-canary:container",
          }],
        },
      },
      providerDiagnostics: [{
        code: "provider-fetch-failed",
        category: "network-or-provider",
        severity: "blocker",
      }],
      blockers: ["container-provider-canary-blocked"],
      summary: "agent-run-pi-provider-container-canary: decision=block",
    }, null, 2));

    const data = gather("0.8.0", workspace);

    assert.equal(data.agentRunDrivers.providerContainerCanaryEvidence.present, true);
    assert.equal(data.agentRunDrivers.providerContainerCanaryEvidence.decision, "block");
    assert.equal(data.agentRunDrivers.providerContainerCanaryEvidence.container, "goofy_nightingale");
    assert.equal(data.agentRunDrivers.providerContainerCanaryEvidence.canaryDecision, "blocked");
    assert.equal(data.agentRunDrivers.providerContainerCanaryEvidence.dispatchAllowed, false);
    assert.deepEqual(data.agentRunDrivers.providerContainerCanaryEvidence.blockers, ["container-provider-canary-blocked"]);
    assert.deepEqual(data.agentRunDrivers.providerContainerCanaryEvidence.providerDiagnostics.map((item) => [item.code, item.category, item.severity]), [
      ["provider-fetch-failed", "network-or-provider", "blocker"],
    ]);
    assert.equal(data.agentRunDrivers.providerContainerCanaryEvidence.providerRecoveryPlan.mode, "agent-run-pi-provider-recovery-plan");
    assert.deepEqual(data.agentRunDrivers.providerContainerCanaryEvidence.providerRecoveryPlan.actions.map((item) => [item.diagnosticCode, item.actionCode, item.retryCanaryScript]), [
      ["provider-fetch-failed", "verify-provider-network", "agent-run:pi-provider-canary:container"],
    ]);
    assert.equal(data.agentRunDrivers.ok, true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("readiness exposes provider recovery next evidence when present", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
  });

  try {
    const evidencePath = path.join(workspace, ".artifacts", "agent-run-driver", "pi-provider-recovery-next.json");
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, JSON.stringify({
      mode: "agent-run-pi-provider-recovery-next",
      schemaVersion: 1,
      decision: "next-action-ready",
      sourcePath: ".artifacts/agent-run-driver/pi-provider-container-canary-report.json",
      sourceDecision: "block",
      actionCount: 1,
      actionStage: "run-network-check",
      nextAction: {
        diagnosticCode: "provider-fetch-failed",
        actionCode: "verify-provider-network",
        verificationScript: "agent-run:pi-provider-network-check",
        retryCanaryScript: "agent-run:pi-provider-canary:container",
      },
      selectedCommandPreview: {
        command: "pnpm",
        args: ["run", "agent-run:pi-provider-network-check"],
        shellInterpolationAllowed: false,
      },
      providerNetworkCheck: {
        path: ".artifacts/agent-run-driver/pi-provider-network-check.json",
        present: true,
        decision: "ready-for-operator-decision",
      },
      commandPreviews: {
        retryCanary: {
          command: "pnpm",
          args: ["run", "agent-run:pi-provider-canary:container", "--", "--recovery-retry"],
          shellInterpolationAllowed: false,
        },
      },
      blockers: [],
      summary: "agent-run-pi-provider-recovery-next: decision=next-action-ready action=verify-provider-network dispatch=no",
    }, null, 2));

    const data = gather("0.8.0", workspace);

    assert.equal(data.agentRunDrivers.providerRecoveryNextEvidence.present, true);
    assert.equal(data.agentRunDrivers.providerRecoveryNextEvidence.decision, "next-action-ready");
    assert.equal(data.agentRunDrivers.providerRecoveryNextEvidence.mode, "agent-run-pi-provider-recovery-next");
    assert.equal(data.agentRunDrivers.providerRecoveryNextEvidence.sourceDecision, "block");
    assert.equal(data.agentRunDrivers.providerRecoveryNextEvidence.actionCount, 1);
    assert.equal(data.agentRunDrivers.providerRecoveryNextEvidence.actionStage, "run-network-check");
    assert.equal(data.agentRunDrivers.providerRecoveryNextEvidence.nextAction.actionCode, "verify-provider-network");
    assert.equal(data.agentRunDrivers.providerRecoveryNextEvidence.nextAction.verificationScript, "agent-run:pi-provider-network-check");
    assert.equal(data.agentRunDrivers.providerRecoveryNextEvidence.nextAction.retryCanaryScript, "agent-run:pi-provider-canary:container");
    assert.deepEqual(data.agentRunDrivers.providerRecoveryNextEvidence.selectedCommandPreview.args, ["run", "agent-run:pi-provider-network-check"]);
    assert.equal(data.agentRunDrivers.providerRecoveryNextEvidence.providerNetworkCheck.decision, "ready-for-operator-decision");
    assert.deepEqual(data.agentRunDrivers.providerRecoveryNextEvidence.commandPreviews.retryCanary.args, ["run", "agent-run:pi-provider-canary:container", "--", "--recovery-retry"]);
    assert.deepEqual(data.agentRunDrivers.providerRecoveryNextEvidence.blockers, []);
    assert.equal(data.agentRunDrivers.ok, true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("readiness exposes provider network check evidence when present", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
  });

  try {
    const evidencePath = path.join(workspace, ".artifacts", "agent-run-driver", "pi-provider-network-check.json");
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, JSON.stringify({
      mode: "agent-run-pi-provider-network-check",
      schemaVersion: 1,
      decision: "ready-for-operator-decision",
      executeRequested: false,
      networkRequestAllowed: false,
      endpointHost: "api.openai.com",
      timeoutMs: 10000,
      blockers: [],
      warnings: [],
      summary: "agent-run-pi-provider-network-check: decision=ready-for-operator-decision host=api.openai.com execute=no network=no",
    }, null, 2));

    const data = gather("0.8.0", workspace);

    assert.equal(data.agentRunDrivers.providerNetworkCheckEvidence.present, true);
    assert.equal(data.agentRunDrivers.providerNetworkCheckEvidence.decision, "ready-for-operator-decision");
    assert.equal(data.agentRunDrivers.providerNetworkCheckEvidence.mode, "agent-run-pi-provider-network-check");
    assert.equal(data.agentRunDrivers.providerNetworkCheckEvidence.executeRequested, false);
    assert.equal(data.agentRunDrivers.providerNetworkCheckEvidence.networkRequestAllowed, false);
    assert.equal(data.agentRunDrivers.providerNetworkCheckEvidence.endpointHost, "api.openai.com");
    assert.deepEqual(data.agentRunDrivers.providerNetworkCheckEvidence.blockers, []);
    assert.deepEqual(data.agentRunDrivers.providerNetworkCheckEvidence.warnings, []);
    assert.equal(data.agentRunDrivers.ok, true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("readiness exposes protected board provider plan evidence when present", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
  });

  try {
    const evidencePath = path.join(workspace, ".artifacts", "agent-run-driver", "pi-provider-protected-board-fanout-plan.json");
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, JSON.stringify({
      mode: "agent-run-pi-provider-fanout-plan",
      schemaVersion: 1,
      decision: "ready-for-operator-decision",
      source: "protected-board",
      batchId: "protected-board-research-0-8",
      model: "openai-codex/gpt-5.3-codex-spark",
      requireLocalTaskEvidence: true,
      workerCount: 3,
      workerPackets: [
        { taskId: "TASK-BUD-480", declaredFilesSource: "local-task-evidence" },
        { taskId: "TASK-BUD-521", declaredFilesSource: "local-task-evidence" },
        { taskId: "TASK-BUD-676", declaredFilesSource: "local-task-evidence" },
      ],
      boardSelection: {
        selectedTaskIds: ["TASK-BUD-480", "TASK-BUD-521", "TASK-BUD-676"],
      },
      dispatchAllowed: false,
      processStartAllowed: false,
      batchExecutionAllowed: false,
      blockers: [],
      summary: "agent-run-pi-provider-fanout-plan: decision=ready-for-operator-decision source=protected-board model=openai-codex/gpt-5.3-codex-spark workers=3 dispatch=no",
    }, null, 2));

    const data = gather("0.8.0", workspace);

    assert.equal(data.agentRunDrivers.providerProtectedBoardPlanEvidence.present, true);
    assert.equal(data.agentRunDrivers.providerProtectedBoardPlanEvidence.decision, "ready-for-operator-decision");
    assert.equal(data.agentRunDrivers.providerProtectedBoardPlanEvidence.mode, "agent-run-pi-provider-fanout-plan");
    assert.equal(data.agentRunDrivers.providerProtectedBoardPlanEvidence.source, "protected-board");
    assert.equal(data.agentRunDrivers.providerProtectedBoardPlanEvidence.batchId, "protected-board-research-0-8");
    assert.equal(data.agentRunDrivers.providerProtectedBoardPlanEvidence.model, "openai-codex/gpt-5.3-codex-spark");
    assert.equal(data.agentRunDrivers.providerProtectedBoardPlanEvidence.requireLocalTaskEvidence, true);
    assert.equal(data.agentRunDrivers.providerProtectedBoardPlanEvidence.workerCount, 3);
    assert.deepEqual(data.agentRunDrivers.providerProtectedBoardPlanEvidence.workerDeclaredFilesSources, [
      "local-task-evidence",
      "local-task-evidence",
      "local-task-evidence",
    ]);
    assert.deepEqual(data.agentRunDrivers.providerProtectedBoardPlanEvidence.selectedTaskIds, ["TASK-BUD-480", "TASK-BUD-521", "TASK-BUD-676"]);
    assert.equal(data.agentRunDrivers.providerProtectedBoardPlanEvidence.dispatchAllowed, false);
    assert.equal(data.agentRunDrivers.providerProtectedBoardPlanEvidence.processStartAllowed, false);
    assert.equal(data.agentRunDrivers.providerProtectedBoardPlanEvidence.batchExecutionAllowed, false);
    assert.deepEqual(data.agentRunDrivers.providerProtectedBoardPlanEvidence.blockers, []);
    assert.equal(data.agentRunDrivers.protectedBoardPlanStrictRequired, true);
    assert.equal(data.agentRunDrivers.protectedBoardPlanLocalEvidenceSourcesOk, true);
    assert.equal(data.agentRunDrivers.protectedBoardPlanStrictGateOk, true);
    assert.equal(data.agentRunDrivers.ok, true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("readiness exposes protected board provider outcome evidence when present", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
  });

  try {
    const evidencePath = path.join(workspace, ".artifacts", "agent-run-driver", "pi-provider-protected-board-fanout-outcome.json");
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, JSON.stringify({
      mode: "agent-run-driver-fanout-outcome-report",
      schemaVersion: 1,
      decision: "block",
      batchId: "protected-board-research-0-8",
      dispatchAllowed: false,
      processStartAllowed: false,
      batchExecutionAllowed: false,
      workerCount: 3,
      passedWorkerCount: 1,
      workerSummaries: [
        { workerId: "task-bud-480", contractDecision: "fail" },
        { workerId: "task-bud-521", contractDecision: "pass" },
        { workerId: "task-bud-676", contractDecision: "fail" },
      ],
      blockers: [
        "task-bud-480:worker-output-fail",
        "task-bud-676:worker-output-fail",
      ],
      summary: "agent-run-driver-fanout-outcome: decision=block batchId=protected-board-research-0-8 workers=3 passed=1 blockers=2 dispatch=no",
    }, null, 2));

    const data = gather("0.8.0", workspace);

    assert.equal(data.agentRunDrivers.providerProtectedBoardOutcomeEvidence.present, true);
    assert.equal(data.agentRunDrivers.providerProtectedBoardOutcomeEvidence.decision, "block");
    assert.equal(data.agentRunDrivers.providerProtectedBoardOutcomeEvidence.mode, "agent-run-driver-fanout-outcome-report");
    assert.equal(data.agentRunDrivers.providerProtectedBoardOutcomeEvidence.batchId, "protected-board-research-0-8");
    assert.equal(data.agentRunDrivers.providerProtectedBoardOutcomeEvidence.workerCount, 3);
    assert.equal(data.agentRunDrivers.providerProtectedBoardOutcomeEvidence.passedWorkerCount, 1);
    assert.equal(data.agentRunDrivers.providerProtectedBoardOutcomeEvidence.dispatchAllowed, false);
    assert.equal(data.agentRunDrivers.providerProtectedBoardOutcomeEvidence.processStartAllowed, false);
    assert.equal(data.agentRunDrivers.providerProtectedBoardOutcomeEvidence.batchExecutionAllowed, false);
    assert.deepEqual(data.agentRunDrivers.providerProtectedBoardOutcomeEvidence.workerContractDecisions, ["fail", "pass", "fail"]);
    assert.deepEqual(data.agentRunDrivers.providerProtectedBoardOutcomeEvidence.blockers, [
      "task-bud-480:worker-output-fail",
      "task-bud-676:worker-output-fail",
    ]);
    assert.equal(data.agentRunDrivers.ok, true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("readiness exposes protected board recovery next evidence when present", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
  });

  try {
    const evidencePath = path.join(workspace, ".artifacts", "agent-run-driver", "pi-provider-protected-board-recovery-next.json");
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, JSON.stringify({
      mode: "agent-run-driver-fanout-recovery-next",
      schemaVersion: 1,
      decision: "next-action-ready",
      sourceDecision: "block",
      batchId: "protected-board-research-0-8",
      failedWorkerCount: 2,
      dispatchAllowed: false,
      processStartAllowed: false,
      automationAllowed: false,
      selectedWorker: {
        workerId: "task-bud-480",
        runId: "protected-board-research-0-8-task-bud-480",
      },
      failureKind: "worker-output-fail",
      blockers: [],
      summary: "agent-run-driver-fanout-recovery-next: decision=next-action-ready source=.artifacts/agent-run-driver/pi-provider-protected-board-fanout-outcome.json failed=2 selected=task-bud-480 dispatch=no",
    }, null, 2));

    const data = gather("0.8.0", workspace);

    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryNextEvidence.present, true);
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryNextEvidence.decision, "next-action-ready");
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryNextEvidence.mode, "agent-run-driver-fanout-recovery-next");
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryNextEvidence.batchId, "protected-board-research-0-8");
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryNextEvidence.sourceDecision, "block");
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryNextEvidence.failedWorkerCount, 2);
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryNextEvidence.selectedWorkerId, "task-bud-480");
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryNextEvidence.selectedRunId, "protected-board-research-0-8-task-bud-480");
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryNextEvidence.failureKind, "worker-output-fail");
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryNextEvidence.dispatchAllowed, false);
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryNextEvidence.processStartAllowed, false);
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryNextEvidence.automationAllowed, false);
    assert.deepEqual(data.agentRunDrivers.providerProtectedBoardRecoveryNextEvidence.blockers, []);
    assert.equal(data.agentRunDrivers.ok, true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("buildReport distinguishes exhausted board scope from release readiness", () => {
  const workspace = makeWorkspace({
    version: "0.7.0",
    tasks: [
      { id: "TASK-DONE", status: "completed", priority: "p1", description: "done" },
    ],
  });

  try {
    const report = buildReport(gather("0.8.0", workspace));

    assert.equal(report.mode, "release-readiness-report");
    assert.equal(report.ready, false);
    assert.equal(report.decision, "not-ready");
    assert.equal(report.boardExhausted, true);
    assert.equal(report.boardSpecAudit.decision, "no-local-safe-work");
    assert.deepEqual(report.boardSpecAudit.actionableTaskIds, []);
    assert.equal(report.boardNextScopeIntake.decision, "ready-for-operator-decision");
    assert.ok(Array.isArray(report.boardNextScopeIntake.nextScopeCandidateIds));
    assert.ok(report.releaseBlockers.some((blocker) => blocker.id === "target-version-ready"));
    assert.match(report.markdown, /specAudit: no-local-safe-work/);
    assert.match(report.markdown, /nextScopeIntake: ready-for-operator-decision/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("readiness exposes protected board recovery approval evidence when present", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
  });

  try {
    const evidencePath = path.join(workspace, ".artifacts", "agent-run-driver", "pi-provider-protected-board-recovery-approval.json");
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, JSON.stringify({
      mode: "agent-run-driver-fanout-recovery-approval",
      schemaVersion: 1,
      decision: "approval-required",
      sourceDecision: "next-action-ready",
      approvalScope: "protected-or-external-scope",
      dispatchAllowed: false,
      processStartAllowed: false,
      automationAllowed: false,
      selectedWorker: {
        workerId: "task-bud-480",
        runId: "protected-board-research-0-8-task-bud-480",
        failureKind: "worker-output-fail",
      },
      requiredApprovalPrompt: "approve recovery rerun protected-board-research-0-8-task-bud-480",
      operatorApprovalMatched: false,
      singleRunOnly: true,
      blockers: [],
      summary: "agent-run-driver-fanout-recovery-approval: decision=approval-required source=.artifacts/agent-run-driver/pi-provider-protected-board-recovery-next.json selected=task-bud-480 dispatch=no",
    }, null, 2));

    const data = gather("0.8.0", workspace);

    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryApprovalEvidence.present, true);
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryApprovalEvidence.decision, "approval-required");
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryApprovalEvidence.mode, "agent-run-driver-fanout-recovery-approval");
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryApprovalEvidence.sourceDecision, "next-action-ready");
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryApprovalEvidence.approvalScope, "protected-or-external-scope");
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryApprovalEvidence.selectedWorkerId, "task-bud-480");
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryApprovalEvidence.selectedRunId, "protected-board-research-0-8-task-bud-480");
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryApprovalEvidence.failureKind, "worker-output-fail");
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryApprovalEvidence.requiredApprovalPrompt, "approve recovery rerun protected-board-research-0-8-task-bud-480");
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryApprovalEvidence.operatorApprovalMatched, false);
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryApprovalEvidence.singleRunOnly, true);
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryApprovalEvidence.dispatchAllowed, false);
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryApprovalEvidence.processStartAllowed, false);
    assert.equal(data.agentRunDrivers.providerProtectedBoardRecoveryApprovalEvidence.automationAllowed, false);
    assert.deepEqual(data.agentRunDrivers.providerProtectedBoardRecoveryApprovalEvidence.blockers, []);
    assert.equal(data.agentRunDrivers.ok, true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("agent-run driver gate rejects protected board plan workers without local evidence source", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
  });

  try {
    const evidencePath = path.join(workspace, ".artifacts", "agent-run-driver", "pi-provider-protected-board-fanout-plan.json");
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, JSON.stringify({
      mode: "agent-run-pi-provider-fanout-plan",
      schemaVersion: 1,
      decision: "ready-for-operator-decision",
      source: "protected-board",
      batchId: "protected-board-research-0-8",
      model: "openai-codex/gpt-5.3-codex-spark",
      requireLocalTaskEvidence: true,
      workerCount: 2,
      workerPackets: [
        { taskId: "TASK-BUD-480", declaredFilesSource: "local-task-evidence" },
        { taskId: "TASK-BUD-521", declaredFilesSource: "research-docs-fallback" },
      ],
      boardSelection: {
        selectedTaskIds: ["TASK-BUD-480", "TASK-BUD-521"],
      },
      dispatchAllowed: false,
      processStartAllowed: false,
      batchExecutionAllowed: false,
      blockers: [],
      summary: "agent-run-pi-provider-fanout-plan: decision=ready-for-operator-decision source=protected-board workers=2 dispatch=no",
    }, null, 2));

    const data = gather("0.8.0", workspace);
    const report = buildReport(data);

    assert.equal(data.agentRunDrivers.providerProtectedBoardPlanEvidence.requireLocalTaskEvidence, true);
    assert.deepEqual(data.agentRunDrivers.providerProtectedBoardPlanEvidence.workerDeclaredFilesSources, [
      "local-task-evidence",
      "research-docs-fallback",
    ]);
    assert.equal(data.agentRunDrivers.protectedBoardPlanLocalEvidenceSourcesOk, false);
    assert.equal(data.agentRunDrivers.protectedBoardPlanStrictGateOk, false);
    assert.equal(data.agentRunDrivers.ok, false);
    assert.match(
      report.checklist.find((item) => item.id === "agent-run-driver-gate").evidence,
      /protected board provider plan evidence must require local task evidence/,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("agent-run driver gate rejects protected board plan evidence without local task evidence", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
  });

  try {
    const evidencePath = path.join(workspace, ".artifacts", "agent-run-driver", "pi-provider-protected-board-fanout-plan.json");
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, JSON.stringify({
      mode: "agent-run-pi-provider-fanout-plan",
      schemaVersion: 1,
      decision: "ready-for-operator-decision",
      source: "protected-board",
      batchId: "protected-board-research-0-8",
      model: "openai-codex/gpt-5.3-codex-spark",
      requireLocalTaskEvidence: false,
      workerCount: 3,
      boardSelection: {
        selectedTaskIds: ["TASK-BUD-480", "TASK-BUD-521", "TASK-BUD-676"],
      },
      dispatchAllowed: false,
      processStartAllowed: false,
      batchExecutionAllowed: false,
      blockers: [],
      summary: "agent-run-pi-provider-fanout-plan: decision=ready-for-operator-decision source=protected-board workers=3 dispatch=no",
    }, null, 2));

    const data = gather("0.8.0", workspace);
    const report = buildReport(data);

    assert.equal(data.agentRunDrivers.scriptGateOk, true);
    assert.equal(data.agentRunDrivers.canarySuiteGateOk, true);
    assert.equal(data.agentRunDrivers.protectedBoardPlanStrictRequired, true);
    assert.equal(data.agentRunDrivers.protectedBoardPlanStrictGateOk, false);
    assert.equal(data.agentRunDrivers.ok, false);
    assert.ok(report.checklist.some((item) => item.id === "agent-run-driver-gate" && item.ok === false));
    assert.match(
      report.checklist.find((item) => item.id === "agent-run-driver-gate").evidence,
      /protected board provider plan evidence must require local task evidence/,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("cli strict exits non-zero when release is not ready", () => {
  const workspace = makeWorkspace({
    version: "0.7.0",
    tasks: [{ id: "TASK-P0", status: "planned", priority: "p0", description: "release blocker" }],
  });

  try {
    const result = spawnSync(process.execPath, [
      path.resolve("scripts/release-readiness-report.mjs"),
      "--target",
      "0.8.0",
      "--strict",
      "--out",
      path.join(workspace, "readiness.md"),
    ], {
      cwd: workspace,
      encoding: "utf8",
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /release-readiness-report: wrote/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("cli can write structured json for agents", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [
      {
        id: "TASK-BUD-521",
        status: "in_progress",
        priority: "p3",
        description: "external isolation influence",
      },
    ],
  });
  const evidencePath = path.join(workspace, "docs", "research", "task-bud-521-local-isolation-canary-2026-06.md");
  const outPath = path.join(workspace, "readiness.json");
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, "# canary\n");

  try {
    const result = spawnSync(process.execPath, [
      path.resolve("scripts/release-readiness-report.mjs"),
      "--target",
      "0.8.0",
      "--json",
      "--out",
      outPath,
    ], {
      cwd: workspace,
      encoding: "utf8",
    });

    assert.equal(result.status, 0);
    const json = JSON.parse(readFileSync(outPath, "utf8"));
    assert.equal(json.mode, "release-readiness-report");
    assert.equal(json.schemaVersion, 1);
    assert.match(json.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(json.markdown, /# Release readiness report v0\.8\.0/);
    assert.match(json.markdown, /decision: not-ready/);
    assert.equal(json.decision, "not-ready");
    assert.equal(json.ready, false);
    assert.deepEqual(json.versions.map((row) => row.version), ["0.8.0", "0.8.0", "0.8.0", "0.8.0", "0.8.0"]);
    assert.equal(json.versionsAligned, true);
    assert.equal(json.targetVersionReady, true);
    assert.deepEqual(json.workflows, { ci: true, publish: true, releaseDraft: true });
    assert.deepEqual(json.gates,  { worktreeClean: true, agentRunDrivers: true, packageSmoke: true, contentReview: true, packagePromise: true, agentSkills: true, userSurface: true });
    assert.equal(json.worktree.clean, true);
    assert.equal(json.worktree.trackedChangeCount, 0);
    assert.equal(json.agentRunDrivers.ok, true);
    assert.equal(json.agentRunDrivers.scriptGateOk, true);
    assert.equal(json.agentRunDrivers.canarySuiteRequired, true);
    assert.equal(json.agentRunDrivers.canarySuiteGateOk, true);
    assert.equal(json.agentRunDrivers.canarySuiteHeadMatches, true);
    assert.equal(json.agentRunDrivers.canarySuiteEvidence.decision, "pass");
    assert.equal(json.agentRunDrivers.lastCanaryEvidence.decision, "missing");
    assert.equal(json.agentRunDrivers.lastMutationCanaryEvidence.decision, "missing");
    assert.deepEqual(json.agentRunDrivers.requiredTests, [
      "scripts/test/agent-run-driver-step.test.mjs",
      "scripts/test/agent-run-pi-driver.test.mjs",
      "scripts/test/agent-run-pi-driver-payload.test.mjs",
      "scripts/test/agent-run-driver-canary.test.mjs",
      "scripts/test/agent-run-driver-canary-suite.test.mjs",
      "scripts/test/agent-run-driver-container-canary-suite.test.mjs",
      "scripts/test/agent-run-driver-fanout-manifest.test.mjs",
      "scripts/test/agent-run-driver-fanout-rehearsal.test.mjs",
      "scripts/test/agent-run-driver-fanout-outcome.test.mjs",
      "scripts/test/agent-run-driver-fanout-recovery-next.test.mjs",
      "scripts/test/agent-run-driver-fanout-recovery-approval.test.mjs",
      "scripts/test/agent-run-driver-container-fanout-rehearsal.test.mjs",
      "scripts/test/agent-run-pi-provider-fanout-plan.test.mjs",
      "scripts/test/agent-run-pi-provider-readiness.test.mjs",
      "scripts/test/agent-run-pi-provider-recovery-next.test.mjs",
      "scripts/test/agent-run-pi-provider-network-check.test.mjs",
      "scripts/test/agent-run-pi-provider-worker-dispatch.test.mjs",
      "scripts/test/agent-run-pi-provider-canary.test.mjs",
      "scripts/test/agent-run-pi-provider-container-canary.test.mjs",
    ]);
    assert.deepEqual(json.agentRunDrivers.missingTests, []);
    assert.deepEqual(json.agentRunDrivers.missingOperationalScripts, []);
    assert.deepEqual(json.agentRunDrivers.operationalScripts.map((row) => [row.name, row.present, row.missingMarkers]), [
      ["agent-run:driver-fanout-manifest", true, []],
      ["agent-run:driver-fanout-rehearsal", true, []],
      ["agent-run:driver-fanout-outcome", true, []],
      ["agent-run:driver-fanout-recovery-next", true, []],
      ["agent-run:driver-fanout-recovery-approval", true, []],
      ["agent-run:pi-provider-fanout-plan", true, []],
      ["agent-run:pi-provider-protected-board-plan", true, []],
      ["agent-run:pi-provider-protected-board-outcome", true, []],
      ["agent-run:pi-provider-protected-board-recovery-next", true, []],
      ["agent-run:pi-provider-protected-board-recovery-approval", true, []],
      ["agent-run:pi-provider-readiness", true, []],
      ["agent-run:pi-provider-recovery-next", true, []],
      ["agent-run:pi-provider-network-check", true, []],
      ["agent-run:pi-provider-canary", true, []],
      ["agent-run:pi-provider-canary:container", true, []],
      ["agent-run:pi-provider-worker-dispatch", true, []],
    ]);
    assert.equal(json.agentRunDrivers.providerReadinessEvidence.decision, "missing");
    assert.equal(json.agentRunDrivers.providerCanaryEvidence.decision, "missing");
    assert.equal(json.agentRunDrivers.providerContainerCanaryEvidence.decision, "missing");
    assert.equal(json.agentRunDrivers.providerRecoveryNextEvidence.decision, "missing");
    assert.equal(json.agentRunDrivers.providerNetworkCheckEvidence.decision, "missing");
    assert.equal(json.agentRunDrivers.providerProtectedBoardPlanEvidence.decision, "missing");
    assert.equal(json.agentRunDrivers.providerProtectedBoardOutcomeEvidence.decision, "missing");
    assert.equal(json.agentRunDrivers.providerProtectedBoardRecoveryNextEvidence.decision, "missing");
    assert.equal(json.packageSmoke.mode, "release-package-smoke-report");
    assert.equal(json.packageSmoke.decision, "pass");
    assert.deepEqual(json.packageSmoke.packageBlockers, []);
    assert.equal(json.agentSkills.mode, "agent-skills-compat-audit");
    assert.equal(json.agentSkills.decision, "pass");
    assert.equal(json.agentSkills.skillCount, 0);
    assert.equal(json.userSurface.mode, "pi-stack-user-surface-readiness");
    assert.equal(json.userSurface.ok, true);
    assert.equal(json.userSurface.labOnlyCount, 0);
    assert.equal(json.userSurface.distributionCandidateCount, 0);
    assert.deepEqual(json.checklist.map((item) => [item.id, item.kind]), [
      ["versions-aligned", "technical-gate"],
      ["target-version-ready", "operator-decision"],
      ["git-worktree-clean", "technical-gate"],
      ["workflow-ci", "technical-gate"],
      ["workflow-publish", "technical-gate"],
      ["workflow-release-draft", "technical-gate"],
      ["agent-run-driver-gate", "technical-gate"],
      ["release-package-smoke", "technical-gate"],
      ["release-content-review", "operator-decision"],
      ["package-promise-audit", "technical-gate"],
      ["agent-skills-compat", "technical-gate"],
      ["pi-stack-user-surface", "technical-gate"],
      ["board-release-clear", "board-state"],
    ]);
    assert.deepEqual(json.releaseBlockers.map((blocker) => blocker.id), ["board-release-clear"]);
    assert.deepEqual(json.releaseBlockers.map((blocker) => blocker.kind), ["board-state"]);
    assert.deepEqual(json.operatorDecisions.map((decision) => decision.id), ["decide-board-evidence-candidates"]);
    assert.equal(json.operatorDecisions[0].target, "0.8.0");
    assert.deepEqual(json.operatorDecisions[0].allowedActions, ["park-for-target-release", "require-work"]);
    assert.deepEqual(json.operatorDecisions[0].candidateTaskIds, ["TASK-BUD-521"]);
    assert.deepEqual(json.operatorDecisions[0].evidenceCandidateRows.map((row) => row.taskId), ["TASK-BUD-521"]);
    assert.equal(json.operatorDecisions[0].boardReleaseDispositionPacket.mode, "board-release-disposition-packet");
    assert.equal(json.operatorDecisions[0].boardReleaseDispositionPacket.recommendedBulkAction, "park-for-target-release");
    assert.equal(json.operatorDecisions[0].boardReleaseDispositionPacket.requiredApprovalPrompt, "approve board release disposition park-for-target-release TASK-BUD-521");
    assert.deepEqual(json.operatorDecisions[0].boardReleaseDispositionPacket.dispositionRows.map((row) => row.recommendedAction), ["park-for-target-release"]);
    assert.deepEqual(json.operatorDecisions[0].boardReleaseDispositionPacket.dispositionRows.map((row) => row.approvalPrompt), ["approve board release disposition park-for-target-release TASK-BUD-521"]);
    assert.equal(json.nextActionCode, "resolve-operator-decisions");
    assert.deepEqual(json.nextActions.map((action) => action.id), ["decide-board-evidence-candidates"]);
    assert.deepEqual(json.nextActions[0].allowedActions, ["park-for-target-release", "require-work"]);
    assert.equal(json.nextActions[0].boardReleaseDispositionPacket.mode, "board-release-disposition-packet");
    assert.equal(json.nextActions[0].boardReleaseDispositionPacket.requiredApprovalPrompt, "approve board release disposition park-for-target-release TASK-BUD-521");
    assert.equal(json.nextActions[0].requiresOperatorDecision, true);
    assert.equal(json.nextActions[0].automationAllowed, false);
    assert.deepEqual(json.automationPermissions, {
      tagAllowed: false,
      publishAllowed: false,
      workflowDispatchAllowed: false,
      processStartAllowed: false,
    });
    assert.equal(json.board.releaseDecisionReady, true);
    assert.deepEqual(json.board.inProgressRows.map((row) => row.taskId), ["TASK-BUD-521"]);
    assert.deepEqual(json.board.evidenceCandidateRows.map((row) => row.taskId), ["TASK-BUD-521"]);
    assert.equal(json.board.evidenceCandidateRows[0].evidencePresent, true);
    assert.equal("inProgress" in json.board, false);
    assert.equal("evidenceCandidates" in json.board, false);
    assert.ok(json.checklist.some((item) => item.id === "board-release-clear" && item.ok === false));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
