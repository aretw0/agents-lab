#!/usr/bin/env node

/**
 * context-preload-pack
 *
 * Gera um "warm pack" de contexto para reduzir re-leitura repetitiva após
 * compact/resume. Analisa tool calls `read` em sessões recentes e produz:
 *
 * - top arquivos mais lidos (telemetria real)
 * - sugestão de pack control-plane (core)
 * - sugestão de pack worker (lean)
 *
 * Uso:
 *   node scripts/context-preload-pack.mjs
 *   node scripts/context-preload-pack.mjs --days 2 --limit 10 --top 20
 *   node scripts/context-preload-pack.mjs --json
 *   node scripts/context-preload-pack.mjs --write
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const out = {
    days: 1,
    limit: 8,
    top: 16,
    workspace: process.cwd(),
    json: false,
    write: false,
    out: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days") {
      out.days = Number(argv[i + 1] ?? out.days);
      i++;
      continue;
    }
    if (a === "--limit") {
      out.limit = Number(argv[i + 1] ?? out.limit);
      i++;
      continue;
    }
    if (a === "--top") {
      out.top = Number(argv[i + 1] ?? out.top);
      i++;
      continue;
    }
    if (a === "--workspace") {
      out.workspace = argv[i + 1] ?? out.workspace;
      i++;
      continue;
    }
    if (a === "--out") {
      out.out = argv[i + 1] ?? out.out;
      i++;
      continue;
    }
    if (a === "--json") {
      out.json = true;
      continue;
    }
    if (a === "--write") {
      out.write = true;
      continue;
    }
  }

  if (!Number.isFinite(out.days) || out.days <= 0) out.days = 1;
  if (!Number.isFinite(out.limit) || out.limit <= 0) out.limit = 8;
  if (!Number.isFinite(out.top) || out.top <= 0) out.top = 16;
  return out;
}

function toSessionWorkspaceKey(absPath) {
  const resolved = path.resolve(absPath).replace(/\\/g, "/");
  const drive = resolved.match(/^([A-Za-z]):\/(.*)$/);
  if (drive) {
    const letter = drive[1].toUpperCase();
    const rest = drive[2]
      .split("/")
      .filter(Boolean)
      .map((s) => s.replace(/[^A-Za-z0-9._-]/g, "-"))
      .join("-");
    return `--${letter}--${rest}--`;
  }

  const rest = resolved
    .replace(/^\//, "")
    .split("/")
    .filter(Boolean)
    .map((s) => s.replace(/[^A-Za-z0-9._-]/g, "-"))
    .join("-");
  return `--${rest}--`;
}

function detectSessionDirs(workspace) {
  const key = toSessionWorkspaceKey(workspace);
  const local = path.join(workspace, ".sandbox", "pi-agent", "sessions", key);
  const user = path.join(homedir(), ".pi", "agent", "sessions", key);
  return [local, user].filter((p, idx, all) => all.indexOf(p) === idx);
}

function listRecentSessionFiles(workspace, lookbackDays, limit) {
  const roots = detectSessionDirs(workspace);
  const cutoffMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const files = [];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      if (!name.endsWith(".jsonl")) continue;
      const full = path.join(root, name);
      try {
        const st = statSync(full);
        if (st.mtimeMs >= cutoffMs) files.push({ path: full, mtimeMs: st.mtimeMs });
      } catch {
        // ignore transient files
      }
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.slice(0, Math.max(1, limit));
}

function normalizeReadPath(rawPath, workspaceRoot) {
  if (typeof rawPath !== "string") return undefined;
  const trimmed = rawPath.trim();
  if (!trimmed) return undefined;

  const asPosix = trimmed.replace(/\\/g, "/");
  const ws = path.resolve(workspaceRoot).replace(/\\/g, "/");

  // C:/... and /mnt/c/... absolute paths
  const mnt = asPosix.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (mnt) {
    const converted = `${mnt[1].toUpperCase()}:/${mnt[2]}`;
    return normalizeReadPath(converted, workspaceRoot);
  }

  const windowsAbs = asPosix.match(/^[A-Za-z]:\/.*/);
  if (windowsAbs) {
    if (asPosix.toLowerCase().startsWith(ws.toLowerCase() + "/")) {
      return asPosix.slice(ws.length + 1);
    }
    if (asPosix.toLowerCase() === ws.toLowerCase()) return ".";
    return asPosix;
  }

  if (asPosix.startsWith("/")) return asPosix;
  return asPosix.replace(/^\.\//, "");
}

function classifyPath(p) {
  if (!p) return "unknown";
  const v = p.toLowerCase();
  if (v.startsWith("node_modules/") || v.includes("/node_modules/")) return "noise";
  if (v.startsWith(".sandbox/") || v.includes("/.sandbox/")) return "noise";
  if (v.startsWith("c:/") || v.startsWith("/mnt/")) return "external";
  if (v.startsWith(".project/")) return "project";
  if (v.startsWith(".pi/")) return "runtime";
  if (v.startsWith("docs/")) return "docs";
  if (v.startsWith("packages/")) return "code";
  if (v.startsWith("scripts/")) return "code";
  return "workspace";
}

function collectReadTelemetry(sessionFiles, workspaceRoot) {
  const counts = new Map();
  let totalReadCalls = 0;
  let parsedLines = 0;

  for (const file of sessionFiles) {
    let text = "";
    try {
      text = readFileSync(file.path, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      parsedLines++;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event?.type !== "message") continue;
      const msg = event?.message;
      if (msg?.role !== "assistant") continue;
      const content = Array.isArray(msg?.content) ? msg.content : [];
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        if (part.type !== "toolCall") continue;
        if (part.name !== "read") continue;

        const normalized = normalizeReadPath(part.arguments?.path, workspaceRoot);
        if (!normalized) continue;
        totalReadCalls++;
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
      }
    }
  }

  return { counts, totalReadCalls, parsedLines };
}

function topEntries(counts, totalReadCalls, maxItems) {
  return [...counts.entries()]
    .map(([file, count]) => ({
      file,
      count,
      sharePct: totalReadCalls > 0 ? Number(((count / totalReadCalls) * 100).toFixed(2)) : 0,
      class: classifyPath(file),
    }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))
    .slice(0, maxItems);
}

function buildPreloadPack(top, maxCore = 10, maxLean = 6, maxScout = 5) {
  const workspaceTop = top.filter((e) => e.class !== "noise" && e.class !== "external");

  const controlPlaneCore = workspaceTop
    .filter((e) => ["project", "docs", "runtime", "code", "workspace"].includes(e.class))
    .slice(0, maxCore)
    .map((e) => e.file);

  const agentWorkerLean = workspaceTop
    .filter((e) => ["project", "docs", "code"].includes(e.class))
    .slice(0, maxLean)
    .map((e) => e.file);

  const swarmScoutMin = workspaceTop
    .filter((e) => ["project", "docs", "workspace"].includes(e.class))
    .slice(0, maxScout)
    .map((e) => e.file);

  return {
    controlPlaneCore,
    agentWorkerLean,
    swarmScoutMin,
    skipClasses: ["noise", "external"],
    freshnessRule: "recompute on each checkpoint/compact or when canonical state changes (handoff/tasks/verification)",
  };
}

function readCanonicalState(workspace) {
  const files = [
    ".project/handoff.json",
    ".project/tasks.json",
    ".project/verification.json",
  ];
  const entries = files.map((rel) => {
    const abs = path.join(workspace, rel);
    if (!existsSync(abs)) {
      return { path: rel, exists: false, mtimeMs: 0 };
    }
    try {
      const st = statSync(abs);
      return { path: rel, exists: true, mtimeMs: Math.floor(st.mtimeMs) };
    } catch {
      return { path: rel, exists: false, mtimeMs: 0 };
    }
  });

  const fingerprint = createHash("sha1")
    .update(entries.map((e) => `${e.path}:${e.exists ? 1 : 0}:${e.mtimeMs}`).join("|"))
    .digest("hex");

  return {
    fingerprint,
    files: entries,
  };
}

function printHuman(report) {
  const lines = [];
  lines.push("# Context Preload Pack");
  lines.push("");
  lines.push(`window: ${report.window.lookbackDays}d · sessions=${report.window.sessionsScanned} · readCalls=${report.telemetry.totalReadCalls}`);
  lines.push("");
  lines.push("## Top read paths");
  if (report.topReads.length === 0) {
    lines.push("- (no read telemetry in window)");
  } else {
    for (const row of report.topReads) {
      lines.push(`- ${row.file} — ${row.count}x (${row.sharePct}%) [${row.class}]`);
    }
  }

  lines.push("");
  lines.push("## Suggested preload pack");
  lines.push("### control-plane-core");
  for (const p of report.preloadPack.controlPlaneCore) lines.push(`- ${p}`);
  if (report.preloadPack.controlPlaneCore.length === 0) lines.push("- (empty)");

  lines.push("### agent-worker-lean");
  for (const p of report.preloadPack.agentWorkerLean) lines.push(`- ${p}`);
  if (report.preloadPack.agentWorkerLean.length === 0) lines.push("- (empty)");

  lines.push("### swarm-scout-min");
  for (const p of report.preloadPack.swarmScoutMin) lines.push(`- ${p}`);
  if (report.preloadPack.swarmScoutMin.length === 0) lines.push("- (empty)");

  lines.push("");
  lines.push(`freshness: ${report.preloadPack.freshnessRule}`);
  lines.push(`canonical-fingerprint: ${report.canonicalState.fingerprint}`);
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspace = path.resolve(args.workspace);
  const sessionFiles = listRecentSessionFiles(workspace, args.days, args.limit);
  const telemetry = collectReadTelemetry(sessionFiles, workspace);
  const topReads = topEntries(telemetry.counts, telemetry.totalReadCalls, args.top);
  const preloadPack = buildPreloadPack(topReads);
  const canonicalState = readCanonicalState(workspace);

  const report = {
    generatedAtIso: new Date().toISOString(),
    workspace,
    window: {
      lookbackDays: args.days,
      sessionLimit: args.limit,
      sessionsScanned: sessionFiles.length,
      sessionFiles: sessionFiles.map((s) => path.relative(workspace, s.path).replace(/\\/g, "/")),
      parsedLines: telemetry.parsedLines,
    },
    telemetry: {
      totalReadCalls: telemetry.totalReadCalls,
      uniqueReadPaths: telemetry.counts.size,
    },
    topReads,
    preloadPack,
    canonicalState,
  };

  const outPath = args.out || path.join(workspace, ".sandbox", "pi-agent", "preload", "context-preload-pack.json");
  if (args.write) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const human = printHuman(report);
  console.log(human);
  if (args.write) {
    console.log(`\nwritten: ${outPath.replace(/\\/g, "/")}`);
  }
}

main();
