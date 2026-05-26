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
const EVENT_LOOP_MAX_RE = /event-loop max\s+(\d+)ms/i;
const EVENT_LOOP_P99_RE = /event-loop p99\s+(\d+)ms/i;

function uniquePush(advisories: RuntimeOutputAdvisory[], advisory: RuntimeOutputAdvisory) {
  if (advisories.some((row) => row.code === advisory.code && row.detail === advisory.detail)) return;
  advisories.push(advisory);
}

function parseWatchdogLevel(detail: string): RuntimeOutputAdvisoryLevel {
  const max = EVENT_LOOP_MAX_RE.exec(detail)?.[1];
  if (max && Number(max) >= 600) return "warn";
  const p99 = EVENT_LOOP_P99_RE.exec(detail)?.[1];
  if (p99 && Number(p99) >= 300) return "warn";
  return "info";
}

export function analyzeRuntimeOutputAdvisories(rawOutput: string): RuntimeOutputAdvisoryReport {
  const text = String(rawOutput ?? "");
  const advisories: RuntimeOutputAdvisory[] = [];

  if (!text.trim()) {
    return {
      decision: "needs-evidence",
      advisories: [
        {
          code: "missing-runtime-output",
          level: "info",
          detail: "raw_output is empty",
          action: "paste the exact Pi startup/reload output before classifying runtime health",
        },
      ],
      summary: "runtime-output-advisory: decision=needs-evidence advisories=1 info=1 warn=0 block=0",
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
    uniquePush(advisories, {
      code: "performance-watchdog-critical",
      level: parseWatchdogLevel(detail),
      detail,
      action: "if it repeats or exceeds 600ms, switch to safe-mode and investigate live /watchdog:status in the Pi TUI",
    });
  }

  const hasBlock = advisories.some((row) => row.level === "block");
  const hasWarn = advisories.some((row) => row.level === "warn");
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
    ].join(" "),
  };
}
