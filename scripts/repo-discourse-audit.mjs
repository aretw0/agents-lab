#!/usr/bin/env node

/**
 * repo discourse audit — report overloaded language before it becomes policy.
 *
 * This is advisory by default. It keeps semantic cleanup visible without
 * rewriting historical research or blocking useful local slices prematurely.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const MAX_SCAN_BYTES = 1024 * 1024;

const RULES = [
  {
    id: "legacy-human-term",
    severity: "warning",
    pattern: /\b(human|humano|humana|human-in-the-loop)\b/i,
    message: "prefer canonical operator/operador terminology outside historical research",
  },
  {
    id: "aspirational-release-claim",
    severity: "warning",
    pattern: /\b(farol|maturad[ao]s?|maturidade plena|release maturada|fábrica pronta)\b/i,
    message: "mark aspirational language as roadmap unless backed by a gate or runtime evidence",
  },
  {
    id: "loaded-pragmatic-label",
    severity: "warning",
    pattern: /\bPRAGMATIC\b/,
    message: "avoid uppercase semantic labels unless they map to a documented runtime contract",
  },
];

function normalizeRepoPath(input) {
  return String(input ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function isDiscourseSurface(filePath) {
  const p = normalizeRepoPath(filePath);
  if (p.startsWith("docs/archive/")) return false;
  if (p.startsWith("docs/research/data/")) return false;
  if (p.startsWith("docs/guides/")) return true;
  if (p.startsWith("docs/primitives/")) return true;
  if (p.startsWith("docs/architecture/")) return true;
  if (/^packages\/[^/]+\/docs\/guides\//.test(p)) return false;
  if (/^packages\/[^/]+\/(skills|docs)\//.test(p)) return true;
  if (p.startsWith("packages/pi-stack/extensions/") && /\.(ts|md)$/.test(p)) return true;
  return false;
}

function shouldScanText(filePath) {
  const p = normalizeRepoPath(filePath);
  return /\.(md|mdx|txt|ts|tsx|js|mjs|json)$/.test(p);
}

export function classifyDiscourseText(filePath, text, rules = RULES) {
  const findings = [];
  const normalized = normalizeRepoPath(filePath);
  if (!isDiscourseSurface(normalized) || !shouldScanText(normalized)) return findings;

  const lines = String(text ?? "").split(/\r?\n/);
  let inCodeFence = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;
    const prose = stripMarkdownCode(line);
    for (const rule of rules) {
      if (!rule.pattern.test(prose)) continue;
      findings.push({
        path: normalized,
        line: index + 1,
        rule: rule.id,
        severity: rule.severity,
        message: rule.message,
        excerpt: line.trim().slice(0, 180),
      });
    }
  }
  return findings;
}

function stripMarkdownCode(line) {
  return String(line ?? "").replace(/`[^`]*`/g, "");
}

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
    "  npm run repo:discourse:audit",
    "  node scripts/repo-discourse-audit.mjs --json",
    "",
    "Options:",
    "  --strict   exit 1 on error-severity findings",
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

export function buildRepoDiscourseReport(cwd = process.cwd()) {
  const files = listTrackedFiles(cwd);
  const findings = [];
  let scannedCount = 0;

  for (const filePath of files) {
    const normalized = normalizeRepoPath(filePath);
    if (!isDiscourseSurface(normalized) || !shouldScanText(normalized)) continue;

    const fullPath = path.join(cwd, normalized);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_SCAN_BYTES) continue;

    scannedCount += 1;
    findings.push(...classifyDiscourseText(normalized, readFileSync(fullPath, "utf8")));
  }

  const byRule = {};
  const byFile = {};
  for (const finding of findings) {
    byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1;
    byFile[finding.path] = (byFile[finding.path] ?? 0) + 1;
  }
  const topFiles = Object.entries(byFile)
    .map(([filePath, count]) => ({ path: filePath, count }))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
    .slice(0, 12);

  return {
    cwd,
    scannedCount,
    findingCount: findings.length,
    byRule,
    topFiles,
    findings,
  };
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
