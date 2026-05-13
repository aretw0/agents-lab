import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readContextWatchFreshnessSignals } from "../../extensions/context-watchdog-freshness";
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
} from "../../extensions/context-watchdog";


describe("context-watchdog handoff and bootstrap", () => {
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

	it("detects stale or divergent handoff focus against board state", () => {
		const nowMs = Date.parse("2026-05-01T00:10:00Z");
		expect(resolveHandoffBoardReconciliation({
			handoff: {
				timestamp: "2026-05-01T00:09:30Z",
				current_tasks: ["TASK-A"],
			},
			taskStatusById: { "TASK-A": "in-progress" },
			nowMs,
			maxFreshAgeMs: 60_000,
		})).toMatchObject({ ok: true, reason: "fresh", blockers: [] });

		const stale = resolveHandoffBoardReconciliation({
			handoff: {
				timestamp: "2026-05-01T00:00:00Z",
				current_tasks: ["TASK-A"],
			},
			taskStatusById: { "TASK-A": "in-progress" },
			nowMs,
			maxFreshAgeMs: 60_000,
		});
		expect(stale.ok).toBe(false);
		expect(stale.blockers).toContain("stale-hand-off");

		const divergent = resolveHandoffBoardReconciliation({
			handoff: {
				timestamp: "2026-05-01T00:09:30Z",
				current_tasks: ["TASK-DONE", "TASK-MISSING", "TASK-BLOCKED"],
			},
			taskStatusById: {
				"TASK-DONE": "completed",
				"TASK-BLOCKED": "blocked",
			},
			nowMs,
			maxFreshAgeMs: 60_000,
		});
		expect(divergent.ok).toBe(false);
		expect(divergent.blockers).toEqual(["missing-task", "completed-focus", "board-handoff-divergence"]);
		expect(divergent.summary).toContain("blockers=missing-task|completed-focus|board-handoff-divergence");
	});

	it("reconciles stale handoff focus and emits pre-compact idle-prep hints deterministically", () => {
		const reconcile = reconcileAutoResumeHandoffFocus({
			handoff: { current_tasks: ["TASK-DONE", "TASK-MISSING", "TASK-RUN"] },
			taskStatusById: {
				"TASK-DONE": "completed",
				"TASK-RUN": "in-progress",
				"TASK-NEXT": "planned",
			},
			preferredTaskIds: ["TASK-NEXT"],
			maxTasks: 3,
		});
		expect(reconcile.changed).toBe(true);
		expect(reconcile.reason).toBe("filtered-focus");
		expect(reconcile.nextFocus).toEqual(["TASK-RUN"]);
		expect(reconcile.droppedFocus).toEqual(["TASK-DONE", "TASK-MISSING"]);

		const fallback = reconcileAutoResumeHandoffFocus({
			handoff: { current_tasks: ["TASK-DONE"] },
			taskStatusById: {
				"TASK-DONE": "completed",
				"TASK-NEXT": "planned",
			},
			preferredTaskIds: ["TASK-NEXT"],
			maxTasks: 3,
		});
		expect(fallback.changed).toBe(true);
		expect(fallback.reason).toBe("preferred-fallback");
		expect(fallback.nextFocus).toEqual(["TASK-NEXT"]);

		const prep = resolvePreCompactIdlePrepDispatch({
			assessmentLevel: "checkpoint",
			decisionReason: "not-idle",
			nowMs: 10_000,
			lastNotifyAtMs: 0,
			cooldownMs: 2_000,
		});
		expect(prep.shouldNotify).toBe(true);
		expect(prep.reason).toBe("emit");
		expect(prep.recommendation).toContain("idle");

		const prepCooldown = resolvePreCompactIdlePrepDispatch({
			assessmentLevel: "checkpoint",
			decisionReason: "pending-messages",
			nowMs: 11_000,
			lastNotifyAtMs: 10_500,
			cooldownMs: 2_000,
		});
		expect(prepCooldown.shouldNotify).toBe(false);
		expect(prepCooldown.reason).toBe("cooldown");

		const timeoutPrep = resolvePreCompactIdlePrepDispatch({
			assessmentLevel: "checkpoint",
			decisionReason: "checkpoint-evidence-missing",
			nowMs: 20_000,
			lastNotifyAtMs: 0,
			cooldownMs: 2_000,
			timeoutPressureActive: true,
		});
		expect(timeoutPrep.shouldNotify).toBe(true);
		expect(timeoutPrep.reason).toBe("emit-timeout-pressure");
		expect(timeoutPrep.recommendation).toContain("timeout-pressure");
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
		expect((control.patch.piStack as any).contextWatchdog.checkpointPct).toBe(55);
		expect((control.patch.piStack as any).contextWatchdog.compactPct).toBe(65);
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
});
