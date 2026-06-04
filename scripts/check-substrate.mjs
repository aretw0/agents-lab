#!/usr/bin/env node
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const json = process.argv.includes("--json");
const isWindows = process.platform === "win32";

const checks = [];
const recommendations = [];

function rel(...parts) {
  return path.join(root, ...parts);
}

function bin(name) {
  return isWindows ? `${name}.cmd` : name;
}

async function exists(filePath, mode = constants.F_OK) {
  try {
    await access(filePath, mode);
    return true;
  } catch {
    return false;
  }
}

async function addPathCheck(id, label, filePath, { executable = false, required = true } = {}) {
  const ok = await exists(filePath, executable && !isWindows ? constants.X_OK : constants.F_OK);
  checks.push({ id, label, ok, required, path: path.relative(root, filePath) || "." });
  return ok;
}

function addCommandCheck(id, command, args = ["--version"], { required = true } = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", shell: isWindows });
  const ok = result.status === 0;
  checks.push({
    id,
    label: `${command} ${args.join(" ")}`,
    ok,
    required,
    command: [command, ...args].join(" "),
    stderr: ok ? undefined : (result.stderr || result.stdout || "").trim().slice(0, 240)
  });
  return ok;
}

await addPathCheck("node_modules", "workspace dependencies", rel("node_modules"));
await addPathCheck("node_modules_bin", "workspace executable shims", rel("node_modules", ".bin"));
await addPathCheck("bin_vitest", "vitest executable shim", rel("node_modules", ".bin", bin("vitest")), { executable: true });
await addPathCheck("bin_pi", "pi executable shim", rel("node_modules", ".bin", bin("pi")), { executable: true });
await addPathCheck("bin_changeset", "changeset executable shim", rel("node_modules", ".bin", bin("changeset")), { executable: true });
await addPathCheck(
  "pi_stack_package_link",
  "pi-stack internal package link",
  rel("packages", "pi-stack", "node_modules", "@ifi", "oh-pi-extensions", "package.json")
);

addCommandCheck("node", "node", ["--version"]);
addCommandCheck("pnpm", "pnpm", ["--version"]);

const missing = checks.filter((check) => check.required && !check.ok);

if (missing.some((check) => check.id.startsWith("node_modules") || check.id.startsWith("bin_") || check.id === "pi_stack_package_link")) {
  recommendations.push("Run: pnpm install --frozen-lockfile --prefer-offline --config.confirm-modules-purge=false");
}
if (missing.some((check) => check.id === "pnpm")) {
  recommendations.push("Run: corepack prepare --activate");
}
if (missing.length > 0) {
  recommendations.push("If this is inside the devcontainer, rebuild/reopen it so the container-owned node_modules volume is used.");
}

const result = {
  ok: missing.length === 0,
  project: "agents-lab",
  command: "substrate:check",
  checks,
  missing: missing.map((check) => check.id),
  recommendations,
  nextCommand: missing.length > 0 ? recommendations[0] ?? null : null,
  nextCommands: missing.length > 0 ? recommendations : []
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log("agents-lab substrate ok");
} else {
  console.error("agents-lab substrate drift detected:");
  for (const check of missing) {
    console.error(`- ${check.id}: ${check.path ?? check.command}`);
  }
  for (const recommendation of recommendations) {
    console.error(`next: ${recommendation}`);
  }
}

process.exit(result.ok ? 0 : 1);
