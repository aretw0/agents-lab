/**
 * quota-visibility — consumer-side quota observability for pi sessions.
 * @capability-id quota-visibility-ops
 * @capability-criticality high
 *
 * Why:
 * - Provider dashboards can be opaque for weekly quotas.
 * - Users need evidence (per-day, per-model, per-session outliers) to dispute spikes.
 * - Some providers enforce short rolling windows (ex.: 5h), so users need a
 *   peak-hours plan to decide when to start a window.
 *
 * Data source:
 * - ~/.pi/agent/sessions (arquivos .jsonl recursivos)
 */

import { createReadStream, promises as fs, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

type ProviderModel = string;
type ProviderWindowHours = Record<string, number>;

interface UsageBreakdown {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	costTotalUsd: number;
}

interface SessionSample {
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

interface ParsedSessionData {
	session: SessionSample;
	usageEvents: QuotaUsageEvent[];
}

interface DailyAggregate {
	day: string;
	sessions: number;
	assistantMessages: number;
	tokens: number;
	costUsd: number;
}

interface ModelAggregate extends UsageBreakdown {
	assistantMessages: number;
}

export interface QuotaUsageEvent {
	timestampIso: string;
	timestampMs: number;
	dayLocal: string;
	hourLocal: number;
	provider: string;
	model: string;
	tokens: number;
	costUsd: number;
	requests: number;
	sessionFile: string;
}

interface RollingWindowSnapshot {
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

interface QuotaVisibilitySettings {
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

const SETTINGS_PATH = ["piStack", "quotaVisibility"];
const DEFAULT_DAYS = 7;
const MAX_TOP = 10;
const SESSION_TS_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/;
const DEFAULT_PROVIDER_WINDOW_HOURS: ProviderWindowHours = {
	anthropic: 5,
	"openai-codex": 5,
};

const DEFAULT_TOOL_OUTPUT_POLICY: QuotaToolOutputPolicy = {
	compactLargeJson: true,
	maxInlineJsonChars: 1200,
};

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
		return `${icon}${shortProviderLabel(b.provider)}:${pct}%`;
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

function normalizeProvider(input: unknown): string {
	if (typeof input !== "string") return "unknown";
	const v = input.trim().toLowerCase();
	return v || "unknown";
}

function toDayLocal(d: Date): string {
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

function nowLocalMidnight(now = new Date()): Date {
	return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

function addDays(d: Date, days: number): Date {
	const x = new Date(d);
	x.setDate(x.getDate() + days);
	return x;
}

function hourLocal(d: Date): number {
	const h = d.getHours();
	return h >= 0 && h <= 23 ? h : 0;
}

function makeUsage(): UsageBreakdown {
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

function mergeUsage(dst: UsageBreakdown, src: UsageBreakdown): void {
	dst.input += src.input;
	dst.output += src.output;
	dst.cacheRead += src.cacheRead;
	dst.cacheWrite += src.cacheWrite;
	dst.totalTokens += src.totalTokens;
	dst.costTotalUsd += src.costTotalUsd;
}

function parseTimestamp(raw: unknown, fallback: Date): Date {
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

function parsePct(raw: unknown): number | undefined {
	const n = safeNum(raw);
	if (!Number.isFinite(n) || n <= 0 || n > 100) return undefined;
	return n;
}

function parseBudgetPeriod(raw: unknown): "weekly" | "monthly" | undefined {
	if (typeof raw !== "string") return undefined;
	const v = raw.trim().toLowerCase();
	if (v === "weekly" || v === "monthly") return v;
	return undefined;
}

function startOfCurrentMonthLocal(now = new Date()): Date {
	return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function endOfCurrentMonthLocal(now = new Date()): Date {
	return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
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
		const provider = normalizeProvider(k);
		if (!provider || provider === "unknown") continue;
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

		out[provider] = {
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

function rankHours(
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

function uniqueNumbers(xs: number[]): number[] {
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

function sumTokens(events: QuotaUsageEvent[]): number {
	return events.reduce((acc, e) => acc + e.tokens, 0);
}

function sumCost(events: QuotaUsageEvent[]): number {
	return events.reduce((acc, e) => acc + e.costUsd, 0);
}

function sumRequests(events: QuotaUsageEvent[]): number {
	return events.reduce((acc, e) => acc + safeNum(e.requests), 0);
}

function findMaxRollingWindow(
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
	const providers = Object.keys(params.providerBudgets).map((p) =>
		normalizeProvider(p),
	);
	if (providers.length === 0) return { allocationWarnings, budgets: [] };

	const sumShareTokensWeekly = providers.reduce(
		(acc, p) => acc + safeNum(params.providerBudgets[p]?.shareTokensPct),
		0,
	);
	const sumShareCostWeekly = providers.reduce(
		(acc, p) => acc + safeNum(params.providerBudgets[p]?.shareCostPct),
		0,
	);
	const sumShareTokensMonthly = providers.reduce(
		(acc, p) => acc + safeNum(params.providerBudgets[p]?.shareMonthlyTokensPct),
		0,
	);
	const sumShareCostMonthly = providers.reduce(
		(acc, p) => acc + safeNum(params.providerBudgets[p]?.shareMonthlyCostPct),
		0,
	);
	const sumShareRequestsWeekly = providers.reduce(
		(acc, p) => acc + safeNum(params.providerBudgets[p]?.shareRequestsPct),
		0,
	);
	const sumShareRequestsMonthly = providers.reduce(
		(acc, p) =>
			acc + safeNum(params.providerBudgets[p]?.shareMonthlyRequestsPct),
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

	const budgets: ProviderBudgetStatus[] = providers
		.sort((a, b) => a.localeCompare(b))
		.map((provider) => {
			const rule = params.providerBudgets[provider] ?? {};
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

			const providerEvents = usageEvents.filter(
				(e) =>
					normalizeProvider(e.provider) === provider &&
					e.timestampMs >= periodStart.getTime() &&
					e.timestampMs <= nowMs,
			);

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

async function walkJsonlFiles(root: string): Promise<string[]> {
	const out: string[] = [];
	const stack = [root];

	while (stack.length > 0) {
		const dir = stack.pop()!;
		let entries: Array<{
			name: string;
			isDirectory: () => boolean;
			isFile: () => boolean;
		}> = [];
		try {
			entries = (await fs.readdir(dir, { withFileTypes: true })) as Array<{
				name: string;
				isDirectory: () => boolean;
				isFile: () => boolean;
			}>;
		} catch {
			continue;
		}

		for (const entry of entries) {
			const p = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				stack.push(p);
				continue;
			}
			if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(p);
		}
	}

	return out;
}

function readSettings(cwd: string): QuotaVisibilitySettings {
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

async function parseSessionFile(
	filePath: string,
): Promise<ParsedSessionData | undefined> {
	const fileName = path.basename(filePath);
	let startedAt = parseSessionStartFromFilename(fileName);

	const usageTotal = makeUsage();
	const byModel = new Map<string, ModelAggregate>();
	const usageEvents: QuotaUsageEvent[] = [];

	let userMessages = 0;
	let assistantMessages = 0;
	let toolResultMessages = 0;

	const stream = createReadStream(filePath, { encoding: "utf8" });
	const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

	try {
		for await (const line of rl) {
			if (!line) continue;
			let obj: any;
			try {
				obj = JSON.parse(line);
			} catch {
				continue;
			}

			if (obj?.type === "session") {
				if (!startedAt && typeof obj.timestamp === "string") {
					const d = new Date(obj.timestamp);
					if (Number.isFinite(d.getTime())) startedAt = d;
				}
				continue;
			}

			if (obj?.type !== "message") continue;
			const msg = obj.message ?? {};
			const role = typeof msg.role === "string" ? msg.role : undefined;
			if (role === "user") {
				userMessages += 1;
				continue;
			}
			if (role === "toolResult") {
				toolResultMessages += 1;
				continue;
			}
			if (role !== "assistant") continue;

			assistantMessages += 1;

			const provider = normalizeProvider(
				typeof obj.provider === "string" ? obj.provider : msg.provider,
			);
			const model =
				typeof obj.model === "string"
					? obj.model
					: typeof msg.model === "string"
						? msg.model
						: typeof obj.modelId === "string"
							? obj.modelId
							: typeof msg.modelId === "string"
								? msg.modelId
								: "unknown";
			const modelKey = `${provider}/${model}`;

			const usage = extractUsage(obj.usage ?? msg.usage);
			mergeUsage(usageTotal, usage);

			const curr = byModel.get(modelKey) ?? {
				...makeUsage(),
				assistantMessages: 0,
			};
			mergeUsage(curr, usage);
			curr.assistantMessages += 1;
			byModel.set(modelKey, curr);

			const baseTime = startedAt ?? new Date();
			const ts = parseTimestamp(obj.timestamp ?? msg.timestamp, baseTime);

			const rawUsage = (obj.usage ?? msg.usage ?? {}) as Record<
				string,
				unknown
			>;
			const explicitRequests = safeNum(
				rawUsage.requests ??
					rawUsage.requestCount ??
					rawUsage.request_count ??
					rawUsage.premiumRequests ??
					rawUsage.premium_requests,
			);
			const inferredRequests = provider === "github-copilot" ? 1 : 0;
			const requests =
				explicitRequests > 0 ? explicitRequests : inferredRequests;

			usageEvents.push({
				timestampIso: ts.toISOString(),
				timestampMs: ts.getTime(),
				dayLocal: toDayLocal(ts),
				hourLocal: hourLocal(ts),
				provider,
				model,
				tokens: usage.totalTokens,
				costUsd: usage.costTotalUsd,
				requests,
				sessionFile: filePath,
			});
		}
	} finally {
		rl.close();
		stream.destroy();
	}

	if (!startedAt) return undefined;

	const byModelObj: Record<string, ModelAggregate> = {};
	for (const [k, v] of byModel.entries()) byModelObj[k] = v;

	return {
		session: {
			filePath,
			startedAtIso: startedAt.toISOString(),
			userMessages,
			assistantMessages,
			toolResultMessages,
			usage: usageTotal,
			byModel: byModelObj,
		},
		usageEvents,
	};
}

export function buildQuotaStatus(
	sessions: SessionSample[],
	usageEvents: QuotaUsageEvent[],
	params: {
		days: number;
		sessionsRoot: string;
		scannedFiles: number;
		weeklyQuotaTokens?: number;
		weeklyQuotaCostUsd?: number;
		weeklyQuotaRequests?: number;
		monthlyQuotaTokens?: number;
		monthlyQuotaCostUsd?: number;
		monthlyQuotaRequests?: number;
		providerWindowHours: ProviderWindowHours;
		providerBudgets: ProviderBudgetMap;
	},
): QuotaStatus {
	const totals = {
		sessions: sessions.length,
		userMessages: 0,
		assistantMessages: 0,
		toolResultMessages: 0,
		tokens: 0,
		costUsd: 0,
	};

	const byDay = new Map<string, DailyAggregate>();
	const byModel = new Map<string, ModelAggregate>();

	for (const s of sessions) {
		totals.userMessages += s.userMessages;
		totals.assistantMessages += s.assistantMessages;
		totals.toolResultMessages += s.toolResultMessages;
		totals.tokens += s.usage.totalTokens;
		totals.costUsd += s.usage.costTotalUsd;

		const day = toDayLocal(new Date(s.startedAtIso));
		const dayAgg = byDay.get(day) ?? {
			day,
			sessions: 0,
			assistantMessages: 0,
			tokens: 0,
			costUsd: 0,
		};
		dayAgg.sessions += 1;
		dayAgg.assistantMessages += s.assistantMessages;
		dayAgg.tokens += s.usage.totalTokens;
		dayAgg.costUsd += s.usage.costTotalUsd;
		byDay.set(day, dayAgg);

		for (const [mk, v] of Object.entries(s.byModel)) {
			const acc = byModel.get(mk) ?? { ...makeUsage(), assistantMessages: 0 };
			mergeUsage(acc, v);
			acc.assistantMessages += v.assistantMessages;
			byModel.set(mk, acc);
		}
	}

	const activeDays = Math.max(1, byDay.size);
	const avgTokensPerActiveDay = totals.tokens / activeDays;
	const avgTokensPerCalendarDay = totals.tokens / Math.max(1, params.days);
	const projectedTokensNext7d = avgTokensPerCalendarDay * 7;
	const avgCostPerCalendarDay = totals.costUsd / Math.max(1, params.days);
	const projectedCostNext7dUsd = avgCostPerCalendarDay * 7;

	const usedPctTokens = params.weeklyQuotaTokens
		? (totals.tokens / params.weeklyQuotaTokens) * 100
		: undefined;
	const projectedPctTokens = params.weeklyQuotaTokens
		? (projectedTokensNext7d / params.weeklyQuotaTokens) * 100
		: undefined;
	const usedPctCost = params.weeklyQuotaCostUsd
		? (totals.costUsd / params.weeklyQuotaCostUsd) * 100
		: undefined;
	const projectedPctCost = params.weeklyQuotaCostUsd
		? (projectedCostNext7dUsd / params.weeklyQuotaCostUsd) * 100
		: undefined;

	const topSessionsByTokens = [...sessions]
		.sort((a, b) => b.usage.totalTokens - a.usage.totalTokens)
		.slice(0, MAX_TOP);

	const topSessionsByCost = [...sessions]
		.sort((a, b) => b.usage.costTotalUsd - a.usage.costTotalUsd)
		.slice(0, MAX_TOP);

	const providerWindows = Object.entries(params.providerWindowHours)
		.map(([provider, hours]) =>
			buildProviderWindowInsight(provider, hours, usageEvents, params.days),
		)
		.sort((a, b) => b.observedTokens - a.observedTokens);

	const providerBudgetEval = buildProviderBudgetStatuses(usageEvents, {
		days: params.days,
		weeklyQuotaTokens: params.weeklyQuotaTokens,
		weeklyQuotaCostUsd: params.weeklyQuotaCostUsd,
		weeklyQuotaRequests: params.weeklyQuotaRequests,
		monthlyQuotaTokens: params.monthlyQuotaTokens,
		monthlyQuotaCostUsd: params.monthlyQuotaCostUsd,
		monthlyQuotaRequests: params.monthlyQuotaRequests,
		providerBudgets: params.providerBudgets,
	});

	return {
		source: {
			sessionsRoot: params.sessionsRoot,
			scannedFiles: params.scannedFiles,
			parsedSessions: sessions.length,
			parsedEvents: usageEvents.length,
			windowDays: params.days,
			generatedAtIso: new Date().toISOString(),
		},
		totals,
		burn: {
			activeDays,
			avgTokensPerActiveDay,
			avgTokensPerCalendarDay,
			projectedTokensNext7d,
			avgCostPerCalendarDay,
			projectedCostNext7dUsd,
		},
		quota: {
			weeklyTokens: params.weeklyQuotaTokens,
			weeklyCostUsd: params.weeklyQuotaCostUsd,
			usedPctTokens,
			projectedPctTokens,
			usedPctCost,
			projectedPctCost,
		},
		providerBudgetPolicy: {
			configuredProviders: Object.keys(params.providerBudgets).length,
			allocationWarnings: providerBudgetEval.allocationWarnings,
		},
		providerBudgets: providerBudgetEval.budgets,
		daily: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
		models: [...byModel.entries()]
			.map(([model, v]) => ({ model, ...v }))
			.sort((a, b) => b.totalTokens - a.totalTokens),
		providerWindows,
		topSessionsByTokens,
		topSessionsByCost,
	};
}

export async function analyzeQuota(params: {
	days: number;
	weeklyQuotaTokens?: number;
	weeklyQuotaCostUsd?: number;
	weeklyQuotaRequests?: number;
	monthlyQuotaTokens?: number;
	monthlyQuotaCostUsd?: number;
	monthlyQuotaRequests?: number;
	providerWindowHours: ProviderWindowHours;
	providerBudgets: ProviderBudgetMap;
}): Promise<QuotaStatus> {
	const sessionsRoot = path.join(homedir(), ".pi", "agent", "sessions");
	const files = await walkJsonlFiles(sessionsRoot);

	const now = nowLocalMidnight();
	const start = addDays(now, -(params.days - 1));

	const filtered = files.filter((f) => {
		const d = parseSessionStartFromFilename(path.basename(f));
		if (!d) return true;
		return d >= start;
	});

	const sessions: SessionSample[] = [];
	const usageEvents: QuotaUsageEvent[] = [];

	for (const filePath of filtered) {
		const parsed = await parseSessionFile(filePath);
		if (!parsed) continue;

		if (new Date(parsed.session.startedAtIso) < start) continue;
		sessions.push(parsed.session);
		usageEvents.push(...parsed.usageEvents);
	}

	return buildQuotaStatus(sessions, usageEvents, {
		days: params.days,
		sessionsRoot,
		scannedFiles: filtered.length,
		weeklyQuotaTokens: params.weeklyQuotaTokens,
		weeklyQuotaCostUsd: params.weeklyQuotaCostUsd,
		weeklyQuotaRequests: params.weeklyQuotaRequests,
		monthlyQuotaTokens: params.monthlyQuotaTokens,
		monthlyQuotaCostUsd: params.monthlyQuotaCostUsd,
		monthlyQuotaRequests: params.monthlyQuotaRequests,
		providerWindowHours: params.providerWindowHours,
		providerBudgets: params.providerBudgets,
	});
}

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
	const capTok =
		b.periodTokensCap !== undefined ? fmt(b.periodTokensCap) : "n/a";
	const capUsd =
		b.periodCostUsdCap !== undefined ? money(b.periodCostUsdCap) : "n/a";
	const capReq =
		b.periodRequestsCap !== undefined ? fmt(b.periodRequestsCap) : "n/a";
	return [
		`  - [${stateTag}] ${b.provider}${owner} | period=${b.period} | unit=${b.unit} | used=${fmt(b.observedTokens)} tok (${pct(b.usedPctTokens)}) / cap=${capTok}`,
		`    cost=${money(b.observedCostUsd)} (${pct(b.usedPctCost)}) / cap=${capUsd} | requests=${fmt(b.observedRequests)} (${pct(b.usedPctRequests)}) / cap=${capReq}`,
		`    proj@end: tok=${fmt(b.projectedTokensEndOfPeriod)} (${pct(b.projectedPctTokens)}) | req=${fmt(b.projectedRequestsEndOfPeriod)} (${pct(b.projectedPctRequests)})`,
		`    window: ${b.periodStartIso} -> ${b.periodEndIso}`,
	].join("\n");
}

function formatProviderBudgetsReport(
	s: QuotaStatus,
	provider?: string,
): string {
	const normalized = provider ? normalizeProvider(provider) : undefined;
	const rows = normalized
		? s.providerBudgets.filter((b) => b.provider === normalized)
		: s.providerBudgets;

	if (rows.length === 0) {
		return normalized
			? `quota-visibility budget: provider '${normalized}' não configurado em providerBudgets.`
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

function formatRouteAdvisory(advisory: RouteAdvisory): string {
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

function formatStatusReport(s: QuotaStatus): string {
	const lines: string[] = [];
	lines.push("quota-visibility");
	lines.push(
		`window: ${s.source.windowDays}d | sessions: ${s.totals.sessions} | files: ${s.source.scannedFiles} | events: ${s.source.parsedEvents}`,
	);
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

function formatWindowsReport(s: QuotaStatus, provider?: string): string {
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

async function writeEvidenceBundle(
	ctx: ExtensionContext,
	report: QuotaStatus,
): Promise<string> {
	const dir = path.join(ctx.cwd, ".pi", "reports");
	await fs.mkdir(dir, { recursive: true });

	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const out = path.join(dir, `quota-visibility-${stamp}.json`);
	await fs.writeFile(out, JSON.stringify(report, null, 2), "utf8");
	return out;
}

function parseDays(raw?: string): number | undefined {
	if (!raw) return undefined;
	const n = Math.floor(safeNum(raw));
	if (n <= 0) return undefined;
	return n;
}

function parseRoutingProfile(raw?: string): RoutingProfile {
	const v = (raw ?? "").trim().toLowerCase();
	if (v === "cheap" || v === "reliable") return v;
	return "balanced";
}

function parseBooleanFlag(tokens: string[], ...flags: string[]): boolean {
	const set = new Set(tokens.map((t) => t.trim().toLowerCase()));
	return flags.some((f) => set.has(f.toLowerCase()));
}

export default function quotaVisibilityExtension(pi: ExtensionAPI) {
	const cache = new Map<string, { at: number; value: QuotaStatus }>();

	async function getStatus(
		ctx: ExtensionContext,
		args: {
			days?: number;
			weeklyQuotaTokens?: number;
			weeklyQuotaCostUsd?: number;
			weeklyQuotaRequests?: number;
			monthlyQuotaTokens?: number;
			monthlyQuotaCostUsd?: number;
			monthlyQuotaRequests?: number;
			providerWindowHoursOverride?: ProviderWindowHours;
			providerBudgetsOverride?: ProviderBudgetMap;
		},
	) {
		const cfg = readSettings(ctx.cwd);
		const baseDays = Math.max(
			1,
			Math.min(90, Math.floor(args.days ?? cfg.defaultDays ?? DEFAULT_DAYS)),
		);
		const weeklyQuotaTokens = args.weeklyQuotaTokens ?? cfg.weeklyQuotaTokens;
		const weeklyQuotaCostUsd =
			args.weeklyQuotaCostUsd ?? cfg.weeklyQuotaCostUsd;
		const weeklyQuotaRequests =
			args.weeklyQuotaRequests ?? cfg.weeklyQuotaRequests;
		const monthlyQuotaTokens =
			args.monthlyQuotaTokens ?? cfg.monthlyQuotaTokens;
		const monthlyQuotaCostUsd =
			args.monthlyQuotaCostUsd ?? cfg.monthlyQuotaCostUsd;
		const monthlyQuotaRequests =
			args.monthlyQuotaRequests ?? cfg.monthlyQuotaRequests;

		const providerWindowHours: ProviderWindowHours = {
			...DEFAULT_PROVIDER_WINDOW_HOURS,
			...(cfg.providerWindowHours ?? {}),
			...(args.providerWindowHoursOverride ?? {}),
		};

		const providerBudgets: ProviderBudgetMap = {
			...(cfg.providerBudgets ?? {}),
			...(args.providerBudgetsOverride ?? {}),
		};

		const needsMonthlyWindow = Object.values(providerBudgets).some((rule) => {
			const period =
				rule.period ??
				(rule.monthlyQuotaTokens ||
				rule.monthlyQuotaCostUsd ||
				rule.shareMonthlyTokensPct ||
				rule.shareMonthlyCostPct
					? "monthly"
					: "weekly");
			return period === "monthly";
		});

		const dayOfMonth = new Date().getDate();
		const days = Math.max(baseDays, needsMonthlyWindow ? dayOfMonth : 0);

		const key = JSON.stringify({
			days,
			weeklyQuotaTokens,
			weeklyQuotaCostUsd,
			weeklyQuotaRequests,
			monthlyQuotaTokens,
			monthlyQuotaCostUsd,
			monthlyQuotaRequests,
			providerWindowHours,
			providerBudgets,
		});
		const prev = cache.get(key);
		if (prev && Date.now() - prev.at < 30_000) return prev.value;

		const status = await analyzeQuota({
			days,
			weeklyQuotaTokens,
			weeklyQuotaCostUsd,
			weeklyQuotaRequests,
			monthlyQuotaTokens,
			monthlyQuotaCostUsd,
			monthlyQuotaRequests,
			providerWindowHours,
			providerBudgets,
		});
		cache.set(key, { at: Date.now(), value: status });
		return status;
	}

	pi.registerTool({
		name: "quota_visibility_status",
		label: "Quota Visibility Status",
		description:
			"Analyze local pi session usage and estimate weekly/monthly quota burn (tokens/cost/requests + provider windows).",
		parameters: Type.Object({
			days: Type.Optional(Type.Number({ minimum: 1, maximum: 90 })),
			weeklyQuotaTokens: Type.Optional(Type.Number({ minimum: 1 })),
			weeklyQuotaCostUsd: Type.Optional(Type.Number({ minimum: 0.01 })),
			weeklyQuotaRequests: Type.Optional(Type.Number({ minimum: 1 })),
			monthlyQuotaTokens: Type.Optional(Type.Number({ minimum: 1 })),
			monthlyQuotaCostUsd: Type.Optional(Type.Number({ minimum: 0.01 })),
			monthlyQuotaRequests: Type.Optional(Type.Number({ minimum: 1 })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as {
				days?: number;
				weeklyQuotaTokens?: number;
				weeklyQuotaCostUsd?: number;
				weeklyQuotaRequests?: number;
				monthlyQuotaTokens?: number;
				monthlyQuotaCostUsd?: number;
				monthlyQuotaRequests?: number;
			};
			const status = await getStatus(ctx, p);
			const outputPolicy = resolveQuotaToolOutputPolicy(readSettings(ctx.cwd));
			return {
				content: [
					{
						type: "text",
						text: formatQuotaToolJsonOutput(
							"quota_visibility_status",
							status,
							outputPolicy,
						),
					},
				],
				details: status,
			};
		},
	});

	pi.registerTool({
		name: "quota_visibility_windows",
		label: "Quota Visibility Windows",
		description:
			"Show provider rolling-window/peak-hour insights (e.g., 5h Anthropic/Codex planning).",
		parameters: Type.Object({
			days: Type.Optional(Type.Number({ minimum: 1, maximum: 90 })),
			provider: Type.Optional(Type.String()),
			windowHours: Type.Optional(Type.Number({ minimum: 1, maximum: 24 })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as {
				days?: number;
				provider?: string;
				windowHours?: number;
			};
			const override: ProviderWindowHours = {};
			if (p.provider && p.windowHours) {
				override[normalizeProvider(p.provider)] = Math.floor(p.windowHours);
			}

			const status = await getStatus(ctx, {
				days: p.days,
				providerWindowHoursOverride:
					Object.keys(override).length > 0 ? override : undefined,
			});

			const normalized = p.provider ? normalizeProvider(p.provider) : undefined;
			const data = normalized
				? status.providerWindows.filter((w) => w.provider === normalized)
				: status.providerWindows;

			const outputPolicy = resolveQuotaToolOutputPolicy(readSettings(ctx.cwd));
			return {
				content: [
					{
						type: "text",
						text: formatQuotaToolJsonOutput(
							"quota_visibility_windows",
							data,
							outputPolicy,
						),
					},
				],
				details: { provider: normalized, data },
			};
		},
	});

	pi.registerTool({
		name: "quota_visibility_provider_budgets",
		label: "Quota Visibility Provider Budgets",
		description:
			"Evaluate per-provider quota caps/shares (including warning/block states).",
		parameters: Type.Object({
			days: Type.Optional(Type.Number({ minimum: 1, maximum: 90 })),
			provider: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as { days?: number; provider?: string };
			const status = await getStatus(ctx, { days: p.days });
			const normalized = p.provider ? normalizeProvider(p.provider) : undefined;
			const data = normalized
				? status.providerBudgets.filter((b) => b.provider === normalized)
				: status.providerBudgets;

			const payload = {
				allocationWarnings: status.providerBudgetPolicy.allocationWarnings,
				data,
			};
			const outputPolicy = resolveQuotaToolOutputPolicy(readSettings(ctx.cwd));
			return {
				content: [
					{
						type: "text",
						text: formatQuotaToolJsonOutput(
							"quota_visibility_provider_budgets",
							payload,
							outputPolicy,
						),
					},
				],
				details: {
					provider: normalized,
					allocationWarnings: status.providerBudgetPolicy.allocationWarnings,
					data,
				},
			};
		},
	});

	pi.registerTool({
		name: "quota_visibility_route",
		label: "Quota Visibility Route Advisory",
		description:
			"Deterministic provider routing advisory (cheap|balanced|reliable) with optional explicit execute path.",
		parameters: Type.Object({
			days: Type.Optional(Type.Number({ minimum: 1, maximum: 90 })),
			profile: Type.Optional(
				Type.String({ description: "cheap | balanced | reliable" }),
			),
			execute: Type.Optional(Type.Boolean()),
			reason: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as {
				days?: number;
				profile?: string;
				execute?: boolean;
				reason?: string;
			};
			const status = await getStatus(ctx, { days: p.days });
			const advisory = buildRouteAdvisory(
				status,
				parseRoutingProfile(p.profile),
			);

			let executed = false;
			let executedModelRef: string | undefined;
			if (p.execute === true && advisory.recommendedProvider) {
				const settings = readSettings(ctx.cwd);
				const modelRef =
					settings.routeModelRefs?.[advisory.recommendedProvider];
				if (modelRef) {
					const [provider, modelId] = modelRef.split("/");
					const model = ctx.modelRegistry.find(provider, modelId);
					if (model) {
						executed = await pi.setModel(model);
						if (executed) executedModelRef = modelRef;
					}
				}

				pi.appendEntry("quota-visibility.route-execution", {
					atIso: new Date().toISOString(),
					profile: advisory.profile,
					recommendedProvider: advisory.recommendedProvider,
					executed,
					executedModelRef,
					reason: p.reason,
					advisory,
				});
			}

			const payload = { advisory, executed, executedModelRef };
			const outputPolicy = resolveQuotaToolOutputPolicy(readSettings(ctx.cwd));
			return {
				content: [
					{
						type: "text",
						text: formatQuotaToolJsonOutput(
							"quota_visibility_route",
							payload,
							outputPolicy,
						),
					},
				],
				details: { advisory, executed, executedModelRef },
			};
		},
	});

	pi.registerTool({
		name: "quota_visibility_export",
		label: "Quota Visibility Export",
		description:
			"Export a quota evidence JSON report under .pi/reports for provider dispute/audit.",
		parameters: Type.Object({
			days: Type.Optional(Type.Number({ minimum: 1, maximum: 90 })),
			weeklyQuotaTokens: Type.Optional(Type.Number({ minimum: 1 })),
			weeklyQuotaCostUsd: Type.Optional(Type.Number({ minimum: 0.01 })),
			weeklyQuotaRequests: Type.Optional(Type.Number({ minimum: 1 })),
			monthlyQuotaTokens: Type.Optional(Type.Number({ minimum: 1 })),
			monthlyQuotaCostUsd: Type.Optional(Type.Number({ minimum: 0.01 })),
			monthlyQuotaRequests: Type.Optional(Type.Number({ minimum: 1 })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as {
				days?: number;
				weeklyQuotaTokens?: number;
				weeklyQuotaCostUsd?: number;
				weeklyQuotaRequests?: number;
				monthlyQuotaTokens?: number;
				monthlyQuotaCostUsd?: number;
				monthlyQuotaRequests?: number;
			};
			const status = await getStatus(ctx, p);
			const outputPath = await writeEvidenceBundle(ctx, status);
			return {
				content: [
					{ type: "text", text: `Exported quota evidence: ${outputPath}` },
				],
				details: { outputPath, status },
			};
		},
	});

	pi.registerCommand("quota-visibility", {
		description:
			"Consumer quota observability from ~/.pi sessions (status/windows/budget/export).",
		handler: async (args, ctx) => {
			const tokens = (args ?? "").trim().split(/\s+/).filter(Boolean);
			const cmd = (tokens[0] ?? "status").toLowerCase();

			if (cmd === "status") {
				const days = parseDays(tokens[1]);
				const status = await getStatus(ctx, { days });
				ctx.ui.notify(formatStatusReport(status), "info");
				return;
			}

			if (cmd === "windows") {
				const maybeProvider = tokens[1];
				const maybeDays = tokens[2];

				let provider: string | undefined;
				let days: number | undefined;

				if (maybeProvider && parseDays(maybeProvider) === undefined) {
					provider = maybeProvider;
					days = parseDays(maybeDays);
				} else {
					days = parseDays(maybeProvider);
				}

				const status = await getStatus(ctx, { days });
				ctx.ui.notify(formatWindowsReport(status, provider), "info");
				return;
			}

			if (cmd === "budget") {
				const maybeProvider = tokens[1];
				const maybeDays = tokens[2];

				let provider: string | undefined;
				let days: number | undefined;

				if (maybeProvider && parseDays(maybeProvider) === undefined) {
					provider = maybeProvider;
					days = parseDays(maybeDays);
				} else {
					days = parseDays(maybeProvider);
				}

				const status = await getStatus(ctx, { days });
				ctx.ui.notify(formatProviderBudgetsReport(status, provider), "info");
				return;
			}

			if (cmd === "route") {
				const maybeProfile = tokens[1];
				const profile =
					maybeProfile && parseDays(maybeProfile) === undefined
						? parseRoutingProfile(maybeProfile)
						: "balanced";
				const days =
					maybeProfile && parseDays(maybeProfile) !== undefined
						? parseDays(maybeProfile)
						: parseDays(tokens[2]);
				const execute = parseBooleanFlag(tokens, "--execute", "--apply");
				const status = await getStatus(ctx, { days });
				const advisory = buildRouteAdvisory(status, profile);

				let executed = false;
				let executedModelRef: string | undefined;

				if (execute && advisory.recommendedProvider) {
					const settings = readSettings(ctx.cwd);
					const modelRef =
						settings.routeModelRefs?.[advisory.recommendedProvider];
					if (!modelRef) {
						ctx.ui.notify(
							[
								formatRouteAdvisory(advisory),
								"",
								`execute solicitado, mas routeModelRefs.${advisory.recommendedProvider} não está configurado em .pi/settings.json`,
								'Exemplo: piStack.quotaVisibility.routeModelRefs.{"openai-codex":"openai-codex/gpt-5.3-codex"}',
							].join("\n"),
							"warning",
						);
						return;
					}

					const [provider, modelId] = modelRef.split("/");
					const model = ctx.modelRegistry.find(provider, modelId);
					if (!model) {
						ctx.ui.notify(
							[
								formatRouteAdvisory(advisory),
								"",
								`execute solicitado, mas modelRef '${modelRef}' não foi encontrado no modelRegistry.`,
							].join("\n"),
							"warning",
						);
						return;
					}

					executed = await pi.setModel(model);
					if (executed) executedModelRef = modelRef;

					pi.appendEntry("quota-visibility.route-execution", {
						atIso: new Date().toISOString(),
						profile,
						advisory,
						executed,
						executedModelRef,
						trigger: "slash-command",
					});
				}

				const lines = [formatRouteAdvisory(advisory)];
				if (execute) {
					lines.push(
						"",
						`execute: ${executed ? `applied ${executedModelRef}` : "requested but not applied"}`,
					);
				} else {
					lines.push(
						"",
						"ação opcional: /quota-visibility route <cheap|balanced|reliable> [days] --execute",
					);
				}
				ctx.ui.notify(
					lines.join("\n"),
					advisory.state === "blocked" ? "warning" : "info",
				);
				return;
			}

			if (cmd === "export") {
				const days = parseDays(tokens[1]);
				const status = await getStatus(ctx, { days });
				const out = await writeEvidenceBundle(ctx, status);
				ctx.ui.notify(`quota-visibility export criado em:\n${out}`, "info");
				return;
			}

			ctx.ui.notify(
				"Usage: /quota-visibility <status|windows|budget|route|export> [provider|profile] [days] [--execute]",
				"warning",
			);
		},
	});

	// ---------------------------------------------------------------------------
	// Control plane: live budget + model status in footer
	// ---------------------------------------------------------------------------

	/** Compact budget summary: "✓codex:12% ✗copilot:100% ✓gemini:8%". */
	async function refreshBudgetStatus(ctx: ExtensionContext): Promise<void> {
		try {
			const cfg = readSettings(ctx.cwd);
			const providerBudgets = cfg.providerBudgets ?? {};
			if (Object.keys(providerBudgets).length === 0) return;

			const dayOfMonth = new Date().getDate();
			const status = await analyzeQuota({
				days: Math.max(dayOfMonth, 7),
				providerBudgets,
				providerWindowHours: {},
			});

			if (status.providerBudgets.length === 0) return;
			ctx.ui.setStatus(
				"quota-budgets",
				formatBudgetStatusParts(status.providerBudgets).join(" "),
			);
		} catch {
			// silent — status display is best-effort
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		await refreshBudgetStatus(ctx);
	});
}
