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

import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MAX_COMPLEXITY_LINES,
  buildRepoComplexityReport,
  formatBytes,
  scanFiles,
} from "../packages/pi-stack/extensions/stack-quality-audit.mjs";

export { buildRepoComplexityReport, scanFiles };

function parseArgs(argv) {
  const out = {
    maxLines: DEFAULT_MAX_COMPLEXITY_LINES,
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

  const report = buildRepoComplexityReport(process.cwd(), opts);
  const findings = report.findings;
  const blockingFindings = report.blockingFindings;
  const allowedFindings = report.allowedFindings;
  const scope = opts.changed ? "arquivo alterado" : "arquivo";
  const pluralScope = opts.changed ? "arquivo(s) alterado(s)" : "arquivo(s)";

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (findings.length === 0) {
    console.log(`complexity-check: OK (nenhum ${scope} > ${opts.maxLines} linhas)`);
  } else if (blockingFindings.length === 0) {
    console.log(`complexity-check: OK (${allowedFindings.length} ${pluralScope} grande(s) em exceção conhecida; nenhum bloqueante > ${opts.maxLines} linhas)`);
    for (const f of allowedFindings.slice(0, 40)) {
      const lines = f.lines == null ? "n/a" : String(f.lines);
      console.log(`  - ${f.file} | lines=${lines} | size=${formatBytes(f.size)} | ${f.note}`);
    }
  } else {
    console.log(`complexity-check: ${blockingFindings.length} ${pluralScope} bloqueante(s) acima de ${opts.maxLines} linhas (${allowedFindings.length} exceção(ões) conhecida(s))`);
    for (const f of findings.slice(0, 40)) {
      const lines = f.lines == null ? "n/a" : String(f.lines);
      console.log(`  - ${f.file} | lines=${lines} | size=${formatBytes(f.size)} | ${f.note}`);
    }
    if (findings.length > 40) {
      console.log(`  ... (+${findings.length - 40} adicionais)`);
    }
  }

  if (opts.strict && blockingFindings.length > 0) {
    process.exit(2);
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  main();
}
