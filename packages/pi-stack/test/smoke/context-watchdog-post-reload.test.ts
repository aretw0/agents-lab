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
	formatTimeoutPressureSummary,
	formatContextWatchCompactStageStatusSummary,
	resolveContextWatchAdaptiveStatusSummary,
	formatContextWatchAutoResumePreviewSummary,
	formatContextWatchContinuationReadinessSummary,
	consumeContextPreloadPack,
	resolveContextWatchContinuationRecommendation,
	formatContextWatchOneSliceCanaryPreviewSummary,
	formatContextWatchOneSliceOperatorPacketPreviewSummary,
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

	it("context_watch_status exposes deferred post-reload auto-resume intent in autoCompact details", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-tool-status-post-reload-intent-"));
		try {
			mkdirSync(join(cwd, ".project"), { recursive: true });
			writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
				timestamp: new Date().toISOString(),
				context_watch: {
					auto_resume_after_reload: {
						pending: true,
						createdAtIso: "2026-05-04T06:30:00.000Z",
						reason: "reload-required-after-compact",
						focusTasks: ["TASK-BUD-742", "TASK-BUD-743"],
					},
				},
			}, null, 2), "utf8");
			const pi = makeMockPi();
			contextWatchdogExtension(pi);
			const tool = getTool(pi, "context_watch_status");
			const result = await tool.execute(
				"tc-context-watch-status-post-reload-intent",
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
			expect(result.content?.[0]?.text).toContain("postReloadResume=pending");
			expect((result.details as { autoCompact?: { autoResumeAfterReloadPending?: boolean } } | undefined)?.autoCompact?.autoResumeAfterReloadPending).toBe(true);
			expect((result.details as { autoCompact?: { autoResumeAfterReloadIntent?: { reason?: string } } } | undefined)?.autoCompact?.autoResumeAfterReloadIntent?.reason)
				.toBe("reload-required-after-compact");

			const clearedHandoff = clearAutoResumeAfterReloadIntent(JSON.parse(readFileSync(join(cwd, ".project", "handoff.json"), "utf8")));
			writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify(clearedHandoff, null, 2), "utf8");
			const clearedResult = await tool.execute(
				"tc-context-watch-status-post-reload-intent-cleared",
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
			expect((clearedResult.details as { autoCompact?: { autoResumeAfterReloadPending?: boolean } } | undefined)?.autoCompact?.autoResumeAfterReloadPending).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("dispatches deferred post-reload auto-resume on session_start when gates are green", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-post-reload-dispatch-"));
		try {
			mkdirSync(join(cwd, ".project"), { recursive: true });
			writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({
				tasks: [
					{ id: "TASK-BUD-745", status: "planned", description: "post-reload follow-up" },
				],
			}, null, 2), "utf8");
			writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
				timestamp: new Date().toISOString(),
				current_tasks: ["TASK-BUD-745"],
				context_watch: {
					auto_resume_after_reload: {
						pending: true,
						createdAtIso: "2026-05-04T06:50:00.000Z",
						reason: "reload-required-after-compact",
						focusTasks: ["TASK-BUD-745"],
					},
				},
				context_watch_events: [
					{
						atIso: new Date().toISOString(),
						reason: "manual_checkpoint",
						level: "checkpoint",
						percent: 52,
						thresholds: { warnPct: 45, checkpointPct: 55, compactPct: 64 },
						action: "checkpoint-refresh",
						recommendation: "ready for resume",
					},
				],
			}, null, 2), "utf8");
			const handlers = new Map<string, (...args: unknown[]) => unknown>();
			const pi = {
				on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
					handlers.set(event, handler);
				}),
				registerTool: vi.fn(),
				registerCommand: vi.fn(),
				sendUserMessage: vi.fn(),
				appendEntry: vi.fn(),
			} as unknown as Parameters<typeof contextWatchdogExtension>[0];
			contextWatchdogExtension(pi);
			const sessionStart = handlers.get("session_start");
			expect(typeof sessionStart).toBe("function");
			await (sessionStart as (event: unknown, ctx: unknown) => Promise<void> | void)({}, {
				cwd,
				ui: {
					notify() {},
					setStatus() {},
				},
				getContextUsage: () => ({ percent: 12 }),
				model: { id: "test-model", provider: "test" },
				isIdle: () => true,
				hasPendingMessages: () => false,
				compact() {},
			} as any);
			expect((pi.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
			expect((pi.appendEntry as ReturnType<typeof vi.fn>).mock.calls.some(([type]) => type === "context-watchdog.auto-resume-post-reload-dispatch"))
				.toBe(true);
			const written = JSON.parse(readFileSync(join(cwd, ".project", "handoff.json"), "utf8")) as Record<string, unknown>;
			expect(readAutoResumeAfterReloadIntent(written)).toBeUndefined();
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("keeps deferred post-reload intent when dispatch is blocked by pending messages or lane queue", async () => {
		const runCase = async (opts: { id: string; hasPendingMessages: boolean; queuedLaneIntents: boolean }) => {
			const cwd = mkdtempSync(join(tmpdir(), `ctx-post-reload-pending-${opts.id}-`));
			try {
				mkdirSync(join(cwd, ".project"), { recursive: true });
				writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({
					tasks: [
						{ id: "TASK-BUD-749", status: "planned", description: "post-reload pending path" },
					],
				}, null, 2), "utf8");
				writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
					timestamp: new Date().toISOString(),
					current_tasks: ["TASK-BUD-749"],
					context_watch: {
						auto_resume_after_reload: {
							pending: true,
							createdAtIso: "2026-05-04T06:55:00.000Z",
							reason: "reload-required-after-compact",
							focusTasks: ["TASK-BUD-749"],
						},
					},
					context_watch_events: [
						{
							atIso: new Date().toISOString(),
							reason: "manual_checkpoint",
							level: "checkpoint",
							percent: 53,
							thresholds: { warnPct: 45, checkpointPct: 55, compactPct: 64 },
							action: "checkpoint-refresh",
							recommendation: "ready for resume",
						},
					],
				}, null, 2), "utf8");
				if (opts.queuedLaneIntents) {
					mkdirSync(join(cwd, ".pi"), { recursive: true });
					writeFileSync(join(cwd, ".pi", "deferred-intents.json"), JSON.stringify({
						version: 1,
						items: [{ text: "deferred task" }],
					}, null, 2), "utf8");
				}
				const handlers = new Map<string, (...args: unknown[]) => unknown>();
				const pi = {
					on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
						handlers.set(event, handler);
					}),
					registerTool: vi.fn(),
					registerCommand: vi.fn(),
					sendUserMessage: vi.fn(),
					appendEntry: vi.fn(),
				} as unknown as Parameters<typeof contextWatchdogExtension>[0];
				contextWatchdogExtension(pi);
				const sessionStart = handlers.get("session_start");
				expect(typeof sessionStart).toBe("function");
				await (sessionStart as (event: unknown, ctx: unknown) => Promise<void> | void)({}, {
					cwd,
					ui: {
						notify() {},
						setStatus() {},
					},
					getContextUsage: () => ({ percent: 10 }),
					model: { id: "test-model", provider: "test" },
					isIdle: () => true,
					hasPendingMessages: () => opts.hasPendingMessages,
					compact() {},
				} as any);
				expect((pi.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
				expect((pi.appendEntry as ReturnType<typeof vi.fn>).mock.calls.some(([type]) => type === "context-watchdog.auto-resume-post-reload-pending"))
					.toBe(true);
				const written = JSON.parse(readFileSync(join(cwd, ".project", "handoff.json"), "utf8")) as Record<string, unknown>;
				expect(readAutoResumeAfterReloadIntent(written)).toBeTruthy();
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		};

		await runCase({ id: "pending-messages", hasPendingMessages: true, queuedLaneIntents: false });
		await runCase({ id: "lane-queue", hasPendingMessages: false, queuedLaneIntents: true });
	});

	it("dedupes repeated post-reload pending warnings for unchanged checkpoint evidence gaps", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-post-reload-warning-dedupe-"));
		try {
			mkdirSync(join(cwd, ".project"), { recursive: true });
			writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({
				tasks: [
					{ id: "TASK-BUD-749", status: "planned", description: "post-reload checkpoint evidence missing" },
				],
			}, null, 2), "utf8");
			writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
				timestamp: new Date().toISOString(),
				current_tasks: ["TASK-BUD-749"],
				context_watch: {
					auto_resume_after_reload: {
						pending: true,
						createdAtIso: "2026-05-04T08:00:00.000Z",
						reason: "reload-required-after-compact",
						focusTasks: ["TASK-BUD-749"],
					},
				},
			}, null, 2), "utf8");
			const notifications: string[] = [];
			const handlers = new Map<string, (...args: unknown[]) => unknown>();
			const pi = {
				on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
					handlers.set(event, handler);
				}),
				registerTool: vi.fn(),
				registerCommand: vi.fn(),
				sendUserMessage: vi.fn(),
				appendEntry: vi.fn(),
			} as unknown as Parameters<typeof contextWatchdogExtension>[0];
			contextWatchdogExtension(pi);
			const sessionStart = handlers.get("session_start");
			expect(typeof sessionStart).toBe("function");
			const runSessionStart = () => (sessionStart as (event: unknown, ctx: unknown) => Promise<void> | void)({}, {
				cwd,
				ui: {
					notify(msg: string) {
						notifications.push(msg);
					},
					setStatus() {},
				},
				getContextUsage: () => ({ percent: 10 }),
				model: { id: "test-model", provider: "test" },
				isIdle: () => true,
				hasPendingMessages: () => false,
				compact() {},
			} as any);

			await runSessionStart();
			await runSessionStart();

			const pendingWarnings = notifications.filter((msg) =>
				msg.includes("context-watch: post-reload auto resume pending (checkpoint-evidence-missing)"),
			);
			expect(pendingWarnings).toHaveLength(1);
			expect((pi.appendEntry as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === "context-watchdog.auto-resume-post-reload-pending"))
				.toHaveLength(1);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

});
