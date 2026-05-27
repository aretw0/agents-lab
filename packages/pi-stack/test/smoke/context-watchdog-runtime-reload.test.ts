import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	CONTEXT_WATCHDOG_RUNTIME_RELOAD_RELATIVE_PATHS,
	CONTEXT_WATCHDOG_RUNTIME_RELOAD_SOURCE_DIRS,
	readContextWatchdogRuntimeReloadMtimeMs,
} from "../../extensions/context-watchdog-runtime-status";
import { buildReloadBeforeCompactPacket } from "../../extensions/context-watchdog-exports";

describe("context-watchdog runtime reload surfaces", () => {
	it("tracks project settings and agent overrides without treating sandbox runtime files as reload gates", () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-runtime-reload-"));
		mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
		mkdirSync(join(cwd, ".sandbox", "pi-agent"), { recursive: true });

		const projectSettingsPath = join(cwd, ".pi", "settings.json");
		const sandboxSettingsPath = join(cwd, ".sandbox", "pi-agent", "settings.json");
		const modelCatalogPath = join(cwd, ".sandbox", "pi-agent", "models.json");
		const agentOverridePath = join(cwd, ".pi", "agents", "commit-hygiene-classifier.agent.yaml");
		writeFileSync(projectSettingsPath, "{}\n");
		writeFileSync(sandboxSettingsPath, "{}\n");
		writeFileSync(modelCatalogPath, "{}\n");
		writeFileSync(agentOverridePath, "model: old\n");

		const setMtimeMs = (filePath: string, mtimeMs: number) => {
			const when = new Date(mtimeMs);
			utimesSync(filePath, when, when);
		};
		setMtimeMs(projectSettingsPath, 2_000);
		setMtimeMs(sandboxSettingsPath, 3_000);
		setMtimeMs(modelCatalogPath, 4_000);
		setMtimeMs(agentOverridePath, 5_000);

		const sourceMtime = 1_000;
		const first = readContextWatchdogRuntimeReloadMtimeMs(cwd, () => sourceMtime);
		expect(first).toBeCloseTo(5_000, -1);

		writeFileSync(sandboxSettingsPath, JSON.stringify({
			enabledModels: ["dashscope/qwen3.6-flash"],
		}, null, 2));
		setMtimeMs(sandboxSettingsPath, 8_000);
		writeFileSync(modelCatalogPath, JSON.stringify({
			models: ["openai-codex/gpt-5.3-codex-spark"],
		}, null, 2));
		setMtimeMs(modelCatalogPath, 9_000);
		const afterSandboxSettings = readContextWatchdogRuntimeReloadMtimeMs(cwd, () => sourceMtime);
		expect(afterSandboxSettings).toBeCloseTo(5_000, -1);

		writeFileSync(agentOverridePath, "model: dashscope/qwen3.6-flash\n");
		setMtimeMs(agentOverridePath, 7_000);
		const afterAgentOverride = readContextWatchdogRuntimeReloadMtimeMs(cwd, () => sourceMtime);
		expect(afterAgentOverride).toBeCloseTo(7_000, -1);
	});

	it("tracks pi-stack extension source changes outside context-watchdog", () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-runtime-reload-source-"));
		const extensionsDir = join(cwd, "packages", "pi-stack", "extensions");
		mkdirSync(extensionsDir, { recursive: true });
		const monitorProviderOutputPath = join(extensionsDir, "monitor-provider-output.ts");
		writeFileSync(monitorProviderOutputPath, "export const changed = false;\n");
		const when = new Date(9_000);
		utimesSync(monitorProviderOutputPath, when, when);

		const observed = readContextWatchdogRuntimeReloadMtimeMs(cwd, () => 1_000);
		expect(observed).toBeCloseTo(9_000, -1);
	});

	it("keeps the runtime reload surface explicit and bounded", () => {
		expect(CONTEXT_WATCHDOG_RUNTIME_RELOAD_RELATIVE_PATHS).toEqual([
			".pi/settings.json",
		]);
		expect(CONTEXT_WATCHDOG_RUNTIME_RELOAD_SOURCE_DIRS).toEqual([
			"packages/pi-stack/extensions",
		]);
	});

	it("builds reload-before-compact packet decisions without dispatch", () => {
		const clear = buildReloadBeforeCompactPacket({
			contextLevel: "ok",
			contextPercent: 20,
			reloadRequired: false,
			handoffFreshness: "fresh",
			checkpointFresh: true,
		});
		expect(clear).toMatchObject({
			decision: "not-needed",
			nextActionCode: "continue-without-reload",
			reloadGate: "reload-not-required",
			dispatchAllowed: false,
			mutationAllowed: false,
			authorization: "none",
		});

		const deferrable = buildReloadBeforeCompactPacket({
			contextLevel: "warn",
			contextPercent: 48,
			reloadRequired: true,
			handoffFreshness: "fresh",
			checkpointFresh: true,
		});
		expect(deferrable).toMatchObject({
			decision: "continue-local-safe-short",
			nextActionCode: "continue-short-local-safe-then-reload",
			reloadGate: "level-not-precompact",
			operatorActionRequired: true,
			checkpointRequired: false,
			reloadRequestRequired: true,
		});

		const nearCompact = buildReloadBeforeCompactPacket({
			contextLevel: "compact",
			contextPercent: 68,
			reloadRequired: true,
			handoffFreshness: "stale",
			checkpointFresh: false,
			pendingSourceOrToolChanges: true,
		});
		expect(nearCompact).toMatchObject({
			decision: "checkpoint-and-request-reload",
			nextActionCode: "checkpoint-then-request-reload",
			reloadGate: "reload-required-compact",
			operatorActionRequired: true,
			checkpointRequired: true,
			reloadRequestRequired: true,
			pendingSourceOrToolChanges: true,
		});
		expect(nearCompact.summary).toContain("nextActionCode=checkpoint-then-request-reload");
		expect(nearCompact.summary).toContain("dispatch=no");
	});
});
