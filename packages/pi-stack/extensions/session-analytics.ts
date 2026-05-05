/**
 * session-analytics — queryable session log primitive for swarms and agents.
 *
 * Why this exists:
 * - session-triage.mjs is a CLI tool for human operators.
 * - Swarms need a machine-callable API: structured query params, JSON output.
 * - Makes the session log a first-class data source queryable from the Control Plane.
 *
 * Query types:
 *   signals        — aggregate colony signal counts
 *   timeline       — chronological event sequence
 *   model-usage    — provider/model switches
 *   summary        — top-level session overview
 *   outliers       — oversized message/tool payloads (context-risk triage)
 *   galvanization  — repetitive-work discovery + hard-pathway opportunity ranking
 *
 * @capability-id session-analytics
 * @capability-criticality medium
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  DEFAULT_SESSION_JSONL_SCAN_LIMITS,
  clampScanLimits,
  readJsonlLines,
  type SessionJsonlFileScanStats,
  type SessionJsonlReadResult,
  type SessionJsonlScanLimits,
} from "./session-analytics-jsonl";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";
export {
  DEFAULT_SESSION_JSONL_SCAN_LIMITS,
  clampScanLimits,
  readJsonlLines,
} from "./session-analytics-jsonl";
export type {
  SessionJsonlFileScanStats,
  SessionJsonlReadResult,
  SessionJsonlScanLimits,
} from "./session-analytics-jsonl";

// ---------------------------------------------------------------------------
// Workspace key derivation (mirrors session-triage.mjs logic)
// ---------------------------------------------------------------------------

export function toSessionWorkspaceKey(absPath: string): string {
  // Normalize backslashes before drive-letter check so Windows paths work on
  // any platform. path.resolve() mis-resolves "C:\..." on Linux by treating
  // it as a relative path and prepending the Linux CWD.
  const normalized = absPath.replace(/\\/g, "/");
  const driveMatch = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (driveMatch) {
    const letter = driveMatch[1].toUpperCase();
    const rest = driveMatch[2]
      .split("/")
      .filter(Boolean)
      .map((s) => s.replace(/[^A-Za-z0-9._-]/g, "-"))
      .join("-");
    return `--${letter}--${rest}--`;
  }
  const resolved = path.resolve(normalized);
  const rest = resolved
    .replace(/^\//, "")
    .split("/")
    .filter(Boolean)
    .map((s) => s.replace(/[^A-Za-z0-9._-]/g, "-"))
    .join("-");
  return `--${rest}--`;
}

export function sessionDir(cwd: string): string {
  const key = toSessionWorkspaceKey(cwd);
  const local = path.join(cwd, ".sandbox", "pi-agent", "sessions", key);
  if (existsSync(local)) return local;
  return path.join(homedir(), ".pi", "agent", "sessions", key);
}

import {
  parseAutoAdvanceHardIntentTelemetry,
  parseContentOutliers,
  parseDelegationMixScore,
  parseGalvanizationCandidates,
  parseModelChanges,
  parseSignals,
  parseTimeline,
} from "./session-analytics-parsers";
import type {
  AutoAdvanceHardIntentTelemetry,
  ColonySignalCount,
  ContentOutlierEvent,
  DelegationMixScore,
  GalvanizationCandidate,
  ModelChangeEvent,
  TimelineEvent,
} from "./session-analytics-parsers";
export {
  parseAutoAdvanceHardIntentTelemetry,
  parseContentOutliers,
  parseDelegationMixScore,
  parseGalvanizationCandidates,
  parseModelChanges,
  parseSignals,
  parseTimeline,
} from "./session-analytics-parsers";
export type {
  AutoAdvanceHardIntentTelemetry,
  ColonySignalCount,
  ContentOutlierEvent,
  DelegationMixScore,
  GalvanizationCandidate,
  ModelChangeEvent,
  TimelineEvent,
} from "./session-analytics-parsers";

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

export type QueryType = "signals" | "timeline" | "model-usage" | "summary" | "outliers" | "galvanization";

const VALID_QUERY_TYPES: QueryType[] = ["signals", "timeline", "model-usage", "summary", "outliers", "galvanization"];

function collectParamCandidates(input: unknown, out: unknown[] = [], depth = 0): unknown[] {
  if (depth > 3 || input == null) return out;
  out.push(input);
  if (typeof input !== "object") return out;
  for (const value of Object.values(input as Record<string, unknown>)) {
    if (value && typeof value === "object") collectParamCandidates(value, out, depth + 1);
    else out.push(value);
  }
  return out;
}

function readNumberParam(candidates: unknown[], keys: string[]): number | undefined {
  for (const item of candidates) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
  }
  return undefined;
}

function readStringParam(candidates: unknown[], keys: string[]): string | undefined {
  for (const item of candidates) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string") return value;
    }
  }
  return undefined;
}

export function normalizeSessionAnalyticsToolParams(params: unknown): {
  queryType: QueryType;
  hours: number;
  signalFilter?: string;
  limit: number;
  minChars: number;
} {
  const candidates = collectParamCandidates(params);
  const explicitQueryType = readStringParam(candidates, ["query_type", "queryType", "type"]);
  const valueQueryType = candidates.find((value): value is QueryType => (
    typeof value === "string" && VALID_QUERY_TYPES.includes(value as QueryType)
  ));
  const rawQueryType = explicitQueryType ?? valueQueryType;
  const queryType = VALID_QUERY_TYPES.includes(rawQueryType as QueryType) ? rawQueryType as QueryType : "summary";
  const rawHours = readNumberParam(candidates, ["lookback_hours", "lookbackHours", "hours"]);
  const rawLimit = readNumberParam(candidates, ["limit"]);
  const rawMinChars = readNumberParam(candidates, ["min_chars", "minChars"]);
  const signalFilter = readStringParam(candidates, ["signal_filter", "signalFilter"]);
  return {
    queryType,
    hours: typeof rawHours === "number" && rawHours > 0 ? rawHours : 24,
    signalFilter,
    limit: typeof rawLimit === "number" && rawLimit > 0 ? rawLimit : 50,
    minChars: typeof rawMinChars === "number" && rawMinChars > 0 ? rawMinChars : 20_000,
  };
}

export interface SessionAnalyticsScanSummary {
  maxTailBytes: number;
  maxLineChars: number;
  maxRecordsPerFile: number;
  totalFileBytes: number;
  totalBytesRead: number;
  tailWindowFiles: number;
  droppedLeadingPartialLines: number;
  skippedLongLines: number;
  parseErrors: number;
  recordsCappedFiles: number;
  readErrors: number;
}

export interface SessionAnalyticsResult {
  queryType: QueryType;
  lookbackHours: number;
  filesScanned: number;
  generatedAt: string;
  data: unknown;
  scan: SessionAnalyticsScanSummary;
}

export function collectSessionRecords(cwd: string, lookbackHours: number): {
  files: string[];
  allRecords: unknown[];
  scan: SessionAnalyticsScanSummary;
} {
  const dir = sessionDir(cwd);
  const files = listSessionFiles(dir, lookbackHours);
  const allRecords: unknown[] = [];
  const limits = clampScanLimits();
  const scan: SessionAnalyticsScanSummary = {
    maxTailBytes: limits.maxTailBytes,
    maxLineChars: limits.maxLineChars,
    maxRecordsPerFile: limits.maxRecordsPerFile,
    totalFileBytes: 0,
    totalBytesRead: 0,
    tailWindowFiles: 0,
    droppedLeadingPartialLines: 0,
    skippedLongLines: 0,
    parseErrors: 0,
    recordsCappedFiles: 0,
    readErrors: 0,
  };

  for (const file of files) {
    const read = readJsonlLines(file, limits);
    const tagged = read.records.map((rec) => {
      if (!rec || typeof rec !== "object") return rec;
      return { ...(rec as Record<string, unknown>), _sessionFile: path.basename(file) };
    });
    allRecords.push(...tagged);
    scan.totalFileBytes += read.stats.fileSizeBytes;
    scan.totalBytesRead += read.stats.bytesRead;
    if (read.stats.tailWindowApplied) scan.tailWindowFiles += 1;
    if (read.stats.droppedLeadingPartialLine) scan.droppedLeadingPartialLines += 1;
    scan.skippedLongLines += read.stats.skippedLongLines;
    scan.parseErrors += read.stats.parseErrors;
    if (read.stats.recordsCapped) scan.recordsCappedFiles += 1;
    if (read.stats.readError) scan.readErrors += 1;
  }

  return { files, allRecords, scan };
}

export function runQuery(
  cwd: string,
  queryType: QueryType,
  lookbackHours: number,
  signalFilter: string | undefined,
  limit: number,
  minChars = 20_000,
): SessionAnalyticsResult {
  const { files, allRecords, scan } = collectSessionRecords(cwd, lookbackHours);

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

  } else if (queryType === "outliers") {
    const d = parseContentOutliers(allRecords, limit, Math.max(1000, minChars));
    data = {
      minChars: Math.max(1000, minChars),
      stackOverflowHits: d.stackOverflowHits,
      outliers: d.outliers,
    };

  } else if (queryType === "galvanization") {
    const d = parseGalvanizationCandidates(allRecords, limit);
    data = {
      candidates: d.candidates,
      roadmap: d.roadmap,
      classificationModel: "deterministic-v1",
      notes: [
        "ranking usa frequência + evidência de consumo LLM (tokens/custo/requests)",
        "pathways hard permanecem proposta; ativação exige gates/rollback/equivalência",
      ],
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
    scan,
  };
}

function summarizeSessionAnalyticsResult(result: SessionAnalyticsResult): string {
  const lines = [
    `session-analytics: ${result.queryType}`,
    `scanned=${result.filesScanned} lookback=${result.lookbackHours}h`,
    `scanGuard=bytes:${result.scan.totalBytesRead}/${result.scan.totalFileBytes} tailWindowFiles:${result.scan.tailWindowFiles} parseErrors:${result.scan.parseErrors} skippedLongLines:${result.scan.skippedLongLines}`,
  ];
  const data = result.data as Record<string, unknown>;
  if (result.queryType === "signals") {
    lines.push(`signals=${data.totalSignals ?? 0}`);
  } else if (result.queryType === "timeline") {
    lines.push(`events=${Array.isArray(data.events) ? data.events.length : 0}`);
  } else if (result.queryType === "model-usage") {
    lines.push(`modelChanges=${Array.isArray(data.modelChanges) ? data.modelChanges.length : 0}`);
  } else if (result.queryType === "outliers") {
    lines.push(`outliers=${Array.isArray(data.outliers) ? data.outliers.length : 0}`);
  } else if (result.queryType === "galvanization") {
    lines.push(`candidates=${Array.isArray(data.candidates) ? data.candidates.length : 0}`);
  } else {
    lines.push(`records=${data.totalRecords ?? 0} messages=${data.totalMessages ?? 0}`);
  }
  return lines.join(" ");
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function sessionAnalyticsExtension(pi: ExtensionAPI) {
  // ---- tool: delegation_mix_score ---------------------------------------

  pi.registerTool({
    name: "delegation_mix_score",
    label: "Delegation Mix Score",
    description:
      "Report-only delegation diversity score from local session evidence (local/manual/simple-delegate/swarm). Never dispatches execution.",
    parameters: Type.Object({
      lookback_hours: Type.Optional(
        Type.Number({ description: "How many hours back to scan session files. Default: 24." }),
      ),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const lookbackHoursRaw = Number(p["lookback_hours"]);
      const lookbackHours = Number.isFinite(lookbackHoursRaw) && lookbackHoursRaw > 0
        ? lookbackHoursRaw
        : 24;
      const cwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();
      const collected = collectSessionRecords(cwd, lookbackHours);
      const score = parseDelegationMixScore(collected.allRecords, lookbackHours, collected.files.length);
      return {
        content: [{ type: "text", text: score.summary }],
        details: {
          ...score,
          scan: collected.scan,
        },
      };
    },
  });

  // ---- tool: auto_advance_hard_intent_telemetry -------------------------

  pi.registerTool({
    name: "auto_advance_hard_intent_telemetry",
    label: "Auto-Advance Hard-Intent Telemetry",
    description:
      "Report-only telemetry for hard-intent auto-advance evidence (eligible vs blocked + reason codes). Never dispatches execution.",
    parameters: Type.Object({
      lookback_hours: Type.Optional(
        Type.Number({ description: "How many hours back to scan session files. Default: 24." }),
      ),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const lookbackHoursRaw = Number(p["lookback_hours"]);
      const lookbackHours = Number.isFinite(lookbackHoursRaw) && lookbackHoursRaw > 0
        ? lookbackHoursRaw
        : 24;
      const cwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();
      const collected = collectSessionRecords(cwd, lookbackHours);
      const telemetry = parseAutoAdvanceHardIntentTelemetry(collected.allRecords, lookbackHours, collected.files.length);
      return {
        content: [{ type: "text", text: telemetry.summary }],
        details: {
          ...telemetry,
          scan: collected.scan,
        },
      };
    },
  });

  // ---- tool: session_analytics_query ------------------------------------

  pi.registerTool({
    name: "session_analytics_query",
    label: "Session Analytics Query",
    description: [
      "Query session logs for analytical data (signals, timeline, model-usage, summary, outliers, galvanization).",
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
          Type.Literal("outliers"),
          Type.Literal("galvanization"),
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
      min_chars: Type.Optional(
        Type.Number({ description: "Minimum text size (chars) to consider an outlier. Only for query_type=outliers. Default: 20000." })
      ),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const normalized = normalizeSessionAnalyticsToolParams(params);
      const cwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();
      const result = runQuery(
        cwd,
        normalized.queryType,
        normalized.hours,
        normalized.signalFilter,
        normalized.limit,
        normalized.minChars,
      );
      return buildOperatorVisibleToolResponse({
        label: "session_analytics_query",
        summary: summarizeSessionAnalyticsResult(result),
        details: result,
      });
    },
  });

  // ---- command: /session-analytics --------------------------------------

  pi.registerCommand("session-analytics", {
    description: "Query session analytics. Usage: /session-analytics <signals|timeline|model-usage|summary|outliers|galvanization> [--hours N] [--filter SIGNAL_NAMES] [--limit N] [--min-chars N]",
    handler: (args, ctx) => {
      const tokens = (args ?? "summary").trim().split(/\s+/);
      const subCmd = tokens[0].toLowerCase() as QueryType | string;

      if (!VALID_QUERY_TYPES.includes(subCmd as QueryType)) {
        ctx.ui.notify(`Unknown subcommand '${subCmd}'. Use: ${VALID_QUERY_TYPES.join(" | ")}`, "warning");
        return;
      }

      let hours = 24;
      let signalFilter: string | undefined;
      let limit = 50;
      let minChars = 20_000;

      for (let i = 1; i < tokens.length; i++) {
        if (tokens[i] === "--hours" && tokens[i + 1]) {
          hours = Number(tokens[++i]);
        } else if (tokens[i] === "--filter" && tokens[i + 1]) {
          signalFilter = tokens[++i];
        } else if (tokens[i] === "--limit" && tokens[i + 1]) {
          limit = Number(tokens[++i]);
        } else if (tokens[i] === "--min-chars" && tokens[i + 1]) {
          minChars = Number(tokens[++i]);
        }
      }

      const result = runQuery(process.cwd(), subCmd as QueryType, hours, signalFilter, limit, minChars);
      const lines: string[] = [
        `session-analytics: ${result.queryType}`,
        `scanned: ${result.filesScanned} file(s), lookback: ${result.lookbackHours}h`,
        `scan-guard: bytes=${result.scan.totalBytesRead}/${result.scan.totalFileBytes} tailWindowFiles=${result.scan.tailWindowFiles} parseErrors=${result.scan.parseErrors} skippedLongLines=${result.scan.skippedLongLines}`,
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
      } else if (result.queryType === "outliers") {
        const d = result.data as { minChars: number; stackOverflowHits: number; outliers: ContentOutlierEvent[] };
        lines.push(`min_chars: ${d.minChars}`);
        lines.push(`stack_overflow_hits: ${d.stackOverflowHits}`);
        lines.push("");
        for (const o of d.outliers.slice(0, 10)) {
          const marker = o.hasStackOverflow ? "!" : "-";
          lines.push(`  ${marker} ${o.timestampIso.slice(0, 19)} ${o.role ?? "?"}/${o.toolName ?? "-"} chars=${o.textChars}`);
        }
      } else if (result.queryType === "galvanization") {
        const d = result.data as {
          candidates: GalvanizationCandidate[];
          roadmap: {
            baseline: { tokens: number; costUsd: number; requests: number };
            projectedAfterTopCandidates: { tokens: number; costUsd: number; requests: number };
            mitigationPotential: { tokensSaved: number; costUsdSaved: number; requestsSaved: number };
          };
        };
        lines.push(
          `roadmap baseline: tok=${Math.round(d.roadmap.baseline.tokens)} cost=${d.roadmap.baseline.costUsd.toFixed(4)} req=${Math.round(d.roadmap.baseline.requests)}`,
        );
        lines.push(
          `roadmap projected: tok=${Math.round(d.roadmap.projectedAfterTopCandidates.tokens)} cost=${d.roadmap.projectedAfterTopCandidates.costUsd.toFixed(4)} req=${Math.round(d.roadmap.projectedAfterTopCandidates.requests)}`,
        );
        lines.push(
          `mitigation potential: tok_saved=${Math.round(d.roadmap.mitigationPotential.tokensSaved)} cost_saved=${d.roadmap.mitigationPotential.costUsdSaved.toFixed(4)} req_saved=${Math.round(d.roadmap.mitigationPotential.requestsSaved)}`,
        );
        lines.push("");
        for (const c of d.candidates.slice(0, 8)) {
          lines.push(
            `  #${c.rank} score=${c.opportunityScore} kind=${c.kind} occ=${c.occurrences} tok=${Math.round(c.evidence.tokens)} cost=${c.evidence.costUsd.toFixed(4)} | ${c.label.slice(0, 70)}`,
          );
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
