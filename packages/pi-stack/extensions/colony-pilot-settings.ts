import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	type ProviderBudgetMap,
	parseProviderBudgets,
	safeNum,
} from "./quota-visibility";

export interface QuotaVisibilityBudgetSettings {
	weeklyQuotaTokens?: number;
	weeklyQuotaCostUsd?: number;
	weeklyQuotaRequests?: number;
	monthlyQuotaTokens?: number;
	monthlyQuotaCostUsd?: number;
	monthlyQuotaRequests?: number;
	providerBudgets: ProviderBudgetMap;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseColonyPilotSettings<
	TSettings extends object = Record<string, unknown>,
>(cwd: string): TSettings {
	try {
		const p = path.join(cwd, ".pi", "settings.json");
		if (!existsSync(p)) return {} as TSettings;
		const json = JSON.parse(readFileSync(p, "utf8"));
		return (json?.piStack?.colonyPilot ??
			json?.extensions?.colonyPilot ??
			{}) as TSettings;
	} catch {
		return {} as TSettings;
	}
}

export function parseQuotaVisibilityBudgetSettings(
	cwd: string,
): QuotaVisibilityBudgetSettings {
	try {
		const p = path.join(cwd, ".pi", "settings.json");
		if (!existsSync(p)) return { providerBudgets: {} };
		const json = JSON.parse(readFileSync(p, "utf8"));
		const cfg = json?.piStack?.quotaVisibility ?? {};

		return {
			weeklyQuotaTokens: safeNum(cfg.weeklyQuotaTokens) || undefined,
			weeklyQuotaCostUsd: safeNum(cfg.weeklyQuotaCostUsd) || undefined,
			weeklyQuotaRequests: safeNum(cfg.weeklyQuotaRequests) || undefined,
			monthlyQuotaTokens: safeNum(cfg.monthlyQuotaTokens) || undefined,
			monthlyQuotaCostUsd: safeNum(cfg.monthlyQuotaCostUsd) || undefined,
			monthlyQuotaRequests: safeNum(cfg.monthlyQuotaRequests) || undefined,
			providerBudgets: parseProviderBudgets(cfg.providerBudgets),
		};
	} catch {
		return { providerBudgets: {} };
	}
}

export function readProjectSettings(cwd: string): Record<string, unknown> {
	const p = path.join(cwd, ".pi", "settings.json");
	if (!existsSync(p)) return {};
	try {
		const raw = JSON.parse(readFileSync(p, "utf8"));
		return isPlainObject(raw) ? raw : {};
	} catch {
		return {};
	}
}

export function writeProjectSettings(
	cwd: string,
	data: Record<string, unknown>,
): void {
	const dir = path.join(cwd, ".pi");
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, "settings.json"), `${JSON.stringify(data, null, 2)}\n`);
}
