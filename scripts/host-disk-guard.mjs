#!/usr/bin/env node

import { existsSync, readdirSync, statSync, statfsSync, unlinkSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import process from "node:process";
import { pathToFileURL } from "node:url";

const MB = 1024 * 1024;

function toMb(bytes) {
  return Math.round((Math.max(0, Number(bytes) || 0) / MB) * 100) / 100;
}

function parseArgs(argv) {
  const out = {
    json: false,
    apply: false,
    includeSessions: false,
    keepRecentSessions: 20,
    sessionAgeDays: 7,
    reportsAgeDays: 14,
    maxDeleteMb: 2048,
    warnFreeMb: 10 * 1024,
    blockFreeMb: 5 * 1024,
    help: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg === "--json") out.json = true;
    else if (arg === "--apply") out.apply = true;
    else if (arg === "--include-sessions") out.includeSessions = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg.startsWith("--keep-recent-sessions=")) {
      out.keepRecentSessions = Math.max(0, Math.floor(Number(arg.split("=")[1] || "0")));
    } else if (arg.startsWith("--session-age-days=")) {
      out.sessionAgeDays = Math.max(1, Math.floor(Number(arg.split("=")[1] || "1")));
    } else if (arg.startsWith("--reports-age-days=")) {
      out.reportsAgeDays = Math.max(1, Math.floor(Number(arg.split("=")[1] || "1")));
    } else if (arg.startsWith("--max-delete-mb=")) {
      out.maxDeleteMb = Math.max(128, Math.floor(Number(arg.split("=")[1] || "128")));
    } else if (arg.startsWith("--warn-free-mb=")) {
      out.warnFreeMb = Math.max(512, Math.floor(Number(arg.split("=")[1] || "512")));
    } else if (arg.startsWith("--block-free-mb=")) {
      out.blockFreeMb = Math.max(128, Math.floor(Number(arg.split("=")[1] || "128")));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return out;
}

function printHelp() {
  console.log([
    "host-disk-guard",
    "",
    "Usage:",
    "  npm run ops:disk:check",
    "  npm run ops:disk:cleanup:dry",
    "  npm run ops:disk:cleanup",
    "  node scripts/host-disk-guard.mjs --apply --include-sessions --session-age-days=14",
    "",
    "Flags:",
    "  --apply                    Apply cleanup plan (default: dry-run)",
    "  --include-sessions         Allow deleting old session jsonl files",
    "  --keep-recent-sessions=N   Keep newest N session files (default: 20)",
    "  --session-age-days=N       Session candidate age threshold (default: 7)",
    "  --reports-age-days=N       .pi/reports age threshold (default: 14)",
    "  --max-delete-mb=N          Hard cap for total deletion in apply mode (default: 2048)",
    "  --warn-free-mb=N           Warn threshold for workspace filesystem free space (default: 10240)",
    "  --block-free-mb=N          Block-long-run threshold for free space (default: 5120)",
    "  --json                     JSON output",
    "  -h, --help",
    "",
    "Safety policy:",
    "  - dry-run by default",
    "  - session files are never deleted unless --include-sessions",
    "  - apply mode enforces --max-delete-mb cap",
  ].join("\n"));
}

function safeStat(path) {
  try {
    const s = statSync(path);
    if (!s.isFile()) return undefined;
    return s;
  } catch {
    return undefined;
  }
}

function walkFiles(rootDir) {
  const files = [];
  if (!existsSync(rootDir)) return files;
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }

  return files;
}

function readWorkspaceDiskPressure(cwd, opts) {
  try {
    const fsStat = statfsSync(cwd);
    const totalBytes = Number(fsStat.blocks) * Number(fsStat.bsize);
    const freeBytes = Number(fsStat.bavail) * Number(fsStat.bsize);
    const freeMb = toMb(freeBytes);
    const totalMb = toMb(totalBytes);
    const usedPct = totalBytes > 0
      ? Math.round((1 - (freeBytes / totalBytes)) * 10_000) / 100
      : 0;
    const blockFreeMb = Math.min(opts.warnFreeMb, opts.blockFreeMb);
    const severity = freeMb <= blockFreeMb
      ? "block-long-run"
      : freeMb <= opts.warnFreeMb
        ? "warn"
        : "ok";
    const recommendation = severity === "block-long-run"
      ? "pause large long-runs; run dry cleanup and confirm deletions before continuing"
      : severity === "warn"
        ? "continue only with bounded/focal work; cleanup soon"
        : "safe to continue bounded work";
    return { totalMb, freeMb, usedPct, warnFreeMb: opts.warnFreeMb, blockFreeMb, severity, recommendation };
  } catch (error) {
    return {
      totalMb: 0,
      freeMb: 0,
      usedPct: 0,
      warnFreeMb: opts.warnFreeMb,
      blockFreeMb: Math.min(opts.warnFreeMb, opts.blockFreeMb),
      severity: "unknown",
      recommendation: `disk pressure unavailable: ${String(error?.message ?? error)}`,
    };
  }
}

function gatherBgArtifacts() {
  const roots = Array.from(new Set([tmpdir(), "/tmp"]));
  const out = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let entries;
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/^oh-pi-bg-.*\.(log|pid)$/i.test(entry.name)) continue;
      const full = join(root, entry.name);
      const st = safeStat(full);
      if (!st) continue;
      out.push({
        path: full,
        bytes: st.size,
        ageDays: (Date.now() - st.mtimeMs) / (24 * 60 * 60 * 1000),
        class: "bg-artifact",
      });
    }
  }
  return out;
}

function gatherReports(cwd) {
  const root = join(cwd, ".pi", "reports");
  const out = [];
  for (const file of walkFiles(root)) {
    const st = safeStat(file);
    if (!st) continue;
    out.push({
      path: file,
      bytes: st.size,
      ageDays: (Date.now() - st.mtimeMs) / (24 * 60 * 60 * 1000),
      class: "pi-report",
    });
  }
  return out;
}

function normalizeSlashes(inputPath) {
  return String(inputPath || "").replace(/\\/g, "/");
}

function encodeSessionNamespaceFromPath(inputPath) {
  const normalized = normalizeSlashes(resolve(inputPath));
  const win = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (win) {
    const drive = win[1].toUpperCase();
    const rest = win[2].split("/").filter(Boolean).join("-");
    return `--${drive}--${rest}--`;
  }
  const mntWin = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(normalized);
  if (mntWin) {
    const drive = mntWin[1].toUpperCase();
    const rest = mntWin[2].split("/").filter(Boolean).join("-");
    return `--${drive}--${rest}--`;
  }
  const unix = normalized.split("/").filter(Boolean).join("-");
  return `--${unix}--`;
}

function gatherSessionFiles(root, className) {
  const out = [];
  for (const file of walkFiles(root)) {
    if (!file.toLowerCase().endsWith(".jsonl")) continue;
    const st = safeStat(file);
    if (!st) continue;
    out.push({
      path: file,
      bytes: st.size,
      ageDays: (Date.now() - st.mtimeMs) / (24 * 60 * 60 * 1000),
      class: className,
      mtimeMs: st.mtimeMs,
    });
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

function gatherSessions(cwd) {
  return gatherSessionFiles(join(cwd, ".sandbox", "pi-agent", "sessions"), "session-jsonl");
}

function gatherGlobalWorkspaceSessions(cwd) {
  const root = join(homedir(), ".pi", "agent", "sessions", encodeSessionNamespaceFromPath(cwd));
  return gatherSessionFiles(root, "global-session-jsonl");
}

function selectCandidates(all, opts) {
  const reportCutoffDays = Math.max(1, opts.reportsAgeDays);
  const sessionCutoffDays = Math.max(1, opts.sessionAgeDays);

  const bg = all.bg.map((x) => ({ ...x, canDelete: true, reason: "safe-temp-artifact" }));

  const reports = all.reports.map((x) => ({
    ...x,
    canDelete: x.ageDays >= reportCutoffDays,
    reason: x.ageDays >= reportCutoffDays
      ? `older-than-${reportCutoffDays}d`
      : "recent-report-keep",
  }));

  const sessions = all.sessions.map((x, idx) => {
    const oldEnough = x.ageDays >= sessionCutoffDays;
    const beyondKeep = idx >= Math.max(0, opts.keepRecentSessions);
    const selectedByAge = oldEnough && beyondKeep;
    const canDelete = opts.includeSessions && selectedByAge;
    let reason = "session-protected";
    if (!opts.includeSessions) reason = "requires---include-sessions";
    else if (!oldEnough) reason = "recent-session-keep";
    else if (!beyondKeep) reason = `keep-recent-${opts.keepRecentSessions}`;
    else reason = `older-than-${sessionCutoffDays}d`;
    return { ...x, canDelete, reason };
  });

  const allRows = [...bg, ...reports, ...sessions];
  const deletable = allRows.filter((x) => x.canDelete).sort((a, b) => b.bytes - a.bytes);
  const dryOnly = allRows.filter((x) => !x.canDelete).sort((a, b) => b.bytes - a.bytes);

  return { allRows, deletable, dryOnly };
}

function applyDeletion(rows, maxDeleteMb) {
  const capBytes = Math.max(128, Math.floor(Number(maxDeleteMb) || 0)) * MB;
  const deleted = [];
  const skipped = [];
  let deletedBytes = 0;

  for (const row of rows) {
    if (deletedBytes + row.bytes > capBytes) {
      skipped.push({ ...row, skipReason: "cap-exceeded" });
      continue;
    }

    try {
      unlinkSync(row.path);
      deleted.push(row);
      deletedBytes += row.bytes;
    } catch (error) {
      skipped.push({ ...row, skipReason: `unlink-failed:${String(error?.message ?? error)}` });
    }
  }

  return {
    capBytes,
    deleted,
    skipped,
    deletedBytes,
  };
}

export function planDiskGuard(cwd, opts) {
  const all = {
    bg: gatherBgArtifacts(),
    reports: gatherReports(cwd),
    sessions: gatherSessions(cwd),
    globalSessions: gatherGlobalWorkspaceSessions(cwd),
  };
  const selection = selectCandidates(all, opts);

  const formatTopSessions = (rows) => [...rows]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10)
    .map((x) => ({
      path: relative(cwd, x.path).replace(/\\/g, "/"),
      sizeMb: toMb(x.bytes),
      ageDays: Math.round(x.ageDays * 10) / 10,
    }));

  const topSessions = formatTopSessions(all.sessions);
  const topGlobalSessions = formatTopSessions(all.globalSessions);

  const disk = readWorkspaceDiskPressure(cwd, opts);

  return {
    generatedAtIso: new Date().toISOString(),
    cwd,
    options: opts,
    disk,
    inventory: {
      bgArtifactCount: all.bg.length,
      bgArtifactTotalMb: toMb(all.bg.reduce((sum, x) => sum + x.bytes, 0)),
      reportCount: all.reports.length,
      reportTotalMb: toMb(all.reports.reduce((sum, x) => sum + x.bytes, 0)),
      sessionCount: all.sessions.length,
      sessionTotalMb: toMb(all.sessions.reduce((sum, x) => sum + x.bytes, 0)),
      globalSessionCount: all.globalSessions.length,
      globalSessionTotalMb: toMb(all.globalSessions.reduce((sum, x) => sum + x.bytes, 0)),
      topSessions,
      topGlobalSessions,
    },
    candidateSummary: {
      deletableCount: selection.deletable.length,
      deletableMb: toMb(selection.deletable.reduce((sum, x) => sum + x.bytes, 0)),
      protectedCount: selection.dryOnly.length,
      protectedMb: toMb(selection.dryOnly.reduce((sum, x) => sum + x.bytes, 0)),
    },
    deletable: selection.deletable.map((x) => ({
      class: x.class,
      reason: x.reason,
      path: relative(cwd, x.path).replace(/\\/g, "/"),
      sizeBytes: x.bytes,
      sizeMb: toMb(x.bytes),
      ageDays: Math.round(x.ageDays * 10) / 10,
    })),
  };
}

function printHuman(report, applyResult) {
  console.log("host-disk-guard");
  console.log(`generated: ${report.generatedAtIso}`);
  console.log(`disk: severity=${report.disk.severity} free=${report.disk.freeMb}MB used=${report.disk.usedPct}% recommendation=${report.disk.recommendation}`);
  console.log(`volatile: bgArtifacts=${report.inventory.bgArtifactTotalMb}MB reports=${report.inventory.reportTotalMb}MB sessions=${report.inventory.sessionTotalMb}MB globalSessions=${report.inventory.globalSessionTotalMb}MB`);
  console.log(`candidates: ${report.candidateSummary.deletableCount} files / ${report.candidateSummary.deletableMb} MB`);
  console.log(`protected: ${report.candidateSummary.protectedCount} files / ${report.candidateSummary.protectedMb} MB`);
  if (report.inventory.topSessions.length > 0) {
    console.log("top sandbox session files:");
    for (const row of report.inventory.topSessions) {
      console.log(`- ${row.path} (${row.sizeMb} MB, age=${row.ageDays}d)`);
    }
  }
  if (report.inventory.topGlobalSessions.length > 0) {
    console.log("top global session files:");
    for (const row of report.inventory.topGlobalSessions) {
      console.log(`- ${row.path} (${row.sizeMb} MB, age=${row.ageDays}d)`);
    }
  }

  if (!applyResult) {
    console.log("mode: dry-run");
    return;
  }

  console.log(`mode: apply (cap=${toMb(applyResult.capBytes)} MB)`);
  console.log(`deleted: ${applyResult.deleted.length} files / ${toMb(applyResult.deletedBytes)} MB`);
  if (applyResult.skipped.length > 0) {
    console.log(`skipped: ${applyResult.skipped.length}`);
  }
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exit(1);
  }

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const cwd = resolve(process.cwd());
  const report = planDiskGuard(cwd, opts);

  let applyResult;
  if (opts.apply) {
    const resolved = report.deletable.map((row) => ({
      ...row,
      path: join(cwd, row.path),
      bytes: Number(row.sizeBytes) || 0,
    }));
    applyResult = applyDeletion(resolved, opts.maxDeleteMb);
  }

  if (opts.json) {
    console.log(JSON.stringify({ report, applyResult }, null, 2));
  } else {
    printHuman(report, applyResult);
  }
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main();
}
