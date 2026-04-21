import { describe, expect, it } from "vitest";
import {
	applyContextWatchBootstrapToSettings,
	applyContextWatchToHandoff,
	buildAutoCompactDiagnostics,
	buildContextWatchBootstrapPlan,
	deriveContextWatchThresholds,
	evaluateContextWatch,
	normalizeContextWatchdogConfig,
	parseContextBootstrapPreset,
	shouldAnnounceContextWatch,
	shouldAutoCheckpoint,
	shouldScheduleAutoCompactRetry,
	shouldTriggerAutoCompact,
} from "../../extensions/context-watchdog";

describe("context-watchdog", () => {
	it("normalizes defaults and bounds", () => {
		const cfg = normalizeContextWatchdogConfig({
			checkpointPct: 999,
			compactPct: 0,
			cooldownMs: 1,
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

		const diag = buildAutoCompactDiagnostics(compact, cfg, {
			nowMs: 200_000,
			lastAutoCompactAt: 0,
			inFlight: false,
			isIdle: false,
			hasPendingMessages: true,
		});
		expect(diag.decision.reason).toBe("not-idle");
		expect(diag.retryRecommended).toBe(true);
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

		const worker = buildContextWatchBootstrapPlan("agent-worker");
		expect(worker.preset).toBe("agent-worker");
		expect((worker.patch.piStack as any).contextWatchdog.checkpointPct).toBe(72);
		expect((worker.patch.piStack as any).contextWatchdog.compactPct).toBe(78);
		expect((worker.patch.piStack as any).contextWatchdog.notify).toBe(false);
		expect((worker.patch.piStack as any).contextWatchdog.autoCompact).toBe(false);
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

		expect(next.timestamp).toBe("2026-04-21T21:30:00.000Z");
		expect(next.next_actions[0]).toContain("Context-watch action:");
		expect(next.next_actions[0]).toContain("checkpoint");
		expect(next.blockers).toContain("context-watch-checkpoint-required");
		expect(Array.isArray(next.context_watch_events)).toBe(true);
		expect(next.context_watch_events.at(-1).action).toBe("write-checkpoint");
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
