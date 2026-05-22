#!/usr/bin/env node

/**
 * repo bloat audit — keep raw research artifacts out of git.
 *
 * Policy:
 * - derived research summaries/results can be versioned;
 * - raw logs and large raw datasets stay local or move to external artifacts;
 * - canonical board files may be large, but are audited by board-specific tools.
 */

import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  buildRepoBloatReport,
  classifyTrackedBloat,
  formatBytes,
  normalizeRepoPath,
  summarizeLocalBloatAdvisories,
} from "../packages/pi-stack/extensions/stack-quality-audit.mjs";

export { buildRepoBloatReport, classifyTrackedBloat, normalizeRepoPath };
export { summarizeLocalBloatAdvisories as summarizeLocalAdvisories };

function parseArgs(argv) {
  const out = { strict: false, json: false, help: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--strict") out.strict = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function printHelp() {
  console.log([
    "repo bloat audit",
    "",
    "Usage:",
    "  pnpm run repo:bloat:audit",
    "  pnpm run repo:bloat:audit:strict",
    "  node scripts/repo-bloat-audit.mjs --json",
    "",
    "Options:",
    "  --strict   exit 1 when tracked bloat violations exist",
    "  --json     machine-readable output",
    "  -h, --help",
  ].join("\n"));
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exit(1);
  }
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  let report;
  try {
    report = buildRepoBloatReport(process.cwd());
  } catch (error) {
    console.error(`repo-bloat-audit: failed to scan repository: ${String(error?.message ?? error)}`);
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("repo bloat audit");
    console.log(`tracked files: ${report.trackedCount}`);
    console.log(`violations: ${report.violations.length}`);
    for (const row of report.violations) {
      console.log(`- ${row.path} (${row.reason}, ${formatBytes(row.bytes)})`);
    }
    if (report.warnings.length > 0) {
      console.log("warnings:");
      for (const row of report.warnings) {
        console.log(`- ${row.path} (${row.reason}, ${formatBytes(row.bytes)})`);
      }
    }
    if (report.localAdvisories.length > 0) {
      const localSummary = report.localAdvisorySummary ?? summarizeLocalBloatAdvisories(report.localAdvisories);
      console.log(`local ignored raw logs: ${localSummary.count} files, ${formatBytes(localSummary.bytes)} total`);
      for (const row of report.localAdvisories.slice(0, 10)) {
        console.log(`- ${row.path} (${formatBytes(row.bytes)})`);
      }
      console.log("local ignored raw logs are advisory only; strict mode fails only on tracked bloat violations.");
    }
  }

  if (opts.strict && report.violations.length > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
