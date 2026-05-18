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
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { formatBudgetStatusLegend } from "./quota-visibility";
import {
  resolveContextThresholds,
  type ContextThresholdOverrides,
  type ContextThresholds,
} from "./custom-footer-context-thresholds";
import { fmt, formatElapsed, hyperlink } from "./custom-footer-formatters";
export {
  resolveContextThresholds,
  type ContextThresholdOverrides,
  type ContextThresholds,
} from "./custom-footer-context-thresholds";
export { fmt, formatElapsed, hyperlink } from "./custom-footer-formatters";

export type PrInfo = { number: number; url: string };
export type FooterUsageTotals = { input: number; output: number; cost: number };

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

export type FooterDensity = "wide" | "medium" | "narrow";

export function resolveFooterDensity(width: number): FooterDensity {
  if (width < 76) return "narrow";
  if (width < 118) return "medium";
  return "wide";
}

function ellipsizeMiddle(text: string, maxChars: number): string {
  const input = String(text ?? "");
  const max = Math.max(4, Math.floor(maxChars));
  if (input.length <= max) return input;
  const head = Math.max(2, Math.ceil((max - 1) / 2));
  const tail = Math.max(1, Math.floor((max - 1) / 2));
  return `${input.slice(0, head)}…${input.slice(-tail)}`;
}

function compactBudgetStatus(status: string | undefined, density: FooterDensity): string | undefined {
  if (!status) return undefined;
  const tokens = status.split(/\s+/).filter(Boolean);
  const maxTokens = density === "wide" ? 99 : density === "medium" ? 2 : 1;
  if (tokens.length <= maxTokens) return status;
  return `${tokens.slice(0, maxTokens).join(" ")} +${tokens.length - maxTokens}`;
}

export function formatFooterBudgetLegend(status: string | undefined): string[] {
  if (!status) return [];
  return formatBudgetStatusLegend();
}

function compactPilotStatus(status: string | undefined, density: FooterDensity): string | undefined {
  if (!status) return undefined;
  if (density === "wide") return status;

  const normalized = status
    .replace(/monitors=/gi, "m=")
    .replace(/colonies=/gi, "col=")
    .replace(/web=/gi, "w=")
    .replace(/\s*·\s*/g, " ");

  if (density === "medium") return normalized;

  const m = normalized.match(/\bm=([^\s]+)/i)?.[1];
  const w = normalized.match(/\bw=([^\s]+)/i)?.[1];
  const c = normalized.match(/\bcol=([^\s]+)/i)?.[1];
  const bits = [m ? `m:${m}` : "", w ? `w:${w}` : "", c ? `c:${c}` : ""].filter(Boolean);
  return bits.length > 0 ? `[pilot] ${bits.join(" ")}` : "[pilot]";
}

function compactMonitorStatus(status: string | undefined, density: FooterDensity): string | undefined {
  if (!status) return undefined;
  if (density !== "narrow") return status;
  const fail = status.match(/fail\s*=\s*([^\s]+)/i)?.[1];
  const ratio = status.match(/\b(\d+\/\d+)\b/)?.[1];
  const bits = [ratio ? `r:${ratio}` : "", fail ? `f:${fail}` : ""].filter(Boolean);
  return bits.length > 0 ? `[mon] ${bits.join(" ")}` : "[mon]";
}

function compactHatchStatus(status: string | undefined, density: FooterDensity): string | undefined {
  if (!status) return undefined;
  if (density === "wide") return status;
  const mode = status.match(/mode=([^\s]+)/i)?.[1];
  const ready = /!ready/i.test(status) ? "!ready" : "ready";
  if (density === "medium") {
    return mode ? `[hatch] mode=${mode} ${ready}` : `[hatch] ${ready}`;
  }
  return mode ? `[hatch] ${mode}` : "[hatch]";
}

function compactBoardClockStatus(status: string | undefined, density: FooterDensity): string | undefined {
  if (!status) return undefined;
  if (density === "wide") return status;
  const ip = status.match(/\bip=([^\s]+)/i)?.[1];
  const blk = status.match(/\bblk=([^\s]+)/i)?.[1];
  const plan = status.match(/\bplan=([^\s]+)/i)?.[1];
  if (density === "medium") {
    const bits = [ip ? `ip=${ip}` : "", blk ? `blk=${blk}` : "", plan ? `plan=${plan}` : ""].filter(Boolean);
    return bits.length > 0 ? `[board] ${bits.join(" ")}` : "[board]";
  }
  const bits = [ip ? `ip=${ip}` : "", blk ? `blk=${blk}` : ""].filter(Boolean);
  return bits.length > 0 ? `[board] ${bits.join(" ")}` : "[board]";
}

function compactModelLabel(modelProvider: string | null, modelId: string, density: FooterDensity): string {
  const full = modelProvider ? `${modelProvider}/${modelId}` : modelId;
  if (density === "wide") return full;
  return ellipsizeMiddle(full, density === "medium" ? 34 : 22);
}

function compactBranchLabel(branch: string | null, density: FooterDensity): string | null {
  if (!branch) return null;
  const max = density === "wide" ? 42 : density === "medium" ? 22 : 14;
  return ellipsizeMiddle(branch, max);
}

function compactCwdLabel(cwd: string, density: FooterDensity): string {
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return cwd;
  const depth = density === "wide" ? 2 : 1;
  const tail = parts.slice(-depth).join("/");
  return tail || parts[parts.length - 1] || cwd;
}

export function fitFooterPanelLines(lines: string[], width: number): string[] {
  return lines.map((line) => truncateToWidth(line, width));
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
  hatchStatus?: string;
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
          contextPct, branch, budgetStatus, pilotStatus, hatchStatus, monitorSummaryStatus, boardClockStatus, cwd,
          contextThresholdOverrides } = input;

  const density = resolveFooterDensity(width);
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

  const modelLabel = compactModelLabel(modelProvider, modelId, density);
  const modelStr = `${theme.fg(thinkColor, "◆")} ${theme.fg("accent", modelLabel)}`;

  const tokenStats = [
    theme.fg("accent", `${fmt(usageTotals.input)}/${fmt(usageTotals.output)}`),
    theme.fg("warning", `$${usageTotals.cost.toFixed(2)}`),
    theme.fg(pctColor, `${contextPct.toFixed(0)}%`),
  ].join(" ");

  const elapsed = theme.fg("dim", `⏱${formatElapsed(Date.now() - sessionStart)}`);

  const sep = theme.fg("dim", " | ");
  const line1Parts = [modelStr, tokenStats, elapsed];

  const shortCwd = compactCwdLabel(cwd, density);
  const cwdStr = theme.fg("muted", `⌂ ${shortCwd}`);

  const compactBranch = compactBranchLabel(branch, density);
  let branchStr = compactBranch ? theme.fg("accent", `⎇ ${compactBranch}`) : "";
  if (cachedPr) {
    const prLabel = theme.fg("success", `PR #${cachedPr.number}`);
    branchStr = branchStr
      ? `${branchStr} ${hyperlink(cachedPr.url, prLabel)}`
      : hyperlink(cachedPr.url, prLabel);
  }

  const statusCandidates = [
    compactBudgetStatus(budgetStatus, density),
    compactBoardClockStatus(boardClockStatus, density),
    compactPilotStatus(pilotStatus, density),
    compactHatchStatus(hatchStatus, density),
    compactMonitorStatus(monitorSummaryStatus, density),
  ].filter((x): x is string => Boolean(x));

  const statusMax = density === "wide" ? 4 : density === "medium" ? 3 : 2;
  const visibleStatuses = statusCandidates.slice(0, statusMax);
  const hiddenStatusCount = Math.max(0, statusCandidates.length - visibleStatuses.length);

  const line2Parts: string[] = [cwdStr];
  if (branchStr) line2Parts.push(branchStr);
  for (const status of visibleStatuses) line2Parts.push(theme.fg("dim", status));
  if (hiddenStatusCount > 0) {
    line2Parts.push(theme.fg("dim", `+${hiddenStatusCount} status`));
  }

  return [
    truncateToWidth(line1Parts.join(sep), width),
    truncateToWidth(line2Parts.join(sep), width),
  ];
}

const PR_PROBE_COOLDOWN_MS = 60_000;
type QuotaPanelRuntime = typeof import("./quota-panel");
type ColonyPanelRuntime = typeof import("./colony-panel");

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
  let quotaPanelRuntime: QuotaPanelRuntime | undefined;
  let colonyPanelRuntime: ColonyPanelRuntime | undefined;
  let panelRuntimeLoad: Promise<void> | undefined;

  const loadFooterPanelRuntimes = (): Promise<void> => {
    if (quotaPanelRuntime && colonyPanelRuntime) return Promise.resolve();
    panelRuntimeLoad ??= Promise.all([
      import("./quota-panel"),
      import("./colony-panel"),
    ]).then(([quotaPanel, colonyPanel]) => {
      quotaPanelRuntime = quotaPanel;
      colonyPanelRuntime = colonyPanel;
    }).finally(() => {
      panelRuntimeLoad = undefined;
    });
    return panelRuntimeLoad;
  };

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
      void loadFooterPanelRuntimes().then(() => tui.requestRender()).catch(() => undefined);

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
              hatchStatus: statuses?.get("colony-pilot-hatch"),
              monitorSummaryStatus: statuses?.get("monitor-summary"),
              boardClockStatus: statuses?.get("board-clock"),
              cwd: process.cwd(),
              contextThresholdOverrides,
            },
            theme,
            width,
          );
          const showQuotaPanel = quotaPanelRuntime?.shouldShowPanel() ?? false;
          const showColonyPanel = colonyPanelRuntime?.shouldShowColonyPanel() ?? false;
          if (!showQuotaPanel && !showColonyPanel) return baseLines;

          const panelLines: string[] = [];
          if (showQuotaPanel) {
            panelLines.push(...quotaPanelRuntime.buildPanelLines(quotaPanelRuntime.getCachedStatus(), width));
          }
          if (showColonyPanel) {
            panelLines.push(...colonyPanelRuntime.buildColonyPanelLines(colonyPanelRuntime.getColonyPanelSnapshot(), width));
          }
          return [...baseLines, ...fitFooterPanelLines(panelLines, width)];
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

  pi.registerCommand("status", {
    description: "Show full status: provider, model, session, context, workspace, budget, PR",
    async handler(_args, ctx) {
      activeCtx = ctx;
      const { buildStatusLines, fitStatusOverlayLines } = await import("./custom-footer-status-overlay");
      await ctx.ui.custom(
        (_tui, theme, _keybindings, done) => {
          const statuses = activeFooterData?.getExtensionStatuses?.();
          const lines = buildStatusLines({
            sessionStart,
            usageTotals,
            thinkingLevel: pi.getThinkingLevel(),
            activeCtx,
            activeFooterData,
            cachedPr,
            contextThresholdOverrides,
            budgetLegend: formatFooterBudgetLegend(statuses?.get("quota-budgets")),
            cwd: process.cwd(),
          }, theme);
          return {
            render(width: number) { return fitStatusOverlayLines(lines, width); },
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
