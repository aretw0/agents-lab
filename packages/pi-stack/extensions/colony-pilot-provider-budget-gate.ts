import {
	analyzeQuota,
	type ProviderBudgetStatus,
} from "./quota-visibility";
import type { QuotaVisibilityBudgetSettings } from "./colony-pilot-settings";

export interface ProviderBudgetGateSnapshot {
	lookbackDays: number;
	generatedAtIso: string;
	budgets: ProviderBudgetStatus[];
	allocationWarnings: string[];
}

export interface ProviderBudgetGateCacheEntry {
	at: number;
	key: string;
	snapshot: ProviderBudgetGateSnapshot;
}

export function formatProviderBudgetStatusLine(
	status: ProviderBudgetStatus,
): string {
	const capTokens = status.periodTokensCap
		? Math.round(status.periodTokensCap).toLocaleString("en-US")
		: "n/a";
	const usedPct =
		status.usedPctTokens !== undefined
			? `${status.usedPctTokens.toFixed(1)}%`
			: "n/a";
	return `  - ${status.provider} (${status.period}) used=${Math.round(status.observedTokens).toLocaleString("en-US")} tok (${usedPct}) cap=${capTokens}`;
}

export async function resolveProviderBudgetGateSnapshot(params: {
	cwd: string;
	lookbackDays: number;
	quotaCfg: QuotaVisibilityBudgetSettings;
	cache?: ProviderBudgetGateCacheEntry;
	nowMs?: number;
}): Promise<{
	snapshot?: ProviderBudgetGateSnapshot;
	cache?: ProviderBudgetGateCacheEntry;
}> {
	const { cwd, lookbackDays, quotaCfg } = params;
	const nowMs = typeof params.nowMs === "number" ? params.nowMs : Date.now();
	if (Object.keys(quotaCfg.providerBudgets).length === 0) {
		return { snapshot: undefined, cache: params.cache };
	}

	const cacheKey = JSON.stringify({
		cwd,
		days: lookbackDays,
		weeklyQuotaTokens: quotaCfg.weeklyQuotaTokens,
		weeklyQuotaCostUsd: quotaCfg.weeklyQuotaCostUsd,
		weeklyQuotaRequests: quotaCfg.weeklyQuotaRequests,
		monthlyQuotaTokens: quotaCfg.monthlyQuotaTokens,
		monthlyQuotaCostUsd: quotaCfg.monthlyQuotaCostUsd,
		monthlyQuotaRequests: quotaCfg.monthlyQuotaRequests,
		providerBudgets: quotaCfg.providerBudgets,
	});

	if (
		params.cache &&
		params.cache.key === cacheKey &&
		nowMs - params.cache.at < 30_000
	) {
		return { snapshot: params.cache.snapshot, cache: params.cache };
	}

	const status = await analyzeQuota({
		days: lookbackDays,
		weeklyQuotaTokens: quotaCfg.weeklyQuotaTokens,
		weeklyQuotaCostUsd: quotaCfg.weeklyQuotaCostUsd,
		weeklyQuotaRequests: quotaCfg.weeklyQuotaRequests,
		monthlyQuotaTokens: quotaCfg.monthlyQuotaTokens,
		monthlyQuotaCostUsd: quotaCfg.monthlyQuotaCostUsd,
		monthlyQuotaRequests: quotaCfg.monthlyQuotaRequests,
		providerWindowHours: {},
		providerBudgets: quotaCfg.providerBudgets,
	});

	const snapshot: ProviderBudgetGateSnapshot = {
		lookbackDays,
		generatedAtIso: status.source.generatedAtIso,
		budgets: status.providerBudgets,
		allocationWarnings: status.providerBudgetPolicy.allocationWarnings,
	};

	const cache: ProviderBudgetGateCacheEntry = {
		at: nowMs,
		key: cacheKey,
		snapshot,
	};

	return { snapshot, cache };
}
