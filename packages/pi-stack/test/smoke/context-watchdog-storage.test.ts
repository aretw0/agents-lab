import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readHandoffJson,
  readProjectSettings,
  writeHandoffJson,
  writeProjectSettings,
} from "../../extensions/context-watchdog-storage";

describe("context-watchdog storage", () => {
  it("writes settings atomically without leaving temp artifacts", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-context-storage-"));
    try {
      const out = writeProjectSettings(cwd, {
        piStack: {
          contextWatchdog: {
            enabled: true,
            notify: false,
          },
        },
      });

      expect(/[\\/]\.pi[\\/]settings\.json$/.test(out)).toBe(true);
      const readBack = readProjectSettings(cwd);
      expect((readBack.piStack as any)?.contextWatchdog?.notify).toBe(false);

      const piDir = join(cwd, ".pi");
      const leftovers = readdirSync(piDir).filter((name) => name.includes("settings.json.tmp-"));
      expect(leftovers).toEqual([]);
      const locks = readdirSync(piDir).filter((name) => name === "settings.lock");
      expect(locks).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("reclaims stale settings lock before writing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-context-storage-"));
    try {
      const piDir = join(cwd, ".pi");
      const lockPath = join(piDir, "settings.lock");
      mkdirSync(piDir, { recursive: true });
      writeFileSync(lockPath, "stale");
      const staleDate = new Date(Date.now() - 10 * 60_000);
      utimesSync(lockPath, staleDate, staleDate);

      writeProjectSettings(
        cwd,
        {
          piStack: {
            guardrailsCore: {
              longRunIntentQueue: { autoDrainOnIdle: true },
            },
          },
        },
        { staleMs: 1_000, maxWaitMs: 200, retryMs: 5 },
      );

      const readBack = readProjectSettings(cwd);
      expect((readBack.piStack as any)?.guardrailsCore?.longRunIntentQueue?.autoDrainOnIdle).toBe(true);
      const locks = readdirSync(piDir).filter((name) => name === "settings.lock");
      expect(locks).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("fails fast when active settings lock stays held", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-context-storage-"));
    try {
      const piDir = join(cwd, ".pi");
      rmSync(piDir, { recursive: true, force: true });
      const lockPath = join(piDir, "settings.lock");
      mkdirSync(piDir, { recursive: true });
      writeFileSync(lockPath, "held");

      expect(() =>
        writeProjectSettings(
          cwd,
          { piStack: { contextWatchdog: { enabled: true } } },
          { staleMs: 60_000, maxWaitMs: 20, retryMs: 5 },
        ),
      ).toThrow(/lock timeout/i);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("writes handoff atomically without leaving temp artifacts", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-context-storage-"));
    try {
      const out = writeHandoffJson(cwd, {
        timestamp: "2026-04-26T00:00:00Z",
        next_actions: ["continue"],
      });

      expect(/[\\/]\.project[\\/]handoff\.json$/.test(out)).toBe(true);
      const readBack = readHandoffJson(cwd);
      expect(readBack.timestamp).toBe("2026-04-26T00:00:00Z");

      const projectDir = join(cwd, ".project");
      const leftovers = readdirSync(projectDir).filter((name) => name.includes("handoff.json.tmp-"));
      expect(leftovers).toEqual([]);
      const locks = readdirSync(projectDir).filter((name) => name === "handoff.lock");
      expect(locks).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
