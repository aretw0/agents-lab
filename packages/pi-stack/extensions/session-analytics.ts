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
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { extractUsage, estimateHardPathwayMitigation } from "./quota-visibility";

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

// ---------------------------------------------------------------------------
// JSONL parsing primitives
// ---------------------------------------------------------------------------

export interface SessionJsonlScanLimits {
  maxTailBytes: number;
  maxLineChars: number;
  maxRecordsPerFile: number;
}

export interface SessionJsonlFileScanStats {
  filePath: string;
  fileSizeBytes: number;
  bytesRead: number;
  tailWindowApplied: boolean;
  droppedLeadingPartialLine: boolean;
  recordsParsed: number;
  parseErrors: number;
  skippedLongLines: number;
  recordsCapped: boolean;
  readError?: string;
}

export interface SessionJsonlReadResult {
  records: unknown[];
  stats: SessionJsonlFileScanStats;
}

export const DEFAULT_SESSION_JSONL_SCAN_LIMITS: SessionJsonlScanLimits = {
  maxTailBytes: 2_000_000,
  maxLineChars: 200_000,
  maxRecordsPerFile: 5_000,
};

function clampScanLimits(overrides?: Partial<SessionJsonlScanLimits>): SessionJsonlScanLimits {
  const maxTailBytesRaw = Number(overrides?.maxTailBytes);
  const maxLineCharsRaw = Number(overrides?.maxLineChars);
  const maxRecordsPerFileRaw = Number(overrides?.maxRecordsPerFile);
  return {
    maxTailBytes:
      Number.isFinite(maxTailBytesRaw) && maxTailBytesRaw > 0
        ? Math.max(64_000, Math.min(10_000_000, Math.floor(maxTailBytesRaw)))
        : DEFAULT_SESSION_JSONL_SCAN_LIMITS.maxTailBytes,
    maxLineChars:
      Number.isFinite(maxLineCharsRaw) && maxLineCharsRaw > 0
        ? Math.max(2_000, Math.min(2_000_000, Math.floor(maxLineCharsRaw)))
        : DEFAULT_SESSION_JSONL_SCAN_LIMITS.maxLineChars,
    maxRecordsPerFile:
      Number.isFinite(maxRecordsPerFileRaw) && maxRecordsPerFileRaw > 0
        ? Math.max(100, Math.min(20_000, Math.floor(maxRecordsPerFileRaw)))
        : DEFAULT_SESSION_JSONL_SCAN_LIMITS.maxRecordsPerFile,
  };
}

export function readJsonlLines(
  filePath: string,
  overrides?: Partial<SessionJsonlScanLimits>,
): SessionJsonlReadResult {
  const limits = clampScanLimits(overrides);
  const emptyStats: SessionJsonlFileScanStats = {
    filePath,
    fileSizeBytes: 0,
    bytesRead: 0,
    tailWindowApplied: false,
    droppedLeadingPartialLine: false,
    recordsParsed: 0,
    parseErrors: 0,
    skippedLongLines: 0,
    recordsCapped: false,
  };

  try {
    const st = statSync(filePath);
    const fileSizeBytes = Number.isFinite(st.size) ? Math.max(0, Math.floor(st.size)) : 0;
    if (fileSizeBytes <= 0) {
      return { records: [], stats: { ...emptyStats, fileSizeBytes } };
    }

    const bytesToRead = Math.min(fileSizeBytes, limits.maxTailBytes);
    const startOffset = Math.max(0, fileSizeBytes - bytesToRead);
    const buf = Buffer.alloc(bytesToRead);

    const fd = openSync(filePath, "r");
    let readBytes = 0;
    try {
      readBytes = readSync(fd, buf, 0, bytesToRead, startOffset);
    } finally {
      closeSync(fd);
    }

    let text = buf.subarray(0, readBytes).toString("utf8");
    let droppedLeadingPartialLine = false;
    if (startOffset > 0) {
      const firstBreak = text.indexOf("\n");
      if (firstBreak >= 0) {
        text = text.slice(firstBreak + 1);
        droppedLeadingPartialLine = true;
      }
    }

    const records: unknown[] = [];
    let parseErrors = 0;
    let skippedLongLines = 0;
    let recordsCapped = false;

    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      if (line.length > limits.maxLineChars) {
        skippedLongLines += 1;
        continue;
      }
      try {
        records.push(JSON.parse(line));
      } catch {
        parseErrors += 1;
      }
      if (records.length >= limits.maxRecordsPerFile) {
        recordsCapped = true;
        break;
      }
    }

    return {
      records,
      stats: {
        filePath,
        fileSizeBytes,
        bytesRead: readBytes,
        tailWindowApplied: startOffset > 0,
        droppedLeadingPartialLine,
        recordsParsed: records.length,
        parseErrors,
        skippedLongLines,
        recordsCapped,
      },
    };
  } catch (error) {
    return {
      records: [],
      stats: {
        ...emptyStats,
        readError: error instanceof Error ? error.message : String(error ?? "unknown-error"),
      },
    };
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

export interface ContentOutlierEvent {
  timestampIso: string;
  role?: string;
  toolName?: string;
  textChars: number;
  hasStackOverflow: boolean;
  excerpt: string;
}

export interface GalvanizationCandidate {
  rank: number;
  patternKey: string;
  label: string;
  kind: "slash-command" | "prompt-pattern" | "tool-loop";
  occurrences: number;
  sessions: number;
  evidence: {
    tokens: number;
    costUsd: number;
    requests: number;
    examplePrompts: string[];
  };
  opportunityScore: number;
  pathway: {
    proposal: string;
    safetyGates: string[];
    equivalenceCondition: string;
    rollbackPlan: string;
  };
  mitigationProjection: ReturnType<typeof estimateHardPathwayMitigation>;
}

function normalizeWorkPatternText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/`[^`]+`/g, "<code>")
    .replace(/[a-z]:\\[^\s]+/gi, "<path>")
    .replace(/\/?[a-z0-9._-]+(?:\/[a-z0-9._-]+){2,}/gi, "<path>")
    .replace(/\b\d+\b/g, "<num>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function classifyWorkPatternKind(text: string): "slash-command" | "prompt-pattern" {
  if (text.trim().startsWith("/")) return "slash-command";
  return "prompt-pattern";
}

export function parseGalvanizationCandidates(records: unknown[], limit: number): {
  candidates: GalvanizationCandidate[];
  roadmap: {
    baseline: { tokens: number; costUsd: number; requests: number };
    projectedAfterTopCandidates: { tokens: number; costUsd: number; requests: number };
    mitigationPotential: { tokensSaved: number; costUsdSaved: number; requestsSaved: number };
  };
} {
  type PatternBucket = {
    key: string;
    label: string;
    kind: "slash-command" | "prompt-pattern" | "tool-loop";
    occurrences: number;
    sessions: Set<string>;
    tokens: number;
    costUsd: number;
    requests: number;
    examples: string[];
  };

  type PendingOccurrence = { patternKey: string; timestampIso: string; sessionKey: string };

  const buckets = new Map<string, PatternBucket>();
  const pendingUserPatterns: PendingOccurrence[] = [];

  const ensureBucket = (
    key: string,
    label: string,
    kind: "slash-command" | "prompt-pattern" | "tool-loop",
  ): PatternBucket => {
    let existing = buckets.get(key);
    if (!existing) {
      existing = {
        key,
        label,
        kind,
        occurrences: 0,
        sessions: new Set<string>(),
        tokens: 0,
        costUsd: 0,
        requests: 0,
        examples: [],
      };
      buckets.set(key, existing);
    }
    return existing;
  };

  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const r = rec as Record<string, unknown>;
    const timestampIso = typeof r["timestamp"] === "string" ? r["timestamp"] : "";
    const sessionKey = typeof r["_sessionFile"] === "string"
      ? r["_sessionFile"]
      : (timestampIso.slice(0, 10) || "unknown-session");

    if (r["type"] === "message") {
      const msg = r["message"] as Record<string, unknown> | undefined;
      if (!msg) continue;

      const role = typeof msg["role"] === "string" ? msg["role"] : "";
      const text = extractTextContent(msg["content"]).trim();
      const toolName = typeof msg["toolName"] === "string" ? msg["toolName"] : undefined;

      if (role === "user" && text.length > 0) {
        const normalized = normalizeWorkPatternText(text);
        if (normalized.length < 6) continue;
        const kind = classifyWorkPatternKind(text);
        const key = `${kind}:${normalized}`;
        const bucket = ensureBucket(key, text.slice(0, 120), kind);
        bucket.occurrences += 1;
        bucket.sessions.add(sessionKey);
        if (bucket.examples.length < 3) bucket.examples.push(text.slice(0, 160));
        pendingUserPatterns.push({ patternKey: key, timestampIso, sessionKey });
        continue;
      }

      if (toolName) {
        const key = `tool-loop:${toolName.toLowerCase()}`;
        const bucket = ensureBucket(key, `tool:${toolName}`, "tool-loop");
        bucket.occurrences += 1;
        bucket.sessions.add(sessionKey);
        bucket.requests += 1;
        if (bucket.examples.length < 3 && text.length > 0) {
          bucket.examples.push(text.slice(0, 160));
        }
      }

      if (role === "assistant") {
        const usage = extractUsage((msg as Record<string, unknown>)["usage"] ?? msg);
        if (usage.totalTokens <= 0 && usage.costTotalUsd <= 0) continue;

        const pending = pendingUserPatterns.shift();
        if (!pending) continue;

        const bucket = buckets.get(pending.patternKey);
        if (!bucket) continue;
        bucket.tokens += usage.totalTokens;
        bucket.costUsd += usage.costTotalUsd;
        bucket.requests += 1;
      }
      continue;
    }

    if (r["type"] === "tool_call") {
      const toolName = typeof r["toolName"] === "string"
        ? r["toolName"]
        : typeof (r["tool"] as Record<string, unknown> | undefined)?.["name"] === "string"
          ? ((r["tool"] as Record<string, unknown>)["name"] as string)
          : undefined;
      if (!toolName) continue;
      const key = `tool-loop:${toolName.toLowerCase()}`;
      const bucket = ensureBucket(key, `tool:${toolName}`, "tool-loop");
      bucket.occurrences += 1;
      bucket.sessions.add(sessionKey);
      bucket.requests += 1;
    }
  }

  const filtered = [...buckets.values()]
    .filter((b) => b.occurrences >= 2)
    .filter((b) => b.tokens > 0 || b.costUsd > 0 || b.requests >= 3);

  const scored = filtered
    .map((b) => {
      const freqScore = Math.min(45, b.occurrences * 6);
      const spendScore = Math.min(40, Math.log10(Math.max(1, b.tokens) + 1) * 10 + b.costUsd * 2.5);
      const spreadScore = Math.min(15, b.sessions.size * 3);
      const opportunityScore = Math.round(freqScore + spendScore + spreadScore);
      const pathwayProposal = b.kind === "slash-command"
        ? "Promover para comando/tool deterministic-first com input schema e execução idempotente."
        : b.kind === "tool-loop"
          ? "Extrair pipeline hard (script/workflow) com parâmetros explícitos e retries determinísticos."
          : "Converter em template de intent + workflow fixo, com fallback manual apenas em exceções.";

      const mitigationProjection = estimateHardPathwayMitigation({
        baselineTokens: b.tokens,
        baselineCostUsd: b.costUsd,
        baselineRequests: b.requests,
        automationCoveragePct: b.kind === "tool-loop" ? 0.85 : 0.75,
        residualLlmPct: b.kind === "slash-command" ? 0.08 : 0.15,
        riskBufferPct: 0.05,
      });

      return {
        patternKey: b.key,
        label: b.label,
        kind: b.kind,
        occurrences: b.occurrences,
        sessions: b.sessions.size,
        evidence: {
          tokens: b.tokens,
          costUsd: b.costUsd,
          requests: b.requests,
          examplePrompts: b.examples,
        },
        opportunityScore,
        pathway: {
          proposal: pathwayProposal,
          safetyGates: [
            "equivalence-check em fixture representativo antes de ativar",
            "rollout em dry-run + fallback manual explícito",
            "verification passed no board antes de promover como default",
          ],
          equivalenceCondition:
            "Saída do pathway hard preserva resultado funcional e trilha de evidência do fluxo manual.",
          rollbackPlan:
            "Desativar pathway hard por flag/profile e retornar ao fluxo manual auditado sem perda de estado.",
        },
        mitigationProjection,
      };
    })
    .sort((a, b) => b.opportunityScore - a.opportunityScore || b.evidence.tokens - a.evidence.tokens)
    .slice(0, Math.max(1, limit))
    .map((row, idx) => ({ rank: idx + 1, ...row }));

  const baseline = scored.reduce(
    (acc, row) => {
      acc.tokens += row.evidence.tokens;
      acc.costUsd += row.evidence.costUsd;
      acc.requests += row.evidence.requests;
      return acc;
    },
    { tokens: 0, costUsd: 0, requests: 0 },
  );

  const projectedAfterTopCandidates = scored.reduce(
    (acc, row) => {
      acc.tokens += row.mitigationProjection.projectedAfterHardPathway.tokens;
      acc.costUsd += row.mitigationProjection.projectedAfterHardPathway.costUsd;
      acc.requests += row.mitigationProjection.projectedAfterHardPathway.requests;
      return acc;
    },
    { tokens: 0, costUsd: 0, requests: 0 },
  );

  return {
    candidates: scored,
    roadmap: {
      baseline,
      projectedAfterTopCandidates,
      mitigationPotential: {
        tokensSaved: Math.max(0, baseline.tokens - projectedAfterTopCandidates.tokens),
        costUsdSaved: Math.max(0, baseline.costUsd - projectedAfterTopCandidates.costUsd),
        requestsSaved: Math.max(0, baseline.requests - projectedAfterTopCandidates.requests),
      },
    },
  };
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

export function parseContentOutliers(records: unknown[], limit: number, minChars: number): {
  outliers: ContentOutlierEvent[];
  stackOverflowHits: number;
} {
  const outliers: ContentOutlierEvent[] = [];
  let stackOverflowHits = 0;

  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const r = rec as Record<string, unknown>;
    if (r["type"] !== "message") continue;

    const msg = r["message"] as Record<string, unknown> | undefined;
    if (!msg) continue;

    const role = typeof msg["role"] === "string" ? msg["role"] : undefined;
    const toolName = typeof msg["toolName"] === "string" ? msg["toolName"] : undefined;
    const text = extractTextContent(msg["content"]);
    const textChars = text.length;
    const hasStackOverflow = text.includes("Maximum call stack size exceeded")
      || text.includes("wrapTextWithAnsi")
      || text.includes("truncateToVisualLines");

    if (hasStackOverflow) stackOverflowHits += 1;

    if (textChars >= minChars || hasStackOverflow) {
      outliers.push({
        timestampIso: typeof r["timestamp"] === "string" ? r["timestamp"] : "",
        role,
        toolName,
        textChars,
        hasStackOverflow,
        excerpt: text.slice(0, 120),
      });
    }
  }

  outliers.sort((a, b) => b.textChars - a.textChars);
  return {
    outliers: outliers.slice(0, limit),
    stackOverflowHits,
  };
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

export function runQuery(
  cwd: string,
  queryType: QueryType,
  lookbackHours: number,
  signalFilter: string | undefined,
  limit: number,
  minChars = 20_000,
): SessionAnalyticsResult {
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

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function sessionAnalyticsExtension(pi: ExtensionAPI) {
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
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
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
