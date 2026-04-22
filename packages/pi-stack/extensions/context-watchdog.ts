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
 * Supports autonomous checkpoint/compact actions with cooldown + idle guards.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
	autoCheckpoint: boolean;
	autoCompact: boolean;
	autoCompactCooldownMs: number;
	autoCompactRequireIdle: boolean;
	autoResumeAfterCompact: boolean;
	autoResumeCooldownMs: number;
	handoffFreshMaxAgeMs: number;
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
	action: string;
	severity: "info" | "warning";
};

export type ContextWatchBootstrapPreset = "control-plane" | "agent-worker";

export type ContextWatchBootstrapPlan = {
	preset: ContextWatchBootstrapPreset;
	patch: Record<string, unknown>;
	notes: string[];
};

const DEFAULT_CONFIG: ContextWatchdogConfig = {
	enabled: true,
	cooldownMs: 10 * 60 * 1000,
	notify: true,
	status: true,
	autoCheckpoint: true,
	autoCompact: true,
	autoCompactCooldownMs: 20 * 60 * 1000,
	autoCompactRequireIdle: true,
	autoResumeAfterCompact: true,
	autoResumeCooldownMs: 30_000,
	handoffFreshMaxAgeMs: 30 * 60 * 1000,
};

function toFiniteNumber(value: unknown): number | undefined {
	const n = Number(value);
	if (!Number.isFinite(n)) return undefined;
	return n;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

export function normalizeContextWatchdogConfig(input: unknown): ContextWatchdogConfig {
	const cfg = (input && typeof input === "object")
		? (input as Record<string, unknown>)
		: {};

	const checkpointPct = toFiniteNumber(cfg.checkpointPct);
	const compactPct = toFiniteNumber(cfg.compactPct);
	const cooldownMs = toFiniteNumber(cfg.cooldownMs);
	const autoCompactCooldownMs = toFiniteNumber(cfg.autoCompactCooldownMs);
	const autoResumeCooldownMs = toFiniteNumber(cfg.autoResumeCooldownMs);
	const handoffFreshMaxAgeMs = toFiniteNumber(cfg.handoffFreshMaxAgeMs);

	return {
		enabled: toBoolean(cfg.enabled, DEFAULT_CONFIG.enabled),
		checkpointPct:
			checkpointPct !== undefined ? Math.max(1, Math.min(99, Math.floor(checkpointPct))) : undefined,
		compactPct:
			compactPct !== undefined ? Math.max(2, Math.min(100, Math.floor(compactPct))) : undefined,
		cooldownMs:
			cooldownMs !== undefined ? Math.max(60_000, Math.floor(cooldownMs)) : DEFAULT_CONFIG.cooldownMs,
		notify: toBoolean(cfg.notify, DEFAULT_CONFIG.notify),
		status: toBoolean(cfg.status, DEFAULT_CONFIG.status),
		autoCheckpoint: toBoolean(cfg.autoCheckpoint, DEFAULT_CONFIG.autoCheckpoint),
		autoCompact: toBoolean(cfg.autoCompact, DEFAULT_CONFIG.autoCompact),
		autoCompactCooldownMs: autoCompactCooldownMs !== undefined
			? Math.max(60_000, Math.floor(autoCompactCooldownMs))
			: DEFAULT_CONFIG.autoCompactCooldownMs,
		autoCompactRequireIdle: toBoolean(cfg.autoCompactRequireIdle, DEFAULT_CONFIG.autoCompactRequireIdle),
		autoResumeAfterCompact: toBoolean(cfg.autoResumeAfterCompact, DEFAULT_CONFIG.autoResumeAfterCompact),
		autoResumeCooldownMs: autoResumeCooldownMs !== undefined
			? Math.max(5_000, Math.floor(autoResumeCooldownMs))
			: DEFAULT_CONFIG.autoResumeCooldownMs,
		handoffFreshMaxAgeMs: handoffFreshMaxAgeMs !== undefined
			? Math.max(60_000, Math.floor(handoffFreshMaxAgeMs))
			: DEFAULT_CONFIG.handoffFreshMaxAgeMs,
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

export function contextWatchActionForLevel(level: ContextWatchdogLevel): string {
	switch (level) {
		case "compact":
			return "compact-now";
		case "checkpoint":
			return "write-checkpoint";
		case "warn":
			return "micro-slice-only";
		default:
			return "continue";
	}
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
			action: contextWatchActionForLevel("compact"),
			severity: "warning",
		};
	}

	if (percent >= thresholds.checkpointPct) {
		return {
			percent,
			level: "checkpoint",
			thresholds,
			recommendation: "Write handoff checkpoint before the next large slice.",
			action: contextWatchActionForLevel("checkpoint"),
			severity: "warning",
		};
	}

	if (percent >= thresholds.warnPct) {
		return {
			percent,
			level: "warn",
			thresholds,
			recommendation: "Keep micro-slices and avoid broad scans until checkpoint.",
			action: contextWatchActionForLevel("warn"),
			severity: "info",
		};
	}

	return {
		percent,
		level: "ok",
		thresholds,
		recommendation: "Context healthy.",
		action: contextWatchActionForLevel("ok"),
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

export type ContextWatchAutoCompactDecision = {
	trigger: boolean;
	reason:
		| "level-not-compact"
		| "feature-disabled"
		| "in-flight"
		| "cooldown"
		| "not-idle"
		| "pending-messages"
		| "trigger";
};

export function shouldScheduleAutoCompactRetry(decision: ContextWatchAutoCompactDecision): boolean {
	if (decision.trigger) return false;
	return decision.reason === "not-idle"
		|| decision.reason === "pending-messages"
		|| decision.reason === "in-flight";
}

export function resolveAutoCompactRetryDelayMs(
	decision: ContextWatchAutoCompactDecision,
	state: { nowMs: number; lastAutoCompactAt: number },
	config: ContextWatchdogConfig,
	defaultRetryMs: number,
): number | undefined {
	if (decision.trigger) return undefined;
	if (decision.reason === "cooldown") {
		const remaining = config.autoCompactCooldownMs - (state.nowMs - state.lastAutoCompactAt);
		return Math.max(250, Math.floor(remaining));
	}
	if (shouldScheduleAutoCompactRetry(decision)) {
		return Math.max(250, Math.floor(defaultRetryMs));
	}
	return undefined;
}

export type ContextWatchAutoCompactDiagnostics = {
	decision: ContextWatchAutoCompactDecision;
	retryRecommended: boolean;
	retryDelayMs?: number;
};

export function buildAutoCompactDiagnostics(
	assessment: ContextWatchAssessment,
	config: ContextWatchdogConfig,
	state: {
		nowMs: number;
		lastAutoCompactAt: number;
		inFlight: boolean;
		isIdle: boolean;
		hasPendingMessages: boolean;
	},
	defaultRetryMs = 2_000,
): ContextWatchAutoCompactDiagnostics {
	const decision = shouldTriggerAutoCompact(assessment, config, state);
	const retryDelayMs = resolveAutoCompactRetryDelayMs(
		decision,
		{ nowMs: state.nowMs, lastAutoCompactAt: state.lastAutoCompactAt },
		config,
		defaultRetryMs,
	);
	return {
		decision,
		retryRecommended: retryDelayMs !== undefined,
		retryDelayMs,
	};
}

export function shouldTriggerAutoCompact(
	assessment: ContextWatchAssessment,
	config: ContextWatchdogConfig,
	state: {
		nowMs: number;
		lastAutoCompactAt: number;
		inFlight: boolean;
		isIdle: boolean;
		hasPendingMessages: boolean;
	},
): ContextWatchAutoCompactDecision {
	if (assessment.level !== "compact") return { trigger: false, reason: "level-not-compact" };
	if (!config.autoCompact) return { trigger: false, reason: "feature-disabled" };
	if (state.inFlight) return { trigger: false, reason: "in-flight" };
	if ((state.nowMs - state.lastAutoCompactAt) < config.autoCompactCooldownMs) {
		return { trigger: false, reason: "cooldown" };
	}
	if (config.autoCompactRequireIdle && !state.isIdle) {
		return { trigger: false, reason: "not-idle" };
	}
	if (config.autoCompactRequireIdle && state.hasPendingMessages) {
		return { trigger: false, reason: "pending-messages" };
	}
	return { trigger: true, reason: "trigger" };
}

export function shouldAutoCheckpoint(
	assessment: ContextWatchAssessment,
	config: ContextWatchdogConfig,
	nowMs: number,
	lastAutoCheckpointAt: number,
): boolean {
	if (!config.autoCheckpoint) return false;
	if (assessment.level !== "checkpoint" && assessment.level !== "compact") return false;
	return (nowMs - lastAutoCheckpointAt) >= config.cooldownMs;
}

export function shouldEmitAutoResumeAfterCompact(
	config: ContextWatchdogConfig,
	nowMs: number,
	lastAutoResumeAt: number,
): boolean {
	if (!config.autoResumeAfterCompact) return false;
	return (nowMs - lastAutoResumeAt) >= config.autoResumeCooldownMs;
}

export function shouldRefreshHandoffBeforeAutoCompact(
	assessment: ContextWatchAssessment,
	config: ContextWatchdogConfig,
): boolean {
	return assessment.level === "compact" && config.autoResumeAfterCompact;
}

function truncateForPrompt(value: string, max = 180): string {
	const s = String(value ?? "").trim().replace(/\s+/g, " ");
	if (s.length <= max) return s;
	return `${s.slice(0, Math.max(0, max - 1))}…`;
}

export function resolveHandoffFreshness(
	timestampIso: string | undefined,
	nowMs = Date.now(),
	maxFreshAgeMs = 30 * 60 * 1000,
): { label: "fresh" | "stale" | "unknown"; ageMs?: number } {
	if (!timestampIso) return { label: "unknown" };
	const ts = Date.parse(timestampIso);
	if (!Number.isFinite(ts)) return { label: "unknown" };
	const ageMs = Math.max(0, nowMs - ts);
	return {
		label: ageMs <= maxFreshAgeMs ? "fresh" : "stale",
		ageMs,
	};
}

export function handoffFreshnessAdvice(
	freshnessLabel: "fresh" | "stale" | "unknown",
	autoResumeEnabled: boolean,
): string {
	if (freshnessLabel === "fresh") return "handoff fresh for resume.";
	if (freshnessLabel === "unknown") return "handoff timestamp unavailable.";
	if (autoResumeEnabled) {
		return "handoff stale; auto-refresh runs before auto-compact resume.";
	}
	return "handoff stale; refresh checkpoint before manual resume.";
}

export function buildAutoResumePromptFromHandoff(
	handoffInput: Record<string, unknown> | undefined,
	maxFreshAgeMs = 30 * 60 * 1000,
	nowMs = Date.now(),
): string {
	const handoff = (handoffInput && typeof handoffInput === "object") ? handoffInput : {};
	const timestamp = typeof handoff.timestamp === "string" && handoff.timestamp
		? handoff.timestamp
		: undefined;
	const freshness = resolveHandoffFreshness(timestamp, nowMs, maxFreshAgeMs);
	const freshnessText = freshness.label === "unknown"
		? "unknown"
		: `${freshness.label}${freshness.ageMs !== undefined ? ` ageSec=${Math.ceil(freshness.ageMs / 1000)}` : ""}`;
	const tasks = normalizeStringArray(handoff.current_tasks).slice(0, 3);
	const blockers = normalizeStringArray(handoff.blockers)
		.filter((b) => !b.startsWith("context-watch-"))
		.slice(0, 2)
		.map((b) => truncateForPrompt(b, 80));
	const next = normalizeStringArray(handoff.next_actions)
		.filter((line) => !line.startsWith(CONTEXT_WATCH_ACTION_PREFIX))
		.slice(0, 2)
		.map((line) => truncateForPrompt(line, 120));

	return [
		`context-watch auto-resume: continue from .project/handoff.json (ts=${timestamp ?? "unknown"}, freshness=${freshnessText}).`,
		`focusTasks: ${tasks.length > 0 ? tasks.join(", ") : "none-listed"}`,
		`blockers: ${blockers.length > 0 ? blockers.join(" | ") : "none"}`,
		next.length > 0 ? `next: ${next.join(" | ")}` : "next: keep current lane intent",
		freshness.label === "stale"
			? "note: handoff is stale; refresh checkpoint if resumed context conflicts."
			: "note: handoff freshness acceptable for resume.",
		"Keep micro-slice-only (1 file + 1 test) and preserve canonical board/verification flow.",
	].join("\n");
}

export function formatContextWatchStatus(assessment: ContextWatchAssessment): string {
	const t = assessment.thresholds;
	return `[ctx] ${assessment.percent}% ${assessment.level} · W${t.warnPct}/C${t.checkpointPct}/X${t.compactPct}`;
}

export function parseContextBootstrapPreset(input: unknown): ContextWatchBootstrapPreset {
	return input === "agent-worker" ? "agent-worker" : "control-plane";
}

export function buildContextWatchBootstrapPlan(
	presetInput?: unknown,
): ContextWatchBootstrapPlan {
	const preset = parseContextBootstrapPreset(presetInput);
	if (preset === "agent-worker") {
		return {
			preset,
			patch: {
				piStack: {
					contextWatchdog: {
						enabled: true,
						checkpointPct: 72,
						compactPct: 78,
						cooldownMs: 15 * 60 * 1000,
						notify: false,
						status: true,
						autoCheckpoint: true,
						autoCompact: false,
						autoCompactCooldownMs: 20 * 60 * 1000,
						autoCompactRequireIdle: true,
						autoResumeAfterCompact: false,
						autoResumeCooldownMs: 30_000,
						handoffFreshMaxAgeMs: 30 * 60 * 1000,
					},
				},
			},
			notes: [
				"worker preset: minimizes notify noise while preserving status telemetry.",
				"recommended for short-lived delegated agents and swarm workers.",
			],
		};
	}

	return {
		preset: "control-plane",
		patch: {
			piStack: {
				contextWatchdog: {
					enabled: true,
					checkpointPct: 68,
					compactPct: 72,
					cooldownMs: 10 * 60 * 1000,
					notify: true,
					status: true,
					autoCheckpoint: true,
					autoCompact: true,
					autoCompactCooldownMs: 20 * 60 * 1000,
					autoCompactRequireIdle: true,
					autoResumeAfterCompact: true,
					autoResumeCooldownMs: 30_000,
					handoffFreshMaxAgeMs: 30 * 60 * 1000,
				},
			},
		},
		notes: [
			"control-plane preset: checkpoint near 70% to preserve long-run continuity.",
			"auto-compact runs with idle + cooldown guards.",
		],
	};
}

export function deepMergeSettings(
	base: Record<string, unknown>,
	patch: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...base };
	for (const [k, v] of Object.entries(patch)) {
		if (
			v !== null &&
			typeof v === "object" &&
			!Array.isArray(v) &&
			out[k] !== null &&
			typeof out[k] === "object" &&
			!Array.isArray(out[k])
		) {
			out[k] = deepMergeSettings(
				out[k] as Record<string, unknown>,
				v as Record<string, unknown>,
			);
		} else {
			out[k] = v;
		}
	}
	return out;
}

export function applyContextWatchBootstrapToSettings(
	settings: Record<string, unknown>,
	presetInput?: unknown,
): {
	preset: ContextWatchBootstrapPreset;
	plan: ContextWatchBootstrapPlan;
	settings: Record<string, unknown>;
} {
	const plan = buildContextWatchBootstrapPlan(presetInput);
	return {
		preset: plan.preset,
		plan,
		settings: deepMergeSettings(settings, plan.patch),
	};
}

function projectSettingsPath(cwd: string): string {
	return path.join(cwd, ".pi", "settings.json");
}

function readProjectSettings(cwd: string): Record<string, unknown> {
	const filePath = projectSettingsPath(cwd);
	if (!existsSync(filePath)) return {};
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function writeProjectSettings(cwd: string, settings: Record<string, unknown>): string {
	const filePath = projectSettingsPath(cwd);
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, JSON.stringify(settings, null, 2), "utf8");
	return filePath;
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

export type ContextWatchHandoffReason = "session_start" | "message_end" | "auto_compact_prep";

export type ContextWatchHandoffEvent = {
	atIso: string;
	reason: ContextWatchHandoffReason;
	level: ContextWatchdogLevel;
	percent: number;
	thresholds: ContextWatchThresholds;
	action: string;
	recommendation: string;
};

const CONTEXT_WATCH_ACTION_PREFIX = "Context-watch action:";
const CONTEXT_WATCH_BLOCKER_PREFIX = "context-watch-";
const CONTEXT_WATCH_EVENTS_KEY = "context_watch_events";
const CONTEXT_WATCH_EVENTS_MAX = 12;

function handoffFilePath(cwd: string): string {
	return path.join(cwd, ".project", "handoff.json");
}

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function normalizeContextWatchEventList(value: unknown): ContextWatchHandoffEvent[] {
	if (!Array.isArray(value)) return [];
	const out: ContextWatchHandoffEvent[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const row = item as Record<string, unknown>;
		const level = row.level;
		if (level !== "ok" && level !== "warn" && level !== "checkpoint" && level !== "compact") {
			continue;
		}
		const percent = Number(row.percent);
		const thresholdsRaw = row.thresholds as Record<string, unknown> | undefined;
		const warnPct = Number(thresholdsRaw?.warnPct);
		const checkpointPct = Number(thresholdsRaw?.checkpointPct);
		const compactPct = Number(thresholdsRaw?.compactPct);
		if (!Number.isFinite(percent) || !Number.isFinite(warnPct) || !Number.isFinite(checkpointPct) || !Number.isFinite(compactPct)) {
			continue;
		}
		const reason = row.reason === "session_start"
			? "session_start"
			: row.reason === "auto_compact_prep"
				? "auto_compact_prep"
				: "message_end";
		out.push({
			atIso: typeof row.atIso === "string" && row.atIso ? row.atIso : new Date().toISOString(),
			reason,
			level,
			percent: Math.max(0, Math.min(100, Math.floor(percent))),
			thresholds: {
				warnPct: Math.max(1, Math.min(99, Math.floor(warnPct))),
				checkpointPct: Math.max(1, Math.min(99, Math.floor(checkpointPct))),
				compactPct: Math.max(1, Math.min(100, Math.floor(compactPct))),
			},
			action: typeof row.action === "string" ? row.action : contextWatchActionForLevel(level),
			recommendation:
				typeof row.recommendation === "string" ? row.recommendation : "",
		});
	}
	return out.slice(-CONTEXT_WATCH_EVENTS_MAX);
}

function readHandoffJson(cwd: string): Record<string, unknown> {
	const filePath = handoffFilePath(cwd);
	if (!existsSync(filePath)) return {};
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function contextWatchActionLine(assessment: ContextWatchAssessment): string {
	return `${CONTEXT_WATCH_ACTION_PREFIX} level=${assessment.level} ${assessment.percent}% (${assessment.action}) · ${assessment.recommendation}`;
}

function contextWatchBlockersForLevel(level: ContextWatchdogLevel): string[] {
	if (level === "compact") return ["context-watch-compact-required"];
	if (level === "checkpoint") return ["context-watch-checkpoint-required"];
	if (level === "warn") return ["context-watch-warn-active"];
	return [];
}

export function applyContextWatchToHandoff(
	handoffInput: Record<string, unknown> | undefined,
	assessment: ContextWatchAssessment,
	reason: ContextWatchHandoffReason,
	atIso: string,
): Record<string, unknown> {
	const base = (handoffInput && typeof handoffInput === "object")
		? { ...handoffInput }
		: {};
	const actionLine = contextWatchActionLine(assessment);

	const nextActions = normalizeStringArray(base.next_actions)
		.filter((entry) => !entry.startsWith(CONTEXT_WATCH_ACTION_PREFIX));
	if (assessment.level !== "ok") nextActions.unshift(actionLine);
	if (nextActions.length > 0) {
		base.next_actions = nextActions.slice(0, 20);
	} else {
		delete base.next_actions;
	}

	const blockers = normalizeStringArray(base.blockers)
		.filter((entry) => !entry.startsWith(CONTEXT_WATCH_BLOCKER_PREFIX));
	const contextBlockers = contextWatchBlockersForLevel(assessment.level);
	if (contextBlockers.length > 0) blockers.unshift(...contextBlockers);
	if (blockers.length > 0) {
		base.blockers = Array.from(new Set(blockers)).slice(0, 20);
	} else {
		delete base.blockers;
	}

	const event: ContextWatchHandoffEvent = {
		atIso,
		reason,
		level: assessment.level,
		percent: assessment.percent,
		thresholds: assessment.thresholds,
		action: assessment.action,
		recommendation: assessment.recommendation,
	};
	const events = normalizeContextWatchEventList(base[CONTEXT_WATCH_EVENTS_KEY]);
	events.push(event);
	base[CONTEXT_WATCH_EVENTS_KEY] = events.slice(-CONTEXT_WATCH_EVENTS_MAX);

	base.timestamp = atIso;
	if (typeof base.context !== "string" || base.context.trim().length === 0) {
		base.context = "Context-watch tracking active: maintain continuity under context pressure.";
	}
	return base;
}

function writeHandoffJson(cwd: string, handoff: Record<string, unknown>): string {
	const filePath = handoffFilePath(cwd);
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(handoff, null, 2)}\n`, "utf8");
	return filePath;
}

function persistContextWatchHandoffEvent(
	ctx: ExtensionContext,
	assessment: ContextWatchAssessment,
	reason: ContextWatchHandoffReason,
): string | undefined {
	if (assessment.level === "ok") return undefined;
	const nowIso = new Date().toISOString();
	const current = readHandoffJson(ctx.cwd);
	const next = applyContextWatchToHandoff(current, assessment, reason, nowIso);
	return writeHandoffJson(ctx.cwd, next);
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
	const AUTO_COMPACT_RETRY_DELAY_MS = 2_000;
	let config = DEFAULT_CONFIG;
	let thresholdOverrides: ContextThresholdOverrides | undefined;
	let lastAssessment: ContextWatchAssessment | null = null;
	let lastAnnouncedLevel: ContextWatchdogLevel | null = null;
	let lastAnnouncedAt = 0;
	let lastAutoCheckpointAt = 0;
	let lastAutoCompactAt = 0;
	let lastAutoResumeAt = 0;
	let autoCompactInFlight = false;
	let autoCompactRetryTimer: NodeJS.Timeout | undefined;
	let autoCompactRetryDueAt = 0;

	const clearAutoCompactRetryTimer = () => {
		if (!autoCompactRetryTimer) return;
		clearTimeout(autoCompactRetryTimer);
		autoCompactRetryTimer = undefined;
		autoCompactRetryDueAt = 0;
	};

	const scheduleAutoCompactRetry = (ctx: ExtensionContext, delayMs: number) => {
		const safeDelayMs = Math.max(250, Math.floor(delayMs));
		const dueAt = Date.now() + safeDelayMs;
		if (autoCompactRetryTimer && autoCompactRetryDueAt > 0 && autoCompactRetryDueAt <= dueAt) {
			return;
		}
		clearAutoCompactRetryTimer();
		autoCompactRetryDueAt = dueAt;
		autoCompactRetryTimer = setTimeout(() => {
			autoCompactRetryTimer = undefined;
			autoCompactRetryDueAt = 0;
			run(ctx, "message_end");
		}, safeDelayMs);
	};

	const run = (ctx: ExtensionContext, reason: ContextWatchHandoffReason) => {
		if (!config.enabled) {
			ctx.ui.setStatus?.("context-watch", "[ctx] disabled");
			return;
		}

		const assessment = buildAssessment(ctx, config, thresholdOverrides);
		lastAssessment = assessment;
		const now = Date.now();
		let handoffPath: string | undefined;

		if (config.status) {
			ctx.ui.setStatus?.("context-watch", formatContextWatchStatus(assessment));
		}

		if (shouldAutoCheckpoint(assessment, config, now, lastAutoCheckpointAt)) {
			handoffPath = persistContextWatchHandoffEvent(ctx, assessment, reason);
			lastAutoCheckpointAt = now;
		}

		const autoCompactState = buildAutoCompactDiagnostics(assessment, config, {
			nowMs: now,
			lastAutoCompactAt,
			inFlight: autoCompactInFlight,
			isIdle: ctx.isIdle(),
			hasPendingMessages: ctx.hasPendingMessages(),
		}, AUTO_COMPACT_RETRY_DELAY_MS);
		if (autoCompactState.decision.trigger) {
			if (shouldRefreshHandoffBeforeAutoCompact(assessment, config) && !handoffPath) {
				handoffPath = persistContextWatchHandoffEvent(ctx, assessment, "auto_compact_prep");
			}
			clearAutoCompactRetryTimer();
			autoCompactInFlight = true;
			lastAutoCompactAt = now;
			ctx.ui.notify("context-watch: auto compact triggered", "warning");
			ctx.compact({
				onComplete: () => {
					autoCompactInFlight = false;
					ctx.ui.notify("context-watch: auto compact completed", "info");
					const nowAfterCompact = Date.now();
					if (shouldEmitAutoResumeAfterCompact(config, nowAfterCompact, lastAutoResumeAt)) {
						lastAutoResumeAt = nowAfterCompact;
						const resumePrompt = buildAutoResumePromptFromHandoff(
							readHandoffJson(ctx.cwd),
							config.handoffFreshMaxAgeMs,
						);
						pi.sendUserMessage(resumePrompt, { deliverAs: "followUp" });
						ctx.ui.notify("context-watch: auto resume queued", "info");
					}
				},
				onError: (error) => {
					autoCompactInFlight = false;
					ctx.ui.notify(`context-watch: auto compact failed (${error.message})`, "warning");
				},
			});
		} else if (assessment.level === "compact" && autoCompactState.retryDelayMs !== undefined) {
			scheduleAutoCompactRetry(ctx, autoCompactState.retryDelayMs);
		} else {
			clearAutoCompactRetryTimer();
		}

		if (!config.notify) return;
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

		const persistedPath = handoffPath ?? persistContextWatchHandoffEvent(ctx, assessment, reason);
		const label = reason === "session_start" ? "context-watch start" : "context-watch";
		const lines = [
			`${label}: ${formatContextWatchStatus(assessment)}`,
			`action: ${assessment.action}`,
			assessment.recommendation,
		];
		if (persistedPath) {
			const rel = path.relative(ctx.cwd, persistedPath).replace(/\\/g, "/");
			lines.push(`handoff: ${rel}`);
		}
		ctx.ui.notify(lines.join("\n"), assessment.severity);
	};

	const currentAutoCompactState = (ctx: ExtensionContext, assessment: ContextWatchAssessment) => {
		const nowMs = Date.now();
		const state = buildAutoCompactDiagnostics(assessment, config, {
			nowMs,
			lastAutoCompactAt,
			inFlight: autoCompactInFlight,
			isIdle: ctx.isIdle(),
			hasPendingMessages: ctx.hasPendingMessages(),
		}, AUTO_COMPACT_RETRY_DELAY_MS);
		const retryInMs = autoCompactRetryDueAt > 0 ? Math.max(0, autoCompactRetryDueAt - nowMs) : undefined;
		const handoff = readHandoffJson(ctx.cwd);
		const handoffTimestamp = typeof handoff.timestamp === "string" ? handoff.timestamp : undefined;
		const handoffFreshness = resolveHandoffFreshness(handoffTimestamp, nowMs, config.handoffFreshMaxAgeMs);
		return {
			...state,
			retryScheduled: Boolean(autoCompactRetryTimer),
			retryInMs,
			autoResumeEnabled: config.autoResumeAfterCompact,
			autoResumeCooldownMs: config.autoResumeCooldownMs,
			autoResumeReady: shouldEmitAutoResumeAfterCompact(config, nowMs, lastAutoResumeAt),
			handoffFreshMaxAgeMs: config.handoffFreshMaxAgeMs,
			handoffTimestamp,
			handoffFreshness,
			handoffAdvice: handoffFreshnessAdvice(handoffFreshness.label, config.autoResumeAfterCompact),
		};
	};

	const applyPreset = (ctx: ExtensionContext, presetInput?: unknown) => {
		const merged = applyContextWatchBootstrapToSettings(
			readProjectSettings(ctx.cwd),
			presetInput,
		);
		const settingsPath = writeProjectSettings(ctx.cwd, merged.settings);
		const piStack = (merged.settings.piStack as Record<string, unknown> | undefined) ?? {};
		config = normalizeContextWatchdogConfig(piStack.contextWatchdog);
		thresholdOverrides = readContextThresholdOverrides(ctx.cwd);
		run(ctx, "message_end");
		return {
			preset: merged.preset,
			settingsPath,
			patch: merged.plan.patch,
			notes: merged.plan.notes,
		};
	};

	pi.on("session_start", (_event, ctx) => {
		config = readWatchdogConfig(ctx.cwd);
		thresholdOverrides = readContextThresholdOverrides(ctx.cwd);
		lastAssessment = null;
		lastAnnouncedLevel = null;
		lastAnnouncedAt = 0;
		lastAutoCheckpointAt = 0;
		lastAutoCompactAt = 0;
		lastAutoResumeAt = 0;
		autoCompactInFlight = false;
		clearAutoCompactRetryTimer();
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
			const autoCompact = currentAutoCompactState(ctx, assessment);
			const payload = {
				...assessment,
				autoCompact,
			};
			return {
				content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
				details: payload,
			};
		},
	});

	pi.registerTool({
		name: "context_watch_bootstrap",
		label: "Context Watch Bootstrap",
		description:
			"Returns (or applies) a portable long-run context-watch preset patch (control-plane or agent-worker).",
		parameters: Type.Object({
			preset: Type.Optional(Type.String({ description: "control-plane | agent-worker" })),
			apply: Type.Optional(Type.Boolean()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as { preset?: string; apply?: boolean };
			if (p.apply) {
				const applied = applyPreset(ctx, p.preset);
				return {
					content: [{
						type: "text",
						text: JSON.stringify({ ...applied, applied: true, reloadRequired: false }, null, 2),
					}],
					details: { ...applied, applied: true, reloadRequired: false },
				};
			}
			const plan = buildContextWatchBootstrapPlan(p.preset);
			return {
				content: [{ type: "text", text: JSON.stringify({ ...plan, applied: false }, null, 2) }],
				details: { ...plan, applied: false },
			};
		},
	});

	pi.registerCommand("context-watch", {
		description: "Show/reset status, print bootstrap patch, or apply preset. Usage: /context-watch [status|reset|bootstrap [control-plane|agent-worker]|apply [control-plane|agent-worker]]",
		handler: async (args, ctx) => {
			const tokens = String(args ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
			const sub = tokens[0] ?? "status";
			if (sub === "reset") {
				lastAssessment = null;
				lastAnnouncedLevel = null;
				lastAnnouncedAt = 0;
				lastAutoCheckpointAt = 0;
				lastAutoCompactAt = 0;
				lastAutoResumeAt = 0;
				autoCompactInFlight = false;
				clearAutoCompactRetryTimer();
				ctx.ui.notify("context-watch: state reset", "info");
				return;
			}

			if (sub === "bootstrap") {
				const plan = buildContextWatchBootstrapPlan(tokens[1]);
				ctx.ui.notify(
					[
						`context-watch bootstrap (${plan.preset})`,
						JSON.stringify(plan.patch, null, 2),
						...plan.notes.map((n) => `- ${n}`),
					].join("\n"),
					"info",
				);
				return;
			}

			if (sub === "apply") {
				const applied = applyPreset(ctx, tokens[1]);
				ctx.ui.notify(
					[
						`context-watch preset applied (${applied.preset})`,
						`settings: ${applied.settingsPath}`,
						"effective now for context-watchdog (no /reload required).",
						...applied.notes.map((n) => `- ${n}`),
					].join("\n"),
					"info",
				);
				return;
			}

			const assessment = buildAssessment(ctx, config, thresholdOverrides);
			lastAssessment = assessment;
			const autoCompact = currentAutoCompactState(ctx, assessment);
			ctx.ui.notify(
				[
					formatContextWatchStatus(assessment),
					`action: ${assessment.action}`,
					assessment.recommendation,
					`auto-compact: decision=${autoCompact.decision.reason} trigger=${autoCompact.decision.trigger ? "yes" : "no"} retryRecommended=${autoCompact.retryRecommended ? "yes" : "no"} retryDelayMs=${autoCompact.retryDelayMs ?? "n/a"} retryScheduled=${autoCompact.retryScheduled ? "yes" : "no"} retryInMs=${autoCompact.retryInMs ?? "n/a"}`,
					`auto-resume: enabled=${autoCompact.autoResumeEnabled ? "yes" : "no"} ready=${autoCompact.autoResumeReady ? "yes" : "no"} cooldownMs=${autoCompact.autoResumeCooldownMs} freshMaxAgeMs=${config.handoffFreshMaxAgeMs}`,
					`handoff: ts=${autoCompact.handoffTimestamp ?? "unknown"} freshness=${autoCompact.handoffFreshness.label}${autoCompact.handoffFreshness.ageMs !== undefined ? ` ageSec=${Math.ceil(autoCompact.handoffFreshness.ageMs / 1000)}` : ""}`,
					`handoff-advice: ${autoCompact.handoffAdvice}`,
				].join("\n"),
				assessment.severity,
			);
		},
	});
}
