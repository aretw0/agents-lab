#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_ROOTS = [
  "README.md",
  "ROADMAP.md",
  "CONTRIBUTING.md",
  "docs",
  "packages",
];

const IGNORED_DIRS = new Set([
  ".git",
  ".sass-cache",
  ".sandbox",
  ".tmp",
  "node_modules",
]);

const VALID_DIAGRAM_TYPES = new Set([
  "architecture-beta",
  "block-beta",
  "c4context",
  "classdiagram",
  "erdiagram",
  "flowchart",
  "gantt",
  "gitgraph",
  "graph",
  "journey",
  "mindmap",
  "packet-beta",
  "pie",
  "quadrantchart",
  "requirementdiagram",
  "sequencediagram",
  "statediagram",
  "statediagram-v2",
  "timeline",
  "xychart-beta",
]);

const ASCII_ID = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

export function extractMermaidBlocks(text) {
  const blocks = [];
  const re = /^```mermaid\s*\n([\s\S]*?)\n```/gm;
  let match;
  while ((match = re.exec(text)) !== null) {
    const before = text.slice(0, match.index);
    const line = before.split(/\r?\n/).length;
    blocks.push({ body: match[1], line });
  }
  return blocks;
}

function hasNonAsciiId(token) {
  return /[^\x00-\x7F]/.test(token) && !ASCII_ID.test(token);
}

function nonCommentLines(lines) {
  return lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("%%");
  });
}

function checkFlowLine(line, lineNumber, issues) {
  const trimmed = line.trim();
  if (
    !trimmed
    || trimmed.startsWith("%%")
    || trimmed.startsWith("classDef")
    || trimmed.startsWith("class ")
    || trimmed.startsWith("direction")
    || trimmed.startsWith("end")
    || trimmed.startsWith("linkStyle")
    || trimmed.startsWith("style ")
    || trimmed.startsWith("subgraph")
  ) {
    return;
  }

  const nodeRe = /\b([a-zA-Z_À-ɏ][a-zA-Z0-9_\-À-ɏ]*)(?=\s*[\[({]|\s*-->|\s*---|\s*--\s)/g;
  for (const match of trimmed.matchAll(nodeRe)) {
    const candidate = match[1];
    if (hasNonAsciiId(candidate)) {
      issues.push({
        line: lineNumber,
        message: `non-ASCII node id "${candidate}"; use an ASCII id with an explicit label`,
      });
    }
  }

  if (/\w+\((?!")([^)]*\/[^)]*)\)/.test(trimmed)) {
    issues.push({
      line: lineNumber,
      message: "unquoted flowchart label contains '/'; quote the label",
    });
  }

  if (/\b\w+\((?!["'\[])([^)"']*[\uD800-\uDFFF])/.test(trimmed)) {
    issues.push({
      line: lineNumber,
      message: "unquoted flowchart label contains supplementary Unicode; quote the label",
    });
  }
}

function checkStateLine(line, lineNumber, issues) {
  const trimmed = line.trim();
  if (
    !trimmed
    || trimmed.startsWith("%%")
    || trimmed.startsWith("note")
    || trimmed.startsWith("state \"")
    || trimmed.startsWith("[*]")
  ) {
    return;
  }

  const left = trimmed.match(/^([^\s\-\[{%:]+)\s*-->/);
  if (left && hasNonAsciiId(left[1])) {
    issues.push({
      line: lineNumber,
      message: `non-ASCII state id "${left[1]}"; use state "Label" as asciiId`,
    });
  }

  const right = trimmed.match(/-->\s*([^\s:{[]+)/);
  if (right && right[1] !== "[*]" && hasNonAsciiId(right[1])) {
    issues.push({
      line: lineNumber,
      message: `non-ASCII state id "${right[1]}"; use state "Label" as asciiId`,
    });
  }
}

export function checkMermaidBlock(body, options = {}) {
  const maxLines = Number.isFinite(options.maxLines) ? options.maxLines : null;
  const issues = [];
  const lines = body.split(/\r?\n/);
  const firstLine = lines[0]?.trim() ?? "";
  const diagramType = firstLine.split(/\s+/)[0].toLowerCase();

  if (!VALID_DIAGRAM_TYPES.has(diagramType)) {
    issues.push({
      line: 1,
      message: `unknown Mermaid diagram type "${diagramType || "(empty)"}"`,
    });
  }

  const meaningfulLines = nonCommentLines(lines);
  if (maxLines !== null && meaningfulLines.length > maxLines) {
    issues.push({
      line: 1,
      message: `diagram has ${meaningfulLines.length} non-comment lines; split it before ${maxLines}`,
    });
  }

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/--\s*"[^"]*\[\[[^\]]*\]\][^"]*"\s*-->/.test(line) || /\|\s*\[\[[^\]]*\]\]\s*\|/.test(line)) {
      issues.push({
        line: index + 1,
        message: "edge label contains wikilink syntax; use plain text label",
      });
    }
  }

  if (diagramType === "flowchart" || diagramType === "graph") {
    lines.forEach((line, index) => checkFlowLine(line, index + 1, issues));
  }

  if (diagramType === "statediagram" || diagramType === "statediagram-v2") {
    lines.forEach((line, index) => checkStateLine(line, index + 1, issues));
  }

  return issues;
}

function collectFiles(root, roots) {
  const files = [];
  function visit(target) {
    const fullPath = path.resolve(root, target);
    if (!existsSync(fullPath)) return;
    const relative = path.relative(root, fullPath);
    const name = path.basename(fullPath);
    if (IGNORED_DIRS.has(name)) return;

    const entries = readdirSync(fullPath, { withFileTypes: true });
    for (const entry of entries) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        visit(child);
      } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".mermaid"))) {
        files.push(child);
      }
    }
  }

  for (const entry of roots) {
    const fullPath = path.resolve(root, entry);
    if (!existsSync(fullPath)) continue;
    try {
      const maybeDir = readdirSync(fullPath, { withFileTypes: true });
      if (maybeDir) visit(entry);
    } catch {
      if (entry.endsWith(".md") || entry.endsWith(".mermaid")) files.push(entry);
    }
  }

  return [...new Set(files)].sort();
}

export function buildMermaidCheckReport(root, options = {}) {
  const roots = options.roots ?? DEFAULT_ROOTS;
  const files = collectFiles(root, roots);
  const findings = [];
  let blockCount = 0;
  const byType = {};

  for (const file of files) {
    const fullPath = path.join(root, file);
    const text = readFileSync(fullPath, "utf8");
    const blocks = file.endsWith(".mermaid")
      ? [{ body: text, line: 1 }]
      : extractMermaidBlocks(text);

    for (const [index, block] of blocks.entries()) {
      blockCount += 1;
      const type = block.body.trim().split(/\s+/)[0]?.toLowerCase() || "(empty)";
      byType[type] = (byType[type] ?? 0) + 1;
      for (const issue of checkMermaidBlock(block.body, options)) {
        findings.push({
          file,
          block: index + 1,
          line: block.line + issue.line - 1,
          message: issue.message,
        });
      }
    }
  }

  return {
    scannedFiles: files.length,
    blockCount,
    findingCount: findings.length,
    byType,
    findings,
  };
}

function parseArgs(argv) {
  const out = { json: false, roots: [], maxLines: null };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") out.json = true;
    else if (arg === "--root") out.roots.push(argv[++index] ?? "");
    else if (arg === "--max-lines") out.maxLines = Number(argv[++index] ?? "80");
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function printHelp() {
  console.log([
    "mermaid check",
    "",
    "Usage:",
    "  pnpm run mermaid:check",
    "  node scripts/mermaid-check.mjs --json",
    "",
    "Options:",
    "  --root <path>       limit scan root, repeatable",
    "  --max-lines <n>     optional local policy for maximum non-comment lines per diagram",
    "  --json              machine-readable output",
    "  -h, --help",
  ].join("\n"));
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exit(1);
  }
  if (args.help) {
    printHelp();
    return;
  }

  const report = buildMermaidCheckReport(process.cwd(), {
    roots: args.roots.length > 0 ? args.roots : DEFAULT_ROOTS,
    maxLines: args.maxLines,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("mermaid check");
    console.log(`scanned files: ${report.scannedFiles}`);
    console.log(`diagrams: ${report.blockCount}`);
    console.log(`findings: ${report.findingCount}`);
    for (const [type, count] of Object.entries(report.byType).sort()) {
      console.log(`- ${type}: ${count}`);
    }
    for (const finding of report.findings) {
      console.log(`${finding.file}:${finding.line} [block ${finding.block}] ${finding.message}`);
    }
  }

  if (report.findings.length > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
