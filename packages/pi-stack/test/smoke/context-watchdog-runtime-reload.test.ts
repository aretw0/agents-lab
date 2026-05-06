import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	CONTEXT_WATCHDOG_RUNTIME_RELOAD_RELATIVE_PATHS,
	readContextWatchdogRuntimeReloadMtimeMs,
} from "../../extensions/context-watchdog-runtime-status";

describe("context-watchdog runtime reload surfaces", () => {
	it("tracks model catalog, sandbox settings, project settings, and agent overrides", () => {
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
		setMtimeMs(sandboxSettingsPath, 6_000);
		const afterSandboxSettings = readContextWatchdogRuntimeReloadMtimeMs(cwd, () => sourceMtime);
		expect(afterSandboxSettings).toBeCloseTo(6_000, -1);

		writeFileSync(agentOverridePath, "model: dashscope/qwen3.6-flash\n");
		setMtimeMs(agentOverridePath, 7_000);
		const afterAgentOverride = readContextWatchdogRuntimeReloadMtimeMs(cwd, () => sourceMtime);
		expect(afterAgentOverride).toBeCloseTo(7_000, -1);
	});

	it("keeps the runtime reload surface explicit and bounded", () => {
		expect(CONTEXT_WATCHDOG_RUNTIME_RELOAD_RELATIVE_PATHS).toEqual([
			".pi/settings.json",
			".sandbox/pi-agent/settings.json",
			".sandbox/pi-agent/models.json",
		]);
	});
});
