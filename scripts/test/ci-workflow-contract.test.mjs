import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CI_WORKFLOW = ".github/workflows/ci.yml";
const SECURITY_WORKFLOW = ".github/workflows/security-audit.yml";
const SETUP_ACTION = ".github/actions/setup/action.yml";

function read(path) {
	return readFileSync(path, "utf8");
}

test("ci workflow keeps the local parity gate canonical", () => {
	const workflow = read(CI_WORKFLOW);
	const packageJson = JSON.parse(read("package.json"));

	assert.equal(packageJson.scripts["ci:local:parity"], "pnpm run ci:smoke:gate");
	assert.match(packageJson.scripts["ci:smoke:gate"], /pnpm run docs:package:check/);
	assert.match(packageJson.scripts["ci:smoke:gate"], /pnpm run repo:discourse:audit/);
	assert.match(workflow, /name: Smoke Tests/);
	assert.match(workflow, /permissions:\n  contents: read\n\nconcurrency:/);
	assert.doesNotMatch(workflow, /permissions:\n  contents: read\n  pull-requests: write\n\nconcurrency:/);
	assert.match(workflow, /changes:\n\s+name: Change Discovery \(report-only\)\n\s+runs-on: ubuntu-latest\n\s+permissions:\n\s+contents: read\n\s+pull-requests: write/);
	assert.match(workflow, /sovereignty-report:\n\s+name: Sovereignty Report\n\s+runs-on: ubuntu-latest\n\s+permissions:\n\s+contents: read\n\s+pull-requests: write/);
	assert.match(workflow, /uses: \.\/\.github\/actions\/setup/);
	assert.match(workflow, /run: pnpm run ci:smoke:gate/);
	assert.match(workflow, /name: GitHub Action Pins/);
	assert.match(workflow, /run: node scripts\/ci\/check-github-action-pins\.mjs/);
	assert.doesNotMatch(workflow, /pull_request_target:/);
});

test("security audit workflow stays isolated and least-privilege", () => {
	const workflow = read(SECURITY_WORKFLOW);

	assert.match(workflow, /name: Security Audit/);
	assert.match(workflow, /workflow_dispatch:/);
	assert.match(workflow, /schedule:/);
	assert.match(workflow, /permissions:\s*\n\s+contents: read/);
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
		".github/workflows/publish.yml",
		".github/workflows/release-draft.yml",
		SECURITY_WORKFLOW,
	]) {
		const workflow = read(path);
		assert.match(workflow, /^permissions:\n/m, `${path} must define top-level permissions`);
	}
});

test("shared setup action owns deterministic Node and pnpm install", () => {
	const action = read(SETUP_ACTION);
	const ci = read(CI_WORKFLOW);
	const security = read(SECURITY_WORKFLOW);

	assert.match(action, /name: Agents Lab Setup/);
	assert.match(action, /uses: pnpm\/action-setup@[0-9a-f]{40}/);
	assert.match(action, /uses: actions\/setup-node@[0-9a-f]{40}/);
	assert.match(action, /registry-url: \$\{\{ inputs\.registry-url \}\}/);
	assert.match(action, /cache: pnpm/);
	assert.match(action, /run: pnpm install --frozen-lockfile/);
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
	assert.match(workflow, /uses: \.\/\.github\/actions\/setup/);
	assert.match(workflow, /registry-url: "https:\/\/registry\.npmjs\.org"/);
	assert.doesNotMatch(workflow, /corepack prepare --activate/);
	assert.ok(workflow.includes("github.event.workflow_run.conclusion == 'success'"));
	assert.ok(workflow.includes('git tag --points-at "$SHA" | grep -E'));
	assert.ok(workflow.includes('npm publish --workspace packages/pi-stack --provenance --access public'));
	assert.doesNotMatch(workflow, /pull_request:/);
	assert.doesNotMatch(workflow, /pull_request_target:/);
});

test("release draft workflow remains manual and tag-validated", () => {
	const workflow = read(".github/workflows/release-draft.yml");

	assert.match(workflow, /workflow_dispatch:/);
	assert.match(workflow, /inputs:\s*\n\s+tag:/);
	assert.match(workflow, /permissions:\s*\n\s+contents: write/);
	assert.match(workflow, /uses: \.\/\.github\/actions\/setup/);
	assert.match(workflow, /install: "false"/);
	assert.doesNotMatch(workflow, /actions\/setup-node@/);
	assert.ok(workflow.includes("grep -Eq '^v"));
	assert.match(workflow, /draft: true/);
	assert.doesNotMatch(workflow, /schedule:/);
	assert.doesNotMatch(workflow, /pull_request:/);
	assert.doesNotMatch(workflow, /pull_request_target:/);
});
