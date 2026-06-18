import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { THIRD_PARTY } from "../../../packages/pi-stack/package-list.mjs";

const PACKAGES = [
  "packages/pi-stack/package.json",
  "packages/git-skills/package.json",
  "packages/web-skills/package.json",
  "packages/pi-skills/package.json",
  "packages/lab-skills/package.json",
];

const PI_STACK_MANAGED_DEV_DEPENDENCIES = Object.fromEntries(
  THIRD_PARTY.map((name) => [name, "*"]),
);

export function makeWorkspace({
  version = "0.7.0",
  tasks = [],
  agentRunDriverScript = "node --test scripts/test/agent-run-driver-step.test.mjs scripts/test/agent-run-pi-driver.test.mjs scripts/test/agent-run-pi-driver-payload.test.mjs scripts/test/agent-run-driver-canary.test.mjs scripts/test/agent-run-driver-canary-suite.test.mjs scripts/test/agent-run-driver-container-canary-suite.test.mjs scripts/test/agent-run-driver-fanout-manifest.test.mjs scripts/test/agent-run-driver-fanout-rehearsal.test.mjs scripts/test/agent-run-driver-fanout-outcome.test.mjs scripts/test/agent-run-driver-fanout-recovery-next.test.mjs scripts/test/agent-run-driver-fanout-recovery-approval.test.mjs scripts/test/agent-run-driver-container-fanout-rehearsal.test.mjs scripts/test/agent-run-pi-provider-fanout-plan.test.mjs scripts/test/agent-run-pi-provider-readiness.test.mjs scripts/test/agent-run-pi-provider-recovery-next.test.mjs scripts/test/agent-run-pi-provider-network-check.test.mjs scripts/test/agent-run-pi-provider-worker-dispatch.test.mjs scripts/test/agent-run-pi-provider-canary.test.mjs scripts/test/agent-run-pi-provider-container-canary.test.mjs",
  agentRunDriverCanariesScript = "node scripts/agent-run-driver-canary-suite.mjs --execute --out .artifacts/agent-run-driver/suite.json",
  writeAgentRunDriverCanarySuite = true,
  agentRunDriverCanarySuiteGitHead = "",
  rootScripts = {},
  contentReviewDecision = "pass",
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "release-readiness-"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({
    private: true,
    scripts: {
      "test:agent-run:drivers": agentRunDriverScript,
      "agent-run:driver-canaries": agentRunDriverCanariesScript,
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
      ...rootScripts,
    },
  }, null, 2));
  for (const relPath of PACKAGES) {
    const fullPath = path.join(root, relPath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    const packageDir = path.dirname(relPath).replace(/\\/g, "/");
    const packageName = `@aretw0/${path.basename(packageDir)}`;
    const manifest = {
      name: packageName,
      version,
      private: false,
      repository: {
        type: "git",
        url: "https://github.com/aretw0/agents-lab.git",
        directory: packageDir,
      },
      files: ["dist", "README.md"],
    };
    if (relPath === "packages/pi-stack/package.json") {
      manifest.devDependencies = PI_STACK_MANAGED_DEV_DEPENDENCIES;
    }
    writeFileSync(fullPath, JSON.stringify(manifest, null, 2));
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
  const contentReviewPath = path.join(root, "docs", "research", "0-8-release-content-review-2026-06-18.md");
  mkdirSync(path.dirname(contentReviewPath), { recursive: true });
  writeFileSync(contentReviewPath, [
    `Decision: ${contentReviewDecision}`,
    "## Package Promise",
    "ok",
    "## Installed Surface",
    "ok",
    "## Dogfood Evidence",
    "ok",
    "## Public Docs",
    "ok",
    "## Installer Profiles",
    "ok",
    "## Non-Claims",
    "ok",
    "## Operator Decision",
    "ok",
  ].join("\n"));
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

export function initGitWorkspace(workspace) {
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

export function rewriteCanarySuiteHead(workspace, gitHead) {
  const suitePath = path.join(workspace, ".artifacts", "agent-run-driver", "suite.json");
  const suite = JSON.parse(readFileSync(suitePath, "utf8"));
  suite.gitHead = gitHead;
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
}


