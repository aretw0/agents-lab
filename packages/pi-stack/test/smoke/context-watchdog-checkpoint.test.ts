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
			expect(result.details?.reloadRequired).toBe(false);
			const written = JSON.parse(readFileSync(join(cwd, ".project", "handoff.json"), "utf8")) as any;
			expect(written.current_tasks).toEqual(["TASK-BUD-234"]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("context_watch_checkpoint persists optional growth maturity snapshot and compact summary markers", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-tool-checkpoint-growth-"));
		try {
			const pi = makeMockPi();
			contextWatchdogExtension(pi);
			const tool = getTool(pi, "context_watch_checkpoint");
			const result = await tool.execute(
				"tc-context-watch-checkpoint-growth",
				{
					task_id: "TASK-BUD-299",
					context: "checkpoint with growth markers",
					growth_decision: "go",
					growth_score: 88,
					growth_code: "growth-maturity-go-expand-bounded",
				},
				undefined as unknown as AbortSignal,
				() => {},
				{ cwd },
			);
			expect(result.content?.[0]?.text).toContain("context-watch-checkpoint: ok=yes task=TASK-BUD-299 path=.project/handoff.json");
			expect(result.content?.[0]?.text).toContain("growthDecision=go");
			expect(result.content?.[0]?.text).toContain("growthScore=88");
			const written = JSON.parse(readFileSync(join(cwd, ".project", "handoff.json"), "utf8")) as any;
			expect(written.context_watch?.growth_maturity).toMatchObject({
				decision: "go",
				score: 88,
				recommendationCode: "growth-maturity-go-expand-bounded",
			});
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

	it("persists and clears deferred auto-resume intent for reload handoff continuity", () => {
		const base = {
			timestamp: "2026-05-04T04:00:00.000Z",
			context_watch: {
				level: "checkpoint",
			},
		};
		const withIntent = withAutoResumeAfterReloadIntent(base, {
			pending: true,
			createdAtIso: "2026-05-04T04:01:00.000Z",
			reason: "reload-required-after-compact",
			focusTasks: ["TASK-BUD-739", "TASK-BUD-740", "TASK-BUD-741", "TASK-BUD-742", "TASK-BUD-743"],
		});
		expect(readAutoResumeAfterReloadIntent(withIntent)).toMatchObject({
			pending: true,
			createdAtIso: "2026-05-04T04:01:00.000Z",
			reason: "reload-required-after-compact",
			focusTasks: ["TASK-BUD-739", "TASK-BUD-740", "TASK-BUD-741"],
		});
		const normalizedInvalidReason = readAutoResumeAfterReloadIntent({
			context_watch: {
				auto_resume_after_reload: {
					pending: true,
					createdAtIso: "2026-05-04T04:01:00.000Z",
					reason: "unexpected-reason",
					focusTasks: ["TASK-BUD-739"],
				},
			},
		} as Record<string, unknown>);
		expect(normalizedInvalidReason?.reason).toBe("reload-required-after-compact");
		const cleared = clearAutoResumeAfterReloadIntent(withIntent);
		expect(readAutoResumeAfterReloadIntent(cleared)).toBeUndefined();
		expect((cleared.context_watch as Record<string, unknown> | undefined)?.level).toBe("checkpoint");
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

	it("dedupes repeated identical context-watch events in handoff trail", () => {
		const assessment = evaluateContextWatch(69, {
			warnPct: 50,
			checkpointPct: 68,
			compactPct: 72,
		});
		const first = applyContextWatchToHandoff(
			{ context: "ongoing", context_watch_events: [] },
			assessment,
			"message_end",
			"2026-04-21T21:30:00.000Z",
		) as any;
		const second = applyContextWatchToHandoff(
			first,
			assessment,
			"message_end",
			"2026-04-21T21:31:00.000Z",
		) as any;

		expect(Array.isArray(second.context_watch_events)).toBe(true);
		expect(second.context_watch_events).toHaveLength(1);
		expect(second.context_watch_events[0]?.atIso).toBe("2026-04-21T21:31:00.000Z");
	});

	it("treats bounded manual checkpoints as valid compact/resume evidence", () => {
		const checkpoint = buildLocalSliceHandoffCheckpoint({
			timestampIso: "2026-04-21T21:33:00.000Z",
			taskId: "TASK-BUD-384",
			context: "manual checkpoint before compact",
			contextLevel: "checkpoint",
			recommendation: "resume from saved checkpoint",
		}) as any;
		const event = latestContextWatchEvent(checkpoint);
		expect(event?.reason).toBe("manual_checkpoint");
		expect(event?.level).toBe("checkpoint");
		expect(contextWatchEventAgeMs(event, Date.parse("2026-04-21T21:33:10.000Z"))).toBe(10_000);
		expect(resolveCheckpointEvidenceReadyForCalmClose({
			handoffLastEventLevel: event?.level,
			handoffLastEventAgeMs: contextWatchEventAgeMs(event, Date.parse("2026-04-21T21:33:10.000Z")),
			maxCheckpointAgeMs: 30 * 60 * 1000,
		})).toBe(true);
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
