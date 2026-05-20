import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CI_WORKFLOW = ".github/workflows/ci.yml";
const SECURITY_WORKFLOW = ".github/workflows/security-audit.yml";

function read(path) {
	return readFileSync(path, "utf8");
}

test("ci workflow keeps the local parity gate canonical", () => {
	const workflow = read(CI_WORKFLOW);
	const packageJson = JSON.parse(read("package.json"));

	assert.equal(packageJson.scripts["ci:local:parity"], "pnpm run ci:smoke:gate");
	assert.match(workflow, /name: Smoke Tests/);
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
