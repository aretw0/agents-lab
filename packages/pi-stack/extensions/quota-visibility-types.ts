export type ProviderModel = string;
export type ProviderWindowHours = Record<string, number>;

export interface UsageBreakdown {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	costTotalUsd: number;
}

export interface SessionSample {
	filePath: string;
	startedAtIso: string;
	userMessages: number;
	assistantMessages: number;
	toolResultMessages: number;
	usage: UsageBreakdown;
	byModel: Record<
		ProviderModel,
		UsageBreakdown & { assistantMessages: number }
	>;
}

export interface ParsedSessionData {
	session: SessionSample;
	usageEvents: QuotaUsageEvent[];
}

export interface DailyAggregate {
	day: string;
	sessions: number;
	assistantMessages: number;
	tokens: number;
	costUsd: number;
}

export interface ModelAggregate extends UsageBreakdown {
	assistantMessages: number;
}

export interface QuotaUsageEvent {
	timestampIso: string;
	timestampMs: number;
	dayLocal: string;
	hourLocal: number;
	provider: string;
	account?: string;
	providerAccountKey?: string;
	model: string;
	tokens: number;
	costUsd: number;
	requests: number;
	sessionFile: string;
}

export interface RollingWindowSnapshot {
	startIso: string;
	endIso: string;
	tokens: number;
	costUsd: number;
}

export interface ProviderWindowInsight {
	provider: string;
	windowHours: number;
	observedMessages: number;
	observedTokens: number;
	observedCostUsd: number;
	recentWindow: RollingWindowSnapshot;
	maxWindowInRange?: RollingWindowSnapshot;
	peakHoursLocal: number[];
	highestDemandWindowStartsLocal: number[];
	lowestDemandWindowStartsLocal: number[];
	suggestedStartHoursBeforePeakLocal: number[];
	hourlyAvgTokens: number[];
	notes: string[];
}

export interface ProviderBudgetConfig {
	owner?: string;
	period?: "weekly" | "monthly";
	unit?: "tokens-cost" | "requests";
	requestSharePolicy?: "fixed" | "remaining";
	weeklyQuotaTokens?: number;
	weeklyQuotaCostUsd?: number;
	weeklyQuotaRequests?: number;
	monthlyQuotaTokens?: number;
	monthlyQuotaCostUsd?: number;
	monthlyQuotaRequests?: number;
	shareTokensPct?: number;
	shareCostPct?: number;
	shareRequestsPct?: number;
	shareMonthlyTokensPct?: number;
	shareMonthlyCostPct?: number;
	shareMonthlyRequestsPct?: number;
	warnPct?: number;
	hardPct?: number;
}

export type ProviderBudgetMap = Record<string, ProviderBudgetConfig>;

export interface ProviderBudgetStatus {
	provider: string;
	account?: string;
	providerAccountKey?: string;
	owner?: string;
	period: "weekly" | "monthly";
	unit: "tokens-cost" | "requests";
	requestSharePolicy?: "fixed" | "remaining";
	periodDays: number;
	periodStartIso: string;
	periodEndIso: string;
	observedMessages: number;
	observedTokens: number;
	observedCostUsd: number;
	observedRequests: number;
	projectedTokensEndOfPeriod: number;
	projectedCostUsdEndOfPeriod: number;
	projectedRequestsEndOfPeriod: number;
	periodTokensCap?: number;
	periodCostUsdCap?: number;
	periodRequestsCap?: number;
	usedPctTokens?: number;
	usedPctCost?: number;
	usedPctRequests?: number;
	projectedPctTokens?: number;
	projectedPctCost?: number;
	projectedPctRequests?: number;
	warnPct: number;
	hardPct: number;
	state: "ok" | "warning" | "blocked";
	notes: string[];
}

export type RoutingProfile = "cheap" | "balanced" | "reliable";

export interface RouteAdvisory {
	profile: RoutingProfile;
	generatedAtIso: string;
	recommendedProvider?: string;
	state: "ok" | "warning" | "blocked";
	reason: string;
	blockedProviders: string[];
	consideredProviders: Array<{
		provider: string;
		state: "ok" | "warning" | "blocked";
		unit: "tokens-cost" | "requests";
		projectedPressurePct: number;
	}>;
	noAutoSwitch: true;
}

export interface QuotaStatus {
	source: {
		sessionsRoot: string;
		sessionRoots?: string[];
		scannedFiles: number;
		parsedSessions: number;
		parsedEvents: number;
		externalBillingEvents?: number;
		externalBillingSource?: string;
		windowDays: number;
		generatedAtIso: string;
	};
	totals: {
		sessions: number;
		userMessages: number;
		assistantMessages: number;
		toolResultMessages: number;
		tokens: number;
		costUsd: number;
	};
	burn: {
		activeDays: number;
		avgTokensPerActiveDay: number;
		avgTokensPerCalendarDay: number;
		projectedTokensNext7d: number;
		avgCostPerCalendarDay: number;
		projectedCostNext7dUsd: number;
	};
	quota: {
		weeklyTokens?: number;
		weeklyCostUsd?: number;
		usedPctTokens?: number;
		projectedPctTokens?: number;
		usedPctCost?: number;
		projectedPctCost?: number;
	};
	providerBudgetPolicy: {
		configuredProviders: number;
		allocationWarnings: string[];
	};
	providerBudgets: ProviderBudgetStatus[];
	daily: DailyAggregate[];
	models: Array<{ model: string } & ModelAggregate>;
	providerWindows: ProviderWindowInsight[];
	topSessionsByTokens: SessionSample[];
	topSessionsByCost: SessionSample[];
}

export interface HardPathwayMitigationProjection {
	baseline: {
		tokens: number;
		costUsd: number;
		requests: number;
	};
	projectedAfterHardPathway: {
		tokens: number;
		costUsd: number;
		requests: number;
	};
	delta: {
		tokensSaved: number;
		costUsdSaved: number;
		requestsSaved: number;
		tokensSavedPct: number;
		costUsdSavedPct: number;
		requestsSavedPct: number;
	};
	assumptions: {
		automationCoveragePct: number;
		residualLlmPct: number;
		riskBufferPct: number;
	};
}
