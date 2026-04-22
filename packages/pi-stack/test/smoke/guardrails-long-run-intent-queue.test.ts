import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearDeferredIntentQueue,
  dequeueDeferredIntent,
  enqueueDeferredIntent,
  estimateAutoDrainWaitMs,
  listDeferredIntents,
  oldestDeferredIntentAgeMs,
  parseLaneQueueAddText,
  resolveAutoDrainGateReason,
  resolveAutoDrainRetryDelayMs,
  resolveLongRunIntentQueueConfig,
  resolvePragmaticAutonomyConfig,
  shouldAutoDrainDeferredIntent,
  shouldQueueInputForLongRun,
  buildPragmaticAutonomySystemPrompt,
  summarizeAssumptionText,
  shouldSchedulePostDispatchAutoDrain,
} from "../../extensions/guardrails-core";

describe("guardrails-core long-run intent queue", () => {
  it("uses safe defaults when settings are missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-intent-queue-default-"));
    try {
      const cfg = resolveLongRunIntentQueueConfig(cwd);
      expect(cfg.enabled).toBe(true);
      expect(cfg.requireActiveLongRun).toBe(true);
      expect(cfg.maxItems).toBe(50);
      expect(cfg.forceNowPrefix).toBe("lane-now:");
      expect(cfg.autoDrainOnIdle).toBe(true);
      expect(cfg.autoDrainCooldownMs).toBe(3000);
      expect(cfg.autoDrainBatchSize).toBe(1);
      expect(cfg.autoDrainIdleStableMs).toBe(1500);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("uses pragmatic autonomy defaults when settings are missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-pragmatic-autonomy-default-"));
    try {
      const cfg = resolvePragmaticAutonomyConfig(cwd);
      expect(cfg.enabled).toBe(true);
      expect(cfg.noObviousQuestions).toBe(true);
      expect(cfg.auditAssumptions).toBe(true);
      expect(cfg.maxAuditTextChars).toBe(140);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("builds no-obvious-questions prompt only when policy is enabled", () => {
    const enabled = buildPragmaticAutonomySystemPrompt({ enabled: true, noObviousQuestions: true });
    expect(enabled).toContain("Pragmatic autonomy policy is active");
    expect(enabled).toContain("irreversible actions");

    const disabled = buildPragmaticAutonomySystemPrompt({ enabled: false, noObviousQuestions: true });
    expect(disabled).toBeUndefined();
  });

  it("summarizes assumption text deterministically", () => {
    const summary = summarizeAssumptionText(
      "  manter execução, sem perguntar formato agora, seguir com default seguro até checkpoint  ",
      48,
    );
    expect(summary).toContain("manter execução");
    expect(summary.length).toBeLessThanOrEqual(49);
  });

  it("queues only normal text while long-run is active", () => {
    const cfg = {
      enabled: true,
      requireActiveLongRun: true,
      maxItems: 50,
      forceNowPrefix: "lane-now:",
      autoDrainOnIdle: true,
      autoDrainCooldownMs: 3000,
      autoDrainBatchSize: 1,
      autoDrainIdleStableMs: 1500,
    };
    expect(shouldQueueInputForLongRun("registrar isso", true, cfg)).toBe(true);
    expect(shouldQueueInputForLongRun("/status", true, cfg)).toBe(false);
    expect(shouldQueueInputForLongRun("lane-now: processa agora", true, cfg)).toBe(false);
    expect(shouldQueueInputForLongRun("registrar isso", false, cfg)).toBe(false);
  });

  it("parses explicit lane-queue add payloads", () => {
    expect(parseLaneQueueAddText("add revisar isso depois")).toBe("revisar isso depois");
    expect(parseLaneQueueAddText("ADD   item")).toBe("item");
    expect(parseLaneQueueAddText("list")).toBeUndefined();
    expect(parseLaneQueueAddText("add")).toBeUndefined();
  });

  it("computes oldest queued intent age", () => {
    const nowMs = Date.parse("2026-04-21T22:00:10.000Z");
    const age = oldestDeferredIntentAgeMs([
      { id: "i-1", atIso: "2026-04-21T22:00:05.000Z", text: "a", source: "interactive" },
      { id: "i-2", atIso: "2026-04-21T22:00:00.000Z", text: "b", source: "interactive" },
    ], nowMs);
    expect(age).toBe(10_000);
    expect(oldestDeferredIntentAgeMs([], nowMs)).toBeUndefined();
  });

  it("enqueues items and enforces max size", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-intent-queue-cap-"));
    try {
      for (let i = 0; i < 5; i++) {
        enqueueDeferredIntent(cwd, `item-${i + 1}`, "interactive", 3);
      }

      const queuePath = join(cwd, ".pi", "deferred-intents.json");
      const json = JSON.parse(readFileSync(queuePath, "utf8"));
      expect(Array.isArray(json.items)).toBe(true);
      expect(json.items).toHaveLength(3);
      expect(json.items[0].text).toBe("item-3");
      expect(json.items[2].text).toBe("item-5");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("supports list/pop/clear helpers for safe drain", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-intent-queue-drain-"));
    try {
      enqueueDeferredIntent(cwd, "item-a", "interactive", 50);
      enqueueDeferredIntent(cwd, "item-b", "interactive", 50);

      expect(listDeferredIntents(cwd)).toHaveLength(2);

      const popped = dequeueDeferredIntent(cwd);
      expect(popped.item?.text).toBe("item-a");
      expect(popped.queuedCount).toBe(1);

      const cleared = clearDeferredIntentQueue(cwd);
      expect(cleared.cleared).toBe(1);
      expect(listDeferredIntents(cwd)).toHaveLength(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("reads configured values from .pi/settings.json", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-intent-queue-config-"));
    try {
      mkdirSync(join(cwd, ".pi"), { recursive: true });
      writeFileSync(
        join(cwd, ".pi", "settings.json"),
        JSON.stringify({
          piStack: {
            guardrailsCore: {
              longRunIntentQueue: {
                enabled: true,
                requireActiveLongRun: false,
                maxItems: 99,
                forceNowPrefix: "agora:",
                autoDrainOnIdle: false,
                autoDrainCooldownMs: 8000,
                autoDrainBatchSize: 4,
                autoDrainIdleStableMs: 5000,
              },
            },
          },
        }),
      );

      const cfg = resolveLongRunIntentQueueConfig(cwd);
      expect(cfg.requireActiveLongRun).toBe(false);
      expect(cfg.maxItems).toBe(99);
      expect(cfg.forceNowPrefix).toBe("agora:");
      expect(cfg.autoDrainOnIdle).toBe(false);
      expect(cfg.autoDrainCooldownMs).toBe(8000);
      expect(cfg.autoDrainBatchSize).toBe(4);
      expect(cfg.autoDrainIdleStableMs).toBe(5000);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("schedules post-dispatch backstop only when queue still has items", () => {
    expect(shouldSchedulePostDispatchAutoDrain(0, 3)).toBe(false);
    expect(shouldSchedulePostDispatchAutoDrain(1, 0)).toBe(false);
    expect(shouldSchedulePostDispatchAutoDrain(1, 2)).toBe(true);
  });

  it("auto-drains only when idle, enabled and after cooldown", () => {
    const cfg = {
      enabled: true,
      requireActiveLongRun: true,
      maxItems: 50,
      forceNowPrefix: "lane-now:",
      autoDrainOnIdle: true,
      autoDrainCooldownMs: 1000,
      autoDrainBatchSize: 1,
      autoDrainIdleStableMs: 800,
    };

    expect(estimateAutoDrainWaitMs(false, 1, 2_000, 0, 1_200, cfg)).toBe(0);
    expect(estimateAutoDrainWaitMs(false, 1, 500, 0, 1_200, cfg)).toBe(500);
    expect(estimateAutoDrainWaitMs(false, 1, 2_000, 0, 200, cfg)).toBe(600);
    expect(estimateAutoDrainWaitMs(true, 1, 2_000, 0, 1_200, cfg)).toBeUndefined();

    expect(resolveAutoDrainGateReason(true, 1, 2_000, 0, 1_200, cfg)).toBe("active-long-run");
    expect(resolveAutoDrainGateReason(false, 1, 500, 0, 1_200, cfg)).toBe("cooldown");
    expect(resolveAutoDrainGateReason(false, 1, 2_000, 0, 200, cfg)).toBe("idle-stability");
    expect(resolveAutoDrainGateReason(false, 1, 2_000, 0, 1_200, cfg)).toBe("ready");

    expect(resolveAutoDrainRetryDelayMs(false, 1, 500, 0, 1_200, cfg)).toBe(500);
    expect(resolveAutoDrainRetryDelayMs(false, 1, 2_000, 0, 200, cfg)).toBe(600);
    expect(resolveAutoDrainRetryDelayMs(false, 1, 2_000, 0, 1_200, cfg)).toBeUndefined();
    expect(resolveAutoDrainRetryDelayMs(true, 1, 2_000, 0, 1_200, cfg)).toBe(800);

    expect(shouldAutoDrainDeferredIntent(false, 1, 2_000, 0, 1_200, cfg)).toBe(true);
    expect(shouldAutoDrainDeferredIntent(true, 1, 2_000, 0, 1_200, cfg)).toBe(false);
    expect(shouldAutoDrainDeferredIntent(false, 0, 2_000, 0, 1_200, cfg)).toBe(false);
    expect(shouldAutoDrainDeferredIntent(false, 1, 500, 0, 1_200, cfg)).toBe(false);
    expect(shouldAutoDrainDeferredIntent(false, 1, 2_000, 0, 200, cfg)).toBe(false);
  });
});
