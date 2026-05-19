import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readContextWatchFreshnessSignals } from "../../extensions/context-watchdog-freshness";
import contextWatchdogExtension from "../../extensions/context-watchdog";
import contextWatchdogSurfacesExtension from "../../extensions/context-watchdog-surfaces";
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
	toSessionWorkspaceKey,
	writeLocalSliceHandoffCheckpoint,
} from "../../extensions/context-watchdog-exports";


describe("context-watchdog tool surfaces", () => {
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

	it("context_watch_compact_stage_status tool is read-only and reports stage in non-git cwd", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-tool-compact-stage-"));
		try {
			const pi = makeMockPi();
			contextWatchdogSurfacesExtension(pi);
			const tool = getTool(pi, "context_watch_compact_stage_status");
			const result = await tool.execute(
				"tc-context-watch-compact-stage-status",
				{},
				undefined as unknown as AbortSignal,
				() => {},
				{
					cwd,
					getContextUsage: () => ({ percent: 61 }),
					model: { id: "gpt-5.3-codex", provider: "github-copilot" },
					isIdle: () => true,
					hasPendingMessages: () => false,
				} as any,
			);
			expect(result.content?.[0]?.text).toContain("context-watch-compact-stage-status:");
			expect(result.content?.[0]?.text).toContain("authorization=none");
			expect(result.details).toMatchObject({
				mode: "read-only-compact-stage",
				authorization: "none",
				dispatchAllowed: false,
				autoCompactTelemetry: {
					candidateOrigin: "checkpoint-window",
					triggerOrigin: "none",
					checkpointWindowEligible: true,
					checkpointEvidenceReady: false,
				},
				signalNoise: {
					windowMs: 600_000,
					announcementsInWindow: 0,
					maxAnnouncementsPerWindow: 4,
					finalTurnSuppressionsInWindow: 0,
					excessive: false,
				},
				compactStage: {
					stage: "graceful-stop-window",
					shouldGracefulStop: true,
					shouldForceCompact: false,
				},
				preCompactReloadSignal: {
					active: false,
					reason: "reload-not-required",
				},
			});
			expect(formatContextWatchCompactStageStatusSummary({
				stage: "graceful-stop-window",
				level: "checkpoint",
				checkpointPct: 60,
				compactPct: 65,
				reloadGate: "reload-required-checkpoint",
				nextAction: "run /reload and continue from handoff checkpoint",
			})).toContain("checkpoint=60 compact=65");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("context_watch_compact_stage_status reflects model-aware threshold profile", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-tool-compact-stage-thresholds-"));
		try {
			const pi = makeMockPi();
			contextWatchdogSurfacesExtension(pi);
			const tool = getTool(pi, "context_watch_compact_stage_status");
			const result = await tool.execute(
				"tc-context-watch-compact-stage-thresholds",
				{},
				undefined as unknown as AbortSignal,
				() => {},
				{
					cwd,
					getContextUsage: () => ({ percent: 80 }),
					model: { id: "claude-sonnet", provider: "anthropic" },
					isIdle: () => true,
					hasPendingMessages: () => false,
				} as any,
			);
			expect(result.details?.thresholds).toMatchObject({ checkpointPct: 55, compactPct: 65 });
			expect(result.details?.compactStage).toMatchObject({ stage: "force-compact-window" });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("context_watch_status tool emits compact content and structured details", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-tool-status-"));
		try {
			const pi = makeMockPi();
			contextWatchdogSurfacesExtension(pi);
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
			expect(result.content?.[0]?.text).toBe("context-watch-status: level=ok percent=14 action=continue autoCompact=level-not-compact operator=none cadence=standard-slices handoff=unknown reloadGate=reload-not-required timeoutPressure=none");
			expect(result.details).toMatchObject({
				level: "ok",
				percent: 14,
				summary: "context-watch-status: level=ok percent=14 action=continue autoCompact=level-not-compact operator=none cadence=standard-slices handoff=unknown reloadGate=reload-not-required timeoutPressure=none",
				reloadGate: "reload-not-required",
				timeoutPressureSummary: "none",
				compactStage: {
					stage: "normal-window",
					shouldGracefulStop: false,
					shouldForceCompact: false,
				},
				preCompactReloadSignal: {
					active: false,
					reason: "reload-not-required",
				},
				signalNoise: {
					windowMs: 600_000,
					announcementsInWindow: 0,
					maxAnnouncementsPerWindow: 4,
					finalTurnSuppressionsInWindow: 0,
					excessive: false,
				},
				dirtySignal: "unknown",
				preloadDecision: "fallback-canonical",
				gitDirty: {
					available: false,
					clean: null,
					rowCount: 0,
					summary: "git-dirty-snapshot: unavailable",
					error: "not-a-git-repo",
				},
				preload: {
					mode: "context-preload-consume",
					decision: "fallback-canonical",
					dispatchAllowed: false,
					authorization: "none",
				},
			});
			expect(result.details?.autoCompact).toBeTruthy();
			expect(result.details?.operatorAction).toBeTruthy();
			expect(formatContextWatchStatusToolSummary({ level: "ok", percent: 14, action: "continue" }))
				.toBe("context-watch-status: level=ok percent=14 action=continue");
			expect(formatContextWatchStatusToolSummary({
				level: "warn",
				percent: 58,
				action: "continue-bounded",
				handoffFreshness: "stale",
				handoffAgeSec: 120,
				handoffFreshThresholdSec: 90,
				timeoutPressureSummary: "2/2@600s",
			})).toContain("handoffAgeSec=120/90");
			expect(formatContextWatchStatusToolSummary({
				level: "warn",
				percent: 58,
				action: "continue-bounded",
				timeoutPressureSummary: "2/2@600s",
			})).toContain("timeoutPressure=2/2@600s");
			expect(formatTimeoutPressureSummary(undefined)).toBe("none");
			expect(formatTimeoutPressureSummary({ active: true, count: 3, threshold: 2, windowMs: 600_000 })).toBe("3/2@600s");
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

	it("context_watch_status surfaces handoff age and threshold metrics when timestamp is present", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-tool-status-handoff-age-"));
		try {
			mkdirSync(join(cwd, ".project"), { recursive: true });
			writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({
				tasks: [
					{
						id: "TASK-FOCUS",
						description: "[P1] canary pause context contract",
						status: "planned",
					},
				],
			}, null, 2), "utf8");
			writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
				timestamp: new Date(Date.now() - 120_000).toISOString(),
				current_tasks: ["TASK-FOCUS"],
			}, null, 2), "utf8");
			const pi = makeMockPi();
			contextWatchdogSurfacesExtension(pi);
			const tool = getTool(pi, "context_watch_status");
			const result = await tool.execute(
				"tc-context-watch-status-handoff-age",
				{},
				undefined as unknown as AbortSignal,
				() => {},
				{
					cwd,
					getContextUsage: () => ({ percent: 18 }),
					model: { id: "test-model", provider: "test" },
					isIdle: () => true,
					hasPendingMessages: () => false,
				} as any,
			);
			expect(Number(result.details?.handoffAgeSec)).toBeGreaterThanOrEqual(1);
			expect(Number(result.details?.handoffFreshThresholdSec)).toBeGreaterThanOrEqual(60);
			expect(String(result.content?.[0]?.text ?? "")).toContain("handoffAgeSec=");
			expect(result.details?.operatorBrief?.whyPaused).toBeTruthy();
			expect(result.details?.operatorBrief?.focusTaskId).toBe("TASK-FOCUS");
			expect(String(result.details?.operatorBrief?.focusMnemonic ?? "")).toContain("TASK-FOCUS");
			expect(Array.isArray(result.details?.operatorBrief?.options)).toBe(true);
			expect(typeof result.details?.operatorBrief?.recommendation).toBe("string");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("/context-watch status command includes compact noise budget summary", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-status-command-noise-"));
		try {
			const pi = makeMockPi();
			contextWatchdogSurfacesExtension(pi);
			const commandCall = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(([name]) => name === "context-watch");
			const command = commandCall?.[1] as {
				handler: (args: string, ctx: {
					cwd: string;
					ui: { notify: (msg: string, level?: string) => void; setStatus?: (k: string, v: string) => void };
					getContextUsage: () => { percent: number };
					model: { id: string; provider: string };
					isIdle: () => boolean;
					hasPendingMessages: () => boolean;
				}) => Promise<void> | void;
			};
			const notifications: Array<{ msg: string; level?: string }> = [];
			await command.handler("status", {
				cwd,
				ui: {
					notify(msg: string, level?: string) {
						notifications.push({ msg, level });
					},
					setStatus() {},
				},
				getContextUsage: () => ({ percent: 58 }),
				model: { id: "gpt-5.3-codex", provider: "github-copilot" },
				isIdle: () => false,
				hasPendingMessages: () => false,
			});

			expect(notifications.length).toBe(1);
			expect(notifications[0]?.msg).toContain("noise=0/4 suppressed=0 excessive=no");
			expect(notifications[0]?.msg).toContain("details=context_watch_status structured payload");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("reads git freshness as clean then dirty without stale state", () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-freshness-git-"));
		try {
			execFileSync("git", ["init"], { cwd, stdio: "pipe" });

			const clean = readContextWatchFreshnessSignals(cwd, "control-plane-core");
			expect(clean.dirtySignal).toBe("clean");
			expect(clean.gitDirty.clean).toBe(true);
			expect(clean.gitDirty.rowCount).toBe(0);

			writeFileSync(join(cwd, "untracked.txt"), "dirty\n", "utf8");
			const dirty = readContextWatchFreshnessSignals(cwd, "control-plane-core");
			expect(dirty.dirtySignal).toBe("dirty");
			expect(dirty.gitDirty.clean).toBe(false);
			expect(dirty.gitDirty.rowCount).toBe(1);
			expect(dirty.gitDirty.summary).toContain("clean=no");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("context_watch_freshness_status tool returns preload+dirty in one call", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-freshness-status-"));
		try {
			const pi = makeMockPi();
			contextWatchdogSurfacesExtension(pi);
			const tool = getTool(pi, "context_watch_freshness_status");
			const result = await tool.execute(
				"tc-context-watch-freshness-status",
				{},
				undefined as unknown as AbortSignal,
				() => {},
				{ cwd },
			);

			expect(result.content?.[0]?.text).toContain("context-watch-freshness-status:");
			expect(result.content?.[0]?.text).toContain("preload=fallback-canonical");
			expect(result.content?.[0]?.text).toContain("dirty=unknown");
			expect(result.details).toMatchObject({
				authorization: "none",
				dispatchAllowed: false,
				mode: "read-only-freshness",
				preloadDecision: "fallback-canonical",
				dirtySignal: "unknown",
				preload: {
					mode: "context-preload-consume",
					decision: "fallback-canonical",
				},
				gitDirty: {
					available: false,
					clean: null,
					rowCount: 0,
					summary: "git-dirty-snapshot: unavailable",
					error: "not-a-git-repo",
				},
			});
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("/context-watch freshness command reports preload+dirty snapshot", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-freshness-command-"));
		try {
			const pi = makeMockPi();
			contextWatchdogSurfacesExtension(pi);
			const commandCall = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(([name]) => name === "context-watch");
			const command = commandCall?.[1] as {
				handler: (args: string, ctx: { cwd: string; ui: { notify: (msg: string, level?: string) => void; setStatus?: (k: string, v: string) => void } }) => Promise<void> | void;
			};
			const notifications: Array<{ msg: string; level?: string }> = [];
			await command.handler("freshness", {
				cwd,
				ui: {
					notify(msg: string, level?: string) {
						notifications.push({ msg, level });
					},
					setStatus() {},
				},
			});

			expect(notifications.length).toBe(1);
			expect(notifications[0]?.msg).toContain("context-watch freshness:");
			expect(notifications[0]?.msg).toContain("preload=fallback-canonical");
			expect(notifications[0]?.msg).toContain("dirty=unknown");
			expect(notifications[0]?.msg).toContain("authorization=none");
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
			contextWatchdogSurfacesExtension(pi);
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
				reloadGate: {
					reloadRequired: false,
					reason: "clear",
				},
			});
			expect(result.details?.diagnostics?.focusTasksListed).toEqual([]);
			expect(result.details?.prompt).not.toContain("focusTasks: TASK-BUD-309");
			expect(formatContextWatchAutoResumePreviewSummary({
				focusTasks: "none-listed",
				staleFocusCount: 1,
				diagnosticsSummary: "tasks(in=0,listed=0,dedup=0,trunc=0,drop=0) staleFocus=1 global=ok",
				reloadGate: "required",
				reloadHint: "run /reload and continue from handoff checkpoint",
			})).toContain("reload=required");
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
				{ id: "TASK-BUD-317", description: "[P1] resumir foco de forma humana", status: "in-progress", files: ["packages/pi-stack/extensions/context-watchdog.ts"] },
				{ id: "TASK-BUD-296", status: "planned", files: ["packages/pi-stack/extensions/context-watchdog-handoff.ts"] },
			] }));
			const pi = makeMockPi();
			contextWatchdogSurfacesExtension(pi);
			const tool = getTool(pi, "context_watch_auto_resume_preview");
			const result = await tool.execute("tc-auto-resume-active-focus", {}, undefined as unknown as AbortSignal, () => {}, { cwd });

			expect(result.content?.[0]?.text).toContain("focusTasks=TASK-BUD-317");
			expect(result.content?.[0]?.text).toContain("focusMnemonics=TASK-BUD-317:resumir_foco_de_forma_humana");
			expect(result.content?.[0]?.text).toContain("staleFocus=1");
			expect(result.details?.focusTasks).toBe("TASK-BUD-317");
			expect(result.details?.focusMnemonics).toContain("TASK-BUD-317:resumir foco de forma humana");
			expect(result.details?.staleFocus).toBe("TASK-BUD-316=completed");
			expect(result.details?.diagnostics?.focusTasksListed).toEqual(["TASK-BUD-317"]);
			expect(result.details?.prompt).not.toContain("focusTasks: board-task-selection");
			expect(result.details?.prompt).not.toContain("focusTasks: TASK-BUD-316");
			expect(result.details?.prompt).not.toContain("TASK-BUD-296");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("context_watch_auto_resume_preview skips protected parked successor tasks", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-auto-resume-protected-successor-"));
		try {
			mkdirSync(join(cwd, ".project"), { recursive: true });
			writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
				timestamp: "2026-04-30T05:43:29.396Z",
				completed_tasks: ["TASK-BUD-944"],
				next_actions: ["select next local-safe task via board; do not resume TASK-BUD-999"],
				context: "TASK-BUD-944 completed; choose local-safe successor only, not parked TASK-BUD-999.",
				blockers: [],
				slice_memory: { canonical_links: ["task:TASK-BUD-999"] },
			}));
			writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [
				{ id: "TASK-BUD-944", status: "completed" },
				{ id: "TASK-BUD-999", description: "external influence parked", status: "planned", milestone: "protected-parked-legacy" },
				{ id: "TASK-BUD-998", description: "local-safe docs cleanup", status: "planned", milestone: "signal-integrity-calibration", files: ["docs/research/local.md"] },
			] }));
			const pi = makeMockPi();
			contextWatchdogSurfacesExtension(pi);
			const tool = getTool(pi, "context_watch_auto_resume_preview");
			const result = await tool.execute("tc-auto-resume-protected-successor", {}, undefined as unknown as AbortSignal, () => {}, { cwd });

			expect(result.content?.[0]?.text).toContain("focusTasks=TASK-BUD-998");
			expect(result.content?.[0]?.text).not.toContain("TASK-BUD-999");
			expect(result.details?.focusTasks).toBe("TASK-BUD-998");
			expect(result.details?.diagnostics?.focusTasksListed).toEqual(["TASK-BUD-998"]);
			expect(result.details?.prompt).not.toContain("TASK-BUD-999");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("context_watch_auto_resume_preview skips planned p3 backlog successors", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-auto-resume-p3-successor-"));
		try {
			mkdirSync(join(cwd, ".project"), { recursive: true });
			writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
				timestamp: "2026-04-30T05:43:29.396Z",
				completed_tasks: ["TASK-BUD-945"],
				next_actions: ["select next local-safe task via board; leave TASK-BUD-999 in p3 backlog"],
				context: "TASK-BUD-945 completed; TASK-BUD-999 remains low-priority operator noise backlog.",
				blockers: [],
				slice_memory: { canonical_links: ["task:TASK-BUD-999"] },
			}));
			writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [
				{ id: "TASK-BUD-945", status: "completed" },
				{ id: "TASK-BUD-999", description: "low priority operator-noise backlog", status: "planned", priority: "p3", milestone: "operator-noise-backlog" },
				{ id: "TASK-BUD-998", description: "higher priority local-safe successor", status: "planned", priority: "p1", milestone: "signal-integrity-calibration", files: ["docs/research/local.md"] },
			] }));
			const pi = makeMockPi();
			contextWatchdogSurfacesExtension(pi);
			const tool = getTool(pi, "context_watch_auto_resume_preview");
			const result = await tool.execute("tc-auto-resume-p3-successor", {}, undefined as unknown as AbortSignal, () => {}, { cwd });

			expect(result.content?.[0]?.text).toContain("focusTasks=TASK-BUD-998");
			expect(result.content?.[0]?.text).not.toContain("TASK-BUD-999");
			expect(result.details?.focusTasks).toBe("TASK-BUD-998");
			expect(result.details?.diagnostics?.focusTasksListed).toEqual(["TASK-BUD-998"]);
			expect(result.details?.prompt).not.toContain("TASK-BUD-999");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("consumeContextPreloadPack aplica fallback canônico quando pack está stale", () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-preload-consume-"));
		try {
			mkdirSync(join(cwd, ".project"), { recursive: true });
			mkdirSync(join(cwd, ".sandbox", "pi-agent", "preload"), { recursive: true });
			writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({ current_tasks: ["TASK-BUD-1"] }));
			writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [{ id: "TASK-BUD-1", status: "planned" }] }));
			writeFileSync(join(cwd, ".project", "verification.json"), JSON.stringify({ verification: [] }));

			const fingerprint = consumeContextPreloadPack(cwd, { packPath: "missing-pack.json" }).currentCanonicalState.fingerprint;
			const packPath = join(cwd, ".sandbox", "pi-agent", "preload", "context-preload-pack.json");
			writeFileSync(packPath, JSON.stringify({
				generatedAtIso: new Date().toISOString(),
				preloadPack: {
					controlPlaneCore: [".project/handoff.json", ".project/tasks.json"],
					agentWorkerLean: [".project/handoff.json"],
					swarmScoutMin: [".project/handoff.json"],
				},
				canonicalState: { fingerprint },
			}));

			const fresh = consumeContextPreloadPack(cwd, { profile: "agent-worker-lean" });
			expect(fresh.decision).toBe("use-pack");
			expect(fresh.selectedPaths).toEqual([".project/handoff.json"]);

			const tasksPath = join(cwd, ".project", "tasks.json");
			const fingerprintBeforeMutation = consumeContextPreloadPack(cwd, { profile: "control-plane-core" }).currentCanonicalState.fingerprint;
			let fingerprintAfterMutation = fingerprintBeforeMutation;
			for (let attempt = 0; attempt < 4 && fingerprintAfterMutation === fingerprintBeforeMutation; attempt += 1) {
				writeFileSync(tasksPath, JSON.stringify({ tasks: [{ id: "TASK-BUD-1", status: "in-progress", attempt }] }));
				fingerprintAfterMutation = consumeContextPreloadPack(cwd, { profile: "control-plane-core" }).currentCanonicalState.fingerprint;
				if (fingerprintAfterMutation === fingerprintBeforeMutation) {
					const waitUntil = Date.now() + 5;
					while (Date.now() < waitUntil) {
						// stabilize low-resolution filesystem mtime edges for deterministic stale assertion.
					}
				}
			}
			expect(fingerprintAfterMutation).not.toBe(fingerprintBeforeMutation);
			const stale = consumeContextPreloadPack(cwd, { profile: "control-plane-core" });
			expect(stale.decision).toBe("fallback-canonical");
			expect(stale.staleReasons).toContain("canonical-state-changed");
			expect(stale.selectedPaths).toEqual([
				".project/handoff.json",
				".project/tasks.json",
				".project/verification.json",
			]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("context_preload_consume tool returns read-only decision envelope", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-preload-tool-"));
		try {
			mkdirSync(join(cwd, ".project"), { recursive: true });
			mkdirSync(join(cwd, ".sandbox", "pi-agent", "preload"), { recursive: true });
			writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({ current_tasks: ["TASK-BUD-2"] }));
			writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [{ id: "TASK-BUD-2", status: "planned" }] }));
			writeFileSync(join(cwd, ".project", "verification.json"), JSON.stringify({ verification: [] }));
			const fingerprint = consumeContextPreloadPack(cwd, { packPath: "missing-pack.json" }).currentCanonicalState.fingerprint;
			writeFileSync(join(cwd, ".sandbox", "pi-agent", "preload", "context-preload-pack.json"), JSON.stringify({
				generatedAtIso: new Date().toISOString(),
				preloadPack: {
					controlPlaneCore: [".project/handoff.json"],
					agentWorkerLean: [".project/handoff.json"],
					swarmScoutMin: [".project/handoff.json"],
				},
				canonicalState: { fingerprint },
			}));

			const pi = makeMockPi();
			contextWatchdogSurfacesExtension(pi);
			const tool = getTool(pi, "context_preload_consume");
			const result = await tool.execute(
				"tc-context-preload-consume",
				{ profile: "control-plane-core" },
				undefined as unknown as AbortSignal,
				() => {},
				{ cwd } as any,
			);

			expect(result.content?.[0]?.text).toContain("context-preload-consume:");
			expect(result.details).toMatchObject({
				mode: "context-preload-consume",
				dispatchAllowed: false,
				decision: "use-pack",
				profileResolved: "control-plane-core",
			});
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("context_preload_pack tool writes operator-requested cache from read telemetry", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-preload-pack-tool-"));
		try {
			mkdirSync(join(cwd, ".project"), { recursive: true });
			writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({ current_tasks: ["TASK-BUD-3"] }));
			writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [{ id: "TASK-BUD-3", status: "planned" }] }));
			writeFileSync(join(cwd, ".project", "verification.json"), JSON.stringify({ verification: [] }));
			const sessionDir = join(cwd, ".sandbox", "pi-agent", "sessions", toSessionWorkspaceKey(cwd));
			mkdirSync(sessionDir, { recursive: true });
			writeFileSync(join(sessionDir, "session.jsonl"), `${JSON.stringify({
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", name: "read", arguments: { path: join(cwd, ".project", "handoff.json") } },
						{ type: "toolCall", name: "read", arguments: { path: join(cwd, "packages", "pi-stack", "README.md") } },
					],
				},
			})}\n`);

			const pi = makeMockPi();
			contextWatchdogSurfacesExtension(pi);
			const tool = getTool(pi, "context_preload_pack");
			const result = await tool.execute(
				"tc-context-preload-pack",
				{ write: true, days: 1, limit: 4, top: 8 },
				undefined as unknown as AbortSignal,
				() => {},
				{ cwd } as any,
			);
			const packPath = join(cwd, ".sandbox", "pi-agent", "preload", "context-preload-pack.json");

			expect(result.content?.[0]?.text).toContain("context-preload-pack:");
			expect(result.details).toMatchObject({
				written: true,
				effect: "write-cache",
				mode: "operator-requested-cache-write",
				authorization: "explicit-operator",
			});
			expect(result.details?.topReads).toEqual(expect.arrayContaining([
				expect.objectContaining({ file: ".project/handoff.json", class: "project" }),
			]));
			expect(existsSync(packPath)).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("inclui links canônicos do slice_memory no auto-resume prompt", () => {
		const envelope = buildAutoResumePromptEnvelopeFromHandoff({
			timestamp: "2026-05-01T12:00:00.000Z",
			current_tasks: ["TASK-BUD-455"],
			next_actions: ["run focal smoke"],
			slice_memory: {
				canonical_links: [
					"task:TASK-BUD-455",
					"verification:VER-BUD-804",
					"commit:86f9037",
				],
			},
		});

		expect(envelope.prompt).toContain("focusTasks: TASK-BUD-455");
		expect(envelope.prompt).toContain("links: task:TASK-BUD-455, verification:VER-BUD-804, commit:86f9037");
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
				context_watch: {
					auto_resume_after_reload: {
						pending: true,
						createdAtIso: "2026-05-04T06:40:00.000Z",
						reason: "reload-required-after-compact",
						focusTasks: ["TASK-BUD-321"],
					},
					growth_maturity: {
						decision: "hold",
						score: 78,
						recommendationCode: "growth-maturity-hold-maintain",
					},
				},
			}));
			writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [
				{ id: "TASK-BUD-320", status: "completed" },
				{ id: "TASK-BUD-321", status: "in-progress", description: "Continuation readiness smoke", files: ["packages/pi-stack/extensions/context-watchdog.ts"], acceptance_criteria: ["Smoke principal permanece verde."] },
			] }));
			const pi = makeMockPi();
			contextWatchdogSurfacesExtension(pi);
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
			expect(result.content?.[0]?.text).toContain("preload=fallback-canonical");
			expect(result.content?.[0]?.text).toContain("dirty=unknown");
			expect(result.content?.[0]?.text).toContain("material=");
			expect(result.content?.[0]?.text).toContain("decisionCue=seed-local-safe-required");
			expect(result.content?.[0]?.text).toContain("postReloadResume=pending");
			expect(result.content?.[0]?.text).toContain("growthDecision=hold");
			expect(result.content?.[0]?.text).toContain("growthScore=78");
			expect(result.content?.[0]?.text).toContain("growthSource=handoff");
			expect(result.content?.[0]?.text).toContain("growthFresh=stale");
			expect(result.details).toMatchObject({
				effect: "none",
				mode: "read-only-readiness",
				authorization: "none",
				ready: false,
				focusTasks: "TASK-BUD-321",
				staleFocus: "TASK-BUD-320=completed",
				recommendationCode: "refresh-focus-checkpoint",
				nextAction: expect.stringContaining("refresh handoff focus/checkpoint"),
				decisionCue: {
					operatorDecisionNeeded: true,
					reasonCode: "seed-local-safe-required",
					recommendedAction: "seed-local-safe",
				},
				postReloadResumePending: true,
				postReloadResumeReason: "reload-required-after-compact",
				materialReadiness: {
					decision: expect.any(String),
					recommendationCode: expect.any(String),
					nextAction: expect.any(String),
					blockedReasons: expect.any(Array),
					stock: expect.any(Object),
				},
				localContinuitySummary: expect.stringContaining("local-continuity-audit:"),
				growthMaturitySnapshot: {
					source: "handoff",
					decision: "hold",
					score: 78,
					recommendationCode: "growth-maturity-hold-maintain",
					freshness: "stale",
				},
				preload: {
					mode: "context-preload-consume",
					decision: "fallback-canonical",
					dispatchAllowed: false,
					authorization: "none",
				},
				gitDirty: {
					available: false,
					clean: null,
					rowCount: 0,
					summary: "git-dirty-snapshot: unavailable",
					error: "not-a-git-repo",
				},
			});
			expect(result.details?.autoResumePrompt).not.toContain("focusTasks: board-task-selection");

			writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
				timestamp: "2026-04-30T06:04:09.000Z",
				completed_tasks: ["TASK-BUD-320"],
				next_actions: ["continue essential lane with board-task-selection after TASK-BUD-320"],
				context: "TASK-BUD-320 completed; choose one primary task.",
				blockers: [],
			}));
			const noGrowthResult = await tool.execute("tc-continuation-readiness-no-growth", {}, undefined as unknown as AbortSignal, () => {}, { cwd });
			expect(noGrowthResult.content?.[0]?.text).not.toContain("growthDecision=");
			expect(noGrowthResult.content?.[0]?.text).not.toContain("postReloadResume=");
			expect(noGrowthResult.content?.[0]?.text).not.toContain("growthScore=");
			expect(noGrowthResult.content?.[0]?.text).not.toContain("growthSource=");
			expect(noGrowthResult.content?.[0]?.text).not.toContain("growthFresh=");
			expect(noGrowthResult.details?.growthMaturitySnapshot).toBeUndefined();
			expect((noGrowthResult.details as { postReloadResumePending?: boolean } | undefined)?.postReloadResumePending).toBe(false);
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
			expect(resolveContextWatchContinuationRecommendation({
				ready: true,
				focusTasks: "TASK-BUD-321",
				staleFocusCount: 0,
				localAuditReasons: [],
			})).toMatchObject({ recommendationCode: "continue-local" });
			expect(resolveContextWatchContinuationRecommendation({
				ready: false,
				focusTasks: "TASK-BUD-321",
				staleFocusCount: 0,
				localAuditReasons: ["no-local-safe-next-step"],
			})).toMatchObject({ recommendationCode: "local-stop-no-local-safe-next-step" });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("context_watch_continuation_readiness emits decisionCue=none when material stock is healthy", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-continuation-readiness-decision-none-"));
		try {
			mkdirSync(join(cwd, ".project"), { recursive: true });
			writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
				timestamp: new Date().toISOString(),
				current_tasks: ["TASK-FOCUS"],
			}));
			writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [
				{ id: "TASK-FOCUS", status: "in-progress", description: "focused local slice", acceptance_criteria: ["run smoke test"], files: ["packages/pi-stack/test/smoke/context-watchdog.test.ts"] },
				{ id: "TASK-LOCAL-1", status: "planned", description: "local slice 1", acceptance_criteria: ["run smoke test"], files: ["packages/pi-stack/test/smoke/context-watchdog.test.ts"] },
				{ id: "TASK-LOCAL-2", status: "planned", description: "local slice 2", acceptance_criteria: ["run smoke test"], files: ["packages/pi-stack/test/smoke/context-watchdog.test.ts"] },
				{ id: "TASK-LOCAL-3", status: "planned", description: "local slice 3", acceptance_criteria: ["run smoke test"], files: ["packages/pi-stack/test/smoke/context-watchdog.test.ts"] },
				{ id: "TASK-LOCAL-4", status: "planned", description: "local slice 4", acceptance_criteria: ["run smoke test"], files: ["packages/pi-stack/test/smoke/context-watchdog.test.ts"] },
				{ id: "TASK-LOCAL-5", status: "planned", description: "local slice 5", acceptance_criteria: ["run smoke test"], files: ["packages/pi-stack/test/smoke/context-watchdog.test.ts"] },
				{ id: "TASK-LOCAL-6", status: "planned", description: "local slice 6", acceptance_criteria: ["run smoke test"], files: ["packages/pi-stack/test/smoke/context-watchdog.test.ts"] },
			] }));
			execFileSync("git", ["init"], { cwd, stdio: "ignore" });
			execFileSync("git", ["config", "user.email", "test@example.com"], { cwd, stdio: "ignore" });
			execFileSync("git", ["config", "user.name", "Test User"], { cwd, stdio: "ignore" });
			execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
			execFileSync("git", ["commit", "-m", "init"], { cwd, stdio: "ignore" });
			const pi = makeMockPi();
			contextWatchdogSurfacesExtension(pi);
			const tool = getTool(pi, "context_watch_continuation_readiness");
			const result = await tool.execute("tc-continuation-readiness-decision-none", {}, undefined as unknown as AbortSignal, () => {}, { cwd });
			expect(result.content?.[0]?.text).toContain("decisionCue=none");
			expect((result.details as { decisionCue?: { reasonCode?: string; operatorDecisionNeeded?: boolean } } | undefined)?.decisionCue?.reasonCode).toBe("none");
			expect((result.details as { decisionCue?: { reasonCode?: string; operatorDecisionNeeded?: boolean } } | undefined)?.decisionCue?.operatorDecisionNeeded).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

});
