import { describe, expect, it } from "vitest";
import {
	applyContextWatchBootstrapToSettings,
	buildContextWatchBootstrapPlan,
	deriveContextWatchThresholds,
	evaluateContextWatch,
	normalizeContextWatchdogConfig,
	parseContextBootstrapPreset,
	shouldAnnounceContextWatch,
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

	it("builds portable bootstrap plans for control-plane and worker presets", () => {
		expect(parseContextBootstrapPreset(undefined)).toBe("control-plane");
		expect(parseContextBootstrapPreset("agent-worker")).toBe("agent-worker");

		const control = buildContextWatchBootstrapPlan("control-plane");
		expect(control.preset).toBe("control-plane");
		expect((control.patch.piStack as any).contextWatchdog.checkpointPct).toBe(68);
		expect((control.patch.piStack as any).contextWatchdog.compactPct).toBe(72);
		expect((control.patch.piStack as any).contextWatchdog.notify).toBe(true);

		const worker = buildContextWatchBootstrapPlan("agent-worker");
		expect(worker.preset).toBe("agent-worker");
		expect((worker.patch.piStack as any).contextWatchdog.checkpointPct).toBe(72);
		expect((worker.patch.piStack as any).contextWatchdog.compactPct).toBe(78);
		expect((worker.patch.piStack as any).contextWatchdog.notify).toBe(false);
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
