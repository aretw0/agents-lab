import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	normalizeContextWatchdogConfig,
	type ContextWatchdogConfig,
} from "./context-watchdog-config";
import { readSettingsJson } from "./context-watchdog-storage";
import type { ContextThresholdOverrides } from "./custom-footer";

export function makeContextWatchdogSourceMtimeReader(sourceUrl: string): () => number | undefined {
	const sourcePath = fileURLToPath(sourceUrl);
	return () => {
		try {
			return statSync(sourcePath).mtimeMs;
		} catch {
			return undefined;
		}
	};
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
