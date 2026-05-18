#!/usr/bin/env node

/**
 * repo bloat audit — keep raw research artifacts out of git.
 *
 * Policy:
 * - derived research summaries/results can be versioned;
 * - raw logs and large raw datasets stay local or move to external artifacts;
 * - canonical board files may be large, but are audited by board-specific tools.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_THRESHOLDS = {
  largeResearchDataBytes: 1024 * 1024,
  localRawLogBytes: 1024 * 1024,
};

export function normalizeRepoPath(input) {
  return String(input ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function isResearchDataPath(filePath) {
  return normalizeRepoPath(filePath).startsWith("docs/research/data/");
}

function isRawLogPath(filePath) {
  const p = normalizeRepoPath(filePath);
  return isResearchDataPath(p) && (p.includes("/raw/") || p.endsWith(".log"));
}

export function classifyTrackedBloat(files, thresholds = DEFAULT_THRESHOLDS) {
  const rows = Array.isArray(files) ? files : [];
  const violations = [];
  const warnings = [];

  for (const row of rows) {
    const filePath = normalizeRepoPath(typeof row === "string" ? row : row?.path);
    const bytes = Number(typeof row === "string" ? 0 : row?.bytes ?? 0);
    if (!filePath) continue;

    if (isRawLogPath(filePath)) {
      violations.push({ path: filePath, reason: "tracked-raw-research-log", bytes });
      continue;
    }

    if (isResearchDataPath(filePath) && bytes >= thresholds.largeResearchDataBytes) {
      violations.push({ path: filePath, reason: "tracked-large-research-data", bytes });
      continue;
    }

    if (filePath.startsWith(".project/") && bytes >= 1024 * 1024) {
      warnings.push({ path: filePath, reason: "large-canonical-board-file", bytes });
    }
  }

  return { scannedCount: rows.length, violations, warnings };
}

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
    "  npm run repo:bloat:audit",
    "  npm run repo:bloat:audit:strict",
    "  node scripts/repo-bloat-audit.mjs --json",
    "",
    "Options:",
    "  --strict   exit 1 when tracked bloat violations exist",
    "  --json     machine-readable output",
    "  -h, --help",
  ].join("\n"));
}

function listTrackedFiles(cwd) {
  const out = execFileSync("git", ["ls-files"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function trackedRows(cwd) {
  return listTrackedFiles(cwd).map((filePath) => {
    const fullPath = path.join(cwd, filePath);
    let bytes = 0;
    try {
      bytes = statSync(fullPath).size;
    } catch {
      bytes = 0;
    }
    return { path: filePath, bytes };
  });
}

function walkFiles(rootDir) {
  if (!existsSync(rootDir)) return [];
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile()) out.push(fullPath);
    }
  }
  return out;
}

function localRawLogAdvisories(cwd, trackedSet, thresholds = DEFAULT_THRESHOLDS) {
  const root = path.join(cwd, "docs", "research", "data");
  return walkFiles(root)
    .map((fullPath) => {
      const rel = normalizeRepoPath(path.relative(cwd, fullPath));
      if (!isRawLogPath(rel) || trackedSet.has(rel)) return undefined;
      const bytes = statSync(fullPath).size;
      if (bytes < thresholds.localRawLogBytes) return undefined;
      return { path: rel, reason: "local-ignored-raw-log", bytes };
    })
    .filter(Boolean)
    .sort((a, b) => b.bytes - a.bytes);
}

export function buildRepoBloatReport(cwd = process.cwd(), thresholds = DEFAULT_THRESHOLDS) {
  const rows = trackedRows(cwd);
  const trackedSet = new Set(rows.map((row) => normalizeRepoPath(row.path)));
  const classified = classifyTrackedBloat(rows, thresholds);
  return {
    cwd,
    trackedCount: rows.length,
    ...classified,
    localAdvisories: localRawLogAdvisories(cwd, trackedSet, thresholds),
  };
}

function formatBytes(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(2)}MB`;
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
      console.log("local ignored raw logs:");
      for (const row of report.localAdvisories.slice(0, 10)) {
        console.log(`- ${row.path} (${formatBytes(row.bytes)})`);
      }
    }
  }

  if (opts.strict && report.violations.length > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
