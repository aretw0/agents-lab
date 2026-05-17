import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readContextWatchFreshnessSignals } from "../../extensions/context-watchdog-freshness";
import contextWatchdogExtension from "../../extensions/context-watchdog";
import {
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
	formatTimeoutPressureSummary,
	formatContextWatchCompactStageStatusSummary,
	resolveContextWatchAdaptiveStatusSummary,
	resolveContextWatchCompactStageNextAction,
	formatContextWatchAutoResumePreviewSummary,
	formatContextWatchContinuationReadinessSummary,
	consumeContextPreloadPack,
	resolveContextWatchContinuationRecommendation,
	formatContextWatchLocalSlicePreviewSummary,
	formatContextWatchLocalSliceOperatorPacketPreviewSummary,
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
	composeAutoResumeSuppressionHint,
	isProviderRequestTimeoutError,
	shouldNotifyAutoResumeSuppression,
	summarizeAutoResumePromptDiagnostics,
	resolveAutoResumeDispatchDecision,
	resolvePreCompactReloadSignal,
	resolveContextWatchOperatingCadence,
	resolveContextWatchCompactStage,
	resolveContextWatchAutoCompactTriggerOrigin,
	resolveAutoCompactTimeoutPressureGuard,
	resolveContextWatchOperatorSignal,
	resolveContextWatchDeterministicStopSignal,
	describeContextWatchDeterministicStopHint,
	resolveContextWatchOperatorActionPlan,
	resolveContextWatchSignalNoiseExcessive,
	shouldEmitDeterministicStopSignal,
	resolveContextWatchSteeringDispatch,
	resolveFinalTurnAnnouncementDispatch,
	resolveCheckpointEvidenceReadyForCalmClose,
	resolvePreCompactIdlePrepDispatch,
	reconcileAutoResumeHandoffFocus,
	resolvePreCompactCalmCloseSignal,
	resolveProgressPreservationSignal,
	summarizeProgressPreservationSignal,
	resolveContextEconomySignal,
	summarizeContextEconomySignal,
	resolveAntiParalysisDispatch,
	isAutoCompactDeferralReason,
	resolveHandoffBoardReconciliation,
	resolveHandoffFreshness,
	resolveHandoffPrepDecision,
	readAutoResumeAfterReloadIntent,
	withAutoResumeAfterReloadIntent,
	clearAutoResumeAfterReloadIntent,
	summarizeContextWatchEvent,
	shouldAnnounceContextWatch,
	shouldAutoCheckpoint,
	TURN_BOUNDARY_DIRECTION_PROMPT,
	shouldEmitAutoResumeAfterCompact,
	shouldRefreshHandoffBeforeAutoCompact,
	shouldScheduleAutoCompactRetry,
	shouldTriggerAutoCompact,
	writeLocalSliceHandoffCheckpoint,
} from "../../extensions/context-watchdog-exports";

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

	it("derives sane global thresholds with canonical ordering across providers", () => {
		const cfg = normalizeContextWatchdogConfig({});
		expect(cfg.checkpointPct).toBe(55);
		expect(cfg.compactPct).toBe(65);

		const tAnthropic = deriveContextWatchThresholds(65, 85, cfg);
		expect(tAnthropic.warnPct).toBe(54);
		expect(tAnthropic.checkpointPct).toBe(55);
		expect(tAnthropic.compactPct).toBe(65);

		const tOpenAi = deriveContextWatchThresholds(50, 75, cfg);
		expect(tOpenAi.warnPct).toBe(50);
		expect(tOpenAi.checkpointPct).toBe(55);
		expect(tOpenAi.compactPct).toBe(65);
	});

	it("respects explicit checkpoint override and clamps compact below error threshold", () => {
		const cfg = normalizeContextWatchdogConfig({ checkpointPct: 70, compactPct: 80 });
		const t = deriveContextWatchThresholds(50, 75, cfg);
		expect(t.warnPct).toBe(50);
		expect(t.checkpointPct).toBe(70);
		expect(t.compactPct).toBe(74);
	});

	it("evaluates levels with checkpoint before compact", () => {
		const thresholds = { warnPct: 60, checkpointPct: 68, compactPct: 72 };
		expect(evaluateContextWatch(59, thresholds).level).toBe("ok");
		expect(evaluateContextWatch(60, thresholds).level).toBe("warn");
		expect(evaluateContextWatch(68, thresholds).level).toBe("checkpoint");
		expect(evaluateContextWatch(72, thresholds).level).toBe("compact");
	});

	it("resolves compact stages as graceful-stop before force-compact", () => {
		const thresholds = { warnPct: 50, checkpointPct: 60, compactPct: 65 };
		const normal = resolveContextWatchCompactStage(evaluateContextWatch(55, thresholds));
		expect(normal.stage).toBe("normal-window");
		expect(normal.shouldGracefulStop).toBe(false);
		expect(normal.shouldForceCompact).toBe(false);

		const graceful = resolveContextWatchCompactStage(evaluateContextWatch(60, thresholds));
		expect(graceful.stage).toBe("graceful-stop-window");
		expect(graceful.shouldGracefulStop).toBe(true);
		expect(graceful.shouldForceCompact).toBe(false);
		expect(evaluateContextWatch(60, thresholds).recommendation).toContain("Graceful-stop window");

		const force = resolveContextWatchCompactStage(evaluateContextWatch(65, thresholds));
		expect(force.stage).toBe("force-compact-window");
		expect(force.shouldForceCompact).toBe(true);
	});

	it("keeps Copilot 60/65 calibration in graceful-stop then force-compact order", () => {
		const cfg = normalizeContextWatchdogConfig({ checkpointPct: 60, compactPct: 65 });
		const thresholds = deriveContextWatchThresholds(45, 65, cfg);
		expect(thresholds).toMatchObject({ warnPct: 45, checkpointPct: 60, compactPct: 64 });

		const checkpoint = evaluateContextWatch(60, thresholds);
		expect(checkpoint.level).toBe("checkpoint");
		expect(resolveContextWatchCompactStage(checkpoint).stage).toBe("graceful-stop-window");

		const compact = evaluateContextWatch(64, thresholds);
		expect(compact.level).toBe("compact");
		expect(resolveContextWatchCompactStage(compact).stage).toBe("force-compact-window");
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

		expect(shouldTriggerAutoCompact(checkpoint, cfg, {
			nowMs: 200_000,
			lastAutoCompactAt: 0,
			inFlight: false,
			isIdle: true,
			hasPendingMessages: false,
			checkpointEvidenceReady: true,
		})).toEqual({ trigger: true, reason: "trigger" });

		expect(shouldTriggerAutoCompact(checkpoint, cfg, {
			nowMs: 200_000,
			lastAutoCompactAt: 0,
			inFlight: false,
			isIdle: true,
			hasPendingMessages: false,
			checkpointEvidenceReady: false,
		})).toEqual({ trigger: false, reason: "checkpoint-evidence-missing" });

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
		expect(resolveContextWatchAutoCompactTriggerOrigin({
			assessmentLevel: "checkpoint",
			autoCompactTrigger: true,
		})).toBe("checkpoint-window");
		expect(resolveContextWatchAutoCompactTriggerOrigin({
			assessmentLevel: "compact",
			autoCompactTrigger: true,
		})).toBe("hard-compact");
		expect(resolveContextWatchAutoCompactTriggerOrigin({
			assessmentLevel: "checkpoint",
			autoCompactTrigger: false,
		})).toBe("none");
		expect(resolveAutoCompactTimeoutPressureGuard({
			assessmentLevel: "checkpoint",
			autoCompactTrigger: true,
			timeoutPressureActive: true,
		})).toEqual({
			blocked: true,
			reason: "guarded-timeout-pressure",
			reasonCode: "guarded-precompact-timeout-pressure",
			recommendation: "timeout-pressure guard active: block direct compact trigger, keep idle, and retry through guarded path.",
		});
		expect(resolveAutoCompactTimeoutPressureGuard({
			assessmentLevel: "checkpoint",
			autoCompactTrigger: true,
			timeoutPressureActive: false,
		})).toEqual({
			blocked: false,
			reason: "no-timeout-pressure",
		});
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
		expect(resolveAutoResumeDispatchDecision({
			autoResumeReady: true,
			handoffBoardReconciled: false,
			hasPendingMessages: false,
			hasRecentSteerInput: false,
			queuedLaneIntents: 0,
		})).toEqual({ shouldDispatch: false, reason: "board-handoff-divergence" });
		expect(describeAutoResumeDispatchReason("send")).toBe("dispatched");
		expect(describeAutoResumeDispatchReason("reload-required")).toContain("reload-required");
		expect(describeAutoResumeDispatchReason("checkpoint-evidence-missing")).toContain("checkpoint-evidence-missing");
		expect(describeAutoResumeDispatchReason("board-handoff-divergence")).toContain("board-handoff-divergence");
		expect(describeAutoResumeDispatchHint("send")).toBeUndefined();
		expect(describeAutoResumeDispatchHint("reload-required")).toContain("/reload");
		expect(describeAutoResumeDispatchHint("checkpoint-evidence-missing")).toContain("checkpoint");
		expect(describeAutoResumeDispatchHint("board-handoff-divergence")).toContain("handoff");
		expect(shouldNotifyAutoResumeSuppression("send")).toBe(false);
		expect(shouldNotifyAutoResumeSuppression("checkpoint-evidence-missing")).toBe(true);
		expect(shouldNotifyAutoResumeSuppression("board-handoff-divergence")).toBe(true);
		expect(shouldNotifyAutoResumeSuppression("reload-required")).toBe(true);
		expect(resolvePreCompactReloadSignal({ assessmentLevel: "ok", reloadRequired: false })).toMatchObject({
			active: false,
			reason: "reload-not-required",
		});
		expect(resolvePreCompactReloadSignal({ assessmentLevel: "warn", reloadRequired: true })).toMatchObject({
			active: false,
			reason: "level-not-precompact",
			hint: expect.stringContaining("/reload"),
		});
		expect(resolvePreCompactReloadSignal({ assessmentLevel: "checkpoint", reloadRequired: true })).toMatchObject({
			active: true,
			reason: "reload-required-checkpoint",
			hint: expect.stringContaining("/reload"),
		});
		expect(resolvePreCompactReloadSignal({ assessmentLevel: "compact", reloadRequired: true })).toMatchObject({
			active: true,
			reason: "reload-required-compact",
			hint: expect.stringContaining("/reload"),
		});
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

		const finalTurnCloseWindow = resolveContextWatchSteeringDispatch({
			userNotifyEnabled: true,
			assessmentLevel: "checkpoint",
			lastAnnouncedLevel: "checkpoint",
			elapsedMs: 1_000,
			cooldownMs: 600_000,
			forceWarnCadenceAnnouncement: false,
			forceFinalTurnAnnouncement: true,
		});
		expect(finalTurnCloseWindow.shouldSignal).toBe(true);
		expect(finalTurnCloseWindow.shouldNotify).toBe(true);

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

	it("suppresses repeated forced final-turn announcements within cooldown", () => {
		const nowMs = Date.parse("2026-05-02T22:58:00.000Z");
		const repeated = resolveFinalTurnAnnouncementDispatch({
			reason: "message_end",
			finalTurnCloseWindow: true,
			nowMs,
			cooldownMs: 600_000,
			assessmentLevel: "checkpoint",
			assessmentAction: "write-checkpoint",
			lastSteeringSignal: {
				atIso: new Date(nowMs - 1_000).toISOString(),
				reason: "message_end",
				level: "checkpoint",
				action: "write-checkpoint",
			},
		});
		expect(repeated.force).toBe(false);
		expect(repeated.suppressed).toBe(true);
		expect(repeated.reason).toBe("cooldown-active");

		const repeatedDispatch = resolveContextWatchSteeringDispatch({
			userNotifyEnabled: true,
			assessmentLevel: "checkpoint",
			lastAnnouncedLevel: "checkpoint",
			elapsedMs: 1_000,
			cooldownMs: 600_000,
			forceWarnCadenceAnnouncement: false,
			forceFinalTurnAnnouncement: repeated.force,
		});
		expect(repeatedDispatch.shouldSignal).toBe(false);

		const levelChanged = resolveFinalTurnAnnouncementDispatch({
			reason: "message_end",
			finalTurnCloseWindow: true,
			nowMs,
			cooldownMs: 600_000,
			assessmentLevel: "compact",
			assessmentAction: "compact-now",
			lastSteeringSignal: {
				atIso: new Date(nowMs - 1_000).toISOString(),
				reason: "message_end",
				level: "checkpoint",
				action: "write-checkpoint",
			},
		});
		expect(levelChanged.force).toBe(true);
		expect(levelChanged.reason).toBe("state-changed");

		const cooldownElapsed = resolveFinalTurnAnnouncementDispatch({
			reason: "message_end",
			finalTurnCloseWindow: true,
			nowMs,
			cooldownMs: 1_000,
			assessmentLevel: "checkpoint",
			assessmentAction: "write-checkpoint",
			lastSteeringSignal: {
				atIso: new Date(nowMs - 5_000).toISOString(),
				reason: "message_end",
				level: "checkpoint",
				action: "write-checkpoint",
			},
		});
		expect(cooldownElapsed.force).toBe(true);
		expect(cooldownElapsed.reason).toBe("cooldown-elapsed");
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

		const timeoutPressure = resolveContextWatchOperatorSignal({
			reloadRequired: false,
			handoffManualRefreshRequired: false,
			timeoutPressureActive: true,
		});
		expect(timeoutPressure.humanActionRequired).toBe(true);
		expect(timeoutPressure.reasons).toContain("timeout-pressure");

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
			autoCompactDecision: "not-idle",
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
		expect(resolveContextWatchDeterministicStopSignal({
			assessmentLevel: "compact",
			operatorSignal: { reasons: [] },
			autoCompactDecision: "not-idle",
		})).toEqual({
			required: true,
			reason: "compact-final-warning",
			action: "stop-and-let-auto-compact",
		});
		expect(resolveContextWatchDeterministicStopSignal({
			assessmentLevel: "compact",
			operatorSignal: { reasons: [] },
			autoCompactDecision: "trigger",
		})).toEqual({ required: false, reason: "none", action: "none" });
		expect(resolveContextWatchDeterministicStopSignal({
			assessmentLevel: "checkpoint",
			operatorSignal: { reasons: ["timeout-pressure"] },
			autoCompactDecision: "cooldown",
		})).toEqual({
			required: true,
			reason: "timeout-pressure",
			action: "stop-and-let-auto-compact",
		});
		expect(describeContextWatchDeterministicStopHint({
			required: true,
			reason: "compact-final-warning",
			action: "stop-and-let-auto-compact",
		})).toContain("do not start another run");
		expect(describeContextWatchDeterministicStopHint({
			required: false,
			reason: "none",
			action: "none",
		})).toBeUndefined();
		expect(describeContextWatchDeterministicStopHint({
			required: true,
			reason: "timeout-pressure",
			action: "stop-and-let-auto-compact",
		})).toContain("timeout pressure");
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
			deterministicStop: { required: true, reason: "compact-final-warning", action: "stop-and-let-auto-compact" },
			operatorSignal: { reasons: [] },
		})).toEqual({
			blocking: true,
			kind: "compact-final-warning",
			summary: "stop current slice and let auto-compact complete before next run",
		});
		expect(resolveContextWatchOperatorActionPlan({
			deterministicStop: { required: true, reason: "timeout-pressure", action: "stop-and-let-auto-compact" },
			operatorSignal: { reasons: [] },
		})).toEqual({
			blocking: true,
			kind: "timeout-pressure",
			summary: "provider timeout pressure near compact boundary; pause new slices and retry when stable",
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
		expect(isProviderRequestTimeoutError("Error: Request timed out.")).toBe(true);
		expect(isProviderRequestTimeoutError("network unavailable")).toBe(false);
		expect(composeAutoResumeSuppressionHint({
			reason: "reload-required",
			timeoutPressureActive: true,
			timeoutPressureCount: 3,
			timeoutPressureThreshold: 2,
		})).toContain("provider timeout pressure observed (3/2)");
	});

	it("keeps reload-required visible across compact, operator, stop, and action planning", () => {
		const preCompact = resolvePreCompactReloadSignal({
			assessmentLevel: "ok",
			reloadRequired: true,
		});
		expect(preCompact).toMatchObject({
			active: false,
			reason: "level-not-precompact",
		});
		expect(preCompact.hint).toContain("/reload");
		expect(resolveContextWatchCompactStageNextAction({
			reloadGate: preCompact.reason,
			reloadHint: preCompact.hint,
			shouldForceCompact: false,
			shouldGracefulStop: false,
		})).toContain("/reload");

		const operatorSignal = resolveContextWatchOperatorSignal({
			reloadRequired: true,
			handoffManualRefreshRequired: false,
		});
		expect(operatorSignal.reasons).toContain("reload-required");
		expect(operatorSignal.humanActionRequired).toBe(true);

		const deterministicStop = resolveContextWatchDeterministicStopSignal({
			assessmentLevel: "ok",
			operatorSignal,
		});
		expect(deterministicStop).toEqual({
			required: true,
			reason: "reload-required",
			action: "reload-and-resume",
		});

		expect(resolveContextWatchOperatorActionPlan({
			deterministicStop,
			operatorSignal,
		})).toEqual({
			blocking: true,
			kind: "reload",
			summary: "reload required before continuing long-run",
			commandHint: "/reload",
		});
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
				"verification linked: VER-BUD-225 passed",
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
		expect(checkpoint.slice_memory).toMatchObject({
			focus: "TASK-BUD-225",
		});
		expect((checkpoint.slice_memory as any).canonical_links).toEqual(expect.arrayContaining([
			"task:TASK-BUD-225",
			"verification:VER-BUD-225",
			"commit:abc1234",
		]));
	});

	it("embeds growth maturity snapshot in local slice checkpoint when provided", () => {
		const checkpoint = buildLocalSliceHandoffCheckpoint({
			timestampIso: "2026-04-30T00:22:00.000Z",
			taskId: "TASK-BUD-225",
			context: "checkpoint with growth maturity snapshot",
			growthDecision: "hold",
			growthScore: 78,
			growthRecommendationCode: "growth-maturity-hold-maintain",
		}) as any;

		expect(checkpoint.context_watch?.growth_maturity).toMatchObject({
			decision: "hold",
			score: 78,
			recommendationCode: "growth-maturity-hold-maintain",
		});
		expect(checkpoint.context_watch_events?.[0]?.growth_maturity).toMatchObject({
			decision: "hold",
			score: 78,
			recommendationCode: "growth-maturity-hold-maintain",
		});
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
		expect((checkpoint as any).context_watch_events).toBeUndefined();
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

	it("adapta resumo de status em warn/checkpoint durante cooldown", () => {
		const full = "context-watch-status: level=warn percent=61 action=continue";
		const first = resolveContextWatchAdaptiveStatusSummary({
			level: "warn",
			summary: full,
			nowMs: 10_000,
			cooldownMs: 60_000,
		});
		expect(first.mode).toBe("full");
		expect(first.summary).toBe(full);

		const second = resolveContextWatchAdaptiveStatusSummary({
			level: "warn",
			summary: full,
			nowMs: 20_000,
			lastLevel: "warn",
			lastEmittedAtMs: 10_000,
			cooldownMs: 60_000,
		});
		expect(second.mode).toBe("compact");
		expect(second.summary).toContain("mode=compact-output");
		expect(second.cooldownRemainingSec).toBeGreaterThan(0);

		const third = resolveContextWatchAdaptiveStatusSummary({
			level: "compact",
			summary: "context-watch-status: level=compact",
			nowMs: 25_000,
			lastLevel: "compact",
			lastEmittedAtMs: 20_000,
			cooldownMs: 60_000,
		});
		expect(third.mode).toBe("full");
	});



});
