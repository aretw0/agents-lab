#!/usr/bin/env node

/**
 * engine-boundary-audit
 *
 * Keeps engine-agnostic primitives separate from Pi runtime adapters. Existing
 * runtime-coupled core files are explicit so new coupling cannot drift in
 * unnoticed under a neutral "core" name.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "coverage", ".turbo"]);
const PI_RUNTIME_IMPORTS = [
  "@earendil-works/pi-coding-agent",
  "@mariozechner/pi-coding-agent",
  "@mariozechner/pi-web-ui",
];

const INTENTIONAL_RUNTIME_COUPLED_CORE = new Map([
  ["guardrails-core-auto-drain.ts", "runtime loop glue; split decision logic before sharing with another engine"],
  ["guardrails-core-autonomy-lane-runway.ts", "tool inventory currently reads Pi runtime capabilities"],
  ["guardrails-core-tool-call-guard.ts", "Pi tool-call event adapter"],
  ["guardrails-core-tool-policy.ts", "Pi built-in tool definition adapter"],
]);

function normalizeRel(value) {
  return value.replace(/\\/g, "/");
}

function listSourceFiles(root) {
  const out = [];
  const visit = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        out.push(full);
      }
    }
  };
  visit(root);
  return out.sort((a, b) => a.localeCompare(b));
}

function staticImportSpecifiers(source) {
  const specs = new Set();
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specs.add(match[1]);
    }
  }
  return [...specs];
}

function isPiRuntimeSpecifier(specifier) {
  return PI_RUNTIME_IMPORTS.some((runtimeImport) => specifier === runtimeImport || specifier.startsWith(`${runtimeImport}/`));
}

function isCorePrimitiveFile(filePath) {
  const name = path.basename(filePath);
  return name.startsWith("guardrails-core-") && !name.includes("-surface");
}

function buildFinding(cwd, filePath, specifier) {
  const name = path.basename(filePath);
  const allowedReason = INTENTIONAL_RUNTIME_COUPLED_CORE.get(name);
  return {
    severity: allowedReason ? "allowed-runtime-coupling" : "blocker",
    file: normalizeRel(path.relative(cwd, filePath)),
    specifier,
    reason: allowedReason,
  };
}

export function buildEngineBoundaryAudit(cwd = process.cwd()) {
  const extensionsRoot = path.join(cwd, "packages", "pi-stack", "extensions");
  const files = listSourceFiles(extensionsRoot);
  const corePrimitiveFiles = files.filter(isCorePrimitiveFile);
  const findings = [];

  for (const filePath of corePrimitiveFiles) {
    const source = readFileSync(filePath, "utf8");
    for (const specifier of staticImportSpecifiers(source)) {
      if (isPiRuntimeSpecifier(specifier)) {
        findings.push(buildFinding(cwd, filePath, specifier));
      }
    }
  }

  const blockers = findings.filter((finding) => finding.severity === "blocker");
  const allowedRuntimeCouplings = findings.filter((finding) => finding.severity === "allowed-runtime-coupling");
  const portableCoreCount = corePrimitiveFiles.length - new Set(allowedRuntimeCouplings.map((finding) => finding.file)).size - new Set(blockers.map((finding) => finding.file)).size;

  return {
    corePrimitiveCount: corePrimitiveFiles.length,
    portableCoreCount,
    allowedRuntimeCouplingCount: allowedRuntimeCouplings.length,
    blockerCount: blockers.length,
    findings,
    blockers,
    allowedRuntimeCouplings,
  };
}

function main() {
  const strict = process.argv.includes("--strict");
  const json = process.argv.includes("--json");
  const report = buildEngineBoundaryAudit(process.cwd());

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`engine-boundary-audit: core=${report.corePrimitiveCount} portable=${report.portableCoreCount} allowed-runtime-couplings=${report.allowedRuntimeCouplingCount} blockers=${report.blockerCount}`);
    for (const finding of report.findings.slice(0, 80)) {
      const suffix = finding.reason ? ` (${finding.reason})` : "";
      console.log(`  - ${finding.severity}: ${finding.file} imports ${finding.specifier}${suffix}`);
    }
    if (report.findings.length > 80) {
      console.log(`  ... (+${report.findings.length - 80} additional findings)`);
    }
  }

  if (strict && report.blockerCount > 0) {
    process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
