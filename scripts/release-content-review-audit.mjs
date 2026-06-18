#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const DEFAULT_CONTENT_REVIEW_PATH = "docs/research/0-8-release-content-review-2026-06-18.md";

const REQUIRED_MARKERS = [
  "## Package Promise",
  "## Installed Surface",
  "## Dogfood Evidence",
  "## Public Docs",
  "## Installer Profiles",
  "## Non-Claims",
  "## Operator Decision",
];

function readIfExists(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function parseDecision(text) {
  const match = String(text ?? "").match(/^Decision:\s*(pass|hold|blocked)\s*$/im);
  return match?.[1] ?? "missing";
}

export function buildReleaseContentReviewAudit(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const target = options.target ?? "0.8.0";
  const relPath = options.reviewPath ?? DEFAULT_CONTENT_REVIEW_PATH;
  const fullPath = path.join(cwd, relPath);
  const text = readIfExists(fullPath);
  const blockers = [];
  if (!text) {
    blockers.push({ code: "release-content-review-missing", path: relPath, severity: "blocker" });
  }
  const missingMarkers = text ? REQUIRED_MARKERS.filter((marker) => !text.includes(marker)) : REQUIRED_MARKERS;
  for (const marker of missingMarkers) {
    blockers.push({ code: "release-content-review-missing-section", path: relPath, marker, severity: "blocker" });
  }
  const decision = parseDecision(text);
  if (decision !== "pass") {
    blockers.push({ code: "release-content-review-not-approved", path: relPath, decision, severity: "blocker" });
  }
  const ok = blockers.length === 0;
  return {
    mode: "release-content-review-audit",
    schemaVersion: 1,
    target,
    path: relPath,
    decision: ok ? "pass" : "blocked",
    reviewDecision: decision,
    blockers,
    summary: ok
      ? "release-content-review: decision=pass"
      : "release-content-review: decision=blocked blockers=" + blockers.length + " reviewDecision=" + decision,
  };
}

export function formatReleaseContentReviewAudit(report) {
  const lines = [report.summary, "- path: " + report.path];
  for (const blocker of report.blockers.slice(0, 12)) {
    lines.push("  - blocker: " + blocker.code + (blocker.marker ? " " + blocker.marker : "") + (blocker.decision ? " decision=" + blocker.decision : ""));
  }
  return lines.join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const out = { json: false, strict: false, target: "0.8.0" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") out.json = true;
    else if (arg === "--strict") out.strict = true;
    else if (arg === "--target") out.target = argv[++i] ?? out.target;
    else throw new Error("Unknown argument: " + arg);
  }
  return out;
}

function main() {
  const args = parseArgs();
  const report = buildReleaseContentReviewAudit({ target: args.target });
  console.log(args.json ? JSON.stringify(report, null, 2) : formatReleaseContentReviewAudit(report));
  if (args.strict && report.decision !== "pass") process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
