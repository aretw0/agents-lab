/**
 * quota-panel — toggleable provider usage panel for the pi footer.
 * @capability-id quota-panel
 * @capability-criticality medium
 *
 * Modes:
 *   off  — always hidden (default)
 *   on   — always visible
 *   auto — shows when any provider is WARN/BLOCK, hides when all return to OK
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
	analyzeQuota,
	buildRouteAdvisory,
	type ProviderBudgetStatus,
	type ProviderWindowInsight,
	parseProviderBudgets,
	parseProviderWindowHours,
	type QuotaStatus,
	safeNum,
	shortProviderLabel,
} from "./quota-visibility";

// ---------------------------------------------------------------------------
// Panel mode state (module-level singleton)
// ---------------------------------------------------------------------------

export type PanelMode = "off" | "on" | "auto";

let _mode: PanelMode = "off";
let _autoTriggered = false;
let _cachedStatus: QuotaStatus | null = null;
let _refreshInFlight = false;
let _hasAttemptedRefresh = false;

export function resolvePanelMode(
	raw: unknown,
	fallback: PanelMode = "off",
): PanelMode {
	if (raw === "off" || raw === "on" || raw === "auto") return raw;
	return fallback;
}

export function getMode(): PanelMode {
	return _mode;
}

export function setMode(m: PanelMode): void {
	_mode = m;
	if (m !== "auto") _autoTriggered = false;
}

export function shouldShowPanel(): boolean {
	return _mode === "on" || (_mode === "auto" && _autoTriggered);
}

export function getCachedStatus(): QuotaStatus | null {
	return _cachedStatus;
}

/** Called by the turn_start handler when any budget crosses WARN/BLOCK. */
export function triggerAuto(): void {
	_autoTriggered = true;
}
/** Called by the turn_start handler when all budgets return to OK. */
export function resetAuto(): void {
	_autoTriggered = false;
}

// ---------------------------------------------------------------------------
// Pure rendering helpers
// ---------------------------------------------------------------------------

/**
 * Renders a fixed-width progress bar using Unicode block characters.
 * "████▌░░░░░" for 46% at width 10.
 */
export function buildProgressBar(pct: number, barWidth: number): string {
	if (barWidth <= 0) return "";
	const clamped = Math.max(0, Math.min(100, pct));
	const filled = (clamped / 100) * barWidth;
	const fullBlocks = Math.floor(filled);
	const half = filled - fullBlocks >= 0.5 ? "▌" : "";
	const empty = barWidth - fullBlocks - (half ? 1 : 0);
	return "█".repeat(fullBlocks) + half + "░".repeat(Math.max(0, empty));
}

function stateIcon(state: ProviderBudgetStatus["state"]): string {
	if (state === "blocked") return " ✗";
	if (state === "warning") return " ⚠";
	return "";
}

function fmtMoney(usd: number): string {
	if (usd >= 1) return `$${usd.toFixed(2)}`;
	if (usd >= 0.1) return `$${usd.toFixed(3)}`;
	return `$${usd.toFixed(4)}`;
}

function fmtTok(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
	return `${n}`;
}

function budgetRow(b: ProviderBudgetStatus): string {
	const pct = Math.max(
		safeNum(b.usedPctTokens),
		safeNum(b.usedPctCost),
		safeNum(b.usedPctRequests),
	);
	const bar = buildProgressBar(pct, 10);
	const icon = stateIcon(b.state);
	let observed: string;
	let cap: string;
	if (b.unit === "requests") {
		observed = `${Math.round(b.observedRequests)}req`;
		cap =
			b.periodRequestsCap !== undefined
				? `/${Math.round(b.periodRequestsCap)}req`
				: "";
	} else {
		observed = fmtMoney(b.observedCostUsd);
		cap =
			b.periodCostUsdCap !== undefined
				? `/${fmtMoney(b.periodCostUsdCap)}`
				: "";
	}
	const label = shortProviderLabel(b.provider).padEnd(10);
	const period = b.period.padEnd(7);
	const unitLabel = (b.unit === "requests" ? "req" : "cost").padEnd(5);
	const pctStr = `${Math.round(pct)}%`.padStart(4);
	return `  ${label} ${period} ${unitLabel} ${pctStr}  ${bar}  ${observed}${cap}${icon}`;
}

function windowRow(w: ProviderWindowInsight): string {
	const recent = fmtTok(w.recentWindow.tokens);
	const max = w.maxWindowInRange ? fmtTok(w.maxWindowInRange.tokens) : "?";
	const peak = w.peakHoursLocal.map((h) => `${h}h`).join(" ") || "none";
	const start =
		w.suggestedStartHoursBeforePeakLocal
			.map((h) => `${((h % 24) + 24) % 24}h`)
			.join(" ") || "any";
	return `  ${shortProviderLabel(w.provider).padEnd(10)} recent=${recent} max=${max}  peak:${peak} → start:${start}`;
}

function panelDivider(label: string, width: number): string {
	const prefix = `───── ${label} `;
	const remaining = Math.max(0, width - prefix.length - 1);
	return `${prefix}${"─".repeat(remaining)}`;
}

/**
 * Builds the panel lines array from a QuotaStatus snapshot.
 * Pure function — no I/O, no pi APIs. Safe to call in setFooter render().
 * Returns ["  quota panel loading..."] when status is null.
 */
export function buildPanelLines(
	status: QuotaStatus | null,
	width: number,
): string[] {
	if (!status) {
		return [
			_hasAttemptedRefresh
				? "  quota panel: configure providerBudgets em .pi/settings.json"
				: "  quota panel loading...",
		];
	}
	const lines: string[] = [];
	if (status.providerBudgets.length > 0) {
		lines.push(panelDivider("Provider Budgets", width));
		for (const b of status.providerBudgets) lines.push(budgetRow(b));
	}
	const windows = status.providerWindows.filter((w) => w.observedMessages > 0);
	if (windows.length > 0) {
		lines.push(panelDivider("Rolling Windows", width));
		for (const w of windows) lines.push(windowRow(w));
	}
	if (status.providerBudgets.length > 0) {
		const advisory = buildRouteAdvisory(status, "balanced");
		lines.push(panelDivider("Route Advisory", width));
		const candidates = advisory.consideredProviders
			.map((c) => {
				const icon =
					c.state === "blocked" ? "✗" : c.state === "warning" ? "⚠" : "✓";
				return `${icon}${shortProviderLabel(c.provider)} ${Math.round(c.projectedPressurePct)}%`;
			})
			.join("  ");
		const rec = advisory.recommendedProvider
			? shortProviderLabel(advisory.recommendedProvider)
			: "none";
		lines.push(`  balanced → ${rec}  [ ${candidates} ]`);
	}
	return lines;
}

// ---------------------------------------------------------------------------
// Internal: read settings for analyzeQuota
// ---------------------------------------------------------------------------

function readPanelSettings(cwd: string): {
	providerBudgets: ReturnType<typeof parseProviderBudgets>;
	providerWindowHours: ReturnType<typeof parseProviderWindowHours>;
	days: number;
	panelMode?: PanelMode;
} {
	try {
		const raw = JSON.parse(
			readFileSync(path.join(cwd, ".pi", "settings.json"), "utf8"),
		) as Record<string, unknown>;
		const qv = ((raw?.piStack as Record<string, unknown>)?.quotaVisibility ??
			{}) as Record<string, unknown>;
		const providerBudgets = parseProviderBudgets(qv.providerBudgets);
		const providerWindowHours = parseProviderWindowHours(
			qv.providerWindowHours,
		);
		const panelCfg = ((raw?.piStack as Record<string, unknown>)?.quotaPanel ??
			{}) as Record<string, unknown>;
		const panelMode = resolvePanelMode(panelCfg.mode, "off");
		const defaultDays = safeNum(qv.defaultDays);
		const dayOfMonth = new Date().getDate();
		// dayOfMonth ensures monthly budgets cover the full billing period so far.
		const days = Math.max(dayOfMonth, defaultDays > 0 ? defaultDays : 7);
		return { providerBudgets, providerWindowHours, days, panelMode };
	} catch {
		return {
			providerBudgets: {},
			providerWindowHours: {},
			days: 7,
			panelMode: "off",
		};
	}
}

async function refreshCache(ctx: ExtensionContext): Promise<void> {
	if (_refreshInFlight) return;
	_refreshInFlight = true;
	try {
		const { providerBudgets, providerWindowHours, days } = readPanelSettings(
			ctx.cwd,
		);
		_hasAttemptedRefresh = true;
		if (Object.keys(providerBudgets).length === 0) return;
		const status = await analyzeQuota({
			days,
			providerBudgets,
			providerWindowHours,
		});
		_cachedStatus = status;
		if (_mode === "auto") {
			const hasIssue = status.providerBudgets.some((b) => b.state !== "ok");
			if (hasIssue) triggerAuto();
			else resetAuto();
		}
	} catch {
		// silent — panel is best-effort
	} finally {
		_refreshInFlight = false;
	}
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function quotaPanelExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const { panelMode } = readPanelSettings(ctx.cwd);
		setMode(panelMode ?? "off");
		if (getMode() !== "off") {
			await refreshCache(ctx);
		}
	});

	pi.on("turn_start", async (_event, ctx) => {
		await refreshCache(ctx);
	});

	pi.registerCommand("qp", {
		description: "Provider usage panel. Usage: /qp off|on|auto|status|snapshot",
		async handler(args, ctx) {
			const cmd = (args ?? "").trim().toLowerCase();

			if (cmd === "status") {
				const { panelMode, providerBudgets } = readPanelSettings(ctx.cwd);
				const cfgProviders = Object.keys(providerBudgets).length;
				const cacheProviders = getCachedStatus()?.providerBudgets?.length ?? 0;
				ctx.ui.notify(
					[
						`quota panel mode: ${getMode()}`,
						`settings mode: ${panelMode ?? "(none)"}`,
						`providerBudgets configured: ${cfgProviders}`,
						`cached providers: ${cacheProviders}`,
						`visible now: ${shouldShowPanel() ? "yes" : "no"}`,
					].join("\n"),
					"info",
				);
				return;
			}

			if (cmd === "snapshot") {
				const { providerBudgets, providerWindowHours, days } =
					readPanelSettings(ctx.cwd);
				if (Object.keys(providerBudgets).length === 0) {
					ctx.ui.notify(
						"quota panel: nenhum providerBudgets configurado em .pi/settings.json",
						"warning",
					);
					return;
				}
				try {
					const status = await analyzeQuota({
						days,
						providerBudgets,
						providerWindowHours,
					});
					const lines = buildPanelLines(status, 80);
					ctx.ui.notify(
						lines.join("\n") || "quota panel: sem dados para exibir",
						"info",
					);
				} catch (err) {
					ctx.ui.notify(
						`quota panel: erro ao ler dados — ${String(err)}`,
						"warning",
					);
				}
				return;
			}

			if (cmd === "off" || cmd === "on" || cmd === "auto") {
				setMode(cmd as PanelMode);
				ctx.ui.notify(`quota panel: modo '${cmd}' ativado`, "info");
				if (cmd !== "off") await refreshCache(ctx);
				return;
			}

			ctx.ui.notify("Usage: /qp off|on|auto|status|snapshot", "warning");
		},
	});
}
