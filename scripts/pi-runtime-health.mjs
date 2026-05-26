#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";
import { buildPiDevPressureReport } from "./pi-dev-pressure.mjs";
import { runRuntimeArtifactAudit } from "./pi-runtime-artifact-audit.mjs";

const DECISIONS = new Set(["continue", "safe-mode", "stop-and-investigate"]);

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    json: false,
    strict: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd") {
      out.cwd = argv[++i] ?? out.cwd;
    } else if (arg === "--json") {
      out.json = true;
    } else if (arg === "--strict") {
      out.strict = true;
    } else if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function printHelp() {
  console.log([
    "pi runtime health preflight",
    "",
    "Usage:",
    "  pnpm run pi:runtime:health",
    "  pnpm run pi:runtime:health:json",
    "  node scripts/pi-runtime-health.mjs --strict",
    "",
    "Options:",
    "  --cwd <path>  workspace to inspect",
    "  --json        machine-readable output",
    "  --strict      exit 1 when decision is not continue",
    "  -h, --help",
  ].join("\n"));
}

function classifyDecision({ devPressure, artifactAudit }) {
  const reasons = [];
  const signalCodes = new Set((devPressure.signals ?? []).map((signal) => signal.code));

  if ((artifactAudit.violations?.length ?? 0) > 0) {
    reasons.push("runtime-artifacts-tracked");
  }
  if (devPressure.recommendation === "block-and-clean") {
    reasons.push("dev-pressure-block");
  }
  if (signalCodes.has("invalid-runtime-shell-path")) {
    reasons.push("invalid-runtime-shell-path");
  }

  if (reasons.length > 0) {
    return { decision: "stop-and-investigate", reasons };
  }

  if ((devPressure.performanceWatchdog?.persistedEventCount ?? 0) > 0) {
    reasons.push("recent-performance-watchdog-event");
  }
  if (["reduce-governance-surface", "new-session", "checkpoint-and-commit"].includes(devPressure.recommendation)) {
    reasons.push(`dev-pressure-${devPressure.recommendation}`);
  }

  if (reasons.length > 0) {
    return { decision: "safe-mode", reasons };
  }

  return { decision: "continue", reasons: [] };
}

export function buildPiRuntimeHealthReport(cwd = process.cwd(), options = {}) {
  const devPressure = options.devPressure ?? buildPiDevPressureReport(cwd, options.devPressureOptions ?? {});
  const artifactAudit = options.artifactAudit ?? runRuntimeArtifactAudit(cwd);
  const classified = classifyDecision({ devPressure, artifactAudit });
  if (!DECISIONS.has(classified.decision)) {
    throw new Error(`Unexpected runtime health decision: ${classified.decision}`);
  }

  const watchdog = devPressure.performanceWatchdog ?? {};
  return {
    mode: "pi-runtime-health",
    cwd: devPressure.cwd ?? cwd,
    decision: classified.decision,
    reasons: classified.reasons,
    liveWatchdogMetricsAvailable: false,
    operatorWatchdogSource: "Pi TUI slash commands",
    summary: [
      "pi-runtime-health:",
      `decision=${classified.decision}`,
      `devPressure=${devPressure.recommendation}`,
      `signals=${devPressure.signals?.length ?? 0}`,
      `artifacts=${artifactAudit.violations?.length ?? 0}`,
      `watchdogPersistedEvents=${watchdog.persistedEventCount ?? 0}`,
      "liveWatchdog=unavailable",
    ].join(" "),
    devPressure: {
      recommendation: devPressure.recommendation,
      summary: devPressure.summary,
      signals: devPressure.signals ?? [],
      primaryAction: devPressure.primaryAction ?? "continue",
      primaryRecoveryActions: devPressure.primaryRecoveryActions ?? [],
      performanceWatchdog: watchdog,
      largestSessionMb: devPressure.sessions?.largest?.mb ?? 0,
      heaviestConfiguredEntrypoint: devPressure.configuredEntrypoints?.[0],
    },
    artifactAudit: {
      trackedCount: artifactAudit.trackedCount,
      violations: artifactAudit.violations ?? [],
      remediation: artifactAudit.remediation ?? [],
    },
  };
}

export function formatPiRuntimeHealthReport(report) {
  const lines = [
    report.summary,
    `- decision: ${report.decision}`,
    `- reasons: ${report.reasons.length > 0 ? report.reasons.join(", ") : "none"}`,
    `- dev-pressure: ${report.devPressure.summary}`,
    `- dev-pressure action: ${report.devPressure.primaryAction}`,
    `- runtime-artifacts: tracked=${report.artifactAudit.trackedCount} violations=${report.artifactAudit.violations.length}`,
    `- performance-watchdog: persistedEvents=${report.devPressure.performanceWatchdog.persistedEventCount ?? 0} liveMetrics=unavailable`,
    "- note: live rss/heap/event-loop metrics remain Pi TUI-local; /watchdog:status is a Pi TUI command, not a shell command.",
  ];
  for (const action of report.devPressure.primaryRecoveryActions.slice(0, 4)) {
    lines.push(`  - recovery: ${action}`);
  }
  for (const signal of report.devPressure.signals.slice(0, 6)) {
    lines.push(`  - [${signal.level}] ${signal.code}: ${signal.detail}`);
  }
  for (const violation of report.artifactAudit.violations.slice(0, 6)) {
    lines.push(`  - artifact: ${violation.path} (${violation.reason})`);
  }
  return lines.join("\n");
}

function main() {
  let args;
  try {
    args = parseArgs();
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exit(1);
  }
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  let report;
  try {
    report = buildPiRuntimeHealthReport(args.cwd);
  } catch (error) {
    console.error(`pi-runtime-health: failed: ${String(error?.message ?? error)}`);
    process.exit(1);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatPiRuntimeHealthReport(report));
  }

  if (args.strict && report.decision !== "continue") {
    process.exit(1);
  }
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main();
}
