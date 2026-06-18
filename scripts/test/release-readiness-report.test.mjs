import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildReport, gather, summarizeBoard } from "../release-readiness-report.mjs";

import { initGitWorkspace, makeWorkspace, rewriteCanarySuiteHead } from "./fixtures/release-readiness-workspace.mjs";

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
      ["release-content-review", "operator-decision"],
      ["package-promise-audit", "technical-gate"],
      ["agent-skills-compat", "technical-gate"],
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


test("release content review hold blocks release readiness", () => {
  const workspace = makeWorkspace({
    version: "0.8.0",
    contentReviewDecision: "hold",
  });

  try {
    const report = buildReport(gather("0.8.0", workspace));
    assert.equal(report.ready, false);
    assert.ok(report.releaseBlockers.some((blocker) => blocker.id === "release-content-review"));
    const row = report.checklist.find((item) => item.id === "release-content-review");
    assert.equal(row?.kind, "operator-decision");
    assert.match(row?.evidence ?? "", /reviewDecision=hold/);
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
        "test:agent-run:drivers": "node --test scripts/test/agent-run-driver-step.test.mjs scripts/test/agent-run-pi-driver.test.mjs scripts/test/agent-run-pi-driver-payload.test.mjs scripts/test/agent-run-driver-canary.test.mjs scripts/test/agent-run-driver-canary-suite.test.mjs scripts/test/agent-run-driver-container-canary-suite.test.mjs scripts/test/agent-run-driver-fanout-manifest.test.mjs scripts/test/agent-run-driver-fanout-rehearsal.test.mjs scripts/test/agent-run-driver-fanout-outcome.test.mjs scripts/test/agent-run-driver-fanout-recovery-next.test.mjs scripts/test/agent-run-driver-fanout-recovery-approval.test.mjs scripts/test/agent-run-driver-container-fanout-rehearsal.test.mjs scripts/test/agent-run-pi-provider-fanout-plan.test.mjs scripts/test/agent-run-pi-provider-readiness.test.mjs scripts/test/agent-run-pi-provider-recovery-next.test.mjs scripts/test/agent-run-pi-provider-network-check.test.mjs scripts/test/agent-run-pi-provider-worker-dispatch.test.mjs scripts/test/agent-run-pi-provider-canary.test.mjs scripts/test/agent-run-pi-provider-container-canary.test.mjs",
        "agent-run:driver-canaries": "node scripts/agent-run-driver-canary-suite.mjs --execute --out .artifacts/agent-run-driver/suite.json",
        "agent-run:driver-fanout-manifest": "node scripts/agent-run-driver-fanout-manifest.mjs --out .artifacts/agent-run-driver/fanout-manifest.json",
        "agent-run:driver-fanout-rehearsal": "node scripts/agent-run-driver-fanout-rehearsal.mjs --execute --out .artifacts/agent-run-driver/fanout-rehearsal.json",
      "agent-run:driver-fanout-outcome": "node scripts/agent-run-driver-fanout-outcome.mjs --out .artifacts/agent-run-driver/fanout-outcome.json",
      "agent-run:driver-fanout-recovery-next": "node scripts/agent-run-driver-fanout-recovery-next.mjs --out .artifacts/agent-run-driver/fanout-recovery-next.json",
      "agent-run:driver-fanout-recovery-approval": "node scripts/agent-run-driver-fanout-recovery-approval.mjs --out .artifacts/agent-run-driver/fanout-recovery-approval.json",
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
