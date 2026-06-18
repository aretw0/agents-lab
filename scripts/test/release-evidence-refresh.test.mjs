import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { parseArgs, runReleaseEvidenceRefresh } from "../release-evidence-refresh.mjs";

function workspace() {
  const cwd = mkdtempSync(path.join(tmpdir(), "release-evidence-refresh-"));
  assert.equal(spawnSync("git", ["init"], { cwd, encoding: "utf8" }).status, 0);
  writeFileSync(path.join(cwd, "README.md"), "# test\n");
  writeFileSync(path.join(cwd, ".gitignore"), ".artifacts/\n");
  assert.equal(spawnSync("git", ["add", "."], { cwd, encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", [
    "-c",
    "user.name=Release Evidence Refresh Test",
    "-c",
    "user.email=release-evidence-refresh@example.test",
    "commit",
    "-m",
    "init",
  ], { cwd, encoding: "utf8" }).status, 0);
  return cwd;
}

function head(cwd) {
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" }).stdout.trim();
}

function canarySuite(decision = "pass") {
  return {
    mode: "agent-run-driver-canary-suite-report",
    decision,
    blockers: decision === "pass" ? [] : ["read-only-canary-not-pass"],
  };
}

function readiness(gitHead, ready = true) {
  return {
    mode: "release-readiness-report",
    ready,
    decision: ready ? "ready" : "not-ready",
    head: gitHead,
    agentRunDrivers: {
      providerProtectedBoardRecoveryApprovalEvidence: {
        decision: "approval-required",
        requiredApprovalPrompt: "approve recovery rerun protected-board-task",
        selectedWorkerId: "task-bud-480",
        approvalScope: "protected-or-external-scope",
      },
    },
    blockers: [],
  };
}

function writeMinimalReleaseWorkspace(cwd, gitHead) {
  const packageJson = {
    private: true,
    scripts: {
      "test:agent-run:drivers": "node --test scripts/test/agent-run-driver-step.test.mjs scripts/test/agent-run-pi-driver.test.mjs scripts/test/agent-run-pi-driver-payload.test.mjs scripts/test/agent-run-driver-canary.test.mjs scripts/test/agent-run-driver-canary-suite.test.mjs scripts/test/agent-run-driver-container-canary-suite.test.mjs scripts/test/agent-run-driver-fanout-manifest.test.mjs scripts/test/agent-run-driver-fanout-rehearsal.test.mjs scripts/test/agent-run-driver-fanout-outcome.test.mjs scripts/test/agent-run-driver-fanout-recovery-next.test.mjs scripts/test/agent-run-driver-fanout-recovery-approval.test.mjs scripts/test/agent-run-driver-container-fanout-rehearsal.test.mjs scripts/test/agent-run-pi-provider-fanout-plan.test.mjs scripts/test/agent-run-pi-provider-readiness.test.mjs scripts/test/agent-run-pi-provider-recovery-next.test.mjs scripts/test/agent-run-pi-provider-network-check.test.mjs scripts/test/agent-run-pi-provider-worker-dispatch.test.mjs scripts/test/agent-run-pi-provider-canary.test.mjs scripts/test/agent-run-pi-provider-container-canary.test.mjs",
      "agent-run:driver-canaries": "node scripts/agent-run-driver-canary-suite.mjs --execute --out .artifacts/agent-run-driver/suite.json",
      "agent-run:driver-fanout-manifest": "node scripts/agent-run-driver-fanout-manifest.mjs --out .artifacts/agent-run-driver/fanout-manifest.json",
      "agent-run:driver-fanout-rehearsal": "node scripts/agent-run-driver-fanout-rehearsal.mjs --execute --out .artifacts/agent-run-driver/fanout-rehearsal.json",
      "agent-run:driver-fanout-outcome": "node scripts/agent-run-driver-fanout-outcome.mjs --out .artifacts/agent-run-driver/fanout-outcome.json",
      "agent-run:driver-fanout-recovery-next": "node scripts/agent-run-driver-fanout-recovery-next.mjs --out .artifacts/agent-run-driver/fanout-recovery-next.json",
      "agent-run:driver-fanout-recovery-approval": "node scripts/agent-run-driver-fanout-recovery-approval.mjs --out .artifacts/agent-run-driver/fanout-recovery-approval.json",
      "agent-run:driver-fanout-rehearsal:container": "node scripts/agent-run-driver-container-fanout-rehearsal.mjs",
      "agent-run:pi-provider-fanout-plan": "node scripts/agent-run-pi-provider-fanout-plan.mjs --out .artifacts/agent-run-driver/pi-provider-fanout-plan.json",
      "agent-run:pi-provider-protected-board-plan": "node scripts/agent-run-pi-provider-fanout-plan.mjs --from-board-protected --require-local-task-evidence --limit 3 --batch-id protected-board-research-0-8 --out .artifacts/agent-run-driver/pi-provider-protected-board-fanout-plan.json",
      "agent-run:pi-provider-protected-board-outcome": "node scripts/agent-run-driver-fanout-outcome.mjs --plan .artifacts/agent-run-driver/pi-provider-protected-board-fanout-plan.json --out .artifacts/agent-run-driver/pi-provider-protected-board-fanout-outcome.json --exit-zero-on-block",
      "agent-run:pi-provider-protected-board-recovery-next": "node scripts/agent-run-driver-fanout-recovery-next.mjs --source .artifacts/agent-run-driver/pi-provider-protected-board-fanout-outcome.json --out .artifacts/agent-run-driver/pi-provider-protected-board-recovery-next.json",
      "agent-run:pi-provider-protected-board-recovery-approval": "node scripts/agent-run-driver-fanout-recovery-approval.mjs --source .artifacts/agent-run-driver/pi-provider-protected-board-recovery-next.json --out .artifacts/agent-run-driver/pi-provider-protected-board-recovery-approval.json",
      "agent-run:pi-provider-readiness": "node scripts/agent-run-pi-provider-readiness.mjs --out .artifacts/agent-run-driver/pi-provider-readiness.json",
      "agent-run:pi-provider-recovery-next": "node scripts/agent-run-pi-provider-recovery-next.mjs --out .artifacts/agent-run-driver/pi-provider-recovery-next.json",
      "agent-run:pi-provider-network-check": "node scripts/agent-run-pi-provider-network-check.mjs --out .artifacts/agent-run-driver/pi-provider-network-check.json",
      "agent-run:pi-provider-canary": "node scripts/agent-run-pi-provider-canary.mjs --out .artifacts/agent-run-driver/pi-provider-canary.json",
      "agent-run:pi-provider-canary:container": "node scripts/agent-run-pi-provider-container-canary.mjs",
      "agent-run:pi-provider-worker-dispatch": "node scripts/agent-run-pi-provider-worker-dispatch.mjs",
    },
  };
  writeFileSync(path.join(cwd, "package.json"), JSON.stringify(packageJson, null, 2));
  for (const relPath of [
    "packages/pi-stack/package.json",
    "packages/git-skills/package.json",
    "packages/web-skills/package.json",
    "packages/pi-skills/package.json",
    "packages/lab-skills/package.json",
  ]) {
    const fullPath = path.join(cwd, relPath);
    const packageDir = path.dirname(relPath).replace(/\\/g, "/");
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, JSON.stringify({
      name: `@aretw0/${path.basename(packageDir)}`,
      version: "0.8.0",
      private: false,
      repository: { type: "git", url: "https://github.com/aretw0/agents-lab.git", directory: packageDir },
      files: ["dist", "README.md"],
    }, null, 2));
  }
  for (const relPath of [".github/workflows/ci.yml", ".github/workflows/publish.yml", ".github/workflows/release-draft.yml"]) {
    const fullPath = path.join(cwd, relPath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, "name: test\n");
  }
  const changesetPath = path.join(cwd, ".changeset", "config.json");
  mkdirSync(path.dirname(changesetPath), { recursive: true });
  writeFileSync(changesetPath, JSON.stringify({ access: "public", baseBranch: "main" }, null, 2));
  const suitePath = path.join(cwd, ".artifacts", "agent-run-driver", "suite.json");
  mkdirSync(path.dirname(suitePath), { recursive: true });
  writeFileSync(suitePath, JSON.stringify({ mode: "agent-run-driver-canary-suite-report", decision: "pass", gitHead }, null, 2));
  const approvalPath = path.join(cwd, ".artifacts", "agent-run-driver", "pi-provider-protected-board-recovery-approval.json");
  writeFileSync(approvalPath, JSON.stringify({
    mode: "agent-run-driver-fanout-recovery-approval",
    decision: "approval-required",
    selectedWorker: { workerId: "task-bud-480", runId: "protected-board-task-bud-480", failureKind: "worker-output-fail" },
    requiredApprovalPrompt: "approve recovery rerun protected-board-task-bud-480",
    approvalScope: "protected-or-external-scope",
    dispatchAllowed: false,
    processStartAllowed: false,
    automationAllowed: false,
    singleRunOnly: true,
    blockers: [],
  }, null, 2));
}

test("release evidence refresh CLI accepts pnpm argument separator", () => {
  const parsed = parseArgs(["--execute-canaries", "--pretty", "--", "--target", "0.8.0", "--tag", "v0.8.0"]);

  assert.equal(parsed.executeCanaries, true);
  assert.equal(parsed.pretty, true);
  assert.equal(parsed.target, "0.8.0");
  assert.equal(parsed.tag, "v0.8.0");
});

test("release evidence refresh writes canary, readiness, draft, and final gate artifacts", async () => {
  const cwd = workspace();
  try {
    const gitHead = head(cwd);
    const result = await runReleaseEvidenceRefresh({
      cwd,
      target: "0.8.0",
      canarySuite: canarySuite(),
      readiness: readiness(gitHead),
      outPath: ".artifacts/release-cut/refresh.json",
    });

    assert.equal(result.mode, "release-evidence-refresh");
    assert.equal(result.decision, "pass");
    assert.equal(result.canarySuiteDecision, "pass");
    assert.equal(result.protectedReviewEvidenceDecision, "missing");
    assert.equal(result.readinessDecision, "ready");
    assert.equal(result.protectedBoardRecoveryApprovalDecision, "approval-required");
    assert.equal(result.protectedBoardRecoveryApprovalPrompt, "approve recovery rerun protected-board-task");
    assert.equal(result.protectedBoardRecoveryApprovalSelectedWorkerId, "task-bud-480");
    assert.equal(result.protectedBoardRecoveryApprovalScope, "protected-or-external-scope");
    assert.equal(result.draftDecision, "ready-for-operator-review");
    assert.equal(result.finalGateDecision, "pass");
    assert.equal(result.protectedActionsAllowed, false);
    assert.equal(result.tagAllowed, false);
    assert.equal(result.workflowDispatchAllowed, false);
    assert.deepEqual(result.blockers, []);
    assert.equal(existsSync(path.join(cwd, result.paths.canarySuitePath)), true);
    assert.equal(existsSync(path.join(cwd, result.paths.readinessPath)), true);
    assert.equal(existsSync(path.join(cwd, result.paths.draftPath)), true);
    assert.equal(existsSync(path.join(cwd, result.paths.cutPreviewPath)), true);
    assert.equal(existsSync(path.join(cwd, result.paths.artifactAuditPath)), true);
    assert.equal(existsSync(path.join(cwd, result.paths.finalGatePath)), true);
    assert.deepEqual(JSON.parse(readFileSync(path.join(cwd, ".artifacts/release-cut/refresh.json"), "utf8")), result);
    assert.equal(JSON.parse(readFileSync(path.join(cwd, result.paths.readinessPath), "utf8")).mode, "release-readiness-report");
    const finalGate = JSON.parse(readFileSync(path.join(cwd, result.paths.finalGatePath), "utf8"));
    assert.deepEqual(JSON.parse(readFileSync(path.join(cwd, result.paths.cutPreviewPath), "utf8")), finalGate.cutPreview);
    assert.deepEqual(JSON.parse(readFileSync(path.join(cwd, result.paths.artifactAuditPath), "utf8")), finalGate.artifactAudit);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release evidence refresh surfaces optional protected review evidence", async () => {
  const cwd = workspace();
  try {
    const gitHead = head(cwd);
    const result = await runReleaseEvidenceRefresh({
      cwd,
      target: "0.8.0",
      canarySuite: canarySuite(),
      readiness: readiness(gitHead),
      protectedReviewEvidence: {
        mode: "agent-run-protected-review-evidence",
        decision: "pass",
        approvedWorker: {
          workerId: "task-bud-480",
          runId: "protected-board-research-0-8-task-bud-480",
          contractDecision: "pass",
        },
        fanoutProgress: {
          passedWorkerCount: 2,
          workerCount: 3,
        },
      },
    });

    assert.equal(result.decision, "pass");
    assert.equal(result.paths.protectedReviewEvidencePath, ".artifacts/agent-run-driver/protected-review-evidence.json");
    assert.equal(result.protectedReviewEvidenceDecision, "pass");
    assert.equal(result.protectedReviewEvidenceApprovedWorkerId, "task-bud-480");
    assert.equal(result.protectedReviewEvidenceApprovedRunId, "protected-board-research-0-8-task-bud-480");
    assert.equal(result.protectedReviewEvidenceApprovedContractDecision, "pass");
    assert.equal(result.protectedReviewEvidenceFanoutPassedWorkerCount, 2);
    assert.equal(result.protectedReviewEvidenceFanoutWorkerCount, 3);
    assert.equal(result.processStartAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release evidence refresh blocks when canary suite or readiness are not ready", async () => {
  const cwd = workspace();
  try {
    const gitHead = head(cwd);
    const result = await runReleaseEvidenceRefresh({
      cwd,
      target: "0.8.0",
      canarySuite: canarySuite("block"),
      readiness: readiness(gitHead, false),
    });

    assert.equal(result.decision, "block");
    assert.ok(result.blockers.includes("canary-suite-not-pass"));
    assert.ok(result.blockers.includes("release-readiness-not-ready"));
    assert.ok(result.blockers.includes("release-draft-not-ready-for-review"));
    assert.ok(result.blockers.includes("release-final-gate-not-pass"));
    assert.equal(result.publishAllowed, false);
    assert.equal(result.processStartAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release evidence refresh defaults output path from arbitrary target tag", async () => {
  const cwd = workspace();
  try {
    const gitHead = head(cwd);
    const result = await runReleaseEvidenceRefresh({
      cwd,
      target: "1.2.3",
      canarySuite: canarySuite(),
      readiness: readiness(gitHead),
    });

    assert.equal(result.target, "1.2.3");
    assert.equal(result.tag, "v1.2.3");
    assert.equal(result.decision, "pass");
    assert.equal(existsSync(path.join(cwd, ".artifacts/release-cut/v1.2.3-evidence-refresh.json")), true);
    assert.equal(existsSync(path.join(cwd, ".artifacts/release-cut/v0.8.0-evidence-refresh.json")), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release evidence refresh preserves protected recovery approval from internally built readiness", async () => {
  const cwd = workspace();
  try {
    const gitHead = head(cwd);
    writeMinimalReleaseWorkspace(cwd, gitHead);
    assert.equal(spawnSync("git", ["add", "."], { cwd, encoding: "utf8" }).status, 0);
    assert.equal(spawnSync("git", [
      "-c",
      "user.name=Release Evidence Refresh Test",
      "-c",
      "user.email=release-evidence-refresh@example.test",
      "commit",
      "-m",
      "release workspace",
    ], { cwd, encoding: "utf8" }).status, 0);
    const currentHead = head(cwd);
    const suitePath = path.join(cwd, ".artifacts", "agent-run-driver", "suite.json");
    writeFileSync(suitePath, JSON.stringify({ mode: "agent-run-driver-canary-suite-report", decision: "pass", gitHead: currentHead }, null, 2));

    const result = await runReleaseEvidenceRefresh({
      cwd,
      target: "0.8.0",
      canarySuite: canarySuite(),
      executeCanaries: false,
    });

    assert.equal(result.protectedBoardRecoveryApprovalDecision, "approval-required");
    assert.equal(result.protectedBoardRecoveryApprovalPrompt, "approve recovery rerun protected-board-task-bud-480");
    assert.equal(result.protectedBoardRecoveryApprovalSelectedWorkerId, "task-bud-480");
    assert.equal(result.protectedBoardRecoveryApprovalScope, "protected-or-external-scope");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
