#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import process from "node:process";
import { FIRST_PARTY, THIRD_PARTY, PACKAGES } from "../packages/pi-stack/package-list.mjs";

function parseArgs(argv) {
  const out = {
    registry: "packages/pi-stack/extensions/data/capability-owners.json",
    settings: ".pi/settings.json",
    out: "docs/architecture/stack-sovereignty-audit-latest.md",
    strict: process.env.CI ? true : false,
  };

  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--registry") out.registry = args[++i] ?? out.registry;
    else if (a === "--settings") out.settings = args[++i] ?? out.settings;
    else if (a === "--out") out.out = args[++i] ?? out.out;
    else if (a === "--strict") out.strict = true;
    else if (a === "--no-strict") out.strict = false;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/stack-sovereignty-audit.mjs [options]

Options:
  --registry <path>   Capability registry JSON (default: ${out.registry})
  --settings <path>   settings.json to inspect installed packages (default: ${out.settings})
  --out <path>        Markdown report output path (default: ${out.out})
  --strict            Exit non-zero on blockers
  --no-strict         Never fail process
`);
      process.exit(0);
    }
  }

  out.registry = resolve(out.registry);
  out.settings = resolve(out.settings);
  out.out = resolve(out.out);
  return out;
}

function readJson(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function normalizeFromLocalPath(entry) {
  const normalized = String(entry).replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/packages/pi-stack")) return "@aretw0/pi-stack";
  if (normalized.includes("/packages/web-skills")) return "@aretw0/web-skills";
  if (normalized.includes("/packages/git-skills")) return "@aretw0/git-skills";
  if (normalized.includes("/packages/pi-skills")) return "@aretw0/pi-skills";
  if (normalized.includes("/packages/lab-skills")) return "@aretw0/lab-skills";
  return undefined;
}

function normalizePackageSource(entry) {
  if (typeof entry === "string") {
    const local = normalizeFromLocalPath(entry);
    if (local) return local;
    if (entry.startsWith("npm:")) return entry.slice(4);
    return entry;
  }

  if (!entry || typeof entry !== "object") return undefined;
  const source = entry.source;
  if (typeof source !== "string") return undefined;

  const local = normalizeFromLocalPath(source);
  if (local) return local;
  if (source.startsWith("npm:")) return source.slice(4);
  return source;
}

function installedPackagesFromSettings(settings) {
  if (!settings || typeof settings !== "object" || !Array.isArray(settings.packages)) return [];
  const out = new Set();
  for (const entry of settings.packages) {
    const p = normalizePackageSource(entry);
    if (p && p.trim()) out.add(p.trim());
  }
  return [...out];
}

function riskFor(criticality, status) {
  if (status === "owner-missing") return criticality === "high" ? "high" : "medium";
  if (status === "coexisting") return criticality === "high" ? "medium" : "low";
  return "low";
}

function evaluateCapabilities(registry, installedSet) {
  const rows = [];
  for (const cap of registry.capabilities ?? []) {
    const ownerPresent = installedSet.has(cap.primaryPackage);
    const competing = (cap.conflictsWithPackages ?? []).filter((p) => installedSet.has(p));
    const secondary = (cap.secondaryPackages ?? []).filter((p) => installedSet.has(p));

    let status = "inactive";
    if (ownerPresent && competing.length > 0) status = "coexisting";
    else if (ownerPresent) status = "owned";
    else if (!ownerPresent && (competing.length > 0 || secondary.length > 0)) status = "owner-missing";

    rows.push({
      id: cap.id,
      name: cap.name,
      criticality: cap.criticality ?? "medium",
      primaryPackage: cap.primaryPackage,
      status,
      competing,
      secondary,
      action: cap.defaultAction ?? "maintain",
      risk: riskFor(cap.criticality ?? "medium", status),
    });
  }
  return rows;
}

function displayPath(filePath, cwd = process.cwd()) {
  const rel = relative(cwd, filePath).replace(/\\/g, "/");
  if (rel && !rel.startsWith("../") && rel !== "..") return rel;
  return filePath.replace(/\\/g, "/");
}

function buildReport({ registryPath, settingsPath, strict, curatedUniverse, installedPackages, rows, blockers, cwd = process.cwd() }) {
  const summary = {
    total: rows.length,
    ownerMissing: rows.filter((r) => r.status === "owner-missing").length,
    coexisting: rows.filter((r) => r.status === "coexisting").length,
    highRisk: rows.filter((r) => r.risk === "high").length,
  };

  return [
    "# Stack Sovereignty Audit (latest)",
    "",
    "Generated: deterministic-latest",
    `Registry: ${displayPath(registryPath, cwd)}`,
    `Settings: ${displayPath(settingsPath, cwd)}${existsSync(settingsPath) ? "" : " (not found, using curated package universe)"}`,
    `Mode: ${strict ? "strict" : "non-strict"}`,
    "",
    "## Summary",
    "",
    `- capabilities: ${summary.total}`,
    `- ownerMissing: ${summary.ownerMissing}`,
    `- coexisting: ${summary.coexisting}`,
    `- highRisk: ${summary.highRisk}`,
    `- curatedPackages: ${curatedUniverse.length}`,
    `- installedPackagesEvaluated: ${installedPackages.length}`,
    "",
    "## Capability matrix",
    "",
    "| Capability | Criticality | Owner | Status | Competing present | Action | Risk |",
    "|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.criticality} | ${r.primaryPackage} | ${r.status} | ${(r.competing ?? []).join(", ") || "-"} | ${r.action} | ${r.risk} |`
    ),
    "",
    "## Blockers",
    "",
    ...(blockers.length > 0 ? blockers.map((b) => `- ${b}`) : ["- none"]),
    "",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv);
  const registry = readJson(args.registry);
  if (!registry || !Array.isArray(registry.capabilities)) {
    console.error(`[stack-sovereignty-audit] invalid registry: ${args.registry}`);
    process.exit(2);
  }

  const settings = readJson(args.settings);
  const curatedUniverse = [...new Set([...FIRST_PARTY, ...THIRD_PARTY, ...PACKAGES])];

  const installedPackages = installedPackagesFromSettings(settings);
  const installedSet = new Set(installedPackages.length > 0 ? installedPackages : curatedUniverse);

  const rows = evaluateCapabilities(registry, installedSet);
  const blockers = [];

  // structural blockers
  for (const cap of registry.capabilities) {
    if (!(typeof cap.id === "string" && cap.id.trim())) blockers.push("capability missing id");
    if (!(typeof cap.primaryPackage === "string" && cap.primaryPackage.trim())) {
      blockers.push(`capability '${cap.id ?? "unknown"}' missing primaryPackage`);
      continue;
    }
    if (!curatedUniverse.includes(cap.primaryPackage)) {
      blockers.push(`capability '${cap.id}' primaryPackage not in curated package list: ${cap.primaryPackage}`);
    }
  }

  // runtime blockers
  for (const row of rows) {
    if (row.criticality === "high" && row.status === "owner-missing") {
      blockers.push(`critical capability owner missing at runtime: ${row.id}`);
    }
  }

  const report = buildReport({
    registryPath: args.registry,
    settingsPath: args.settings,
    strict: args.strict,
    curatedUniverse,
    installedPackages: [...installedSet],
    rows,
    blockers,
    cwd: process.cwd(),
  });

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${report}\n`, "utf8");
  console.log(`[stack-sovereignty-audit] report written: ${args.out}`);

  if (args.strict && blockers.length > 0) {
    console.error(`[stack-sovereignty-audit] blockers found (${blockers.length}):`);
    for (const b of blockers) console.error(`  - ${b}`);
    process.exit(1);
  }

  console.log(`[stack-sovereignty-audit] ok (blockers=${blockers.length}, strict=${args.strict})`);
}

main();
