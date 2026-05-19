#!/usr/bin/env node

/**
 * pi runtime artifact audit — detect tracked ephemeral runtime files.
 *
 * Policy:
 * - default deny for .pi/* and .sandbox/*
 * - allow only curated canonical config in .pi:
 *   - .pi/settings.json
 *   - .pi/agents/*.yaml
 */

import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  buildRemediationCommands,
  classifyTrackedFiles,
  isAllowlistedPiPath,
  normalizeTrackedPath,
  runRuntimeArtifactAudit,
} from "../packages/pi-stack/extensions/runtime-artifact-audit.mjs";

export {
  buildRemediationCommands,
  classifyTrackedFiles,
  isAllowlistedPiPath,
  normalizeTrackedPath,
  runRuntimeArtifactAudit,
};

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    strict: false,
    json: false,
    help: false,
  };

  for (const a of args) {
    if (a === "--strict") out.strict = true;
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }

  return out;
}

function printHelp() {
  console.log([
    "pi runtime artifact audit",
    "",
    "Usage:",
    "  pnpm run pi:artifact:audit",
    "  pnpm run pi:artifact:audit:strict",
    "  node scripts/pi-runtime-artifact-audit.mjs --json",
    "",
    "Options:",
    "  --strict   exit 1 when violations exist",
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
    report = runRuntimeArtifactAudit(process.cwd());
  } catch (error) {
    console.error(`pi-runtime-artifact-audit: failed to scan git tracked files: ${String(error?.message ?? error)}`);
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("pi runtime artifact audit");
    console.log(`tracked files: ${report.trackedCount}`);
    if (report.violations.length === 0) {
      console.log("status: clean ✅ (nenhum artefato efêmero rastreado)");
    } else {
      console.log(`status: violation ❌ count=${report.violations.length}`);
      for (const v of report.violations) {
        console.log(`- ${v.path} (${v.reason})`);
      }
      console.log("remediation:");
      for (const cmd of report.remediation) console.log(`  ${cmd}`);
    }
  }

  if (opts.strict && report.violations.length > 0) {
    process.exit(1);
  }
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main();
}
