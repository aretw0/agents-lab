/**
 * custom-footer — pi-stack owned footer and /status overlay.
 * @capability-id custom-footer
 * @capability-criticality medium
 *
 * Fork of @ifi/oh-pi-extensions/extensions/custom-footer.ts.
 * Differences from upstream:
 *   - Compact line shows "provider/modelId" instead of just "modelId"
 *   - Compact line shows budget status from setStatus("quota-budgets") when set
 *   - Safe-mode integration removed (internal oh-pi-extensions dependency)
 *
 * Silence upstream with:
 *   { "source": "npm:@ifi/oh-pi-extensions", "extensions": ["!extensions/custom-footer.ts"] }
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import {
  shouldShowPanel,
  getCachedStatus,
  buildPanelLines as buildQuotaPanelLines,
} from "./quota-panel";
import {
  shouldShowColonyPanel,
  getColonyPanelSnapshot,
  buildColonyPanelLines,
} from "./colony-panel";

export function hyperlink(url: string, text: string): string {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

export type PrInfo = { number: number; url: string };
export type FooterUsageTotals = { input: number; output: number; cost: number };

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m${rs > 0 ? `${rs}s` : ""}`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${rm > 0 ? `${rm}m` : ""}`;
}

export function fmt(n: number): string {
  return n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;
}

function accumulateAssistantUsage(totals: FooterUsageTotals, message: AssistantMessage): void {
  totals.input += Number(message.usage.input) || 0;
  totals.output += Number(message.usage.output) || 0;
  totals.cost += Number(message.usage.cost.total) || 0;
}

export function collectFooterUsageTotals(
  ctx: Pick<ExtensionContext, "sessionManager">,
): FooterUsageTotals {
  const totals: FooterUsageTotals = { input: 0, output: 0, cost: 0 };
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      accumulateAssistantUsage(totals, entry.message as AssistantMessage);
    }
  }
  return totals;
}

export type FooterTheme = { fg: (color: string, text: string) => string };

export type ContextThresholds = { warningPct: number; errorPct: number };
export type ContextThresholdOverrides = {
  default?: Partial<ContextThresholds>;
  byProvider?: Record<string, Partial<ContextThresholds>>;
  byProviderModel?: Record<string, Partial<ContextThresholds>>;
};

const DEFAULT_CONTEXT_THRESHOLDS: ContextThresholds = { warningPct: 50, errorPct: 75 };
const ANTHROPIC_CONTEXT_THRESHOLDS: ContextThresholds = { warningPct: 65, errorPct: 85 };

function normalizeThresholds(
  input: Partial<ContextThresholds> | undefined,
  fallback: ContextThresholds,
): ContextThresholds {
  const warning = Number.isFinite(Number(input?.warningPct))
    ? Math.max(1, Math.min(99, Number(input?.warningPct)))
    : fallback.warningPct;
  const error = Number.isFinite(Number(input?.errorPct))
    ? Math.max(warning + 1, Math.min(100, Number(input?.errorPct)))
    : fallback.errorPct;
  return {
    warningPct: Math.floor(warning),
    errorPct: Math.floor(error),
  };
}

export function resolveContextThresholds(
  modelProvider: string | null,
  modelId: string,
  overrides?: ContextThresholdOverrides,
): ContextThresholds {
  const provider = (modelProvider ?? "").trim().toLowerCase();
  const base = provider === "anthropic"
    ? ANTHROPIC_CONTEXT_THRESHOLDS
    : DEFAULT_CONTEXT_THRESHOLDS;

  let resolved = normalizeThresholds(overrides?.default, base);
  if (provider && overrides?.byProvider?.[provider]) {
    resolved = normalizeThresholds(overrides.byProvider[provider], resolved);
  }

  const modelKey = provider ? `${provider}/${modelId}`.toLowerCase() : modelId.toLowerCase();
  const byModel = overrides?.byProviderModel?.[modelKey];
  if (byModel) {
    resolved = normalizeThresholds(byModel, resolved);
  }

  return resolved;
}

function readContextThresholdOverrides(cwd: string): ContextThresholdOverrides | undefined {
  const candidates = [
    path.join(cwd, ".pi", "settings.json"),
    path.join(homedir(), ".pi", "agent", "settings.json"),
  ];

  for (const settingsPath of candidates) {
    if (!existsSync(settingsPath)) continue;
    try {
      const json = JSON.parse(readFileSync(settingsPath, "utf8"));
      const cfg = json?.piStack?.customFooter?.contextPressure;
      if (!cfg || typeof cfg !== "object") continue;
      const entry = cfg as ContextThresholdOverrides;
      return {
        default: entry.default,
        byProvider: entry.byProvider,
        byProviderModel: entry.byProviderModel,
      };
    } catch {
      // ignore malformed settings
    }
  }
  return undefined;
}

export type FooterRenderInput = {
  usageTotals: FooterUsageTotals;
  sessionStart: number;
  cachedPr: PrInfo | null;
  thinkingLevel: string;
  modelId: string;
  modelProvider: string | null;
  contextPct: number;
  branch: string | null;
  budgetStatus: string | undefined;
  pilotStatus: string | undefined;
  monitorSummaryStatus: string | undefined;
  boardClockStatus?: string;
  cwd: string;
  contextThresholdOverrides?: ContextThresholdOverrides;
};

export function buildFooterLines(
  input: FooterRenderInput,
  theme: FooterTheme,
  width: number,
): string[] {
  const { usageTotals, sessionStart, cachedPr, thinkingLevel, modelId, modelProvider,
          contextPct, branch, budgetStatus, pilotStatus, monitorSummaryStatus, boardClockStatus, cwd,
          contextThresholdOverrides } = input;

  const thinkColor =
    thinkingLevel === "high" ? "warning"
    : thinkingLevel === "medium" ? "accent"
    : thinkingLevel === "low" ? "dim"
    : "muted";

  const thresholds = resolveContextThresholds(
    modelProvider,
    modelId,
    contextThresholdOverrides,
  );
  const pctColor =
    contextPct > thresholds.errorPct
      ? "error"
      : contextPct > thresholds.warningPct
        ? "warning"
        : "success";

  const modelLabel = modelProvider ? `${modelProvider}/${modelId}` : modelId;
  const modelStr = `${theme.fg(thinkColor, "◆")} ${theme.fg("accent", modelLabel)}`;

  const tokenStats = [
    theme.fg("accent", `${fmt(usageTotals.input)}/${fmt(usageTotals.output)}`),
    theme.fg("warning", `$${usageTotals.cost.toFixed(2)}`),
    theme.fg(pctColor, `${contextPct.toFixed(0)}%`),
  ].join(" ");

  const elapsed = theme.fg("dim", `⏱${formatElapsed(Date.now() - sessionStart)}`);

  const sep = theme.fg("dim", " | ");
  const line1Parts = [modelStr, tokenStats, elapsed];

  const cwdParts = cwd.replace(/\\/g, "/").split("/");
  const shortCwd = cwdParts.length > 2 ? cwdParts.slice(-2).join("/") : cwd;
  const cwdStr = theme.fg("muted", `⌂ ${shortCwd}`);

  let branchStr = branch ? theme.fg("accent", `⎇ ${branch}`) : "";
  if (cachedPr) {
    const prLabel = theme.fg("success", `PR #${cachedPr.number}`);
    branchStr = branchStr
      ? `${branchStr} ${hyperlink(cachedPr.url, prLabel)}`
      : hyperlink(cachedPr.url, prLabel);
  }

  const line2Parts: string[] = [cwdStr];
  if (branchStr) line2Parts.push(branchStr);
  if (budgetStatus) line2Parts.push(theme.fg("dim", budgetStatus));
  if (pilotStatus) line2Parts.push(theme.fg("dim", pilotStatus));
  if (monitorSummaryStatus) line2Parts.push(theme.fg("dim", monitorSummaryStatus));
  if (boardClockStatus) line2Parts.push(theme.fg("dim", boardClockStatus));

  return [
    truncateToWidth(line1Parts.join(sep), width),
    truncateToWidth(line2Parts.join(sep), width),
  ];
}

const PR_PROBE_COOLDOWN_MS = 60_000;

export default function customFooterExtension(pi: ExtensionAPI) {
  let sessionStart = Date.now();
  let usageTotals: FooterUsageTotals = { input: 0, output: 0, cost: 0 };
  let activeFooterData: ReadonlyFooterDataProvider | null = null;
  let activeCtx: ExtensionContext | null = null;
  let cachedPr: PrInfo | null = null;
  let prProbedForBranch: string | null = null;
  let contextThresholdOverrides: ContextThresholdOverrides | undefined;
  let lastPrProbeAt = 0;
  let prProbeInFlight = false;

  const syncUsageTotals = (ctx: Pick<ExtensionContext, "sessionManager">) => {
    usageTotals = collectFooterUsageTotals(ctx);
  };

  const probePr = (branch: string | null) => {
    if (!branch || prProbeInFlight) return;
    const now = Date.now();
    if (branch === prProbedForBranch && now - lastPrProbeAt < PR_PROBE_COOLDOWN_MS) return;
    if (branch !== prProbedForBranch) cachedPr = null;
    prProbeInFlight = true;
    prProbedForBranch = branch;
    lastPrProbeAt = now;
    // pi.exec uses execFile internally — args are passed as array (no shell injection)
    pi.exec("gh", ["pr", "view", "--json", "number,url", "--jq", "{number,url}"], { timeout: 8000 })
      .then(({ stdout, exitCode }) => {
        if (exitCode !== 0 || !stdout.trim()) { cachedPr = null; return; }
        try {
          const parsed = JSON.parse(stdout.trim()) as { number?: number; url?: string };
          cachedPr = (parsed.number && parsed.url)
            ? { number: parsed.number, url: parsed.url }
            : null;
        } catch { cachedPr = null; }
      })
      .catch(() => { cachedPr = null; })
      .finally(() => { prProbeInFlight = false; });
  };

  pi.on("session_start", async (_event, ctx) => {
    sessionStart = Date.now();
    syncUsageTotals(ctx);
    activeCtx = ctx;
    contextThresholdOverrides = readContextThresholdOverrides(ctx.cwd);

    ctx.ui.setFooter((tui, theme, footerData) => {
      activeFooterData = footerData;
      const unsub = footerData.onBranchChange(() => {
        probePr(footerData.getGitBranch());
        tui.requestRender();
      });
      const timer = setInterval(() => tui.requestRender(), 30_000);
      probePr(footerData.getGitBranch());

      return {
        dispose() { unsub(); clearInterval(timer); },
        invalidate() {},
        render(width: number): string[] {
          const usage = ctx.getContextUsage();
          const modelProvider = (ctx.model as Record<string, unknown> | undefined)?.["provider"];
          const statuses = footerData.getExtensionStatuses?.();
          const baseLines = buildFooterLines(
            {
              usageTotals,
              sessionStart,
              cachedPr,
              thinkingLevel: pi.getThinkingLevel(),
              modelId: ctx.model?.id ?? "no-model",
              modelProvider: typeof modelProvider === "string" && modelProvider ? modelProvider : null,
              contextPct: usage?.percent ?? 0,
              branch: footerData.getGitBranch(),
              budgetStatus: statuses?.get("quota-budgets"),
              pilotStatus: statuses?.get("colony-pilot"),
              monitorSummaryStatus: statuses?.get("monitor-summary"),
              boardClockStatus: statuses?.get("board-clock"),
              cwd: process.cwd(),
              contextThresholdOverrides,
            },
            theme,
            width,
          );
          const showQuotaPanel = shouldShowPanel();
          const showColonyPanel = shouldShowColonyPanel();
          if (!showQuotaPanel && !showColonyPanel) return baseLines;

          const panelLines: string[] = [];
          if (showQuotaPanel) {
            panelLines.push(...buildQuotaPanelLines(getCachedStatus(), width));
          }
          if (showColonyPanel) {
            panelLines.push(...buildColonyPanelLines(getColonyPanelSnapshot(), width));
          }
          return [...baseLines, ...panelLines];
        },
      };
    });
  });

  pi.on("session_switch", (event, ctx) => {
    syncUsageTotals(ctx);
    if (event.reason === "new") sessionStart = Date.now();
  });

  pi.on("session_tree", (_event, ctx) => { syncUsageTotals(ctx); });
  pi.on("session_fork", (_event, ctx) => { syncUsageTotals(ctx); });

  pi.on("turn_end", (event) => {
    if (event.message.role === "assistant") {
      accumulateAssistantUsage(usageTotals, event.message as AssistantMessage);
    }
  });

  // ── /status overlay ──────────────────────────────────────────────────────

  function buildStatusLines(theme: { fg: (color: string, text: string) => string }): string[] {
    const lines: string[] = [];
    const sep = theme.fg("dim", " │ ");
    const divider = theme.fg("dim", "─".repeat(60));

    lines.push(theme.fg("accent", "╭─ Status ───────────────────────────────────────────────────╮"));
    lines.push("");

    // ── Model ──
    const thinking = pi.getThinkingLevel();
    const thinkLabel = thinking === "none" ? "off" : thinking;
    const modelId = activeCtx?.model?.id ?? "no-model";
    const modelProvider = (activeCtx?.model as Record<string, unknown> | undefined)?.["provider"];
    const providerLabel = typeof modelProvider === "string" && modelProvider ? modelProvider : "unknown";
    lines.push(`  ${theme.fg("accent", "Model")}${sep}${theme.fg("accent", modelId)}`);
    lines.push(`  ${theme.fg("accent", "Provider")}${sep}${providerLabel}`);
    lines.push(`  ${theme.fg("accent", "Thinking")}${sep}${thinkLabel}`);
    lines.push("");

    // ── Session ──
    lines.push(`  ${divider}`);
    const elapsed = formatElapsed(Date.now() - sessionStart);
    lines.push(
      `  ${theme.fg("accent", "Session")}${sep}${elapsed}${sep}${theme.fg("warning", `$${usageTotals.cost.toFixed(2)}`)}`,
    );
    lines.push(
      `  ${theme.fg("accent", "Tokens")}${sep}${theme.fg("success", fmt(usageTotals.input))} in${sep}${theme.fg("warning", fmt(usageTotals.output))} out${sep}${theme.fg("dim", fmt(usageTotals.input + usageTotals.output))} total`,
    );

    // ── Context window ──
    const usage = activeCtx?.getContextUsage?.();
    if (usage) {
      const pct = usage.percent ?? 0;
      const thresholds = resolveContextThresholds(
        typeof modelProvider === "string" && modelProvider ? modelProvider : null,
        modelId,
        contextThresholdOverrides,
      );
      const pctColor =
        pct > thresholds.errorPct
          ? "error"
          : pct > thresholds.warningPct
            ? "warning"
            : "success";
      const tokens = usage.tokens == null ? "?" : fmt(usage.tokens);
      lines.push(
        `  ${theme.fg("accent", "Context")}${sep}${theme.fg(pctColor, `${pct.toFixed(0)}% used`)}${sep}${tokens} / ${fmt(usage.contextWindow)} tokens`,
      );
    }
    lines.push("");

    // ── Workspace ──
    lines.push(`  ${divider}`);
    lines.push(`  ${theme.fg("accent", "Directory")}${sep}${process.cwd()}`);

    const branch = activeFooterData?.getGitBranch?.();
    if (branch) {
      lines.push(`  ${theme.fg("accent", "Branch")}${sep}${theme.fg("accent", branch)}`);
    }

    if (cachedPr) {
      const prLink = hyperlink(cachedPr.url, `#${cachedPr.number}`);
      lines.push(
        `  ${theme.fg("accent", "Pull Request")}${sep}${theme.fg("success", prLink)}${sep}${theme.fg("dim", cachedPr.url)}`,
      );
    }
    lines.push("");

    // ── Extension statuses ──
    const statuses = activeFooterData?.getExtensionStatuses?.();
    if (statuses && statuses.size > 0) {
      lines.push(`  ${divider}`);
      lines.push(`  ${theme.fg("accent", "Extension Statuses")}`);
      lines.push("");
      for (const [key, value] of statuses) {
        lines.push(`  ${theme.fg("dim", key.padEnd(24))}${value}`);
      }
      lines.push("");
    }

    lines.push(theme.fg("accent", "╰────────────────────────────────────────────────────────────╯"));
    lines.push(theme.fg("dim", "  Press q/Esc/Space/Enter to close"));

    return lines;
  }

  pi.registerCommand("status", {
    description: "Show full status: provider, model, session, context, workspace, budget, PR",
    async handler(_args, ctx) {
      activeCtx = ctx;
      await ctx.ui.custom(
        (_tui, theme, _keybindings, done) => {
          const lines = buildStatusLines(theme);
          return {
            render(width: number) { return lines.map((line) => truncateToWidth(line, width)); },
            handleInput(data: string) {
              if (data === "q" || data === "\x1b" || data === "\r" || data === " ") done(undefined);
            },
            dispose() {},
          };
        },
        { overlay: true },
      );
    },
  });
}
