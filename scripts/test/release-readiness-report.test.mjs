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
  agentRunDriverScript = "node --test scripts/test/agent-run-driver-step.test.mjs scripts/test/agent-run-pi-driver.test.mjs scripts/test/agent-run-pi-driver-payload.test.mjs scripts/test/agent-run-driver-canary.test.mjs scripts/test/agent-run-driver-canary-suite.test.mjs",
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "release-readiness-"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({
    private: true,
    scripts: {
      "test:agent-run:drivers": agentRunDriverScript,
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
  return root;
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
    assert.equal(report.ready, false);
    assert.equal(report.decision, "not-ready");
    assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(report.checklist.map((item) => [item.id, item.kind]), [
      ["versions-aligned", "technical-gate"],
      ["target-version-ready", "operator-decision"],
      ["workflow-ci", "technical-gate"],
      ["workflow-publish", "technical-gate"],
      ["workflow-release-draft", "technical-gate"],
      ["agent-run-driver-gate", "technical-gate"],
      ["release-package-smoke", "technical-gate"],
      ["board-release-clear", "board-state"],
    ]);
    assert.deepEqual(report.releaseBlockers.map((blocker) => blocker.id), ["target-version-ready", "board-release-clear"]);
    assert.deepEqual(report.releaseBlockers.map((blocker) => blocker.kind), ["operator-decision", "board-state"]);
    const data = gather("0.8.0", workspace);
    assert.equal(data.agentRunDrivers.ok, true);
    assert.equal(data.agentRunDrivers.scriptName, "test:agent-run:drivers");
    assert.deepEqual(data.agentRunDrivers.missingTests, []);
    assert.deepEqual(data.agentRunDrivers.canarySuiteEvidence, {
      path: ".artifacts/agent-run-driver/suite.json",
      present: false,
      decision: "missing",
      summary: "no local agent-run driver canary suite artifact found",
    });
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
    assert.deepEqual(report.operatorDecisions.map((decision) => decision.id), ["decide-target-version"]);
    assert.deepEqual(report.operatorDecisions[0].allowedActions, ["defer-release", "bump-tag-release-when-ready"]);
    assert.equal(report.operatorDecisions[0].requiresOperatorDecision, true);
    assert.equal(report.operatorDecisions[0].automationAllowed, false);
    assert.equal(report.operatorDecisions[0].target, "0.8.0");
    assert.deepEqual(report.operatorDecisions[0].currentVersions.map((row) => row.version), ["0.7.0", "0.7.0", "0.7.0", "0.7.0", "0.7.0"]);
    assert.equal(report.nextActionCode, "resolve-operator-decisions");
    assert.deepEqual(report.nextActions.map((action) => action.id), ["decide-target-version"]);
    assert.deepEqual(report.nextActions[0].allowedActions, ["defer-release", "bump-tag-release-when-ready"]);
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
    assert.match(report.markdown, /\[ \] board-release-clear/);
    assert.match(report.markdown, /\[x\] agent-run-driver-gate/);
    assert.match(report.markdown, /\[x\] release-package-smoke/);
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
    ]);
    assert.match(report.markdown, /\[ \] agent-run-driver-gate/);
    assert.match(report.markdown, /agent-run-driver-gate \[technical-gate\]: missing scripts\/test\/agent-run-pi-driver\.test\.mjs/);
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
    assert.equal(json.decision, "not-ready");
    assert.equal(json.ready, false);
    assert.deepEqual(json.versions.map((row) => row.version), ["0.8.0", "0.8.0", "0.8.0", "0.8.0", "0.8.0"]);
    assert.equal(json.versionsAligned, true);
    assert.equal(json.targetVersionReady, true);
    assert.deepEqual(json.workflows, { ci: true, publish: true, releaseDraft: true });
    assert.deepEqual(json.gates, { agentRunDrivers: true, packageSmoke: true });
    assert.equal(json.agentRunDrivers.ok, true);
    assert.equal(json.agentRunDrivers.canarySuiteEvidence.decision, "missing");
    assert.equal(json.agentRunDrivers.lastCanaryEvidence.decision, "missing");
    assert.equal(json.agentRunDrivers.lastMutationCanaryEvidence.decision, "missing");
    assert.deepEqual(json.agentRunDrivers.requiredTests, [
      "scripts/test/agent-run-driver-step.test.mjs",
      "scripts/test/agent-run-pi-driver.test.mjs",
      "scripts/test/agent-run-pi-driver-payload.test.mjs",
      "scripts/test/agent-run-driver-canary.test.mjs",
      "scripts/test/agent-run-driver-canary-suite.test.mjs",
    ]);
    assert.deepEqual(json.agentRunDrivers.missingTests, []);
    assert.equal(json.packageSmoke.mode, "release-package-smoke-report");
    assert.equal(json.packageSmoke.decision, "pass");
    assert.deepEqual(json.packageSmoke.packageBlockers, []);
    assert.deepEqual(json.checklist.map((item) => [item.id, item.kind]), [
      ["versions-aligned", "technical-gate"],
      ["target-version-ready", "operator-decision"],
      ["workflow-ci", "technical-gate"],
      ["workflow-publish", "technical-gate"],
      ["workflow-release-draft", "technical-gate"],
      ["agent-run-driver-gate", "technical-gate"],
      ["release-package-smoke", "technical-gate"],
      ["board-release-clear", "board-state"],
    ]);
    assert.deepEqual(json.releaseBlockers.map((blocker) => blocker.id), ["board-release-clear"]);
    assert.deepEqual(json.releaseBlockers.map((blocker) => blocker.kind), ["board-state"]);
    assert.deepEqual(json.operatorDecisions.map((decision) => decision.id), ["decide-board-evidence-candidates"]);
    assert.equal(json.operatorDecisions[0].target, "0.8.0");
    assert.deepEqual(json.operatorDecisions[0].allowedActions, ["park-for-target-release", "require-work"]);
    assert.deepEqual(json.operatorDecisions[0].candidateTaskIds, ["TASK-BUD-521"]);
    assert.deepEqual(json.operatorDecisions[0].evidenceCandidateRows.map((row) => row.taskId), ["TASK-BUD-521"]);
    assert.equal(json.nextActionCode, "resolve-operator-decisions");
    assert.deepEqual(json.nextActions.map((action) => action.id), ["decide-board-evidence-candidates"]);
    assert.deepEqual(json.nextActions[0].allowedActions, ["park-for-target-release", "require-work"]);
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
