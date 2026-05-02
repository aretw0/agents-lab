import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { evaluateGitMaintenanceSignal } from "./guardrails-core-git-maintenance";

export interface GitMaintenanceDiagnostics {
  looseObjectCount: number;
  looseSizeMiB: number;
  garbageCount: number;
  garbageSizeMiB: number;
  gcLogPresent: boolean;
}

export interface GitMaintenanceReadDeps {
  runGit?: (args: string[], cwd: string) => string;
  exists?: (path: string) => boolean;
}

export type GitDirtyRowKind = "modified" | "added" | "deleted" | "renamed" | "untracked";

export interface GitDirtyRow {
  x: string;
  y: string;
  kind: GitDirtyRowKind;
  path: string;
  from?: string;
}

export interface GitDirtySnapshot {
  mode: "git-dirty-snapshot";
  command: "git -c core.safecrlf=false status --porcelain";
  clean: boolean;
  rows: GitDirtyRow[];
  counts: {
    tracked: number;
    untracked: number;
    renamed: number;
    deleted: number;
  };
  dispatchAllowed: false;
  authorization: "none";
  summary: string;
}

function parseSizeMiB(value: string, unit: string): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const normalizedUnit = unit.toLowerCase();
  if (normalizedUnit.startsWith("kib")) return amount / 1024;
  if (normalizedUnit.startsWith("mib")) return amount;
  if (normalizedUnit.startsWith("gib")) return amount * 1024;
  if (normalizedUnit.startsWith("bytes")) return amount / 1024 / 1024;
  return amount;
}

export function parseGitCountObjectsOutput(output: string, gcLogPresent: boolean): GitMaintenanceDiagnostics {
  const metrics: Record<string, string> = {};
  for (const line of String(output ?? "").split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (match) metrics[match[1].trim()] = match[2].trim();
  }

  const sizeMatch = String(metrics.size ?? "0 MiB").match(/^([0-9.]+)\s*(\S+)?/);
  const garbageSizeMatch = String(metrics["size-garbage"] ?? "0 bytes").match(/^([0-9.]+)\s*(\S+)?/);

  return {
    looseObjectCount: Math.max(0, Math.floor(Number(metrics.count ?? 0) || 0)),
    looseSizeMiB: sizeMatch ? parseSizeMiB(sizeMatch[1], sizeMatch[2] ?? "MiB") : 0,
    garbageCount: Math.max(0, Math.floor(Number(metrics.garbage ?? 0) || 0)),
    garbageSizeMiB: garbageSizeMatch ? parseSizeMiB(garbageSizeMatch[1], garbageSizeMatch[2] ?? "bytes") : 0,
    gcLogPresent,
  };
}

export function readGitMaintenanceDiagnostics(cwd: string, deps: GitMaintenanceReadDeps = {}): GitMaintenanceDiagnostics {
  const runGit = deps.runGit ?? ((args: string[], repoCwd: string) => execFileSync("git", args, { cwd: repoCwd, encoding: "utf8", stdio: "pipe" }));
  const exists = deps.exists ?? existsSync;
  const output = runGit(["count-objects", "-vH"], cwd);
  return parseGitCountObjectsOutput(output, exists(join(cwd, ".git", "gc.log")));
}

export function parseGitStatusPorcelainLine(line: string): GitDirtyRow | undefined {
  const text = String(line ?? "").trimEnd();
  if (!text || text.length < 3) return undefined;
  const x = text[0];
  const y = text[1];
  if (text[2] !== " ") return undefined;
  const body = text.slice(3).trim();
  if (!body) return undefined;

  if (x === "?" && y === "?") {
    return { x, y, kind: "untracked", path: body };
  }

  if (body.includes(" -> ")) {
    const [from, to] = body.split(" -> ");
    if (from && to) {
      return { x, y, kind: "renamed", from: from.trim(), path: to.trim() };
    }
  }

  let kind: GitDirtyRowKind = "modified";
  if (x === "D" || y === "D") kind = "deleted";
  else if (x === "A") kind = "added";
  else if (x === "R" || y === "R") kind = "renamed";

  return { x, y, kind, path: body };
}

export function parseGitStatusPorcelainOutput(output: string): GitDirtySnapshot {
  const rows = String(output ?? "")
    .split(/\r?\n/)
    .map(parseGitStatusPorcelainLine)
    .filter((row): row is GitDirtyRow => Boolean(row));

  const counts = {
    tracked: rows.filter((row) => row.kind !== "untracked").length,
    untracked: rows.filter((row) => row.kind === "untracked").length,
    renamed: rows.filter((row) => row.kind === "renamed").length,
    deleted: rows.filter((row) => row.kind === "deleted").length,
  };

  const clean = rows.length === 0;

  return {
    mode: "git-dirty-snapshot",
    command: "git -c core.safecrlf=false status --porcelain",
    clean,
    rows,
    counts,
    dispatchAllowed: false,
    authorization: "none",
    summary: `git-dirty-snapshot: clean=${clean ? "yes" : "no"} rows=${rows.length} tracked=${counts.tracked} untracked=${counts.untracked}`,
  };
}

export function readGitDirtySnapshot(cwd: string, deps: GitMaintenanceReadDeps = {}): GitDirtySnapshot {
  const runGit = deps.runGit ?? ((args: string[], repoCwd: string) => execFileSync("git", args, { cwd: repoCwd, encoding: "utf8", stdio: "pipe" }));
  const output = runGit(["-c", "core.safecrlf=false", "status", "--porcelain"], cwd);
  return parseGitStatusPorcelainOutput(output);
}

export function registerGuardrailsGitMaintenanceSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "git_maintenance_status",
    label: "Git Maintenance Status",
    description: "Read-only Git GC/prune maintenance classifier. Runs diagnostics only; never runs git gc, git prune, or removes .git/gc.log.",
    parameters: Type.Object({
      disk_low: Type.Optional(Type.Boolean({ description: "Whether external disk pressure is already known. Default false." })),
      performance_degraded: Type.Optional(Type.Boolean({ description: "Whether git/repo performance is already degraded. Default false." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const diagnostics = readGitMaintenanceDiagnostics(ctx.cwd);
      const signal = evaluateGitMaintenanceSignal({
        ...diagnostics,
        diskLow: p.disk_low === true,
        performanceDegraded: p.performance_degraded === true,
      });
      const result = {
        ...signal,
        diagnosticsCommand: "git count-objects -vH",
        cleanupCommandsExecuted: [],
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "git_dirty_snapshot",
    label: "Git Dirty Snapshot",
    description: "Read-only git dirty snapshot from porcelain output; no temp files and no cleanup commands.",
    parameters: Type.Object({}),
    execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const snapshot = readGitDirtySnapshot(ctx.cwd);
      return {
        content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }],
        details: snapshot,
      };
    },
  });
}
