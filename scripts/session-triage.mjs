#!/usr/bin/env node

/**
 * Session + board triage focused on recent activity (default: last 1 day).
 *
 * Why this exists:
 * - Build a compact operational view from recent pi session history
 * - Reconcile branch-summary follow-ups with board pending work
 * - Separate "unlock swarm now" vs "later stabilization" actions
 *
 * Usage:
 *   node scripts/session-triage.mjs
 *   node scripts/session-triage.mjs --days 2 --limit 12
 *   node scripts/session-triage.mjs --events ./data/canonical-events.json
 *   node scripts/session-triage.mjs --summary-store ./.sandbox/pi-agent/triage/branch-summary-store.json
 *   node scripts/session-triage.mjs --no-summary-store
 *   node scripts/session-triage.mjs --json
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const out = {
    days: 1,
    limit: 8,
    json: false,
    workspace: process.cwd(),
    eventsPath: undefined,
    summaryStore: true,
    summaryStorePath: undefined,
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
    if (a === "--workspace") {
      out.workspace = argv[i + 1] ?? out.workspace;
      i++;
      continue;
    }
    if (a === "--events") {
      out.eventsPath = argv[i + 1] ?? out.eventsPath;
      i++;
      continue;
    }
    if (a === "--json") {
      out.json = true;
      continue;
    }
    if (a === "--summary-store") {
      out.summaryStore = true;
      out.summaryStorePath = argv[i + 1] ?? out.summaryStorePath;
      i++;
      continue;
    }
    if (a === "--no-summary-store") {
      out.summaryStore = false;
      continue;
    }
  }

  if (!Number.isFinite(out.days) || out.days <= 0) out.days = 1;
  if (!Number.isFinite(out.limit) || out.limit <= 0) out.limit = 8;
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

function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      return "";
    })
    .join("\n");
}

function extractSummaryBlock(text) {
  const tagged = text.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (tagged?.[1]) return tagged[1].trim();

  const hasSummaryHint =
    /summary of a branch/i.test(text) ||
    /conversation history before this point was compacted/i.test(text) ||
    /the following is a summary/i.test(text);

  if (!hasSummaryHint) return null;
  return text.trim();
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionBullets(summary, title) {
  const rx = new RegExp(`##\\s*${escapeRegex(title)}\\s*([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
  const block = summary.match(rx)?.[1] ?? "";
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l) || /^\d+\.\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean);
}

function addCount(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function toIsoOrFallback(raw, fallbackIso) {
  if (!raw) return fallbackIso;
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return fallbackIso;
  return d.toISOString();
}

function normalizeSummaryEntry(entry, fallbackSource = "unknown", fallbackSeenAt = new Date().toISOString()) {
  return {
    nextSteps: dedupeStrings(entry?.nextSteps ?? []),
    inProgress: dedupeStrings(entry?.inProgress ?? []),
    blocked: dedupeStrings(entry?.blocked ?? []),
    source: typeof entry?.source === "string" && entry.source.trim() ? entry.source : fallbackSource,
    seenAt: toIsoOrFallback(entry?.seenAt, fallbackSeenAt),
  };
}

function summaryFingerprint(entry) {
  const pack = (arr) => dedupeStrings(arr).map((x) => x.toLowerCase()).sort().join("|");
  return `${pack(entry.nextSteps)}::${pack(entry.inProgress)}::${pack(entry.blocked)}`;
}

function mergeSummaryEntries(existingEntries, incomingEntries) {
  const byFingerprint = new Map();

  for (const raw of [...existingEntries, ...incomingEntries]) {
    const norm = normalizeSummaryEntry(raw);
    const key = summaryFingerprint(norm);
    const prev = byFingerprint.get(key);
    if (!prev) {
      byFingerprint.set(key, norm);
      continue;
    }
    const prevMs = new Date(prev.seenAt).getTime();
    const currMs = new Date(norm.seenAt).getTime();
    if (Number.isFinite(currMs) && (!Number.isFinite(prevMs) || currMs >= prevMs)) {
      byFingerprint.set(key, norm);
    }
  }

  return [...byFingerprint.values()].sort((a, b) => new Date(b.seenAt).getTime() - new Date(a.seenAt).getTime());
}

function loadSummaryStore(storePath) {
  if (!storePath || !existsSync(storePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(storePath, "utf8"));
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return entries.map((entry) => normalizeSummaryEntry(entry));
  } catch {
    return [];
  }
}

function writeSummaryStore(storePath, entries, retentionDays = 30, maxEntries = 500) {
  if (!storePath) return;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const filtered = entries
    .filter((entry) => new Date(entry.seenAt).getTime() >= cutoff)
    .slice(0, maxEntries);

  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    retentionDays,
    entries: filtered,
  };

  mkdirSync(path.dirname(storePath), { recursive: true });
  writeFileSync(storePath, JSON.stringify(payload, null, 2));
}

function parseSessionFile(filePath) {
  const lines = readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);

  const out = {
    file: path.basename(filePath),
    path: filePath,
    updatedAt: new Date(statSync(filePath).mtimeMs).toISOString(),
    messageCount: 0,
    userMessages: 0,
    assistantMessages: 0,
    colonySignals: {},
    branchSummaries: [],
  };

  const signalCount = new Map();

  for (const line of lines) {
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }

    if (rec?.type !== "message") continue;
    const role = rec?.message?.role;
    const text = extractText(rec?.message?.content);
    out.messageCount += 1;
    if (role === "user") out.userMessages += 1;
    if (role === "assistant") out.assistantMessages += 1;

    const matches = [...text.matchAll(/\[COLONY_SIGNAL:([A-Z_]+)\]/g)];
    for (const m of matches) addCount(signalCount, m[1]);

    if (role !== "toolResult") {
      const summary = extractSummaryBlock(text);
      if (summary) {
        out.branchSummaries.push(
          normalizeSummaryEntry(
            {
              nextSteps: sectionBullets(summary, "Next Steps"),
              inProgress: sectionBullets(summary, "In Progress"),
              blocked: sectionBullets(summary, "Blocked"),
              source: path.basename(filePath),
              seenAt: toIsoOrFallback(rec?.timestamp ?? rec?.createdAt, out.updatedAt),
            },
            path.basename(filePath),
            out.updatedAt,
          ),
        );
      }
    }
  }

  out.colonySignals = Object.fromEntries([...signalCount.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  return out;
}

function normalizeCanonicalText(event) {
  if (!event || typeof event !== "object") return "";
  if (typeof event.text === "string") return event.text;
  if (typeof event.message === "string") return event.message;
  if (typeof event.content === "string") return event.content;
  if (Array.isArray(event.content)) return extractText(event.content);
  return "";
}

function parseCanonicalEventsFile(eventsPath, cutoffMs) {
  if (!eventsPath || !existsSync(eventsPath)) return null;

  let raw;
  try {
    raw = JSON.parse(readFileSync(eventsPath, "utf8"));
  } catch {
    return null;
  }

  const events = Array.isArray(raw) ? raw : Array.isArray(raw?.events) ? raw.events : [];
  if (!Array.isArray(events) || events.length === 0) return null;

  const signalCount = new Map();
  const out = {
    file: `canonical:${path.basename(eventsPath)}`,
    path: path.resolve(eventsPath),
    updatedAt: new Date(statSync(eventsPath).mtimeMs).toISOString(),
    messageCount: 0,
    userMessages: 0,
    assistantMessages: 0,
    colonySignals: {},
    branchSummaries: [],
  };

  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const ev = event.event && typeof event.event === "object" ? event.event : event;

    const tsRaw = ev.timestampIso ?? ev.timestamp ?? ev.createdAt ?? ev.created_at;
    const ts = tsRaw ? new Date(tsRaw) : undefined;
    if (ts && Number.isFinite(ts.getTime()) && ts.getTime() < cutoffMs) continue;

    const roleRaw = ev.role ?? ev.authorRole ?? ev.author_role;
    const role = typeof roleRaw === "string" ? roleRaw.toLowerCase() : "unknown";
    const text = normalizeCanonicalText(ev);

    out.messageCount += 1;
    if (role === "user" || role === "human") out.userMessages += 1;
    if (role === "assistant" || role === "agent" || role === "bot") out.assistantMessages += 1;

    const matches = [...text.matchAll(/\[COLONY_SIGNAL:([A-Z_]+)\]/g)];
    for (const m of matches) addCount(signalCount, m[1]);

    const summary = extractSummaryBlock(text);
    if (summary) {
      out.branchSummaries.push(
        normalizeSummaryEntry(
          {
            nextSteps: sectionBullets(summary, "Next Steps"),
            inProgress: sectionBullets(summary, "In Progress"),
            blocked: sectionBullets(summary, "Blocked"),
            source: `canonical:${path.basename(eventsPath)}`,
            seenAt: toIsoOrFallback(tsRaw, out.updatedAt),
          },
          `canonical:${path.basename(eventsPath)}`,
          out.updatedAt,
        ),
      );
    }
  }

  out.colonySignals = Object.fromEntries([...signalCount.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  return out;
}

function loadBoardPending(cwd) {
  const tasksPath = path.join(cwd, ".project", "tasks.json");
  if (!existsSync(tasksPath)) {
    return {
      pending: [],
      unlockNow: [],
      later: [],
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(tasksPath, "utf8"));
  } catch {
    return { pending: [], unlockNow: [], later: [] };
  }

  const pending = (parsed.tasks ?? []).filter((t) => ["planned", "in-progress", "blocked"].includes(t.status));

  const normalize = (task) => ({
    id: task.id,
    status: task.status,
    description: String(task.description ?? "").replace(/\s+/g, " ").trim(),
  });

  const unlockNow = pending
    .filter((t) => /-promotion$/i.test(t.id) || /\[P0\]/i.test(String(t.description ?? "")) || t.status === "blocked")
    .map(normalize);

  const unlockNowIds = new Set(unlockNow.map((t) => t.id));
  const later = pending.filter((t) => !unlockNowIds.has(t.id)).map(normalize);

  return {
    pending: pending.map(normalize),
    unlockNow,
    later,
  };
}

function dedupeStrings(values) {
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const v = String(raw ?? "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function renderHuman(report) {
  const lines = [];
  lines.push(`# Session triage (last ${report.lookbackDays} day(s))`);
  lines.push("");
  lines.push(`Workspace: ${report.workspace}`);
  lines.push(`Session dir: ${report.sessionDir}`);
  if (report.sources?.canonicalEvents) {
    lines.push(`Canonical events: ${report.sources.canonicalEvents}`);
  }
  if (report.sources?.branchSummaryStore) {
    lines.push(`Branch-summary store: ${report.sources.branchSummaryStore}`);
  }
  lines.push(`Scanned: ${report.sessions.length} file(s)`);
  lines.push("");

  lines.push("## Recent sessions");
  if (report.sessions.length === 0) {
    lines.push("- (none found in lookback window)");
  } else {
    for (const s of report.sessions) {
      const sig = Object.entries(s.colonySignals)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      lines.push(`- ${s.file}`);
      lines.push(`  - msgs: ${s.messageCount} (user ${s.userMessages}, assistant ${s.assistantMessages})`);
      lines.push(`  - branch summaries: ${s.branchSummaries.length}`);
      lines.push(`  - colony signals: ${sig || "none"}`);
    }
  }
  lines.push("");

  lines.push(`## Branch-summary aggregation (merged=${report.aggregate.branchSummariesCount ?? 0})`);
  lines.push("### In Progress");
  if (report.aggregate.inProgress.length === 0) lines.push("- (none)");
  else report.aggregate.inProgress.forEach((x) => lines.push(`- ${x}`));
  lines.push("### Blocked");
  if (report.aggregate.blocked.length === 0) lines.push("- (none)");
  else report.aggregate.blocked.forEach((x) => lines.push(`- ${x}`));
  lines.push("### Next Steps");
  if (report.aggregate.nextSteps.length === 0) lines.push("- (none)");
  else report.aggregate.nextSteps.forEach((x) => lines.push(`- ${x}`));
  lines.push("");

  lines.push("## Board pending split");
  lines.push(`Pending total: ${report.board.pending.length}`);
  lines.push("### Unlock swarm now");
  if (report.board.unlockNow.length === 0) lines.push("- (none)");
  else report.board.unlockNow.forEach((t) => lines.push(`- ${t.id} [${t.status}] ${t.description.slice(0, 120)}`));
  lines.push("### Later stabilization");
  if (report.board.later.length === 0) lines.push("- (none)");
  else report.board.later.forEach((t) => lines.push(`- ${t.id} [${t.status}] ${t.description.slice(0, 120)}`));

  return lines.join("\n");
}

const opts = parseArgs(process.argv.slice(2));
const workspace = path.resolve(opts.workspace);
const key = toSessionWorkspaceKey(workspace);
const sessionDir = path.join(homedir(), ".pi", "agent", "sessions", key);
const cutoff = Date.now() - opts.days * 24 * 60 * 60 * 1000;
const summaryStorePath = opts.summaryStore
  ? path.resolve(opts.summaryStorePath ?? path.join(workspace, ".sandbox", "pi-agent", "triage", "branch-summary-store.json"))
  : null;

let sessions = [];
if (existsSync(sessionDir)) {
  sessions = readdirSync(sessionDir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => ({
      name,
      path: path.join(sessionDir, name),
      mtime: statSync(path.join(sessionDir, name)).mtimeMs,
    }))
    .filter((f) => f.mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, opts.limit)
    .map((f) => parseSessionFile(f.path));
}

if (opts.eventsPath) {
  const canonical = parseCanonicalEventsFile(path.resolve(opts.eventsPath), cutoff);
  if (canonical) sessions.unshift(canonical);
}

const sessionSummaries = sessions.flatMap((session) =>
  (session.branchSummaries ?? []).map((summary) =>
    normalizeSummaryEntry(summary, session.file, session.updatedAt),
  ),
);

const storedSummaries = summaryStorePath ? loadSummaryStore(summaryStorePath) : [];
const mergedSummaries = mergeSummaryEntries(storedSummaries, sessionSummaries);
if (summaryStorePath) {
  writeSummaryStore(summaryStorePath, mergedSummaries);
}

const allNext = [];
const allInProgress = [];
const allBlocked = [];
const signalTotals = new Map();

for (const bs of mergedSummaries) {
  allNext.push(...bs.nextSteps);
  allInProgress.push(...bs.inProgress);
  allBlocked.push(...bs.blocked);
}

for (const s of sessions) {
  for (const [k, v] of Object.entries(s.colonySignals)) addCount(signalTotals, k, v);
}

const report = {
  generatedAt: new Date().toISOString(),
  workspace,
  lookbackDays: opts.days,
  limit: opts.limit,
  sessionDir,
  sources: {
    piSessionJsonl: existsSync(sessionDir),
    canonicalEvents: opts.eventsPath ? path.resolve(opts.eventsPath) : null,
    branchSummaryStore: summaryStorePath,
  },
  sessions,
  aggregate: {
    colonySignals: Object.fromEntries([...signalTotals.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    nextSteps: dedupeStrings(allNext),
    inProgress: dedupeStrings(allInProgress),
    blocked: dedupeStrings(allBlocked),
    branchSummariesCount: mergedSummaries.length,
  },
  branchSummaryStore: {
    enabled: Boolean(summaryStorePath),
    path: summaryStorePath,
    loaded: storedSummaries.length,
    merged: mergedSummaries.length,
    sessionExtracted: sessionSummaries.length,
  },
  board: loadBoardPending(workspace),
};

if (opts.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(renderHuman(report));
}
