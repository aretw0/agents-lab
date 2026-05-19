#!/usr/bin/env node

/**
 * context-preload-pack
 *
 * Wrapper de laboratório/CI para a primitiva distribuída em pi-stack.
 */

import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  formatContextPreloadPackReport,
  runContextPreloadPack,
} from "../packages/pi-stack/extensions/context-watchdog-preload-pack.mjs";

function parseArgs(argv) {
  const out = {
    days: 1,
    limit: 8,
    top: 16,
    workspace: process.cwd(),
    json: false,
    write: false,
    out: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days") {
      out.days = Number(argv[i + 1] ?? out.days);
      i++;
      continue;
    }
    if (a === "--limit") {
      out.limit = Number(argv[i + 1] ?? out.limit);
      i++;
      continue;
    }
    if (a === "--top") {
      out.top = Number(argv[i + 1] ?? out.top);
      i++;
      continue;
    }
    if (a === "--workspace") {
      out.workspace = argv[i + 1] ?? out.workspace;
      i++;
      continue;
    }
    if (a === "--out") {
      out.out = argv[i + 1] ?? out.out;
      i++;
      continue;
    }
    if (a === "--json") {
      out.json = true;
      continue;
    }
    if (a === "--write") {
      out.write = true;
      continue;
    }
  }

  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = runContextPreloadPack(args);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatContextPreloadPackReport(report));
  if (report.written) {
    console.log(`\nwritten: ${report.outPath.replace(/\\/g, "/")}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
