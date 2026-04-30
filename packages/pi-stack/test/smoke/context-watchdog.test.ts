import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import contextWatchdogExtension, {
	applyContextWatchBootstrapToSettings,
	applyContextWatchToHandoff,
	applyWarnCadenceEscalation,
	assessLocalSliceHandoffBudget,
	buildAutoCompactDiagnostics,
	buildAutoResumePromptEnvelopeFromHandoff,
	buildAutoResumePromptFromHandoff,
	buildContextWatchBootstrapPlan,
	buildLocalSliceHandoffCheckpoint,
	LOCAL_SLICE_HANDOFF_MAX_JSON_CHARS,
	deriveContextWatchThresholds,
	evaluateContextWatch,
	formatContextWatchStatusToolSummary,
	formatContextWatchAutoResumePreviewSummary,
	formatContextWatchContinuationReadinessSummary,
	formatContextWatchOneSliceCanaryPreviewSummary,
	formatContextWatchCommandStatusSummary,
	formatContextWatchDeterministicStopSummary,
	formatContextWatchSteeringStatus,
	handoffFreshnessAdvice,
	handoffRefreshMode,
	contextWatchEventAgeMs,
	latestContextWatchEvent,
	resolveCompactCheckpointPersistence,
	toAgeSec,
	normalizeContextWatchdogConfig,
	parseContextBootstrapPreset,
	resolveAutoCompactCheckpointGate,
	resolveAutoCompactEffectiveIdle,
	resolveAutoCompactRetryDelayMs,
	describeAutoResumeDispatchReason,
	describeAutoResumeDispatchHint,
	shouldNotifyAutoResumeSuppression,
	summarizeAutoResumePromptDiagnostics,
	resolveAutoResumeDispatchDecision,
	resolveContextWatchOperatingCadence,
	resolveContextWatchOperatorSignal,
	resolveContextWatchDeterministicStopSignal,
	describeContextWatchDeterministicStopHint,
	resolveContextWatchOperatorActionPlan,
	resolveContextWatchSignalNoiseExcessive,
	shouldEmitDeterministicStopSignal,
	resolveContextWatchSteeringDispatch,
	resolveCheckpointEvidenceReadyForCalmClose,
	resolvePreCompactCalmCloseSignal,
	resolveProgressPreservationSignal,
	summarizeProgressPreservationSignal,
	resolveContextEconomySignal,
	summarizeContextEconomySignal,
	resolveAntiParalysisDispatch,
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
	writeLocalSliceHandoffCheckpoint,
} from "../../extensions/context-watchdog";

describe("context-watchdog", () => {
	function makeMockPi() {
		return {
			on: vi.fn(),
			registerTool: vi.fn(),
			registerCommand: vi.fn(),
		} as unknown as Parameters<typeof contextWatchdogExtension>[0];
	}

	function getTool(pi: ReturnType<typeof makeMockPi>, name: string) {
		const call = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(
			([tool]) => tool?.name === name,
		);
		if (!call) throw new Error(`tool not found: ${name}`);
		return call[0] as {
			execute: (
				toolCallId: string,
				params: Record<string, unknown>,
				signal: AbortSignal,
				onUpdate: (update: unknown) => void,
				ctx: { cwd: string },
			) => Promise<{ content?: Array<{ text?: string }>; details?: Record<string, unknown> }>;
		};
	}

	it("normalizes defaults and bounds", () => {
		const cfg = normalizeContextWatchdogConfig({
			checkpointPct: 999,
			compactPct: 0,
			cooldownMs: 1,
			handoffFreshMaxAgeMs: 1,
		});
		expect(cfg.enabled).toBe(true);
		expect(cfg.notify).toBe(true);
		expect(cfg.modelSteeringFromLevel).toBe("compact");
		expect(cfg.userNotifyFromLevel).toBe("compact");
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

	it("normalizes steering threshold fields and prevents contradictory ordering", () => {
		const cfg = normalizeContextWatchdogConfig({
			modelSteeringFromLevel: "checkpoint",
			userNotifyFromLevel: "warn",
		});
		expect(cfg.modelSteeringFromLevel).toBe("checkpoint");
		expect(cfg.userNotifyFromLevel).toBe("checkpoint");
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

	it("formats passive warn steering without soft-stopping work", () => {
		expect(formatContextWatchSteeringStatus({
			level: "warn",
			action: "continue-bounded",
			recommendation: "Continue normal bounded work; avoid broad scans and prepare to checkpoint at the checkpoint threshold.",
		})).toContain("[ctx-steer] warn · action=continue-bounded");
	});

	it("keeps warn as steering and reserves checkpoint actions for checkpoint/compact lanes", () => {
		const warn = evaluateContextWatch(60, { warnPct: 50, checkpointPct: 68, compactPct: 72 });
		expect(warn.level).toBe("warn");
		expect(warn.action).toBe("continue-bounded");

		const firstWarn = applyWarnCadenceEscalation(warn, 1);
		expect(firstWarn.action).toBe("continue-bounded");
		expect(firstWarn.recommendation).toContain("bounded work");

		const secondWarn = applyWarnCadenceEscalation(warn, 2);
		expect(secondWarn.action).toBe("continue-bounded");
		expect(secondWarn.recommendation).toContain("checkpoint threshold");
		expect(secondWarn.severity).toBe("info");

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
			nowMs: 200_000,
			lastAutoCompactAt: 0,
			inFlight: false,
			isIdle: true,
			hasPendingMessages: false,
			checkpointEvidenceReady: false,
		})).toEqual({ trigger: false, reason: "checkpoint-evidence-missing" });

		expect(buildAutoCompactDiagnostics(compact, cfg, {
			nowMs: 200_000,
			lastAutoCompactAt: 0,
			inFlight: false,
			isIdle: true,
			hasPendingMessages: false,
			checkpointEvidenceReady: false,
		}).decision).toEqual({ trigger: false, reason: "checkpoint-evidence-missing" });

		expect(resolveAutoCompactCheckpointGate({
			handoffPath: ".project/handoff.json",
			checkpointEvidenceReady: false,
		})).toEqual({ proceed: true, reason: "checkpoint-written" });
		expect(resolveAutoCompactCheckpointGate({
			checkpointEvidenceReady: true,
		})).toEqual({ proceed: true, reason: "checkpoint-ready" });
		expect(resolveAutoCompactCheckpointGate({
			checkpointEvidenceReady: false,
		})).toEqual({ proceed: false, reason: "checkpoint-evidence-missing" });

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
		expect(diag.idle).toEqual({
			observedIdle: false,
			effectiveIdle: false,
			hasPendingMessages: true,
			eligibleByMessageEnd: false,
		});

		expect(resolveAutoCompactEffectiveIdle({
			autoCompactRequireIdle: true,
			reason: "message_end",
			isIdle: false,
			hasPendingMessages: false,
		})).toEqual({
			observedIdle: false,
			effectiveIdle: true,
			hasPendingMessages: false,
			eligibleByMessageEnd: true,
		});

		const messageEndDiag = buildAutoCompactDiagnostics(compact, cfg, {
			nowMs: 200_000,
			lastAutoCompactAt: 0,
			inFlight: false,
			isIdle: false,
			hasPendingMessages: false,
			reason: "message_end",
		});
		expect(messageEndDiag.decision).toEqual({ trigger: true, reason: "trigger" });
		expect(messageEndDiag.idle.eligibleByMessageEnd).toBe(true);
		expect(resolveCompactCheckpointPersistence({
			assessmentLevel: "compact",
			handoffLastEventLevel: "warn",
			handoffLastEventAgeMs: 20_000,
			maxCheckpointAgeMs: 60_000,
		})).toEqual({ shouldPersist: true, reason: "missing-compact-event" });
		expect(resolveCompactCheckpointPersistence({
			assessmentLevel: "compact",
			handoffLastEventLevel: "compact",
			handoffLastEventAgeMs: 120_000,
			maxCheckpointAgeMs: 60_000,
		})).toEqual({ shouldPersist: true, reason: "stale-compact-event" });
		expect(resolveCompactCheckpointPersistence({
			assessmentLevel: "compact",
			handoffLastEventLevel: "compact",
			handoffLastEventAgeMs: 20_000,
			maxCheckpointAgeMs: 60_000,
		})).toEqual({ shouldPersist: false, reason: "compact-event-fresh" });
		expect(resolveCompactCheckpointPersistence({
			assessmentLevel: "warn",
			handoffLastEventLevel: "compact",
			handoffLastEventAgeMs: 20_000,
			maxCheckpointAgeMs: 60_000,
		})).toEqual({ shouldPersist: false, reason: "level-not-compact" });
		expect(resolveCompactCheckpointPersistence({
			enabled: false,
			assessmentLevel: "compact",
			handoffLastEventLevel: "warn",
			handoffLastEventAgeMs: 120_000,
			maxCheckpointAgeMs: 60_000,
		})).toEqual({ shouldPersist: false, reason: "disabled" });

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
			reloadRequired: true,
			hasPendingMessages: false,
			hasRecentSteerInput: false,
			queuedLaneIntents: 0,
		})).toEqual({ shouldDispatch: false, reason: "reload-required" });
		expect(resolveAutoResumeDispatchDecision({
			autoResumeReady: true,
			checkpointEvidenceReady: false,
			hasPendingMessages: false,
			hasRecentSteerInput: false,
			queuedLaneIntents: 0,
		})).toEqual({ shouldDispatch: false, reason: "checkpoint-evidence-missing" });
		expect(describeAutoResumeDispatchReason("send")).toBe("dispatched");
		expect(describeAutoResumeDispatchReason("reload-required")).toContain("reload-required");
		expect(describeAutoResumeDispatchReason("checkpoint-evidence-missing")).toContain("checkpoint-evidence-missing");
		expect(describeAutoResumeDispatchHint("send")).toBeUndefined();
		expect(describeAutoResumeDispatchHint("reload-required")).toContain("/reload");
		expect(describeAutoResumeDispatchHint("checkpoint-evidence-missing")).toContain("checkpoint");
		expect(shouldNotifyAutoResumeSuppression("send")).toBe(false);
		expect(shouldNotifyAutoResumeSuppression("checkpoint-evidence-missing")).toBe(true);
		expect(shouldNotifyAutoResumeSuppression("reload-required")).toBe(true);
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
		expect(describeAutoResumeDispatchReason("recent-steer")).toContain("recent-steer");
		expect(describeAutoResumeDispatchReason("pending-messages")).toContain("pending-messages");
		expect(describeAutoResumeDispatchReason("lane-queue-pending")).toContain("lane-queue-pending");
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

	it("surfaces progress-preservation assurance without noisy notification", () => {
		const freshCheckpoint = resolveProgressPreservationSignal({
			assessmentLevel: "compact",
			handoffFreshnessLabel: "fresh",
			checkpointEvidenceReady: true,
			compactCheckpointPersistRecommended: false,
			autoResumeEnabled: true,
		});
		expect(freshCheckpoint).toMatchObject({
			status: "ready",
			progressSaved: true,
			compactCheckpointReady: true,
		});

		const compactAutoPersist = resolveProgressPreservationSignal({
			assessmentLevel: "compact",
			handoffFreshnessLabel: "fresh",
			checkpointEvidenceReady: false,
			compactCheckpointPersistRecommended: true,
			autoResumeEnabled: true,
		});
		expect(compactAutoPersist).toMatchObject({
			status: "will-auto-persist",
			progressSaved: true,
			compactCheckpointReady: true,
		});

		const freshHandoff = resolveProgressPreservationSignal({
			assessmentLevel: "warn",
			handoffFreshnessLabel: "fresh",
			checkpointEvidenceReady: false,
			compactCheckpointPersistRecommended: false,
			autoResumeEnabled: true,
		});
		expect(freshHandoff).toMatchObject({
			status: "fresh-handoff",
			progressSaved: true,
			compactCheckpointReady: false,
		});
		expect(summarizeProgressPreservationSignal(freshHandoff)).toContain("saved=yes");

		expect(resolveProgressPreservationSignal({
			assessmentLevel: "checkpoint",
			handoffFreshnessLabel: "stale",
			checkpointEvidenceReady: false,
			compactCheckpointPersistRecommended: false,
			autoResumeEnabled: true,
		}).status).toBe("needs-checkpoint");
	});

	it("surfaces passive context-economy opportunities without compact triggers", () => {
		const nextActions = resolveContextEconomySignal({
			handoffBytes: 1_200,
			nextActionCount: 3,
			autoResumeDroppedNextActions: 2,
		});
		expect(nextActions).toMatchObject({
			passive: true,
			kind: "next-actions-truncated",
			opportunity: true,
			severity: "info",
		});
		expect(nextActions.recommendation).toContain("consolidate");

		const largeHandoff = resolveContextEconomySignal({ handoffBytes: 8_500, nextActionCount: 2 });
		expect(largeHandoff.kind).toBe("large-handoff");
		expect(summarizeContextEconomySignal(largeHandoff)).toContain("opportunity=yes");

		const none = resolveContextEconomySignal({ handoffBytes: 1_000, nextActionCount: 2 });
		expect(none).toMatchObject({
			kind: "none",
			opportunity: false,
			severity: "none",
		});
	});

	it("gates anti-paralysis warning with grace/cooldown and window cap", () => {
		expect(resolveAntiParalysisDispatch({
			triggered: true,
			nowMs: 100_000,
			deferWindowStartedAtMs: 80_000,
			graceWindowMs: 60_000,
			lastNotifyAtMs: 0,
			notifyCooldownMs: 300_000,
			notifiesInWindow: 0,
			maxNotifiesPerWindow: 1,
		})).toMatchObject({
			shouldNotify: false,
			reason: "grace-window",
		});

		expect(resolveAntiParalysisDispatch({
			triggered: true,
			nowMs: 180_000,
			deferWindowStartedAtMs: 80_000,
			graceWindowMs: 60_000,
			lastNotifyAtMs: 0,
			notifyCooldownMs: 300_000,
			notifiesInWindow: 0,
			maxNotifiesPerWindow: 1,
		})).toEqual({
			shouldNotify: true,
			reason: "emit",
		});

		expect(resolveAntiParalysisDispatch({
			triggered: true,
			nowMs: 220_000,
			deferWindowStartedAtMs: 80_000,
			graceWindowMs: 60_000,
			lastNotifyAtMs: 180_000,
			notifyCooldownMs: 300_000,
			notifiesInWindow: 1,
			maxNotifiesPerWindow: 2,
		})).toMatchObject({
			shouldNotify: false,
			reason: "cooldown",
		});

		expect(resolveAntiParalysisDispatch({
			triggered: true,
			nowMs: 700_000,
			deferWindowStartedAtMs: 80_000,
			graceWindowMs: 60_000,
			lastNotifyAtMs: 180_000,
			notifyCooldownMs: 300_000,
			notifiesInWindow: 2,
			maxNotifiesPerWindow: 2,
		})).toEqual({
			shouldNotify: false,
			reason: "max-notifies-reached",
		});
	});

	it("builds portable bootstrap plans for control-plane and worker presets", () => {
		expect(parseContextBootstrapPreset(undefined)).toBe("control-plane");
		expect(parseContextBootstrapPreset("agent-worker")).toBe("agent-worker");

		const control = buildContextWatchBootstrapPlan("control-plane");
		expect(control.preset).toBe("control-plane");
		expect((control.patch.piStack as any).contextWatchdog.checkpointPct).toBe(68);
		expect((control.patch.piStack as any).contextWatchdog.compactPct).toBe(72);
		expect((control.patch.piStack as any).contextWatchdog.notify).toBe(true);
		expect((control.patch.piStack as any).contextWatchdog.modelSteeringFromLevel).toBe("compact");
		expect((control.patch.piStack as any).contextWatchdog.userNotifyFromLevel).toBe("compact");
		expect((control.patch.piStack as any).contextWatchdog.autoCompact).toBe(true);
		expect((control.patch.piStack as any).contextWatchdog.autoResumeAfterCompact).toBe(true);
		expect((control.patch.piStack as any).contextWatchdog.handoffFreshMaxAgeMs).toBe(30 * 60 * 1000);

		const worker = buildContextWatchBootstrapPlan("agent-worker");
		expect(worker.preset).toBe("agent-worker");
		expect((worker.patch.piStack as any).contextWatchdog.checkpointPct).toBe(72);
		expect((worker.patch.piStack as any).contextWatchdog.compactPct).toBe(78);
		expect((worker.patch.piStack as any).contextWatchdog.notify).toBe(false);
		expect((worker.patch.piStack as any).contextWatchdog.modelSteeringFromLevel).toBe("compact");
		expect((worker.patch.piStack as any).contextWatchdog.userNotifyFromLevel).toBe("compact");
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
		expect(prompt).toContain("policy: latest user steering wins");
		expect(prompt).not.toContain("Context-watch action:");
		expect(prompt).not.toContain("freshness=");
		expect(prompt).not.toContain("Cadence:");

		const unknownPrompt = buildAutoResumePromptFromHandoff({ current_tasks: [] } as any, 5 * 60 * 1000, nowMs);
		expect(unknownPrompt).toContain("focusTasks: none-listed");
		expect(unknownPrompt).not.toContain("blockers: none");
		expect(unknownPrompt).not.toContain("next: keep current lane intent");
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

	it("normalizes formatting artifacts and uses explicit truncation markers", () => {
		const prompt = buildAutoResumePromptFromHandoff({
			current_tasks: ["`TASK-BUD-150`", "- TASK-BUD-150"],
			blockers: ["strange | blocker ... with compacted tail"],
			next_actions: [
				"1) \"Action with markdown `code` and newline\nsegment and very long payload \"" + "x".repeat(220),
				"next: run focused slice",
			],
		} as any);
		expect(prompt).toContain("focusTasks: TASK-BUD-150");
		expect(prompt).not.toContain("TASK-BUD-150, TASK-BUD-150");
		expect(prompt).toContain("blockers: strange / blocker [ellipsis] with compacted tail");
		expect(prompt).toContain("[truncated:+");
		expect(prompt).toContain("[snip]");
		expect(prompt).toContain("run focused slice");
		expect(prompt).not.toContain("next: next:");
		expect(prompt).not.toContain("execution:");
		expect(prompt).not.toContain("...");
		expect(prompt).not.toContain("…");
	});

	it("keeps medium command next-actions readable without opaque truncation", () => {
		const prompt = buildAutoResumePromptFromHandoff({
			next_actions: [
				"Validação opcional pós-reload executada em smoke: cmd.exe /c npx vitest run packages/pi-stack/test/smoke/guardrails-long-run-intent-queue.test.ts => 38/38 passed",
			],
		} as any);
		expect(prompt).toContain("cmd.exe /c npx vitest run packages/pi-stack/test/smoke/guardrails-long-run-intent-queue.test.ts");
		expect(prompt).toContain("38/38 passed");
		expect(prompt).not.toContain("[truncated:+");
		expect(prompt).not.toContain("[snip]");
	});

	it("preserves tail context when truncating very long next actions", () => {
		const prompt = buildAutoResumePromptFromHandoff({
			next_actions: [
				"Validação opcional pós-reload executada em smoke: cmd.exe /c npx vitest run packages/pi-stack/test/smoke/guardrails-long-run-intent-queue.test.ts com telemetry completa e sem regressão operacional " + "x".repeat(260) + " => 38/38 passed",
			],
		} as any);
		expect(prompt).toContain("[snip]");
		expect(prompt).toContain("38/38 passed");
		expect(prompt).toContain("[truncated:+");
	});

	it("omits completed stale focus tasks from auto-resume prompt when statuses are known", () => {
		const prompt = buildAutoResumePromptFromHandoff({
			current_tasks: ["TASK-BUD-305"],
			next_actions: [
				"improve expected-path calculation for TASK-BUD-306",
			],
		} as any, 5 * 60 * 1000, Date.parse("2026-04-30T05:20:00.000Z"), {
			taskStatusById: {
				"TASK-BUD-305": "completed",
				"TASK-BUD-306": "planned",
			},
		});
		expect(prompt).toContain("focusTasks: TASK-BUD-306");
		expect(prompt).toContain("staleFocus: TASK-BUD-305=completed");
		expect(prompt).not.toContain("focusTasks: TASK-BUD-305");
		expect(prompt).toContain("policy: latest user steering wins");
		const envelope = buildAutoResumePromptEnvelopeFromHandoff({
			current_tasks: ["TASK-BUD-305"],
			next_actions: ["improve expected-path calculation for TASK-BUD-306"],
		} as any, 5 * 60 * 1000, Date.parse("2026-04-30T05:20:00.000Z"), {
			taskStatusById: { "TASK-BUD-305": "completed", "TASK-BUD-306": "planned" },
		});
		expect(summarizeAutoResumePromptDiagnostics(envelope.diagnostics)).toContain("staleFocus=1");
		expect(summarizeAutoResumePromptDiagnostics({
			...envelope.diagnostics,
			staleFocusTasks: undefined,
		})).not.toContain("staleFocus=");
		const repeatedStale = buildAutoResumePromptFromHandoff({
			current_tasks: ["TASK-BUD-305"],
			next_actions: ["after reload validate TASK-BUD-305 only"],
		} as any, 5 * 60 * 1000, Date.parse("2026-04-30T05:20:00.000Z"), {
			taskStatusById: { "TASK-BUD-305": "completed" },
		});
		expect(repeatedStale).toContain("focusTasks: none-listed");
		expect(repeatedStale).toContain("staleFocus: TASK-BUD-305=completed");
		expect(repeatedStale).not.toContain("focusTasks: TASK-BUD-305");
		const completedOnly = buildAutoResumePromptEnvelopeFromHandoff({
			completed_tasks: ["TASK-BUD-314"],
			next_actions: ["continue after validating TASK-BUD-314 checkpoint behavior"],
			context: "TASK-BUD-314 completed checkpoint focus validation",
		} as any);
		expect(completedOnly.prompt).toContain("focusTasks: none-listed");
		expect(completedOnly.prompt).toContain("staleFocus: TASK-BUD-314=completed");
		expect(completedOnly.prompt).not.toContain("focusTasks: TASK-BUD-314");
		expect(summarizeAutoResumePromptDiagnostics(completedOnly.diagnostics)).toContain("staleFocus=1");
	});

	it("derives focusTasks from next_actions when current_tasks are missing", () => {
		const prompt = buildAutoResumePromptFromHandoff({
			next_actions: [
				"Retomar lane principal TASK-BUD-119 depois do reload",
				"Pendências de decisão humana permanecem: TASK-BUD-115, TASK-BUD-112",
			],
		} as any);
		expect(prompt).toContain("focusTasks: TASK-BUD-119, TASK-BUD-115, TASK-BUD-112");
	});

	it("keeps autonomy lane focus visible when no concrete task id survived compact", () => {
		const prompt = buildAutoResumePromptFromHandoff({
			next_actions: [
				"Continue local-first monitor/control-plane calibration with bounded slices.",
				"Use autonomy_lane_status for conservative task selection and skip protected/missing-rationale scopes by default.",
			],
		} as any);
		expect(prompt).toContain("focusTasks: autonomy-lane-status");
		expect(prompt).not.toContain("focusTasks: none-listed");
	});

	it("annotates omitted list items with explicit +N more marker", () => {
		const prompt = buildAutoResumePromptFromHandoff({
			current_tasks: ["TASK-BUD-101", "TASK-BUD-102", "TASK-BUD-103", "TASK-BUD-104"],
			blockers: ["b1", "b2", "b3"],
			next_actions: ["n1", "n2", "n3"],
		} as any);
		expect(prompt).toContain("focusTasks: TASK-BUD-101, TASK-BUD-102, TASK-BUD-103 (+1 more)");
		expect(prompt).toContain("blockers: b1 | b2 (+1 more)");
		expect(prompt).toContain("next: n1 | n2 (+1 more)");
	});

	it("caps final prompt length with explicit global truncation marker", () => {
		const prompt = buildAutoResumePromptFromHandoff({
			current_tasks: ["TASK-BUD-150", "TASK-BUD-151", "TASK-BUD-152"],
			blockers: ["b".repeat(400), "c".repeat(400)],
			next_actions: ["n".repeat(400), "m".repeat(400)],
		} as any);
		expect(prompt.length).toBeGreaterThan(700);
		expect(prompt).toContain("[auto-resume-prompt-truncated:+");
	});

	it("returns diagnostics envelope for auto-resume prompt generation", () => {
		const envelope = buildAutoResumePromptEnvelopeFromHandoff({
			current_tasks: ["`TASK-BUD-150`", "- TASK-BUD-150", "TASK-BUD-151"],
			blockers: ["context-watch-compact-required", "infra"],
			next_actions: [
				"Context-watch action: level=compact 72% (compact-now)",
				"step with long payload " + "x".repeat(260),
			],
		} as any);
		expect(envelope.prompt).toContain("focusTasks: TASK-BUD-150, TASK-BUD-151");
		expect(envelope.prompt).toContain("blockers: infra");
		expect(envelope.diagnostics.tasks.inputCount).toBe(3);
		expect(envelope.diagnostics.tasks.dedupedCount).toBe(1);
		expect(envelope.diagnostics.blockers.inputCount).toBe(1);
		expect(envelope.diagnostics.nextActions.inputCount).toBe(1);
		expect(envelope.diagnostics.nextActions.truncatedCount).toBe(1);
		expect(summarizeAutoResumePromptDiagnostics(envelope.diagnostics)).toContain("tasks(in=3,listed=2");
		expect(summarizeAutoResumePromptDiagnostics(undefined)).toBe("none");
	});

	it("keeps warn/checkpoint passive by default and signals only at compact lane", () => {
		const warnDefault = resolveContextWatchSteeringDispatch({
			notifyEnabled: true,
			assessmentLevel: "warn",
			lastAnnouncedLevel: null,
			elapsedMs: 0,
			cooldownMs: 600_000,
			forceWarnCadenceAnnouncement: false,
		});
		expect(warnDefault.shouldSignal).toBe(false);
		expect(warnDefault.shouldNotify).toBe(false);

		const checkpointDefault = resolveContextWatchSteeringDispatch({
			userNotifyEnabled: true,
			assessmentLevel: "checkpoint",
			lastAnnouncedLevel: "warn",
			elapsedMs: 10_000,
			cooldownMs: 600_000,
			forceWarnCadenceAnnouncement: false,
		});
		expect(checkpointDefault.shouldSignal).toBe(false);
		expect(checkpointDefault.shouldNotify).toBe(false);

		const compactNotify = resolveContextWatchSteeringDispatch({
			userNotifyEnabled: true,
			assessmentLevel: "compact",
			lastAnnouncedLevel: "checkpoint",
			elapsedMs: 10_000,
			cooldownMs: 600_000,
			forceWarnCadenceAnnouncement: false,
		});
		expect(compactNotify.shouldSignal).toBe(true);
		expect(compactNotify.shouldNotify).toBe(true);
		expect(compactNotify.delivery).toBe("notify");

		const compactMuted = resolveContextWatchSteeringDispatch({
			userNotifyEnabled: false,
			assessmentLevel: "compact",
			lastAnnouncedLevel: "checkpoint",
			elapsedMs: 10_000,
			cooldownMs: 600_000,
			forceWarnCadenceAnnouncement: false,
		});
		expect(compactMuted.shouldSignal).toBe(true);
		expect(compactMuted.shouldNotify).toBe(false);
		expect(compactMuted.delivery).toBe("fallback-status");

		const legacyWarnMode = resolveContextWatchSteeringDispatch({
			notifyEnabled: false,
			assessmentLevel: "warn",
			modelSteeringFromLevel: "warn",
			userNotifyFromLevel: "checkpoint",
			lastAnnouncedLevel: null,
			elapsedMs: 0,
			cooldownMs: 600_000,
			forceWarnCadenceAnnouncement: false,
		});
		expect(legacyWarnMode.shouldSignal).toBe(true);
		expect(legacyWarnMode.shouldNotify).toBe(false);
		expect(legacyWarnMode.delivery).toBe("fallback-status");
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

		const compactCheckpoint = resolveContextWatchOperatorSignal({
			reloadRequired: false,
			handoffManualRefreshRequired: false,
			compactCheckpointPersistRequired: true,
		});
		expect(compactCheckpoint.humanActionRequired).toBe(true);
		expect(compactCheckpoint.reasons).toContain("compact-checkpoint-required");

		expect(resolveContextWatchDeterministicStopSignal({
			assessmentLevel: "ok",
			operatorSignal: { reasons: [] },
		})).toEqual({ required: false, reason: "none", action: "none" });
		expect(resolveContextWatchDeterministicStopSignal({
			assessmentLevel: "warn",
			operatorSignal: { reasons: ["reload-required"] },
		})).toEqual({ required: true, reason: "reload-required", action: "reload-and-resume" });
		expect(describeContextWatchDeterministicStopHint({
			required: true,
			reason: "reload-required",
			action: "reload-and-resume",
		})).toContain("/reload");
		expect(resolveContextWatchDeterministicStopSignal({
			assessmentLevel: "compact",
			operatorSignal: { reasons: ["compact-checkpoint-required"] },
		})).toEqual({
			required: true,
			reason: "compact-checkpoint-required",
			action: "persist-checkpoint-and-compact",
		});
		expect(describeContextWatchDeterministicStopHint({
			required: true,
			reason: "compact-checkpoint-required",
			action: "persist-checkpoint-and-compact",
		})).toContain("persist checkpoint evidence");
		expect(describeContextWatchDeterministicStopHint({
			required: false,
			reason: "none",
			action: "none",
		})).toBeUndefined();
		expect(resolveContextWatchOperatorActionPlan({
			deterministicStop: { required: false, reason: "none", action: "none" },
			operatorSignal: { reasons: [] },
		})).toEqual({
			blocking: false,
			kind: "none",
			summary: "no operator action required",
		});
		expect(resolveContextWatchOperatorActionPlan({
			deterministicStop: { required: true, reason: "reload-required", action: "reload-and-resume" },
			operatorSignal: { reasons: ["reload-required"] },
		})).toEqual({
			blocking: true,
			kind: "reload",
			summary: "reload required before continuing long-run",
			commandHint: "/reload",
		});
		expect(resolveContextWatchOperatorActionPlan({
			deterministicStop: { required: true, reason: "compact-checkpoint-required", action: "persist-checkpoint-and-compact" },
			operatorSignal: { reasons: ["compact-checkpoint-required"] },
		})).toEqual({
			blocking: true,
			kind: "checkpoint-compact",
			summary: "persist checkpoint and compact before next slice",
		});
		expect(resolveContextWatchOperatorActionPlan({
			deterministicStop: { required: false, reason: "none", action: "none" },
			operatorSignal: { reasons: ["handoff-refresh-required"] },
		})).toEqual({
			blocking: false,
			kind: "handoff-refresh",
			summary: "refresh handoff checkpoint before manual resume",
		});
		expect(shouldEmitDeterministicStopSignal(false, 120_000, 0, 60_000)).toBe(false);
		expect(shouldEmitDeterministicStopSignal(true, 30_000, 0, 60_000)).toBe(false);
		expect(shouldEmitDeterministicStopSignal(true, 120_000, 0, 60_000)).toBe(true);
	});

	it("resolves operating cadence with post-resume recalibration signal", () => {
		expect(resolveContextWatchOperatingCadence({
			assessmentLevel: "warn",
			handoffLastEventLevel: "compact",
		})).toEqual({
			operatingCadence: "bounded-slices",
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

	it("builds compact local slice handoff checkpoints", () => {
		const checkpoint = buildLocalSliceHandoffCheckpoint({
			timestampIso: "2026-04-30T00:20:00.000Z",
			taskId: "TASK-BUD-225",
			context: `TASK-BUD-225 completed. ${"handoff payload ".repeat(40)}`,
			validation: [
				"context-watchdog.test.ts passed 32/32",
				"test:monitor:smoke passed 208/208 across 32 files",
				"live board_task_complete emitted compact summary",
				"extra validation should be dropped",
			],
			commits: ["abc1234 feat(context): compact handoff checkpoints"],
			nextActions: [
				"continue essential local hardening",
				"keep critical runtime guards pure/tested where possible",
				"avoid protected scopes unless selected",
				"prefer board summaries",
				"extra next action should be dropped",
			],
			blockers: [],
			contextLevel: "ok",
			contextPercent: 14,
			recommendation: "Progress saved; continue bounded local hardening.",
		}) as any;

		expect(checkpoint.timestamp).toBe("2026-04-30T00:20:00.000Z");
		expect(checkpoint.current_tasks).toEqual(["TASK-BUD-225"]);
		expect(checkpoint.context.length).toBeLessThanOrEqual(320);
		expect(checkpoint.recent_validation).toHaveLength(3);
		expect(checkpoint.next_actions).toHaveLength(3);
		expect(checkpoint.blockers).toEqual([]);
		expect(checkpoint.context_watch).toMatchObject({ level: "ok", percent: 14, action: "continue" });
		expect(checkpoint.context_watch_events).toHaveLength(1);
		expect(checkpoint.context_watch_events[0]).toMatchObject({ reason: "manual_checkpoint", action: "checkpoint-refresh" });
	});

	it("keeps compact local slice handoff checkpoints within budget", () => {
		const noisy = "payload ".repeat(200);
		const checkpoint = buildLocalSliceHandoffCheckpoint({
			timestampIso: "2026-04-30T00:40:00.000Z",
			taskId: `TASK-BUD-230-${noisy}`,
			context: `TASK-BUD-230 completed. ${noisy}`,
			validation: Array.from({ length: 20 }, (_, index) => `validation-${index}: ${noisy}`),
			commits: Array.from({ length: 20 }, (_, index) => `commit-${index}-${noisy}`),
			nextActions: Array.from({ length: 20 }, (_, index) => `next-${index}: ${noisy}`),
			blockers: Array.from({ length: 20 }, (_, index) => `blocker-${index}: ${noisy}`),
			contextLevel: "ok",
			contextPercent: 14,
			recommendation: noisy,
		});
		const size = JSON.stringify(checkpoint).length;
		expect(size).toBeLessThanOrEqual(LOCAL_SLICE_HANDOFF_MAX_JSON_CHARS);
		expect((checkpoint as any).recent_validation).toHaveLength(3);
		expect((checkpoint as any).recent_commits).toHaveLength(2);
		expect((checkpoint as any).next_actions).toHaveLength(3);
		expect((checkpoint as any).blockers).toHaveLength(3);
	});

	it("assesses and blocks oversized local slice handoff checkpoints", () => {
		const checkpoint = buildLocalSliceHandoffCheckpoint({
			timestampIso: "2026-04-30T00:45:00.000Z",
			taskId: "TASK-BUD-231",
			context: "TASK-BUD-231 oversized budget validation.",
			validation: ["validation payload large enough to cross the artificial 501 char test budget"],
		});
		expect(assessLocalSliceHandoffBudget(checkpoint, LOCAL_SLICE_HANDOFF_MAX_JSON_CHARS).ok).toBe(true);
		expect(assessLocalSliceHandoffBudget(checkpoint, 501)).toMatchObject({
			ok: false,
			maxJsonChars: 501,
			reason: "checkpoint-too-large",
		});

		const cwd = mkdtempSync(join(tmpdir(), "ctx-handoff-budget-"));
		try {
			const result = writeLocalSliceHandoffCheckpoint(cwd, {
				timestampIso: "2026-04-30T00:45:00.000Z",
				taskId: "TASK-BUD-231",
				context: "TASK-BUD-231 oversized budget validation.",
				validation: ["validation payload large enough to cross the artificial 501 char test budget"],
			}, { maxJsonChars: 501 });
			expect(result).toMatchObject({
				ok: false,
				reason: "checkpoint-too-large",
				summary: "context-watch-checkpoint: ok=no task=TASK-BUD-231 reason=checkpoint-too-large",
				maxJsonChars: 501,
			});
			expect(existsSync(join(cwd, ".project", "handoff.json"))).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("does not overwrite newer handoff checkpoints with stale timestamps", () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-handoff-stale-"));
		try {
			const first = writeLocalSliceHandoffCheckpoint(cwd, {
				timestampIso: "2026-04-30T00:50:00.000Z",
				taskId: "TASK-BUD-232",
				context: "Fresh checkpoint should survive stale writes.",
			});
			expect(first.ok).toBe(true);

			const stale = writeLocalSliceHandoffCheckpoint(cwd, {
				timestampIso: "2026-04-30T00:49:00.000Z",
				taskId: "TASK-BUD-OLD",
				context: "Stale checkpoint must not replace newer progress.",
			});
			expect(stale).toMatchObject({
				ok: false,
				reason: "stale-checkpoint",
				summary: "context-watch-checkpoint: ok=no task=TASK-BUD-OLD reason=stale-checkpoint",
			});
			const written = JSON.parse(readFileSync(join(cwd, ".project", "handoff.json"), "utf8")) as any;
			expect(written.timestamp).toBe("2026-04-30T00:50:00.000Z");
			expect(written.current_tasks).toEqual(["TASK-BUD-232"]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("writes compact local slice handoff checkpoints", () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-handoff-"));
		try {
			const result = writeLocalSliceHandoffCheckpoint(cwd, {
				timestampIso: "2026-04-30T00:25:00.000Z",
				taskId: "TASK-BUD-226",
				context: "TASK-BUD-226 completed with bounded checkpoint writer.",
				validation: ["context-watchdog.test.ts passed 34/34"],
				commits: ["def5678 feat(context): write handoff checkpoints"],
				nextActions: ["reload before live use"],
				blockers: [],
				contextLevel: "ok",
				contextPercent: 14,
			});
			expect(result.ok).toBe(true);
			expect(result.summary).toBe("context-watch-checkpoint: ok=yes task=TASK-BUD-226 path=.project/handoff.json");
			expect(existsSync(join(cwd, ".project", "handoff.json"))).toBe(true);
			const written = JSON.parse(readFileSync(join(cwd, ".project", "handoff.json"), "utf8")) as any;
			expect(written.current_tasks).toEqual(["TASK-BUD-226"]);
			expect(written.recent_validation).toEqual(["context-watchdog.test.ts passed 34/34"]);
			expect(written.context_watch).toMatchObject({ level: "ok", percent: 14 });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("context_watch_status tool emits compact content and structured details", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-tool-status-"));
		try {
			const pi = makeMockPi();
			contextWatchdogExtension(pi);
			const tool = getTool(pi, "context_watch_status");
			const result = await tool.execute(
				"tc-context-watch-status",
				{},
				undefined as unknown as AbortSignal,
				() => {},
				{
					cwd,
					getContextUsage: () => ({ percent: 14 }),
					model: { id: "test-model", provider: "test" },
					isIdle: () => true,
					hasPendingMessages: () => false,
				} as any,
			);
			expect(result.content?.[0]?.text).toBe("context-watch-status: level=ok percent=14 action=continue autoCompact=level-not-compact operator=none cadence=standard-slices handoff=unknown");
			expect(result.details).toMatchObject({
				level: "ok",
				percent: 14,
				summary: "context-watch-status: level=ok percent=14 action=continue autoCompact=level-not-compact operator=none cadence=standard-slices handoff=unknown",
			});
			expect(result.details?.autoCompact).toBeTruthy();
			expect(result.details?.operatorAction).toBeTruthy();
			expect(formatContextWatchStatusToolSummary({ level: "ok", percent: 14, action: "continue" }))
				.toBe("context-watch-status: level=ok percent=14 action=continue");
			expect(formatContextWatchCommandStatusSummary({
				level: "compact",
				percent: 91,
				action: "compact-now",
				autoCompactDecision: "checkpoint-evidence-missing",
				autoCompactTrigger: false,
				retryScheduled: true,
				calmCloseReady: false,
				checkpointEvidenceReady: false,
				operatorActionKind: "ask",
				handoffFreshness: "fresh",
			}))
				.toBe("context-watch: level=compact percent=91 action=compact-now autoCompact=checkpoint-evidence-missing trigger=no retry=yes calm=no checkpoint=missing operator=ask handoff=fresh");
			expect(formatContextWatchCommandStatusSummary({
				level: "compact",
				percent: 72,
				action: "compact-now",
				autoCompactDecision: "trigger",
				autoCompactTrigger: true,
				retryScheduled: false,
				checkpointEvidenceReady: false,
				operatorActionKind: "checkpoint-compact",
				deterministicStopReason: "compact-checkpoint-required",
				deterministicStopAction: "persist-checkpoint-and-compact",
				handoffPath: ".project/handoff.json",
			}))
				.toBe("context-watch: level=compact percent=72 action=compact-now autoCompact=trigger trigger=yes retry=no checkpoint=missing operator=checkpoint-compact stop=compact-checkpoint-required next=persist-checkpoint-and-compact handoff=.project/handoff.json");
			expect(formatContextWatchDeterministicStopSummary({
				required: true,
				reason: "compact-checkpoint-required",
				action: "persist-checkpoint-and-compact",
				operatorActionKind: "checkpoint-compact",
				handoffPath: ".project/handoff.json",
			}))
				.toBe("context-watch-stop: required=yes reason=compact-checkpoint-required action=persist-checkpoint-and-compact operator=checkpoint-compact handoff=.project/handoff.json");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("context_watch_auto_resume_preview tool is read-only and filters stale focus", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-auto-resume-preview-"));
		try {
			mkdirSync(join(cwd, ".project"), { recursive: true });
			writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
				timestamp: "2026-04-30T05:23:29.396Z",
				current_tasks: ["TASK-BUD-309"],
				next_actions: ["after reload validate TASK-BUD-309 only"],
				blockers: [],
			}));
			writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [
				{ id: "TASK-BUD-309", status: "completed" },
			] }));
			const pi = makeMockPi();
			contextWatchdogExtension(pi);
			const tool = getTool(pi, "context_watch_auto_resume_preview");
			const schemaText = JSON.stringify((pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([registered]) => registered?.name === "context_watch_auto_resume_preview")?.[0]?.parameters ?? {});
			expect(schemaText).not.toContain("taskStatusById");
			const result = await tool.execute("tc-auto-resume-preview", {}, undefined as unknown as AbortSignal, () => {}, { cwd });

			expect(result.content?.[0]?.text).toContain("context-watch-auto-resume-preview:");
			expect(result.content?.[0]?.text).toContain("focusTasks=none-listed");
			expect(result.content?.[0]?.text).toContain("staleFocus=1");
			expect(result.content?.[0]?.text).toContain("diagnostics=");
			expect(result.details).toMatchObject({
				effect: "none",
				mode: "read-only-preview",
				authorization: "none",
				focusTasks: "none-listed",
				staleFocus: "TASK-BUD-309=completed",
				diagnosticsSummary: expect.stringContaining("staleFocus=1"),
			});
			expect(result.details?.prompt).not.toContain("focusTasks: TASK-BUD-309");
			expect(formatContextWatchAutoResumePreviewSummary({
				focusTasks: "none-listed",
				staleFocusCount: 1,
				diagnosticsSummary: "tasks(in=0,listed=0,dedup=0,trunc=0,drop=0) staleFocus=1 global=ok",
			})).toContain("staleFocus=1");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("context_watch_auto_resume_preview prefers active board task before generic focus", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-auto-resume-active-focus-"));
		try {
			mkdirSync(join(cwd, ".project"), { recursive: true });
			writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
				timestamp: "2026-04-30T05:43:29.396Z",
				completed_tasks: ["TASK-BUD-316"],
				next_actions: ["continue essential lane with board-task-selection after TASK-BUD-316"],
				context: "TASK-BUD-316 completed; use task selection for next work.",
				blockers: [],
			}));
			writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [
				{ id: "TASK-BUD-316", status: "completed" },
				{ id: "TASK-BUD-317", status: "in-progress", files: ["packages/pi-stack/extensions/context-watchdog.ts"] },
				{ id: "TASK-BUD-296", status: "planned", files: ["packages/pi-stack/extensions/context-watchdog-handoff.ts"] },
			] }));
			const pi = makeMockPi();
			contextWatchdogExtension(pi);
			const tool = getTool(pi, "context_watch_auto_resume_preview");
			const result = await tool.execute("tc-auto-resume-active-focus", {}, undefined as unknown as AbortSignal, () => {}, { cwd });

			expect(result.content?.[0]?.text).toContain("focusTasks=TASK-BUD-317");
			expect(result.content?.[0]?.text).toContain("staleFocus=1");
			expect(result.details?.focusTasks).toBe("TASK-BUD-317");
			expect(result.details?.staleFocus).toBe("TASK-BUD-316=completed");
			expect(result.details?.prompt).not.toContain("focusTasks: board-task-selection");
			expect(result.details?.prompt).not.toContain("focusTasks: TASK-BUD-316");
			expect(result.details?.prompt).not.toContain("TASK-BUD-296");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("context_watch_continuation_readiness combines primary focus with local audit read-only", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-continuation-readiness-"));
		try {
			mkdirSync(join(cwd, ".project"), { recursive: true });
			writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
				timestamp: "2026-04-30T06:04:09.000Z",
				completed_tasks: ["TASK-BUD-320"],
				next_actions: ["continue essential lane with board-task-selection after TASK-BUD-320"],
				context: "TASK-BUD-320 completed; choose one primary task.",
				blockers: [],
			}));
			writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [
				{ id: "TASK-BUD-320", status: "completed" },
				{ id: "TASK-BUD-321", status: "in-progress", description: "Continuation readiness smoke", files: ["packages/pi-stack/extensions/context-watchdog.ts"], acceptance_criteria: ["Smoke principal permanece verde."] },
			] }));
			const pi = makeMockPi();
			contextWatchdogExtension(pi);
			const tool = getTool(pi, "context_watch_continuation_readiness");
			const schemaText = JSON.stringify((pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([registered]) => registered?.name === "context_watch_continuation_readiness")?.[0]?.parameters ?? {});
			expect(schemaText).not.toContain("taskStatusById");
			expect(schemaText).not.toContain("preferredTaskIds");
			const result = await tool.execute("tc-continuation-readiness", {}, undefined as unknown as AbortSignal, () => {}, { cwd });

			expect(result.content?.[0]?.text).toContain("context-watch-continuation-readiness:");
			expect(result.content?.[0]?.text).toContain("ready=no");
			expect(result.content?.[0]?.text).toContain("focus=TASK-BUD-321");
			expect(result.content?.[0]?.text).toContain("reasons=");
			expect(result.content?.[0]?.text).toContain("authorization=none");
			expect(result.details).toMatchObject({
				effect: "none",
				mode: "read-only-readiness",
				authorization: "none",
				ready: false,
				focusTasks: "TASK-BUD-321",
				staleFocus: "TASK-BUD-320=completed",
				localContinuitySummary: expect.stringContaining("local-continuity-audit:"),
			});
			expect(result.details?.autoResumePrompt).not.toContain("focusTasks: board-task-selection");
			expect(formatContextWatchContinuationReadinessSummary({
				ready: false,
				focusTasks: "TASK-BUD-321",
				localAuditDecision: "blocked",
				localAuditReasons: ["git-state:invalid", "protected-scopes:invalid", "stop-conditions:invalid", "extra"],
				staleFocusCount: 1,
			})).toBe("context-watch-continuation-readiness: ready=no focus=TASK-BUD-321 audit=blocked reasons=git-state:invalid|protected-scopes:invalid|stop-conditions:invalid staleFocus=1 authorization=none");
			expect(formatContextWatchContinuationReadinessSummary({
				ready: false,
				focusTasks: "TASK-BUD-321",
				localAuditDecision: "blocked",
				localAuditReasons: ["protected-scopes:invalid"],
				protectedPaths: [".pi/settings.json"],
				staleFocusCount: 0,
			})).toBe("context-watch-continuation-readiness: ready=no focus=TASK-BUD-321 audit=blocked reasons=protected-scopes:invalid protected=.pi/settings.json staleFocus=0 authorization=none");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("context_watch_one_slice_canary_preview composes readiness without activation", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-one-slice-preview-"));
		try {
			execFileSync("git", ["init"], { cwd, stdio: "ignore" });
			execFileSync("git", ["config", "user.email", "test@example.com"], { cwd, stdio: "ignore" });
			execFileSync("git", ["config", "user.name", "Test User"], { cwd, stdio: "ignore" });
			mkdirSync(join(cwd, ".project"), { recursive: true });
			writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
				timestamp: "2026-04-30T04:40:00.000Z",
				current_tasks: ["TASK-BUD-340"],
				blockers: [],
			}));
			writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [{
				id: "TASK-BUD-340",
				status: "in-progress",
				description: "One-slice preview smoke",
				files: [".project/tasks.json"],
				acceptance_criteria: ["Smoke principal permanece verde."],
			}] }));
			execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
			execFileSync("git", ["commit", "-m", "init"], { cwd, stdio: "ignore" });
			writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
				timestamp: new Date().toISOString(),
				current_tasks: ["TASK-BUD-340"],
				blockers: [],
			}));
			writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [{
				id: "TASK-BUD-340",
				status: "in-progress",
				description: "One-slice preview smoke",
				files: [".project/tasks.json"],
				acceptance_criteria: ["Smoke principal permanece verde."],
				notes: "preview changed",
			}] }));
			const pi = makeMockPi();
			contextWatchdogExtension(pi);
			const tool = getTool(pi, "context_watch_one_slice_canary_preview");
			const schemaText = JSON.stringify((pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([registered]) => registered?.name === "context_watch_one_slice_canary_preview")?.[0]?.parameters ?? {});
			expect(schemaText).not.toContain("execute");
			expect(schemaText).not.toContain("dispatch");
			const result = await tool.execute("tc-one-slice-preview", {}, undefined as unknown as AbortSignal, () => {}, { cwd });

			expect(result.content?.[0]?.text).toBe("context-watch-one-slice-canary-preview: decision=prepare-one-slice prepare=yes stop=yes oneSliceOnly=yes packet=ready-for-human-decision dispatch=no reasons=readiness-green|one-slice-only authorization=none");
			expect(result.content?.[0]?.text).not.toContain("packetReasons=");
			expect(result.details).toMatchObject({
				effect: "none",
				mode: "read-only-preview",
				activation: "none",
				authorization: "none",
				focusTasks: "TASK-BUD-340",
				plan: {
					activation: "none",
					authorization: "none",
					oneSliceOnly: true,
					decision: "prepare-one-slice",
					canPrepareSlice: true,
					mustStopAfterSlice: true,
				},
				decisionPacket: {
					mode: "decision-packet",
					activation: "none",
					authorization: "none",
					dispatchAllowed: false,
					requiresHumanDecision: true,
					oneSliceOnly: true,
					decision: "ready-for-human-decision",
				},
			});
			expect(formatContextWatchOneSliceCanaryPreviewSummary({
				decision: "blocked",
				canPrepareSlice: false,
				mustStopAfterSlice: true,
				oneSliceOnly: true,
				reasons: ["protected-scope"],
				decisionPacketDecision: "blocked",
				dispatchAllowed: false,
				decisionPacketReasons: ["preview-not-ready", "rollback-plan-missing"],
			})).toBe("context-watch-one-slice-canary-preview: decision=blocked prepare=no stop=yes oneSliceOnly=yes packet=blocked dispatch=no reasons=protected-scope packetReasons=preview-not-ready|rollback-plan-missing authorization=none");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("context_watch_checkpoint tool writes compact bounded checkpoints", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-tool-checkpoint-"));
		try {
			const pi = makeMockPi();
			contextWatchdogExtension(pi);
			const tool = getTool(pi, "context_watch_checkpoint");
			const result = await tool.execute(
				"tc-context-watch-checkpoint",
				{
					task_id: "TASK-BUD-234",
					context: "TASK-BUD-234 tool smoke checkpoint.",
					validation: ["tool checkpoint smoke passed"],
					commits: ["abc1234 test(context): smoke checkpoint tool"],
					next_actions: ["continue bounded lane"],
					blockers: [],
					context_level: "ok",
					context_percent: 14,
				},
				undefined as unknown as AbortSignal,
				() => {},
				{ cwd },
			);
			expect(result.content?.[0]?.text).toBe("context-watch-checkpoint: ok=yes task=TASK-BUD-234 path=.project/handoff.json");
			expect(result.details).toMatchObject({
				ok: true,
				summary: "context-watch-checkpoint: ok=yes task=TASK-BUD-234 path=.project/handoff.json",
				path: ".project/handoff.json",
			});
			expect(result.details?.checkpoint).toBeUndefined();
			expect(typeof result.details?.jsonChars).toBe("number");
			expect(typeof result.details?.maxJsonChars).toBe("number");
			const written = JSON.parse(readFileSync(join(cwd, ".project", "handoff.json"), "utf8")) as any;
			expect(written.current_tasks).toEqual(["TASK-BUD-234"]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("context_watch_checkpoint omits completed task from current focus", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-tool-checkpoint-completed-"));
		try {
			mkdirSync(join(cwd, ".project"), { recursive: true });
			writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [
				{ id: "TASK-BUD-DONE", status: "completed" },
			] }));
			const pi = makeMockPi();
			contextWatchdogExtension(pi);
			const tool = getTool(pi, "context_watch_checkpoint");
			const result = await tool.execute(
				"tc-context-watch-checkpoint-completed",
				{
					task_id: "TASK-BUD-DONE",
					context: "TASK-BUD-DONE completed checkpoint should not become resume focus.",
					validation: ["completed task checkpoint smoke"],
					context_level: "ok",
					context_percent: 14,
				},
				undefined as unknown as AbortSignal,
				() => {},
				{ cwd },
			);

			expect(result.content?.[0]?.text).toBe("context-watch-checkpoint: ok=yes task=TASK-BUD-DONE path=.project/handoff.json");
			const written = JSON.parse(readFileSync(join(cwd, ".project", "handoff.json"), "utf8")) as any;
			expect(written.current_tasks).toBeUndefined();
			expect(written.completed_tasks).toEqual(["TASK-BUD-DONE"]);
			expect(written.context_watch.focus_task_status).toBe("completed");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("context_watch_checkpoint tool rejects stale checkpoints without overwriting newer handoff", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-tool-checkpoint-stale-"));
		try {
			const seeded = writeLocalSliceHandoffCheckpoint(cwd, {
				timestampIso: "2099-01-01T00:00:00.000Z",
				taskId: "TASK-BUD-FUTURE",
				context: "Future checkpoint should survive stale tool writes.",
			});
			expect(seeded.ok).toBe(true);
			const pi = makeMockPi();
			contextWatchdogExtension(pi);
			const tool = getTool(pi, "context_watch_checkpoint");
			const result = await tool.execute(
				"tc-context-watch-checkpoint-stale",
				{ task_id: "TASK-BUD-235", context: "Stale runtime checkpoint should be rejected." },
				undefined as unknown as AbortSignal,
				() => {},
				{ cwd },
			);
			expect(result.content?.[0]?.text).toBe("context-watch-checkpoint: ok=no task=TASK-BUD-235 reason=stale-checkpoint");
			expect(result.details).toMatchObject({
				ok: false,
				reason: "stale-checkpoint",
				summary: "context-watch-checkpoint: ok=no task=TASK-BUD-235 reason=stale-checkpoint",
			});
			const written = JSON.parse(readFileSync(join(cwd, ".project", "handoff.json"), "utf8")) as any;
			expect(written.timestamp).toBe("2099-01-01T00:00:00.000Z");
			expect(written.current_tasks).toEqual(["TASK-BUD-FUTURE"]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("context_watch_checkpoint tool rejects missing context without writing", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-tool-checkpoint-empty-"));
		try {
			const pi = makeMockPi();
			contextWatchdogExtension(pi);
			const tool = getTool(pi, "context_watch_checkpoint");
			const result = await tool.execute(
				"tc-context-watch-checkpoint-empty",
				{ task_id: "TASK-BUD-234", context: "   " },
				undefined as unknown as AbortSignal,
				() => {},
				{ cwd },
			);
			expect(result.content?.[0]?.text).toBe("context-watch-checkpoint: ok=no task=TASK-BUD-234 reason=missing-context");
			expect(result.details).toMatchObject({
				ok: false,
				reason: "missing-context",
				summary: "context-watch-checkpoint: ok=no task=TASK-BUD-234 reason=missing-context",
			});
			expect(existsSync(join(cwd, ".project", "handoff.json"))).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("does not write empty local slice handoff checkpoints", () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-handoff-empty-"));
		try {
			const result = writeLocalSliceHandoffCheckpoint(cwd, {
				timestampIso: "2026-04-30T00:30:00.000Z",
				taskId: "TASK-BUD-228",
				context: "   ",
			});
			expect(result).toMatchObject({
				ok: false,
				reason: "missing-context",
				summary: "context-watch-checkpoint: ok=no task=TASK-BUD-228 reason=missing-context",
			});
			expect(existsSync(join(cwd, ".project", "handoff.json"))).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
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

	it("does not refresh stale machine-maintenance payload when writing context-watch events", () => {
		const assessment = evaluateContextWatch(57, {
			warnPct: 50,
			checkpointPct: 68,
			compactPct: 72,
		});
		const next = applyContextWatchToHandoff(
			{
				context: "machine-maintenance gate block: stale disk pressure",
				next_actions: [
					"Machine maintenance: checkpoint-and-stop until memory/disk pressure recovers.",
					"Keep unrelated operator note",
				],
				blockers: ["disk-pressure-block", "memory-pressure-warn", "infra-wait"],
				machine_maintenance: { severity: "block" },
			},
			assessment,
			"message_end",
			"2026-04-21T21:32:00.000Z",
		) as any;

		expect(next.machine_maintenance).toBeUndefined();
		expect(next.context).toBe("Context-watch tracking active: maintain continuity under context pressure.");
		expect(next.next_actions.some((line: string) => line.startsWith("Machine maintenance:")))
			.toBe(false);
		expect(next.next_actions).toContain("Keep unrelated operator note");
		expect(next.blockers).not.toContain("disk-pressure-block");
		expect(next.blockers).not.toContain("memory-pressure-warn");
		expect(next.blockers).toContain("infra-wait");
		expect(next.blockers.some((line: string) => String(line).startsWith("context-watch-")))
			.toBe(false);
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
				next_actions: ["Context-watch action: level=warn 55% (continue-bounded)"],
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
