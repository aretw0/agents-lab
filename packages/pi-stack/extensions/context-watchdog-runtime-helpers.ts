import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { applyCheckpointTaskStatusFocus } from "./context-watchdog-growth-checkpoint";
import {
	applyContextWatchToHandoff,
	type ContextWatchHandoffReason,
} from "./context-watchdog-handoff-events";
import {
	assessLocalSliceHandoffBudget,
	buildLocalSliceHandoffCheckpoint,
	type LocalSliceHandoffCheckpointInput,
} from "./context-watchdog-handoff";
import { composeAutoResumeSuppressionHint as composeAutoResumeSuppressionHintFromResume, type AutoResumeDispatchReason } from "./context-watchdog-resume";
import { readHandoffJson, writeHandoffJson } from "./context-watchdog-storage";
import type { ContextWatchdogConfig } from "./context-watchdog-config";
import type { ContextWatchAssessment } from "./context-watchdog-operator-signals";

export function isProviderRequestTimeoutError(message: string): boolean {
	const normalized = String(message ?? "").toLowerCase();
	return normalized.includes("request timed out") || normalized.includes("request timeout") || normalized.includes("timed out");
}

export function composeAutoResumeSuppressionHint(input: {
	reason: AutoResumeDispatchReason;
	timeoutPressureActive?: boolean;
	timeoutPressureCount?: number;
	timeoutPressureThreshold?: number;
}): string | undefined {
	return composeAutoResumeSuppressionHintFromResume(input);
}

export function writeLocalSliceHandoffCheckpoint(
	cwd: string,
	input: LocalSliceHandoffCheckpointInput,
	options: { maxJsonChars?: number } = {},
): { ok: boolean; summary: string; path?: string; checkpoint?: Record<string, unknown>; reason?: string; jsonChars?: number; maxJsonChars?: number } {
	const taskId = input.taskId || "n/a";
	if (typeof input.context !== "string" || input.context.trim().length <= 0) {
		return {
			ok: false,
			reason: "missing-context",
			summary: `context-watch-checkpoint: ok=no task=${taskId} reason=missing-context`,
		};
	}
	try {
		const current = readHandoffJson(cwd);
		const currentTimestamp = typeof current.timestamp === "string" ? Date.parse(current.timestamp) : NaN;
		const nextTimestamp = Date.parse(input.timestampIso);
		if (Number.isFinite(currentTimestamp) && Number.isFinite(nextTimestamp) && nextTimestamp < currentTimestamp) {
			return {
				ok: false,
				reason: "stale-checkpoint",
				summary: `context-watch-checkpoint: ok=no task=${taskId} reason=stale-checkpoint`,
			};
		}
		const checkpoint = buildLocalSliceHandoffCheckpoint(input);
		applyCheckpointTaskStatusFocus(cwd, checkpoint, taskId);
		const budget = assessLocalSliceHandoffBudget(checkpoint, options.maxJsonChars);
		if (!budget.ok) {
			return {
				ok: false,
				reason: budget.reason,
				summary: `context-watch-checkpoint: ok=no task=${taskId} reason=${budget.reason}`,
				jsonChars: budget.jsonChars,
				maxJsonChars: budget.maxJsonChars,
			};
		}
		const handoffPath = writeHandoffJson(cwd, checkpoint);
		const growthDecision = input.growthDecision;
		const growthScore = Number.isFinite(input.growthScore) ? Math.max(0, Math.min(100, Math.round(Number(input.growthScore)))) : undefined;
		const growthCompact = [
			growthDecision ? `growthDecision=${growthDecision}` : undefined,
			growthScore !== undefined ? `growthScore=${growthScore}` : undefined,
		].filter(Boolean).join(" ");
		return {
			ok: true,
			summary: [
				`context-watch-checkpoint: ok=yes task=${taskId} path=.project/handoff.json`,
				growthCompact,
			].filter(Boolean).join(" "),
			path: handoffPath,
			checkpoint,
			jsonChars: budget.jsonChars,
			maxJsonChars: budget.maxJsonChars,
		};
	} catch (error) {
		const reason = error instanceof Error ? error.message : "write-failed";
		return {
			ok: false,
			reason,
			summary: `context-watch-checkpoint: ok=no task=${taskId} reason=write-failed`,
		};
	}
}

export function persistContextWatchHandoffEvent(
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

export function isContextWindowOverflowErrorMessage(message: string): boolean {
	const text = String(message ?? "").toLowerCase();
	return text.includes("input exceeds the context window")
		|| text.includes("exceeds the context window")
		|| text.includes("context window of this model");
}

export function applyEmergencyContextWindowFallbackConfig(
	config: ContextWatchdogConfig,
): ContextWatchdogConfig {
	const currentCheckpoint = Number.isFinite(config.checkpointPct) ? Number(config.checkpointPct) : 68;
	const currentCompact = Number.isFinite(config.compactPct) ? Number(config.compactPct) : 72;
	return {
		...config,
		checkpointPct: Math.min(currentCheckpoint, 65),
		compactPct: Math.min(currentCompact, 69),
	};
}
