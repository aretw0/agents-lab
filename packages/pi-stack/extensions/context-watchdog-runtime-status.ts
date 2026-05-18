import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	normalizeContextWatchdogConfig,
	type ContextWatchdogConfig,
} from "./context-watchdog-config";
import { readSettingsJson } from "./context-watchdog-storage";
import type { ContextThresholdOverrides } from "./custom-footer-context-thresholds";

export function makeContextWatchdogSourceMtimeReader(sourceUrl: string): () => number | undefined {
	const sourcePath = fileURLToPath(sourceUrl);
	return () => readFileMtimeMs(sourcePath);
}

export const CONTEXT_WATCHDOG_RUNTIME_RELOAD_RELATIVE_PATHS = [
	".pi/settings.json",
	".sandbox/pi-agent/settings.json",
	".sandbox/pi-agent/models.json",
] as const;

export const CONTEXT_WATCHDOG_RUNTIME_RELOAD_SOURCE_DIRS = [
	"packages/pi-stack/extensions",
] as const;

function readFileMtimeMs(filePath: string): number | undefined {
	try {
		return statSync(filePath).mtimeMs;
	} catch {
		return undefined;
	}
}

function maxFiniteMtime(values: Array<number | undefined>): number | undefined {
	const finite = values.filter((value): value is number => Number.isFinite(value));
	if (finite.length === 0) return undefined;
	return Math.max(...finite);
}

function readAgentOverrideMtimes(cwd: string): number[] {
	const agentsDir = path.join(cwd, ".pi", "agents");
	try {
		return readdirSync(agentsDir)
			.filter((name) => name.endsWith(".agent.yaml") || name.endsWith(".agent.yml"))
			.map((name) => readFileMtimeMs(path.join(agentsDir, name)))
			.filter((value): value is number => Number.isFinite(value));
	} catch {
		return [];
	}
}

function readPiStackExtensionSourceMtimes(cwd: string): number[] {
	const out: number[] = [];
	for (const relativeDir of CONTEXT_WATCHDOG_RUNTIME_RELOAD_SOURCE_DIRS) {
		const fullDir = path.join(cwd, relativeDir);
		try {
			for (const name of readdirSync(fullDir)) {
				if (!name.endsWith(".ts")) continue;
				const mtime = readFileMtimeMs(path.join(fullDir, name));
				if (Number.isFinite(mtime)) out.push(mtime as number);
			}
		} catch {
			// Optional in installed/non-monorepo contexts.
		}
	}
	return out;
}

export function readContextWatchdogRuntimeReloadMtimeMs(
	cwd: string,
	sourceMtimeReader?: () => number | undefined,
): number | undefined {
	return maxFiniteMtime([
		sourceMtimeReader?.(),
		...CONTEXT_WATCHDOG_RUNTIME_RELOAD_RELATIVE_PATHS.map((relativePath) => (
			readFileMtimeMs(path.join(cwd, relativePath))
		)),
		...readAgentOverrideMtimes(cwd),
		...readPiStackExtensionSourceMtimes(cwd),
	]);
}

export function readContextThresholdOverrides(cwd: string): ContextThresholdOverrides | undefined {
	const settings = readSettingsJson(cwd);
	const cfg = (settings.piStack as Record<string, unknown> | undefined)?.customFooter;
	const pressure = (cfg as Record<string, unknown> | undefined)?.contextPressure;
	if (!pressure || typeof pressure !== "object") return undefined;
	const parsed = pressure as ContextThresholdOverrides;
	return {
		default: parsed.default,
		byProvider: parsed.byProvider,
		byProviderModel: parsed.byProviderModel,
	};
}

export function readWatchdogConfig(cwd: string): ContextWatchdogConfig {
	const settings = readSettingsJson(cwd);
	const piStack = (settings.piStack as Record<string, unknown> | undefined) ?? {};
	return normalizeContextWatchdogConfig(piStack.contextWatchdog);
}

export function readDeferredLaneQueueCount(cwd: string): number {
	const queuePath = path.join(cwd, ".pi", "deferred-intents.json");
	if (!existsSync(queuePath)) return 0;
	try {
		const json = JSON.parse(readFileSync(queuePath, "utf8"));
		if (!Array.isArray(json?.items)) return 0;
		return json.items.filter((item: unknown) => {
			if (!item || typeof item !== "object") return false;
			const row = item as { text?: unknown };
			return typeof row.text === "string" && row.text.trim().length > 0;
		}).length;
	} catch {
		return 0;
	}
}
