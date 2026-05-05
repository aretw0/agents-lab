import type { HandoffFreshnessLabel } from "./context-watchdog-handoff";
import type {
	ContextWatchAutoCompactTriggerOrigin,
	ContextWatchDeterministicStopReason,
	ContextWatchdogLevel,
} from "./context-watchdog-operator-signals";

export function formatTimeoutPressureSummary(input: {
	active?: boolean;
	count?: number;
	threshold?: number;
	windowMs?: number;
} | undefined): string {
	if (!input || input.active !== true) return "none";
	const count = Math.max(0, Math.floor(Number(input.count ?? 0)));
	const threshold = Math.max(1, Math.floor(Number(input.threshold ?? 2)));
	const windowSec = Math.max(1, Math.floor(Number(input.windowMs ?? 600_000) / 1000));
	return `${count}/${threshold}@${windowSec}s`;
}

export function formatContextWatchStatusToolSummary(input: {
	level: ContextWatchdogLevel;
	percent?: number;
	action?: string;
	autoCompactDecision?: string;
	operatorActionKind?: string;
	operatingCadence?: string;
	handoffFreshness?: HandoffFreshnessLabel;
	handoffAgeSec?: number;
	handoffFreshThresholdSec?: number;
	reloadGate?: string;
	timeoutPressureSummary?: string;
	postReloadResume?: "pending";
}): string {
	const handoffAgeSec = Number.isFinite(Number(input.handoffAgeSec))
		? Math.max(0, Math.floor(Number(input.handoffAgeSec)))
		: undefined;
	const handoffFreshThresholdSec = Number.isFinite(Number(input.handoffFreshThresholdSec))
		? Math.max(0, Math.floor(Number(input.handoffFreshThresholdSec)))
		: undefined;
	return [
		"context-watch-status:",
		`level=${input.level}`,
		input.percent !== undefined ? `percent=${Math.floor(Number(input.percent))}` : undefined,
		input.action ? `action=${input.action}` : undefined,
		input.autoCompactDecision ? `autoCompact=${input.autoCompactDecision}` : undefined,
		input.operatorActionKind ? `operator=${input.operatorActionKind}` : undefined,
		input.operatingCadence ? `cadence=${input.operatingCadence}` : undefined,
		input.handoffFreshness ? `handoff=${input.handoffFreshness}` : undefined,
		handoffAgeSec !== undefined && handoffFreshThresholdSec !== undefined
			? `handoffAgeSec=${handoffAgeSec}/${handoffFreshThresholdSec}`
			: undefined,
		input.reloadGate ? `reloadGate=${input.reloadGate}` : undefined,
		input.timeoutPressureSummary ? `timeoutPressure=${input.timeoutPressureSummary}` : undefined,
		input.postReloadResume ? `postReloadResume=${input.postReloadResume}` : undefined,
	].filter(Boolean).join(" ");
}

export function formatContextWatchCompactStageStatusSummary(input: {
	stage: string;
	level: ContextWatchdogLevel;
	checkpointPct: number;
	compactPct: number;
	reloadGate: string;
	nextAction: string;
}): string {
	return [
		"context-watch-compact-stage-status:",
		`stage=${input.stage}`,
		`level=${input.level}`,
		`checkpoint=${Math.floor(Number(input.checkpointPct))}`,
		`compact=${Math.floor(Number(input.compactPct))}`,
		`reloadGate=${input.reloadGate}`,
		`next=${input.nextAction.replace(/\s+/g, "_")}`,
		"authorization=none",
	].join(" ");
}

export function resolveContextWatchAdaptiveStatusSummary(input: {
	level: ContextWatchdogLevel;
	summary: string;
	nowMs: number;
	lastLevel?: ContextWatchdogLevel;
	lastEmittedAtMs?: number;
	cooldownMs?: number;
}): {
	summary: string;
	mode: "full" | "compact";
	cooldownRemainingSec: number;
} {
	const cooldownMs = Number.isFinite(Number(input.cooldownMs))
		? Math.max(1_000, Math.floor(Number(input.cooldownMs)))
		: 90_000;
	const shapeEligible = input.level === "warn" || input.level === "checkpoint";
	if (!shapeEligible) {
		return {
			summary: input.summary,
			mode: "full",
			cooldownRemainingSec: 0,
		};
	}
	const lastAt = Number.isFinite(Number(input.lastEmittedAtMs))
		? Math.max(0, Math.floor(Number(input.lastEmittedAtMs)))
		: 0;
	const elapsedMs = lastAt > 0 ? Math.max(0, Math.floor(input.nowMs - lastAt)) : cooldownMs;
	if (input.lastLevel === input.level && elapsedMs < cooldownMs) {
		const remainingSec = Math.max(1, Math.ceil((cooldownMs - elapsedMs) / 1000));
		return {
			summary: `context-watch-status: level=${input.level} mode=compact-output cooldown=active remainingSec=${remainingSec}`,
			mode: "compact",
			cooldownRemainingSec: remainingSec,
		};
	}
	return {
		summary: input.summary,
		mode: "full",
		cooldownRemainingSec: 0,
	};
}

export function formatContextWatchCommandStatusSummary(input: {
	level: ContextWatchdogLevel;
	percent?: number;
	action?: string;
	autoCompactDecision?: string;
	autoCompactTrigger?: boolean;
	autoCompactTriggerOrigin?: ContextWatchAutoCompactTriggerOrigin;
	retryScheduled?: boolean;
	calmCloseReady?: boolean;
	checkpointEvidenceReady?: boolean;
	operatorActionKind?: string;
	handoffFreshness?: HandoffFreshnessLabel;
	deterministicStopReason?: ContextWatchDeterministicStopReason;
	deterministicStopAction?: string;
	handoffPath?: string;
}): string {
	return [
		"context-watch:",
		`level=${input.level}`,
		input.percent !== undefined ? `percent=${Math.floor(Number(input.percent))}` : undefined,
		input.action ? `action=${input.action}` : undefined,
		input.autoCompactDecision ? `autoCompact=${input.autoCompactDecision}` : undefined,
		input.autoCompactTrigger !== undefined ? `trigger=${input.autoCompactTrigger ? "yes" : "no"}` : undefined,
		input.autoCompactTriggerOrigin && input.autoCompactTriggerOrigin !== "none" ? `triggerOrigin=${input.autoCompactTriggerOrigin}` : undefined,
		input.retryScheduled !== undefined ? `retry=${input.retryScheduled ? "yes" : "no"}` : undefined,
		input.calmCloseReady !== undefined ? `calm=${input.calmCloseReady ? "ready" : "no"}` : undefined,
		input.checkpointEvidenceReady !== undefined ? `checkpoint=${input.checkpointEvidenceReady ? "ready" : "missing"}` : undefined,
		input.operatorActionKind ? `operator=${input.operatorActionKind}` : undefined,
		input.deterministicStopReason && input.deterministicStopReason !== "none" ? `stop=${input.deterministicStopReason}` : undefined,
		input.deterministicStopAction && input.deterministicStopAction !== "none" ? `next=${input.deterministicStopAction}` : undefined,
		input.handoffPath ? `handoff=${input.handoffPath}` : input.handoffFreshness ? `handoff=${input.handoffFreshness}` : undefined,
	].filter(Boolean).join(" ");
}

export function formatContextWatchDeterministicStopSummary(input: {
	required: boolean;
	reason: ContextWatchDeterministicStopReason;
	action: string;
	operatorActionKind?: string;
	handoffPath?: string;
}): string {
	return [
		"context-watch-stop:",
		`required=${input.required ? "yes" : "no"}`,
		input.required ? `reason=${input.reason}` : undefined,
		input.required ? `action=${input.action}` : undefined,
		input.operatorActionKind ? `operator=${input.operatorActionKind}` : undefined,
		input.handoffPath ? `handoff=${input.handoffPath}` : undefined,
	].filter(Boolean).join(" ");
}
