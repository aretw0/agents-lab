#!/usr/bin/env node

/**
 * package-boundary-audit
 *
 * Guards published packages from depending on repo-local files that are not part
 * of the package tarball. Runtime/package source must stay inside its package.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx"]);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "coverage", ".turbo"]);
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
const PI_RUNTIME_PROVIDED_PACKAGES = new Set([
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "@ifi/oh-pi-extensions",
]);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function normalizeRel(value) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function listPackageRoots(cwd) {
  const packagesDir = path.join(cwd, "packages");
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDir, entry.name))
    .filter((packageRoot) => existsSync(path.join(packageRoot, "package.json")))
    .sort((a, b) => a.localeCompare(b));
}

function listSourceFiles(packageRoot) {
  const out = [];
  const visit = (dir) => {
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
  visit(packageRoot);
  return out.sort((a, b) => a.localeCompare(b));
}

function staticImportSpecifiers(source) {
  const specs = [];
  const patterns = [
    {
      pattern: /\b(import|export)\s+(type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
      typeOnlyGroup: 2,
      specifierGroup: 3,
    },
    {
      pattern: /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
      specifierGroup: 1,
    },
    {
      pattern: /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
      specifierGroup: 1,
    },
  ];
  for (const { pattern, specifierGroup, typeOnlyGroup } of patterns) {
    for (const match of source.matchAll(pattern)) {
      specs.push({
        specifier: match[specifierGroup],
        typeOnly: typeOnlyGroup ? Boolean(match[typeOnlyGroup]) : false,
      });
    }
  }
  return specs;
}

function resolveRelativeImport(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    ...[...SOURCE_EXTENSIONS].map((ext) => `${base}${ext}`),
    ...[...SOURCE_EXTENSIONS].map((ext) => path.join(base, `index${ext}`)),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? base;
}

function isInside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function manifestFileEntries(manifest) {
  return Array.isArray(manifest.files) ? manifest.files.map(String).map(normalizeRel) : [];
}

function isCoveredByFiles(relPath, files) {
  const rel = normalizeRel(relPath);
  return files.some((entry) => rel === entry || rel.startsWith(`${entry.replace(/\/$/, "")}/`));
}

function manifestRuntimeRefs(manifest) {
  const refs = [];
  if (typeof manifest.main === "string") refs.push({ field: "main", value: manifest.main });
  if (typeof manifest.module === "string") refs.push({ field: "module", value: manifest.module });
  if (typeof manifest.types === "string") refs.push({ field: "types", value: manifest.types });
  if (typeof manifest.bin === "string") refs.push({ field: "bin", value: manifest.bin });
  if (manifest.bin && typeof manifest.bin === "object") {
    for (const [name, value] of Object.entries(manifest.bin)) {
      if (typeof value === "string") refs.push({ field: `bin.${name}`, value });
    }
  }
  for (const [field, values] of [["pi.extensions", manifest.pi?.extensions], ["pi.skills", manifest.pi?.skills], ["pi.themes", manifest.pi?.themes]]) {
    if (Array.isArray(values)) {
      for (const value of values) {
        if (typeof value === "string") refs.push({ field, value });
      }
    }
  }
  return refs;
}

function dependencyNames(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
}

function packageNameFromSpecifier(specifier) {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

function auditPackage(packageRoot) {
  const manifestPath = path.join(packageRoot, "package.json");
  const manifest = readJson(manifestPath);
  const files = manifestFileEntries(manifest);
  const runtimeDependencies = dependencyNames(manifest);
  const findings = [];

  for (const ref of manifestRuntimeRefs(manifest)) {
    const rel = normalizeRel(ref.value);
    const abs = path.resolve(packageRoot, rel);
    if (!existsSync(abs)) {
      findings.push({ package: manifest.name, code: "manifest-ref-missing", field: ref.field, path: rel });
      continue;
    }
    if (files.length > 0 && !isCoveredByFiles(rel, files)) {
      findings.push({ package: manifest.name, code: "manifest-ref-not-in-files", field: ref.field, path: rel });
    }
  }

  const publishedSourceFiles = listSourceFiles(packageRoot)
    .filter((sourceFile) => files.length === 0 || isCoveredByFiles(path.relative(packageRoot, sourceFile), files));

  for (const sourceFile of publishedSourceFiles) {
    const source = readFileSync(sourceFile, "utf8");
    const relSource = normalizeRel(path.relative(packageRoot, sourceFile));
    for (const { specifier, typeOnly } of staticImportSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      const resolved = resolveRelativeImport(sourceFile, specifier);
      if (!isInside(packageRoot, resolved)) {
        findings.push({
          package: manifest.name,
          code: "package-source-imports-repo-local-file",
          source: relSource,
          specifier,
          resolved: normalizeRel(path.relative(packageRoot, resolved)),
        });
      }
    }
    for (const { specifier, typeOnly } of staticImportSpecifiers(source)) {
      if (typeOnly || specifier.startsWith(".") || NODE_BUILTINS.has(specifier)) continue;
      const packageName = packageNameFromSpecifier(specifier);
      if (PI_RUNTIME_PROVIDED_PACKAGES.has(packageName)) continue;
      if (!runtimeDependencies.has(packageName)) {
        findings.push({
          package: manifest.name,
          code: "package-source-imports-undeclared-runtime-dependency",
          source: relSource,
          specifier,
          dependency: packageName,
        });
      }
    }
  }

  return {
    name: manifest.name,
    root: normalizeRel(packageRoot),
    files,
    findings,
  };
}

export function buildPackageBoundaryAudit(cwd = process.cwd()) {
  const packageReports = listPackageRoots(cwd).map(auditPackage);
  const findings = packageReports.flatMap((report) => report.findings);
  return {
    packageCount: packageReports.length,
    blockerCount: findings.length,
    findingCount: findings.length,
    packages: packageReports,
    findings,
    blockers: findings,
  };
}

function main() {
  const strict = process.argv.includes("--strict");
  const json = process.argv.includes("--json");
  const report = buildPackageBoundaryAudit(process.cwd());

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`package-boundary-audit: packages=${report.packageCount} findings=${report.findingCount} blockers=${report.blockerCount}`);
    for (const finding of report.findings.slice(0, 80)) {
      const location = finding.source ? `${finding.source} -> ${finding.specifier}` : `${finding.field}=${finding.path}`;
      console.log(`  - ${finding.package} ${finding.code}: ${location}`);
    }
    if (report.findings.length > 80) {
      console.log(`  ... (+${report.findings.length - 80} additional findings)`);
    }
  }

  if (strict && report.blockers.length > 0) {
    process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
