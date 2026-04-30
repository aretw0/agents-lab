import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
	canonicalizePackageSourceForLocalAgent,
	canonicalizeSettingsObjectForLocalAgent,
} from "../pi-isolated.mjs";

test("canonicalizePackageSourceForLocalAgent rewrites repo-local absolute paths", () => {
	const repoRoot = path.resolve("/workspace/project");
	const localAgentDir = path.join(repoRoot, ".sandbox", "pi-agent");
	const source = path.join(repoRoot, "node_modules", "@davidorex", "pi-project-workflows");

	assert.equal(
		canonicalizePackageSourceForLocalAgent(source, { repoRoot, localAgentDir }),
		"../../node_modules/@davidorex/pi-project-workflows",
	);
});

test("canonicalizePackageSourceForLocalAgent preserves npm and external absolute paths", () => {
	const repoRoot = path.resolve("/workspace/project");
	const localAgentDir = path.join(repoRoot, ".sandbox", "pi-agent");

	assert.equal(
		canonicalizePackageSourceForLocalAgent("npm:@ifi/oh-pi-ant-colony", { repoRoot, localAgentDir }),
		"npm:@ifi/oh-pi-ant-colony",
	);
	assert.equal(
		canonicalizePackageSourceForLocalAgent("/other/place/package", { repoRoot, localAgentDir }),
		"/other/place/package",
	);
});

test("canonicalizeSettingsObjectForLocalAgent rewrites string and object package sources", () => {
	const repoRoot = path.resolve("/workspace/project");
	const localAgentDir = path.join(repoRoot, ".sandbox", "pi-agent");
	const settings = {
		packages: [
			path.join(repoRoot, "node_modules", "@davidorex", "pi-project-workflows"),
			{ source: path.join(repoRoot, "packages", "pi-stack"), extensions: [] },
			"npm:@ifi/oh-pi-ant-colony",
		],
	};

	const result = canonicalizeSettingsObjectForLocalAgent(settings, { repoRoot, localAgentDir });

	assert.equal(result.changed, true);
	assert.deepEqual(result.settings.packages, [
		"../../node_modules/@davidorex/pi-project-workflows",
		{ source: "../../packages/pi-stack", extensions: [] },
		"npm:@ifi/oh-pi-ant-colony",
	]);
	assert.equal(result.changes.length, 2);
});
