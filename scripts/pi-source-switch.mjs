#!/usr/bin/env node

/**
 * pi source switcher — toggle between local workspace packages and published npm packages.
 *
 * Inspired by oh-pi's pi-source-switch.mts.
 *
 * Usage:
 *   node scripts/pi-source-switch.mjs local     # point pi to local workspace paths
 *   node scripts/pi-source-switch.mjs published  # point pi to npm packages
 *   node scripts/pi-source-switch.mjs status     # show current sources
 *
 * Shortcuts (from package.json):
 *   npm run pi:local
 *   npm run pi:published
 *   npm run pi:status
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const IS_WINDOWS = process.platform === "win32";

/**
 * All packages managed by pi-stack.
 * Map of package name → workspace directory (relative to repo root).
 */
const WORKSPACE_PACKAGES = new Map();

// Auto-discover workspace packages
const packagesDir = path.join(REPO_ROOT, "packages");
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkgJsonPath = path.join(packagesDir, entry.name, "package.json");
  if (!existsSync(pkgJsonPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  if (pkg.name && pkg.keywords?.includes("pi-package")) {
    WORKSPACE_PACKAGES.set(pkg.name, path.join(packagesDir, entry.name));
  }
}

// Skill filter overrides — applied when switching to local mode
// These exclude third-party skills that conflict with our first-party equivalents.
const SKILL_FILTERS = {
  "@aretw0/pi-stack": [
    // No node_modules paths in new pi-stack — nothing to filter
  ],
};

function parseArgs(argv) {
  const mode = argv[2];
  if (!mode || mode === "--help" || mode === "-h") {
    printHelp();
    process.exit(mode ? 0 : 1);
  }
  if (!["local", "published", "status"].includes(mode)) {
    console.error(`Unknown mode: ${mode}. Use: local, published, status`);
    process.exit(1);
  }
  const piLocal = argv.includes("--pi-local") || argv.includes("-l");
  const dryRun = argv.includes("--dry-run");
  return { mode, piLocal, dryRun };
}

function printHelp() {
  console.log(`
pi source switcher — toggle between local workspace and npm packages

Usage:
  npm run pi:local             Point pi to local workspace paths
  npm run pi:published         Point pi to npm packages
  npm run pi:status            Show current source configuration

Options:
  -l, --pi-local    Write to project .pi/settings.json instead of user settings
  --dry-run         Show changes without writing

Managed workspace packages:
${[...WORKSPACE_PACKAGES.entries()].map(([name, dir]) => `  ${name} → ${path.relative(REPO_ROOT, dir)}`).join("\n")}
`.trim());
}

function getSettingsPath(piLocal) {
  if (piLocal) {
    return path.join(process.cwd(), ".pi", "settings.json");
  }
  const agentDir =
    process.env.PI_CODING_AGENT_DIR ?? path.join(homedir(), ".pi", "agent");
  return path.join(agentDir, "settings.json");
}

function loadSettings(settingsPath) {
  if (!existsSync(settingsPath)) return {};
  return JSON.parse(readFileSync(settingsPath, "utf8"));
}

function getSource(entry) {
  return typeof entry === "string" ? entry : entry?.source;
}

function resolvePackageName(source) {
  if (!source) return undefined;
  // npm:@scope/name@version → @scope/name
  if (source.startsWith("npm:")) {
    const spec = source.slice(4);
    if (spec.startsWith("@")) {
      const slashIdx = spec.indexOf("/");
      if (slashIdx === -1) return undefined;
      const atIdx = spec.indexOf("@", slashIdx + 1);
      return atIdx === -1 ? spec : spec.slice(0, atIdx);
    }
    const atIdx = spec.indexOf("@");
    return atIdx === -1 ? spec : spec.slice(0, atIdx);
  }
  // Local path — read package.json
  if (
    source.startsWith("/") ||
    source.startsWith("./") ||
    source.startsWith("../") ||
    /^[A-Z]:\\/.test(source)
  ) {
    const settingsDir = path.dirname(getSettingsPath(false));
    const resolved = path.resolve(settingsDir, source);
    const pkgPath = path.join(resolved, "package.json");
    if (existsSync(pkgPath)) {
      try {
        return JSON.parse(readFileSync(pkgPath, "utf8")).name;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function buildLocalSources() {
  const sources = new Map();
  for (const [name, dir] of WORKSPACE_PACKAGES) {
    sources.set(name, path.resolve(dir));
  }
  return sources;
}

function buildPublishedSources() {
  const sources = new Map();
  for (const name of WORKSPACE_PACKAGES.keys()) {
    sources.set(name, `npm:${name}`);
  }
  return sources;
}

function rewritePackages(entries, desiredSources) {
  const remaining = new Set(desiredSources.keys());
  const result = [];

  for (const entry of entries) {
    const source = getSource(entry);
    const name = resolvePackageName(source);
    if (name && desiredSources.has(name)) {
      remaining.delete(name);
      const newSource = desiredSources.get(name);
      // Preserve filter config if entry is an object
      if (typeof entry === "object" && entry !== null) {
        result.push({ ...entry, source: newSource });
      } else {
        result.push(newSource);
      }
    } else {
      result.push(entry);
    }
  }

  // Add any packages not yet in settings
  for (const name of remaining) {
    result.push(desiredSources.get(name));
  }

  return result;
}

function printStatus(entries) {
  console.log("\nManaged package sources:\n");
  for (const [name] of WORKSPACE_PACKAGES) {
    const entry = entries.find((e) => {
      const src = getSource(e);
      return resolvePackageName(src) === name;
    });
    const source = entry ? getSource(entry) : "<not configured>";
    const isLocal =
      source &&
      !source.startsWith("npm:") &&
      !source.startsWith("git:") &&
      !source.startsWith("http");
    const marker = isLocal ? "🔧" : "📦";
    console.log(`  ${marker} ${name}`);
    console.log(`     ${source}`);
  }
}

const opts = parseArgs(process.argv);
const settingsPath = getSettingsPath(opts.piLocal);
const settings = loadSettings(settingsPath);
const currentEntries = Array.isArray(settings.packages) ? settings.packages : [];
const scope = opts.piLocal ? "project" : "user";

if (opts.mode === "status") {
  console.log(`\nSettings: ${settingsPath} (${scope})`);
  printStatus(currentEntries);
  process.exit(0);
}

const desiredSources =
  opts.mode === "local" ? buildLocalSources() : buildPublishedSources();
const nextEntries = rewritePackages(currentEntries, desiredSources);

console.log(`\nSwitching to ${opts.mode} mode (${scope} settings)`);
console.log(`Settings: ${settingsPath}\n`);

for (const [name] of WORKSPACE_PACKAGES) {
  const oldEntry = currentEntries.find(
    (e) => resolvePackageName(getSource(e)) === name
  );
  const oldSource = oldEntry ? getSource(oldEntry) : "<missing>";
  const newSource = desiredSources.get(name);
  const changed = oldSource !== newSource;
  console.log(`  ${name}`);
  console.log(`    ${oldSource}`);
  console.log(`    → ${newSource} ${changed ? "⬅" : "(no change)"}`);
}

if (opts.dryRun) {
  console.log("\nDry run — no changes written.");
  process.exit(0);
}

const nextSettings = { ...settings, packages: nextEntries };
mkdirSync(path.dirname(settingsPath), { recursive: true });
writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2) + "\n");
console.log(`\n✅ Settings written. Restart pi to reload packages.`);
