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
  parseLaneQueueAddText,
  resolveLongRunIntentQueueConfig,
  shouldAutoDrainDeferredIntent,
  shouldQueueInputForLongRun,
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

    expect(shouldAutoDrainDeferredIntent(false, 1, 2_000, 0, 1_200, cfg)).toBe(true);
    expect(shouldAutoDrainDeferredIntent(true, 1, 2_000, 0, 1_200, cfg)).toBe(false);
    expect(shouldAutoDrainDeferredIntent(false, 0, 2_000, 0, 1_200, cfg)).toBe(false);
    expect(shouldAutoDrainDeferredIntent(false, 1, 500, 0, 1_200, cfg)).toBe(false);
    expect(shouldAutoDrainDeferredIntent(false, 1, 2_000, 0, 200, cfg)).toBe(false);
  });
});
