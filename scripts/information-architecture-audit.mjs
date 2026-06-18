#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const REQUIRED_ENTRYPOINTS = [
  "docs/index.md",
  "docs/start-here.md",
  "docs/site-map.md",
  "docs/guides/README.md",
  "docs/primitives/README.md",
  "docs/research/README.md",
];

const REQUIRED_SITE_MAP_LINKS = [
  "/start-here.html",
  "/guides/recommended-pi-stack.html",
  "/guides/information-architecture-curation.html",
  "/architecture/",
  "/primitives/",
  "/research/0-8-readiness-map.html",
];

const UNFEATURED_RETAINED = {
  guides: [
    "agent-driver-charter.md",
    "ci-runner-adapter-spec.md",
    "colony-self-use.md",
    "monitor-curation-master-plan.md",
    "openai-context-window-playbook.md",
    "opt-in-lean-profile-inventory.md",
  ],
  primitives: [
    "provider-candidate-evaluation-template.md",
    "stale-read-guard-incidents.md",
    "state-reconciliation-modes.md",
    "symphony-pattern-matrix.md",
  ],
};

function parseArgs(argv = process.argv.slice(2)) {
  const out = { cwd: process.cwd(), json: false, strict: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--cwd") out.cwd = argv[++i] ?? out.cwd;
    else if (arg === "--json") out.json = true;
    else if (arg === "--strict") out.strict = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function printHelp() {
  console.log([
    "information architecture audit",
    "",
    "Usage:",
    "  pnpm run docs:ia:audit",
    "  pnpm run docs:ia:audit:json",
    "  node scripts/information-architecture-audit.mjs --strict",
    "",
    "Options:",
    "  --cwd <path>  repository root to inspect",
    "  --json        machine-readable output",
    "  --strict      exit 1 on blockers",
    "  -h, --help",
  ].join("\n"));
}

function readIfExists(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function normalizeRepoPath(input) {
  return String(input ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function listMarkdownFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
}

function extractMentionedMarkdown(indexText) {
  const mentioned = new Set();
  const source = String(indexText ?? "");
  for (const match of source.matchAll(/\[([^\]]*)\]\(([^)]*)\)/g)) {
    const label = match[1] ?? "";
    const href = match[2] ?? "";
    if (href.includes("site.repo_url") || /^https?:/.test(href)) continue;
    for (const fileMatch of `${label} ${href}`.matchAll(/\b([A-Za-z0-9._-]+\.md)\b/g)) {
      const file = fileMatch[1];
      if (/[A-Z]/.test(file)) continue;
      mentioned.add(file);
    }
  }
  return mentioned;
}

export function computeIndexCoverage(files, indexText, options = {}) {
  const ignored = new Set([...(options.ignored ?? ["README.md"]), ...(options.retained ?? [])]);
  const mentioned = extractMentionedMarkdown(indexText);
  const expected = files.filter((file) => !ignored.has(file)).sort();
  const indexed = expected.filter((file) => mentioned.has(file)).sort();
  const unindexed = expected.filter((file) => !mentioned.has(file)).sort();
  const staleMentions = [...mentioned]
    .filter((file) => !files.includes(file) && !ignored.has(file))
    .sort();
  return {
    expectedCount: expected.length,
    indexedCount: indexed.length,
    unindexedCount: unindexed.length,
    staleMentionCount: staleMentions.length,
    indexed,
    unindexed,
    staleMentions,
  };
}

function buildEntryPointFindings(cwd) {
  const blockers = [];
  for (const rel of REQUIRED_ENTRYPOINTS) {
    if (!existsSync(path.join(cwd, rel))) {
      blockers.push({ code: "missing-entrypoint", path: rel, severity: "blocker" });
    }
  }
  return blockers;
}

function buildSiteMapFindings(cwd) {
  const siteMap = readIfExists(path.join(cwd, "docs/site-map.md"));
  const warnings = [];
  for (const route of REQUIRED_SITE_MAP_LINKS) {
    if (!siteMap.includes(route)) {
      warnings.push({ code: "site-map-missing-route", route, severity: "warning" });
    }
  }
  return warnings;
}

function selectedEvidenceRows(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => /Evid[êe]ncia selecionada|Promovido como evid[êe]ncia selecionada|Selected Evidence/i.test(line));
}

function buildSelectedEvidenceFindings(cwd) {
  const guidesIndex = readIfExists(path.join(cwd, "docs/guides/README.md"));
  const researchIndex = readIfExists(path.join(cwd, "docs/research/README.md"));
  const siteMap = readIfExists(path.join(cwd, "docs/site-map.md"));
  const rows = selectedEvidenceRows(guidesIndex);
  const warnings = [];
  for (const row of rows) {
    const match = row.match(/\/research\/([^'.]+)\.html/);
    if (!match) continue;
    const base = match[1];
    if (!researchIndex.includes(`${base}.md`)) {
      warnings.push({ code: "selected-evidence-missing-research-index", target: `${base}.md`, severity: "warning" });
    }
    if (!siteMap.includes(`/research/${base}.html`)) {
      warnings.push({ code: "selected-evidence-missing-site-map", target: `${base}.html`, severity: "warning" });
    }
  }
  return warnings;
}

function sizeWarnings(cwd) {
  const warnings = [];
  for (const rel of ["docs/guides/README.md", "docs/primitives/README.md", "docs/research/README.md", "docs/start-here.md", "docs/site-map.md"]) {
    const full = path.join(cwd, rel);
    if (!existsSync(full)) continue;
    const bytes = statSync(full).size;
    if (bytes > 96 * 1024) warnings.push({ code: "large-index-surface", path: rel, bytes, severity: "warning" });
  }
  return warnings;
}

export function buildInformationArchitectureReport(cwd = process.cwd()) {
  const root = path.resolve(cwd);
  const guideFiles = listMarkdownFiles(path.join(root, "docs/guides"));
  const primitiveFiles = listMarkdownFiles(path.join(root, "docs/primitives"));
  const researchFiles = listMarkdownFiles(path.join(root, "docs/research"));

  const guidesCoverage = computeIndexCoverage(guideFiles, readIfExists(path.join(root, "docs/guides/README.md")), {
    retained: UNFEATURED_RETAINED.guides,
  });
  const primitivesCoverage = computeIndexCoverage(primitiveFiles, readIfExists(path.join(root, "docs/primitives/README.md")), {
    retained: UNFEATURED_RETAINED.primitives,
  });
  const researchCoverage = computeIndexCoverage(researchFiles, readIfExists(path.join(root, "docs/research/README.md")), {
    ignored: ["README.md"],
  });

  const blockers = buildEntryPointFindings(root);
  const warnings = [
    ...buildSiteMapFindings(root),
    ...buildSelectedEvidenceFindings(root),
    ...sizeWarnings(root),
  ];

  if (guidesCoverage.staleMentionCount > 0) {
    warnings.push({ code: "guides-index-stale-mentions", severity: "warning", count: guidesCoverage.staleMentionCount });
  }
  if (primitivesCoverage.staleMentionCount > 0) {
    warnings.push({ code: "primitives-index-stale-mentions", severity: "warning", count: primitivesCoverage.staleMentionCount });
  }

  const decision = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "advisory" : "pass";
  return {
    mode: "information-architecture-audit",
    schemaVersion: 1,
    generatedAtIso: new Date().toISOString(),
    cwd: normalizeRepoPath(root),
    decision,
    blockers,
    warnings,
    coverage: {
      guides: guidesCoverage,
      primitives: primitivesCoverage,
      research: researchCoverage,
    },
    retainedUnfeatured: UNFEATURED_RETAINED,
    summary: `information-architecture-audit: decision=${decision} blockers=${blockers.length} warnings=${warnings.length} guides=${guidesCoverage.indexedCount}/${guidesCoverage.expectedCount} primitives=${primitivesCoverage.indexedCount}/${primitivesCoverage.expectedCount} research=${researchCoverage.indexedCount}/${researchCoverage.expectedCount}`,
  };
}

export function formatInformationArchitectureReport(report) {
  const lines = [
    report.summary,
    `- blockers: ${report.blockers.length}`,
    `- warnings: ${report.warnings.length}`,
    `- guides indexed: ${report.coverage.guides.indexedCount}/${report.coverage.guides.expectedCount}`,
    `- primitives indexed: ${report.coverage.primitives.indexedCount}/${report.coverage.primitives.expectedCount}`,
    `- research indexed: ${report.coverage.research.indexedCount}/${report.coverage.research.expectedCount}`,
  ];
  for (const warning of report.warnings.slice(0, 12)) {
    lines.push(`  - warning: ${warning.code}${warning.path ? ` ${warning.path}` : ""}${warning.target ? ` ${warning.target}` : ""}${warning.route ? ` ${warning.route}` : ""}${warning.count ? ` count=${warning.count}` : ""}`);
  }
  for (const blocker of report.blockers.slice(0, 12)) {
    lines.push(`  - blocker: ${blocker.code}${blocker.path ? ` ${blocker.path}` : ""}`);
  }
  const unindexedGuides = report.coverage.guides.unindexed.slice(0, 8);
  if (unindexedGuides.length > 0) lines.push(`  - unindexed guides sample: ${unindexedGuides.join(", ")}`);
  const unindexedPrimitives = report.coverage.primitives.unindexed.slice(0, 8);
  if (unindexedPrimitives.length > 0) lines.push(`  - unindexed primitives sample: ${unindexedPrimitives.join(", ")}`);
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
  const report = buildInformationArchitectureReport(args.cwd);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatInformationArchitectureReport(report));
  if (args.strict && report.blockers.length > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
