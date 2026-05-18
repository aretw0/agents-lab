import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { fmt, formatElapsed, hyperlink } from "./custom-footer-formatters";
import {
  resolveContextThresholds,
  type ContextThresholdOverrides,
} from "./custom-footer-context-thresholds";
import type { FooterUsageTotals, PrInfo } from "./custom-footer";

export type FooterStatusTheme = { fg: (color: string, text: string) => string };

export interface FooterStatusOverlayInput {
  sessionStart: number;
  usageTotals: FooterUsageTotals;
  thinkingLevel: string;
  activeCtx: ExtensionContext | null;
  activeFooterData: ReadonlyFooterDataProvider | null;
  cachedPr: PrInfo | null;
  contextThresholdOverrides?: ContextThresholdOverrides;
  budgetLegend: string[];
  cwd: string;
}

export function buildStatusLines(input: FooterStatusOverlayInput, theme: FooterStatusTheme): string[] {
  const lines: string[] = [];
  const sep = theme.fg("dim", " │ ");
  const divider = theme.fg("dim", "─".repeat(60));

  lines.push(theme.fg("accent", "╭─ Status ───────────────────────────────────────────────────╮"));
  lines.push("");

  const thinking = input.thinkingLevel;
  const thinkLabel = thinking === "none" ? "off" : thinking;
  const modelId = input.activeCtx?.model?.id ?? "no-model";
  const modelProvider = (input.activeCtx?.model as Record<string, unknown> | undefined)?.["provider"];
  const providerLabel = typeof modelProvider === "string" && modelProvider ? modelProvider : "unknown";
  lines.push(`  ${theme.fg("accent", "Model")}${sep}${theme.fg("accent", modelId)}`);
  lines.push(`  ${theme.fg("accent", "Provider")}${sep}${providerLabel}`);
  lines.push(`  ${theme.fg("accent", "Thinking")}${sep}${thinkLabel}`);
  lines.push("");

  lines.push(`  ${divider}`);
  const elapsed = formatElapsed(Date.now() - input.sessionStart);
  lines.push(
    `  ${theme.fg("accent", "Session")}${sep}${elapsed}${sep}${theme.fg("warning", `$${input.usageTotals.cost.toFixed(2)}`)}`,
  );
  lines.push(
    `  ${theme.fg("accent", "Tokens")}${sep}${theme.fg("success", fmt(input.usageTotals.input))} in${sep}${theme.fg("warning", fmt(input.usageTotals.output))} out${sep}${theme.fg("dim", fmt(input.usageTotals.input + input.usageTotals.output))} total`,
  );

  const usage = input.activeCtx?.getContextUsage?.();
  if (usage) {
    const pct = usage.percent ?? 0;
    const thresholds = resolveContextThresholds(
      typeof modelProvider === "string" && modelProvider ? modelProvider : null,
      modelId,
      input.contextThresholdOverrides,
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

  lines.push(`  ${divider}`);
  lines.push(`  ${theme.fg("accent", "Directory")}${sep}${input.cwd}`);

  const branch = input.activeFooterData?.getGitBranch?.();
  if (branch) {
    lines.push(`  ${theme.fg("accent", "Branch")}${sep}${theme.fg("accent", branch)}`);
  }

  if (input.cachedPr) {
    const prLink = hyperlink(input.cachedPr.url, `#${input.cachedPr.number}`);
    lines.push(
      `  ${theme.fg("accent", "Pull Request")}${sep}${theme.fg("success", prLink)}${sep}${theme.fg("dim", input.cachedPr.url)}`,
    );
  }
  lines.push("");

  const statuses = input.activeFooterData?.getExtensionStatuses?.();
  if (statuses && statuses.size > 0) {
    lines.push(`  ${divider}`);
    lines.push(`  ${theme.fg("accent", "Extension Statuses")}`);
    lines.push("");
    for (const [key, value] of statuses) {
      lines.push(`  ${theme.fg("dim", key.padEnd(24))}${value}`);
    }
    if (input.budgetLegend.length > 0) {
      lines.push("");
      for (const line of input.budgetLegend) lines.push(`  ${theme.fg("dim", line)}`);
    }
    lines.push("");
  }

  lines.push(theme.fg("accent", "╰────────────────────────────────────────────────────────────╯"));
  lines.push(theme.fg("dim", "  Press q/Esc/Space/Enter to close"));

  return lines;
}

export function fitStatusOverlayLines(lines: string[], width: number): string[] {
  return lines.map((line) => truncateToWidth(line, width));
}
