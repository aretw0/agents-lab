#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { buildReleasePackageSmokeReport } from "./release-package-smoke.mjs";
import { buildReleaseContentReviewAudit } from "./release-content-review-audit.mjs";
import { buildPackagePromiseAudit } from "./package-promise-audit.mjs";
import { buildAgentSkillsCompatAudit } from "./agent-skills-compat-audit.mjs";
import { buildUserSurfaceAudit } from "./pi-stack-user-surface-audit.mjs";
import { buildBoardSpecAudit } from "./project/board-spec-audit.mjs";
import { buildBoardNextScopeIntake } from "./project/board-next-scope-intake.mjs";

const PACKAGES = [
  "packages/pi-stack/package.json",
  "packages/git-skills/package.json",
  "packages/web-skills/package.json",
  "packages/pi-skills/package.json",
  "packages/lab-skills/package.json",
];

const AGENT_RUN_DRIVER_GATE_TESTS = [
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
];
const AGENT_RUN_DRIVER_CANARY_SCRIPT = "agent-run:driver-canaries";
const AGENT_RUN_DRIVER_CANARY_SCRIPT_MARKERS = [
  "node scripts/agent-run-driver-canary-suite.mjs",
  "--execute",
  ".artifacts/agent-run-driver/suite.json",
];
const AGENT_RUN_DRIVER_OPERATIONAL_SCRIPTS = {
  "agent-run:driver-fanout-manifest": [
    "node scripts/agent-run-driver-fanout-manifest.mjs",
    ".artifacts/agent-run-driver/fanout-manifest.json",
  ],
  "agent-run:driver-fanout-rehearsal": [
    "node scripts/agent-run-driver-fanout-rehearsal.mjs",
    "--execute",
    ".artifacts/agent-run-driver/fanout-rehearsal.json",
  ],
  "agent-run:driver-fanout-outcome": [
    "node scripts/agent-run-driver-fanout-outcome.mjs",
    ".artifacts/agent-run-driver/fanout-outcome.json",
  ],
  "agent-run:driver-fanout-recovery-next": [
    "node scripts/agent-run-driver-fanout-recovery-next.mjs",
    ".artifacts/agent-run-driver/fanout-recovery-next.json",
  ],
  "agent-run:driver-fanout-recovery-approval": [
    "node scripts/agent-run-driver-fanout-recovery-approval.mjs",
    ".artifacts/agent-run-driver/fanout-recovery-approval.json",
  ],
  "agent-run:pi-provider-fanout-plan": [
    "node scripts/agent-run-pi-provider-fanout-plan.mjs",
    ".artifacts/agent-run-driver/pi-provider-fanout-plan.json",
  ],
  "agent-run:pi-provider-protected-board-plan": [
    "node scripts/agent-run-pi-provider-fanout-plan.mjs",
    "--from-board-protected",
    "--require-local-task-evidence",
    ".artifacts/agent-run-driver/pi-provider-protected-board-fanout-plan.json",
  ],
  "agent-run:pi-provider-protected-board-outcome": [
    "node scripts/agent-run-driver-fanout-outcome.mjs",
    ".artifacts/agent-run-driver/pi-provider-protected-board-fanout-plan.json",
    ".artifacts/agent-run-driver/pi-provider-protected-board-fanout-outcome.json",
    "--exit-zero-on-block",
  ],
  "agent-run:pi-provider-protected-board-recovery-next": [
    "node scripts/agent-run-driver-fanout-recovery-next.mjs",
    ".artifacts/agent-run-driver/pi-provider-protected-board-fanout-outcome.json",
    ".artifacts/agent-run-driver/pi-provider-protected-board-recovery-next.json",
  ],
  "agent-run:pi-provider-protected-board-recovery-approval": [
    "node scripts/agent-run-driver-fanout-recovery-approval.mjs",
    ".artifacts/agent-run-driver/pi-provider-protected-board-recovery-next.json",
    ".artifacts/agent-run-driver/pi-provider-protected-board-recovery-approval.json",
  ],
  "agent-run:pi-provider-readiness": [
    "node scripts/agent-run-pi-provider-readiness.mjs",
    ".artifacts/agent-run-driver/pi-provider-readiness.json",
  ],
  "agent-run:pi-provider-recovery-next": [
    "node scripts/agent-run-pi-provider-recovery-next.mjs",
    ".artifacts/agent-run-driver/pi-provider-recovery-next.json",
  ],
  "agent-run:pi-provider-network-check": [
    "node scripts/agent-run-pi-provider-network-check.mjs",
    ".artifacts/agent-run-driver/pi-provider-network-check.json",
  ],
  "agent-run:pi-provider-canary": [
    "node scripts/agent-run-pi-provider-canary.mjs",
    ".artifacts/agent-run-driver/pi-provider-canary.json",
  ],
  "agent-run:pi-provider-canary:container": [
    "node scripts/agent-run-pi-provider-container-canary.mjs",
  ],
  "agent-run:pi-provider-worker-dispatch": [
    "node scripts/agent-run-pi-provider-worker-dispatch.mjs",
  ],
};

const BOARD_RELEASE_EVIDENCE = {
  "TASK-BUD-480": {
    kind: "external-influence-agent-patterns",
    evidencePath: "docs/research/task-bud-480-local-agent-patterns-canary-2026-06.md",
    decision: "operator-may-park-for-target-release",
  },
  "TASK-BUD-521": {
    kind: "external-influence-isolation",
    evidencePath: "docs/research/task-bud-521-local-isolation-canary-2026-06.md",
    decision: "operator-may-park-for-target-release",
  },
  "TASK-BUD-676": {
    kind: "external-influence-memory",
    evidencePath: "docs/research/task-bud-676-local-memory-canary-2026-06.md",
    decision: "operator-may-park-for-target-release",
  },
};

const REPORT_ONLY_PERMISSIONS = {
  tagAllowed: false,
  publishAllowed: false,
  workflowDispatchAllowed: false,
  processStartAllowed: false,
};

function runGit(args, cwd = process.cwd()) {
  const out = spawnSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
  if (out.status !== 0) return "";
  return String(out.stdout ?? "").trim();
}

function gitWorktreeStatus(cwd, head) {
  if (!head) {
    return {
      gitAvailable: false,
      clean: true,
      trackedChangeCount: 0,
      statusLines: [],
      summary: "git head unavailable; worktree clean gate not applicable",
    };
  }
  const status = runGit(["status", "--short", "--untracked-files=no"], cwd);
  const statusLines = status ? status.split(/\r?\n/).filter(Boolean) : [];
  return {
    gitAvailable: true,
    clean: statusLines.length === 0,
    trackedChangeCount: statusLines.length,
    statusLines,
    summary: statusLines.length === 0
      ? "tracked worktree clean"
      : `tracked worktree has ${statusLines.length} change(s)`,
  };
}

function readJson(cwd, relPath) {
  return JSON.parse(readFileSync(path.join(cwd, relPath), "utf8"));
}

function hasRootScript(cwd, scriptName) {
  const packagePath = path.join(cwd, "package.json");
  if (!existsSync(packagePath)) return false;
  const json = JSON.parse(readFileSync(packagePath, "utf8"));
  return typeof json?.scripts?.[scriptName] === "string" && json.scripts[scriptName].trim().length > 0;
}

function rootScript(cwd, scriptName) {
  const packagePath = path.join(cwd, "package.json");
  if (!existsSync(packagePath)) return "";
  const json = JSON.parse(readFileSync(packagePath, "utf8"));
  return typeof json?.scripts?.[scriptName] === "string" ? json.scripts[scriptName].trim() : "";
}

function hasAgentRunDriverGate(cwd) {
  const script = rootScript(cwd, "test:agent-run:drivers");
  const canaryScript = rootScript(cwd, AGENT_RUN_DRIVER_CANARY_SCRIPT);
  return hasRootScript(cwd, "test:agent-run:drivers")
    && script.includes("node --test")
    && AGENT_RUN_DRIVER_GATE_TESTS.every((testPath) => script.includes(testPath))
    && hasRootScript(cwd, AGENT_RUN_DRIVER_CANARY_SCRIPT)
    && AGENT_RUN_DRIVER_CANARY_SCRIPT_MARKERS.every((marker) => canaryScript.includes(marker));
}

function agentRunDriverGateReport(cwd) {
  const script = rootScript(cwd, "test:agent-run:drivers");
  const canaryScript = rootScript(cwd, AGENT_RUN_DRIVER_CANARY_SCRIPT);
  const missingTests = AGENT_RUN_DRIVER_GATE_TESTS.filter((testPath) => !script.includes(testPath));
  const nodeTest = script.includes("node --test");
  const scriptPresent = hasRootScript(cwd, "test:agent-run:drivers");
  const missingCanaryScriptMarkers = AGENT_RUN_DRIVER_CANARY_SCRIPT_MARKERS.filter((marker) => !canaryScript.includes(marker));
  const canaryScriptPresent = hasRootScript(cwd, AGENT_RUN_DRIVER_CANARY_SCRIPT);
  const operationalScripts = Object.entries(AGENT_RUN_DRIVER_OPERATIONAL_SCRIPTS).map(([name, markers]) => {
    const value = rootScript(cwd, name);
    return {
      name,
      present: hasRootScript(cwd, name),
      script: value,
      requiredMarkers: markers,
      missingMarkers: markers.filter((marker) => !value.includes(marker)),
    };
  });
  const missingOperationalScripts = operationalScripts
    .filter((row) => !row.present || row.missingMarkers.length > 0)
    .map((row) => row.name);
  const scriptGateOk = scriptPresent
    && nodeTest
    && missingTests.length === 0
    && canaryScriptPresent
    && missingCanaryScriptMarkers.length === 0
    && missingOperationalScripts.length === 0;
  return {
    ok: scriptGateOk,
    scriptGateOk,
    scriptName: "test:agent-run:drivers",
    script,
    nodeTest,
    requiredTests: AGENT_RUN_DRIVER_GATE_TESTS,
    missingTests,
    canaryScriptName: AGENT_RUN_DRIVER_CANARY_SCRIPT,
    canaryScript,
    canaryScriptPresent,
    requiredCanaryScriptMarkers: AGENT_RUN_DRIVER_CANARY_SCRIPT_MARKERS,
    missingCanaryScriptMarkers,
    operationalScripts,
    missingOperationalScripts,
  };
}

function agentRunDriverCanaryEvidence(cwd, relPath = ".artifacts/agent-run-driver/latest.json") {
  const fullPath = path.join(cwd, relPath);
  if (!existsSync(fullPath)) {
    return {
      path: relPath,
      present: false,
      decision: "missing",
      summary: "no local agent-run driver canary artifact found",
    };
  }
  try {
    const payload = JSON.parse(readFileSync(fullPath, "utf8"));
    const driverStep = payload.driverStep ?? payload;
    const outcome = payload.agentRunOutcomePacket ?? driverStep.agentRunOutcomePacket;
    const contractDecision = payload.contractDecision ?? outcome?.contractDecision;
    const runId = payload.runId ?? driverStep.runSpec?.runId;
    const followTerminal = payload.followTerminal === true || driverStep.follow?.terminal === true;
    const decision = contractDecision === "pass" && followTerminal ? "pass" : "review";
    return {
      path: relPath,
      present: true,
      decision,
      mode: payload.mode,
      schemaVersion: payload.schemaVersion,
      runId,
      followTerminal,
      contractDecision,
      outputBytes: payload.outputBytes ?? driverStep.follow?.outputBytes,
      summary: payload.summary ?? driverStep.summary ?? "agent-run driver canary artifact present",
    };
  } catch (error) {
    return {
      path: relPath,
      present: true,
      decision: "invalid-json",
      summary: `could not parse local agent-run driver canary artifact: ${String(error?.message ?? error)}`,
    };
  }
}

function agentRunDriverCanarySuiteEvidence(cwd) {
  const relPath = ".artifacts/agent-run-driver/suite.json";
  const fullPath = path.join(cwd, relPath);
  if (!existsSync(fullPath)) {
    return {
      path: relPath,
      present: false,
      decision: "missing",
      summary: "no local agent-run driver canary suite artifact found",
    };
  }
  try {
    const payload = JSON.parse(readFileSync(fullPath, "utf8"));
    return {
      path: relPath,
      present: true,
      decision: payload.decision === "pass" ? "pass" : "review",
      mode: payload.mode,
      schemaVersion: payload.schemaVersion,
      generatedAtIso: payload.generatedAtIso,
      gitHead: payload.gitHead,
      readOnlyDecision: payload.canaries?.readOnly?.contractDecision,
      mutationDecision: payload.canaries?.mutation?.contractDecision,
      blockers: Array.isArray(payload.blockers) ? payload.blockers : [],
      summary: payload.summary ?? "agent-run driver canary suite artifact present",
    };
  } catch (error) {
    return {
      path: relPath,
      present: true,
      decision: "invalid-json",
      summary: `could not parse local agent-run driver canary suite artifact: ${String(error?.message ?? error)}`,
    };
  }
}

function agentRunProviderReadinessEvidence(cwd) {
  const relPath = ".artifacts/agent-run-driver/pi-provider-readiness.json";
  const fullPath = path.join(cwd, relPath);
  if (!existsSync(fullPath)) {
    return {
      path: relPath,
      present: false,
      decision: "missing",
      summary: "no provider readiness artifact found",
    };
  }
  try {
    const payload = JSON.parse(readFileSync(fullPath, "utf8"));
    return {
      path: relPath,
      present: true,
      decision: payload.decision ?? "unknown",
      mode: payload.mode,
      schemaVersion: payload.schemaVersion,
      model: payload.model,
      lastExecutionSource: payload.lastExecutionSource,
      blockers: Array.isArray(payload.blockers) ? payload.blockers : [],
      providerDiagnostics: Array.isArray(payload.providerDiagnostics) ? payload.providerDiagnostics : [],
      providerRecoveryPlan: payload.providerRecoveryPlan && typeof payload.providerRecoveryPlan === "object"
        ? payload.providerRecoveryPlan
        : undefined,
      nextActions: Array.isArray(payload.nextActions) ? payload.nextActions : [],
      summary: payload.summary ?? "provider readiness artifact present",
    };
  } catch (error) {
    return {
      path: relPath,
      present: true,
      decision: "invalid-json",
      summary: `could not parse provider readiness artifact: ${String(error?.message ?? error)}`,
    };
  }
}

function agentRunProviderCanaryEvidence(cwd) {
  const relPath = ".artifacts/agent-run-driver/pi-provider-canary.json";
  const fullPath = path.join(cwd, relPath);
  if (!existsSync(fullPath)) {
    return {
      path: relPath,
      present: false,
      decision: "missing",
      summary: "no provider canary artifact found",
    };
  }
  try {
    const payload = JSON.parse(readFileSync(fullPath, "utf8"));
    return {
      path: relPath,
      present: true,
      decision: payload.decision ?? "unknown",
      mode: payload.mode,
      schemaVersion: payload.schemaVersion,
      runId: payload.runId,
      workerId: payload.workerId,
      executeRequested: payload.executeRequested === true,
      dispatchAllowed: payload.dispatchAllowed === true,
      processStartAllowed: payload.processStartAllowed === true,
      contractDecision: payload.agentRunOutcomePacket?.contractDecision,
      blockers: Array.isArray(payload.blockers) ? payload.blockers : [],
      providerDiagnostics: Array.isArray(payload.providerDiagnostics) ? payload.providerDiagnostics : [],
      providerRecoveryPlan: payload.providerRecoveryPlan && typeof payload.providerRecoveryPlan === "object"
        ? payload.providerRecoveryPlan
        : undefined,
      nextActions: Array.isArray(payload.nextActions) ? payload.nextActions : [],
      summary: payload.summary ?? "provider canary artifact present",
    };
  } catch (error) {
    return {
      path: relPath,
      present: true,
      decision: "invalid-json",
      summary: `could not parse provider canary artifact: ${String(error?.message ?? error)}`,
    };
  }
}

function agentRunProviderContainerCanaryEvidence(cwd) {
  const relPath = ".artifacts/agent-run-driver/pi-provider-container-canary-report.json";
  const fullPath = path.join(cwd, relPath);
  if (!existsSync(fullPath)) {
    return {
      path: relPath,
      present: false,
      decision: "missing",
      summary: "no provider container canary artifact found",
    };
  }
  try {
    const payload = JSON.parse(readFileSync(fullPath, "utf8"));
    const providerRecoveryPlan = payload.providerRecoveryPlan && typeof payload.providerRecoveryPlan === "object"
      ? payload.providerRecoveryPlan
      : payload.canaryReport?.providerRecoveryPlan && typeof payload.canaryReport.providerRecoveryPlan === "object"
        ? payload.canaryReport.providerRecoveryPlan
        : undefined;
    return {
      path: relPath,
      present: true,
      decision: payload.decision ?? "unknown",
      mode: payload.mode,
      schemaVersion: payload.schemaVersion,
      container: payload.container,
      executeRequested: payload.executeRequested === true,
      dispatchAllowed: payload.dispatchAllowed === true,
      processStartAllowed: payload.processStartAllowed === true,
      canaryDecision: payload.canaryReport?.decision,
      canaryPath: payload.canaryOutPath,
      blockers: Array.isArray(payload.blockers) ? payload.blockers : [],
      providerDiagnostics: Array.isArray(payload.providerDiagnostics) ? payload.providerDiagnostics : [],
      providerRecoveryPlan,
      summary: payload.summary ?? "provider container canary artifact present",
    };
  } catch (error) {
    return {
      path: relPath,
      present: true,
      decision: "invalid-json",
      summary: `could not parse provider container canary artifact: ${String(error?.message ?? error)}`,
    };
  }
}

function agentRunProviderRecoveryNextEvidence(cwd) {
  const relPath = ".artifacts/agent-run-driver/pi-provider-recovery-next.json";
  const fullPath = path.join(cwd, relPath);
  if (!existsSync(fullPath)) {
    return {
      path: relPath,
      present: false,
      decision: "missing",
      summary: "no provider recovery next artifact found",
    };
  }
  try {
    const payload = JSON.parse(readFileSync(fullPath, "utf8"));
    return {
      path: relPath,
      present: true,
      decision: payload.decision ?? "unknown",
      mode: payload.mode,
      schemaVersion: payload.schemaVersion,
      sourcePath: payload.sourcePath,
      sourceDecision: payload.sourceDecision,
      actionCount: payload.actionCount,
      actionStage: payload.actionStage,
      nextAction: payload.nextAction && typeof payload.nextAction === "object"
        ? payload.nextAction
        : undefined,
      selectedCommandPreview: payload.selectedCommandPreview && typeof payload.selectedCommandPreview === "object"
        ? payload.selectedCommandPreview
        : undefined,
      providerNetworkCheck: payload.providerNetworkCheck && typeof payload.providerNetworkCheck === "object"
        ? payload.providerNetworkCheck
        : undefined,
      commandPreviews: payload.commandPreviews && typeof payload.commandPreviews === "object"
        ? payload.commandPreviews
        : {},
      blockers: Array.isArray(payload.blockers) ? payload.blockers : [],
      summary: payload.summary ?? "provider recovery next artifact present",
    };
  } catch (error) {
    return {
      path: relPath,
      present: true,
      decision: "invalid-json",
      summary: `could not parse provider recovery next artifact: ${String(error?.message ?? error)}`,
    };
  }
}

function agentRunProviderNetworkCheckEvidence(cwd) {
  const relPath = ".artifacts/agent-run-driver/pi-provider-network-check.json";
  const fullPath = path.join(cwd, relPath);
  if (!existsSync(fullPath)) {
    return {
      path: relPath,
      present: false,
      decision: "missing",
      summary: "no provider network check artifact found",
    };
  }
  try {
    const payload = JSON.parse(readFileSync(fullPath, "utf8"));
    return {
      path: relPath,
      present: true,
      decision: payload.decision ?? "unknown",
      mode: payload.mode,
      schemaVersion: payload.schemaVersion,
      executeRequested: payload.executeRequested === true,
      networkRequestAllowed: payload.networkRequestAllowed === true,
      endpointHost: payload.endpointHost,
      timeoutMs: payload.timeoutMs,
      httpStatus: payload.httpStatus,
      networkDecision: payload.networkDecision,
      blockers: Array.isArray(payload.blockers) ? payload.blockers : [],
      warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
      summary: payload.summary ?? "provider network check artifact present",
    };
  } catch (error) {
    return {
      path: relPath,
      present: true,
      decision: "invalid-json",
      summary: `could not parse provider network check artifact: ${String(error?.message ?? error)}`,
    };
  }
}

function agentRunProviderProtectedBoardPlanEvidence(cwd) {
  const relPath = ".artifacts/agent-run-driver/pi-provider-protected-board-fanout-plan.json";
  const fullPath = path.join(cwd, relPath);
  if (!existsSync(fullPath)) {
    return {
      path: relPath,
      present: false,
      decision: "missing",
      summary: "no protected board provider fanout plan artifact found",
    };
  }
  try {
    const payload = JSON.parse(readFileSync(fullPath, "utf8"));
    return {
      path: relPath,
      present: true,
      decision: payload.decision ?? "unknown",
      mode: payload.mode,
      schemaVersion: payload.schemaVersion,
      source: payload.source,
      batchId: payload.batchId,
      model: payload.model,
      requireLocalTaskEvidence: payload.requireLocalTaskEvidence === true,
      workerCount: payload.workerCount,
      workerDeclaredFilesSources: Array.isArray(payload.workerPackets)
        ? payload.workerPackets.map((packet) => String(packet?.declaredFilesSource ?? "unknown"))
        : [],
      selectedTaskIds: Array.isArray(payload.boardSelection?.selectedTaskIds) ? payload.boardSelection.selectedTaskIds : [],
      dispatchAllowed: payload.dispatchAllowed === true,
      processStartAllowed: payload.processStartAllowed === true,
      batchExecutionAllowed: payload.batchExecutionAllowed === true,
      blockers: Array.isArray(payload.blockers) ? payload.blockers : [],
      summary: payload.summary ?? "protected board provider fanout plan artifact present",
    };
  } catch (error) {
    return {
      path: relPath,
      present: true,
      decision: "invalid-json",
      summary: `could not parse protected board provider fanout plan artifact: ${String(error?.message ?? error)}`,
    };
  }
}

function agentRunProviderProtectedBoardOutcomeEvidence(cwd) {
  const relPath = ".artifacts/agent-run-driver/pi-provider-protected-board-fanout-outcome.json";
  const fullPath = path.join(cwd, relPath);
  if (!existsSync(fullPath)) {
    return {
      path: relPath,
      present: false,
      decision: "missing",
      summary: "no protected board provider fanout outcome artifact found",
    };
  }
  try {
    const payload = JSON.parse(readFileSync(fullPath, "utf8"));
    return {
      path: relPath,
      present: true,
      decision: payload.decision ?? "unknown",
      mode: payload.mode,
      schemaVersion: payload.schemaVersion,
      batchId: payload.batchId,
      workerCount: payload.workerCount,
      passedWorkerCount: payload.passedWorkerCount,
      dispatchAllowed: payload.dispatchAllowed === true,
      processStartAllowed: payload.processStartAllowed === true,
      batchExecutionAllowed: payload.batchExecutionAllowed === true,
      workerContractDecisions: Array.isArray(payload.workerSummaries)
        ? payload.workerSummaries.map((worker) => String(worker?.contractDecision ?? "unknown"))
        : [],
      blockers: Array.isArray(payload.blockers) ? payload.blockers : [],
      summary: payload.summary ?? "protected board provider fanout outcome artifact present",
    };
  } catch (error) {
    return {
      path: relPath,
      present: true,
      decision: "invalid-json",
      summary: `could not parse protected board provider fanout outcome artifact: ${String(error?.message ?? error)}`,
    };
  }
}

function agentRunProviderProtectedBoardRecoveryNextEvidence(cwd) {
  const relPath = ".artifacts/agent-run-driver/pi-provider-protected-board-recovery-next.json";
  const fullPath = path.join(cwd, relPath);
  if (!existsSync(fullPath)) {
    return {
      path: relPath,
      present: false,
      decision: "missing",
      summary: "no protected board provider recovery next artifact found",
    };
  }
  try {
    const payload = JSON.parse(readFileSync(fullPath, "utf8"));
    return {
      path: relPath,
      present: true,
      decision: payload.decision ?? "unknown",
      mode: payload.mode,
      schemaVersion: payload.schemaVersion,
      batchId: payload.batchId,
      sourceDecision: payload.sourceDecision,
      failedWorkerCount: payload.failedWorkerCount,
      selectedWorkerId: payload.selectedWorker?.workerId,
      selectedRunId: payload.selectedWorker?.runId,
      failureKind: payload.failureKind,
      dispatchAllowed: payload.dispatchAllowed === true,
      processStartAllowed: payload.processStartAllowed === true,
      automationAllowed: payload.automationAllowed === true,
      blockers: Array.isArray(payload.blockers) ? payload.blockers : [],
      summary: payload.summary ?? "protected board provider recovery next artifact present",
    };
  } catch (error) {
    return {
      path: relPath,
      present: true,
      decision: "invalid-json",
      summary: `could not parse protected board provider recovery next artifact: ${String(error?.message ?? error)}`,
    };
  }
}

function agentRunProviderProtectedBoardRecoveryApprovalEvidence(cwd) {
  const relPath = ".artifacts/agent-run-driver/pi-provider-protected-board-recovery-approval.json";
  const fullPath = path.join(cwd, relPath);
  if (!existsSync(fullPath)) {
    return {
      path: relPath,
      present: false,
      decision: "missing",
      summary: "no protected board provider recovery approval artifact found",
    };
  }
  try {
    const payload = JSON.parse(readFileSync(fullPath, "utf8"));
    return {
      path: relPath,
      present: true,
      decision: payload.decision ?? "unknown",
      mode: payload.mode,
      schemaVersion: payload.schemaVersion,
      sourceDecision: payload.sourceDecision,
      approvalScope: payload.approvalScope,
      selectedWorkerId: payload.selectedWorker?.workerId,
      selectedRunId: payload.selectedWorker?.runId,
      failureKind: payload.selectedWorker?.failureKind,
      requiredApprovalPrompt: payload.requiredApprovalPrompt,
      operatorApprovalMatched: payload.operatorApprovalMatched === true,
      singleRunOnly: payload.singleRunOnly === true,
      dispatchAllowed: payload.dispatchAllowed === true,
      processStartAllowed: payload.processStartAllowed === true,
      automationAllowed: payload.automationAllowed === true,
      blockers: Array.isArray(payload.blockers) ? payload.blockers : [],
      summary: payload.summary ?? "protected board provider recovery approval artifact present",
    };
  } catch (error) {
    return {
      path: relPath,
      present: true,
      decision: "invalid-json",
      summary: `could not parse protected board provider recovery approval artifact: ${String(error?.message ?? error)}`,
    };
  }
}

function releaseGateKind(id) {
  if (id === "target-version-ready") return "operator-decision";
  if (id === "release-content-review") return "operator-decision";
  if (id === "board-release-clear") return "board-state";
  return "technical-gate";
}

function releaseBlockerRow(item) {
  return {
    id: item.id,
    kind: item.kind,
    evidence: item.evidence,
  };
}

function agentRunDriverGateEvidence(report) {
  const blockers = [
    ...(report.missingTests.length ? [`missing tests ${report.missingTests.join(", ")}`] : []),
    ...(!report.canaryScriptPresent ? [`missing script ${report.canaryScriptName}`] : []),
    ...(report.missingCanaryScriptMarkers.length ? [`${report.canaryScriptName} missing ${report.missingCanaryScriptMarkers.join(", ")}`] : []),
    ...(report.missingOperationalScripts?.length ? [`missing operational scripts ${report.missingOperationalScripts.join(", ")}`] : []),
    ...(report.canarySuiteRequired === true && report.canarySuiteGateOk !== true
      ? [`canary suite evidence must pass at ${report.canarySuiteEvidence?.path ?? ".artifacts/agent-run-driver/suite.json"} (decision=${report.canarySuiteEvidence?.decision ?? "missing"})`]
      : []),
    ...(report.canarySuiteRequired === true && report.canarySuiteHeadMatches !== true
      ? [`canary suite evidence is stale for head ${report.currentHead || "unknown"} (artifact=${report.canarySuiteEvidence?.gitHead || "missing"})`]
      : []),
    ...(report.protectedBoardPlanStrictRequired === true && report.protectedBoardPlanStrictGateOk !== true
      ? [`protected board provider plan evidence must require local task evidence at ${report.providerProtectedBoardPlanEvidence?.path ?? ".artifacts/agent-run-driver/pi-provider-protected-board-fanout-plan.json"}`]
      : []),
  ];
  if (blockers.length) return blockers.join("; ");
  return [
    `package.json scripts.test:agent-run:drivers includes ${report.requiredTests.join(", ")}`,
    `${report.canaryScriptName} writes .artifacts/agent-run-driver/suite.json`,
    "agent-run driver canary suite evidence passed",
    `provider readiness evidence decision=${report.providerReadinessEvidence?.decision ?? "missing"}`,
    `provider container canary evidence decision=${report.providerContainerCanaryEvidence?.decision ?? "missing"}`,
    `provider recovery next evidence decision=${report.providerRecoveryNextEvidence?.decision ?? "missing"}`,
    `provider network check evidence decision=${report.providerNetworkCheckEvidence?.decision ?? "missing"}`,
    `protected board provider plan decision=${report.providerProtectedBoardPlanEvidence?.decision ?? "missing"} workers=${report.providerProtectedBoardPlanEvidence?.workerCount ?? 0}`,
    `protected board provider outcome decision=${report.providerProtectedBoardOutcomeEvidence?.decision ?? "missing"} passed=${report.providerProtectedBoardOutcomeEvidence?.passedWorkerCount ?? 0}/${report.providerProtectedBoardOutcomeEvidence?.workerCount ?? 0}`,
    `protected board recovery next decision=${report.providerProtectedBoardRecoveryNextEvidence?.decision ?? "missing"} selected=${report.providerProtectedBoardRecoveryNextEvidence?.selectedWorkerId ?? "none"}`,
    `protected board recovery approval decision=${report.providerProtectedBoardRecoveryApprovalEvidence?.decision ?? "missing"} prompt=${report.providerProtectedBoardRecoveryApprovalEvidence?.requiredApprovalPrompt ?? "none"}`,
  ].join("; ");
}

function userSurfaceReadiness(cwd) {
  const audit = buildUserSurfaceAudit(cwd);
  const labOnlyScripts = audit.labOnlyScripts.map((row) => row.name);
  const distributionCandidates = audit.distributionCandidates.map((row) => row.name);
  const missingDogfoodExtensions = audit.dogfoodCoverage?.missingExtensions ?? [];
  const ok = labOnlyScripts.length === 0 && distributionCandidates.length === 0 && missingDogfoodExtensions.length === 0;
  return {
    mode: "pi-stack-user-surface-readiness",
    ok,
    categoryCounts: audit.categoryCounts,
    dogfoodCoverage: audit.dogfoodCoverage,
    labOnlyCount: labOnlyScripts.length,
    distributionCandidateCount: distributionCandidates.length,
    distributedWrapperCount: audit.distributedWrappers.length,
    repoInternalCount: audit.repoInternalScripts.length,
    wrapperGroupCount: audit.wrapperGroups.length,
    missingDogfoodCount: missingDogfoodExtensions.length,
    labOnlyScripts,
    distributionCandidates,
    missingDogfoodExtensions,
    summary: ok
      ? `pi-stack user surface audit pass: no lab-only or promotion-candidate root scripts; dogfood coverage ${audit.dogfoodCoverage?.coveredCount ?? 0}/${audit.dogfoodCoverage?.extensionCount ?? 0}`
      : `pi-stack user surface audit blocked: lab-only=${labOnlyScripts.length} promotion-candidate=${distributionCandidates.length} missing-dogfood=${missingDogfoodExtensions.length}`,
  };
}

function agentSkillsEvidence(report) {
  if (!report.blockers.length) return report.summary;
  return report.blockers.map((blocker) => [blocker.packageName || blocker.scope || "unknown", blocker.code].join(":")).join(", ");
}

function userSurfaceEvidence(report) {
  if (report.ok) return report.summary;
  return [
    ...report.labOnlyScripts.map((name) => `lab-only:${name}`),
    ...report.distributionCandidates.map((name) => `promotion-candidate:${name}`),
    ...report.missingDogfoodExtensions.map((name) => `missing-dogfood:${name}`),
  ].join(", ");
}

function gitWorktreeEvidence(worktree) {
  if (worktree.clean) return worktree.summary;
  return worktree.statusLines.join(", ");
}

function normalizeStatus(value) {
  return String(value ?? "unknown").trim().toLowerCase().replace(/_/g, "-") || "unknown";
}

function normalizePriority(value) {
  return String(value ?? "unknown").trim().toLowerCase() || "unknown";
}

function taskOneLine(task) {
  const id = String(task?.id ?? "?");
  const status = normalizeStatus(task?.status);
  const priority = normalizePriority(task?.priority);
  const description = String(task?.description ?? "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\\n/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${id} [${priority}/${status}] ${description}`.slice(0, 180);
}

function taskRow(task) {
  return {
    taskId: String(task?.id ?? ""),
    status: normalizeStatus(task?.status),
    priority: normalizePriority(task?.priority),
    description: String(task?.description ?? "")
      .replace(/\u001b\[[0-9;]*m/g, "")
      .replace(/\\n/g, " ")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  };
}

function taskRowOneLine(row) {
  const id = String(row?.taskId ?? "?");
  const status = normalizeStatus(row?.status);
  const priority = normalizePriority(row?.priority);
  const description = String(row?.description ?? "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\\n/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${id} [${priority}/${status}] ${description}`.slice(0, 180);
}

function taskDependencies(task) {
  return Array.isArray(task?.depends_on)
    ? task.depends_on.map((dep) => String(dep ?? "").trim()).filter(Boolean)
    : [];
}

function boardEvidenceCandidate(cwd, task) {
  const id = String(task?.id ?? "");
  const evidence = BOARD_RELEASE_EVIDENCE[id];
  if (!evidence) return undefined;
  const present = existsSync(path.join(cwd, evidence.evidencePath));
  return {
    taskId: id,
    status: normalizeStatus(task?.status),
    priority: normalizePriority(task?.priority),
    kind: evidence.kind,
    evidencePath: evidence.evidencePath,
    evidencePresent: present,
    decision: present ? evidence.decision : "evidence-missing",
  };
}

function boardEvidenceOneLine(row) {
  return [
    `${row.taskId} [${row.priority}/${row.status}]`,
    row.kind,
    row.evidencePresent ? row.evidencePath : `missing:${row.evidencePath}`,
    row.decision,
  ].join(" — ");
}

function boardEvidenceDispositionRows(candidateRows) {
  return candidateRows.map((row) => ({
    taskId: row.taskId,
    currentStatus: row.status,
    priority: row.priority,
    evidencePath: row.evidencePath,
    evidencePresent: row.evidencePresent,
    recommendedAction: row.evidencePresent ? "park-for-target-release" : "require-work",
    approvalPrompt: `approve board release disposition ${row.evidencePresent ? "park-for-target-release" : "require-work"} ${row.taskId}`,
    allowedActions: ["park-for-target-release", "require-work"],
    automationAllowed: false,
    rationale: row.evidencePresent
      ? "release evidence exists; operator may park this external influence for target release instead of treating it as required work"
      : "release evidence is missing; operator must require work or provide evidence before parking",
  }));
}

function operatorDecisionLines(decisions) {
  return decisions.map((decision) => `- ${decision.id}: ${decision.summary}`);
}

function operatorDecisionPackets(data, failedChecklist) {
  const decisions = [];
  if (failedChecklist.some((item) => item.id === "target-version-ready")) {
    const requiredApprovalPrompt = `approve release target-version bump-tag-release-when-ready ${data.target}`;
    decisions.push({
      id: "decide-target-version",
      kind: "operator-decision",
      recommendation: "bump-tag-release-when-ready",
      target: data.target,
      currentVersions: data.versions,
      releaseVersionDecisionPacket: {
        mode: "release-version-decision-packet",
        decision: "ready-for-operator-decision",
        target: data.target,
        currentVersions: data.versions,
        recommendedAction: "bump-tag-release-when-ready",
        allowedActions: ["defer-release", "bump-tag-release-when-ready"],
        requiredApprovalPrompt,
        automationAllowed: false,
        summary: `release version decision: target=${data.target} recommended=bump-tag-release-when-ready`,
      },
      allowedActions: ["defer-release", "bump-tag-release-when-ready"],
      requiresOperatorDecision: true,
      automationAllowed: false,
      summary: `packages are not yet at v${data.target}; bump/tag/release remains operator-gated`,
    });
  }
  if (failedChecklist.some((item) => item.id === "board-release-clear") && data.board.releaseDecisionReady) {
    const candidateRows = data.board.evidenceCandidateRows;
    const dispositionRows = boardEvidenceDispositionRows(candidateRows);
    const recommendedBulkAction = dispositionRows.every((row) => row.evidencePresent) ? "park-for-target-release" : "require-work";
    const requiredApprovalPrompt = `approve board release disposition ${recommendedBulkAction} ${dispositionRows.map((row) => row.taskId).join(",")}`;
    decisions.push({
      id: "decide-board-evidence-candidates",
      kind: "board-state",
      recommendation: "choose-park-for-target-release-or-require-work",
      target: data.target,
      candidateTaskIds: candidateRows.map((row) => row.taskId),
      evidenceCandidateRows: candidateRows,
      boardReleaseDispositionPacket: {
        mode: "board-release-disposition-packet",
        decision: "ready-for-operator-decision",
        target: data.target,
        candidateTaskIds: dispositionRows.map((row) => row.taskId),
        dispositionRows,
        allCandidatesHaveEvidence: dispositionRows.every((row) => row.evidencePresent),
        recommendedBulkAction,
        requiredApprovalPrompt,
        automationAllowed: false,
        summary: `board release disposition: candidates=${dispositionRows.length} recommended=${recommendedBulkAction}`,
      },
      allowedActions: ["park-for-target-release", "require-work"],
      requiresOperatorDecision: true,
      automationAllowed: false,
      summary: "choose park-for-target-release or require-work for current Board Evidence Candidates",
    });
  }
  return decisions;
}

function releaseNextActionPacket({ ready, releaseBlockers, operatorDecisions }) {
  if (ready) {
    const releaseDraftReviewPacket = {
      mode: "release-draft-review-packet",
      decision: "ready-for-operator-decision",
      allowedActions: ["defer-release", "prepare-draft-release"],
      requiredApprovalPrompt: "approve release draft prepare-draft-release",
      automationAllowed: false,
      tagAllowed: false,
      publishAllowed: false,
      workflowDispatchAllowed: false,
      processStartAllowed: false,
      summary: "release draft review: readiness green; draft and publish remain operator-gated",
    };
    return {
      nextActionCode: "review-release-draft",
      nextActions: [{
        id: "review-release-draft",
        kind: "operator-decision",
        allowedActions: ["defer-release", "prepare-draft-release"],
        requiresOperatorDecision: true,
        automationAllowed: false,
        releaseDraftReviewPacket,
        summary: "release readiness is green; draft and publish remain operator-gated",
      }],
    };
  }
  if (operatorDecisions.length > 0) {
    return {
      nextActionCode: "resolve-operator-decisions",
      nextActions: operatorDecisions.map((decision) => ({
        id: decision.id,
        kind: decision.kind,
        allowedActions: decision.allowedActions,
        requiresOperatorDecision: decision.requiresOperatorDecision,
        automationAllowed: decision.automationAllowed,
        target: decision.target,
        candidateTaskIds: decision.candidateTaskIds ?? [],
        ...(decision.releaseVersionDecisionPacket ? { releaseVersionDecisionPacket: decision.releaseVersionDecisionPacket } : {}),
        ...(decision.boardReleaseDispositionPacket ? { boardReleaseDispositionPacket: decision.boardReleaseDispositionPacket } : {}),
        summary: decision.summary,
      })),
    };
  }
  return {
    nextActionCode: "resolve-release-blockers",
    nextActions: releaseBlockers.map((blocker) => ({
      id: `resolve-${blocker.id}`,
      kind: blocker.kind,
      blockerId: blocker.id,
      evidence: blocker.evidence,
      requiresOperatorDecision: false,
      automationAllowed: false,
      summary: `clear ${blocker.id} before release promotion`,
    })),
  };
}

export function summarizeBoard(cwd = process.cwd()) {
  const tasksPath = path.join(cwd, ".project", "tasks.json");
  if (!existsSync(tasksPath)) {
    return {
      exists: false,
      total: 0,
      byStatus: {},
      byPriority: {},
      openP0Rows: [],
      p0ReadyRows: [],
      p0BlockedByDependencyRows: [],
      inProgressRows: [],
      blockedRows: [],
      evidenceCandidateRows: [],
      releaseDecisionReady: false,
      releaseReady: false,
      blockers: ["board-missing"],
    };
  }

  const tasksBlock = readJson(cwd, ".project/tasks.json");
  const tasks = Array.isArray(tasksBlock.tasks) ? tasksBlock.tasks : [];
  const byStatus = {};
  const byPriority = {};
  const openP0 = [];
  const p0Ready = [];
  const p0BlockedByDependency = [];
  const inProgress = [];
  const blocked = [];
  const evidenceCandidates = [];
  const statusById = new Map();

  for (const task of tasks) {
    statusById.set(String(task?.id ?? ""), normalizeStatus(task?.status));
  }

  for (const task of tasks) {
    const status = normalizeStatus(task?.status);
    const priority = normalizePriority(task?.priority);
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    byPriority[priority] = (byPriority[priority] ?? 0) + 1;
    const open = status !== "completed" && status !== "cancelled";
    if (priority === "p0" && open) {
      const unmetDeps = taskDependencies(task).filter((dep) => statusById.get(dep) !== "completed");
      openP0.push(task);
      if (unmetDeps.length > 0) {
        p0BlockedByDependency.push({ task, blockedBy: unmetDeps.slice(0, 5) });
      } else {
        p0Ready.push(task);
      }
    }
    if (status === "in-progress") inProgress.push(task);
    if (status === "blocked") blocked.push(task);
    const evidence = boardEvidenceCandidate(cwd, task);
    if (evidence && status !== "completed" && status !== "cancelled") evidenceCandidates.push(evidence);
  }

  const blockers = [];
  if (openP0.length > 0) blockers.push(`open-p0=${openP0.length}`);
  if (inProgress.length > 0) blockers.push(`in-progress=${inProgress.length}`);
  if (blocked.length > 0) blockers.push(`blocked=${blocked.length}`);
  const evidenceCandidateTaskIds = new Set(
    evidenceCandidates
      .filter((row) => row.evidencePresent)
      .map((row) => row.taskId),
  );
  const inProgressCoveredByEvidence = inProgress.length > 0
    && inProgress.every((task) => evidenceCandidateTaskIds.has(String(task?.id ?? "")));
  const releaseDecisionReady = blockers.length > 0
    && openP0.length === 0
    && blocked.length === 0
    && inProgressCoveredByEvidence;

  return {
    exists: true,
    total: tasks.length,
    byStatus,
    byPriority,
    openP0Rows: openP0.map(taskRow).slice(0, 12),
    p0ReadyRows: p0Ready.map(taskRow).slice(0, 12),
    p0BlockedByDependencyRows: p0BlockedByDependency.map(({ task, blockedBy }) => ({ ...taskRow(task), blockedBy })).slice(0, 12),
    inProgressRows: inProgress.map(taskRow).slice(0, 12),
    blockedRows: blocked.map(taskRow).slice(0, 12),
    evidenceCandidateRows: evidenceCandidates.slice(0, 12),
    releaseDecisionReady,
    releaseReady: blockers.length === 0,
    blockers,
  };
}

function parseArgs(argv) {
  const out = {
    target: "0.8.0",
    out: "",
    strict: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--target" && v) { out.target = v; i++; continue; }
    if (k === "--out" && v) { out.out = v; i++; continue; }
    if (k === "--strict") { out.strict = true; continue; }
    if (k === "--json") { out.json = true; continue; }
  }
  return out;
}

export function gather(target, cwd = process.cwd()) {
  const versions = PACKAGES.map((pkg) => {
    const json = readJson(cwd, pkg);
    return { pkg, version: String(json.version ?? "unknown") };
  });
  const uniqueVersions = [...new Set(versions.map((v) => v.version))];
  const versionsAligned = uniqueVersions.length === 1;
  const targetVersionReady = versionsAligned && uniqueVersions[0] === target;

  const latestTag = runGit(["describe", "--tags", "--abbrev=0"], cwd);
  const head = runGit(["rev-parse", "--short", "HEAD"], cwd);
  const worktree = gitWorktreeStatus(cwd, head);

  const workflows = {
    ci: existsSync(path.join(cwd, ".github", "workflows", "ci.yml")),
    publish: existsSync(path.join(cwd, ".github", "workflows", "publish.yml")),
    releaseDraft: existsSync(path.join(cwd, ".github", "workflows", "release-draft.yml")),
  };
  const packageSmoke = buildReleasePackageSmokeReport({ cwd, runPack: false });
  const contentReview = buildReleaseContentReviewAudit({ cwd, target });
  const packagePromise = buildPackagePromiseAudit(cwd);
  const agentSkills = buildAgentSkillsCompatAudit(cwd);
  const boardSpecAudit = buildBoardSpecAudit({ cwd });
  const boardNextScopeIntake = buildBoardNextScopeIntake({ cwd });
  const agentRunDrivers = agentRunDriverGateReport(cwd);
  agentRunDrivers.canarySuiteEvidence = agentRunDriverCanarySuiteEvidence(cwd);
  agentRunDrivers.lastCanaryEvidence = agentRunDriverCanaryEvidence(cwd);
  agentRunDrivers.lastMutationCanaryEvidence = agentRunDriverCanaryEvidence(cwd, ".artifacts/agent-run-driver/latest-mutation.json");
  agentRunDrivers.providerReadinessEvidence = agentRunProviderReadinessEvidence(cwd);
  agentRunDrivers.providerCanaryEvidence = agentRunProviderCanaryEvidence(cwd);
  agentRunDrivers.providerContainerCanaryEvidence = agentRunProviderContainerCanaryEvidence(cwd);
  agentRunDrivers.providerRecoveryNextEvidence = agentRunProviderRecoveryNextEvidence(cwd);
  agentRunDrivers.providerNetworkCheckEvidence = agentRunProviderNetworkCheckEvidence(cwd);
  agentRunDrivers.providerProtectedBoardPlanEvidence = agentRunProviderProtectedBoardPlanEvidence(cwd);
  agentRunDrivers.providerProtectedBoardOutcomeEvidence = agentRunProviderProtectedBoardOutcomeEvidence(cwd);
  agentRunDrivers.providerProtectedBoardRecoveryNextEvidence = agentRunProviderProtectedBoardRecoveryNextEvidence(cwd);
  agentRunDrivers.providerProtectedBoardRecoveryApprovalEvidence = agentRunProviderProtectedBoardRecoveryApprovalEvidence(cwd);
  agentRunDrivers.canarySuiteRequired = true;
  agentRunDrivers.canarySuiteGateOk = agentRunDrivers.canarySuiteEvidence.decision === "pass";
  agentRunDrivers.currentHead = head;
  agentRunDrivers.canarySuiteHeadMatches = !head || agentRunDrivers.canarySuiteEvidence.gitHead === head;
  agentRunDrivers.protectedBoardPlanStrictRequired = true;
  agentRunDrivers.protectedBoardPlanLocalEvidenceSourcesOk = agentRunDrivers.providerProtectedBoardPlanEvidence.present !== true
    || agentRunDrivers.providerProtectedBoardPlanEvidence.workerDeclaredFilesSources.length === 0
    || agentRunDrivers.providerProtectedBoardPlanEvidence.workerDeclaredFilesSources.every((source) => source === "local-task-evidence");
  agentRunDrivers.protectedBoardPlanStrictGateOk = agentRunDrivers.providerProtectedBoardPlanEvidence.present !== true
    || (
      agentRunDrivers.providerProtectedBoardPlanEvidence.requireLocalTaskEvidence === true
      && agentRunDrivers.protectedBoardPlanLocalEvidenceSourcesOk
    );
  agentRunDrivers.ok = agentRunDrivers.scriptGateOk
    && agentRunDrivers.canarySuiteGateOk
    && agentRunDrivers.canarySuiteHeadMatches
    && agentRunDrivers.protectedBoardPlanStrictGateOk;
  const userSurface = userSurfaceReadiness(cwd);

  return {
    target,
    head,
    latestTag,
    versions,
    versionsAligned,
    targetVersionReady,
    workflows,
    gates: {
      worktreeClean: worktree.clean,
      agentRunDrivers: agentRunDrivers.ok,
      packageSmoke: packageSmoke.ok,
      contentReview: contentReview.decision === "pass",
      packagePromise: packagePromise.decision === "pass",
      agentSkills: agentSkills.decision === "pass",
      userSurface: userSurface.ok,
    },
    worktree,
    agentRunDrivers,
    packageSmoke,
    contentReview,
    packagePromise,
    agentSkills,
    userSurface,
    boardSpecAudit,
    boardNextScopeIntake,
    board: summarizeBoard(cwd),
  };
}

export function buildReport(data) {
  const now = new Date().toISOString();
  const checklist = [
    { id: "versions-aligned", ok: data.versionsAligned, evidence: data.versions.map((v) => `${v.pkg}:${v.version}`).join(", ") },
    { id: "target-version-ready", ok: data.targetVersionReady, evidence: `target=v${data.target}` },
    { id: "git-worktree-clean", ok: data.gates.worktreeClean, evidence: gitWorktreeEvidence(data.worktree) },
    { id: "workflow-ci", ok: data.workflows.ci, evidence: ".github/workflows/ci.yml" },
    { id: "workflow-publish", ok: data.workflows.publish, evidence: ".github/workflows/publish.yml" },
    { id: "workflow-release-draft", ok: data.workflows.releaseDraft, evidence: ".github/workflows/release-draft.yml" },
    { id: "agent-run-driver-gate", ok: data.gates.agentRunDrivers, evidence: agentRunDriverGateEvidence(data.agentRunDrivers) },
    { id: "release-package-smoke", ok: data.packageSmoke.ok, evidence: data.packageSmoke.packageBlockers.length ? data.packageSmoke.packageBlockers.map((blocker) => blocker.id).join(", ") : "release package smoke report pass" },
    { id: "release-content-review", ok: data.gates.contentReview, evidence: data.contentReview.blockers.length ? data.contentReview.summary : data.contentReview.summary },
    { id: "package-promise-audit", ok: data.gates.packagePromise, evidence: data.packagePromise.blockers.length ? data.packagePromise.blockers.map((blocker) => [blocker.packageName, blocker.kind, blocker.name].join(":")).join(", ") : data.packagePromise.summary },
    { id: "agent-skills-compat", ok: data.gates.agentSkills, evidence: agentSkillsEvidence(data.agentSkills) },
    { id: "pi-stack-user-surface", ok: data.gates.userSurface, evidence: userSurfaceEvidence(data.userSurface) },
    { id: "board-release-clear", ok: data.board.releaseReady, evidence: data.board.blockers.length ? data.board.blockers.join(", ") : "no open P0/in-progress/blocked tasks" },
  ].map((item) => ({ ...item, kind: releaseGateKind(item.id) }));
  const ready = checklist.every((item) => item.ok);
  const decision = ready ? "ready" : "not-ready";
  const failedChecklist = checklist.filter((item) => !item.ok);
  const releaseBlockers = failedChecklist.map(releaseBlockerRow);
  const operatorDecisions = operatorDecisionPackets(data, failedChecklist);
  const { nextActionCode, nextActions } = releaseNextActionPacket({ ready, releaseBlockers, operatorDecisions });
  const decisions = operatorDecisionLines(operatorDecisions);

  const lines = [
    `# Release readiness report v${data.target}`,
    "",
    `- generatedAt: ${now}`,
    `- head: ${data.head || "unknown"}`,
    `- latestTag: ${data.latestTag || "none"}`,
    `- decision: ${decision}`,
    "",
    "## Checklist",
    ...checklist.map((c) => `- [${c.ok ? "x" : " "}] ${c.id} — ${c.evidence}`),
    "",
    "## Release Blockers",
    ...(releaseBlockers.length ? releaseBlockers.map((c) => `- ${c.id} [${c.kind}]: ${c.evidence}`) : ["- none"]),
    "",
    "## Operator Decisions",
    ...(decisions.length ? decisions : ["- none"]),
    "",
    "## Board Summary",
    `- tasks: ${data.board.total}`,
    `- byStatus: ${Object.entries(data.board.byStatus).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
    `- byPriority: ${Object.entries(data.board.byPriority).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
    `- releaseBlockers: ${data.board.blockers.length ? data.board.blockers.join(", ") : "none"}`,
    `- releaseDecisionReady: ${data.board.releaseDecisionReady ? "yes" : "no"}`,
    `- specAudit: ${data.boardSpecAudit?.decision ?? "unknown"}`,
    `- nextScopeIntake: ${data.boardNextScopeIntake?.decision ?? "unknown"}`,
    "",
    "### Open P0",
    ...(data.board.openP0Rows.length ? data.board.openP0Rows.map((row) => `- ${taskRowOneLine(row)}`) : ["- none"]),
    "",
    "### P0 Ready To Start",
    ...(data.board.p0ReadyRows.length ? data.board.p0ReadyRows.map((row) => `- ${taskRowOneLine(row)}`) : ["- none"]),
    "",
    "### P0 Blocked By Dependency",
    ...(data.board.p0BlockedByDependencyRows.length ? data.board.p0BlockedByDependencyRows.map((row) => `- ${taskRowOneLine(row)} blockedBy=${row.blockedBy.join(",")}`) : ["- none"]),
    "",
    "### In Progress",
    ...(data.board.inProgressRows.length ? data.board.inProgressRows.map((row) => `- ${taskRowOneLine(row)}`) : ["- none"]),
    "",
    "### Blocked",
    ...(data.board.blockedRows.length ? data.board.blockedRows.map((row) => `- ${taskRowOneLine(row)}`) : ["- none"]),
    "",
    "### Board Evidence Candidates",
    ...(data.board.evidenceCandidateRows.length ? data.board.evidenceCandidateRows.map((row) => `- ${boardEvidenceOneLine(row)}`) : ["- none"]),
    "",
    "## Governance notes",
    "- publish permanece gateado por tag semver + smoke/test/verify/audit",
    "- draft release é manual (workflow_dispatch) para revisão do operador",
    "- promotion de release exige evidência canônica no board/handoff",
    "",
  ];

  return {
    mode: "release-readiness-report",
    schemaVersion: 1,
    target: data.target,
    markdown: lines.join("\n"),
    generatedAt: now,
    head: data.head,
    latestTag: data.latestTag,
    decision,
    boardExhausted: data.boardSpecAudit?.decision === "no-local-safe-work",
    boardSpecAudit: data.boardSpecAudit ? {
      decision: data.boardSpecAudit.decision,
      actionableTaskIds: data.boardSpecAudit.actionableTaskIds,
      specMaturationTaskIds: data.boardSpecAudit.specMaturationTaskIds,
      protectedTaskIds: data.boardSpecAudit.protectedTaskIds,
      blockers: data.boardSpecAudit.blockers,
      summary: data.boardSpecAudit.summary,
    } : undefined,
    boardNextScopeIntake: data.boardNextScopeIntake ? {
      decision: data.boardNextScopeIntake.decision,
      recommendationCode: data.boardNextScopeIntake.recommendationCode,
      nextScopeCandidateIds: (data.boardNextScopeIntake.nextScopeCandidates ?? []).map((candidate) => candidate.candidateId),
      blockers: data.boardNextScopeIntake.blockers,
      summary: data.boardNextScopeIntake.summary,
    } : undefined,
    checklist,
    ready,
    releaseBlockers,
    operatorDecisions,
    nextActionCode,
    nextActions,
    automationPermissions: REPORT_ONLY_PERMISSIONS,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const data = gather(args.target);
  const report = buildReport(data);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const defaultOut = path.join(process.cwd(), ".artifacts", "release-readiness", `v${args.target}-${stamp}.${args.json ? "json" : "md"}`);
  const outPath = args.out ? path.resolve(process.cwd(), args.out) : defaultOut;

  mkdirSync(path.dirname(outPath), { recursive: true });
  if (args.json) {
    const structuredReport = {
      ...report,
      versions: data.versions,
      versionsAligned: data.versionsAligned,
      targetVersionReady: data.targetVersionReady,
      workflows: data.workflows,
      gates: data.gates,
      worktree: data.worktree,
      agentRunDrivers: data.agentRunDrivers,
      packageSmoke: data.packageSmoke,
      contentReview: data.contentReview,
      packagePromise: data.packagePromise,
      agentSkills: data.agentSkills,
      userSurface: data.userSurface,
      board: data.board,
    };
    writeFileSync(outPath, `${JSON.stringify(structuredReport, null, 2)}\n`);
  } else {
    writeFileSync(outPath, `${report.markdown}\n`);
  }

  process.stdout.write(`release-readiness-report: wrote ${path.relative(process.cwd(), outPath).replace(/\\/g, "/")}\n`);
  if (args.strict && !report.ready) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
