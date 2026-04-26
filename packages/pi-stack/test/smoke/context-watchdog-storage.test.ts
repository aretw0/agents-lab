import { mkdtempSync, readdirSync, rmSync } from "node:fs";
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
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
