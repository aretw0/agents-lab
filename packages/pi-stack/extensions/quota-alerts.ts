/**
 * quota-alerts — proactive quota exhaustion alerts for the control plane.
 *
 * Three alert sources:
 *   1. Budget pressure (WARN/BLOCK from quota-visibility ProviderBudgetStatus)
 *   2. 429 streak (consecutive rate-limit error patterns in recent session text)
 *   3. Weekly window pressure (projected usage approaching hard cap)
 *
 * Overage consent: when a provider is BLOCK, the alert explicitly requires
 * human consent before using paid overage/credits. Never auto-charges.
 *
 * @capability-id quota-alerts
 * @capability-criticality high
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  analyzeQuota,
  parseProviderBudgets,
  parseRouteModelRefs,
  safeNum,
  type ProviderBudgetStatus,
} from "./quota-visibility";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

// ---------------------------------------------------------------------------
// Alert types
// ---------------------------------------------------------------------------

export type AlertSeverity = "info" | "warn" | "block";

export interface QuotaAlertEntry {
  severity: AlertSeverity;
  source: "budget" | "streak-429" | "window-pressure" | "overage-consent";
  provider: string;
  message: string;
  action: string;
}

export interface QuotaAlertsResult {
  generatedAtIso: string;
  alerts: QuotaAlertEntry[];
  summary: { info: number; warn: number; block: number; total: number };
}

// ---------------------------------------------------------------------------
// Budget-based alerts (WARN/BLOCK from ProviderBudgetStatus)
// ---------------------------------------------------------------------------

export function buildBudgetAlerts(budgets: ProviderBudgetStatus[]): QuotaAlertEntry[] {
  const out: QuotaAlertEntry[] = [];

  for (const b of budgets) {
    if (b.state === "blocked") {
      out.push({
        severity: "block",
        source: "budget",
        provider: b.provider,
        message: `Provider '${b.provider}' is BLOCKED: budget cap reached (unit: ${b.unit}).`,
        action: "Switch provider via /handoff or increase budget cap in .pi/settings.json.",
      });
      // Overage consent alert
      out.push({
        severity: "block",
        source: "overage-consent",
        provider: b.provider,
        message: `OVERAGE CONSENT REQUIRED for '${b.provider}': explicit human approval needed before using paid credits.`,
        action: "Do not exceed budget without explicit user consent. Use budget-override token if authorized.",
      });
    } else if (b.state === "warning") {
      out.push({
        severity: "warn",
        source: "budget",
        provider: b.provider,
        message: `Provider '${b.provider}' is at WARNING: approaching budget cap (unit: ${b.unit}).`,
        action: "Consider switching provider proactively via /handoff to preserve capacity.",
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// 429 streak detection (text pattern scan in recent session messages)
// ---------------------------------------------------------------------------

const RATE_LIMIT_PATTERNS = [
  /429/,
  /rate.?limit/i,
  /too many requests/i,
  /quota.*exceeded/i,
  /resource.*exhausted/i,
  /overloaded/i,
  /capacity.*reached/i,
];

export interface RateLimitRecord {
  timestampIso: string;
  provider: string;
  excerpt: string;
}

export function extractTextFromRecord(rec: unknown): string {
  if (!rec || typeof rec !== "object") return "";
  const r = rec as Record<string, unknown>;
  const msg = r["message"] as Record<string, unknown> | undefined;
  if (!msg) {
    // custom_message has content directly
    if (typeof r["content"] === "string") return r["content"];
    return "";
  }
  const content = msg["content"];
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as unknown[])
    .map((p) => {
      if (typeof p === "string") return p;
      if (p && typeof p === "object") {
        const po = p as Record<string, unknown>;
        if (typeof po["text"] === "string") return po["text"];
      }
      return "";
    })
    .join(" ");
}

export function isRateLimitText(text: string): boolean {
  return RATE_LIMIT_PATTERNS.some((re) => re.test(text));
}

export function parse429Streak(
  records: unknown[],
  windowMs: number,
  streakThreshold: number,
  provider: string,
): RateLimitRecord[] {
  const nowMs = Date.now();
  const cutoffMs = nowMs - windowMs;
  const found: RateLimitRecord[] = [];

  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const r = rec as Record<string, unknown>;
    const ts = typeof r["timestamp"] === "string" ? new Date(r["timestamp"]).getTime() : 0;
    if (ts < cutoffMs) continue;

    const text = extractTextFromRecord(rec);
    if (isRateLimitText(text)) {
      found.push({
        timestampIso: typeof r["timestamp"] === "string" ? r["timestamp"] : new Date(ts).toISOString(),
        provider,
        excerpt: text.slice(0, 200),
      });
    }

    if (found.length >= streakThreshold) break;
  }

  return found;
}

export function build429StreakAlerts(
  records: unknown[],
  configuredProviders: string[],
  streakThreshold = 3,
  windowMs = 15 * 60 * 1000,
): QuotaAlertEntry[] {
  const out: QuotaAlertEntry[] = [];
  // Scan for rate limit patterns; attribute to "unknown" provider if we can't tell
  const hits = parse429Streak(records, windowMs, streakThreshold, configuredProviders[0] ?? "unknown");
  if (hits.length >= streakThreshold) {
    const provider = configuredProviders[0] ?? "unknown";
    out.push({
      severity: "warn",
      source: "streak-429",
      provider,
      message: `429 streak detected: ${hits.length} rate-limit error(s) in the last ${Math.round(windowMs / 60000)}m.`,
      action: "Switch provider via /handoff or wait for rate-limit window to reset.",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Window pressure alerts (projected usage close to cap)
// ---------------------------------------------------------------------------

export function buildWindowPressureAlerts(budgets: ProviderBudgetStatus[]): QuotaAlertEntry[] {
  const out: QuotaAlertEntry[] = [];
  for (const b of budgets) {
    if (b.state !== "ok") continue; // already covered by budget alert
    // Check projected % against warn threshold (80 = conservative early-warning)
    const PRESSURE_WARN_PCT = 80;
    const pressures: Array<[string, number | undefined]> = [
      ["tokens", b.projectedPctTokens],
      ["cost", b.projectedPctCost],
      ["requests", b.projectedPctRequests],
    ];
    for (const [label, pct] of pressures) {
      if (pct !== undefined && pct >= PRESSURE_WARN_PCT && pct < 100) {
        out.push({
          severity: "warn",
          source: "window-pressure",
          provider: b.provider,
          message: `Provider '${b.provider}' window pressure at ${pct.toFixed(0)}% (${label}).`,
          action: "Consider reducing usage or switching provider before cap is reached.",
        });
        break; // one alert per provider is enough
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main query function
// ---------------------------------------------------------------------------

function sessionDir(cwd: string): string {
  const resolved = path.resolve(cwd).replace(/\\/g, "/");
  const driveMatch = resolved.match(/^([A-Za-z]):\/(.*)$/);
  if (driveMatch) {
    const letter = driveMatch[1].toUpperCase();
    const rest = driveMatch[2].split("/").filter(Boolean)
      .map((s) => s.replace(/[^A-Za-z0-9._-]/g, "-")).join("-");
    return path.join(homedir(), ".pi", "agent", "sessions", `--${letter}--${rest}--`);
  }
  const rest = resolved.replace(/^\//, "").split("/").filter(Boolean)
    .map((s) => s.replace(/[^A-Za-z0-9._-]/g, "-")).join("-");
  return path.join(homedir(), ".pi", "agent", "sessions", `--${rest}--`);
}

function recentSessionRecords(cwd: string, lookbackHours: number): unknown[] {
  const dir = sessionDir(cwd);
  if (!existsSync(dir)) return [];
  const cutoffMs = Date.now() - lookbackHours * 3600 * 1000;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(dir, f))
    .filter((p) => { try { return statSync(p).mtimeMs >= cutoffMs; } catch { return false; } });

  const out: unknown[] = [];
  for (const file of files) {
    try {
      const lines = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        try { out.push(JSON.parse(line)); } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return out;
}

export async function buildQuotaAlerts(cwd: string, lookbackHours = 24): Promise<QuotaAlertsResult> {
  let budgetStatuses: ProviderBudgetStatus[] = [];
  let configuredProviders: string[] = [];

  try {
    const rawSettings = JSON.parse(readFileSync(path.join(cwd, ".pi", "settings.json"), "utf8"));
    const qv = (rawSettings?.piStack?.quotaVisibility ?? {}) as Record<string, unknown>;
    const providerBudgets = parseProviderBudgets(qv.providerBudgets);
    const routeModelRefs = parseRouteModelRefs(qv.routeModelRefs);
    configuredProviders = Object.keys(routeModelRefs);

    const days = safeNum(qv.defaultDays) || 30;
    const status = await analyzeQuota({ days, providerBudgets, providerWindowHours: {} });
    budgetStatuses = status.providerBudgets;
  } catch {
    // no settings or analysis error — still produce alerts for 429 streak
  }

  const records = recentSessionRecords(cwd, lookbackHours);

  const budgetAlerts = buildBudgetAlerts(budgetStatuses);
  const streakAlerts = build429StreakAlerts(records, configuredProviders);
  const pressureAlerts = buildWindowPressureAlerts(budgetStatuses);

  const alerts = [...budgetAlerts, ...streakAlerts, ...pressureAlerts];

  const summary = alerts.reduce(
    (s, a) => { s[a.severity]++; s.total++; return s; },
    { info: 0, warn: 0, block: 0, total: 0 }
  );

  return { generatedAtIso: new Date().toISOString(), alerts, summary };
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function quotaAlertsExtension(pi: ExtensionAPI) {
  // ---- tool: quota_alerts -----------------------------------------------

  pi.registerTool({
    name: "quota_alerts",
    label: "Quota Alerts",
    description: [
      "Proactive quota exhaustion alerts: budget WARN/BLOCK, 429 streak detection, window pressure.",
      "Returns structured alert list with severity and actionable recommendations.",
      "No auto-switch — all alerts require human action.",
    ].join(" "),
    parameters: Type.Object({
      lookback_hours: Type.Optional(
        Type.Number({ description: "Session lookback for 429 streak detection (hours). Default: 24." })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = params as { lookback_hours?: number };
      const hours = typeof p.lookback_hours === "number" && p.lookback_hours > 0 ? p.lookback_hours : 24;
      const result = await buildQuotaAlerts(ctx.cwd, hours);
      return buildOperatorVisibleToolResponse({
        label: "quota_alerts",
        summary: `quota-alerts: total=${result.summary.total} block=${result.summary.block} warn=${result.summary.warn} info=${result.summary.info} lookbackHours=${hours}`,
        details: result,
      });
    },
  });

  // ---- command: /quota-alerts ------------------------------------------

  pi.registerCommand("quota-alerts", {
    description: "Proactive quota exhaustion alerts. Usage: /quota-alerts [--hours N]",
    handler: async (args, ctx) => {
      const tokens = (args ?? "").trim().split(/\s+/);
      let hours = 24;
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] === "--hours" && tokens[i + 1]) {
          hours = Number(tokens[++i]);
        }
      }

      const result = await buildQuotaAlerts(ctx.cwd, hours);
      const lines: string[] = [
        `quota-alerts (lookback: ${hours}h)`,
        `generated: ${result.generatedAtIso.slice(0, 19)}Z`,
        `alerts: ${result.summary.total} (block=${result.summary.block} warn=${result.summary.warn} info=${result.summary.info})`,
        "",
      ];

      if (result.alerts.length === 0) {
        lines.push("No alerts. All configured providers appear within budget.");
      } else {
        for (const a of result.alerts) {
          lines.push(`[${a.severity.toUpperCase()}] [${a.source}] ${a.provider}`);
          lines.push(`  ${a.message}`);
          lines.push(`  Action: ${a.action}`);
          lines.push("");
        }
      }

      const topSeverity = result.summary.block > 0 ? "error"
        : result.summary.warn > 0 ? "warning"
          : "info";

      ctx.ui.notify(lines.join("\n"), topSeverity);
    },
  });
}
