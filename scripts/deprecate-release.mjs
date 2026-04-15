#!/usr/bin/env node

import { execSync } from "node:child_process";
import process from "node:process";

const PACKAGES = [
  "@aretw0/pi-stack",
  "@aretw0/git-skills",
  "@aretw0/web-skills",
  "@aretw0/pi-skills",
  "@aretw0/lab-skills",
];

function parseArgs(argv) {
  const out = {
    version: "",
    message: "broken release; do not use this version. Use latest stable.",
    yes: false,
  };

  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--version" || a === "-v") out.version = (args[++i] ?? "").trim();
    else if (a === "--message" || a === "-m") out.message = (args[++i] ?? "").trim();
    else if (a === "--yes") out.yes = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/deprecate-release.mjs --version <X.Y.Z> [options]

Options:
  -v, --version <X.Y.Z>   Version to deprecate (required)
  -m, --message <text>    Deprecation message
      --yes               Execute (without this flag, dry-run only)

Examples:
  npm run release:deprecate -- --version 0.3.10 --yes
  npm run release:deprecate -- --version 0.3.10 --message "broken CI release" --yes
`);
      process.exit(0);
    }
  }

  return out;
}

function run(cmd, { capture = false } = {}) {
  if (capture) {
    return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString("utf8").trim();
  }
  execSync(cmd, { stdio: "inherit" });
  return "";
}

function checkAuth() {
  try {
    const user = run("npm whoami", { capture: true });
    return { ok: true, user };
  } catch {
    return { ok: false, user: "" };
  }
}

function versionExists(pkg, version) {
  try {
    const out = run(`npm view ${pkg}@${version} version --prefer-online`, { capture: true });
    return out.trim() === version;
  } catch {
    return false;
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.version) {
    console.error("[release:deprecate] missing required --version <X.Y.Z>");
    process.exit(2);
  }

  const auth = checkAuth();
  if (!auth.ok) {
    console.error("[release:deprecate] npm auth required. Run: npm login");
    process.exit(2);
  }

  console.log(`[release:deprecate] authenticated as ${auth.user}`);
  console.log(`[release:deprecate] target version: ${args.version}`);
  console.log(`[release:deprecate] message: ${args.message}`);

  const existing = PACKAGES.filter((pkg) => versionExists(pkg, args.version));
  const missing = PACKAGES.filter((pkg) => !existing.includes(pkg));

  if (existing.length === 0) {
    console.error("[release:deprecate] target version not found in any package");
    process.exit(1);
  }

  if (missing.length > 0) {
    console.warn("[release:deprecate] version missing in some packages:");
    for (const pkg of missing) console.warn(`  - ${pkg}@${args.version}`);
  }

  console.log("[release:deprecate] packages to deprecate:");
  for (const pkg of existing) console.log(`  - ${pkg}@${args.version}`);

  if (!args.yes) {
    console.log("[release:deprecate] dry-run only. Re-run with --yes to execute.");
    process.exit(0);
  }

  for (const pkg of existing) {
    const cmd = `npm deprecate ${pkg}@${args.version} \"${args.message.replaceAll('"', '\\"')}\"`;
    run(cmd);
  }

  console.log("[release:deprecate] done");
}

main();
