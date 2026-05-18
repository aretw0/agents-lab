import { readFileSync } from "node:fs";
import path from "node:path";
import {
	parseProviderBudgets,
	parseProviderWindowHours,
	parseRouteModelRefs,
	safeNum,
	SETTINGS_PATH,
} from "./quota-visibility-model";
import {
	resolveQuotaToolOutputPolicy,
	type QuotaToolOutputPolicy,
	type QuotaVisibilitySettings,
} from "./quota-visibility-output-policy";

export function readQuotaVisibilitySettings(cwd: string): QuotaVisibilitySettings {
	try {
		const p = path.join(cwd, ".pi", "settings.json");
		const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
		const nested = SETTINGS_PATH.reduce<unknown>((acc, key) => {
			if (!acc || typeof acc !== "object") return undefined;
			return (acc as Record<string, unknown>)[key];
		}, raw);

		if (!nested || typeof nested !== "object") return {};
		const cfg = nested as Record<string, unknown>;

		return {
			defaultDays: safeNum(cfg.defaultDays) || undefined,
			weeklyQuotaTokens: safeNum(cfg.weeklyQuotaTokens) || undefined,
			weeklyQuotaCostUsd: safeNum(cfg.weeklyQuotaCostUsd) || undefined,
			weeklyQuotaRequests: safeNum(cfg.weeklyQuotaRequests) || undefined,
			monthlyQuotaTokens: safeNum(cfg.monthlyQuotaTokens) || undefined,
			monthlyQuotaCostUsd: safeNum(cfg.monthlyQuotaCostUsd) || undefined,
			monthlyQuotaRequests: safeNum(cfg.monthlyQuotaRequests) || undefined,
			providerWindowHours: parseProviderWindowHours(cfg.providerWindowHours),
			providerBudgets: parseProviderBudgets(cfg.providerBudgets),
			routeModelRefs: parseRouteModelRefs(cfg.routeModelRefs),
			outputPolicy: resolveQuotaToolOutputPolicy({
				outputPolicy:
					cfg.outputPolicy && typeof cfg.outputPolicy === "object"
						? (cfg.outputPolicy as QuotaToolOutputPolicy)
						: undefined,
			}),
		};
	} catch {
		return {};
	}
}
