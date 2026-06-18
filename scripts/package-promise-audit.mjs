#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const PACKAGE_DIRS = [
  "packages/git-skills",
  "packages/web-skills",
  "packages/pi-skills",
  "packages/lab-skills",
  "packages/pi-stack",
];

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function readIfExists(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function normalizePackagePath(value) {
  return String(value ?? "").replaceAll("\\", "/");
}

function basenameWithoutExt(value) {
  const base = path.basename(normalizePackagePath(value));
  return base.replace(/\.[cm]?[tj]sx?$/i, "");
}

function listSubdirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function listFilesWithoutExt(dir, pattern) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => entry.name.replace(/.[^.]+$/, ""))
    .sort();
}

function manifestEntries(packageDir, manifestKey) {
  const pkg = readJson(path.join(packageDir, "package.json"));
  const entries = pkg.pi?.[manifestKey];
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const entry of entries) {
    const normalized = normalizePackagePath(entry);
    if (normalized === "./skills") out.push(...listSubdirs(path.join(packageDir, "skills")));
    else if (normalized === "./prompts") out.push(...listFilesWithoutExt(path.join(packageDir, "prompts"), /.md$/i));
    else if (normalized === "./themes") out.push(...listFilesWithoutExt(path.join(packageDir, "themes"), /.json$/i));
    else out.push(basenameWithoutExt(normalized));
  }
  return [...new Set(out)].sort();
}

function readmeMentions(readme, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^A-Za-z0-9_-])" + escaped + "([^A-Za-z0-9_-]|$)").test(readme);
}

export function buildPackagePromiseAudit(cwd = process.cwd()) {
  const root = path.resolve(cwd);
  const packages = PACKAGE_DIRS.map((relDir) => {
    const packageDir = path.join(root, relDir);
    const packageJson = readJson(path.join(packageDir, "package.json"));
    const readmePath = path.join(packageDir, "README.md");
    const readme = readIfExists(readmePath);
    const surfaces = {
      skills: manifestEntries(packageDir, "skills"),
      prompts: manifestEntries(packageDir, "prompts"),
      extensions: manifestEntries(packageDir, "extensions"),
      themes: manifestEntries(packageDir, "themes"),
    };
    const missing = [];
    for (const [kind, names] of Object.entries(surfaces)) {
      for (const name of names) {
        if (!readmeMentions(readme, name)) missing.push({ kind, name });
      }
    }
    return {
      packageName: packageJson.name,
      packageDir: relDir,
      readme: relDir + "/README.md",
      surfaceCounts: Object.fromEntries(Object.entries(surfaces).map(([kind, names]) => [kind, names.length])),
      missing,
      decision: missing.length === 0 ? "pass" : "blocked",
    };
  });
  const blockers = packages.flatMap((pkg) => pkg.missing.map((item) => ({
    code: "readme-missing-shipped-surface",
    packageName: pkg.packageName,
    readme: pkg.readme,
    kind: item.kind,
    name: item.name,
    severity: "blocker",
  })));
  const decision = blockers.length === 0 ? "pass" : "blocked";
  return {
    mode: "package-promise-audit",
    schemaVersion: 1,
    generatedAtIso: new Date().toISOString(),
    decision,
    blockers,
    packages,
    summary: "package-promise-audit: decision=" + decision + " blockers=" + blockers.length,
  };
}

export function formatPackagePromiseAudit(report) {
  const lines = [report.summary];
  for (const pkg of report.packages) {
    lines.push("- " + pkg.packageName + ": " + pkg.decision + " skills=" + pkg.surfaceCounts.skills + " prompts=" + pkg.surfaceCounts.prompts + " extensions=" + pkg.surfaceCounts.extensions + " themes=" + pkg.surfaceCounts.themes + " missing=" + pkg.missing.length);
    for (const item of pkg.missing.slice(0, 8)) {
      lines.push("  - missing " + item.kind + ": " + item.name);
    }
  }
  return lines.join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const out = { json: false, strict: false, help: false };
  for (const arg of argv) {
    if (arg === "--json") out.json = true;
    else if (arg === "--strict") out.strict = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error("Unknown argument: " + arg);
  }
  return out;
}

function main() {
  const args = parseArgs();
  if (args.help) {
    console.log("Usage: node scripts/package-promise-audit.mjs [--json] [--strict]");
    process.exit(0);
  }
  const report = buildPackagePromiseAudit();
  console.log(args.json ? JSON.stringify(report, null, 2) : formatPackagePromiseAudit(report));
  if (args.strict && report.decision !== "pass") process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
