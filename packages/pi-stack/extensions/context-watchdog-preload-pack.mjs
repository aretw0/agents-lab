/**
 * @capability-id context-watchdog
 * @capability-criticality medium
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const CANONICAL_PATHS = [
  ".project/handoff.json",
  ".project/tasks.json",
  ".project/verification.json",
];

export function normalizeContextPreloadPackOptions(input = {}) {
  const days = Number(input.days ?? 1);
  const limit = Number(input.limit ?? 8);
  const top = Number(input.top ?? 16);
  return {
    days: Number.isFinite(days) && days > 0 ? days : 1,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 8,
    top: Number.isFinite(top) && top > 0 ? top : 16,
    workspace: path.resolve(String(input.workspace ?? process.cwd())),
    out: typeof input.out === "string" && input.out.trim() ? input.out : undefined,
    write: input.write === true,
  };
}

export function toSessionWorkspaceKey(absPath) {
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

export function detectContextPreloadSessionDirs(workspace) {
  const key = toSessionWorkspaceKey(workspace);
  const local = path.join(workspace, ".sandbox", "pi-agent", "sessions", key);
  const user = path.join(homedir(), ".pi", "agent", "sessions", key);
  return [local, user].filter((p, idx, all) => all.indexOf(p) === idx);
}

export function listRecentContextPreloadSessionFiles(workspace, lookbackDays, limit) {
  const roots = detectContextPreloadSessionDirs(workspace);
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

export function normalizeContextPreloadReadPath(rawPath, workspaceRoot) {
  if (typeof rawPath !== "string") return undefined;
  const trimmed = rawPath.trim();
  if (!trimmed) return undefined;

  const asPosix = trimmed.replace(/\\/g, "/");
  const ws = path.resolve(workspaceRoot).replace(/\\/g, "/");
  const mnt = asPosix.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (mnt) {
    return normalizeContextPreloadReadPath(`${mnt[1].toUpperCase()}:/${mnt[2]}`, workspaceRoot);
  }

  if (/^[A-Za-z]:\/.*/.test(asPosix)) {
    if (asPosix.toLowerCase().startsWith(ws.toLowerCase() + "/")) return asPosix.slice(ws.length + 1);
    if (asPosix.toLowerCase() === ws.toLowerCase()) return ".";
    return asPosix;
  }

  if (asPosix.startsWith("/")) {
    if (asPosix.toLowerCase().startsWith(ws.toLowerCase() + "/")) return asPosix.slice(ws.length + 1);
    if (asPosix.toLowerCase() === ws.toLowerCase()) return ".";
    return asPosix;
  }
  return asPosix.replace(/^\.\//, "");
}

export function classifyContextPreloadPath(filePath) {
  if (!filePath) return "unknown";
  const value = filePath.toLowerCase();
  if (value.startsWith("node_modules/") || value.includes("/node_modules/")) return "noise";
  if (value.startsWith(".sandbox/") || value.includes("/.sandbox/")) return "noise";
  if (value.startsWith("c:/") || value.startsWith("/mnt/")) return "external";
  if (value.startsWith("/")) return "external";
  if (value.startsWith(".project/")) return "project";
  if (value.startsWith(".pi/")) return "runtime";
  if (value.startsWith("docs/")) return "docs";
  if (value.startsWith("packages/")) return "code";
  if (value.startsWith("scripts/")) return "code";
  return "workspace";
}

export function collectContextPreloadReadTelemetry(sessionFiles, workspaceRoot) {
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
      if (event?.message?.role !== "assistant") continue;
      const content = Array.isArray(event?.message?.content) ? event.message.content : [];
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        if (part.type !== "toolCall" || part.name !== "read") continue;
        const normalized = normalizeContextPreloadReadPath(part.arguments?.path, workspaceRoot);
        if (!normalized) continue;
        totalReadCalls++;
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
      }
    }
  }

  return { counts, totalReadCalls, parsedLines };
}

export function buildContextPreloadTopEntries(counts, totalReadCalls, maxItems) {
  return [...counts.entries()]
    .map(([file, count]) => ({
      file,
      count,
      sharePct: totalReadCalls > 0 ? Number(((count / totalReadCalls) * 100).toFixed(2)) : 0,
      class: classifyContextPreloadPath(file),
    }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))
    .slice(0, maxItems);
}

export function buildContextPreloadPack(top, maxCore = 10, maxLean = 6, maxScout = 5) {
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

export function readContextPreloadCanonicalState(workspace) {
  const files = CANONICAL_PATHS.map((rel) => {
    const abs = path.join(workspace, rel);
    if (!existsSync(abs)) return { path: rel, exists: false, mtimeMs: 0 };
    try {
      const st = statSync(abs);
      return { path: rel, exists: true, mtimeMs: Math.floor(st.mtimeMs) };
    } catch {
      return { path: rel, exists: false, mtimeMs: 0 };
    }
  });
  const fingerprint = createHash("sha1")
    .update(files.map((e) => `${e.path}:${e.exists ? 1 : 0}:${e.mtimeMs}`).join("|"))
    .digest("hex");
  return { fingerprint, files };
}

export function runContextPreloadPack(input = {}) {
  const options = normalizeContextPreloadPackOptions(input);
  const sessionFiles = listRecentContextPreloadSessionFiles(options.workspace, options.days, options.limit);
  const telemetry = collectContextPreloadReadTelemetry(sessionFiles, options.workspace);
  const topReads = buildContextPreloadTopEntries(telemetry.counts, telemetry.totalReadCalls, options.top);
  const preloadPack = buildContextPreloadPack(topReads);
  const canonicalState = readContextPreloadCanonicalState(options.workspace);
  const outPath = options.out || path.join(options.workspace, ".sandbox", "pi-agent", "preload", "context-preload-pack.json");
  const report = {
    generatedAtIso: new Date().toISOString(),
    workspace: options.workspace,
    window: {
      lookbackDays: options.days,
      sessionLimit: options.limit,
      sessionsScanned: sessionFiles.length,
      sessionFiles: sessionFiles.map((s) => path.relative(options.workspace, s.path).replace(/\\/g, "/")),
      parsedLines: telemetry.parsedLines,
    },
    telemetry: {
      totalReadCalls: telemetry.totalReadCalls,
      uniqueReadPaths: telemetry.counts.size,
    },
    topReads,
    preloadPack,
    canonicalState,
    outPath,
    written: false,
  };

  if (options.write) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    report.written = true;
  }

  return report;
}

export function formatContextPreloadPackReport(report) {
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

export function summarizeContextPreloadPack(report) {
  return [
    "context-preload-pack:",
    `sessions=${report.window.sessionsScanned}`,
    `readCalls=${report.telemetry.totalReadCalls}`,
    `top=${report.topReads.length}`,
    `controlPlane=${report.preloadPack.controlPlaneCore.length}`,
    `worker=${report.preloadPack.agentWorkerLean.length}`,
    `scout=${report.preloadPack.swarmScoutMin.length}`,
    `written=${report.written ? "yes" : "no"}`,
  ].join(" ");
}
