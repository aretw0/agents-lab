#!/usr/bin/env node

/**
 * pi parity checker — compare configured pi packages with expected profiles.
 *
 * Why:
 * - agents-lab often runs in a lighter environment than end users.
 * - false "feature gaps" happen when third-party stack packages are missing locally.
 *
 * Profiles:
 * - stack-full: all managed packages from @aretw0/pi-stack installer (first + third-party)
 * - first-party: only @aretw0/* workspace packages
 * - curated-default: strict curated baseline for distribution defaults
 *
 * Usage:
 *   node scripts/pi-parity.mjs
 *   node scripts/pi-parity.mjs --scope user --profile stack-full --strict
 *   node scripts/pi-parity.mjs --scope project --profile first-party
 *   node scripts/pi-parity.mjs --scope both --json
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { CURATED_DEFAULT, FIRST_PARTY, PACKAGES, THIRD_PARTY } from "../packages/pi-stack/package-list.mjs";

const IS_WINDOWS = process.platform === "win32";
const DEFAULT_SCOPE = "user";
const DEFAULT_PROFILE = "stack-full";

const PROFILES = {
  "stack-full": PACKAGES,
  "first-party": FIRST_PARTY,
  "curated-default": CURATED_DEFAULT,
};

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    scope: DEFAULT_SCOPE,
    profile: DEFAULT_PROFILE,
    strict: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--strict") out.strict = true;
    else if (a === "--json") out.json = true;
    else if (a === "--scope") out.scope = String(args[++i] ?? "").trim();
    else if (a === "--profile") out.profile = String(args[++i] ?? "").trim();
    else throw new Error(`Unknown argument: ${a}`);
  }

  if (!["user", "project", "both"].includes(out.scope)) {
    throw new Error(`Invalid --scope '${out.scope}'. Use: user | project | both`);
  }

  if (!Object.prototype.hasOwnProperty.call(PROFILES, out.profile)) {
    throw new Error(`Invalid --profile '${out.profile}'. Use: ${Object.keys(PROFILES).join(" | ")}`);
  }

  return out;
}

function printHelp() {
  console.log(`
pi parity checker

Usage:
  npm run pi:parity
  node scripts/pi-parity.mjs --scope user --profile stack-full --strict
  node scripts/pi-parity.mjs --scope project --profile first-party
  node scripts/pi-parity.mjs --scope project --profile curated-default
  node scripts/pi-parity.mjs --scope both --json

Options:
  --scope <user|project|both>
  --profile <stack-full|first-party|curated-default>
  --strict              Exit 1 when expected packages are missing
  --json                Emit machine-readable JSON
  -h, --help
`.trim());
}

function getSettingsPath(scope) {
  if (scope === "project") return path.join(process.cwd(), ".pi", "settings.json");
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? path.join(homedir(), ".pi", "agent");
  return path.join(agentDir, "settings.json");
}

function loadSettings(settingsPath) {
  if (!existsSync(settingsPath)) return {};
  try {
    return JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    return {};
  }
}

function getSource(entry) {
  return typeof entry === "string" ? entry : entry?.source;
}

function parseNpmPackageName(spec) {
  if (!spec) return undefined;
  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/");
    if (slash === -1) return undefined;
    const secondAt = spec.indexOf("@", slash + 1);
    return secondAt === -1 ? spec : spec.slice(0, secondAt);
  }
  const at = spec.indexOf("@");
  return at === -1 ? spec : spec.slice(0, at);
}

function likelyPathSource(source) {
  if (!source) return false;
  if (source.startsWith("./") || source.startsWith("../") || source.startsWith("/")) return true;
  if (IS_WINDOWS && /^[A-Za-z]:[\\/]/.test(source)) return true;
  return false;
}

function resolvePackageName(source, settingsPath) {
  if (!source || typeof source !== "string") return undefined;

  if (source.startsWith("npm:")) {
    return parseNpmPackageName(source.slice(4));
  }

  if (likelyPathSource(source)) {
    const settingsDir = path.dirname(settingsPath);
    const abs = path.resolve(settingsDir, source);
    const pkgPath = path.join(abs, "package.json");
    if (!existsSync(pkgPath)) return undefined;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      return typeof pkg.name === "string" ? pkg.name : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function detectSurfaces(configuredNames) {
  const has = (name) => configuredNames.has(name);
  return {
    usageTracker: has("@ifi/oh-pi-extensions"),
    sessionBreakdown: has("mitsupi"),
    quotaVisibility: has("@aretw0/pi-stack"),
    projectBlocks: has("@davidorex/pi-project-workflows"),
    colony: has("@ifi/oh-pi-ant-colony"),
  };
}

function analyzeScope(scope, profile) {
  const settingsPath = getSettingsPath(scope);
  const settings = loadSettings(settingsPath);
  const entries = Array.isArray(settings.packages) ? settings.packages : [];

  const expected = new Set(PROFILES[profile]);
  const configuredNames = new Set();
  const unresolvedSources = [];

  for (const entry of entries) {
    const source = getSource(entry);
    const name = resolvePackageName(source, settingsPath);
    if (!name) {
      unresolvedSources.push(source);
      continue;
    }
    configuredNames.add(name);
  }

  const missing = [...expected].filter((p) => !configuredNames.has(p)).sort();
  const present = [...expected].filter((p) => configuredNames.has(p)).sort();

  const managedSet = new Set(PACKAGES);
  const configuredManaged = [...configuredNames].filter((p) => managedSet.has(p)).sort();
  const extraManaged = configuredManaged.filter((p) => !expected.has(p));
  const extraOther = [...configuredNames].filter((p) => !managedSet.has(p)).sort();

  const surfaces = detectSurfaces(configuredNames);

  return {
    scope,
    profile,
    settingsPath,
    expectedCount: expected.size,
    presentCount: present.length,
    missingCount: missing.length,
    coveragePct: expected.size > 0 ? (present.length / expected.size) * 100 : 100,
    missing,
    present,
    extraManaged,
    extraOther,
    unresolvedSources,
    surfaces,
  };
}

function surfaceSummary(surfaces) {
  const yesNo = (v) => (v ? "yes" : "no");
  return [
    `  usage tracker (/usage): ${yesNo(surfaces.usageTracker)}`,
    `  session breakdown (/session-breakdown): ${yesNo(surfaces.sessionBreakdown)}`,
    `  quota visibility (/quota-visibility): ${yesNo(surfaces.quotaVisibility)}`,
    `  project blocks (.project): ${yesNo(surfaces.projectBlocks)}`,
    `  colony runtime (/colony): ${yesNo(surfaces.colony)}`,
  ];
}

function printResult(result) {
  console.log(`\n[${result.scope}] ${result.profile}`);
  console.log(`settings: ${result.settingsPath}`);
  console.log(
    `parity: ${result.presentCount}/${result.expectedCount} (${result.coveragePct.toFixed(1)}%)` +
      (result.missingCount > 0 ? `  ⚠ missing=${result.missingCount}` : "  ✓")
  );

  if (result.missing.length > 0) {
    console.log("missing managed packages:");
    for (const name of result.missing) console.log(`  - ${name}`);
  }

  if (result.extraManaged.length > 0) {
    console.log("extra managed packages (outside selected profile):");
    for (const name of result.extraManaged) console.log(`  - ${name}`);
  }

  if (result.extraOther.length > 0) {
    console.log("other configured packages:");
    for (const name of result.extraOther) console.log(`  - ${name}`);
  }

  if (result.unresolvedSources.length > 0) {
    console.log("unresolved package sources (name could not be inferred):");
    for (const src of result.unresolvedSources) console.log(`  - ${src}`);
  }

  console.log("visibility surfaces:");
  for (const line of surfaceSummary(result.surfaces)) console.log(line);

  if (!result.surfaces.usageTracker || !result.surfaces.sessionBreakdown) {
    console.log("hint: user-like cost visibility usually expects both @ifi/oh-pi-extensions and mitsupi.");
  }
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
    process.exit(0);
  }

  const scopes = opts.scope === "both" ? ["user", "project"] : [opts.scope];
  const results = scopes.map((scope) => analyzeScope(scope, opts.profile));

  if (opts.json) {
    console.log(JSON.stringify({ results }, null, 2));
  } else {
    console.log("pi parity report");
    for (const r of results) printResult(r);
  }

  if (opts.strict) {
    const hasMissing = results.some((r) => r.missingCount > 0);
    process.exit(hasMissing ? 1 : 0);
  }
}

main();
