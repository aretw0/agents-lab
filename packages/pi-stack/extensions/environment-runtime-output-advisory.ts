export type RuntimeOutputAdvisoryLevel = "info" | "warn" | "block";

export interface RuntimeOutputAdvisory {
  code: string;
  level: RuntimeOutputAdvisoryLevel;
  detail: string;
  action: string;
}

export interface RuntimeOutputAdvisoryReport {
  decision: "continue" | "safe-mode" | "stop-and-investigate" | "needs-evidence";
  advisories: RuntimeOutputAdvisory[];
  summary: string;
}

const EXTENSION_SHORTCUT_CONFLICT_RE =
  /Extension shortcut '([^']+)' from\s+([\s\S]*?)\s+conflicts with built-in\s+shortcut\.\s+Skipping\./gi;
const UPDATE_AVAILABLE_RE = /Update available:\s+([^\s]+)\s+([^\s]+)\s+(?:->|→)\s+([^\s]+)/gi;
const DIRTY_REPO_RE = /Warning:\s+Dirty repo:\s+([^\r\n]+)/gi;
const WATCHDOG_CRITICAL_RE = /Performance watchdog critical:\s*([^\r\n]+)/gi;
const WATCHDOG_AUTO_SAFE_MODE_RE = /Watchdog enabled safe mode automatically:\s*safe mode is on\s*\(([^)\r\n]+)\)/gi;
const EVENT_LOOP_MAX_RE = /event-loop max\s+(\d+)ms/i;
const EVENT_LOOP_P99_RE = /event-loop p99\s+(\d+)ms/i;
const WATCHDOG_RECURRING_EVENT_THRESHOLD = 3;
const WATCHDOG_SEVERE_EVENT_LOOP_MAX_MS = 1000;
const PLACEHOLDER_OUTPUT_RE = /^\s*\[?(?:cole|paste)\s+(?:aqui|here)\b/i;
const WATCHDOG_SEVERITY_NONE = "none";
const WATCHDOG_SEVERITY_THRESHOLD = "threshold-crossing";
const WATCHDOG_SEVERITY_RECURRING_OR_SEVERE = "recurring-or-severe";

function uniquePush(advisories: RuntimeOutputAdvisory[], advisory: RuntimeOutputAdvisory) {
  if (advisories.some((row) => row.code === advisory.code && row.detail === advisory.detail)) return;
  advisories.push(advisory);
}

function parseWatchdogLevel(detail: string): RuntimeOutputAdvisoryLevel {
  const max = EVENT_LOOP_MAX_RE.exec(detail)?.[1];
  if (max && Number(max) >= 300) return "warn";
  const p99 = EVENT_LOOP_P99_RE.exec(detail)?.[1];
  if (p99 && Number(p99) >= 150) return "warn";
  return "info";
}

function formatAdvisoryCodes(advisories: RuntimeOutputAdvisory[]): string {
  const codes = Array.from(new Set(advisories.map((row) => row.code))).sort();
  return codes.length > 0 ? codes.join(",") : "none";
}

export function analyzeRuntimeOutputAdvisories(rawOutput: string): RuntimeOutputAdvisoryReport {
  const text = String(rawOutput ?? "");
  const advisories: RuntimeOutputAdvisory[] = [];
  const watchdogCriticalDetails: string[] = [];
  const watchdogCriticalMaxValues: number[] = [];

  if (!text.trim() || PLACEHOLDER_OUTPUT_RE.test(text.trim())) {
    return {
      decision: "needs-evidence",
      advisories: [
        {
          code: "missing-runtime-output",
          level: "info",
          detail: text.trim() ? "raw_output is a placeholder" : "raw_output is empty",
          action: "paste the exact Pi startup/reload output before classifying runtime health",
        },
      ],
      summary: "runtime-output-advisory: decision=needs-evidence advisories=1 info=1 warn=0 block=0 codes=missing-runtime-output recurringOrSevere=no watchdogSeverity=none",
    };
  }

  for (const match of text.matchAll(EXTENSION_SHORTCUT_CONFLICT_RE)) {
    uniquePush(advisories, {
      code: "extension-shortcut-conflict",
      level: "warn",
      detail: `shortcut=${match[1]} source=${match[2].replace(/\s+/g, " ").trim()}`,
      action: "keep working, but curate or disable the conflicting third-party keybinding before relying on that extension",
    });
  }

  for (const match of text.matchAll(UPDATE_AVAILABLE_RE)) {
    uniquePush(advisories, {
      code: "third-party-package-update-available",
      level: "info",
      detail: `${match[1]} ${match[2]} -> ${match[3]}`,
      action: "review changelog/diff in a separate slice before updating curated user/global packages",
    });
  }

  for (const match of text.matchAll(DIRTY_REPO_RE)) {
    uniquePush(advisories, {
      code: "runtime-dirty-repo",
      level: "info",
      detail: match[1].trim(),
      action: "run git status in the runtime cwd before assuming agents-lab is dirty",
    });
  }

  for (const match of text.matchAll(WATCHDOG_CRITICAL_RE)) {
    const detail = match[1].trim();
    watchdogCriticalDetails.push(detail);
    const max = EVENT_LOOP_MAX_RE.exec(detail)?.[1];
    if (max) watchdogCriticalMaxValues.push(Number(max));
    uniquePush(advisories, {
      code: "performance-watchdog-critical",
      level: parseWatchdogLevel(detail),
      detail,
      action: "treat as safe-mode threshold-crossing evidence; ask the operator to inspect live /watchdog:status in the Pi TUI, do not execute slash commands via bash",
    });
  }

  const watchdogCriticalMax = watchdogCriticalMaxValues.length > 0 ? Math.max(...watchdogCriticalMaxValues) : 0;
  if (
    watchdogCriticalDetails.length >= WATCHDOG_RECURRING_EVENT_THRESHOLD ||
    watchdogCriticalMax >= WATCHDOG_SEVERE_EVENT_LOOP_MAX_MS
  ) {
    uniquePush(advisories, {
      code: "performance-watchdog-recurring-or-severe",
      level: "warn",
      detail: `events=${watchdogCriticalDetails.length} eventLoopMaxMs=${watchdogCriticalMax}`,
      action: "treat as safe-mode recurrence evidence; keep work small/read-only, capture /watchdog:status in the Pi TUI after the next spike, and investigate runtime surfaces if it repeats after reload",
    });
  }

  for (const match of text.matchAll(WATCHDOG_AUTO_SAFE_MODE_RE)) {
    uniquePush(advisories, {
      code: "performance-watchdog-auto-safe-mode",
      level: "warn",
      detail: match[1].trim(),
      action: "stay in safe-mode for the current slice and avoid enabling extra runtime capabilities until the status is stable",
    });
  }

  const hasBlock = advisories.some((row) => row.level === "block");
  const hasWarn = advisories.some((row) => row.level === "warn");
  const hasRecurringOrSevere = advisories.some((row) => row.code === "performance-watchdog-recurring-or-severe");
  const watchdogSeverity = hasRecurringOrSevere
    ? WATCHDOG_SEVERITY_RECURRING_OR_SEVERE
    : watchdogCriticalDetails.length > 0
      ? WATCHDOG_SEVERITY_THRESHOLD
      : WATCHDOG_SEVERITY_NONE;
  const decision = hasBlock ? "stop-and-investigate" : hasWarn ? "safe-mode" : "continue";
  const counts = advisories.reduce<Record<RuntimeOutputAdvisoryLevel, number>>(
    (acc, row) => {
      acc[row.level] += 1;
      return acc;
    },
    { info: 0, warn: 0, block: 0 },
  );

  return {
    decision,
    advisories,
    summary: [
      "runtime-output-advisory:",
      `decision=${decision}`,
      `advisories=${advisories.length}`,
      `info=${counts.info}`,
      `warn=${counts.warn}`,
      `block=${counts.block}`,
      `codes=${formatAdvisoryCodes(advisories)}`,
      `recurringOrSevere=${hasRecurringOrSevere ? "yes" : "no"}`,
      `watchdogSeverity=${watchdogSeverity}`,
    ].join(" "),
  };
}
