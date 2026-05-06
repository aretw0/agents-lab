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

import { promises as fs, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { extractCopilotBillingUsageEvents } from "./quota-visibility-billing";
import { estimateHardPathwayMitigation } from "./quota-visibility-hard-pathway";
import {
	formatQuotaToolJsonOutput,
	resolveQuotaToolOutputPolicy,
	type QuotaVisibilitySettings,
} from "./quota-visibility-output-policy";
import { parseSessionFile, walkJsonlFiles } from "./quota-visibility-session-reader";

export { extractCopilotBillingUsageEvents } from "./quota-visibility-billing";
export { estimateHardPathwayMitigation } from "./quota-visibility-hard-pathway";
export { formatQuotaToolJsonOutput, resolveQuotaToolOutputPolicy } from "./quota-visibility-output-policy";
export type { QuotaToolOutputPolicy, QuotaVisibilitySettings } from "./quota-visibility-output-policy";

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
	parseProviderAccountKey,
	parseProviderBudgets,
	parseProviderWindowHours,
	parseRouteModelRefs,
	parseSessionStartFromFilename,
	safeNum,
	shortProviderLabel,
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
	parseProviderAccountKey,
	parseProviderBudgets,
	parseProviderWindowHours,
	parseRouteModelRefs,
	parseSessionStartFromFilename,
	safeNum,
	shortProviderLabel,
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

export function resolveQuotaSessionRoots(cwd?: string): string[] {
	const roots = [path.join(homedir(), ".pi", "agent", "sessions")];
	if (cwd && cwd.trim().length > 0) {
		roots.push(path.join(cwd, ".sandbox", "pi-agent", "sessions"));
	}

	const seen = new Set<string>();
	const out: string[] = [];
	for (const root of roots) {
		const normalized = path.resolve(root);
		const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(normalized);
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
		sessionRoots?: string[];
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
			sessionRoots: params.sessionRoots,
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

function buildWindowedSessionSample(
	parsed: ParsedSessionData,
	start: Date,
): { session: SessionSample; usageEvents: QuotaUsageEvent[] } | undefined {
	const sessionStart = new Date(parsed.session.startedAtIso);
	if (sessionStart >= start) {
		return { session: parsed.session, usageEvents: parsed.usageEvents };
	}

	const usageEvents = parsed.usageEvents.filter((event) => event.timestampMs >= start.getTime());
	if (usageEvents.length === 0) return undefined;

	const usage = makeUsage();
	const byModel = new Map<string, ModelAggregate>();
	for (const event of usageEvents) {
		const eventUsage = {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: event.tokens,
			costTotalUsd: event.costUsd,
		};
		mergeUsage(usage, eventUsage);
		const modelKey = `${event.provider}/${event.model}`;
		const current = byModel.get(modelKey) ?? { ...makeUsage(), assistantMessages: 0 };
		mergeUsage(current, eventUsage);
		current.assistantMessages += 1;
		byModel.set(modelKey, current);
	}

	const byModelObj: Record<string, ModelAggregate> = {};
	for (const [key, value] of byModel.entries()) byModelObj[key] = value;

	return {
		session: {
			...parsed.session,
			startedAtIso: usageEvents[0]?.timestampIso ?? parsed.session.startedAtIso,
			userMessages: 0,
			assistantMessages: usageEvents.length,
			toolResultMessages: 0,
			usage,
			byModel: byModelObj,
		},
		usageEvents,
	};
}

export async function analyzeQuota(params: {
	days: number;
	weeklyQuotaTokens?: number;
	weeklyQuotaCostUsd?: number;
	weeklyQuotaRequests?: number;
	monthlyQuotaTokens?: number;
	monthlyQuotaCostUsd?: number; monthlyQuotaRequests?: number;
	providerWindowHours: ProviderWindowHours;
	providerBudgets: ProviderBudgetMap;
	cwd?: string; sessionRoots?: string[];
}): Promise<QuotaStatus> {
	const sessionRoots = params.sessionRoots ?? resolveQuotaSessionRoots(params.cwd);
	const sessionsRoot = sessionRoots[0] ?? path.join(homedir(), ".pi", "agent", "sessions");
	const files = Array.from(new Set((await Promise.all(sessionRoots.map((root) => walkJsonlFiles(root)))).flat()));

	const now = nowLocalMidnight();
	const start = addDays(now, -(params.days - 1));

	const sessions: SessionSample[] = [];
	const usageEvents: QuotaUsageEvent[] = [];

	for (const filePath of files) {
		const parsed = await parseSessionFile(filePath);
		if (!parsed) continue;

		const windowed = buildWindowedSessionSample(parsed, start);
		if (!windowed) continue;
		sessions.push(windowed.session);
		usageEvents.push(...windowed.usageEvents);
	}

	const copilotBilling = await loadCopilotBillingUsageEvents(params.days);
	if (copilotBilling.events.length > 0) {
		usageEvents.push(...copilotBilling.events);
	}

	const status = buildQuotaStatus(sessions, usageEvents, {
		days: params.days,
		sessionsRoot,
		sessionRoots,
		scannedFiles: files.length,
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

import {
	buildRouteAdvisory,
	formatProviderBudgetsReport,
	formatRouteAdvisory,
	formatStatusReport,
	formatWindowsReport,
} from "./quota-visibility-formatting";
export { buildRouteAdvisory } from "./quota-visibility-formatting";

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
			cwd: ctx.cwd,
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
			cwd: ctx.cwd,
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
				cwd: ctx.cwd,
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
