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

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	resolveContextThresholds,
	type ContextThresholdOverrides,
} from "./custom-footer";
import {
	buildAutoCompactDiagnostics,
	resolveAutoCompactRetryDelayMs,
	isAutoCompactDeferralReason,
	shouldScheduleAutoCompactRetry,
	shouldTriggerAutoCompact,
	type ContextWatchAutoCompactDecision,
	type ContextWatchAutoCompactDiagnostics,
} from "./context-watchdog-auto-compact";
import {
	DEFAULT_CONTEXT_WATCHDOG_CONFIG,
	deriveContextWatchThresholds,
	normalizeContextWatchdogConfig,
	type ContextWatchdogConfig,
	type ContextWatchThresholds,
} from "./context-watchdog-config";
import {
	applyContextWatchBootstrapToSettings,
	buildContextWatchBootstrapPlan,
	parseContextBootstrapPreset,
	type ContextWatchBootstrapPlan,
	type ContextWatchBootstrapPreset,
	deepMergeSettings,
} from "./context-watchdog-bootstrap";
import {
	contextWatchActionForLevel,
	evaluateContextWatch,
	formatContextWatchStatus,
	shouldAnnounceContextWatch,
	shouldAutoCheckpoint,
} from "./context-watchdog-policy";
import {
	buildAutoResumePromptFromHandoff,
	handoffFreshnessAdvice,
	handoffRefreshMode,
	resolveHandoffFreshness,
	toAgeSec,
	type HandoffFreshnessLabel,
	type HandoffRefreshMode,
} from "./context-watchdog-handoff";
import {
	resolveAutoResumeDispatchDecision,
	resolveHandoffPrepDecision,
	shouldEmitAutoResumeAfterCompact,
	shouldRefreshHandoffBeforeAutoCompact,
	type HandoffPrepReason,
} from "./context-watchdog-resume";
import {
	applyContextWatchToHandoff,
	contextWatchEventAgeMs,
	latestContextWatchEvent,
	summarizeContextWatchEvent,
	type ContextWatchHandoffEvent,
	type ContextWatchHandoffReason,
} from "./context-watchdog-handoff-events";
import {
	readHandoffJson,
	readProjectSettings,
	readSettingsJson,
	writeHandoffJson,
	writeProjectSettings,
} from "./context-watchdog-storage";

export {
	applyContextWatchBootstrapToSettings,
	applyContextWatchToHandoff,
	buildAutoCompactDiagnostics,
	buildAutoResumePromptFromHandoff,
	buildContextWatchBootstrapPlan,
	contextWatchActionForLevel,
	contextWatchEventAgeMs,
	deepMergeSettings,
	deriveContextWatchThresholds,
	evaluateContextWatch,
	formatContextWatchStatus,
	handoffFreshnessAdvice,
	handoffRefreshMode,
	latestContextWatchEvent,
	normalizeContextWatchdogConfig,
	parseContextBootstrapPreset,
	resolveAutoCompactRetryDelayMs,
	resolveAutoResumeDispatchDecision,
	resolveHandoffFreshness,
	resolveHandoffPrepDecision,
	shouldAnnounceContextWatch,
	shouldAutoCheckpoint,
	shouldEmitAutoResumeAfterCompact,
	shouldRefreshHandoffBeforeAutoCompact,
	shouldScheduleAutoCompactRetry,
	shouldTriggerAutoCompact,
	summarizeContextWatchEvent,
	toAgeSec,
	isAutoCompactDeferralReason,
};

export type {
	ContextWatchAutoCompactDecision,
	ContextWatchAutoCompactDiagnostics,
	ContextWatchBootstrapPlan,
	ContextWatchBootstrapPreset,
	ContextWatchHandoffEvent,
	ContextWatchHandoffReason,
	ContextWatchdogConfig,
	ContextWatchThresholds,
	HandoffFreshnessLabel,
	HandoffPrepReason,
	HandoffRefreshMode,
};

export type ContextWatchdogLevel = "ok" | "warn" | "checkpoint" | "compact";

export type ContextWatchAssessment = {
	percent: number;
	level: ContextWatchdogLevel;
	thresholds: ContextWatchThresholds;
	recommendation: string;
	action: string;
	severity: "info" | "warning";
};

export type ContextWatchOperatorSignal = {
	reloadRequired: boolean;
	humanActionRequired: boolean;
	reasons: string[];
	noiseExcessive: boolean;
};

export type ContextWatchOperatingCadence = "standard-slices" | "micro-slice-only";

export type ContextWatchOperatingCadenceSignal = {
	operatingCadence: ContextWatchOperatingCadence;
	postResumeRecalibrated: boolean;
	reason:
		| "healthy"
		| "level-warn"
		| "level-checkpoint"
		| "level-compact"
		| "recalibrated-from-warn"
		| "recalibrated-from-checkpoint"
		| "recalibrated-from-compact";
};

export function applyWarnCadenceEscalation(
	assessment: ContextWatchAssessment,
	warnStreak: number,
): ContextWatchAssessment {
	if (assessment.level !== "warn" || warnStreak < 2) return assessment;
	return {
		...assessment,
		action: "write-checkpoint",
		recommendation:
			"Second warn detected: write handoff checkpoint now, then continue micro-slices until compact/resume.",
		severity: "warning",
	};
}

export function resolveContextWatchSignalNoiseExcessive(
	announcementsInWindow: number,
	maxAnnouncementsPerWindow: number,
): boolean {
	const announcements = Math.max(0, Math.floor(Number(announcementsInWindow ?? 0)));
	const maxAllowed = Math.max(1, Math.floor(Number(maxAnnouncementsPerWindow ?? 1)));
	return announcements > maxAllowed;
}

export function resolveContextWatchOperatorSignal(input: {
	reloadRequired?: boolean;
	handoffManualRefreshRequired?: boolean;
	signalNoiseExcessive?: boolean;
}): ContextWatchOperatorSignal {
	const reloadRequired = input.reloadRequired === true;
	const handoffManualRefreshRequired = input.handoffManualRefreshRequired === true;
	const signalNoiseExcessive = input.signalNoiseExcessive === true;
	const reasons: string[] = [];
	if (reloadRequired) reasons.push("reload-required");
	if (handoffManualRefreshRequired) reasons.push("handoff-refresh-required");
	if (signalNoiseExcessive) reasons.push("signal-noise-excessive");
	return {
		reloadRequired,
		humanActionRequired: reasons.length > 0,
		reasons,
		noiseExcessive: signalNoiseExcessive,
	};
}

export function resolveContextWatchOperatingCadence(input: {
	assessmentLevel: ContextWatchdogLevel;
	handoffLastEventLevel?: ContextWatchdogLevel | null;
}): ContextWatchOperatingCadenceSignal {
	const level = input.assessmentLevel;
	if (level === "warn") {
		return {
			operatingCadence: "micro-slice-only",
			postResumeRecalibrated: false,
			reason: "level-warn",
		};
	}
	if (level === "checkpoint") {
		return {
			operatingCadence: "micro-slice-only",
			postResumeRecalibrated: false,
			reason: "level-checkpoint",
		};
	}
	if (level === "compact") {
		return {
			operatingCadence: "micro-slice-only",
			postResumeRecalibrated: false,
			reason: "level-compact",
		};
	}

	const previous = input.handoffLastEventLevel;
	if (previous === "warn") {
		return {
			operatingCadence: "standard-slices",
			postResumeRecalibrated: true,
			reason: "recalibrated-from-warn",
		};
	}
	if (previous === "checkpoint") {
		return {
			operatingCadence: "standard-slices",
			postResumeRecalibrated: true,
			reason: "recalibrated-from-checkpoint",
		};
	}
	if (previous === "compact") {
		return {
			operatingCadence: "standard-slices",
			postResumeRecalibrated: true,
			reason: "recalibrated-from-compact",
		};
	}
	return {
		operatingCadence: "standard-slices",
		postResumeRecalibrated: false,
		reason: "healthy",
	};
}

export type PreCompactCalmCloseSignal = {
	calmCloseReady: boolean;
	checkpointEvidenceReady: boolean;
	deferCount: number;
	deferThreshold: number;
	antiParalysisTriggered: boolean;
	recommendation: string;
};

export function resolveCheckpointEvidenceReadyForCalmClose(input: {
	handoffLastEventLevel?: ContextWatchdogLevel | null;
	handoffLastEventAgeMs?: number;
	maxCheckpointAgeMs: number;
}): boolean {
	const level = input.handoffLastEventLevel;
	if (level !== "checkpoint" && level !== "compact") return false;
	const ageMs = input.handoffLastEventAgeMs;
	if (ageMs === undefined || !Number.isFinite(ageMs)) return true;
	const maxAgeMs = Math.max(60_000, Math.floor(Number(input.maxCheckpointAgeMs ?? 0)));
	return ageMs <= maxAgeMs;
}

export function resolvePreCompactCalmCloseSignal(input: {
	assessmentLevel: ContextWatchdogLevel;
	decisionReason: ContextWatchAutoCompactDecision["reason"];
	checkpointEvidenceReady: boolean;
	deferCount: number;
	deferThreshold?: number;
}): PreCompactCalmCloseSignal {
	const deferCount = Math.max(0, Math.floor(Number(input.deferCount ?? 0)));
	const deferThreshold = Math.max(2, Math.floor(Number(input.deferThreshold ?? 3)));
	const inCompact = input.assessmentLevel === "compact";
	const calmCloseReady = inCompact
		&& input.checkpointEvidenceReady
		&& input.decisionReason !== "feature-disabled";
	const antiParalysisTriggered = calmCloseReady
		&& isAutoCompactDeferralReason(input.decisionReason)
		&& deferCount >= deferThreshold;

	let recommendation = "calm-close: not required (context outside compact lane).";
	if (inCompact && !input.checkpointEvidenceReady) {
		recommendation = "calm-close: capture checkpoint evidence first, then let idle auto-compact run.";
	} else if (antiParalysisTriggered) {
		recommendation = "anti-paralysis: compact has been deferred repeatedly; close the current slice now and let idle auto-compact proceed.";
	} else if (calmCloseReady && input.decisionReason === "trigger") {
		recommendation = "calm-close ready: compact trigger available now (idle + checkpoint evidence present).";
	} else if (calmCloseReady) {
		recommendation = "calm-close ready: finish the active micro-slice and keep the session idle to allow auto-compact.";
	}

	return {
		calmCloseReady,
		checkpointEvidenceReady: input.checkpointEvidenceReady,
		deferCount,
		deferThreshold,
		antiParalysisTriggered,
		recommendation,
	};
}

const DEFAULT_CONFIG: ContextWatchdogConfig = DEFAULT_CONTEXT_WATCHDOG_CONFIG;

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

function readDeferredLaneQueueCount(cwd: string): number {
	const queuePath = path.join(cwd, ".pi", "deferred-intents.json");
	if (!existsSync(queuePath)) return 0;
	try {
		const json = JSON.parse(readFileSync(queuePath, "utf8"));
		if (!Array.isArray(json?.items)) return 0;
		return json.items.filter((item: unknown) => {
			if (!item || typeof item !== "object") return false;
			const row = item as { text?: unknown };
			return typeof row.text === "string" && row.text.trim().length > 0;
		}).length;
	} catch {
		return 0;
	}
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
	let lastAutoResumeDecision: {
		atIso: string;
		reason: string;
		dispatched: boolean;
		hasPendingMessages: boolean;
		hasRecentSteerInput: boolean;
		queuedLaneIntents: number;
	} | null = null;
	let lastInputAt = 0;
	let lastAutoCompactTriggerAt = 0;
	let autoCompactInFlight = false;
	let autoCompactRetryTimer: NodeJS.Timeout | undefined;
	let autoCompactRetryDueAt = 0;
	let consecutiveWarnCount = 0;
	let compactDeferCount = 0;
	let lastAntiParalysisAuditDeferCount = 0;
	let announceWindowStartAt = 0;
	let announceCountInWindow = 0;
	const SIGNAL_NOISE_WINDOW_MS = 10 * 60 * 1000;
	const SIGNAL_NOISE_MAX_ANNOUNCEMENTS = 4;
	const CALM_CLOSE_DEFER_THRESHOLD = 3;

	const getAnnouncementsInWindow = (nowMs: number): number => {
		if (announceWindowStartAt <= 0) return 0;
		if ((nowMs - announceWindowStartAt) > SIGNAL_NOISE_WINDOW_MS) return 0;
		return announceCountInWindow;
	};

	const markAnnouncement = (nowMs: number): void => {
		if (announceWindowStartAt <= 0 || (nowMs - announceWindowStartAt) > SIGNAL_NOISE_WINDOW_MS) {
			announceWindowStartAt = nowMs;
			announceCountInWindow = 0;
		}
		announceCountInWindow += 1;
	};

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

		const baseAssessment = buildAssessment(ctx, config, thresholdOverrides);
		if (baseAssessment.level === "warn") {
			consecutiveWarnCount += 1;
		} else {
			consecutiveWarnCount = 0;
		}
		const assessment = applyWarnCadenceEscalation(baseAssessment, consecutiveWarnCount);
		lastAssessment = assessment;
		const now = Date.now();
		let handoffPath: string | undefined;

		if (config.status) {
			ctx.ui.setStatus?.("context-watch", formatContextWatchStatus(assessment));
		}

		const shouldCheckpointFromWarnCadence =
			assessment.level === "warn" &&
			assessment.action === "write-checkpoint" &&
			(now - lastAutoCheckpointAt) >= config.cooldownMs;
		if (
			shouldAutoCheckpoint(assessment, config, now, lastAutoCheckpointAt) ||
			shouldCheckpointFromWarnCadence
		) {
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
		if (
			assessment.level === "compact"
			&& !autoCompactState.decision.trigger
			&& isAutoCompactDeferralReason(autoCompactState.decision.reason)
		) {
			compactDeferCount += 1;
		} else {
			compactDeferCount = 0;
			lastAntiParalysisAuditDeferCount = 0;
		}
		const handoffForCalmClose = readHandoffJson(ctx.cwd);
		const handoffEventForCalmClose = latestContextWatchEvent(handoffForCalmClose);
		const handoffEventAgeForCalmClose = contextWatchEventAgeMs(handoffEventForCalmClose, now);
		const calmCloseSignal = resolvePreCompactCalmCloseSignal({
			assessmentLevel: assessment.level,
			decisionReason: autoCompactState.decision.reason,
			checkpointEvidenceReady: resolveCheckpointEvidenceReadyForCalmClose({
				handoffLastEventLevel: handoffEventForCalmClose?.level,
				handoffLastEventAgeMs: handoffEventAgeForCalmClose,
				maxCheckpointAgeMs: config.handoffFreshMaxAgeMs,
			}),
			deferCount: compactDeferCount,
			deferThreshold: CALM_CLOSE_DEFER_THRESHOLD,
		});
		if (
			calmCloseSignal.antiParalysisTriggered
			&& compactDeferCount >= CALM_CLOSE_DEFER_THRESHOLD
			&& compactDeferCount % CALM_CLOSE_DEFER_THRESHOLD === 0
			&& compactDeferCount !== lastAntiParalysisAuditDeferCount
		) {
			lastAntiParalysisAuditDeferCount = compactDeferCount;
			(pi as unknown as { appendEntry?: (type: string, payload: unknown) => void }).appendEntry?.(
				"context-watchdog.pre-compact-calm-close",
				{
					atIso: new Date(now).toISOString(),
					deferCount: compactDeferCount,
					deferThreshold: CALM_CLOSE_DEFER_THRESHOLD,
					decisionReason: autoCompactState.decision.reason,
					recommendation: calmCloseSignal.recommendation,
				},
			);
			ctx.ui.notify(calmCloseSignal.recommendation, "warning");
		}
		if (autoCompactState.decision.trigger) {
			const handoffForPrep = readHandoffJson(ctx.cwd);
			const handoffTsForPrep = typeof handoffForPrep.timestamp === "string" ? handoffForPrep.timestamp : undefined;
			const handoffFreshnessForPrep = resolveHandoffFreshness(handoffTsForPrep, now, config.handoffFreshMaxAgeMs);
			if (shouldRefreshHandoffBeforeAutoCompact(assessment, config, handoffFreshnessForPrep.label) && !handoffPath) {
				handoffPath = persistContextWatchHandoffEvent(ctx, assessment, "auto_compact_prep");
			}
			clearAutoCompactRetryTimer();
			autoCompactInFlight = true;
			lastAutoCompactAt = now;
			lastAutoCompactTriggerAt = now;
			ctx.ui.notify("context-watch: auto compact triggered", "warning");
			ctx.compact({
				onComplete: () => {
					autoCompactInFlight = false;
					ctx.ui.notify("context-watch: auto compact completed", "info");
					const nowAfterCompact = Date.now();
					const hasPendingMessages = ctx.hasPendingMessages();
					const hasRecentSteerInput = lastInputAt > lastAutoCompactTriggerAt;
					const queuedLaneIntents = readDeferredLaneQueueCount(ctx.cwd);
					const autoResumeReady = shouldEmitAutoResumeAfterCompact(config, nowAfterCompact, lastAutoResumeAt);
					const autoResumeDecision = resolveAutoResumeDispatchDecision({
						autoResumeReady,
						hasPendingMessages,
						hasRecentSteerInput,
						queuedLaneIntents,
					});
					const autoResumeSnapshot = {
						atIso: new Date(nowAfterCompact).toISOString(),
						reason: autoResumeDecision.reason,
						dispatched: autoResumeDecision.shouldDispatch,
						hasPendingMessages,
						hasRecentSteerInput,
						queuedLaneIntents,
					};
					lastAutoResumeDecision = autoResumeSnapshot;
					if (autoResumeDecision.shouldDispatch) {
						lastAutoResumeAt = nowAfterCompact;
						const resumePrompt = buildAutoResumePromptFromHandoff(
							readHandoffJson(ctx.cwd),
							config.handoffFreshMaxAgeMs,
						);
						pi.sendUserMessage(resumePrompt, { deliverAs: "followUp" });
						ctx.ui.notify("context-watch: auto resume queued", "info");
					} else {
						(pi as unknown as { appendEntry?: (type: string, payload: unknown) => void }).appendEntry?.(
							"context-watchdog.auto-resume-suppressed",
							{
								atIso: autoResumeSnapshot.atIso,
								reason: autoResumeSnapshot.reason,
								hasPendingMessages: autoResumeSnapshot.hasPendingMessages,
								hasRecentSteerInput: autoResumeSnapshot.hasRecentSteerInput,
								queuedLaneIntents: autoResumeSnapshot.queuedLaneIntents,
							},
						);
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
		const forceWarnCadenceAnnouncement =
			assessment.level === "warn" &&
			assessment.action === "write-checkpoint" &&
			consecutiveWarnCount === 2;
		lastAnnouncedLevel = assessment.level;
		if (!announce && !forceWarnCadenceAnnouncement) return;
		lastAnnouncedAt = now;
		markAnnouncement(now);

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

	const currentAutoCompactState = (
		ctx: ExtensionContext,
		assessment: ContextWatchAssessment,
		deferCount = compactDeferCount,
	) => {
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
		const handoffFreshnessAgeSec = toAgeSec(handoffFreshness.ageMs);
		const handoffLastEvent = latestContextWatchEvent(handoff);
		const handoffLastEventAgeMs = contextWatchEventAgeMs(handoffLastEvent, nowMs);
		const handoffLastEventAgeSec = toAgeSec(handoffLastEventAgeMs);
		const refreshMode = handoffRefreshMode(handoffFreshness.label, config.autoResumeAfterCompact);
		const handoffPrep = resolveHandoffPrepDecision(assessment, config, handoffFreshness.label);
		const checkpointEvidenceReady = resolveCheckpointEvidenceReadyForCalmClose({
			handoffLastEventLevel: handoffLastEvent?.level,
			handoffLastEventAgeMs,
			maxCheckpointAgeMs: config.handoffFreshMaxAgeMs,
		});
		const calmClose = resolvePreCompactCalmCloseSignal({
			assessmentLevel: assessment.level,
			decisionReason: state.decision.reason,
			checkpointEvidenceReady,
			deferCount,
			deferThreshold: CALM_CLOSE_DEFER_THRESHOLD,
		});
		return {
			...state,
			retryScheduled: Boolean(autoCompactRetryTimer),
			retryInMs,
			autoResumeEnabled: config.autoResumeAfterCompact,
			autoResumeCooldownMs: config.autoResumeCooldownMs,
			autoResumeReady: shouldEmitAutoResumeAfterCompact(config, nowMs, lastAutoResumeAt),
			autoResumeLastDecision: lastAutoResumeDecision,
			autoResumeLastDecisionReason: lastAutoResumeDecision?.reason ?? "none",
			autoResumeLastDecisionAtIso: lastAutoResumeDecision?.atIso,
			autoResumeLastDispatched: lastAutoResumeDecision?.dispatched ?? false,
			handoffFreshMaxAgeMs: config.handoffFreshMaxAgeMs,
			handoffTimestamp,
			handoffFreshness,
			handoffFreshnessAgeSec,
			handoffAdvice: handoffFreshnessAdvice(handoffFreshness.label, config.autoResumeAfterCompact),
			handoffRefreshMode: refreshMode,
			handoffManualRefreshRequired: refreshMode === "manual",
			handoffPrepRefreshOnTrigger: handoffPrep.refreshOnTrigger,
			handoffPrepReason: handoffPrep.reason,
			handoffLastEvent: handoffLastEvent ?? null,
			handoffLastEventSummary: summarizeContextWatchEvent(handoffLastEvent),
			handoffLastEventAgeMs,
			handoffLastEventAgeSec,
			calmCloseReady: calmClose.calmCloseReady,
			checkpointEvidenceReady: calmClose.checkpointEvidenceReady,
			deferCount: calmClose.deferCount,
			deferThreshold: calmClose.deferThreshold,
			antiParalysisTriggered: calmClose.antiParalysisTriggered,
			calmCloseRecommendation: calmClose.recommendation,
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
		lastAutoResumeDecision = null;
		lastInputAt = 0;
		lastAutoCompactTriggerAt = 0;
		autoCompactInFlight = false;
		clearAutoCompactRetryTimer();
		consecutiveWarnCount = 0;
		compactDeferCount = 0;
		lastAntiParalysisAuditDeferCount = 0;
		announceWindowStartAt = 0;
		announceCountInWindow = 0;
		run(ctx, "session_start");
	});

	pi.on("input", (event) => {
		const text = String(event.text ?? "").trim();
		if (!text) return;
		lastInputAt = Date.now();
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
			const nowMs = Date.now();
			const operatorSignal = resolveContextWatchOperatorSignal({
				reloadRequired: false,
				handoffManualRefreshRequired: autoCompact.handoffManualRefreshRequired,
				signalNoiseExcessive: resolveContextWatchSignalNoiseExcessive(
					getAnnouncementsInWindow(nowMs),
					SIGNAL_NOISE_MAX_ANNOUNCEMENTS,
				),
			});
			const operatingCadence = resolveContextWatchOperatingCadence({
				assessmentLevel: assessment.level,
				handoffLastEventLevel: autoCompact.handoffLastEvent?.level,
			});
			const payload = {
				...assessment,
				autoCompact,
				operatorSignal,
				operatingCadence,
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
				lastAutoResumeDecision = null;
				autoCompactInFlight = false;
				clearAutoCompactRetryTimer();
				consecutiveWarnCount = 0;
				compactDeferCount = 0;
				lastAntiParalysisAuditDeferCount = 0;
				announceWindowStartAt = 0;
				announceCountInWindow = 0;
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
			const nowMs = Date.now();
			const operatorSignal = resolveContextWatchOperatorSignal({
				reloadRequired: false,
				handoffManualRefreshRequired: autoCompact.handoffManualRefreshRequired,
				signalNoiseExcessive: resolveContextWatchSignalNoiseExcessive(
					getAnnouncementsInWindow(nowMs),
					SIGNAL_NOISE_MAX_ANNOUNCEMENTS,
				),
			});
			const operatingCadence = resolveContextWatchOperatingCadence({
				assessmentLevel: assessment.level,
				handoffLastEventLevel: autoCompact.handoffLastEvent?.level,
			});
			ctx.ui.notify(
				[
					formatContextWatchStatus(assessment),
					`action: ${assessment.action}`,
					assessment.recommendation,
					`auto-compact: decision=${autoCompact.decision.reason} trigger=${autoCompact.decision.trigger ? "yes" : "no"} retryRecommended=${autoCompact.retryRecommended ? "yes" : "no"} retryDelayMs=${autoCompact.retryDelayMs ?? "n/a"} retryScheduled=${autoCompact.retryScheduled ? "yes" : "no"} retryInMs=${autoCompact.retryInMs ?? "n/a"}`,
					`calm-close: ready=${autoCompact.calmCloseReady ? "yes" : "no"} checkpointEvidenceReady=${autoCompact.checkpointEvidenceReady ? "yes" : "no"} deferCount=${autoCompact.deferCount}/${autoCompact.deferThreshold} antiParalysis=${autoCompact.antiParalysisTriggered ? "yes" : "no"}`,
					autoCompact.calmCloseRecommendation ? `calm-close recommendation: ${autoCompact.calmCloseRecommendation}` : "",
					`auto-resume: enabled=${autoCompact.autoResumeEnabled ? "yes" : "no"} ready=${autoCompact.autoResumeReady ? "yes" : "no"} cooldownMs=${autoCompact.autoResumeCooldownMs} freshMaxAgeMs=${config.handoffFreshMaxAgeMs}`,
					`auto-resume-last: reason=${autoCompact.autoResumeLastDecisionReason} dispatched=${autoCompact.autoResumeLastDispatched ? "yes" : "no"} at=${autoCompact.autoResumeLastDecisionAtIso ?? "n/a"}`,
					`operator-signal: humanActionRequired=${operatorSignal.humanActionRequired ? "yes" : "no"} reloadRequired=${operatorSignal.reloadRequired ? "yes" : "no"} reasons=${operatorSignal.reasons.length > 0 ? operatorSignal.reasons.join(",") : "none"}`,
					`operating-cadence: ${operatingCadence.operatingCadence} postResumeRecalibrated=${operatingCadence.postResumeRecalibrated ? "yes" : "no"} reason=${operatingCadence.reason}`,
					`handoff: ts=${autoCompact.handoffTimestamp ?? "unknown"} freshness=${autoCompact.handoffFreshness.label}${autoCompact.handoffFreshnessAgeSec !== undefined ? ` ageSec=${autoCompact.handoffFreshnessAgeSec}` : ""}`,
					`handoff-last-event: ${autoCompact.handoffLastEventSummary}${autoCompact.handoffLastEventAgeSec !== undefined ? ` ageSec=${autoCompact.handoffLastEventAgeSec}` : ""}`,
					`handoff-advice: ${autoCompact.handoffAdvice}`,
					`handoff-refresh: mode=${autoCompact.handoffRefreshMode} manualRequired=${autoCompact.handoffManualRefreshRequired ? "yes" : "no"}`,
					`handoff-prep: refreshOnTrigger=${autoCompact.handoffPrepRefreshOnTrigger ? "yes" : "no"} reason=${autoCompact.handoffPrepReason}`,
				].join("\n"),
				assessment.severity,
			);
		},
	});
}
