import path from "node:path";
import {
	normalizeProvider,
	parseProviderAccountKey,
	safeNum,
	type ProviderBudgetStatus,
	type ProviderWindowInsight,
	type QuotaStatus,
	type RouteAdvisory,
	type RoutingProfile,
} from "./quota-visibility-model";

function pct(v?: number): string {
	if (v === undefined || !Number.isFinite(v)) return "n/a";
	return `${v.toFixed(1)}%`;
}

function money(v: number): string {
	if (!Number.isFinite(v)) return "$0.0000";
	if (v >= 1) return `$${v.toFixed(2)}`;
	if (v >= 0.1) return `$${v.toFixed(3)}`;
	return `$${v.toFixed(4)}`;
}

function fmt(n: number): string {
	if (!Number.isFinite(n)) return "0";
	return Math.round(n).toLocaleString("en-US");
}

function hh(hour: number): string {
	const h = ((Math.floor(hour) % 24) + 24) % 24;
	return `${String(h).padStart(2, "0")}:00`;
}

function hourList(hours: number[]): string {
	if (!hours || hours.length === 0) return "n/a";
	return hours.map(hh).join(", ");
}

function formatWindowInsightLine(w: ProviderWindowInsight): string {
	if (w.observedMessages === 0) {
		return `  - ${w.provider} (${w.windowHours}h): sem eventos no período (monitoramento ativo)`;
	}

	const maxTok = w.maxWindowInRange?.tokens ?? 0;
	return [
		`  - ${w.provider} (${w.windowHours}h): recent=${fmt(w.recentWindow.tokens)} tok, max=${fmt(maxTok)} tok`,
		`    peak horas: ${hourList(w.peakHoursLocal)} | iniciar antes do pico: ${hourList(w.suggestedStartHoursBeforePeakLocal)}`,
		`    início mais carregado: ${hourList(w.highestDemandWindowStartsLocal)} | início menos carregado: ${hourList(w.lowestDemandWindowStartsLocal)}`,
	].join("\n");
}

function formatProviderBudgetLine(b: ProviderBudgetStatus): string {
	const stateTag =
		b.state === "blocked" ? "BLOCK" : b.state === "warning" ? "WARN" : "OK";
	const owner = b.owner ? ` owner=${b.owner}` : "";
	const target = b.account ? `${b.provider}/${b.account}` : b.provider;
	const capTok =
		b.periodTokensCap !== undefined ? fmt(b.periodTokensCap) : "n/a";
	const capUsd =
		b.periodCostUsdCap !== undefined ? money(b.periodCostUsdCap) : "n/a";
	const capReq =
		b.periodRequestsCap !== undefined ? fmt(b.periodRequestsCap) : "n/a";
	return [
		`  - [${stateTag}] ${target}${owner} | period=${b.period} | unit=${b.unit} | used=${fmt(b.observedTokens)} tok (${pct(b.usedPctTokens)}) / cap=${capTok}`,
		`    cost=${money(b.observedCostUsd)} (${pct(b.usedPctCost)}) / cap=${capUsd} | requests=${fmt(b.observedRequests)} (${pct(b.usedPctRequests)}) / cap=${capReq}`,
		`    proj@end: tok=${fmt(b.projectedTokensEndOfPeriod)} (${pct(b.projectedPctTokens)}) | req=${fmt(b.projectedRequestsEndOfPeriod)} (${pct(b.projectedPctRequests)})`,
		`    window: ${b.periodStartIso} -> ${b.periodEndIso}`,
	].join("\n");
}

export function formatProviderBudgetsReport(
	s: QuotaStatus,
	provider?: string,
): string {
	const selector = provider ? parseProviderAccountKey(provider) : undefined;
	const rows = selector
		? s.providerBudgets.filter((b) => {
			if (b.provider !== selector.provider) return false;
			if (!selector.account) return true;
			return b.account === selector.account;
		})
		: s.providerBudgets;

	if (rows.length === 0) {
		return selector
			? `quota-visibility budget: provider '${selector.key}' não configurado em providerBudgets.`
			: "quota-visibility budget: sem providerBudgets configurado.";
	}

	const lines: string[] = [];
	lines.push(`quota-visibility budget (${s.source.windowDays}d)`);
	if (s.providerBudgetPolicy.allocationWarnings.length > 0) {
		lines.push("allocation warnings:");
		for (const w of s.providerBudgetPolicy.allocationWarnings)
			lines.push(`  - ${w}`);
	}
	for (const b of rows) lines.push(formatProviderBudgetLine(b));
	return lines.join("\n");
}

function maxPressurePct(status: ProviderBudgetStatus): number {
	return Math.max(
		safeNum(status.usedPctTokens),
		safeNum(status.projectedPctTokens),
		safeNum(status.usedPctCost),
		safeNum(status.projectedPctCost),
		safeNum(status.usedPctRequests),
		safeNum(status.projectedPctRequests),
	);
}

function routePriority(
	status: ProviderBudgetStatus,
	profile: RoutingProfile,
): number {
	const pressure = maxPressurePct(status);
	const stateScore =
		status.state === "ok" ? 0 : status.state === "warning" ? 1000 : 5000;
	const requestsBonus = status.unit === "requests" ? -20 : 0;
	const reliableBonus =
		profile === "reliable" ? (status.state === "ok" ? -50 : 0) : 0;
	const cheapBonus = profile === "cheap" ? requestsBonus : 0;
	const balancedBonus =
		profile === "balanced" ? (status.state === "ok" ? -10 : 0) : 0;

	return stateScore + pressure + reliableBonus + cheapBonus + balancedBonus;
}

export function buildRouteAdvisory(
	status: QuotaStatus,
	profile: RoutingProfile = "balanced",
): RouteAdvisory {
	const considered = status.providerBudgets
		.map((b) => ({
			provider: b.provider,
			state: b.state,
			unit: b.unit,
			projectedPressurePct: maxPressurePct(b),
			_sortScore: routePriority(b, profile),
		}))
		.sort(
			(a, b) =>
				a._sortScore - b._sortScore || a.provider.localeCompare(b.provider),
		);

	const blockedProviders = considered
		.filter((c) => c.state === "blocked")
		.map((c) => c.provider);
	const winner = considered.find((c) => c.state !== "blocked");

	const reason = !winner
		? "BLOCKER: todos os providers avaliados estão em BLOCK; use recovery/override auditável e ajuste orçamento."
		: winner.state === "warning"
			? `WARN: ${winner.provider} é a melhor opção disponível no momento, porém já está em WARNING.`
			: `OK: ${winner.provider} apresenta melhor headroom para o perfil '${profile}'.`;

	return {
		profile,
		generatedAtIso: status.source.generatedAtIso,
		recommendedProvider: winner?.provider,
		state: !winner ? "blocked" : winner.state,
		reason,
		blockedProviders,
		consideredProviders: considered.map(({ _sortScore, ...row }) => row),
		noAutoSwitch: true,
	};
}

export function formatRouteAdvisory(advisory: RouteAdvisory): string {
	const lines: string[] = [];
	lines.push("quota-visibility route");
	lines.push(`profile: ${advisory.profile}`);
	lines.push(`state: ${advisory.state.toUpperCase()}`);
	lines.push(
		`recommendedProvider: ${advisory.recommendedProvider ?? "(none)"}`,
	);
	lines.push(
		`policy: no-auto-switch=${advisory.noAutoSwitch ? "true" : "false"}`,
	);
	lines.push(`reason: ${advisory.reason}`);
	if (advisory.blockedProviders.length > 0) {
		lines.push(`blockedProviders: ${advisory.blockedProviders.join(", ")}`);
	}
	lines.push("candidates:");
	for (const row of advisory.consideredProviders) {
		lines.push(
			`  - ${row.provider} state=${row.state} unit=${row.unit} projectedPressure=${row.projectedPressurePct.toFixed(1)}%`,
		);
	}
	return lines.join("\n");
}

export function formatStatusReport(s: QuotaStatus): string {
	const lines: string[] = [];
	lines.push("quota-visibility");
	lines.push(
		`window: ${s.source.windowDays}d | sessions: ${s.totals.sessions} | files: ${s.source.scannedFiles} | events: ${s.source.parsedEvents}`,
	);
	if ((s.source.externalBillingEvents ?? 0) > 0) {
		lines.push(
			`external billing: ${s.source.externalBillingEvents} event(s) | source: ${s.source.externalBillingSource ?? "n/a"}`,
		);
	}
	lines.push(
		`tokens: ${fmt(s.totals.tokens)} | cost: ${money(s.totals.costUsd)} | assistant msgs: ${fmt(s.totals.assistantMessages)}`,
	);
	lines.push(
		`burn/day (calendar): ${fmt(s.burn.avgTokensPerCalendarDay)} tokens | proj 7d: ${fmt(s.burn.projectedTokensNext7d)} tokens`,
	);
	lines.push(
		`burn/day (cost): ${money(s.burn.avgCostPerCalendarDay)} | proj 7d cost: ${money(s.burn.projectedCostNext7dUsd)}`,
	);

	if (s.quota.weeklyTokens || s.quota.weeklyCostUsd) {
		lines.push("quota target:");
		if (s.quota.weeklyTokens) {
			lines.push(
				`  weekly tokens: ${fmt(s.quota.weeklyTokens)} | used: ${pct(s.quota.usedPctTokens)} | projected: ${pct(s.quota.projectedPctTokens)}`,
			);
		}
		if (s.quota.weeklyCostUsd) {
			lines.push(
				`  weekly usd: ${money(s.quota.weeklyCostUsd)} | used: ${pct(s.quota.usedPctCost)} | projected: ${pct(s.quota.projectedPctCost)}`,
			);
		}
	}

	if (s.providerBudgets.length > 0) {
		const blocked = s.providerBudgets.filter(
			(b) => b.state === "blocked",
		).length;
		const warn = s.providerBudgets.filter((b) => b.state === "warning").length;
		lines.push(
			`provider budgets: ${s.providerBudgets.length} configured | blocked=${blocked} | warning=${warn}`,
		);
		if (s.providerBudgetPolicy.allocationWarnings.length > 0) {
			lines.push(
				`  allocation warnings: ${s.providerBudgetPolicy.allocationWarnings.length}`,
			);
		}
	}

	const topModel = s.models[0];
	if (topModel)
		lines.push(
			`top model: ${topModel.model} (${fmt(topModel.totalTokens)} tokens, ${money(topModel.costTotalUsd)})`,
		);

	const topSession = s.topSessionsByTokens[0];
	if (topSession) {
		lines.push(
			`top session: ${path.basename(topSession.filePath)} (${fmt(topSession.usage.totalTokens)} tokens, ${money(topSession.usage.costTotalUsd)})`,
		);
	}

	if (s.providerWindows.length > 0) {
		lines.push("provider windows / peak planning:");
		for (const w of s.providerWindows) lines.push(formatWindowInsightLine(w));
	}

	return lines.join("\n");
}

export function formatWindowsReport(s: QuotaStatus, provider?: string): string {
	const normalized = provider ? normalizeProvider(provider) : undefined;
	const rows = normalized
		? s.providerWindows.filter((w) => w.provider === normalized)
		: s.providerWindows;

	if (rows.length === 0) {
		return normalized
			? `quota-visibility windows: provider '${normalized}' não configurado.`
			: "quota-visibility windows: sem providers configurados.";
	}

	const lines: string[] = [];
	lines.push(`quota-visibility windows (${s.source.windowDays}d)`);
	for (const w of rows) lines.push(formatWindowInsightLine(w));
	return lines.join("\n");
}
