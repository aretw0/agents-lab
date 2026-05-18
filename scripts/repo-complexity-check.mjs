#!/usr/bin/env node

/**
 * repo-complexity-check
 *
 * Detecta arquivos rastreados no git com número de linhas acima de um limite.
 * Objetivo: evitar arquivos "venenosos" (>1000 linhas) sem plano de quebra.
 *
 * Uso:
 *   node scripts/repo-complexity-check.mjs
 *   node scripts/repo-complexity-check.mjs --max-lines 800 --strict
 *   node scripts/repo-complexity-check.mjs --changed --strict
 *   node scripts/repo-complexity-check.mjs --json
 */

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_MAX_LINES = 1000;
const MAX_SCAN_BYTES = 2 * 1024 * 1024; // 2MB por arquivo (defensivo)

function parseArgs(argv) {
  const out = {
    maxLines: DEFAULT_MAX_LINES,
    strict: false,
    json: false,
    changed: false,
    base: "HEAD",
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--strict") out.strict = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "--changed") out.changed = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--base") {
      const value = String(argv[++i] ?? "").trim();
      if (!value) throw new Error("--base inválido");
      out.base = value;
    }
    else if (arg === "--max-lines") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) throw new Error("--max-lines inválido");
      out.maxLines = Math.floor(n);
    } else {
      throw new Error(`Argumento desconhecido: ${arg}`);
    }
  }

  return out;
}

function printHelp() {
  console.log([
    "repo-complexity-check",
    "",
    "Uso:",
    "  node scripts/repo-complexity-check.mjs",
    "  node scripts/repo-complexity-check.mjs --max-lines 800 --strict",
    "  node scripts/repo-complexity-check.mjs --changed --strict",
    "  node scripts/repo-complexity-check.mjs --json",
  ].join("\n"));
}

function listTrackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return out.split("\u0000").filter(Boolean);
}

function splitZeroList(value) {
  return String(value ?? "").split("\u0000").filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function listChangedFiles(base) {
  const changed = splitZeroList(execFileSync("git", ["diff", "--name-only", "-z", "--diff-filter=ACMRT", base, "--"], { encoding: "utf8" }));
  const untracked = splitZeroList(execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }));
  return unique([...changed, ...untracked]);
}

function shouldSkip(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  if (
    normalized.startsWith("node_modules/") ||
    normalized.startsWith(".sandbox/") ||
    normalized.startsWith(".pi/agent/") ||
    normalized.startsWith(".pi/reports/")
  ) {
    return true;
  }

  const ext = path.extname(normalized).toLowerCase();
  const binaryExt = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".tar", ".woff", ".woff2", ".ttf", ".mp4", ".mov",
  ]);

  return binaryExt.has(ext);
}

function countLines(text) {
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length;
}

export function scanFiles(files, maxLines) {
  const findings = [];

  for (const file of files) {
    if (shouldSkip(file)) continue;

    let st;
    try {
      st = statSync(file);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (st.size > MAX_SCAN_BYTES) {
      findings.push({ file, lines: null, size: st.size, note: "skipped:too-large" });
      continue;
    }

    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const lines = countLines(text);
    if (lines > maxLines) {
      findings.push({ file, lines, size: st.size, note: "over-limit" });
    }
  }

  findings.sort((a, b) => {
    const la = a.lines ?? -1;
    const lb = b.lines ?? -1;
    return lb - la;
  });

  return findings;
}

function scan(maxLines, options = {}) {
  const files = options.changed ? listChangedFiles(options.base ?? "HEAD") : listTrackedFiles();
  return scanFiles(files, maxLines);
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (err) {
    console.error(String(err.message ?? err));
    process.exit(1);
  }

  if (opts.help) {
    printHelp();
    return;
  }

  const findings = scan(opts.maxLines, opts);
  const scope = opts.changed ? "arquivo alterado" : "arquivo";
  const pluralScope = opts.changed ? "arquivo(s) alterado(s)" : "arquivo(s)";

  if (opts.json) {
    console.log(JSON.stringify({ maxLines: opts.maxLines, changed: opts.changed, base: opts.base, total: findings.length, findings }, null, 2));
  } else if (findings.length === 0) {
    console.log(`complexity-check: OK (nenhum ${scope} > ${opts.maxLines} linhas)`);
  } else {
    console.log(`complexity-check: ${findings.length} ${pluralScope} acima de ${opts.maxLines} linhas`);
    for (const f of findings.slice(0, 40)) {
      const lines = f.lines == null ? "n/a" : String(f.lines);
      console.log(`  - ${f.file} | lines=${lines} | size=${formatBytes(f.size)} | ${f.note}`);
    }
    if (findings.length > 40) {
      console.log(`  ... (+${findings.length - 40} adicionais)`);
    }
  }

  if (opts.strict && findings.some((f) => f.note === "over-limit")) {
    process.exit(2);
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  main();
}
