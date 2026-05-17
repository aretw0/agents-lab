import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
	canonicalizePackageSourceForLocalAgent,
	canonicalizeSettingsObjectForLocalAgent,
	extractPackageNameFromSource,
	isPilotPackageSource,
	leanEnabledModels,
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

test("pilot package detection covers npm and local node_modules sources", () => {
	assert.equal(extractPackageNameFromSource("npm:@ifi/oh-pi-ant-colony"), "@ifi/oh-pi-ant-colony");
	assert.equal(extractPackageNameFromSource("npm:@ifi/pi-web-remote@0.5.1"), "@ifi/pi-web-remote");
	assert.equal(
		extractPackageNameFromSource("../../node_modules/@davidorex/pi-project-workflows"),
		"@davidorex/pi-project-workflows",
	);
	assert.equal(isPilotPackageSource("npm:@ifi/oh-pi-ant-colony"), true);
	assert.equal(isPilotPackageSource("../../node_modules/@davidorex/pi-project-workflows"), true);
	assert.equal(isPilotPackageSource("../packages/pi-stack"), false);
});

test("lean model scope stays intentionally small", () => {
	assert.deepEqual(leanEnabledModels(), [
		"openai-codex/gpt-5.3-codex",
		"openai-codex/gpt-5.4-mini",
		"dashscope/qwen3.6-flash",
	]);
});
