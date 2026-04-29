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
  const runGit = deps.runGit ?? ((args: string[], repoCwd: string) => execFileSync("git", args, { cwd: repoCwd, encoding: "utf8" }));
  const exists = deps.exists ?? existsSync;
  const output = runGit(["count-objects", "-vH"], cwd);
  return parseGitCountObjectsOutput(output, exists(join(cwd, ".git", "gc.log")));
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
}
