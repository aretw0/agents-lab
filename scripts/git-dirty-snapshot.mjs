#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function parsePorcelainLine(line) {
  const text = String(line ?? "");
  if (!text || text.length < 3) return undefined;
  const x = text[0];
  const y = text[1];
  if (text[2] !== " ") return undefined;
  const body = text.slice(3).trim();
  if (!body) return undefined;

  if (x === "?" && y === "?") {
    return { x, y, kind: "untracked", path: body };
  }

  if (body.includes(" -> ")) {
    const [from, to] = body.split(" -> ");
    if (from && to) {
      return { x, y, kind: "renamed", from: from.trim(), path: to.trim() };
    }
  }

  let kind = "modified";
  if (x === "D" || y === "D") kind = "deleted";
  else if (x === "A") kind = "added";
  else if (x === "R" || y === "R") kind = "renamed";

  return { x, y, kind, path: body };
}

export function buildGitDirtySnapshotFromPorcelain(stdout) {
  const lines = String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const rows = lines
    .map(parsePorcelainLine)
    .filter((entry) => Boolean(entry));

  const counts = {
    tracked: rows.filter((row) => row.kind !== "untracked").length,
    untracked: rows.filter((row) => row.kind === "untracked").length,
    renamed: rows.filter((row) => row.kind === "renamed").length,
    deleted: rows.filter((row) => row.kind === "deleted").length,
  };

  return {
    mode: "git-dirty-snapshot",
    cwd: process.cwd(),
    clean: rows.length === 0,
    rows,
    counts,
    summary: `git-dirty-snapshot: clean=${rows.length === 0 ? "yes" : "no"} rows=${rows.length} tracked=${counts.tracked} untracked=${counts.untracked}`,
  };
}

export function runGitDirtySnapshot(cwd = process.cwd()) {
  const run = spawnSync(
    "git",
    ["-c", "core.safecrlf=false", "status", "--porcelain"],
    {
      cwd,
      encoding: "utf8",
    },
  );

  if (run.status !== 0) {
    const error = (run.stderr || run.stdout || "git status --porcelain failed").trim();
    throw new Error(error);
  }

  const snapshot = buildGitDirtySnapshotFromPorcelain(run.stdout);
  snapshot.cwd = path.resolve(cwd);
  return snapshot;
}

function parseArgs(argv) {
  const out = { cwd: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd") {
      out.cwd = argv[i + 1] ?? out.cwd;
      i++;
      continue;
    }
    if (arg === "--json") {
      out.json = true;
      continue;
    }
  }
  return out;
}

function printHuman(snapshot) {
  const lines = [snapshot.summary];
  for (const row of snapshot.rows) {
    const status = `${row.x}${row.y}`;
    if (row.from) lines.push(`- [${status}] ${row.from} -> ${row.path}`);
    else lines.push(`- [${status}] ${row.path}`);
  }
  return lines.join("\n");
}

function isMain() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return path.resolve(argv1) === path.resolve(fileURLToPath(import.meta.url));
}

if (isMain()) {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = runGitDirtySnapshot(args.cwd);
  if (args.json) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else {
    console.log(printHuman(snapshot));
  }
}
