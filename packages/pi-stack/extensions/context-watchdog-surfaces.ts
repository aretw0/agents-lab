/**
 * context-watchdog-surfaces — opt-in tools and commands for context-watchdog.
 *
 * The passive watchdog stays in context-watchdog.ts. This entrypoint keeps
 * heavier read-only status/continuation/checkpoint tools out of the default
 * runtime hot path.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ContextThresholdOverrides } from "./custom-footer";
import { resolveContextThresholds } from "./custom-footer";
import { DEFAULT_CONTEXT_WATCHDOG_CONFIG, deriveContextWatchThresholds, normalizeContextWatchdogConfig, type ContextWatchdogConfig } from "./context-watchdog-config";
import { evaluateContextWatch } from "./context-watchdog-policy";
import type { ContextWatchAssessment } from "./context-watchdog-operator-signals";
import { buildContextWatchdogApplyPreset, registerContextWatchdogStatusSurface } from "./context-watchdog-status-surface";
import {
	makeContextWatchdogSourceMtimeReader,
	readContextWatchdogRuntimeReloadMtimeMs,
	readContextThresholdOverrides,
	readWatchdogConfig,
} from "./context-watchdog-runtime-status";
import {
	CONTEXT_WATCHDOG_RUNTIME_CONSTANTS,
	createContextWatchTimeoutPressure,
} from "./context-watchdog-runtime-state";
import type { ContextWatchHandoffReason } from "./context-watchdog-handoff-events";
import type { AutoResumeDecisionSnapshot } from "./context-watchdog-resume";
import type { AutoResumePromptDiagnostics } from "./context-watchdog-handoff";

const readContextWatchdogSurfacesSourceMtimeMs = makeContextWatchdogSourceMtimeReader(import.meta.url);

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

export default function contextWatchdogSurfacesExtension(pi: ExtensionAPI) {
	let config: ContextWatchdogConfig = DEFAULT_CONTEXT_WATCHDOG_CONFIG;
	let thresholdOverrides: ContextThresholdOverrides | undefined;
	let runtimeReloadCwdAtSessionStart: string | undefined;
	let runtimeReloadMtimeMsAtSessionStart: number | undefined;
	let lastAssessment: ContextWatchAssessment | null = null;
	let lastAutoCompactAt = 0;
	let lastAutoResumeAt = 0;
	let lastAutoResumeDecision: (AutoResumeDecisionSnapshot & {
		promptDiagnostics?: AutoResumePromptDiagnostics;
	}) | null = null;
	let lastSteeringSignal: {
		atIso: string;
		reason: ContextWatchHandoffReason;
		level: string;
		action: string;
		delivery: string;
		notifyEnabled: boolean;
	} | null = null;
	let autoCompactInFlight = false;
	let autoCompactRetryDueAt = 0;
	let compactDeferCount = 0;
	let compactDeferWindowStartedAt = 0;
	let lastAntiParalysisNotifyAt = 0;
	let antiParalysisNotifyCountInWindow = 0;
	const timeoutPressure = createContextWatchTimeoutPressure();

	const isReloadRequiredForSourceUpdate = (): boolean => {
		if (!Number.isFinite(runtimeReloadMtimeMsAtSessionStart)) return false;
		const current = readContextWatchdogRuntimeReloadMtimeMs(
			runtimeReloadCwdAtSessionStart ?? process.cwd(),
			readContextWatchdogSurfacesSourceMtimeMs,
		);
		if (!Number.isFinite(current)) return false;
		return (current as number) > (runtimeReloadMtimeMsAtSessionStart as number);
	};

	const runtime = {
		getConfig: () => config,
		setConfig: (next: ContextWatchdogConfig) => { config = next; },
		getThresholdOverrides: () => thresholdOverrides,
		setThresholdOverrides: (next: ContextThresholdOverrides | undefined) => { thresholdOverrides = next; },
		readContextThresholdOverrides,
		buildAssessment: (ctx: ExtensionContext) => buildAssessment(ctx, config, thresholdOverrides),
		run: (ctx: ExtensionContext, _reason: ContextWatchHandoffReason) => {
			lastAssessment = buildAssessment(ctx, config, thresholdOverrides);
		},
		readTimeoutPressureState: timeoutPressure.readTimeoutPressureState,
		isReloadRequiredForSourceUpdate,
		clearAutoCompactRetryTimer: () => { autoCompactRetryDueAt = 0; },
		setLastAssessment: (assessment: ContextWatchAssessment | null) => { lastAssessment = assessment; },
		getLastAutoCompactAt: () => lastAutoCompactAt,
		getAutoCompactInFlight: () => autoCompactInFlight,
		getAutoCompactRetryDueAt: () => autoCompactRetryDueAt,
		hasAutoCompactRetryTimer: () => autoCompactRetryDueAt > Date.now(),
		getLastAutoResumeDecision: () => lastAutoResumeDecision,
		getLastAutoResumeAt: () => lastAutoResumeAt,
		getLastSteeringSignal: () => lastSteeringSignal,
		getCompactDeferCount: () => compactDeferCount,
		getCompactDeferWindowStartedAt: () => compactDeferWindowStartedAt,
		getLastAntiParalysisNotifyAt: () => lastAntiParalysisNotifyAt,
		getAntiParalysisNotifyCountInWindow: () => antiParalysisNotifyCountInWindow,
		getAnnouncementsInWindow: () => 0,
		getFinalTurnSuppressionsInWindow: () => 0,
		resetState: () => {
			lastAssessment = null;
			lastAutoCompactAt = 0;
			lastAutoResumeAt = 0;
			lastAutoResumeDecision = null;
			lastSteeringSignal = null;
			autoCompactInFlight = false;
			autoCompactRetryDueAt = 0;
			compactDeferCount = 0;
			compactDeferWindowStartedAt = 0;
			lastAntiParalysisNotifyAt = 0;
			antiParalysisNotifyCountInWindow = 0;
			timeoutPressure.reset();
		},
		applyPreset: (ctx: ExtensionContext, presetInput?: unknown) => buildContextWatchdogApplyPreset(runtime, ctx, presetInput),
		constants: {
			AUTO_COMPACT_RETRY_DELAY_MS: 2_000,
			SIGNAL_NOISE_WINDOW_MS: CONTEXT_WATCHDOG_RUNTIME_CONSTANTS.SIGNAL_NOISE_WINDOW_MS,
			SIGNAL_NOISE_MAX_ANNOUNCEMENTS: CONTEXT_WATCHDOG_RUNTIME_CONSTANTS.SIGNAL_NOISE_MAX_ANNOUNCEMENTS,
			FINAL_TURN_CLOSE_HEADROOM_PCT: CONTEXT_WATCHDOG_RUNTIME_CONSTANTS.FINAL_TURN_CLOSE_HEADROOM_PCT,
			CALM_CLOSE_DEFER_THRESHOLD: CONTEXT_WATCHDOG_RUNTIME_CONSTANTS.CALM_CLOSE_DEFER_THRESHOLD,
			ANTI_PARALYSIS_GRACE_WINDOW_MS: CONTEXT_WATCHDOG_RUNTIME_CONSTANTS.ANTI_PARALYSIS_GRACE_WINDOW_MS,
			ANTI_PARALYSIS_NOTIFY_COOLDOWN_MS: CONTEXT_WATCHDOG_RUNTIME_CONSTANTS.ANTI_PARALYSIS_NOTIFY_COOLDOWN_MS,
			ANTI_PARALYSIS_MAX_NOTIFIES_PER_WINDOW: CONTEXT_WATCHDOG_RUNTIME_CONSTANTS.ANTI_PARALYSIS_MAX_NOTIFIES_PER_WINDOW,
		},
	};

	pi.on("session_start", (_event, ctx) => {
		config = readWatchdogConfig(ctx.cwd);
		thresholdOverrides = readContextThresholdOverrides(ctx.cwd);
		runtimeReloadCwdAtSessionStart = ctx.cwd;
		runtimeReloadMtimeMsAtSessionStart = readContextWatchdogRuntimeReloadMtimeMs(
			ctx.cwd,
			readContextWatchdogSurfacesSourceMtimeMs,
		);
		runtime.resetState(ctx);
	});

	registerContextWatchdogStatusSurface(pi, runtime);
}
