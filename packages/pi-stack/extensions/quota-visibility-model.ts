import { homedir } from "node:os";
import path from "node:path";

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

export function clampPct01(v: unknown, fallback: number): number {
	const n = Number(v);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(0, Math.min(1, n));
}

export function estimateHardPathwayMitigation(params: {
	baselineTokens: number;
	baselineCostUsd: number;
	baselineRequests: number;
	automationCoveragePct?: number;
	residualLlmPct?: number;
	riskBufferPct?: number;
}): HardPathwayMitigationProjection {
	const baselineTokens = Math.max(0, safeNum(params.baselineTokens));
	const baselineCostUsd = Math.max(0, safeNum(params.baselineCostUsd));
	const baselineRequests = Math.max(0, safeNum(params.baselineRequests));
	const automationCoverage = clampPct01(params.automationCoveragePct, 0.8);
	const residualLlm = clampPct01(params.residualLlmPct, 0.1);
	const riskBuffer = clampPct01(params.riskBufferPct, 0.05);
	const effectiveReduction = Math.max(
		0,
		Math.min(1, automationCoverage * Math.max(0, 1 - residualLlm - riskBuffer)),
	);

	const projectedTokens = baselineTokens * (1 - effectiveReduction);
	const projectedCostUsd = baselineCostUsd * (1 - effectiveReduction);
	const projectedRequests = baselineRequests * (1 - effectiveReduction);

	const tokensSaved = Math.max(0, baselineTokens - projectedTokens);
	const costUsdSaved = Math.max(0, baselineCostUsd - projectedCostUsd);
	const requestsSaved = Math.max(0, baselineRequests - projectedRequests);

	return {
		baseline: {
			tokens: baselineTokens,
			costUsd: baselineCostUsd,
			requests: baselineRequests,
		},
		projectedAfterHardPathway: {
			tokens: projectedTokens,
			costUsd: projectedCostUsd,
			requests: projectedRequests,
		},
		delta: {
			tokensSaved,
			costUsdSaved,
			requestsSaved,
			tokensSavedPct: baselineTokens > 0 ? (tokensSaved / baselineTokens) * 100 : 0,
			costUsdSavedPct: baselineCostUsd > 0 ? (costUsdSaved / baselineCostUsd) * 100 : 0,
			requestsSavedPct: baselineRequests > 0 ? (requestsSaved / baselineRequests) * 100 : 0,
		},
		assumptions: {
			automationCoveragePct: automationCoverage,
			residualLlmPct: residualLlm,
			riskBufferPct: riskBuffer,
		},
	};
}

export interface QuotaVisibilitySettings {
	defaultDays?: number;
	weeklyQuotaTokens?: number;
	weeklyQuotaCostUsd?: number;
	weeklyQuotaRequests?: number;
	monthlyQuotaTokens?: number;
	monthlyQuotaCostUsd?: number;
	monthlyQuotaRequests?: number;
	providerWindowHours?: ProviderWindowHours;
	providerBudgets?: ProviderBudgetMap;
	routeModelRefs?: Record<string, string>;
	outputPolicy?: QuotaToolOutputPolicy;
}

export interface QuotaToolOutputPolicy {
	compactLargeJson: boolean;
	maxInlineJsonChars: number;
}

export const SETTINGS_PATH = ["piStack", "quotaVisibility"];
export const DEFAULT_DAYS = 7;
export const MAX_TOP = 10;
export const SESSION_TS_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/;
export const DEFAULT_PROVIDER_WINDOW_HOURS: ProviderWindowHours = {
	anthropic: 5,
	"openai-codex": 5,
};

export const DEFAULT_TOOL_OUTPUT_POLICY: QuotaToolOutputPolicy = {
	compactLargeJson: true,
	maxInlineJsonChars: 1200,
};

export const DEFAULT_COPILOT_BILLING_PATH = path.join(
	homedir(),
	".pi",
	"agent",
	"billing",
	"github-copilot-costs.json",
);

export interface CopilotBillingExtractParams {
	sourceFile: string;
	windowStartMs: number;
	windowEndMs?: number;
}

export function resolveQuotaToolOutputPolicy(
	settings?: QuotaVisibilitySettings,
): QuotaToolOutputPolicy {
	const raw = settings?.outputPolicy;
	const maxInline =
		typeof raw?.maxInlineJsonChars === "number" &&
		Number.isFinite(raw.maxInlineJsonChars)
			? Math.max(400, Math.min(20_000, Math.floor(raw.maxInlineJsonChars)))
			: DEFAULT_TOOL_OUTPUT_POLICY.maxInlineJsonChars;

	return {
		compactLargeJson: raw?.compactLargeJson !== false,
		maxInlineJsonChars: maxInline,
	};
}

export function formatQuotaToolJsonOutput(
	label: string,
	data: unknown,
	policy: QuotaToolOutputPolicy = DEFAULT_TOOL_OUTPUT_POLICY,
): string {
	const pretty = JSON.stringify(data, null, 2);
	if (!policy.compactLargeJson || pretty.length <= policy.maxInlineJsonChars) {
		return pretty;
	}

	const maxPreview = Math.max(200, policy.maxInlineJsonChars - 120);
	const preview = pretty.slice(0, maxPreview).trimEnd();
	return [
		`${label}: output compactado (${pretty.length} chars > ${policy.maxInlineJsonChars})`,
		"preview:",
		preview,
		"...",
		"(payload completo disponível em details)",
	].join("\n");
}

export function safeNum(v: unknown): number {
	if (typeof v === "number") return Number.isFinite(v) ? v : 0;
	if (typeof v === "string") {
		const n = Number(v);
		return Number.isFinite(n) ? n : 0;
	}
	return 0;
}

/** Compact provider label for footer display ("github-copilot" → "copilot"). */
export function shortProviderLabel(p: string): string {
	return p
		.replace("github-copilot", "copilot")
		.replace("openai-codex", "codex")
		.replace("google-gemini-cli", "gemini")
		.replace("google-antigravity", "antigrav");
}

/**
 * Format per-provider budget state into compact footer tokens.
 * Each entry: "✓codex:12%", "✗copilot:100%", "!gemini:78%".
 * Pure — no I/O, no pi APIs.
 */
export function formatBudgetStatusParts(
	providerBudgets: ProviderBudgetStatus[],
): string[] {
	return providerBudgets.map((b) => {
		const pct = Math.round(
			Math.max(
				safeNum(b.usedPctTokens),
				safeNum(b.usedPctCost),
				safeNum(b.usedPctRequests),
			),
		);
		const icon =
			b.state === "blocked" ? "✗" : b.state === "warning" ? "!" : "✓";
		const scope = b.account
			? `${shortProviderLabel(b.provider)}@${b.account}`
			: shortProviderLabel(b.provider);
		return `${icon}${scope}:${pct}%`;
	});
}

export function parseSessionStartFromFilename(
	fileName: string,
): Date | undefined {
	const m = fileName.match(SESSION_TS_RE);
	if (!m) return undefined;
	const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
	const d = new Date(iso);
	return Number.isFinite(d.getTime()) ? d : undefined;
}

export function normalizeProvider(input: unknown): string {
	if (typeof input !== "string") return "unknown";
	const v = input.trim().toLowerCase();
	return v || "unknown";
}

export function normalizeAccountId(input: unknown): string | undefined {
	if (typeof input !== "string") return undefined;
	const value = input.trim().toLowerCase();
	if (!value || value === "unknown") return undefined;
	return value;
}

export interface ProviderAccountRef {
	provider: string;
	account?: string;
	key: string;
}

export function buildProviderAccountKey(
	provider: string,
	account?: string,
): string {
	const normalizedProvider = normalizeProvider(provider);
	const normalizedAccount = normalizeAccountId(account);
	if (!normalizedAccount) return normalizedProvider;
	return `${normalizedProvider}/${normalizedAccount}`;
}

export function parseProviderAccountKey(
	input: unknown,
): ProviderAccountRef | undefined {
	if (typeof input !== "string") return undefined;
	const raw = input.trim();
	if (!raw) return undefined;

	const slash = raw.indexOf("/");
	const providerPart = slash === -1 ? raw : raw.slice(0, slash);
	const accountPart = slash === -1 ? undefined : raw.slice(slash + 1);
	const provider = normalizeProvider(providerPart);
	if (!provider || provider === "unknown") return undefined;
	const account = normalizeAccountId(accountPart);

	return {
		provider,
		account,
		key: buildProviderAccountKey(provider, account),
	};
}

export function resolveUsageEventAccount(
	obj: Record<string, unknown>,
	msg: Record<string, unknown>,
): string | undefined {
	return normalizeAccountId(
		obj.account ??
			obj.accountId ??
			obj.account_id ??
			obj.providerAccount ??
			obj.provider_account ??
			msg.account ??
			msg.accountId ??
			msg.account_id ??
			msg.providerAccount ??
			msg.provider_account,
	);
}

export function toDayLocal(d: Date): string {
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

export function nowLocalMidnight(now = new Date()): Date {
	return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

export function addDays(d: Date, days: number): Date {
	const x = new Date(d);
	x.setDate(x.getDate() + days);
	return x;
}

export function hourLocal(d: Date): number {
	const h = d.getHours();
	return h >= 0 && h <= 23 ? h : 0;
}

export function makeUsage(): UsageBreakdown {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		costTotalUsd: 0,
	};
}

export function extractUsage(usage: unknown): UsageBreakdown {
	const u = (usage ?? {}) as Record<string, unknown>;
	const costObj = (u.cost ?? {}) as Record<string, unknown>;
	const directCost =
		typeof u.cost === "number" || typeof u.cost === "string"
			? u.cost
			: undefined;

	const input = safeNum(
		u.input ??
			u.inputTokens ??
			u.input_tokens ??
			u.promptTokens ??
			u.prompt_tokens,
	);
	const output = safeNum(
		u.output ??
			u.outputTokens ??
			u.output_tokens ??
			u.completionTokens ??
			u.completion_tokens,
	);
	const cacheRead = safeNum(u.cacheRead ?? u.cache_read);
	const cacheWrite = safeNum(u.cacheWrite ?? u.cache_write);

	const explicitTotal = safeNum(
		u.totalTokens ?? u.total_tokens ?? u.tokenCount ?? u.token_count,
	);
	const totalTokens =
		explicitTotal > 0 ? explicitTotal : input + output + cacheRead + cacheWrite;

	const costTotalUsd = safeNum(
		directCost ?? costObj.total ?? costObj.cost ?? costObj.usd,
	);

	return { input, output, cacheRead, cacheWrite, totalTokens, costTotalUsd };
}

export function mergeUsage(dst: UsageBreakdown, src: UsageBreakdown): void {
	dst.input += src.input;
	dst.output += src.output;
	dst.cacheRead += src.cacheRead;
	dst.cacheWrite += src.cacheWrite;
	dst.totalTokens += src.totalTokens;
	dst.costTotalUsd += src.costTotalUsd;
}

export function parseTimestamp(raw: unknown, fallback: Date): Date {
	if (typeof raw === "string") {
		const d = new Date(raw);
		if (Number.isFinite(d.getTime())) return d;
	}
	return fallback;
}

export function parseProviderWindowHours(input: unknown): ProviderWindowHours {
	if (!input || typeof input !== "object") return {};
	const out: ProviderWindowHours = {};

	for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
		const provider = normalizeProvider(k);
		const hours = Math.floor(safeNum(v));
		if (!provider || provider === "unknown") continue;
		if (hours <= 0 || hours > 24) continue;
		out[provider] = hours;
	}

	return out;
}

export function parsePct(raw: unknown): number | undefined {
	const n = safeNum(raw);
	if (!Number.isFinite(n) || n <= 0 || n > 100) return undefined;
	return n;
}

export function parseBudgetPeriod(raw: unknown): "weekly" | "monthly" | undefined {
	if (typeof raw !== "string") return undefined;
	const v = raw.trim().toLowerCase();
	if (v === "weekly" || v === "monthly") return v;
	return undefined;
}

export function startOfCurrentMonthLocal(now = new Date()): Date {
	return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

export function endOfCurrentMonthLocal(now = new Date()): Date {
	return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function daysInCurrentMonth(now = new Date()): number {
	return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

export function startOfRollingWeekLocal(now = new Date()): Date {
	const s = new Date(now);
	s.setHours(0, 0, 0, 0);
	s.setDate(s.getDate() - 6);
	return s;
}

export function parseRouteModelRefs(input: unknown): Record<string, string> {
	if (!input || typeof input !== "object") return {};
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
		const provider = normalizeProvider(k);
		if (!provider || provider === "unknown") continue;
		if (typeof v !== "string") continue;
		const modelRef = v.trim();
		if (!modelRef.includes("/")) continue;
		out[provider] = modelRef;
	}
	return out;
}

export function parseProviderBudgets(input: unknown): ProviderBudgetMap {
	if (!input || typeof input !== "object") return {};
	const out: ProviderBudgetMap = {};

	for (const [k, rawRule] of Object.entries(input as Record<string, unknown>)) {
		const key = parseProviderAccountKey(k);
		if (!key) continue;
		if (!rawRule || typeof rawRule !== "object") continue;

		const ruleObj = rawRule as Record<string, unknown>;
		const period = parseBudgetPeriod(ruleObj.period);
		const unit = ruleObj.unit === "requests" ? "requests" : "tokens-cost";
		const requestSharePolicy =
			ruleObj.requestSharePolicy === "remaining" ? "remaining" : "fixed";
		const weeklyQuotaTokens = safeNum(ruleObj.weeklyQuotaTokens);
		const weeklyQuotaCostUsd = safeNum(ruleObj.weeklyQuotaCostUsd);
		const weeklyQuotaRequests = safeNum(ruleObj.weeklyQuotaRequests);
		const monthlyQuotaTokens = safeNum(ruleObj.monthlyQuotaTokens);
		const monthlyQuotaCostUsd = safeNum(ruleObj.monthlyQuotaCostUsd);
		const monthlyQuotaRequests = safeNum(ruleObj.monthlyQuotaRequests);
		const shareTokensPct = parsePct(ruleObj.shareTokensPct);
		const shareCostPct = parsePct(ruleObj.shareCostPct);
		const shareRequestsPct = parsePct(ruleObj.shareRequestsPct);
		const shareMonthlyTokensPct = parsePct(ruleObj.shareMonthlyTokensPct);
		const shareMonthlyCostPct = parsePct(ruleObj.shareMonthlyCostPct);
		const shareMonthlyRequestsPct = parsePct(ruleObj.shareMonthlyRequestsPct);
		const warnPct = parsePct(ruleObj.warnPct);
		const hardPct = parsePct(ruleObj.hardPct);
		const owner =
			typeof ruleObj.owner === "string"
				? ruleObj.owner.trim() || undefined
				: undefined;

		const hasAny =
			period !== undefined ||
			weeklyQuotaTokens > 0 ||
			weeklyQuotaCostUsd > 0 ||
			weeklyQuotaRequests > 0 ||
			monthlyQuotaTokens > 0 ||
			monthlyQuotaCostUsd > 0 ||
			monthlyQuotaRequests > 0 ||
			shareTokensPct !== undefined ||
			shareCostPct !== undefined ||
			shareRequestsPct !== undefined ||
			shareMonthlyTokensPct !== undefined ||
			shareMonthlyCostPct !== undefined ||
			shareMonthlyRequestsPct !== undefined ||
			warnPct !== undefined ||
			hardPct !== undefined ||
			owner !== undefined ||
			unit === "requests";

		if (!hasAny) continue;

		out[key.key] = {
			owner,
			period,
			unit,
			requestSharePolicy,
			weeklyQuotaTokens: weeklyQuotaTokens > 0 ? weeklyQuotaTokens : undefined,
			weeklyQuotaCostUsd:
				weeklyQuotaCostUsd > 0 ? weeklyQuotaCostUsd : undefined,
			weeklyQuotaRequests:
				weeklyQuotaRequests > 0 ? weeklyQuotaRequests : undefined,
			monthlyQuotaTokens:
				monthlyQuotaTokens > 0 ? monthlyQuotaTokens : undefined,
			monthlyQuotaCostUsd:
				monthlyQuotaCostUsd > 0 ? monthlyQuotaCostUsd : undefined,
			monthlyQuotaRequests:
				monthlyQuotaRequests > 0 ? monthlyQuotaRequests : undefined,
			shareTokensPct,
			shareCostPct,
			shareRequestsPct,
			shareMonthlyTokensPct,
			shareMonthlyCostPct,
			shareMonthlyRequestsPct,
			warnPct,
			hardPct,
		};
	}

	return out;
}

export function computeWindowStartScores(
	hourlyAvgTokens: number[],
	windowHours: number,
): number[] {
	const hours = Math.max(1, Math.min(24, Math.floor(windowHours)));
	const out = Array.from({ length: 24 }, () => 0);

	for (let start = 0; start < 24; start++) {
		let sum = 0;
		for (let i = 0; i < hours; i++) {
			const idx = (start + i) % 24;
			sum += safeNum(hourlyAvgTokens[idx]);
		}
		out[start] = sum;
	}

	return out;
}

export function rankHours(
	values: number[],
	count: number,
	mode: "desc" | "asc",
	requirePositive: boolean,
): number[] {
	const scored = values
		.map((value, hour) => ({ hour, value: safeNum(value) }))
		.filter((x) => (requirePositive ? x.value > 0 : true))
		.sort(
			(a, b) =>
				(mode === "desc" ? b.value - a.value : a.value - b.value) ||
				a.hour - b.hour,
		)
		.slice(0, count)
		.map((x) => x.hour);

	return scored;
}

export function uniqueNumbers(xs: number[]): number[] {
	const out: number[] = [];
	const seen = new Set<number>();
	for (const x of xs) {
		const n = ((x % 24) + 24) % 24;
		if (seen.has(n)) continue;
		seen.add(n);
		out.push(n);
	}
	return out;
}

export function sumTokens(events: QuotaUsageEvent[]): number {
	return events.reduce((acc, e) => acc + e.tokens, 0);
}

export function sumCost(events: QuotaUsageEvent[]): number {
	return events.reduce((acc, e) => acc + e.costUsd, 0);
}

export function sumRequests(events: QuotaUsageEvent[]): number {
	return events.reduce((acc, e) => acc + safeNum(e.requests), 0);
}

export function findMaxRollingWindow(
	eventsSorted: QuotaUsageEvent[],
	windowHours: number,
): RollingWindowSnapshot | undefined {
	if (eventsSorted.length === 0) return undefined;

	const windowMs = Math.max(1, Math.floor(windowHours)) * 60 * 60 * 1000;
	let left = 0;
	let sumTok = 0;
	let sumCostUsd = 0;

	let bestStart = eventsSorted[0].timestampMs;
	let bestEnd = eventsSorted[0].timestampMs;
	let bestTok = 0;
	let bestCostUsd = 0;

	for (let right = 0; right < eventsSorted.length; right++) {
		const curr = eventsSorted[right];
		sumTok += curr.tokens;
		sumCostUsd += curr.costUsd;

		while (
			left <= right &&
			curr.timestampMs - eventsSorted[left].timestampMs > windowMs
		) {
			sumTok -= eventsSorted[left].tokens;
			sumCostUsd -= eventsSorted[left].costUsd;
			left += 1;
		}

		if (sumTok > bestTok || (sumTok === bestTok && sumCostUsd > bestCostUsd)) {
			bestTok = sumTok;
			bestCostUsd = sumCostUsd;
			bestStart = eventsSorted[left].timestampMs;
			bestEnd = curr.timestampMs;
		}
	}

	return {
		startIso: new Date(bestStart).toISOString(),
		endIso: new Date(bestEnd).toISOString(),
		tokens: bestTok,
		costUsd: bestCostUsd,
	};
}

export function buildProviderWindowInsight(
	provider: string,
	windowHours: number,
	events: QuotaUsageEvent[],
	calendarDays: number,
): ProviderWindowInsight {
	const normalized = normalizeProvider(provider);
	const hours = Math.max(1, Math.min(24, Math.floor(windowHours)));
	const providerEvents = events
		.filter((e) => normalizeProvider(e.provider) === normalized)
		.sort((a, b) => a.timestampMs - b.timestampMs);

	const notes: string[] = [];
	const observedTokens = sumTokens(providerEvents);
	const observedCostUsd = sumCost(providerEvents);

	const windowMs = hours * 60 * 60 * 1000;
	const nowMs = Date.now();
	const cutoffMs = nowMs - windowMs;
	const recentEvents = providerEvents.filter((e) => e.timestampMs >= cutoffMs);

	const recentWindow: RollingWindowSnapshot = {
		startIso: new Date(cutoffMs).toISOString(),
		endIso: new Date(nowMs).toISOString(),
		tokens: sumTokens(recentEvents),
		costUsd: sumCost(recentEvents),
	};

	const hourlyTotals = Array.from({ length: 24 }, () => 0);
	for (const e of providerEvents) hourlyTotals[e.hourLocal] += e.tokens;
	const denomDays = Math.max(1, Math.floor(calendarDays));
	const hourlyAvgTokens = hourlyTotals.map((v) => v / denomDays);

	const peakHoursLocal = rankHours(hourlyAvgTokens, 3, "desc", true);
	const startScores = computeWindowStartScores(hourlyAvgTokens, hours);
	const highestDemandWindowStartsLocal = rankHours(
		startScores,
		3,
		"desc",
		true,
	);
	const lowestDemandWindowStartsLocal = rankHours(startScores, 3, "asc", false);
	const suggestedStartHoursBeforePeakLocal = uniqueNumbers(
		peakHoursLocal.map((h) => h - hours),
	);

	const maxWindowInRange = findMaxRollingWindow(providerEvents, hours);

	if (providerEvents.length === 0) {
		notes.push("No usage events found in range for this provider.");
		notes.push(
			"Keep monitoring until enough history exists to estimate peak hours.",
		);
	} else {
		if (observedTokens === 0) {
			notes.push(
				"Provider events exist but token usage fields were empty/zero.",
			);
		}
		if (peakHoursLocal.length > 0) {
			notes.push(
				"Peak hours are historical tendencies, not provider-guaranteed limits.",
			);
			notes.push(
				"For strict 5h windows, starting before predicted peaks can protect productive time.",
			);
		}
	}

	return {
		provider: normalized,
		windowHours: hours,
		observedMessages: providerEvents.length,
		observedTokens,
		observedCostUsd,
		recentWindow,
		maxWindowInRange,
		peakHoursLocal,
		highestDemandWindowStartsLocal,
		lowestDemandWindowStartsLocal,
		suggestedStartHoursBeforePeakLocal,
		hourlyAvgTokens,
		notes,
	};
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
	const budgetRefs = Object.keys(params.providerBudgets)
		.map((key) => parseProviderAccountKey(key))
		.filter((row): row is ProviderAccountRef => Boolean(row));
	if (budgetRefs.length === 0) return { allocationWarnings, budgets: [] };

	const budgetKeys = budgetRefs.map((row) => row.key);
	const sumShareTokensWeekly = budgetKeys.reduce(
		(acc, key) => acc + safeNum(params.providerBudgets[key]?.shareTokensPct),
		0,
	);
	const sumShareCostWeekly = budgetKeys.reduce(
		(acc, key) => acc + safeNum(params.providerBudgets[key]?.shareCostPct),
		0,
	);
	const sumShareTokensMonthly = budgetKeys.reduce(
		(acc, key) =>
			acc + safeNum(params.providerBudgets[key]?.shareMonthlyTokensPct),
		0,
	);
	const sumShareCostMonthly = budgetKeys.reduce(
		(acc, key) => acc + safeNum(params.providerBudgets[key]?.shareMonthlyCostPct),
		0,
	);
	const sumShareRequestsWeekly = budgetKeys.reduce(
		(acc, key) => acc + safeNum(params.providerBudgets[key]?.shareRequestsPct),
		0,
	);
	const sumShareRequestsMonthly = budgetKeys.reduce(
		(acc, key) =>
			acc + safeNum(params.providerBudgets[key]?.shareMonthlyRequestsPct),
		0,
	);

	if (sumShareTokensWeekly > 100.001) {
		allocationWarnings.push(
			`providerBudgets.shareTokensPct soma ${sumShareTokensWeekly.toFixed(2)}% (>100%).`,
		);
	}
	if (sumShareCostWeekly > 100.001) {
		allocationWarnings.push(
			`providerBudgets.shareCostPct soma ${sumShareCostWeekly.toFixed(2)}% (>100%).`,
		);
	}
	if (sumShareTokensMonthly > 100.001) {
		allocationWarnings.push(
			`providerBudgets.shareMonthlyTokensPct soma ${sumShareTokensMonthly.toFixed(2)}% (>100%).`,
		);
	}
	if (sumShareCostMonthly > 100.001) {
		allocationWarnings.push(
			`providerBudgets.shareMonthlyCostPct soma ${sumShareCostMonthly.toFixed(2)}% (>100%).`,
		);
	}
	if (sumShareRequestsWeekly > 100.001) {
		allocationWarnings.push(
			`providerBudgets.shareRequestsPct soma ${sumShareRequestsWeekly.toFixed(2)}% (>100%).`,
		);
	}
	if (sumShareRequestsMonthly > 100.001) {
		allocationWarnings.push(
			`providerBudgets.shareMonthlyRequestsPct soma ${sumShareRequestsMonthly.toFixed(2)}% (>100%).`,
		);
	}

	const now = new Date();
	const nowMs = now.getTime();
	const dayMs = 24 * 60 * 60 * 1000;

	const budgets: ProviderBudgetStatus[] = budgetRefs
		.sort((a, b) => a.key.localeCompare(b.key))
		.map((budgetRef) => {
			const provider = budgetRef.provider;
			const account = budgetRef.account;
			const providerAccountKey = budgetRef.key;
			const rule = params.providerBudgets[providerAccountKey] ?? {};
			const notes: string[] = [];

			const inferredPeriod: "weekly" | "monthly" =
				rule.period ??
				(rule.monthlyQuotaTokens ||
				rule.monthlyQuotaCostUsd ||
				rule.shareMonthlyTokensPct ||
				rule.shareMonthlyCostPct
					? "monthly"
					: "weekly");

			const periodStart =
				inferredPeriod === "monthly"
					? startOfCurrentMonthLocal(now)
					: startOfRollingWeekLocal(now);
			const periodEnd =
				inferredPeriod === "monthly"
					? endOfCurrentMonthLocal(now)
					: new Date(periodStart.getTime() + 7 * dayMs - 1);
			const periodDays =
				inferredPeriod === "monthly" ? daysInCurrentMonth(now) : 7;

			const providerEvents = usageEvents.filter((e) => {
				if (normalizeProvider(e.provider) !== provider) return false;
				if (
					e.timestampMs < periodStart.getTime() ||
					e.timestampMs > nowMs
				)
					return false;
				if (!account) return true;
				return normalizeAccountId(e.account) === account;
			});

			const observedMessages = providerEvents.length;
			const observedTokens = sumTokens(providerEvents);
			const observedCostUsd = sumCost(providerEvents);
			const observedRequests = sumRequests(providerEvents);

			const warnPct = rule.warnPct ?? 80;
			let hardPct = rule.hardPct ?? 100;
			if (hardPct < warnPct) {
				notes.push(
					`hardPct (${hardPct}) < warnPct (${warnPct}); ajustado para hardPct=${warnPct}.`,
				);
				hardPct = warnPct;
			}

			const periodTokensCap =
				inferredPeriod === "monthly"
					? (rule.monthlyQuotaTokens ??
						(rule.shareMonthlyTokensPct && params.monthlyQuotaTokens
							? (params.monthlyQuotaTokens * rule.shareMonthlyTokensPct) / 100
							: undefined))
					: (rule.weeklyQuotaTokens ??
						(rule.shareTokensPct && params.weeklyQuotaTokens
							? (params.weeklyQuotaTokens * rule.shareTokensPct) / 100
							: undefined));

			const periodCostUsdCap =
				inferredPeriod === "monthly"
					? (rule.monthlyQuotaCostUsd ??
						(rule.shareMonthlyCostPct && params.monthlyQuotaCostUsd
							? (params.monthlyQuotaCostUsd * rule.shareMonthlyCostPct) / 100
							: undefined))
					: (rule.weeklyQuotaCostUsd ??
						(rule.shareCostPct && params.weeklyQuotaCostUsd
							? (params.weeklyQuotaCostUsd * rule.shareCostPct) / 100
							: undefined));

			const requestSharePct =
				inferredPeriod === "monthly"
					? rule.shareMonthlyRequestsPct
					: rule.shareRequestsPct;
			const globalRequests =
				inferredPeriod === "monthly"
					? params.monthlyQuotaRequests
					: params.weeklyQuotaRequests;
			const observedRequestsAllProviders = sumRequests(
				usageEvents.filter(
					(e) =>
						e.timestampMs >= periodStart.getTime() && e.timestampMs <= nowMs,
				),
			);
			const availableRequests =
				globalRequests !== undefined
					? Math.max(0, globalRequests - observedRequestsAllProviders)
					: undefined;

			const periodRequestsCap =
				inferredPeriod === "monthly"
					? (rule.monthlyQuotaRequests ??
						(requestSharePct && globalRequests
							? rule.requestSharePolicy === "remaining"
								? (Math.max(0, availableRequests ?? 0) * requestSharePct) / 100
								: (globalRequests * requestSharePct) / 100
							: undefined))
					: (rule.weeklyQuotaRequests ??
						(requestSharePct && globalRequests
							? rule.requestSharePolicy === "remaining"
								? (Math.max(0, availableRequests ?? 0) * requestSharePct) / 100
								: (globalRequests * requestSharePct) / 100
							: undefined));

			if (inferredPeriod === "monthly") {
				if (
					rule.shareMonthlyTokensPct &&
					!params.monthlyQuotaTokens &&
					!rule.monthlyQuotaTokens
				) {
					notes.push(
						"shareMonthlyTokensPct definido sem monthlyQuotaTokens global; configure monthlyQuotaTokens ou quota mensal absoluta por provider.",
					);
				}
				if (
					rule.shareMonthlyCostPct &&
					!params.monthlyQuotaCostUsd &&
					!rule.monthlyQuotaCostUsd
				) {
					notes.push(
						"shareMonthlyCostPct definido sem monthlyQuotaCostUsd global; configure monthlyQuotaCostUsd ou quota mensal absoluta por provider.",
					);
				}
			} else {
				if (
					rule.shareTokensPct &&
					!params.weeklyQuotaTokens &&
					!rule.weeklyQuotaTokens
				) {
					notes.push(
						"shareTokensPct definido sem weeklyQuotaTokens global; configure weeklyQuotaTokens ou quota semanal absoluta por provider.",
					);
				}
				if (
					rule.shareCostPct &&
					!params.weeklyQuotaCostUsd &&
					!rule.weeklyQuotaCostUsd
				) {
					notes.push(
						"shareCostPct definido sem weeklyQuotaCostUsd global; configure weeklyQuotaCostUsd ou quota semanal absoluta por provider.",
					);
				}
			}

			if (requestSharePct && !globalRequests && !periodRequestsCap) {
				notes.push(
					inferredPeriod === "monthly"
						? "shareMonthlyRequestsPct definido sem monthlyQuotaRequests global; configure monthlyQuotaRequests ou quota mensal absoluta por provider."
						: "shareRequestsPct definido sem weeklyQuotaRequests global; configure weeklyQuotaRequests ou quota semanal absoluta por provider.",
				);
			}

			if (
				periodTokensCap === undefined &&
				periodCostUsdCap === undefined &&
				periodRequestsCap === undefined
			) {
				notes.push(
					inferredPeriod === "monthly"
						? "Sem limite mensal resolvido (tokens/custo/requests) para este provider."
						: "Sem limite semanal resolvido (tokens/custo/requests) para este provider.",
				);
			}

			const elapsedDays = Math.max(
				1,
				Math.floor(
					(nowLocalMidnight(now).getTime() - periodStart.getTime()) / dayMs,
				) + 1,
			);

			const projectedTokensEndOfPeriod =
				(observedTokens / elapsedDays) * periodDays;
			const projectedCostUsdEndOfPeriod =
				(observedCostUsd / elapsedDays) * periodDays;
			const projectedRequestsEndOfPeriod =
				(observedRequests / elapsedDays) * periodDays;

			const usedPctTokens =
				periodTokensCap !== undefined
					? periodTokensCap === 0
						? observedTokens > 0
							? 100
							: 0
						: (observedTokens / periodTokensCap) * 100
					: undefined;
			const projectedPctTokens =
				periodTokensCap !== undefined
					? periodTokensCap === 0
						? projectedTokensEndOfPeriod > 0
							? 100
							: 0
						: (projectedTokensEndOfPeriod / periodTokensCap) * 100
					: undefined;
			const usedPctCost =
				periodCostUsdCap !== undefined
					? periodCostUsdCap === 0
						? observedCostUsd > 0
							? 100
							: 0
						: (observedCostUsd / periodCostUsdCap) * 100
					: undefined;
			const projectedPctCost =
				periodCostUsdCap !== undefined
					? periodCostUsdCap === 0
						? projectedCostUsdEndOfPeriod > 0
							? 100
							: 0
						: (projectedCostUsdEndOfPeriod / periodCostUsdCap) * 100
					: undefined;
			const usedPctRequests =
				periodRequestsCap !== undefined
					? periodRequestsCap === 0
						? observedRequests > 0
							? 100
							: 0
						: (observedRequests / periodRequestsCap) * 100
					: undefined;
			const projectedPctRequests =
				periodRequestsCap !== undefined
					? periodRequestsCap === 0
						? projectedRequestsEndOfPeriod > 0
							? 100
							: 0
						: (projectedRequestsEndOfPeriod / periodRequestsCap) * 100
					: undefined;

			const maxPct = Math.max(
				safeNum(usedPctTokens),
				safeNum(projectedPctTokens),
				safeNum(usedPctCost),
				safeNum(projectedPctCost),
				safeNum(usedPctRequests),
				safeNum(projectedPctRequests),
			);

			let state: ProviderBudgetStatus["state"] = "ok";
			if (maxPct >= hardPct && hardPct > 0) state = "blocked";
			else if (maxPct >= warnPct && warnPct > 0) state = "warning";

			return {
				provider,
				account,
				providerAccountKey,
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
