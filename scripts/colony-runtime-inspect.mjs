#!/usr/bin/env node

/**
 * Inspect ant-colony runtime storage for the current workspace.
 *
 * Usage:
 *   node scripts/colony-runtime-inspect.mjs
 *   node scripts/colony-runtime-inspect.mjs --id colony-xxxx
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const idArg = args.includes("--id") ? args[args.indexOf("--id") + 1] : undefined;

const agentRoot = path.join(homedir(), ".pi", "agent", "ant-colony");
const cwd = path.resolve(process.cwd());

function toMirrorCandidates(absPath) {
  const normalized = absPath.replace(/\\/g, "/");
  const m = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (m) {
    const drive = m[1].toLowerCase();
    const rest = m[2];
    return [
      path.join(agentRoot, drive, rest),
      path.join(agentRoot, "root", drive, rest),
    ];
  }

  const unix = normalized.startsWith("/") ? normalized.slice(1) : normalized;
  return [
    path.join(agentRoot, unix),
    path.join(agentRoot, "root", unix),
  ];
}

function findWorkspaceRoots() {
  const candidates = toMirrorCandidates(cwd);
  return candidates.filter((p) => existsSync(p));
}

function listColonyStates(workspaceRoot) {
  const coloniesDir = path.join(workspaceRoot, "colonies");
  if (!existsSync(coloniesDir)) return [];

  const out = [];
  for (const dirent of readdirSync(coloniesDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const statePath = path.join(coloniesDir, dirent.name, "state.json");
    if (!existsSync(statePath)) continue;

    try {
      const json = JSON.parse(readFileSync(statePath, "utf8"));
      const st = statSync(statePath);
      out.push({
        id: json.id ?? dirent.name,
        status: json.status ?? "unknown",
        goal: json.goal ?? "",
        statePath,
        updatedAt: st.mtimeMs,
        workspace: json.workspace,
      });
    } catch {
      // ignore malformed state files
    }
  }

  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

function listWorktrees(workspaceRoot) {
  const wtDir = path.join(workspaceRoot, "worktrees");
  if (!existsSync(wtDir)) return [];

  const out = [];
  for (const dirent of readdirSync(wtDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const full = path.join(wtDir, dirent.name);
    const gitDir = path.join(full, ".git");
    if (!existsSync(gitDir)) continue;

    out.push({
      name: dirent.name,
      path: full,
      updatedAt: statSync(full).mtimeMs,
    });
  }

  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

function fmtDate(ms) {
  return new Date(ms).toISOString();
}

if (!existsSync(agentRoot)) {
  console.log(`No ant-colony storage found at: ${agentRoot}`);
  process.exit(0);
}

const roots = findWorkspaceRoots();
if (roots.length === 0) {
  console.log("No workspace mirror found for current cwd in ant-colony storage.");
  console.log(`cwd: ${cwd}`);
  console.log(`searched under: ${agentRoot}`);
  process.exit(0);
}

for (const root of roots) {
  console.log(`\nWorkspace mirror: ${root}`);

  let colonies = listColonyStates(root);
  if (idArg) {
    colonies = colonies.filter((c) => String(c.id).includes(idArg));
  }

  console.log("\nColonies:");
  if (colonies.length === 0) {
    console.log("  (none)");
  } else {
    for (const c of colonies.slice(0, 12)) {
      console.log(`  - ${c.id} [${c.status}] ${fmtDate(c.updatedAt)}`);
      console.log(`    state: ${c.statePath}`);
      if (c.goal) console.log(`    goal: ${String(c.goal).slice(0, 120)}`);
    }
  }

  const worktrees = listWorktrees(root);
  console.log("\nWorktrees:");
  if (worktrees.length === 0) {
    console.log("  (none)");
  } else {
    for (const w of worktrees.slice(0, 12)) {
      console.log(`  - ${w.name} ${fmtDate(w.updatedAt)}`);
      console.log(`    path: ${w.path}`);
    }
  }
}
