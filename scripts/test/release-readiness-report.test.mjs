import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildReport, gather, summarizeBoard } from "../release-readiness-report.mjs";

const PACKAGES = [
  "packages/pi-stack/package.json",
  "packages/git-skills/package.json",
  "packages/web-skills/package.json",
  "packages/pi-skills/package.json",
  "packages/lab-skills/package.json",
];

function makeWorkspace({
  version = "0.7.0",
  tasks = [],
  agentRunDriverScript = "node --test scripts/test/agent-run-driver-step.test.mjs scripts/test/agent-run-pi-driver.test.mjs scripts/test/agent-run-pi-driver-payload.test.mjs scripts/test/agent-run-driver-canary.test.mjs scripts/test/agent-run-driver-canary-suite.test.mjs scripts/test/agent-run-driver-container-canary-suite.test.mjs scripts/test/agent-run-driver-fanout-manifest.test.mjs scripts/test/agent-run-driver-fanout-rehearsal.test.mjs scripts/test/agent-run-driver-container-fanout-rehearsal.test.mjs scripts/test/agent-run-pi-provider-fanout-plan.test.mjs scripts/test/agent-run-pi-provider-readiness.test.mjs scripts/test/agent-run-pi-provider-recovery-next.test.mjs scripts/test/agent-run-pi-provider-network-check.test.mjs scripts/test/agent-run-pi-provider-worker-dispatch.test.mjs scripts/test/agent-run-pi-provider-canary.test.mjs scripts/test/agent-run-pi-provider-container-canary.test.mjs",
  agentRunDriverCanariesScript = "node scripts/agent-run-driver-canary-suite.mjs --execute --out .artifacts/agent-run-driver/suite.json",
  writeAgentRunDriverCanarySuite = true,
  agentRunDriverCanarySuiteGitHead = "",
  rootScripts = {},
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "release-readiness-"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({
    private: true,
    scripts: {
      "test:agent-run:drivers": agentRunDriverScript,
      "agent-run:driver-canaries": agentRunDriverCanariesScript,
      "agent-run:driver-fanout-manifest": "node scripts/agent-run-driver-fanout-manifest.mjs --out .artifacts/agent-run-driver/fanout-manifest.json",
      "agent-run:driver-fanout-rehearsal": "node scripts/agent-run-driver-fanout-rehearsal.mjs --execute --out .artifacts/agent-run-driver/fanout-rehearsal.json",
      "agent-run:pi-provider-fanout-plan": "node scripts/agent-run-pi-provider-fanout-plan.mjs --out .artifacts/agent-run-driver/pi-provider-fanout-plan.json",
      "agent-run:pi-provider-protected-board-plan": "node scripts/agent-run-pi-provider-fanout-plan.mjs --from-board-protected --require-local-task-evidence --limit 3 --batch-id protected-board-research-0-8 --out .artifacts/agent-run-driver/pi-provider-protected-board-fanout-plan.json",
      "agent-run:pi-provider-readiness": "node scripts/agent-run-pi-provider-readiness.mjs --out .artifacts/agent-run-driver/pi-provider-readiness.json",
      "agent-run:pi-provider-recovery-next": "node scripts/agent-run-pi-provider-recovery-next.mjs --out .artifacts/agent-run-driver/pi-provider-recovery-next.json",
      "agent-run:pi-provider-network-check": "node scripts/agent-run-pi-provider-network-check.mjs --out .artifacts/agent-run-driver/pi-provider-network-check.json",
      "agent-run:pi-provider-canary": "node scripts/agent-run-pi-provider-canary.mjs --out .artifacts/agent-run-driver/pi-provider-canary.json",
      "agent-run:pi-provider-canary:container": "node scripts/agent-run-pi-provider-container-canary.mjs",
      "agent-run:pi-provider-worker-dispatch": "node scripts/agent-run-pi-provider-worker-dispatch.mjs",
      ...rootScripts,
    },
  }, null, 2));
  for (const relPath of PACKAGES) {
    const fullPath = path.join(root, relPath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    const packageDir = path.dirname(relPath).replace(/\\/g, "/");
    const packageName = `@aretw0/${path.basename(packageDir)}`;
    writeFileSync(fullPath, JSON.stringify({
      name: packageName,
      version,
      private: false,
      repository: {
        type: "git",
        url: "https://github.com/aretw0/agents-lab.git",
        directory: packageDir,
      },
      files: ["dist", "README.md"],
    }, null, 2));
  }
  const changesetPath = path.join(root, ".changeset", "config.json");
  mkdirSync(path.dirname(changesetPath), { recursive: true });
  writeFileSync(changesetPath, JSON.stringify({
    access: "public",
    baseBranch: "main",
    fixed: [["@aretw0/pi-stack", "@aretw0/git-skills", "@aretw0/web-skills", "@aretw0/pi-skills", "@aretw0/lab-skills"]],
  }, null, 2));
  const workflowDir = path.join(root, ".github", "workflows");
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(path.join(workflowDir, "ci.yml"), "name: ci\n");
  writeFileSync(path.join(workflowDir, "publish.yml"), [
    "name: publish",
    "permissions:",
    "  id-token: write",
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: npm publish --workspace packages/pi-stack --provenance --access public",
    "      - run: git tag --points-at \"$SHA\"",
    "",
  ].join("\n"));
  writeFileSync(path.join(workflowDir, "release-draft.yml"), [
    "name: release draft",
    "on:",
    "  workflow_dispatch:",
    "jobs:",
    "  draft:",
    "    steps:",
    "      - uses: actions/create-release@v1",
    "        with:",
    "          draft: true",
    "",
  ].join("\n"));
  mkdirSync(path.join(root, ".project"), { recursive: true });
  writeFileSync(path.join(root, ".project", "tasks.json"), JSON.stringify({ tasks }, null, 2));
  if (writeAgentRunDriverCanarySuite) {
    const suitePath = path.join(root, ".artifacts", "agent-run-driver", "suite.json");
    mkdirSync(path.dirname(suitePath), { recursive: true });
    writeFileSync(suitePath, JSON.stringify({
      mode: "agent-run-driver-canary-suite-report",
      schemaVersion: 1,
      generatedAtIso: "2026-06-10T00:00:00.000Z",
      gitHead: agentRunDriverCanarySuiteGitHead,
      decision: "pass",
      canaries: {
        readOnly: { contractDecision: "pass" },
        mutation: { contractDecision: "pass" },
      },
      blockers: [],
      summary: "agent-run-driver-canary-suite: decision=pass readOnly=pass mutation=pass",
    }, null, 2));
  }
  return root;
}

function initGitWorkspace(workspace) {
  assert.equal(spawnSync("git", ["init"], { cwd: workspace, encoding: "utf8" }).status, 0);
  writeFileSync(path.join(workspace, ".gitignore"), ".artifacts/\n");
  assert.equal(spawnSync("git", ["add", "."], { cwd: workspace, encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", [
    "-c",
    "user.name=Release Readiness Test",
    "-c",
    "user.email=release-readiness@example.test",
    "commit",
    "-m",
    "init",
  ], { cwd: workspace, encoding: "utf8" }).status, 0);
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: workspace, encoding: "utf8" }).stdout.trim();
}

function rewriteCanarySuiteHead(workspace, gitHead) {
  const suitePath = path.join(workspace, ".artifacts", "agent-run-driver", "suite.json");
  const suite = JSON.parse(readFileSync(suitePath, "utf8"));
  suite.gitHead = gitHead;
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
}

test("summarizeBoard normalizes active release blockers", () => {
  const workspace = makeWorkspace({
    tasks: [
      { id: "TASK-A", status: "completed", priority: "p0", description: "done" },
      { id: "TASK-B", status: "in_progress", priority: "p0", description: "active p0" },
      { id: "TASK-D", status: "planned", priority: "p0", description: "blocked by dep", depends_on: ["TASK-C"] },
      { id: "TASK-C", status: "blocked", priority: "p1", description: "blocked p1" },
    ],
  });

  try {
    const summary = summarizeBoard(workspace);
    assert.equal(summary.releaseReady, false);
    assert.deepEqual(summary.blockers, ["open-p0=2", "in-progress=1", "blocked=1"]);
    assert.equal(summary.byStatus["in-progress"], 1);
    assert.deepEqual(summary.openP0Rows.map((row) => row.taskId), ["TASK-B", "TASK-D"]);
    assert.deepEqual(summary.p0ReadyRows.map((row) => row.taskId), ["TASK-B"]);
    assert.deepEqual(summary.p0BlockedByDependencyRows, [{
      taskId: "TASK-D",
      status: "planned",
      priority: "p0",
      description: "blocked by dep",
      blockedBy: ["TASK-C"],
    }]);
    assert.deepEqual(summary.inProgressRows.map((row) => row.taskId), ["TASK-B"]);
    assert.deepEqual(summary.blockedRows.map((row) => row.taskId), ["TASK-C"]);
    assert.equal("p0Ready" in summary, false);
    assert.equal("p0BlockedByDependency" in summary, false);
    assert.equal("inProgress" in summary, false);
    assert.equal("blocked" in summary, false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("buildReport marks target release not ready until version and board gates are clear", () => {
  const workspace = makeWorkspace({
    version: "0.7.0",
    tasks: [{ id: "TASK-P0", status: "planned", priority: "p0", description: "release blocker" }],
  });

  try {
    const report = buildReport(gather("0.8.0", workspace));
    assert.equal(report.mode, "release-readiness-report");
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.target, "0.8.0");
    assert.equal(report.ready, false);
    assert.equal(report.decision, "not-ready");
    assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(report.checklist.map((item) => [item.id, item.kind]), [
      ["versions-aligned", "technical-gate"],
      ["target-version-ready", "operator-decision"],
      ["git-worktree-clean", "technical-gate"],
      ["workflow-ci", "technical-gate"],
      ["workflow-publish", "technical-gate"],
      ["workflow-release-draft", "technical-gate"],
      ["agent-run-driver-gate", "technical-gate"],
      ["release-package-smoke", "technical-gate"],
      ["pi-stack-user-surface", "technical-gate"],
      ["board-release-clear", "board-state"],
    ]);
    assert.deepEqual(report.releaseBlockers.map((blocker) => blocker.id), ["target-version-ready", "board-release-clear"]);
    assert.deepEqual(report.releaseBlockers.map((blocker) => blocker.kind), ["operator-decision", "board-state"]);
    const data = gather("0.8.0", workspace);
    assert.equal(data.agentRunDrivers.ok, true);
    assert.equal(data.agentRunDrivers.scriptName, "test:agent-run:drivers");
    assert.equal(data.agentRunDrivers.canaryScriptName, "agent-run:driver-canaries");
    assert.equal(data.agentRunDrivers.canaryScriptPresent, true);
    assert.equal(data.agentRunDrivers.scriptGateOk, true);
    assert.equal(data.agentRunDrivers.canarySuiteRequired, true);
    assert.equal(data.agentRunDrivers.canarySuiteGateOk, true);
    assert.equal(data.agentRunDrivers.canarySuiteHeadMatches, true);
    assert.equal(data.agentRunDrivers.protectedBoardPlanStrictRequired, true);
    assert.equal(data.agentRunDrivers.protectedBoardPlanStrictGateOk, true);
    assert.deepEqual(data.agentRunDrivers.missingTests, []);
    assert.deepEqual(data.agentRunDrivers.missingCanaryScriptMarkers, []);
    assert.equal(data.agentRunDrivers.canarySuiteEvidence.present, true);
    assert.equal(data.agentRunDrivers.canarySuiteEvidence.decision, "pass");
    assert.deepEqual(data.agentRunDrivers.lastCanaryEvidence, {
      path: ".artifacts/agent-run-driver/latest.json",
      present: false,
      decision: "missing",
      summary: "no local agent-run driver canary artifact found",
    });
    assert.deepEqual(data.agentRunDrivers.lastMutationCanaryEvidence, {
      path: ".artifacts/agent-run-driver/latest-mutation.json",
      present: false,
      decision: "missing",
      summary: "no local agent-run driver canary artifact found",
    });
    assert.equal(data.userSurface.ok, true);
    assert.equal(data.userSurface.labOnlyCount, 0);
    assert.equal(data.userSurface.distributionCandidateCount, 0);
    assert.deepEqual(report.operatorDecisions.map((decision) => decision.id), ["decide-target-version"]);
    assert.deepEqual(report.operatorDecisions[0].allowedActions, ["defer-release", "bump-tag-release-when-ready"]);
    assert.equal(report.operatorDecisions[0].requiresOperatorDecision, true);
    assert.equal(report.operatorDecisions[0].automationAllowed, false);
    assert.equal(report.operatorDecisions[0].target, "0.8.0");
    assert.deepEqual(report.operatorDecisions[0].currentVersions.map((row) => row.version), ["0.7.0", "0.7.0", "0.7.0", "0.7.0", "0.7.0"]);
    assert.equal(report.operatorDecisions[0].releaseVersionDecisionPacket.mode, "release-version-decision-packet");
    assert.equal(report.operatorDecisions[0].releaseVersionDecisionPacket.target, "0.8.0");
    assert.equal(report.operatorDecisions[0].releaseVersionDecisionPacket.recommendedAction, "bump-tag-release-when-ready");
    assert.equal(report.operatorDecisions[0].releaseVersionDecisionPacket.requiredApprovalPrompt, "approve release target-version bump-tag-release-when-ready 0.8.0");
    assert.equal(report.nextActionCode, "resolve-operator-decisions");
    assert.deepEqual(report.nextActions.map((action) => action.id), ["decide-target-version"]);
    assert.deepEqual(report.nextActions[0].allowedActions, ["defer-release", "bump-tag-release-when-ready"]);
    assert.equal(report.nextActions[0].releaseVersionDecisionPacket.requiredApprovalPrompt, "approve release target-version bump-tag-release-when-ready 0.8.0");
    assert.equal(report.nextActions[0].requiresOperatorDecision, true);
    assert.equal(report.nextActions[0].automationAllowed, false);
    assert.deepEqual(report.automationPermissions, {
      tagAllowed: false,
      publishAllowed: false,
      workflowDispatchAllowed: false,
      processStartAllowed: false,
    });
    assert.match(report.markdown, /decision: not-ready/);
    assert.match(report.markdown, /\[ \] target-version-ready/);
    assert.match(report.markdown, /\[x\] git-worktree-clean/);
    assert.match(report.markdown, /\[ \] board-release-clear/);
    assert.match(report.markdown, /\[x\] agent-run-driver-gate/);
    assert.match(report.markdown, /\[x\] release-package-smoke/);
    assert.match(report.markdown, /\[x\] pi-stack-user-surface/);
    assert.match(report.markdown, /## Release Blockers/);
    assert.match(report.markdown, /## Operator Decisions/);
    assert.match(report.markdown, /decide-target-version: packages are not yet at v0\.8\.0/);
    assert.match(report.markdown, /target-version-ready \[operator-decision\]: target=v0\.8\.0/);
    assert.match(report.markdown, /board-release-clear \[board-state\]: open-p0=1/);
    assert.match(report.markdown, /agent-run-pi-driver-payload\.test\.mjs/);
    assert.match(report.markdown, /TASK-P0 \[p0\/planned\]/);
    assert.match(report.markdown, /### P0 Ready To Start/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("buildReport marks release ready when versions and board gates are clear", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [{ id: "TASK-DONE", status: "completed", priority: "p0", description: "done" }],
  });

  try {
    const report = buildReport(gather("0.8.0", workspace));
    assert.equal(report.ready, true);
    assert.equal(report.decision, "ready");
    assert.deepEqual(report.releaseBlockers, []);
    assert.equal(report.nextActionCode, "review-release-draft");
    assert.deepEqual(report.nextActions.map((action) => action.id), ["review-release-draft"]);
    assert.deepEqual(report.nextActions[0].allowedActions, ["defer-release", "prepare-draft-release"]);
    assert.equal(report.nextActions[0].requiresOperatorDecision, true);
    assert.equal(report.nextActions[0].automationAllowed, false);
    assert.equal(report.nextActions[0].releaseDraftReviewPacket.mode, "release-draft-review-packet");
    assert.equal(report.nextActions[0].releaseDraftReviewPacket.decision, "ready-for-operator-decision");
    assert.equal(report.nextActions[0].releaseDraftReviewPacket.requiredApprovalPrompt, "approve release draft prepare-draft-release");
    assert.equal(report.nextActions[0].releaseDraftReviewPacket.automationAllowed, false);
    assert.equal(report.nextActions[0].releaseDraftReviewPacket.tagAllowed, false);
    assert.equal(report.nextActions[0].releaseDraftReviewPacket.publishAllowed, false);
    assert.equal(report.nextActions[0].releaseDraftReviewPacket.workflowDispatchAllowed, false);
    assert.equal(report.nextActions[0].releaseDraftReviewPacket.processStartAllowed, false);
    assert.deepEqual(report.automationPermissions, {
      tagAllowed: false,
      publishAllowed: false,
      workflowDispatchAllowed: false,
      processStartAllowed: false,
    });
    assert.match(report.markdown, /decision: ready/);
    assert.match(report.markdown, /\[x\] target-version-ready/);
    assert.match(report.markdown, /\[x\] agent-run-driver-gate/);
    assert.match(report.markdown, /\[x\] release-package-smoke/);
    assert.match(report.markdown, /\[x\] pi-stack-user-surface/);
    assert.match(report.markdown, /\[x\] board-release-clear/);
    assert.match(report.markdown, /## Release Blockers\n- none/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("buildReport lists local-safe evidence candidates without clearing the board gate", () => {
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
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, "# canary\n");

  try {
    const report = buildReport(gather("0.8.0", workspace));
    assert.equal(report.ready, false);
    assert.deepEqual(report.operatorDecisions.map((decision) => decision.id), ["decide-board-evidence-candidates"]);
    assert.deepEqual(report.operatorDecisions.map((decision) => decision.recommendation), ["choose-park-for-target-release-or-require-work"]);
    assert.equal(report.operatorDecisions[0].target, "0.8.0");
    assert.deepEqual(report.operatorDecisions[0].allowedActions, ["park-for-target-release", "require-work"]);
    assert.equal(report.operatorDecisions[0].requiresOperatorDecision, true);
    assert.equal(report.operatorDecisions[0].automationAllowed, false);
    assert.deepEqual(report.operatorDecisions[0].candidateTaskIds, ["TASK-BUD-521"]);
    assert.deepEqual(report.operatorDecisions[0].evidenceCandidateRows.map((row) => row.taskId), ["TASK-BUD-521"]);
    assert.equal(report.operatorDecisions[0].boardReleaseDispositionPacket.mode, "board-release-disposition-packet");
    assert.equal(report.operatorDecisions[0].boardReleaseDispositionPacket.decision, "ready-for-operator-decision");
    assert.equal(report.operatorDecisions[0].boardReleaseDispositionPacket.allCandidatesHaveEvidence, true);
    assert.equal(report.operatorDecisions[0].boardReleaseDispositionPacket.recommendedBulkAction, "park-for-target-release");
    assert.equal(report.operatorDecisions[0].boardReleaseDispositionPacket.requiredApprovalPrompt, "approve board release disposition park-for-target-release TASK-BUD-521");
    assert.deepEqual(report.operatorDecisions[0].boardReleaseDispositionPacket.dispositionRows.map((row) => ({
      taskId: row.taskId,
      recommendedAction: row.recommendedAction,
      approvalPrompt: row.approvalPrompt,
      automationAllowed: row.automationAllowed,
    })), [{
      taskId: "TASK-BUD-521",
      recommendedAction: "park-for-target-release",
      approvalPrompt: "approve board release disposition park-for-target-release TASK-BUD-521",
      automationAllowed: false,
    }]);
    assert.match(report.markdown, /\[ \] board-release-clear/);
    assert.match(report.markdown, /board-release-clear \[board-state\]: in-progress=1/);
    assert.match(report.markdown, /releaseDecisionReady: yes/);
    assert.match(report.markdown, /decide-board-evidence-candidates: choose park-for-target-release or require-work/);
    assert.match(report.markdown, /### Board Evidence Candidates/);
    assert.match(report.markdown, /TASK-BUD-521 \[p3\/in-progress\]/);
    assert.match(report.markdown, /external-influence-isolation/);
    assert.match(report.markdown, /task-bud-521-local-isolation-canary-2026-06\.md/);
    assert.match(report.markdown, /operator-may-park-for-target-release/);
    const data = gather("0.8.0", workspace);
    assert.deepEqual(data.board.evidenceCandidateRows, [{
      taskId: "TASK-BUD-521",
      status: "in-progress",
      priority: "p3",
      kind: "external-influence-isolation",
      evidencePath: "docs/research/task-bud-521-local-isolation-canary-2026-06.md",
      evidencePresent: true,
      decision: "operator-may-park-for-target-release",
    }]);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("operator decision packets stay target-agnostic for future releases", () => {
  const workspace = makeWorkspace({
    version: "1.0.0",
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
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, "# canary\n");

  try {
    const report = buildReport(gather("1.0.0", workspace));
    const decision = report.operatorDecisions[0];
    assert.equal(decision.id, "decide-board-evidence-candidates");
    assert.equal(decision.target, "1.0.0");
    assert.equal(decision.recommendation, "choose-park-for-target-release-or-require-work");
    assert.deepEqual(decision.allowedActions, ["park-for-target-release", "require-work"]);
    assert.equal(decision.requiresOperatorDecision, true);
    assert.equal(decision.automationAllowed, false);
    assert.deepEqual(decision.candidateTaskIds, ["TASK-BUD-521"]);
    assert.doesNotMatch(JSON.stringify(decision), /0\.8/);
    assert.match(report.markdown, /park-for-target-release/);
    assert.doesNotMatch(report.markdown, /park-for-0\.8/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("buildReport does not mark board decision-ready when an active task lacks evidence", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [
      {
        id: "TASK-BUD-521",
        status: "in_progress",
        priority: "p3",
        description: "external isolation influence",
      },
      {
        id: "TASK-UNCOVERED",
        status: "in_progress",
        priority: "p2",
        description: "active work without local-safe evidence",
      },
    ],
  });
  const evidencePath = path.join(workspace, "docs", "research", "task-bud-521-local-isolation-canary-2026-06.md");
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, "# canary\n");

  try {
    const report = buildReport(gather("0.8.0", workspace));
    assert.equal(report.ready, false);
    assert.equal(report.operatorDecisions.length, 0);
    assert.equal(report.nextActionCode, "resolve-release-blockers");
    assert.deepEqual(report.nextActions.map((action) => action.blockerId), ["board-release-clear"]);
    assert.equal(report.nextActions[0].requiresOperatorDecision, false);
    assert.equal(report.nextActions[0].automationAllowed, false);
    assert.match(report.markdown, /board-release-clear \[board-state\]: in-progress=2/);
    assert.match(report.markdown, /releaseDecisionReady: no/);
    assert.doesNotMatch(report.markdown, /decide-board-evidence-candidates/);
    assert.match(report.markdown, /TASK-UNCOVERED \[p2\/in-progress\]/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("agent-run driver gate requires the full driver suite script", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
    agentRunDriverScript: "node --test scripts/test/agent-run-driver-step.test.mjs",
  });

  try {
    const report = buildReport(gather("0.8.0", workspace));
    assert.equal(report.ready, false);
    assert.deepEqual(gather("0.8.0", workspace).agentRunDrivers.missingTests, [
      "scripts/test/agent-run-pi-driver.test.mjs",
      "scripts/test/agent-run-pi-driver-payload.test.mjs",
      "scripts/test/agent-run-driver-canary.test.mjs",
      "scripts/test/agent-run-driver-canary-suite.test.mjs",
      "scripts/test/agent-run-driver-container-canary-suite.test.mjs",
      "scripts/test/agent-run-driver-fanout-manifest.test.mjs",
      "scripts/test/agent-run-driver-fanout-rehearsal.test.mjs",
      "scripts/test/agent-run-driver-container-fanout-rehearsal.test.mjs",
      "scripts/test/agent-run-pi-provider-fanout-plan.test.mjs",
      "scripts/test/agent-run-pi-provider-readiness.test.mjs",
      "scripts/test/agent-run-pi-provider-recovery-next.test.mjs",
      "scripts/test/agent-run-pi-provider-network-check.test.mjs",
      "scripts/test/agent-run-pi-provider-worker-dispatch.test.mjs",
      "scripts/test/agent-run-pi-provider-canary.test.mjs",
      "scripts/test/agent-run-pi-provider-container-canary.test.mjs",
    ]);
    assert.match(report.markdown, /\[ \] agent-run-driver-gate/);
    assert.match(report.markdown, /agent-run-driver-gate \[technical-gate\]: missing tests scripts\/test\/agent-run-pi-driver\.test\.mjs/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("agent-run driver gate requires the executable canary suite script", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
    agentRunDriverCanariesScript: "",
  });

  try {
    const data = gather("0.8.0", workspace);
    const report = buildReport(data);

    assert.equal(data.agentRunDrivers.ok, false);
    assert.equal(data.agentRunDrivers.canaryScriptPresent, false);
    assert.equal(report.ready, false);
    assert.match(report.markdown, /\[ \] agent-run-driver-gate/);
    assert.match(report.markdown, /missing script agent-run:driver-canaries/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("agent-run driver gate requires operational scripts for scheduler handoff", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
    rootScripts: {
      "agent-run:pi-provider-readiness": "",
    },
  });

  try {
    const data = gather("0.8.0", workspace);
    const report = buildReport(data);

    assert.equal(data.agentRunDrivers.ok, false);
    assert.deepEqual(data.agentRunDrivers.missingOperationalScripts, ["agent-run:pi-provider-readiness"]);
    assert.equal(report.ready, false);
    assert.match(report.markdown, /\[ \] agent-run-driver-gate/);
    assert.match(report.markdown, /missing operational scripts agent-run:pi-provider-readiness/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("agent-run driver gate requires passing canary suite evidence", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
    writeAgentRunDriverCanarySuite: false,
  });

  try {
    const data = gather("0.8.0", workspace);
    const report = buildReport(data);

    assert.equal(data.agentRunDrivers.scriptGateOk, true);
    assert.equal(data.agentRunDrivers.canarySuiteRequired, true);
    assert.equal(data.agentRunDrivers.canarySuiteGateOk, false);
    assert.equal(data.agentRunDrivers.canarySuiteHeadMatches, true);
    assert.equal(data.agentRunDrivers.canarySuiteEvidence.decision, "missing");
    assert.equal(data.agentRunDrivers.ok, false);
    assert.equal(report.ready, false);
    assert.deepEqual(report.releaseBlockers.map((blocker) => blocker.id), ["agent-run-driver-gate"]);
    assert.match(report.markdown, /canary suite evidence must pass at \.artifacts\/agent-run-driver\/suite\.json \(decision=missing\)/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("agent-run driver gate rejects stale canary suite evidence when git head is available", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
    agentRunDriverCanarySuiteGitHead: "stale-head",
  });

  try {
    const head = initGitWorkspace(workspace);
    const data = gather("0.8.0", workspace);
    const report = buildReport(data);

    assert.notEqual(head, "stale-head");
    assert.equal(data.head, head);
    assert.equal(data.agentRunDrivers.scriptGateOk, true);
    assert.equal(data.agentRunDrivers.canarySuiteGateOk, true);
    assert.equal(data.agentRunDrivers.canarySuiteHeadMatches, false);
    assert.equal(data.agentRunDrivers.ok, false);
    assert.equal(report.ready, false);
    assert.deepEqual(report.releaseBlockers.map((blocker) => blocker.id), ["agent-run-driver-gate"]);
    assert.match(report.markdown, /canary suite evidence is stale for head/);
    assert.match(report.markdown, /artifact=stale-head/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("worktree clean gate blocks release readiness for tracked changes", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    tasks: [],
  });

  try {
    const head = initGitWorkspace(workspace);
    rewriteCanarySuiteHead(workspace, head);
    writeFileSync(path.join(workspace, "package.json"), JSON.stringify({
      private: true,
      scripts: {
        "test:agent-run:drivers": "node --test scripts/test/agent-run-driver-step.test.mjs scripts/test/agent-run-pi-driver.test.mjs scripts/test/agent-run-pi-driver-payload.test.mjs scripts/test/agent-run-driver-canary.test.mjs scripts/test/agent-run-driver-canary-suite.test.mjs scripts/test/agent-run-driver-container-canary-suite.test.mjs scripts/test/agent-run-driver-fanout-manifest.test.mjs scripts/test/agent-run-driver-fanout-rehearsal.test.mjs scripts/test/agent-run-driver-container-fanout-rehearsal.test.mjs scripts/test/agent-run-pi-provider-fanout-plan.test.mjs scripts/test/agent-run-pi-provider-readiness.test.mjs scripts/test/agent-run-pi-provider-recovery-next.test.mjs scripts/test/agent-run-pi-provider-network-check.test.mjs scripts/test/agent-run-pi-provider-worker-dispatch.test.mjs scripts/test/agent-run-pi-provider-canary.test.mjs scripts/test/agent-run-pi-provider-container-canary.test.mjs",
        "agent-run:driver-canaries": "node scripts/agent-run-driver-canary-suite.mjs --execute --out .artifacts/agent-run-driver/suite.json",
        "agent-run:driver-fanout-manifest": "node scripts/agent-run-driver-fanout-manifest.mjs --out .artifacts/agent-run-driver/fanout-manifest.json",
        "agent-run:driver-fanout-rehearsal": "node scripts/agent-run-driver-fanout-rehearsal.mjs --execute --out .artifacts/agent-run-driver/fanout-rehearsal.json",
        "agent-run:pi-provider-fanout-plan": "node scripts/agent-run-pi-provider-fanout-plan.mjs --out .artifacts/agent-run-driver/pi-provider-fanout-plan.json",
        "agent-run:pi-provider-protected-board-plan": "node scripts/agent-run-pi-provider-fanout-plan.mjs --from-board-protected --require-local-task-evidence --limit 3 --batch-id protected-board-research-0-8 --out .artifacts/agent-run-driver/pi-provider-protected-board-fanout-plan.json",
        "agent-run:pi-provider-readiness": "node scripts/agent-run-pi-provider-readiness.mjs --out .artifacts/agent-run-driver/pi-provider-readiness.json",
        "agent-run:pi-provider-recovery-next": "node scripts/agent-run-pi-provider-recovery-next.mjs --out .artifacts/agent-run-driver/pi-provider-recovery-next.json",
        "agent-run:pi-provider-network-check": "node scripts/agent-run-pi-provider-network-check.mjs --out .artifacts/agent-run-driver/pi-provider-network-check.json",
        "agent-run:pi-provider-canary": "node scripts/agent-run-pi-provider-canary.mjs --out .artifacts/agent-run-driver/pi-provider-canary.json",
        "agent-run:pi-provider-canary:container": "node scripts/agent-run-pi-provider-container-canary.mjs",
        "agent-run:pi-provider-worker-dispatch": "node scripts/agent-run-pi-provider-worker-dispatch.mjs",
      },
      dirtyMarker: true,
    }, null, 2));

    const data = gather("0.8.0", workspace);
    const report = buildReport(data);

    assert.equal(data.head, head);
    assert.equal(data.gates.worktreeClean, false);
    assert.equal(data.worktree.clean, false);
    assert.equal(data.worktree.trackedChangeCount, 1);
    assert.ok(data.worktree.statusLines.some((line) => line.includes("package.json")));
    assert.equal(data.agentRunDrivers.canarySuiteHeadMatches, true);
    assert.equal(report.ready, false);
    assert.deepEqual(report.releaseBlockers.map((blocker) => blocker.id), ["git-worktree-clean"]);
    assert.match(report.markdown, /\[ \] git-worktree-clean/);
    assert.match(report.markdown, /package\.json/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

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
    assert.deepEqual(data.agentRunDrivers.providerProtectedBoardPlanEvidence.selectedTaskIds, ["TASK-BUD-480", "TASK-BUD-521", "TASK-BUD-676"]);
    assert.equal(data.agentRunDrivers.providerProtectedBoardPlanEvidence.dispatchAllowed, false);
    assert.equal(data.agentRunDrivers.providerProtectedBoardPlanEvidence.processStartAllowed, false);
    assert.equal(data.agentRunDrivers.providerProtectedBoardPlanEvidence.batchExecutionAllowed, false);
    assert.deepEqual(data.agentRunDrivers.providerProtectedBoardPlanEvidence.blockers, []);
    assert.equal(data.agentRunDrivers.protectedBoardPlanStrictRequired, true);
    assert.equal(data.agentRunDrivers.protectedBoardPlanStrictGateOk, true);
    assert.equal(data.agentRunDrivers.ok, true);
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
    assert.deepEqual(json.gates, { worktreeClean: true, agentRunDrivers: true, packageSmoke: true, userSurface: true });
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
      ["agent-run:pi-provider-fanout-plan", true, []],
      ["agent-run:pi-provider-protected-board-plan", true, []],
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
    assert.equal(json.packageSmoke.mode, "release-package-smoke-report");
    assert.equal(json.packageSmoke.decision, "pass");
    assert.deepEqual(json.packageSmoke.packageBlockers, []);
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
