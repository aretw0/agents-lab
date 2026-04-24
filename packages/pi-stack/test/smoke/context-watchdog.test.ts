import { describe, expect, it } from "vitest";
import {
	applyContextWatchBootstrapToSettings,
	applyContextWatchToHandoff,
	applyWarnCadenceEscalation,
	buildAutoCompactDiagnostics,
	buildAutoResumePromptFromHandoff,
	buildContextWatchBootstrapPlan,
	deriveContextWatchThresholds,
	evaluateContextWatch,
	handoffFreshnessAdvice,
	handoffRefreshMode,
	contextWatchEventAgeMs,
	latestContextWatchEvent,
	toAgeSec,
	normalizeContextWatchdogConfig,
	parseContextBootstrapPreset,
	resolveAutoCompactRetryDelayMs,
	resolveAutoResumeDispatchDecision,
	resolveContextWatchOperatingCadence,
	resolveContextWatchOperatorSignal,
	resolveContextWatchSignalNoiseExcessive,
	resolveCheckpointEvidenceReadyForCalmClose,
	resolvePreCompactCalmCloseSignal,
	isAutoCompactDeferralReason,
	resolveHandoffFreshness,
	resolveHandoffPrepDecision,
	summarizeContextWatchEvent,
	shouldAnnounceContextWatch,
	shouldAutoCheckpoint,
	shouldEmitAutoResumeAfterCompact,
	shouldRefreshHandoffBeforeAutoCompact,
	shouldScheduleAutoCompactRetry,
	shouldTriggerAutoCompact,
} from "../../extensions/context-watchdog";

describe("context-watchdog", () => {
	it("normalizes defaults and bounds", () => {
		const cfg = normalizeContextWatchdogConfig({
			checkpointPct: 999,
			compactPct: 0,
			cooldownMs: 1,
			handoffFreshMaxAgeMs: 1,
		});
		expect(cfg.enabled).toBe(true);
		expect(cfg.notify).toBe(true);
		expect(cfg.status).toBe(true);
		expect(cfg.checkpointPct).toBe(99);
		expect(cfg.compactPct).toBe(2);
		expect(cfg.cooldownMs).toBe(60_000);
		expect(cfg.autoCheckpoint).toBe(true);
		expect(cfg.autoCompact).toBe(true);
		expect(cfg.autoCompactCooldownMs).toBe(20 * 60 * 1000);
		expect(cfg.autoCompactRequireIdle).toBe(true);
		expect(cfg.autoResumeAfterCompact).toBe(true);
		expect(cfg.autoResumeCooldownMs).toBe(30_000);
		expect(cfg.handoffFreshMaxAgeMs).toBe(60_000);
	});

	it("derives thresholds from model-aware warning/error with pre-compact headroom", () => {
		const cfg = normalizeContextWatchdogConfig({});
		const tAnthropic = deriveContextWatchThresholds(65, 85, cfg);
		expect(tAnthropic.warnPct).toBe(65);
		expect(tAnthropic.checkpointPct).toBe(78);
		expect(tAnthropic.compactPct).toBe(82);

		const tOpenAi = deriveContextWatchThresholds(50, 75, cfg);
		expect(tOpenAi.warnPct).toBe(50);
		expect(tOpenAi.checkpointPct).toBe(68);
		expect(tOpenAi.compactPct).toBe(72);
	});

	it("respects explicit checkpoint/compact overrides", () => {
		const cfg = normalizeContextWatchdogConfig({ checkpointPct: 70, compactPct: 80 });
		const t = deriveContextWatchThresholds(50, 75, cfg);
		expect(t.warnPct).toBe(50);
		expect(t.checkpointPct).toBe(70);
		expect(t.compactPct).toBe(80);
	});

	it("evaluates levels with checkpoint before compact", () => {
		const thresholds = { warnPct: 60, checkpointPct: 68, compactPct: 72 };
		expect(evaluateContextWatch(59, thresholds).level).toBe("ok");
		expect(evaluateContextWatch(60, thresholds).level).toBe("warn");
		expect(evaluateContextWatch(68, thresholds).level).toBe("checkpoint");
		expect(evaluateContextWatch(72, thresholds).level).toBe("compact");
	});

	it("escalates second warn to checkpoint action for controlled handoff", () => {
		const warn = evaluateContextWatch(60, { warnPct: 50, checkpointPct: 68, compactPct: 72 });
		expect(warn.level).toBe("warn");
		expect(warn.action).toBe("micro-slice-only");

		const firstWarn = applyWarnCadenceEscalation(warn, 1);
		expect(firstWarn.action).toBe("micro-slice-only");
		expect(firstWarn.recommendation).toContain("micro-slices");

		const secondWarn = applyWarnCadenceEscalation(warn, 2);
		expect(secondWarn.action).toBe("write-checkpoint");
		expect(secondWarn.recommendation).toContain("Second warn detected");
		expect(secondWarn.severity).toBe("warning");

		const checkpoint = evaluateContextWatch(68, { warnPct: 50, checkpointPct: 68, compactPct: 72 });
		expect(applyWarnCadenceEscalation(checkpoint, 2).action).toBe("write-checkpoint");
		expect(applyWarnCadenceEscalation(checkpoint, 2).level).toBe("checkpoint");
	});

	it("announces on upward transitions and compact/checkpoint cooldown reminders", () => {
		expect(shouldAnnounceContextWatch(null, "warn", 0, 600_000)).toBe(true);
		expect(shouldAnnounceContextWatch("warn", "warn", 1_000, 600_000)).toBe(false);
		expect(shouldAnnounceContextWatch("warn", "checkpoint", 1_000, 600_000)).toBe(true);
		expect(shouldAnnounceContextWatch("checkpoint", "checkpoint", 601_000, 600_000)).toBe(true);
		expect(shouldAnnounceContextWatch("compact", "compact", 601_000, 600_000)).toBe(true);
		expect(shouldAnnounceContextWatch("compact", "ok", 601_000, 600_000)).toBe(false);
	});

	it("auto-checkpoint/compact gates are deterministic", () => {
		const cfg = normalizeContextWatchdogConfig({
			autoCheckpoint: true,
			autoCompact: true,
			autoCompactCooldownMs: 120_000,
			autoCompactRequireIdle: true,
			cooldownMs: 60_000,
		});
		const compact = evaluateContextWatch(72, { warnPct: 50, checkpointPct: 68, compactPct: 72 });
		const checkpoint = evaluateContextWatch(68, { warnPct: 50, checkpointPct: 68, compactPct: 72 });

		expect(shouldAutoCheckpoint(checkpoint, cfg, 120_000, 0)).toBe(true);
		expect(shouldAutoCheckpoint(checkpoint, cfg, 30_000, 0)).toBe(false);

		expect(shouldTriggerAutoCompact(compact, cfg, {
			nowMs: 200_000,
			lastAutoCompactAt: 0,
			inFlight: false,
			isIdle: true,
			hasPendingMessages: false,
		})).toEqual({ trigger: true, reason: "trigger" });

		expect(shouldTriggerAutoCompact(compact, cfg, {
			nowMs: 30_000,
			lastAutoCompactAt: 0,
			inFlight: false,
			isIdle: true,
			hasPendingMessages: false,
		})).toEqual({ trigger: false, reason: "cooldown" });

		const notIdleDecision = shouldTriggerAutoCompact(compact, cfg, {
			nowMs: 200_000,
			lastAutoCompactAt: 0,
			inFlight: false,
			isIdle: false,
			hasPendingMessages: true,
		});
		expect(notIdleDecision).toEqual({ trigger: false, reason: "not-idle" });
		expect(shouldScheduleAutoCompactRetry(notIdleDecision)).toBe(true);

		const pendingDecision = shouldTriggerAutoCompact(compact, cfg, {
			nowMs: 200_000,
			lastAutoCompactAt: 0,
			inFlight: false,
			isIdle: true,
			hasPendingMessages: true,
		});
		expect(pendingDecision).toEqual({ trigger: false, reason: "pending-messages" });
		expect(shouldScheduleAutoCompactRetry(pendingDecision)).toBe(true);
		expect(shouldScheduleAutoCompactRetry({ trigger: false, reason: "cooldown" })).toBe(false);
		expect(resolveAutoCompactRetryDelayMs(
			{ trigger: false, reason: "cooldown" },
			{ nowMs: 30_000, lastAutoCompactAt: 0 },
			cfg,
			2_000,
		)).toBe(90_000);

		const diag = buildAutoCompactDiagnostics(compact, cfg, {
			nowMs: 200_000,
			lastAutoCompactAt: 0,
			inFlight: false,
			isIdle: false,
			hasPendingMessages: true,
		});
		expect(diag.decision.reason).toBe("not-idle");
		expect(diag.retryRecommended).toBe(true);
		expect(diag.retryDelayMs).toBe(2_000);

		expect(shouldEmitAutoResumeAfterCompact(cfg, 40_000, 0)).toBe(true);
		expect(shouldEmitAutoResumeAfterCompact(cfg, 10_000, 0)).toBe(false);
		expect(resolveAutoResumeDispatchDecision({
			autoResumeReady: true,
			hasPendingMessages: false,
			hasRecentSteerInput: false,
			queuedLaneIntents: 0,
		})).toEqual({ shouldDispatch: true, reason: "send" });
		expect(resolveAutoResumeDispatchDecision({
			autoResumeReady: true,
			hasPendingMessages: true,
			hasRecentSteerInput: false,
			queuedLaneIntents: 0,
		})).toEqual({ shouldDispatch: false, reason: "pending-messages" });
		expect(resolveAutoResumeDispatchDecision({
			autoResumeReady: true,
			hasPendingMessages: false,
			hasRecentSteerInput: true,
			queuedLaneIntents: 0,
		})).toEqual({ shouldDispatch: false, reason: "recent-steer" });
		expect(resolveAutoResumeDispatchDecision({
			autoResumeReady: true,
			hasPendingMessages: false,
			hasRecentSteerInput: false,
			queuedLaneIntents: 2,
		})).toEqual({ shouldDispatch: false, reason: "lane-queue-pending" });
		expect(shouldRefreshHandoffBeforeAutoCompact(compact, cfg)).toBe(true);
		expect(shouldRefreshHandoffBeforeAutoCompact(compact, cfg, "fresh")).toBe(false);
		expect(shouldRefreshHandoffBeforeAutoCompact(compact, cfg, "stale")).toBe(true);
		expect(resolveHandoffPrepDecision(compact, cfg, "fresh").reason).toBe("fresh");
		expect(resolveHandoffPrepDecision(compact, cfg, "stale").reason).toBe("stale");
		expect(shouldRefreshHandoffBeforeAutoCompact(checkpoint, cfg)).toBe(false);
	});

	it("exposes calm-close readiness and anti-paralysis signal deterministically", () => {
		expect(isAutoCompactDeferralReason("not-idle")).toBe(true);
		expect(isAutoCompactDeferralReason("cooldown")).toBe(true);
		expect(isAutoCompactDeferralReason("trigger")).toBe(false);

		expect(resolveCheckpointEvidenceReadyForCalmClose({
			handoffLastEventLevel: "checkpoint",
			handoffLastEventAgeMs: 20_000,
			maxCheckpointAgeMs: 60_000,
		})).toBe(true);
		expect(resolveCheckpointEvidenceReadyForCalmClose({
			handoffLastEventLevel: "warn",
			handoffLastEventAgeMs: 20_000,
			maxCheckpointAgeMs: 60_000,
		})).toBe(false);
		expect(resolveCheckpointEvidenceReadyForCalmClose({
			handoffLastEventLevel: "checkpoint",
			handoffLastEventAgeMs: 120_000,
			maxCheckpointAgeMs: 60_000,
		})).toBe(false);

		const ready = resolvePreCompactCalmCloseSignal({
			assessmentLevel: "compact",
			decisionReason: "not-idle",
			checkpointEvidenceReady: true,
			deferCount: 2,
			deferThreshold: 3,
		});
		expect(ready.calmCloseReady).toBe(true);
		expect(ready.antiParalysisTriggered).toBe(false);
		expect(ready.deferCount).toBe(2);

		const antiParalysis = resolvePreCompactCalmCloseSignal({
			assessmentLevel: "compact",
			decisionReason: "pending-messages",
			checkpointEvidenceReady: true,
			deferCount: 3,
			deferThreshold: 3,
		});
		expect(antiParalysis.antiParalysisTriggered).toBe(true);
		expect(antiParalysis.recommendation).toContain("anti-paralysis");
		const nonCompact = resolvePreCompactCalmCloseSignal({
			assessmentLevel: "ok",
			decisionReason: "level-not-compact",
			checkpointEvidenceReady: false,
			deferCount: 0,
		});
		expect(nonCompact.calmCloseReady).toBe(false);
	});

	it("builds portable bootstrap plans for control-plane and worker presets", () => {
		expect(parseContextBootstrapPreset(undefined)).toBe("control-plane");
		expect(parseContextBootstrapPreset("agent-worker")).toBe("agent-worker");

		const control = buildContextWatchBootstrapPlan("control-plane");
		expect(control.preset).toBe("control-plane");
		expect((control.patch.piStack as any).contextWatchdog.checkpointPct).toBe(68);
		expect((control.patch.piStack as any).contextWatchdog.compactPct).toBe(72);
		expect((control.patch.piStack as any).contextWatchdog.notify).toBe(true);
		expect((control.patch.piStack as any).contextWatchdog.autoCompact).toBe(true);
		expect((control.patch.piStack as any).contextWatchdog.autoResumeAfterCompact).toBe(true);
		expect((control.patch.piStack as any).contextWatchdog.handoffFreshMaxAgeMs).toBe(30 * 60 * 1000);

		const worker = buildContextWatchBootstrapPlan("agent-worker");
		expect(worker.preset).toBe("agent-worker");
		expect((worker.patch.piStack as any).contextWatchdog.checkpointPct).toBe(72);
		expect((worker.patch.piStack as any).contextWatchdog.compactPct).toBe(78);
		expect((worker.patch.piStack as any).contextWatchdog.notify).toBe(false);
		expect((worker.patch.piStack as any).contextWatchdog.autoCompact).toBe(false);
		expect((worker.patch.piStack as any).contextWatchdog.autoResumeAfterCompact).toBe(false);
		expect((worker.patch.piStack as any).contextWatchdog.handoffFreshMaxAgeMs).toBe(30 * 60 * 1000);
	});

	it("applies bootstrap patch without clobbering unrelated settings", () => {
		const base = {
			piStack: {
				quotaVisibility: {
					routeModelRefs: { "openai-codex": "openai-codex/gpt-5.3-codex" },
				},
			},
		} as Record<string, unknown>;
		const merged = applyContextWatchBootstrapToSettings(base, "agent-worker");
		expect(merged.preset).toBe("agent-worker");
		expect(((merged.settings.piStack as any).contextWatchdog.notify)).toBe(false);
		expect(((merged.settings.piStack as any).quotaVisibility.routeModelRefs["openai-codex"]))
			.toBe("openai-codex/gpt-5.3-codex");
	});

	it("builds execution-focused auto-resume prompt from handoff snapshot", () => {
		const nowMs = Date.parse("2026-04-21T20:30:00.000Z");
		const prompt = buildAutoResumePromptFromHandoff({
			timestamp: "2026-04-21T20:20:00.000Z",
			current_tasks: ["TASK-BUD-084", "TASK-BUD-018"],
			blockers: ["context-watch-compact-required", "infra-wait"],
			next_actions: [
				"Context-watch action: level=compact 72% (compact-now)",
				"Consolidar TASK-BUD-084 com micro-slice final",
			],
			context_watch_events: [{ level: "compact" }],
		} as any, 5 * 60 * 1000, nowMs);
		expect(prompt).toContain("auto-resume: continue from .project/handoff.json");
		expect(prompt).toContain("ts=2026-04-21T20:20:00.000Z");
		expect(prompt).toContain("TASK-BUD-084, TASK-BUD-018");
		expect(prompt).toContain("blockers: infra-wait");
		expect(prompt).toContain("Consolidar TASK-BUD-084");
		expect(prompt).toContain("execution: prioritize latest user steering/follow-up");
		expect(prompt).not.toContain("Context-watch action:");
		expect(prompt).not.toContain("freshness=");
		expect(prompt).not.toContain("Cadence:");

		const unknownPrompt = buildAutoResumePromptFromHandoff({ current_tasks: [] } as any, 5 * 60 * 1000, nowMs);
		expect(unknownPrompt).toContain("focusTasks: none-listed");
	});

	it("resume prompt stays execution-focused even when context events are present", () => {
		const nowMs = Date.parse("2026-04-21T20:30:00.000Z");
		const prompt = buildAutoResumePromptFromHandoff({
			timestamp: "2026-04-21T20:29:00.000Z",
			context_watch_events: [
				{ level: "checkpoint" },
				{ level: "ok" },
			],
		} as any, 5 * 60 * 1000, nowMs);
		expect(prompt).toContain("auto-resume: continue from .project/handoff.json");
		expect(prompt).not.toContain("Cadence:");
		expect(prompt).not.toContain("context already healthy");
	});

	it("emits operator signal for manual intervention/reload steering", () => {
		const none = resolveContextWatchOperatorSignal({
			reloadRequired: false,
			handoffManualRefreshRequired: false,
		});
		expect(none.humanActionRequired).toBe(false);
		expect(none.reasons).toEqual([]);
		expect(none.noiseExcessive).toBe(false);

		const manual = resolveContextWatchOperatorSignal({
			reloadRequired: false,
			handoffManualRefreshRequired: true,
		});
		expect(manual.humanActionRequired).toBe(true);
		expect(manual.reloadRequired).toBe(false);
		expect(manual.reasons).toContain("handoff-refresh-required");

		const reload = resolveContextWatchOperatorSignal({
			reloadRequired: true,
			handoffManualRefreshRequired: false,
		});
		expect(reload.humanActionRequired).toBe(true);
		expect(reload.reasons).toContain("reload-required");

		expect(resolveContextWatchSignalNoiseExcessive(4, 4)).toBe(false);
		expect(resolveContextWatchSignalNoiseExcessive(5, 4)).toBe(true);
		const noisy = resolveContextWatchOperatorSignal({
			reloadRequired: false,
			handoffManualRefreshRequired: false,
			signalNoiseExcessive: true,
		});
		expect(noisy.humanActionRequired).toBe(true);
		expect(noisy.noiseExcessive).toBe(true);
		expect(noisy.reasons).toContain("signal-noise-excessive");
	});

	it("resolves operating cadence with post-resume recalibration signal", () => {
		expect(resolveContextWatchOperatingCadence({
			assessmentLevel: "warn",
			handoffLastEventLevel: "compact",
		})).toEqual({
			operatingCadence: "micro-slice-only",
			postResumeRecalibrated: false,
			reason: "level-warn",
		});

		expect(resolveContextWatchOperatingCadence({
			assessmentLevel: "ok",
			handoffLastEventLevel: "compact",
		})).toEqual({
			operatingCadence: "standard-slices",
			postResumeRecalibrated: true,
			reason: "recalibrated-from-compact",
		});

		expect(resolveContextWatchOperatingCadence({
			assessmentLevel: "ok",
			handoffLastEventLevel: "ok",
		})).toEqual({
			operatingCadence: "standard-slices",
			postResumeRecalibrated: false,
			reason: "healthy",
		});
	});

	it("computes handoff freshness deterministically", () => {
		const nowMs = Date.parse("2026-04-21T20:30:00.000Z");
		expect(resolveHandoffFreshness(undefined, nowMs).label).toBe("unknown");
		expect(resolveHandoffFreshness("invalid", nowMs).label).toBe("unknown");
		const fresh = resolveHandoffFreshness("2026-04-21T20:20:00.000Z", nowMs, 15 * 60 * 1000);
		expect(fresh.label).toBe("fresh");
		expect(fresh.ageMs).toBe(600_000);
		const stale = resolveHandoffFreshness("2026-04-21T19:20:00.000Z", nowMs, 15 * 60 * 1000);
		expect(stale.label).toBe("stale");

		expect(handoffRefreshMode("fresh", true)).toBe("none");
		expect(handoffRefreshMode("unknown", true)).toBe("unknown");
		expect(handoffRefreshMode("stale", true)).toBe("auto-on-compact");
		expect(handoffRefreshMode("stale", false)).toBe("manual");
		expect(handoffFreshnessAdvice("fresh", true)).toContain("fresh");
		expect(handoffFreshnessAdvice("unknown", true)).toContain("unavailable");
		expect(handoffFreshnessAdvice("stale", true)).toContain("auto-refresh");
		expect(handoffFreshnessAdvice("stale", false)).toContain("refresh checkpoint");
	});

	it("writes canonical action/event trail into handoff snapshot", () => {
		const assessment = evaluateContextWatch(69, {
			warnPct: 50,
			checkpointPct: 68,
			compactPct: 72,
		});
		const next = applyContextWatchToHandoff(
			{
				context: "ongoing",
				next_actions: ["keep lane"],
				blockers: ["infra-wait"],
			},
			assessment,
			"message_end",
			"2026-04-21T21:30:00.000Z",
		) as any;

		const prep = applyContextWatchToHandoff(
			next,
			assessment,
			"auto_compact_prep",
			"2026-04-21T21:31:00.000Z",
		) as any;

		expect(next.timestamp).toBe("2026-04-21T21:30:00.000Z");
		expect(next.next_actions[0]).toContain("Context-watch action:");
		expect(next.next_actions[0]).toContain("checkpoint");
		expect(next.blockers).toContain("context-watch-checkpoint-required");
		expect(Array.isArray(next.context_watch_events)).toBe(true);
		expect(next.context_watch_events.at(-1).action).toBe("write-checkpoint");
		expect(prep.context_watch_events.at(-1).reason).toBe("auto_compact_prep");
		expect(latestContextWatchEvent(prep)?.reason).toBe("auto_compact_prep");
		expect(summarizeContextWatchEvent(latestContextWatchEvent(prep))).toContain("auto_compact_prep");
		expect(contextWatchEventAgeMs(latestContextWatchEvent(prep), Date.parse("2026-04-21T21:31:10.000Z"))).toBe(10_000);
		expect(toAgeSec(10_000)).toBe(10);
		expect(toAgeSec(undefined)).toBeUndefined();
		expect(contextWatchEventAgeMs({ atIso: "bad-ts" } as any)).toBeUndefined();
		expect(summarizeContextWatchEvent(latestContextWatchEvent({}))).toBe("none");
		expect(latestContextWatchEvent({})?.reason).toBeUndefined();
	});

	it("cleans old context-watch blockers when level returns to ok", () => {
		const assessment = evaluateContextWatch(20, {
			warnPct: 50,
			checkpointPct: 68,
			compactPct: 72,
		});
		const next = applyContextWatchToHandoff(
			{
				context: "ongoing",
				next_actions: ["Context-watch action: level=warn 55% (micro-slice-only)"],
				blockers: ["context-watch-warn-active", "other-blocker"],
				context_watch_events: [],
			},
			assessment,
			"message_end",
			"2026-04-21T21:31:00.000Z",
		) as any;

		expect(next.next_actions).toBeUndefined();
		expect(next.blockers).toContain("other-blocker");
		expect(next.blockers.some((line: string) => String(line).startsWith("context-watch-")))
			.toBe(false);
	});
});
