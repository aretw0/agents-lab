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

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";

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

const PR_PROBE_COOLDOWN_MS = 60_000;

export default function customFooterExtension(pi: ExtensionAPI) {
  let sessionStart = Date.now();
  let usageTotals: FooterUsageTotals = { input: 0, output: 0, cost: 0 };
  let activeFooterData: ReadonlyFooterDataProvider | null = null;
  let activeCtx: ExtensionContext | null = null;
  let cachedPr: PrInfo | null = null;
  let prProbedForBranch: string | null = null;
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
          const pct = usage?.percent ?? 0;
          const pctColor = pct > 75 ? "error" : pct > 50 ? "warning" : "success";

          const tokenStats = [
            theme.fg("accent", `${fmt(usageTotals.input)}/${fmt(usageTotals.output)}`),
            theme.fg("warning", `$${usageTotals.cost.toFixed(2)}`),
            theme.fg(pctColor, `${pct.toFixed(0)}%`),
          ].join(" ");

          const elapsed = theme.fg("dim", `⏱${formatElapsed(Date.now() - sessionStart)}`);

          const cwdParts = process.cwd().replace(/\\/g, "/").split("/");
          const shortCwd = cwdParts.length > 2 ? cwdParts.slice(-2).join("/") : process.cwd();
          const cwdStr = theme.fg("muted", `⌂ ${shortCwd}`);

          const branch = footerData.getGitBranch();
          let branchStr = branch ? theme.fg("accent", `⎇ ${branch}`) : "";
          if (cachedPr) {
            const prLabel = theme.fg("success", `PR #${cachedPr.number}`);
            branchStr = branchStr
              ? `${branchStr} ${hyperlink(cachedPr.url, prLabel)}`
              : hyperlink(cachedPr.url, prLabel);
          }

          const thinking = pi.getThinkingLevel();
          const thinkColor =
            thinking === "high" ? "warning"
            : thinking === "medium" ? "accent"
            : thinking === "low" ? "dim"
            : "muted";

          // provider/modelId — core addition over upstream
          const modelId = ctx.model?.id ?? "no-model";
          const modelProvider = (ctx.model as Record<string, unknown> | undefined)?.["provider"];
          const modelLabel = typeof modelProvider === "string" && modelProvider
            ? `${modelProvider}/${modelId}`
            : modelId;
          const modelStr = `${theme.fg(thinkColor, "◆")} ${theme.fg("accent", modelLabel)}`;

          const sep = theme.fg("dim", " | ");
          const leftParts = [modelStr, tokenStats, elapsed];

          // budget status from quota-visibility — shown when available
          const statuses = footerData.getExtensionStatuses?.();
          const budgetStatus = statuses?.get("quota-budgets");
          if (budgetStatus) leftParts.push(theme.fg("dim", budgetStatus));

          leftParts.push(cwdStr);
          if (branchStr) leftParts.push(branchStr);

          return [truncateToWidth(leftParts.join(sep), width)];
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
      const pctColor = pct > 75 ? "error" : pct > 50 ? "warning" : "success";
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
