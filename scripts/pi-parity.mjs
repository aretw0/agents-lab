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
  --strict              Exit 1 on parity drift (missing official or non-permitted items)
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

function buildCurationRemediation({ missing, optIn, nonPermittedPackages, nonPermittedSources }) {
  const actions = [];
  if (missing.length > 0) {
    actions.push({
      decision: "curar",
      reason: "Pacotes oficiais ausentes na baseline selecionada.",
      items: missing,
      commandHint: "npx @aretw0/pi-stack --profile curated-default --local",
    });
  }
  if (optIn.length > 0) {
    actions.push({
      decision: "mover-para-opt-in",
      reason: "Pacotes managed fora da baseline oficial (opt-in explícito).",
      items: optIn,
      commandHint: "manter fora do default e habilitar só via --stack-full/--profile stack-full",
    });
  }
  if (nonPermittedPackages.length > 0 || nonPermittedSources.length > 0) {
    actions.push({
      decision: "remover-do-default-ou-curar",
      reason: "Itens não permitidos na baseline oficial detectados.",
      items: [...nonPermittedPackages, ...nonPermittedSources.map((s) => `source:${s}`)],
      commandHint: "remover de .pi/settings.json ou promover via curadoria explícita (package-list/install/docs)",
    });
  }
  return actions;
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

  const classification = {
    official: {
      present,
      missing,
    },
    optIn: {
      managed: extraManaged,
    },
    nonPermitted: {
      packages: extraOther,
      sources: unresolvedSources.filter((src) => typeof src === "string" && src.trim().length > 0),
    },
  };

  const remediation = buildCurationRemediation({
    missing,
    optIn: extraManaged,
    nonPermittedPackages: classification.nonPermitted.packages,
    nonPermittedSources: classification.nonPermitted.sources,
  });

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
    classification,
    remediation,
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

  if (result.classification.official.missing.length > 0) {
    console.log("official (missing):");
    for (const name of result.classification.official.missing) console.log(`  - ${name}`);
  }

  if (result.classification.optIn.managed.length > 0) {
    console.log("opt-in (managed outside official baseline):");
    for (const name of result.classification.optIn.managed) console.log(`  - ${name}`);
  }

  if (result.classification.nonPermitted.packages.length > 0) {
    console.log("non-permitted packages:");
    for (const name of result.classification.nonPermitted.packages) console.log(`  - ${name}`);
  }

  if (result.classification.nonPermitted.sources.length > 0) {
    console.log("non-permitted unresolved sources:");
    for (const src of result.classification.nonPermitted.sources) console.log(`  - ${src}`);
  }

  console.log("visibility surfaces:");
  for (const line of surfaceSummary(result.surfaces)) console.log(line);

  if (result.remediation.length > 0) {
    console.log("curation remediation:");
    for (const action of result.remediation) {
      console.log(`  - [${action.decision}] ${action.reason}`);
      if (Array.isArray(action.items)) {
        for (const item of action.items) console.log(`      • ${item}`);
      }
      if (action.commandHint) console.log(`      hint: ${action.commandHint}`);
    }
  }

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

  const strictEnabled = opts.strict || process.argv.includes("--strict");
  if (strictEnabled) {
    const hasMissingOfficial = results.some((r) => r.classification.official.missing.length > 0);
    const hasNonPermitted = results.some(
      (r) => r.classification.nonPermitted.packages.length > 0 || r.classification.nonPermitted.sources.length > 0,
    );
    const shouldBlock = hasMissingOfficial || hasNonPermitted;
    process.exit(shouldBlock ? 1 : 0);
  }
}

main();
