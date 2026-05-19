#!/usr/bin/env node

/**
 * repo discourse audit — report overloaded language before it becomes policy.
 *
 * This is advisory by default. It keeps semantic cleanup visible without
 * rewriting historical research or blocking useful local slices prematurely.
 */

import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  buildRepoDiscourseReport,
  classifyDiscourseText,
} from "../packages/pi-stack/extensions/stack-quality-audit.mjs";

export { buildRepoDiscourseReport, classifyDiscourseText };

function parseArgs(argv) {
  const out = { json: false, strict: false, help: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--json") out.json = true;
    else if (arg === "--strict") out.strict = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function printHelp() {
  console.log([
    "repo discourse audit",
    "",
    "Usage:",
    "  pnpm run repo:discourse:audit",
    "  node scripts/repo-discourse-audit.mjs --json",
    "",
    "Options:",
    "  --strict   exit 1 on error-severity findings",
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

  const report = buildRepoDiscourseReport(process.cwd());
  const errors = report.findings.filter((finding) => finding.severity === "error");

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("repo discourse audit");
    console.log(`scanned files: ${report.scannedCount}`);
    console.log(`findings: ${report.findingCount}`);
    for (const [rule, count] of Object.entries(report.byRule)) {
      console.log(`- ${rule}: ${count}`);
    }
    if (report.topFiles.length > 0) {
      console.log("top files:");
      for (const row of report.topFiles) {
        console.log(`- ${row.path}: ${row.count}`);
      }
    }
    for (const finding of report.findings.slice(0, 25)) {
      console.log(`${finding.path}:${finding.line} [${finding.rule}] ${finding.excerpt}`);
    }
    if (report.findings.length > 25) {
      console.log(`... (+${report.findings.length - 25} more)`);
    }
  }

  if (opts.strict && errors.length > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
