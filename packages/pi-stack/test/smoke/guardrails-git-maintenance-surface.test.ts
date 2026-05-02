import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseGitCountObjectsOutput,
  parseGitStatusPorcelainOutput,
  readGitDirtySnapshot,
  readGitMaintenanceDiagnostics,
  registerGuardrailsGitMaintenanceSurface,
} from "../../extensions/guardrails-core-git-maintenance-surface";

type RegisteredTool = {
  name: string;
  execute: (toolCallId: string, params: Record<string, unknown>, signal?: unknown, onUpdate?: unknown, ctx?: { cwd: string }) => { details: Record<string, unknown> };
};

type RegisteredCommand = {
  name: string;
  handler: (args: string, ctx: { cwd: string; ui: { notify: (msg: string, level?: string) => void } }) => Promise<void> | void;
};

const COUNT_OBJECTS_SAMPLE = `count: 6089
size: 10.14 MiB
in-pack: 8918
packs: 4
size-pack: 3.72 MiB
prune-packable: 0
garbage: 0
size-garbage: 0 bytes
`;

const STATUS_PORCELAIN_SAMPLE = ` M package.json
?? scripts/new-file.mjs
R  old/path.txt -> new/path.txt
`;

describe("guardrails git maintenance surface", () => {
  it("parses git count-objects output", () => {
    expect(parseGitCountObjectsOutput(COUNT_OBJECTS_SAMPLE, true)).toEqual({
      looseObjectCount: 6089,
      looseSizeMiB: 10.14,
      garbageCount: 0,
      garbageSizeMiB: 0,
      gcLogPresent: true,
    });
  });

  it("reads diagnostics through injectable read-only dependencies", () => {
    const diagnostics = readGitMaintenanceDiagnostics("/repo", {
      runGit(args, cwd) {
        expect(args).toEqual(["count-objects", "-vH"]);
        expect(cwd).toBe("/repo");
        return COUNT_OBJECTS_SAMPLE;
      },
      exists(path) {
        expect(path.replace(/\\/g, "/")).toContain("/.git/gc.log");
        return true;
      },
    });

    expect(diagnostics.looseObjectCount).toBe(6089);
    expect(diagnostics.gcLogPresent).toBe(true);
  });

  it("parses porcelain dirty snapshot output", () => {
    const snapshot = parseGitStatusPorcelainOutput(STATUS_PORCELAIN_SAMPLE);
    expect(snapshot.clean).toBe(false);
    expect(snapshot.rows).toHaveLength(3);
    expect(snapshot.counts).toMatchObject({ tracked: 2, untracked: 1, renamed: 1, deleted: 0 });
    expect(snapshot.summary).toContain("clean=no");
  });

  it("reads dirty snapshot via injectable git dependency", () => {
    const snapshot = readGitDirtySnapshot("/repo", {
      runGit(args, cwd) {
        expect(args).toEqual(["-c", "core.safecrlf=false", "status", "--porcelain"]);
        expect(cwd).toBe("/repo");
        return STATUS_PORCELAIN_SAMPLE;
      },
    });

    expect(snapshot.mode).toBe("git-dirty-snapshot");
    expect(snapshot.dispatchAllowed).toBe(false);
    expect(snapshot.authorization).toBe("none");
    expect(snapshot.rows).toHaveLength(3);
  });

  it("registers read-only git maintenance status and dirty snapshot tools", () => {
    const tools: RegisteredTool[] = [];
    const commands: RegisteredCommand[] = [];
    registerGuardrailsGitMaintenanceSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
      registerCommand(name: string, command: unknown) { commands.push({ name, ...(command as Omit<RegisteredCommand, "name">) }); },
    } as never);

    const maintenanceTool = tools.find((item) => item.name === "git_maintenance_status");
    const dirtyTool = tools.find((item) => item.name === "git_dirty_snapshot");
    const dirtyCommand = commands.find((item) => item.name === "git-dirty");
    expect(maintenanceTool?.name).toBe("git_maintenance_status");
    expect(dirtyTool?.name).toBe("git_dirty_snapshot");
    expect(typeof dirtyCommand?.handler).toBe("function");
  });

  it("git-dirty command handler reports unavailable outside git repo", async () => {
    const tools: RegisteredTool[] = [];
    const commands: RegisteredCommand[] = [];
    registerGuardrailsGitMaintenanceSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
      registerCommand(name: string, command: unknown) { commands.push({ name, ...(command as Omit<RegisteredCommand, "name">) }); },
    } as never);

    const dirtyCommand = commands.find((item) => item.name === "git-dirty");
    const notifications: Array<{ msg: string; level?: string }> = [];
    const cwd = mkdtempSync(join(tmpdir(), "git-dirty-command-"));
    try {
      await dirtyCommand?.handler("", {
        cwd,
        ui: {
          notify(msg: string, level?: string) {
            notifications.push({ msg, level });
          },
        },
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0]?.msg).toContain("git-dirty-snapshot: unavailable");
    expect(notifications[0]?.msg).toContain("not-a-git-repo");
  });
});
