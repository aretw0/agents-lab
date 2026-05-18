import { homedir } from "node:os";
import path from "node:path";
import type {
	ProviderModel,
	ProviderWindowHours,
	UsageBreakdown,
	SessionSample,
	ParsedSessionData,
	DailyAggregate,
	ModelAggregate,
	QuotaUsageEvent,
	RollingWindowSnapshot,
	ProviderWindowInsight,
	OpenAIWhamUsageParseResult,
	OpenAIWhamUsageWindow,
	ProviderBudgetConfig,
	ProviderBudgetMap,
	ProviderBudgetStatus,
	RoutingProfile,
	RouteAdvisory,
	QuotaStatus,
	HardPathwayMitigationProjection,
} from "./quota-visibility-types";
import { buildProviderBudgetStatuses as buildProviderBudgetStatusesImpl } from "./quota-visibility-provider-budgets";
export type {
	ProviderModel,
	ProviderWindowHours,
	UsageBreakdown,
	SessionSample,
	ParsedSessionData,
	DailyAggregate,
	ModelAggregate,
	QuotaUsageEvent,
	RollingWindowSnapshot,
	ProviderWindowInsight,
	OpenAIWhamUsageParseResult,
	OpenAIWhamUsageWindow,
	ProviderBudgetConfig,
	ProviderBudgetMap,
	ProviderBudgetStatus,
	RoutingProfile,
	RouteAdvisory,
	QuotaStatus,
	HardPathwayMitigationProjection,
} from "./quota-visibility-types";

export const SETTINGS_PATH = ["piStack", "quotaVisibility"];
export const DEFAULT_DAYS = 7;
export const MAX_TOP = 10;
export const SESSION_TS_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/;
export const DEFAULT_PROVIDER_WINDOW_HOURS: ProviderWindowHours = {
	anthropic: 5,
	"openai-codex": 5,
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
 * Each entry: "✓codex:12%", "✗copilot:100%", "⚠gemini:78%".
 * The percent is local used pressure: max(used tokens, used cost, used requests).
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
			b.state === "blocked" ? "✗" : b.state === "warning" ? "⚠" : "✓";
		const scope = b.model
			? `${shortProviderLabel(b.provider)}/${b.model}`
			: b.account
				? `${shortProviderLabel(b.provider)}@${b.account}`
				: shortProviderLabel(b.provider);
		return `${icon}${scope}:${pct}%`;
	});
}

export function formatBudgetStatusLegend(): string[] {
	return [
		"quota footer legend: ✓=OK, ⚠=WARN, ✗=BLOCK from local providerBudgets.",
		"quota footer percent: max local used pressure across tokens, cost, and requests; not remaining quota.",
		"WHAM note: a BLOCK/✗ local gate can differ from model-specific dashboard or live WHAM headroom.",
	];
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

export function normalizeModelId(input: unknown): string | undefined {
	if (typeof input !== "string") return undefined;
	const value = input.trim().toLowerCase();
	if (!value || value === "unknown") return undefined;
	return value;
}

function looksLikeModelId(input: unknown): boolean {
	const value = normalizeModelId(input);
	if (!value) return false;
	return /^(gpt|o\d|claude|gemini|qwen|deepseek|kimi|llama|mistral|codex)[-_.]/.test(value) || value.includes("codex");
}

export interface ProviderAccountRef {
	provider: string;
	account?: string;
	key: string;
}

export interface ProviderBudgetRef extends ProviderAccountRef {
	model?: string;
	providerModelKey?: string;
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

export function buildProviderModelKey(
	provider: string,
	model?: string,
): string {
	const normalizedProvider = normalizeProvider(provider);
	const normalizedModel = normalizeModelId(model);
	if (!normalizedModel) return normalizedProvider;
	return `${normalizedProvider}/${normalizedModel}`;
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

export function parseProviderBudgetRef(
	input: unknown,
	rule?: ProviderBudgetConfig,
): ProviderBudgetRef | undefined {
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

function clampPercent(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(100, value));
}

function formatDurationMs(ms: number): string | undefined {
	if (!Number.isFinite(ms)) return undefined;
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	if (totalSeconds <= 0) return "now";
	const days = Math.floor(totalSeconds / 86_400);
	const hours = Math.floor((totalSeconds % 86_400) / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);
	if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
	if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
	return `${Math.max(1, minutes)}m`;
}

function formatOpenAIWindowLabel(seconds: number): string {
	const rounded = Math.round(seconds);
	if (rounded % 86_400 === 0) return `${rounded / 86_400}d`;
	if (rounded % 3_600 === 0) return `${rounded / 3_600}h`;
	return `${Math.max(1, Math.round(rounded / 60))}m`;
}

function parseOpenAIResetDescription(window: Record<string, unknown>, nowMs: number): string | undefined {
	const resetAfterSeconds = safeNum(window.reset_after_seconds);
	if (resetAfterSeconds > 0) return formatDurationMs(resetAfterSeconds * 1000);
	const resetAtSeconds = safeNum(window.reset_at);
	if (resetAtSeconds > 0) return formatDurationMs(resetAtSeconds * 1000 - nowMs);
	return undefined;
}

function maybeOpenAIModelId(group: Record<string, unknown>, label: string): string | undefined {
	return normalizeModelId(group.model ?? group.model_slug ?? group.model_id) ??
		(looksLikeModelId(label) ? normalizeModelId(label) : undefined) ??
		(looksLikeModelId(group.metered_feature) ? normalizeModelId(group.metered_feature) : undefined);
}

function addOpenAIWhamWindow(
	out: OpenAIWhamUsageWindow[],
	groupLabel: string,
	group: Record<string, unknown>,
	windowLabel: string,
	window: unknown,
	nowMs: number,
): void {
	if (!window || typeof window !== "object") return;
	const typedWindow = window as Record<string, unknown>;
	if (typedWindow.used_percent === undefined || typedWindow.used_percent === null) return;
	const usedPercent = safeNum(typedWindow.used_percent);
	if (!Number.isFinite(usedPercent)) return;
	const windowSeconds = safeNum(typedWindow.limit_window_seconds);
	const roundedSeconds = windowSeconds > 0 ? Math.round(windowSeconds) : undefined;
	const suffix = roundedSeconds ? formatOpenAIWindowLabel(roundedSeconds) : windowLabel;
	const label = `${groupLabel} (${suffix})`;
	const model = maybeOpenAIModelId(group, groupLabel);
	const meteredFeature = typeof group.metered_feature === "string" ? group.metered_feature : undefined;
	out.push({
		provider: "openai-codex",
		source: "openai-wham",
		label,
		groupLabel,
		windowLabel,
		model,
		meteredFeature,
		percentLeft: clampPercent(100 - usedPercent),
		usedPercent: clampPercent(usedPercent),
		resetDescription: parseOpenAIResetDescription(typedWindow, nowMs),
		windowMinutes: roundedSeconds ? Math.max(1, Math.round(roundedSeconds / 60)) : undefined,
		allowed: typeof group.allowed === "boolean" ? group.allowed : undefined,
		limitReached: typeof group.limit_reached === "boolean" ? group.limit_reached : undefined,
	});
}

function addOpenAIWhamGroup(
	result: OpenAIWhamUsageParseResult,
	groupLabel: string,
	group: unknown,
	nowMs: number,
): void {
	if (!group || typeof group !== "object") return;
	const typedGroup = group as Record<string, unknown>;
	if (typedGroup.allowed === false) result.notes.push(`${groupLabel} currently blocked.`);
	if (typedGroup.limit_reached === true) result.notes.push(`${groupLabel} limit reached.`);
	addOpenAIWhamWindow(result.windows, groupLabel, typedGroup, "primary", typedGroup.primary_window, nowMs);
	addOpenAIWhamWindow(result.windows, groupLabel, typedGroup, "secondary", typedGroup.secondary_window, nowMs);
}

export function parseOpenAIWhamUsage(
	payload: unknown,
	nowMs = Date.now(),
): OpenAIWhamUsageParseResult {
	const result: OpenAIWhamUsageParseResult = {
		provider: "openai-codex",
		windows: [],
		notes: [],
	};
	if (!payload || typeof payload !== "object") {
		result.notes.push("OpenAI WHAM usage payload was empty or malformed.");
		return result;
	}
	const typedPayload = payload as Record<string, unknown>;
	if (typeof typedPayload.plan_type === "string") result.plan = typedPayload.plan_type;
	if (typeof typedPayload.email === "string") result.account = typedPayload.email;
	const credits = typedPayload.credits;
	if (credits && typeof credits === "object") {
		const typedCredits = credits as Record<string, unknown>;
		if (typedCredits.unlimited === true) result.notes.push("Credits are unlimited.");
		const balance = safeNum(typedCredits.balance);
		if (balance > 0) result.credits = balance;
	}

	addOpenAIWhamGroup(result, "Codex", typedPayload.rate_limit, nowMs);
	addOpenAIWhamGroup(result, "Code Review", typedPayload.code_review_rate_limit, nowMs);
	const additionalRateLimits = typedPayload.additional_rate_limits;
	if (Array.isArray(additionalRateLimits)) {
		for (const item of additionalRateLimits) {
			if (!item || typeof item !== "object") continue;
			const typedItem = item as Record<string, unknown>;
			const label = typeof typedItem.limit_name === "string"
				? typedItem.limit_name
				: typeof typedItem.metered_feature === "string"
					? typedItem.metered_feature
					: "Additional";
			const group = typedItem.rate_limit && typeof typedItem.rate_limit === "object"
				? { ...(typedItem.rate_limit as Record<string, unknown>), ...typedItem }
				: typedItem;
			addOpenAIWhamGroup(result, label, group, nowMs);
		}
	}
	if (result.windows.length === 0) {
		result.notes.push("OpenAI WHAM usage response did not include window data.");
	}
	return result;
}

function stateFromOpenAIWhamWindow(window: OpenAIWhamUsageWindow): ProviderBudgetStatus["state"] {
	if (window.allowed === false || window.limitReached === true || window.percentLeft <= 0) return "blocked";
	return window.usedPercent >= 80 ? "warning" : "ok";
}

function buildSyntheticOpenAIWhamModelBudget(window: OpenAIWhamUsageWindow, now = new Date()): ProviderBudgetStatus | undefined {
	const model = normalizeModelId(window.model);
	if (!model || model === "codex") return undefined;
	const provider = "openai-codex";
	const providerModelKey = buildProviderModelKey(provider, model);
	const periodStart = startOfRollingWeekLocal(now);
	const periodEnd = new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
	return {
		provider,
		providerAccountKey: provider,
		providerModelKey,
		model,
		owner: "openai-wham-live-window",
		period: "weekly",
		unit: "requests",
		periodDays: 7,
		periodStartIso: periodStart.toISOString(),
		periodEndIso: periodEnd.toISOString(),
		observedMessages: 0,
		observedTokens: 0,
		observedCostUsd: 0,
		observedRequests: Math.max(0, window.usedPercent),
		projectedTokensEndOfPeriod: 0,
		projectedCostUsdEndOfPeriod: 0,
		projectedRequestsEndOfPeriod: Math.max(0, window.usedPercent),
		periodRequestsCap: 100,
		usedPctRequests: Math.max(0, window.usedPercent),
		projectedPctRequests: Math.max(0, window.usedPercent),
		dashboardRemainingPct: window.percentLeft,
		dashboardUsedPct: window.usedPercent,
		dashboardWindowLabel: window.label,
		dashboardResetDescription: window.resetDescription,
		liveWindowSource: "openai-wham",
		warnPct: 80,
		hardPct: 100,
		state: stateFromOpenAIWhamWindow(window),
		notes: [
			`Synthetic model-specific budget inferred from OpenAI WHAM live window '${window.label}'.`,
			"Add an explicit providerBudgets entry to customize local caps for this model.",
		],
	};
}

export function applyOpenAIWhamUsageToBudgets(
	budgets: ProviderBudgetStatus[],
	wham: OpenAIWhamUsageParseResult | undefined,
): ProviderBudgetStatus[] {
	if (!wham || wham.provider !== "openai-codex" || wham.windows.length === 0) {
		return budgets;
	}
	const updated = budgets.map((budget) => {
		if (normalizeProvider(budget.provider) !== "openai-codex") return budget;
		const candidates = wham.windows.filter((window) => {
			if (window.provider !== "openai-codex") return false;
			if (budget.model) return normalizeModelId(window.model) === normalizeModelId(budget.model);
			return !window.model && window.groupLabel.toLowerCase() === "codex";
		});
		if (candidates.length === 0) return budget;
		const live = [...candidates].sort((a, b) => a.percentLeft - b.percentLeft)[0];
		const notes = [...budget.notes];
		notes.push(
			`Live OpenAI WHAM window '${live.label}' reports ${live.percentLeft.toFixed(1)}% remaining${live.resetDescription ? `; reset ${live.resetDescription}` : ""}.`,
		);
		let state = budget.state;
		if (live.allowed === false || live.limitReached === true || live.percentLeft <= 0) {
			state = "blocked";
		} else if (budget.model && budget.state === "blocked" && live.percentLeft > 0) {
			state = "warning";
			notes.push(
				"Local projection exceeded configured budget, but live model-specific dashboard window still has remaining quota; do not treat projection alone as live exhaustion.",
			);
		}
		return {
			...budget,
			state,
			dashboardRemainingPct: live.percentLeft,
			dashboardUsedPct: live.usedPercent,
			dashboardWindowLabel: live.label,
			dashboardResetDescription: live.resetDescription,
			liveWindowSource: "openai-wham",
			notes,
		};
	});

	const existingModelKeys = new Set(updated.map((budget) => budget.providerModelKey).filter((key): key is string => Boolean(key)));
	const syntheticByModel = new Map<string, ProviderBudgetStatus>();
	for (const window of wham.windows) {
		const model = normalizeModelId(window.model);
		if (!model || model === "codex") continue;
		const key = buildProviderModelKey("openai-codex", model);
		if (existingModelKeys.has(key)) continue;
		const current = syntheticByModel.get(key);
		if (!current || safeNum(current.dashboardRemainingPct) > window.percentLeft) {
			const synthetic = buildSyntheticOpenAIWhamModelBudget(window);
			if (synthetic) syntheticByModel.set(key, synthetic);
		}
	}
	return [...updated, ...syntheticByModel.values()].sort((a, b) => {
		const aKey = a.providerModelKey ?? a.providerAccountKey ?? a.provider;
		const bKey = b.providerModelKey ?? b.providerAccountKey ?? b.provider;
		return aKey.localeCompare(bKey);
	});
}

export function parseProviderBudgets(input: unknown): ProviderBudgetMap {
	if (!input || typeof input !== "object") return {};
	const out: ProviderBudgetMap = {};

	for (const [k, rawRule] of Object.entries(input as Record<string, unknown>)) {
		if (!rawRule || typeof rawRule !== "object") continue;

		const ruleObj = rawRule as Record<string, unknown>;
		const explicitModel = normalizeModelId(ruleObj.model);
		const key = parseProviderBudgetRef(k, explicitModel ? { model: explicitModel } : undefined);
		if (!key) continue;
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
		const model = key.model ?? explicitModel;

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
			model !== undefined ||
			unit === "requests";

		if (!hasAny) continue;

		out[key.key] = {
			owner,
			period,
			unit,
			requestSharePolicy,
			model,
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
	return buildProviderBudgetStatusesImpl(usageEvents, params);
}
