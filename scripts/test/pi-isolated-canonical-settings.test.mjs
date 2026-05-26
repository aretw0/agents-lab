import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
	canonicalizePackageSourceForLocalAgent,
	canonicalizeSettingsObjectForLocalAgent,
	extractPackageNameFromSource,
	isColdCapabilityPackageSource,
	piDevDefaultEnabledModels,
	reconcileLocalShellPath,
	reconcilePiDevWatchdogConfig,
	piDevWatchdogConfig,
	resolvePiDevRuntimeProfileFromEnv,
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

test("cold capability package detection covers npm and local node_modules sources", () => {
	assert.equal(extractPackageNameFromSource("npm:@ifi/oh-pi-ant-colony"), "@ifi/oh-pi-ant-colony");
	assert.equal(extractPackageNameFromSource("npm:@ifi/pi-web-remote@0.5.1"), "@ifi/pi-web-remote");
	assert.equal(
		extractPackageNameFromSource("../../node_modules/@davidorex/pi-project-workflows"),
		"@davidorex/pi-project-workflows",
	);
	assert.equal(extractPackageNameFromSource("npm:pi-lens@3.8.44"), "pi-lens");
	assert.equal(isColdCapabilityPackageSource("npm:@ifi/oh-pi-ant-colony"), true);
	assert.equal(isColdCapabilityPackageSource("../../node_modules/@davidorex/pi-project-workflows"), true);
	assert.equal(isColdCapabilityPackageSource("npm:pi-lens"), true);
	assert.equal(isColdCapabilityPackageSource("../packages/pi-stack"), false);
});

test("pi dev model scope stays intentionally small", () => {
	assert.deepEqual(piDevDefaultEnabledModels(), [
		"openai-codex/gpt-5.3-codex",
		"openai-codex/gpt-5.4-mini",
		"dashscope/qwen3.6-flash",
	]);
});

test("pi dev runtime profile can be overridden from env without editing settings", () => {
	assert.deepEqual(
		resolvePiDevRuntimeProfileFromEnv({
			PI_DEV_MODEL_REF: "dashscope/qwen3.6-flash",
		}),
		{
			defaultProvider: "dashscope",
			defaultModel: "qwen3.6-flash",
			enabledModels: ["dashscope/qwen3.6-flash"],
		},
	);

	assert.deepEqual(
		resolvePiDevRuntimeProfileFromEnv({
			PI_DEV_DEFAULT_PROVIDER: "local",
			PI_DEV_DEFAULT_MODEL: "model-a",
			PI_DEV_ENABLED_MODELS: "local/model-a, local/model-b ",
		}),
		{
			defaultProvider: "local",
			defaultModel: "model-a",
			enabledModels: ["local/model-a", "local/model-b"],
		},
	);

	assert.deepEqual(
		resolvePiDevRuntimeProfileFromEnv({
			PI_DEV_ENABLED_MODELS: "local/model-a, local/model-b",
		}),
		{
			defaultProvider: "local",
			defaultModel: "model-a",
			enabledModels: ["local/model-a", "local/model-b"],
		},
	);

	assert.equal(resolvePiDevRuntimeProfileFromEnv({}), undefined);
});

test("canonical project settings use model-agnostic gated model policy", () => {
	const settings = JSON.parse(readFileSync(path.resolve(".pi", "settings.json"), "utf8"));
	const modelPolicy = settings.piStack?.colonyPilot?.modelPolicy ?? {};
	const routeModelRefs = settings.piStack?.quotaVisibility?.routeModelRefs ?? {};

	assert.equal(modelPolicy.modelGateEnabled, true);
	assert.deepEqual(modelPolicy.gatedModelGoalTriggers, ["planning recovery", "scout burst"]);
	assert.equal(modelPolicy.gatedModelScoutOnlyTrigger, "scout burst");
	assert.ok(Array.isArray(modelPolicy.gatedModelRefs));
	assert.ok(!("sparkGateEnabled" in modelPolicy));
	assert.ok(!("sparkAllowedGoalTriggers" in modelPolicy));
	assert.ok(!("sparkScoutOnlyTrigger" in modelPolicy));
	assert.notEqual(routeModelRefs["openai-codex"], "openai-codex/gpt-5.3-codex-spark");
});

test("local shell reconciliation pins Git Bash for Windows sandbox settings", () => {
	const result = reconcileLocalShellPath(
		{ packages: [] },
		{
			platform: "win32",
			gitBashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
			pathExists: () => true,
		},
	);

	assert.equal(result.changed, true);
	assert.equal(result.settings.shellPath, "C:\\Program Files\\Git\\bin\\bash.exe");
});

test("local shell reconciliation preserves explicit operator shellPath", () => {
	const result = reconcileLocalShellPath(
		{ shellPath: "D:\\Tools\\Git\\bin\\bash.exe" },
		{
			platform: "win32",
			gitBashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
			pathExists: () => true,
		},
	);

	assert.equal(result.changed, false);
	assert.equal(result.settings.shellPath, "D:\\Tools\\Git\\bin\\bash.exe");
});

test("local shell reconciliation removes invalid cross-platform shellPath", () => {
	const result = reconcileLocalShellPath(
		{ shellPath: "C:\\Program Files\\Git\\bin\\bash.exe" },
		{
			platform: "linux",
			pathExists: () => false,
		},
	);

	assert.equal(result.changed, true);
	assert.equal(result.settings.shellPath, undefined);
});

test("pi dev watchdog config preserves guard while tolerating startup transients", () => {
	const config = piDevWatchdogConfig();

	assert.equal(config.enabled, true);
	assert.equal(config.sampleIntervalMs, 10000);
	assert.deepEqual(config.thresholds, {
		cpuPercent: 90,
		eventLoopMaxMs: 300,
		eventLoopP99Ms: 150,
		heapUsedMb: 512,
		rssMb: 768,
	});

	const mutated = piDevWatchdogConfig();
	mutated.thresholds.eventLoopP99Ms = 999;
	assert.equal(piDevWatchdogConfig().thresholds.eventLoopP99Ms, 150);
});

test("pi dev watchdog reconciliation tightens only permissive config", () => {
	const reconciled = reconcilePiDevWatchdogConfig({
		enabled: true,
		sampleIntervalMs: 20000,
		thresholds: {
			cpuPercent: 95,
			eventLoopMaxMs: 600,
			eventLoopP99Ms: 300,
			heapUsedMb: 1024,
			rssMb: 1400,
		},
	});

	assert.equal(reconciled.changed, true);
	assert.deepEqual(reconciled.config.thresholds, piDevWatchdogConfig().thresholds);
	assert.equal(reconciled.config.sampleIntervalMs, 10000);
});

test("pi dev watchdog reconciliation preserves stricter operator thresholds", () => {
	const reconciled = reconcilePiDevWatchdogConfig({
		enabled: true,
		sampleIntervalMs: 5000,
		thresholds: {
			cpuPercent: 80,
			eventLoopMaxMs: 250,
			eventLoopP99Ms: 100,
			heapUsedMb: 256,
			rssMb: 512,
		},
	});

	assert.equal(reconciled.changed, false);
	assert.deepEqual(reconciled.config.thresholds, {
		cpuPercent: 80,
		eventLoopMaxMs: 250,
		eventLoopP99Ms: 100,
		heapUsedMb: 256,
		rssMb: 512,
	});
	assert.equal(reconciled.config.sampleIntervalMs, 5000);
});
