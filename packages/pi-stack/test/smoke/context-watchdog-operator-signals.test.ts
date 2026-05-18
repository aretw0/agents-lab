import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	assessLocalSliceHandoffBudget,
	buildLocalSliceHandoffCheckpoint,
	composeAutoResumeSuppressionHint,
	describeContextWatchDeterministicStopHint,
	isProviderRequestTimeoutError,
	LOCAL_SLICE_HANDOFF_MAX_JSON_CHARS,
	resolveContextWatchCompactStageNextAction,
	resolveContextWatchDeterministicStopSignal,
	resolveContextWatchOperatingCadence,
	resolveContextWatchOperatorActionPlan,
	resolveContextWatchOperatorSignal,
	resolveContextWatchSignalNoiseExcessive,
	resolvePreCompactReloadSignal,
	shouldEmitDeterministicStopSignal,
	writeLocalSliceHandoffCheckpoint,
} from "../../extensions/context-watchdog-exports";

describe("context-watchdog operator signals and checkpoints", () => {
	it("emits operator signal for manual intervention/reload steering", () => {
		const none = resolveContextWatchOperatorSignal({
			reloadRequired: false,
			handoffManualRefreshRequired: false,
		});
		expect(none.operatorActionRequired).toBe(false);
		expect(none.reasons).toEqual([]);
		expect(none.noiseExcessive).toBe(false);

		const manual = resolveContextWatchOperatorSignal({
			reloadRequired: false,
			handoffManualRefreshRequired: true,
		});
		expect(manual.operatorActionRequired).toBe(true);
		expect(manual.reloadRequired).toBe(false);
		expect(manual.reasons).toContain("handoff-refresh-required");

		const reload = resolveContextWatchOperatorSignal({
			reloadRequired: true,
			handoffManualRefreshRequired: false,
		});
		expect(reload.operatorActionRequired).toBe(true);
		expect(reload.reasons).toContain("reload-required");

		expect(resolveContextWatchSignalNoiseExcessive(4, 4)).toBe(false);
		expect(resolveContextWatchSignalNoiseExcessive(5, 4)).toBe(true);
		const noisy = resolveContextWatchOperatorSignal({
			reloadRequired: false,
			handoffManualRefreshRequired: false,
			signalNoiseExcessive: true,
		});
		expect(noisy.operatorActionRequired).toBe(true);
		expect(noisy.noiseExcessive).toBe(true);
		expect(noisy.reasons).toContain("signal-noise-excessive");

		const compactCheckpoint = resolveContextWatchOperatorSignal({
			reloadRequired: false,
			handoffManualRefreshRequired: false,
			compactCheckpointPersistRequired: true,
		});
		expect(compactCheckpoint.operatorActionRequired).toBe(true);
		expect(compactCheckpoint.reasons).toContain("compact-checkpoint-required");

		const timeoutPressure = resolveContextWatchOperatorSignal({
			reloadRequired: false,
			handoffManualRefreshRequired: false,
			timeoutPressureActive: true,
		});
		expect(timeoutPressure.operatorActionRequired).toBe(true);
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
		expect(operatorSignal.operatorActionRequired).toBe(true);

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

	
});

