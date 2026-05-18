import type {
	ProviderBudgetConfig,
	ProviderBudgetMap,
	ProviderBudgetStatus,
	QuotaUsageEvent,
} from "./quota-visibility-types";

type ProviderBudgetRef = {
	provider: string;
	account?: string;
	key: string;
	model?: string;
	providerModelKey?: string;
};

function safeNum(v: unknown): number {
	if (typeof v === "number") return Number.isFinite(v) ? v : 0;
	if (typeof v === "string") {
		const n = Number(v);
		return Number.isFinite(n) ? n : 0;
	}
	return 0;
}

function normalizeProvider(input: unknown): string {
	if (typeof input !== "string") return "unknown";
	const v = input.trim().toLowerCase();
	return v || "unknown";
}

function normalizeAccountId(input: unknown): string | undefined {
	if (typeof input !== "string") return undefined;
	const value = input.trim().toLowerCase();
	if (!value || value === "unknown") return undefined;
	return value;
}

function normalizeModelId(input: unknown): string | undefined {
	if (typeof input !== "string") return undefined;
	const value = input.trim().toLowerCase();
	if (!value || value === "unknown") return undefined;
	return value;
}

function buildProviderAccountKey(provider: string, account?: string): string {
	const normalizedProvider = normalizeProvider(provider);
	const normalizedAccount = normalizeAccountId(account);
	if (!normalizedAccount) return normalizedProvider;
	return `${normalizedProvider}/${normalizedAccount}`;
}

function buildProviderModelKey(provider: string, model?: string): string {
	const normalizedProvider = normalizeProvider(provider);
	const normalizedModel = normalizeModelId(model);
	if (!normalizedModel) return normalizedProvider;
	return `${normalizedProvider}/${normalizedModel}`;
}

function looksLikeModelId(input: unknown): boolean {
	const value = normalizeModelId(input);
	if (!value) return false;
	return /^(gpt|o\d|claude|gemini|qwen|deepseek|kimi|llama|mistral|codex)[-_.]/.test(value) || value.includes("codex");
}

function parseProviderBudgetRef(input: unknown, rule?: ProviderBudgetConfig): ProviderBudgetRef | undefined {
	if (typeof input !== "string") return undefined;
	const raw = input.trim();
	if (!raw) return undefined;

	const slash = raw.indexOf("/");
	const providerPart = slash === -1 ? raw : raw.slice(0, slash);
	const suffixPart = slash === -1 ? undefined : raw.slice(slash + 1);
	const provider = normalizeProvider(providerPart);
	if (!provider || provider === "unknown") return undefined;

	const explicitModel = normalizeModelId(rule?.model);
	const suffixIsModel = !explicitModel && looksLikeModelId(suffixPart);
	const model = explicitModel ?? (suffixIsModel ? normalizeModelId(suffixPart) : undefined);
	const account = model ? undefined : normalizeAccountId(suffixPart);
	const key = model ? buildProviderModelKey(provider, model) : buildProviderAccountKey(provider, account);

	return {
		provider,
		account,
		key,
		model,
		providerModelKey: model ? buildProviderModelKey(provider, model) : undefined,
	};
}

function startOfCurrentMonthLocal(now = new Date()): Date {
	return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function endOfCurrentMonthLocal(now = new Date()): Date {
	return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, -1);
}

function daysInCurrentMonth(now = new Date()): number {
	return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

function startOfRollingWeekLocal(now = new Date()): Date {
	const s = new Date(now);
	s.setHours(0, 0, 0, 0);
	s.setDate(s.getDate() - 6);
	return s;
}

function nowLocalMidnight(now = new Date()): Date {
	return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function sumTokens(events: QuotaUsageEvent[]): number {
	return events.reduce((acc, e) => acc + e.tokens, 0);
}

function sumCost(events: QuotaUsageEvent[]): number {
	return events.reduce((acc, e) => acc + e.costUsd, 0);
}

function sumRequests(events: QuotaUsageEvent[]): number {
	return events.reduce((acc, e) => acc + safeNum(e.requests), 0);
}

export function buildProviderBudgetStatuses(
	usageEvents: QuotaUsageEvent[],
	params: {
		days: number;
		weeklyQuotaTokens?: number;
		weeklyQuotaCostUsd?: number;
		weeklyQuotaRequests?: number;
		monthlyQuotaTokens?: number;
		monthlyQuotaCostUsd?: number;
		monthlyQuotaRequests?: number;
		providerBudgets: ProviderBudgetMap;
	},
): { allocationWarnings: string[]; budgets: ProviderBudgetStatus[] } {
	const allocationWarnings: string[] = [];
	const budgetRefs = Object.entries(params.providerBudgets)
		.map(([key, rule]) => parseProviderBudgetRef(key, rule))
		.filter((row): row is ProviderBudgetRef => Boolean(row));
	if (budgetRefs.length === 0) return { allocationWarnings, budgets: [] };

	const budgetKeys = budgetRefs.map((row) => row.key);
	const sumShareTokensWeekly = budgetKeys.reduce((acc, key) => acc + safeNum(params.providerBudgets[key]?.shareTokensPct), 0);
	const sumShareCostWeekly = budgetKeys.reduce((acc, key) => acc + safeNum(params.providerBudgets[key]?.shareCostPct), 0);
	const sumShareTokensMonthly = budgetKeys.reduce((acc, key) => acc + safeNum(params.providerBudgets[key]?.shareMonthlyTokensPct), 0);
	const sumShareCostMonthly = budgetKeys.reduce((acc, key) => acc + safeNum(params.providerBudgets[key]?.shareMonthlyCostPct), 0);
	const sumShareRequestsWeekly = budgetKeys.reduce((acc, key) => acc + safeNum(params.providerBudgets[key]?.shareRequestsPct), 0);
	const sumShareRequestsMonthly = budgetKeys.reduce((acc, key) => acc + safeNum(params.providerBudgets[key]?.shareMonthlyRequestsPct), 0);

	if (sumShareTokensWeekly > 100.001) allocationWarnings.push(`providerBudgets.shareTokensPct soma ${sumShareTokensWeekly.toFixed(2)}% (>100%).`);
	if (sumShareCostWeekly > 100.001) allocationWarnings.push(`providerBudgets.shareCostPct soma ${sumShareCostWeekly.toFixed(2)}% (>100%).`);
	if (sumShareTokensMonthly > 100.001) allocationWarnings.push(`providerBudgets.shareMonthlyTokensPct soma ${sumShareTokensMonthly.toFixed(2)}% (>100%).`);
	if (sumShareCostMonthly > 100.001) allocationWarnings.push(`providerBudgets.shareMonthlyCostPct soma ${sumShareCostMonthly.toFixed(2)}% (>100%).`);
	if (sumShareRequestsWeekly > 100.001) allocationWarnings.push(`providerBudgets.shareRequestsPct soma ${sumShareRequestsWeekly.toFixed(2)}% (>100%).`);
	if (sumShareRequestsMonthly > 100.001) allocationWarnings.push(`providerBudgets.shareMonthlyRequestsPct soma ${sumShareRequestsMonthly.toFixed(2)}% (>100%).`);

	const now = new Date();
	const nowMs = now.getTime();
	const dayMs = 24 * 60 * 60 * 1000;

	const budgets: ProviderBudgetStatus[] = budgetRefs
		.sort((a, b) => a.key.localeCompare(b.key))
		.map((budgetRef) => {
			const provider = budgetRef.provider;
			const account = budgetRef.account;
			const model = budgetRef.model;
			const providerAccountKey = account ? budgetRef.key : provider;
			const providerModelKey = model ? buildProviderModelKey(provider, model) : undefined;
			const rule = params.providerBudgets[budgetRef.key] ?? {};
			const notes: string[] = [];
			const inferredPeriod: "weekly" | "monthly" =
				rule.period ?? (rule.monthlyQuotaTokens || rule.monthlyQuotaCostUsd || rule.shareMonthlyTokensPct || rule.shareMonthlyCostPct ? "monthly" : "weekly");
			const periodStart = inferredPeriod === "monthly" ? startOfCurrentMonthLocal(now) : startOfRollingWeekLocal(now);
			const periodEnd = inferredPeriod === "monthly" ? endOfCurrentMonthLocal(now) : new Date(periodStart.getTime() + 7 * dayMs - 1);
			const periodDays = inferredPeriod === "monthly" ? daysInCurrentMonth(now) : 7;
			const providerEvents = usageEvents.filter((e) => {
				if (normalizeProvider(e.provider) !== provider) return false;
				if (e.timestampMs < periodStart.getTime() || e.timestampMs > nowMs) return false;
				if (account && normalizeAccountId(e.account) !== account) return false;
				if (model && normalizeModelId(e.model) !== model) return false;
				return true;
			});
			const observedMessages = providerEvents.length;
			const observedTokens = sumTokens(providerEvents);
			const observedCostUsd = sumCost(providerEvents);
			const observedRequests = sumRequests(providerEvents);
			const warnPct = rule.warnPct ?? 80;
			let hardPct = rule.hardPct ?? 100;
			if (hardPct < warnPct) {
				notes.push(`hardPct (${hardPct}) < warnPct (${warnPct}); ajustado para hardPct=${warnPct}.`);
				hardPct = warnPct;
			}
			const periodTokensCap = inferredPeriod === "monthly"
				? (rule.monthlyQuotaTokens ?? (rule.shareMonthlyTokensPct && params.monthlyQuotaTokens ? (params.monthlyQuotaTokens * rule.shareMonthlyTokensPct) / 100 : undefined))
				: (rule.weeklyQuotaTokens ?? (rule.shareTokensPct && params.weeklyQuotaTokens ? (params.weeklyQuotaTokens * rule.shareTokensPct) / 100 : undefined));
			const periodCostUsdCap = inferredPeriod === "monthly"
				? (rule.monthlyQuotaCostUsd ?? (rule.shareMonthlyCostPct && params.monthlyQuotaCostUsd ? (params.monthlyQuotaCostUsd * rule.shareMonthlyCostPct) / 100 : undefined))
				: (rule.weeklyQuotaCostUsd ?? (rule.shareCostPct && params.weeklyQuotaCostUsd ? (params.weeklyQuotaCostUsd * rule.shareCostPct) / 100 : undefined));
			const requestSharePct = inferredPeriod === "monthly" ? rule.shareMonthlyRequestsPct : rule.shareRequestsPct;
			const globalRequests = inferredPeriod === "monthly" ? params.monthlyQuotaRequests : params.weeklyQuotaRequests;
			const observedRequestsAllProviders = sumRequests(usageEvents.filter((e) => e.timestampMs >= periodStart.getTime() && e.timestampMs <= nowMs));
			const availableRequests = globalRequests !== undefined ? Math.max(0, globalRequests - observedRequestsAllProviders) : undefined;
			const periodRequestsCap = inferredPeriod === "monthly"
				? (rule.monthlyQuotaRequests ?? (requestSharePct && globalRequests ? rule.requestSharePolicy === "remaining" ? (Math.max(0, availableRequests ?? 0) * requestSharePct) / 100 : (globalRequests * requestSharePct) / 100 : undefined))
				: (rule.weeklyQuotaRequests ?? (requestSharePct && globalRequests ? rule.requestSharePolicy === "remaining" ? (Math.max(0, availableRequests ?? 0) * requestSharePct) / 100 : (globalRequests * requestSharePct) / 100 : undefined));
			if (inferredPeriod === "monthly") {
				if (rule.shareMonthlyTokensPct && !params.monthlyQuotaTokens && !rule.monthlyQuotaTokens) notes.push("shareMonthlyTokensPct definido sem monthlyQuotaTokens global; configure monthlyQuotaTokens ou quota mensal absoluta por provider.");
				if (rule.shareMonthlyCostPct && !params.monthlyQuotaCostUsd && !rule.monthlyQuotaCostUsd) notes.push("shareMonthlyCostPct definido sem monthlyQuotaCostUsd global; configure monthlyQuotaCostUsd ou quota mensal absoluta por provider.");
			} else {
				if (rule.shareTokensPct && !params.weeklyQuotaTokens && !rule.weeklyQuotaTokens) notes.push("shareTokensPct definido sem weeklyQuotaTokens global; configure weeklyQuotaTokens ou quota semanal absoluta por provider.");
				if (rule.shareCostPct && !params.weeklyQuotaCostUsd && !rule.weeklyQuotaCostUsd) notes.push("shareCostPct definido sem weeklyQuotaCostUsd global; configure weeklyQuotaCostUsd ou quota semanal absoluta por provider.");
			}
			if (requestSharePct && !globalRequests && !periodRequestsCap) {
				notes.push(inferredPeriod === "monthly"
					? "shareMonthlyRequestsPct definido sem monthlyQuotaRequests global; configure monthlyQuotaRequests ou quota mensal absoluta por provider."
					: "shareRequestsPct definido sem weeklyQuotaRequests global; configure weeklyQuotaRequests ou quota semanal absoluta por provider.");
			}
			if (periodTokensCap === undefined && periodCostUsdCap === undefined && periodRequestsCap === undefined) {
				notes.push(inferredPeriod === "monthly" ? "Sem limite mensal resolvido (tokens/custo/requests) para este provider." : "Sem limite semanal resolvido (tokens/custo/requests) para este provider.");
			}
			const elapsedDays = Math.max(1, Math.floor((nowLocalMidnight(now).getTime() - periodStart.getTime()) / dayMs) + 1);
			const projectedTokensEndOfPeriod = (observedTokens / elapsedDays) * periodDays;
			const projectedCostUsdEndOfPeriod = (observedCostUsd / elapsedDays) * periodDays;
			const projectedRequestsEndOfPeriod = (observedRequests / elapsedDays) * periodDays;
			const usedPctTokens = periodTokensCap !== undefined ? periodTokensCap === 0 ? observedTokens > 0 ? 100 : 0 : (observedTokens / periodTokensCap) * 100 : undefined;
			const projectedPctTokens = periodTokensCap !== undefined ? periodTokensCap === 0 ? projectedTokensEndOfPeriod > 0 ? 100 : 0 : (projectedTokensEndOfPeriod / periodTokensCap) * 100 : undefined;
			const usedPctCost = periodCostUsdCap !== undefined ? periodCostUsdCap === 0 ? observedCostUsd > 0 ? 100 : 0 : (observedCostUsd / periodCostUsdCap) * 100 : undefined;
			const projectedPctCost = periodCostUsdCap !== undefined ? periodCostUsdCap === 0 ? projectedCostUsdEndOfPeriod > 0 ? 100 : 0 : (projectedCostUsdEndOfPeriod / periodCostUsdCap) * 100 : undefined;
			const usedPctRequests = periodRequestsCap !== undefined ? periodRequestsCap === 0 ? observedRequests > 0 ? 100 : 0 : (observedRequests / periodRequestsCap) * 100 : undefined;
			const projectedPctRequests = periodRequestsCap !== undefined ? periodRequestsCap === 0 ? projectedRequestsEndOfPeriod > 0 ? 100 : 0 : (projectedRequestsEndOfPeriod / periodRequestsCap) * 100 : undefined;
			const maxPct = Math.max(safeNum(usedPctTokens), safeNum(projectedPctTokens), safeNum(usedPctCost), safeNum(projectedPctCost), safeNum(usedPctRequests), safeNum(projectedPctRequests));
			let state: ProviderBudgetStatus["state"] = "ok";
			if (maxPct >= hardPct && hardPct > 0) state = "blocked";
			else if (maxPct >= warnPct && warnPct > 0) state = "warning";
			return {
				provider,
				account,
				providerAccountKey,
				model,
				providerModelKey,
				owner: rule.owner,
				period: inferredPeriod,
				unit: rule.unit ?? "tokens-cost",
				requestSharePolicy: rule.requestSharePolicy,
				periodDays,
				periodStartIso: periodStart.toISOString(),
				periodEndIso: periodEnd.toISOString(),
				observedMessages,
				observedTokens,
				observedCostUsd,
				observedRequests,
				projectedTokensEndOfPeriod,
				projectedCostUsdEndOfPeriod,
				projectedRequestsEndOfPeriod,
				periodTokensCap,
				periodCostUsdCap,
				periodRequestsCap,
				usedPctTokens,
				usedPctCost,
				usedPctRequests,
				projectedPctTokens,
				projectedPctCost,
				projectedPctRequests,
				warnPct,
				hardPct,
				state,
				notes,
			};
		});
	return { allocationWarnings, budgets };
}
