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
import path from "node:path";
import readline from "node:readline";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import {
	DEFAULT_COPILOT_BILLING_PATH,
	DEFAULT_DAYS,
	DEFAULT_PROVIDER_WINDOW_HOURS,
	MAX_TOP,
	SETTINGS_PATH,
	buildProviderAccountKey,
	buildProviderBudgetStatuses,
	buildProviderWindowInsight,
	computeWindowStartScores,
	extractUsage,
	formatBudgetStatusParts,
	formatQuotaToolJsonOutput,
	parseProviderAccountKey,
	parseProviderBudgets,
	parseProviderWindowHours,
	parseRouteModelRefs,
	parseSessionStartFromFilename,
	resolveQuotaToolOutputPolicy,
	safeNum,
	shortProviderLabel,
	estimateHardPathwayMitigation,
	normalizeProvider,
	normalizeAccountId,
	resolveUsageEventAccount,
	toDayLocal,
	nowLocalMidnight,
	addDays,
	hourLocal,
	makeUsage,
	mergeUsage,
	parseTimestamp,
	type CopilotBillingExtractParams,
	type DailyAggregate,
	type ModelAggregate,
	type ParsedSessionData,
	type ProviderBudgetMap,
	type ProviderBudgetStatus,
	type ProviderWindowHours,
	type ProviderWindowInsight,
	type QuotaStatus,
	type QuotaToolOutputPolicy,
	type QuotaUsageEvent,
	type RouteAdvisory,
	type RoutingProfile,
	type SessionSample,
} from "./quota-visibility-model";
export {
	buildProviderAccountKey,
	buildProviderBudgetStatuses,
	buildProviderWindowInsight,
	computeWindowStartScores,
	extractUsage,
	formatBudgetStatusParts,
	formatQuotaToolJsonOutput,
	parseProviderAccountKey,
	parseProviderBudgets,
	parseProviderWindowHours,
	parseRouteModelRefs,
	parseSessionStartFromFilename,
	resolveQuotaToolOutputPolicy,
	safeNum,
	shortProviderLabel,
	estimateHardPathwayMitigation,
	type CopilotBillingExtractParams,
	type HardPathwayMitigationProjection,
	type ProviderAccountRef,
	type ProviderBudgetConfig,
	type ProviderBudgetMap,
	type ProviderBudgetStatus,
	type ProviderWindowInsight,
	type QuotaStatus,
	type QuotaToolOutputPolicy,
	type QuotaUsageEvent,
	type RouteAdvisory,
	type RoutingProfile,
} from "./quota-visibility-model";

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
			const account = resolveUsageEventAccount(
				obj as Record<string, unknown>,
				msg as Record<string, unknown>,
			);
			const providerAccountKey = buildProviderAccountKey(provider, account);
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
				account,
				providerAccountKey,
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

function parseCopilotBillingTimestamp(raw: unknown): Date | undefined {
	if (typeof raw !== "string") return undefined;
	const ts = raw.trim();
	if (!ts) return undefined;
	const d = new Date(ts);
	return Number.isFinite(d.getTime()) ? d : undefined;
}

function normalizeCopilotBillingModel(raw: unknown): string {
	if (typeof raw !== "string") return "billing-adjustment";
	const value = raw.trim();
	return value.length > 0 ? value : "billing-adjustment";
}

function normalizeCopilotBillingRows(raw: unknown): Array<Record<string, unknown>> {
	if (Array.isArray(raw)) {
		return raw.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
	}
	if (!raw || typeof raw !== "object") return [];
	const obj = raw as Record<string, unknown>;
	const candidates = [obj.records, obj.items, obj.events, obj.data];
	for (const candidate of candidates) {
		if (!Array.isArray(candidate)) continue;
		return candidate.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
	}
	return [];
}

export function extractCopilotBillingUsageEvents(
	raw: unknown,
	params: CopilotBillingExtractParams,
): QuotaUsageEvent[] {
	const rows = normalizeCopilotBillingRows(raw);
	const endMs = Number.isFinite(params.windowEndMs)
		? (params.windowEndMs as number)
		: Date.now();
	const out: QuotaUsageEvent[] = [];

	for (const row of rows) {
		const timestamp =
			parseCopilotBillingTimestamp(row.timestampIso) ??
			parseCopilotBillingTimestamp(row.timestamp) ??
			parseCopilotBillingTimestamp(row.atIso) ??
			parseCopilotBillingTimestamp(row.at) ??
			parseCopilotBillingTimestamp(row.date);
		if (!timestamp) continue;

		const timestampMs = timestamp.getTime();
		if (!Number.isFinite(timestampMs)) continue;
		if (timestampMs < params.windowStartMs || timestampMs > endMs) continue;

		const provider = normalizeProvider(row.provider ?? "github-copilot");
		if (provider !== "github-copilot") continue;

		const account = normalizeAccountId(
			row.account ??
				row.accountId ??
				row.account_id ??
				row.organization ??
				row.org ??
				row.orgId ??
				row.org_id,
		);
		const providerAccountKey = buildProviderAccountKey(provider, account);

		const costUsd = Math.max(
			0,
			safeNum(
				row.costUsd ??
					row.cost_usd ??
					row.billedCostUsd ??
					row.billed_cost_usd ??
					row.amountUsd ??
					row.amount_usd ??
					row.cost,
			),
		);
		const tokens = Math.max(
			0,
			safeNum(row.tokens ?? row.totalTokens ?? row.total_tokens),
		);
		const requests = Math.max(
			0,
			safeNum(
				row.requests ??
					row.requestCount ??
					row.request_count ??
					row.premiumRequests ??
					row.premium_requests,
			),
		);
		if (costUsd <= 0 && tokens <= 0 && requests <= 0) continue;

		out.push({
			timestampIso: timestamp.toISOString(),
			timestampMs,
			dayLocal: toDayLocal(timestamp),
			hourLocal: hourLocal(timestamp),
			provider,
			account,
			providerAccountKey,
			model: normalizeCopilotBillingModel(row.model),
			tokens,
			costUsd,
			requests,
			sessionFile: params.sourceFile,
		});
	}

	return out;
}

async function loadCopilotBillingUsageEvents(
	days: number,
): Promise<{ events: QuotaUsageEvent[]; sourcePath?: string }> {
	const sourcePath =
		typeof process.env.PI_COPILOT_BILLING_PATH === "string" &&
		process.env.PI_COPILOT_BILLING_PATH.trim().length > 0
			? process.env.PI_COPILOT_BILLING_PATH.trim()
			: DEFAULT_COPILOT_BILLING_PATH;

	let rawText = "";
	try {
		rawText = await fs.readFile(sourcePath, "utf8");
	} catch {
		return { events: [] };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawText);
	} catch {
		return { events: [] };
	}

	const now = nowLocalMidnight();
	const start = addDays(now, -(days - 1));
	const events = extractCopilotBillingUsageEvents(parsed, {
		sourceFile: sourcePath,
		windowStartMs: start.getTime(),
		windowEndMs: Date.now(),
	});
	return { events, sourcePath };
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

	const copilotBilling = await loadCopilotBillingUsageEvents(params.days);
	if (copilotBilling.events.length > 0) {
		usageEvents.push(...copilotBilling.events);
	}

	const status = buildQuotaStatus(sessions, usageEvents, {
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
	if (copilotBilling.events.length > 0) {
		status.source.externalBillingEvents = copilotBilling.events.length;
		status.source.externalBillingSource = copilotBilling.sourcePath;
	}
	return status;
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

function formatProviderBudgetsReport(
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
			const selector = p.provider ? parseProviderAccountKey(p.provider) : undefined;
			const data = selector
				? status.providerBudgets.filter((b) => {
					if (b.provider !== selector.provider) return false;
					if (!selector.account) return true;
					return b.account === selector.account;
				})
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
					provider: selector?.key,
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
