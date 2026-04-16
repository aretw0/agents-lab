/**
 * session-analytics — queryable session log primitive for swarms and agents.
 *
 * Why this exists:
 * - session-triage.mjs is a CLI tool for human operators.
 * - Swarms need a machine-callable API: structured query params, JSON output.
 * - Makes the session log a first-class data source queryable from the Control Plane.
 *
 * Query types:
 *   signals      — aggregate colony signal counts
 *   timeline     — chronological event sequence
 *   model-usage  — provider/model switches
 *   summary      — top-level session overview
 *
 * @capability-id session-analytics
 * @capability-criticality medium
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Workspace key derivation (mirrors session-triage.mjs logic)
// ---------------------------------------------------------------------------

export function toSessionWorkspaceKey(absPath: string): string {
  const resolved = path.resolve(absPath).replace(/\\/g, "/");
  const driveMatch = resolved.match(/^([A-Za-z]):\/(.*)$/);
  if (driveMatch) {
    const letter = driveMatch[1].toUpperCase();
    const rest = driveMatch[2]
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

export function sessionDir(cwd: string): string {
  return path.join(homedir(), ".pi", "agent", "sessions", toSessionWorkspaceKey(cwd));
}

// ---------------------------------------------------------------------------
// JSONL parsing primitives
// ---------------------------------------------------------------------------

function readJsonlLines(filePath: string): unknown[] {
  try {
    return readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((x) => x !== null);
  } catch {
    return [];
  }
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as unknown[])
    .map((p) => {
      if (typeof p === "string") return p;
      if (p && typeof p === "object") {
        const po = p as Record<string, unknown>;
        if (typeof po["text"] === "string") return po["text"];
        if (typeof po["content"] === "string") return po["content"];
      }
      return "";
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Per-record parsers (pure, testable)
// ---------------------------------------------------------------------------

export interface ColonySignalCount {
  signal: string;
  count: number;
}

export interface ModelChangeEvent {
  timestampIso: string;
  provider: string;
  modelId: string;
}

export interface TimelineEvent {
  timestampIso: string;
  type: string;
  role?: string;
  excerpt?: string;
  signal?: string;
}

export function parseSignals(records: unknown[]): ColonySignalCount[] {
  const counts = new Map<string, number>();
  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const r = rec as Record<string, unknown>;
    if (r["type"] !== "message") continue;
    const msg = r["message"] as Record<string, unknown> | undefined;
    if (!msg) continue;
    const text = extractTextContent(msg["content"]);
    const matches = [...text.matchAll(/\[COLONY_SIGNAL:([A-Z_]+)\]/g)];
    for (const m of matches) {
      const key = m[1];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([signal, count]) => ({ signal, count }));
}

export function parseModelChanges(records: unknown[]): ModelChangeEvent[] {
  const out: ModelChangeEvent[] = [];
  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const r = rec as Record<string, unknown>;
    if (r["type"] !== "model_change") continue;
    out.push({
      timestampIso: typeof r["timestamp"] === "string" ? r["timestamp"] : "",
      provider: typeof r["provider"] === "string" ? r["provider"] : "unknown",
      modelId: typeof r["modelId"] === "string" ? r["modelId"] : "unknown",
    });
  }
  return out;
}

export function parseTimeline(records: unknown[], limit: number): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const r = rec as Record<string, unknown>;
    const ts = typeof r["timestamp"] === "string" ? r["timestamp"] : "";
    const type = typeof r["type"] === "string" ? r["type"] : "unknown";

    if (type === "message") {
      const msg = r["message"] as Record<string, unknown> | undefined;
      const role = typeof msg?.["role"] === "string" ? msg["role"] : undefined;
      const text = msg ? extractTextContent(msg["content"]) : "";
      const signals = [...text.matchAll(/\[COLONY_SIGNAL:([A-Z_]+)\]/g)].map((m) => m[1]);
      if (signals.length > 0) {
        for (const signal of signals) {
          out.push({ timestampIso: ts, type: "colony_signal", role, signal });
        }
      } else if (role === "user" || role === "assistant") {
        out.push({ timestampIso: ts, type, role, excerpt: text.slice(0, 120) });
      }
    } else if (type === "model_change") {
      out.push({
        timestampIso: ts,
        type,
        excerpt: `${r["provider"] ?? ""}/${r["modelId"] ?? ""}`,
      });
    } else if (type === "branch_summary") {
      out.push({ timestampIso: ts, type, excerpt: "(branch summary)" });
    } else if (type === "compaction") {
      out.push({ timestampIso: ts, type, excerpt: "(context compacted)" });
    }

    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Session file listing + age filter
// ---------------------------------------------------------------------------

function listSessionFiles(dir: string, lookbackHours: number): string[] {
  if (!existsSync(dir)) return [];
  const cutoffMs = Date.now() - lookbackHours * 3600 * 1000;
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => path.join(dir, f))
      .filter((p) => {
        try { return statSync(p).mtimeMs >= cutoffMs; } catch { return false; }
      })
      .sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Query engine
// ---------------------------------------------------------------------------

export type QueryType = "signals" | "timeline" | "model-usage" | "summary";

export interface SessionAnalyticsResult {
  queryType: QueryType;
  lookbackHours: number;
  filesScanned: number;
  generatedAt: string;
  data: unknown;
}

export function runQuery(
  cwd: string,
  queryType: QueryType,
  lookbackHours: number,
  signalFilter: string | undefined,
  limit: number,
): SessionAnalyticsResult {
  const dir = sessionDir(cwd);
  const files = listSessionFiles(dir, lookbackHours);
  const allRecords: unknown[] = [];

  for (const file of files) {
    allRecords.push(...readJsonlLines(file));
  }

  let data: unknown;

  if (queryType === "signals") {
    let signals = parseSignals(allRecords);
    if (signalFilter) {
      const allowed = new Set(signalFilter.toUpperCase().split(/[,\s]+/).filter(Boolean));
      signals = signals.filter((s) => allowed.has(s.signal));
    }
    data = { signals, totalSignals: signals.reduce((s, e) => s + e.count, 0) };

  } else if (queryType === "timeline") {
    data = { events: parseTimeline(allRecords, limit) };

  } else if (queryType === "model-usage") {
    const changes = parseModelChanges(allRecords);
    const byProvider = new Map<string, number>();
    for (const c of changes) byProvider.set(c.provider, (byProvider.get(c.provider) ?? 0) + 1);
    data = {
      modelChanges: changes.slice(0, limit),
      byProvider: Object.fromEntries([...byProvider.entries()].sort((a, b) => b[1] - a[1])),
    };

  } else {
    // summary
    const signals = parseSignals(allRecords);
    const modelChanges = parseModelChanges(allRecords);
    const msgRecords = allRecords.filter(
      (r) => r && typeof r === "object" && (r as Record<string, unknown>)["type"] === "message"
    );
    data = {
      sessionsFound: files.length,
      totalRecords: allRecords.length,
      totalMessages: msgRecords.length,
      topSignals: signals.slice(0, 5),
      distinctProviders: [...new Set(modelChanges.map((m) => m.provider))],
    };
  }

  return {
    queryType,
    lookbackHours,
    filesScanned: files.length,
    generatedAt: new Date().toISOString(),
    data,
  };
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function sessionAnalyticsExtension(pi: ExtensionAPI) {
  // ---- tool: session_analytics_query ------------------------------------

  pi.registerTool({
    name: "session_analytics_query",
    label: "Session Analytics Query",
    description: [
      "Query session logs for analytical data (signals, timeline, model-usage, summary).",
      "Used by swarms to inspect recent session history from the Control Plane.",
      "Returns structured JSON; no subprocess invocation.",
    ].join(" "),
    parameters: Type.Object({
      query_type: Type.Union(
        [
          Type.Literal("signals"),
          Type.Literal("timeline"),
          Type.Literal("model-usage"),
          Type.Literal("summary"),
        ],
        { description: "Type of analytical query to run." }
      ),
      lookback_hours: Type.Optional(
        Type.Number({ description: "How many hours back to scan session files. Default: 24." })
      ),
      signal_filter: Type.Optional(
        Type.String({ description: "Comma-separated colony signal names to include (e.g. 'COMPLETE,FAILED'). Only for query_type=signals." })
      ),
      limit: Type.Optional(
        Type.Number({ description: "Maximum records to return for timeline/model-usage. Default: 50." })
      ),
    }),
    execute({ query_type, lookback_hours, signal_filter, limit }) {
      const hours = typeof lookback_hours === "number" && lookback_hours > 0 ? lookback_hours : 24;
      const cap = typeof limit === "number" && limit > 0 ? limit : 50;
      const result = runQuery(process.cwd(), query_type, hours, signal_filter, cap);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  // ---- command: /session-analytics --------------------------------------

  pi.registerCommand("session-analytics", {
    description: "Query session analytics. Usage: /session-analytics <signals|timeline|model-usage|summary> [--hours N] [--filter SIGNAL_NAMES]",
    handler: (args, ctx) => {
      const tokens = (args ?? "summary").trim().split(/\s+/);
      const subCmd = tokens[0].toLowerCase() as QueryType | string;

      const VALID: QueryType[] = ["signals", "timeline", "model-usage", "summary"];
      if (!VALID.includes(subCmd as QueryType)) {
        ctx.ui.notify(`Unknown subcommand '${subCmd}'. Use: ${VALID.join(" | ")}`, "warning");
        return;
      }

      let hours = 24;
      let signalFilter: string | undefined;
      let limit = 50;

      for (let i = 1; i < tokens.length; i++) {
        if (tokens[i] === "--hours" && tokens[i + 1]) {
          hours = Number(tokens[++i]);
        } else if (tokens[i] === "--filter" && tokens[i + 1]) {
          signalFilter = tokens[++i];
        } else if (tokens[i] === "--limit" && tokens[i + 1]) {
          limit = Number(tokens[++i]);
        }
      }

      const result = runQuery(process.cwd(), subCmd as QueryType, hours, signalFilter, limit);
      const lines: string[] = [
        `session-analytics: ${result.queryType}`,
        `scanned: ${result.filesScanned} file(s), lookback: ${result.lookbackHours}h`,
        "",
      ];

      if (result.queryType === "signals") {
        const d = result.data as { signals: ColonySignalCount[]; totalSignals: number };
        lines.push(`total signals: ${d.totalSignals}`);
        for (const s of d.signals) lines.push(`  ${s.signal}: ${s.count}`);
      } else if (result.queryType === "timeline") {
        const d = result.data as { events: TimelineEvent[] };
        for (const e of d.events) {
          const label = e.signal ?? e.role ?? e.type;
          lines.push(`  ${e.timestampIso.slice(0, 19)} [${label}] ${e.excerpt?.slice(0, 80) ?? ""}`);
        }
      } else if (result.queryType === "model-usage") {
        const d = result.data as { byProvider: Record<string, number>; modelChanges: ModelChangeEvent[] };
        for (const [p, c] of Object.entries(d.byProvider)) lines.push(`  ${p}: ${c} switch(es)`);
        lines.push("");
        for (const m of d.modelChanges.slice(0, 10)) {
          lines.push(`  ${m.timestampIso.slice(0, 19)} ${m.provider}/${m.modelId}`);
        }
      } else {
        const d = result.data as Record<string, unknown>;
        lines.push(`sessions: ${d["sessionsFound"]} | messages: ${d["totalMessages"]}`);
        lines.push(`providers: ${(d["distinctProviders"] as string[]).join(", ") || "(none)"}`);
        lines.push(`top signals: ${(d["topSignals"] as ColonySignalCount[]).map((s) => `${s.signal}(${s.count})`).join(", ") || "(none)"}`);
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
