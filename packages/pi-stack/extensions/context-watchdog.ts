/**
 * context-watchdog — non-blocking context-window advisory for long-running sessions.
 * @capability-id context-watchdog
 * @capability-criticality medium
 *
 * Purpose:
 * - warn early before context gets expensive
 * - suggest checkpoint at a configurable threshold
 * - suggest compact near hard pressure
 *
 * This extension is advisory only (no blocking).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	resolveContextThresholds,
	type ContextThresholdOverrides,
} from "./custom-footer";

export type ContextWatchdogLevel = "ok" | "warn" | "checkpoint" | "compact";

export type ContextWatchdogConfig = {
	enabled: boolean;
	checkpointPct?: number;
	compactPct?: number;
	cooldownMs: number;
	notify: boolean;
	status: boolean;
};

export type ContextWatchThresholds = {
	warnPct: number;
	checkpointPct: number;
	compactPct: number;
};

export type ContextWatchAssessment = {
	percent: number;
	level: ContextWatchdogLevel;
	thresholds: ContextWatchThresholds;
	recommendation: string;
	severity: "info" | "warning";
};

const DEFAULT_CONFIG: ContextWatchdogConfig = {
	enabled: true,
	cooldownMs: 10 * 60 * 1000,
	notify: true,
	status: true,
};

function toFiniteNumber(value: unknown): number | undefined {
	const n = Number(value);
	if (!Number.isFinite(n)) return undefined;
	return n;
}

export function normalizeContextWatchdogConfig(input: unknown): ContextWatchdogConfig {
	const cfg = (input && typeof input === "object")
		? (input as Record<string, unknown>)
		: {};

	const checkpointPct = toFiniteNumber(cfg.checkpointPct);
	const compactPct = toFiniteNumber(cfg.compactPct);
	const cooldownMs = toFiniteNumber(cfg.cooldownMs);

	return {
		enabled: cfg.enabled === false ? false : DEFAULT_CONFIG.enabled,
		checkpointPct:
			checkpointPct !== undefined ? Math.max(1, Math.min(99, Math.floor(checkpointPct))) : undefined,
		compactPct:
			compactPct !== undefined ? Math.max(2, Math.min(100, Math.floor(compactPct))) : undefined,
		cooldownMs:
			cooldownMs !== undefined ? Math.max(60_000, Math.floor(cooldownMs)) : DEFAULT_CONFIG.cooldownMs,
		notify: cfg.notify === false ? false : DEFAULT_CONFIG.notify,
		status: cfg.status === false ? false : DEFAULT_CONFIG.status,
	};
}

export function deriveContextWatchThresholds(
	warningPct: number,
	errorPct: number,
	cfg: ContextWatchdogConfig,
): ContextWatchThresholds {
	const warn = Math.max(1, Math.min(99, Math.floor(warningPct)));
	// Default compact target keeps headroom before footer "error" pressure.
	// OpenAI-like defaults become ~72, Anthropic-like defaults ~82.
	const compactDefault = Math.max(warn + 4, Math.floor(errorPct) - 3);
	const compactRaw = cfg.compactPct ?? compactDefault;
	const compact = Math.max(warn + 2, Math.min(100, Math.floor(compactRaw)));

	// Default checkpoint is the pre-compact lane (4pp before compact).
	const checkpointDefault = Math.max(warn + 1, compact - 4);
	const checkpointRaw = cfg.checkpointPct ?? checkpointDefault;
	const checkpoint = Math.max(warn + 1, Math.min(compact - 1, Math.floor(checkpointRaw)));

	return {
		warnPct: warn,
		checkpointPct: checkpoint,
		compactPct: compact,
	};
}

export function evaluateContextWatch(
	percentInput: number,
	thresholds: ContextWatchThresholds,
): ContextWatchAssessment {
	const percent = Math.max(0, Math.min(100, Math.floor(percentInput)));
	if (percent >= thresholds.compactPct) {
		return {
			percent,
			level: "compact",
			thresholds,
			recommendation: "Compact now and continue from checkpoint.",
			severity: "warning",
		};
	}

	if (percent >= thresholds.checkpointPct) {
		return {
			percent,
			level: "checkpoint",
			thresholds,
			recommendation: "Write handoff checkpoint before the next large slice.",
			severity: "warning",
		};
	}

	if (percent >= thresholds.warnPct) {
		return {
			percent,
			level: "warn",
			thresholds,
			recommendation: "Keep micro-slices and avoid broad scans until checkpoint.",
			severity: "info",
		};
	}

	return {
		percent,
		level: "ok",
		thresholds,
		recommendation: "Context healthy.",
		severity: "info",
	};
}

function levelRank(level: ContextWatchdogLevel): number {
	switch (level) {
		case "ok":
			return 0;
		case "warn":
			return 1;
		case "checkpoint":
			return 2;
		case "compact":
			return 3;
	}
}

export function shouldAnnounceContextWatch(
	previous: ContextWatchdogLevel | null,
	next: ContextWatchdogLevel,
	elapsedMs: number,
	cooldownMs: number,
): boolean {
	if (next === "ok") return false;
	if (!previous) return true;
	const prevRank = levelRank(previous);
	const nextRank = levelRank(next);
	if (nextRank > prevRank) return true;
	if (nextRank === prevRank && elapsedMs >= cooldownMs && nextRank >= 2) return true;
	return false;
}

export function formatContextWatchStatus(assessment: ContextWatchAssessment): string {
	const t = assessment.thresholds;
	return `[ctx] ${assessment.percent}% ${assessment.level} · W${t.warnPct}/C${t.checkpointPct}/X${t.compactPct}`;
}

function readSettingsJson(cwd: string): Record<string, unknown> {
	const candidates = [
		path.join(cwd, ".pi", "settings.json"),
		path.join(homedir(), ".pi", "agent", "settings.json"),
	];
	for (const filePath of candidates) {
		if (!existsSync(filePath)) continue;
		try {
			const parsed = JSON.parse(readFileSync(filePath, "utf8"));
			if (parsed && typeof parsed === "object") {
				return parsed as Record<string, unknown>;
			}
		} catch {
			// ignore malformed settings
		}
	}
	return {};
}

function readContextThresholdOverrides(cwd: string): ContextThresholdOverrides | undefined {
	const settings = readSettingsJson(cwd);
	const cfg = (settings.piStack as Record<string, unknown> | undefined)?.customFooter;
	const pressure = (cfg as Record<string, unknown> | undefined)?.contextPressure;
	if (!pressure || typeof pressure !== "object") return undefined;
	const parsed = pressure as ContextThresholdOverrides;
	return {
		default: parsed.default,
		byProvider: parsed.byProvider,
		byProviderModel: parsed.byProviderModel,
	};
}

function readWatchdogConfig(cwd: string): ContextWatchdogConfig {
	const settings = readSettingsJson(cwd);
	const piStack = (settings.piStack as Record<string, unknown> | undefined) ?? {};
	return normalizeContextWatchdogConfig(piStack.contextWatchdog);
}

function buildAssessment(
	ctx: ExtensionContext,
	config: ContextWatchdogConfig,
	overrides?: ContextThresholdOverrides,
): ContextWatchAssessment {
	const usage = ctx.getContextUsage();
	const percent = Number(usage?.percent ?? 0);
	const modelProvider = (ctx.model as Record<string, unknown> | undefined)?.provider;
	const provider = typeof modelProvider === "string" && modelProvider ? modelProvider : null;
	const modelId = ctx.model?.id ?? "no-model";
	const modelThresholds = resolveContextThresholds(provider, modelId, overrides);
	const thresholds = deriveContextWatchThresholds(
		modelThresholds.warningPct,
		modelThresholds.errorPct,
		config,
	);
	return evaluateContextWatch(percent, thresholds);
}

export default function contextWatchdogExtension(pi: ExtensionAPI) {
	let config = DEFAULT_CONFIG;
	let thresholdOverrides: ContextThresholdOverrides | undefined;
	let lastAssessment: ContextWatchAssessment | null = null;
	let lastAnnouncedLevel: ContextWatchdogLevel | null = null;
	let lastAnnouncedAt = 0;

	const run = (ctx: ExtensionContext, reason: "session_start" | "message_end") => {
		if (!config.enabled) {
			ctx.ui.setStatus?.("context-watch", "[ctx] disabled");
			return;
		}

		const assessment = buildAssessment(ctx, config, thresholdOverrides);
		lastAssessment = assessment;

		if (config.status) {
			ctx.ui.setStatus?.("context-watch", formatContextWatchStatus(assessment));
		}

		if (!config.notify) return;
		const now = Date.now();
		const elapsed = now - lastAnnouncedAt;
		const announce = shouldAnnounceContextWatch(
			lastAnnouncedLevel,
			assessment.level,
			elapsed,
			config.cooldownMs,
		);
		lastAnnouncedLevel = assessment.level;
		if (!announce) return;
		lastAnnouncedAt = now;

		const label = reason === "session_start" ? "context-watch start" : "context-watch";
		ctx.ui.notify(
			`${label}: ${formatContextWatchStatus(assessment)}\n${assessment.recommendation}`,
			assessment.severity,
		);
	};

	pi.on("session_start", (_event, ctx) => {
		config = readWatchdogConfig(ctx.cwd);
		thresholdOverrides = readContextThresholdOverrides(ctx.cwd);
		lastAssessment = null;
		lastAnnouncedLevel = null;
		lastAnnouncedAt = 0;
		run(ctx, "session_start");
	});

	pi.on("message_end", (_event, ctx) => {
		run(ctx, "message_end");
	});

	pi.registerTool({
		name: "context_watch_status",
		label: "Context Watch Status",
		description:
			"Non-blocking context-window advisory (warn/checkpoint/compact) with model-aware thresholds.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const assessment = buildAssessment(ctx, config, thresholdOverrides);
			lastAssessment = assessment;
			return {
				content: [{ type: "text", text: JSON.stringify(assessment, null, 2) }],
				details: assessment,
			};
		},
	});

	pi.registerCommand("context-watch", {
		description: "Show or reset context-watch state. Usage: /context-watch [status|reset]",
		handler: async (args, ctx) => {
			const sub = String(args ?? "").trim().toLowerCase() || "status";
			if (sub === "reset") {
				lastAssessment = null;
				lastAnnouncedLevel = null;
				lastAnnouncedAt = 0;
				ctx.ui.notify("context-watch: state reset", "info");
				return;
			}

			const assessment = buildAssessment(ctx, config, thresholdOverrides);
			lastAssessment = assessment;
			ctx.ui.notify(
				`${formatContextWatchStatus(assessment)}\n${assessment.recommendation}`,
				assessment.severity,
			);
		},
	});
}
