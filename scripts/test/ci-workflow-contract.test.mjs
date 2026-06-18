import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CI_WORKFLOW = ".github/workflows/ci.yml";
const PAGES_WORKFLOW = ".github/workflows/pages.yml";
const SECURITY_WORKFLOW = ".github/workflows/security-audit.yml";
const SETUP_ACTION = ".github/actions/setup/action.yml";

function read(path) {
	return readFileSync(path, "utf8");
}

test("ci workflow keeps the local parity gate canonical", () => {
	const workflow = read(CI_WORKFLOW);
	const packageJson = JSON.parse(read("package.json"));
	const workspace = read("pnpm-workspace.yaml");

	assert.equal(packageJson.workspaces, undefined);
	assert.match(workspace, /packages:\n\s+- "packages\/\*"/);
	assert.equal(packageJson.scripts["ci:local:parity"], "pnpm run ci:smoke:gate");
	assert.match(packageJson.scripts["ci:smoke:gate"], /pnpm run docs:package:check/);
	assert.match(packageJson.scripts["ci:smoke:gate"], /pnpm run repo:discourse:audit/);
	assert.match(packageJson.scripts["ci:smoke:gate"], /pnpm run test:release:package:smoke/);
	assert.match(packageJson.scripts["ci:smoke:gate"], /pnpm run test:release:evidence/);
	assert.match(packageJson.scripts["ci:smoke:gate"], /pnpm run test:autonomous-scheduler/);
	assert.match(packageJson.scripts["ci:smoke:gate"], /pnpm run test:agent-skills:compat/);
	assert.match(packageJson.scripts["ci:smoke:gate"], /pnpm run agent-skills:compat/);
	assert.match(packageJson.scripts["ci:smoke:gate"], /pnpm run release:package:smoke/);
	assert.match(workflow, /name: Smoke Tests/);
	assert.match(workflow, /permissions:\n  contents: read\n\nconcurrency:/);
	assert.doesNotMatch(workflow, /permissions:\n  contents: read\n  pull-requests: write\n\nconcurrency:/);
	assert.match(workflow, /changes:\n\s+name: Change Discovery \(report-only\)\n\s+runs-on: ubuntu-latest\n\s+timeout-minutes: 10\n\s+permissions:\n\s+contents: read\n\s+pull-requests: write/);
	assert.match(workflow, /sovereignty-report:\n\s+name: Sovereignty Report\n\s+runs-on: ubuntu-latest\n\s+timeout-minutes: 15\n\s+permissions:\n\s+contents: read\n\s+pull-requests: write/);
	assert.match(workflow, /docs-site:\n\s+name: Docs Site Build\n\s+runs-on: ubuntu-latest\n\s+timeout-minutes: 15\n\s+needs: \[changes\]/);
	assert.match(workflow, /sudo apt-get install -y ruby-full build-essential zlib1g-dev/);
	assert.match(workflow, /sudo gem install bundler --no-document/);
	assert.match(workflow, /pnpm run docs:site:build:smoke/);
	assert.match(workflow, /uses: \.\/\.github\/actions\/setup/);
	assert.match(workflow, /run: pnpm run ci:smoke:gate/);
	assert.match(workflow, /name: GitHub Action Pins/);
	assert.match(workflow, /run: node scripts\/ci\/check-github-action-pins\.mjs/);
	assert.match(workflow, /ci-metrics:\n\s+name: CI Metrics\n\s+if: always\(\)\n\s+needs: \[commit-lint, changeset, action-pins, changes, smoke, docs-site, sovereignty-report\]/);
	assert.match(workflow, /ci-metrics:[\s\S]*?permissions:\n\s+contents: read\n\s+actions: read/);
	assert.match(workflow, /name: ci-run-metrics/);
	assert.match(workflow, /totalDurationSec/);
	assert.doesNotMatch(workflow, /pull_request_target:/);
});

test("security audit workflow stays isolated and least-privilege", () => {
	const workflow = read(SECURITY_WORKFLOW);

	assert.match(workflow, /name: Security Audit/);
	assert.match(workflow, /workflow_dispatch:/);
	assert.match(workflow, /schedule:/);
	assert.match(workflow, /permissions:\s*\n\s+contents: read/);
	assert.match(workflow, /audit:\n\s+name: pnpm audit\n\s+runs-on: ubuntu-latest\n\s+timeout-minutes: 15/);
	assert.doesNotMatch(workflow, /pull_request:/);
	assert.doesNotMatch(workflow, /pull_request_target:/);
	assert.match(workflow, /uses: \.\/\.github\/actions\/setup/);
	assert.match(workflow, /run: pnpm run security:audit/);
	assert.match(workflow, /pnpm audit --json > \.artifacts\/security-audit\/pnpm-audit-all\.json \|\| true/);
	assert.match(workflow, /pnpm audit --json --prod > \.artifacts\/security-audit\/pnpm-audit-prod\.json \|\| true/);
	assert.match(workflow, /name: pnpm-security-audit/);
});

test("workflow permissions are explicit at the top level", () => {
	for (const path of [
		CI_WORKFLOW,
		PAGES_WORKFLOW,
		".github/workflows/publish.yml",
		".github/workflows/release-draft.yml",
		SECURITY_WORKFLOW,
	]) {
		const workflow = read(path);
		assert.match(workflow, /^permissions:\n/m, `${path} must define top-level permissions`);
	}
});

test("pages workflow publishes the validated docs artifact", () => {
	const workflow = read(PAGES_WORKFLOW);

	assert.match(workflow, /name: Pages/);
	assert.match(workflow, /push:\n\s+branches: \[main\]/);
	assert.match(workflow, /workflow_dispatch:/);
	assert.match(workflow, /permissions:\s*\n\s+contents: read\n\s+pages: write\n\s+id-token: write/);
	assert.match(workflow, /environment:\n\s+name: github-pages\n\s+url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}/);
	assert.match(workflow, /uses: \.\/\.github\/actions\/setup/);
	assert.match(workflow, /sudo apt-get install -y ruby-full build-essential zlib1g-dev/);
	assert.match(workflow, /sudo gem install bundler --no-document/);
	assert.match(workflow, /pnpm run docs:site:build:smoke/);
	assert.match(workflow, /uses: actions\/configure-pages@[0-9a-f]{40}/);
	assert.match(workflow, /uses: actions\/upload-pages-artifact@[0-9a-f]{40}/);
	assert.match(workflow, /path: docs\/_site/);
	assert.match(
		workflow,
		/uses: actions\/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128 # v5\.0\.0/,
	);
	assert.doesNotMatch(workflow, /pull_request:/);
	assert.doesNotMatch(workflow, /pull_request_target:/);
	assert.doesNotMatch(workflow, /path: docs\s*$/m);
});

test("shared setup action owns deterministic Node and pnpm install", () => {
	const action = read(SETUP_ACTION);
	const ci = read(CI_WORKFLOW);
	const security = read(SECURITY_WORKFLOW);
	const nodeVersion = read(".node-version").trim();

	assert.match(action, /name: Agents Lab Setup/);
	assert.match(action, /uses: pnpm\/action-setup@[0-9a-f]{40}/);
	assert.match(action, /uses: actions\/setup-node@[0-9a-f]{40}/);
	assert.equal(nodeVersion, "24");
	assert.match(action, /node-version-file: \.node-version/);
	assert.doesNotMatch(action, /default: "22"/);
	assert.doesNotMatch(action, /node-version: \$\{\{ inputs\.node-version \}\}/);
	assert.match(action, /registry-url: \$\{\{ inputs\.registry-url \}\}/);
	assert.match(action, /cache-mode:/);
	assert.match(action, /cache: pnpm/);
	assert.match(action, /Setup Node\.js without dependency cache/);
	assert.match(action, /name: Validate lockfile/);
	assert.match(action, /pnpm-lock\.yaml is required for deterministic CI/);
	assert.match(action, /pnpm install --frozen-lockfile/);
	assert.match(ci, /uses: \.\/\.github\/actions\/setup/);
	assert.match(security, /uses: \.\/\.github\/actions\/setup/);
	assert.doesNotMatch(ci, /corepack prepare --activate/);
	assert.doesNotMatch(security, /corepack prepare --activate/);
});

test("publish workflow stays tag-gated and provenance-scoped", () => {
	const workflow = read(".github/workflows/publish.yml");

	assert.match(workflow, /workflow_run:/);
	assert.ok(workflow.includes('workflows: ["CI"]'));
	assert.ok(workflow.includes('types: [completed]'));
	assert.match(workflow, /workflow_dispatch:/);
	assert.match(workflow, /permissions:\s*\n\s+contents: read\n\s+id-token: write/);
	assert.match(workflow, /publish:\n\s+name: Publish to npm\n\s+runs-on: ubuntu-latest\n\s+timeout-minutes: 30/);
	assert.match(workflow, /uses: \.\/\.github\/actions\/setup/);
	assert.match(workflow, /registry-url: "https:\/\/registry\.npmjs\.org"/);
	assert.match(workflow, /cache-mode: "off"/);
	assert.doesNotMatch(workflow, /corepack prepare --activate/);
	assert.ok(workflow.includes("github.event.workflow_run.conclusion == 'success'"));
	assert.ok(workflow.includes('git tag --points-at "$SHA" | grep -E'));
	assert.ok(workflow.includes('npm publish --workspace packages/pi-stack --provenance --access public'));
	assert.doesNotMatch(workflow, /pull_request:/);
	assert.doesNotMatch(workflow, /pull_request_target:/);
});

test("pnpm supply-chain policy is explicit and cache writes are trust-scoped", () => {
	const workspace = read("pnpm-workspace.yaml");
	const ci = read(CI_WORKFLOW);
	const publish = read(".github/workflows/publish.yml");
	const expectedCacheMode = "cache-mode: ${{ github.event_name == 'pull_request' && 'off' || 'auto' }}";

	assert.match(workspace, /minimumReleaseAge: 1440/);
	assert.match(workspace, /allowBuilds:\n\s+"@google\/genai": true\n\s+koffi: true\n\s+pi-lens: true\n\s+protobufjs: true/);
	assert.equal((ci.match(/uses: \.\/\.github\/actions\/setup/g) || []).length, 3);
	assert.equal((ci.match(/cache-mode: \$\{\{ github\.event_name == 'pull_request' && 'off' \|\| 'auto' \}\}/g) || []).length, 3);
	assert.ok(ci.includes(expectedCacheMode));
	assert.match(publish, /cache-mode: "off"/);
	assert.doesNotMatch(publish, /pull_request:/);
	assert.doesNotMatch(publish, /pull_request_target:/);
});

test("release draft workflow remains manual and tag-validated", () => {
	const workflow = read(".github/workflows/release-draft.yml");

	assert.match(workflow, /workflow_dispatch:/);
	assert.match(workflow, /inputs:\s*\n\s+tag:/);
	assert.match(workflow, /permissions:\s*\n\s+contents: write/);
	assert.match(workflow, /draft:\n\s+name: Prepare draft release\n\s+runs-on: ubuntu-latest\n\s+timeout-minutes: 15/);
	assert.match(workflow, /uses: \.\/\.github\/actions\/setup/);
	assert.match(workflow, /install: "false"/);
	assert.doesNotMatch(workflow, /actions\/setup-node@/);
	assert.ok(workflow.includes("grep -Eq '^v"));
	assert.match(workflow, /draft: true/);
	assert.doesNotMatch(workflow, /schedule:/);
	assert.doesNotMatch(workflow, /pull_request:/);
	assert.doesNotMatch(workflow, /pull_request_target:/);
});

test("ci workflow jobs have explicit runtime budgets", () => {
	const workflow = read(CI_WORKFLOW);
	const expectedBudgets = new Map([
		["commit-lint", 10],
		["changeset", 10],
		["action-pins", 10],
		["changes", 10],
		["smoke", 30],
		["docs-site", 15],
		["sovereignty-report", 15],
		["ci-metrics", 10],
	]);

	for (const [job, minutes] of expectedBudgets) {
		const pattern = new RegExp(`\\n  ${job}:\\n[\\s\\S]*?\\n    timeout-minutes: ${minutes}\\n`);
		assert.match(workflow, pattern, `${job} must keep timeout-minutes: ${minutes}`);
	}
});
