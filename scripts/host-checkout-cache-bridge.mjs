#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_MAX_ENTRIES = 24;

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const out = {
    cwd: process.cwd(),
    roots: [],
    json: false,
    maxEntries: DEFAULT_MAX_ENTRIES,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    } else if (arg === "--root") {
      const value = argv[++i];
      if (!value) throw new Error("--root requires a path");
      out.roots.push(value);
    } else if (arg === "--cwd") {
      out.cwd = argv[++i] ?? out.cwd;
    } else if (arg === "--max-entries") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 0 || value > 200) {
        throw new Error("--max-entries must be an integer between 0 and 200");
      }
      out.maxEntries = value;
    } else if (arg === "--json") {
      out.json = true;
    } else if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const envRoots = splitRootList(env.AGENTS_LAB_EXTERNAL_ROOTS ?? "");
  out.roots.push(...envRoots);
  out.roots = [...new Set(out.roots.map((root) => root.trim()).filter(Boolean))];
  return out;
}

function splitRootList(value) {
  if (!value.trim()) return [];
  return value.split(path.delimiter).map((part) => part.trim()).filter(Boolean);
}

function printHelp() {
  console.log([
    "host checkout/cache bridge discovery",
    "",
    "Usage:",
    "  pnpm run host:checkout-cache:bridge -- --root ../refarm --json",
    "  AGENTS_LAB_EXTERNAL_ROOTS=../refarm pnpm run host:checkout-cache:bridge -- --json",
    "",
    "Options:",
    "  --root <path>         approved external root to inspect (repeatable)",
    "  --cwd <path>          workspace used to resolve relative roots",
    "  --max-entries <n>     max first-level directory entries to summarize (default 24)",
    "  --json                machine-readable output",
    "  -h, --help",
    "",
    "This command is read-only and non-recursive. It summarizes only configured roots.",
  ].join("\n"));
}

function redactPath(filePath, env = process.env) {
  const normalized = filePath.replaceAll("\\", "/");
  const candidates = [env.HOME, env.USERPROFILE, os.homedir()].filter(Boolean)
    .map((item) => item.replaceAll("\\", "/"))
    .sort((a, b) => b.length - a.length);
  for (const prefix of candidates) {
    if (normalized === prefix) return "~";
    if (normalized.startsWith(`${prefix}/`)) return `~/${normalized.slice(prefix.length + 1)}`;
  }
  return normalized;
}

function safeRealpath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

function safeStat(target) {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

function safeReadDir(target, maxEntries) {
  try {
    return fs.readdirSync(target, { withFileTypes: true })
      .slice(0, maxEntries)
      .map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "symlink" : "other",
      }));
  } catch {
    return [];
  }
}

function readGitHead(root) {
  const dotGit = path.join(root, ".git");
  const stat = safeStat(dotGit);
  if (!stat) return null;

  let headPath = path.join(dotGit, "HEAD");
  if (stat.isFile()) {
    const content = readSmallText(dotGit);
    const match = content.match(/^gitdir:\s*(.+)$/m);
    if (!match) return { present: true, head: null, headRef: null, worktreeFile: true };
    const gitDir = path.resolve(root, match[1].trim());
    headPath = path.join(gitDir, "HEAD");
  }

  const head = readSmallText(headPath).trim();
  if (!head) return { present: true, head: null, headRef: null };
  const refMatch = head.match(/^ref:\s*(.+)$/);
  if (!refMatch) return { present: true, head: head.slice(0, 40), headRef: null };

  const headRef = refMatch[1];
  const refValue = readSmallText(path.join(path.dirname(headPath), headRef)).trim();
  return {
    present: true,
    head: refValue ? refValue.slice(0, 40) : null,
    headRef,
  };
}

function readSmallText(target) {
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size > 1024 * 1024) return "";
    return fs.readFileSync(target, "utf8");
  } catch {
    return "";
  }
}

function inferRootPurpose({ requestedPath, realPath, entries, git }) {
  const haystack = `${requestedPath} ${realPath ?? ""}`.toLowerCase().replaceAll("\\", "/");
  const names = new Set(entries.map((entry) => entry.name));
  const markers = [];
  if (git?.present) markers.push("git-checkout");
  if (names.has("package.json")) markers.push("node-package");
  if (names.has("pnpm-lock.yaml")) markers.push("pnpm-workspace-or-package");
  if (names.has("pyproject.toml")) markers.push("python-project");
  if (names.has("Cargo.toml")) markers.push("rust-project");
  if (haystack.includes("/.cache/") || haystack.includes("/cache/") || haystack.includes("\\.cache\\")) markers.push("cache-path");
  if (haystack.includes("checkouts") || haystack.includes("github.com")) markers.push("checkout-cache-path");
  return markers.length > 0 ? markers : ["unclassified-root"];
}

function inspectRoot(root, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const resolved = path.resolve(cwd, root);
  const stat = safeStat(resolved);
  const realPath = safeRealpath(resolved);

  if (!stat) {
    return {
      requestedPath: root,
      resolvedPath: redactPath(resolved, env),
      realPath: null,
      available: false,
      kind: "missing",
      decision: "unavailable",
      markers: [],
      entries: [],
      entryCountShown: 0,
      truncated: false,
      git: null,
      warnings: ["root-not-found"],
    };
  }

  const kind = stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other";
  const entries = kind === "directory" ? safeReadDir(resolved, maxEntries) : [];
  const git = kind === "directory" ? readGitHead(resolved) : null;
  const markers = inferRootPurpose({ requestedPath: root, realPath, entries, git });
  const allEntries = kind === "directory" ? safeReadDir(resolved, maxEntries + 1) : [];

  return {
    requestedPath: root,
    resolvedPath: redactPath(resolved, env),
    realPath: realPath ? redactPath(realPath, env) : null,
    available: true,
    kind,
    decision: "summarized-read-only",
    markers,
    entries,
    entryCountShown: entries.length,
    truncated: allEntries.length > entries.length,
    git,
    warnings: [],
  };
}

export function buildHostCheckoutCacheBridgeReport(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const roots = options.roots ?? splitRootList(env.AGENTS_LAB_EXTERNAL_ROOTS ?? "");
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const uniqueRoots = [...new Set(roots.map((root) => String(root).trim()).filter(Boolean))];

  const rootReports = uniqueRoots.map((root) => inspectRoot(root, { cwd, env, maxEntries }));
  const availableCount = rootReports.filter((root) => root.available).length;
  const missingCount = rootReports.length - availableCount;
  const decision = uniqueRoots.length === 0
    ? "no-configured-roots"
    : availableCount > 0
      ? "ready-for-read-only-evidence"
      : "configured-roots-unavailable";

  return {
    mode: "host-checkout-cache-bridge",
    schemaVersion: 1,
    generatedAtIso: new Date().toISOString(),
    cwd: redactPath(path.resolve(cwd), env),
    decision,
    authorization: "explicit-configured-roots-only",
    recursiveScan: false,
    contentScan: false,
    maxEntries,
    rootCount: uniqueRoots.length,
    availableCount,
    missingCount,
    roots: rootReports,
    summary: `host-checkout-cache-bridge: decision=${decision} roots=${uniqueRoots.length} available=${availableCount} missing=${missingCount} recursive=no contentScan=no`,
  };
}

export function formatHostCheckoutCacheBridgeReport(report) {
  const lines = [
    report.summary,
    `- authorization: ${report.authorization}`,
    `- scan: recursive=${report.recursiveScan ? "yes" : "no"} content=${report.contentScan ? "yes" : "no"}`,
    `- roots: ${report.rootCount} available=${report.availableCount} missing=${report.missingCount}`,
  ];
  for (const root of report.roots) {
    lines.push(`  - ${root.requestedPath}: ${root.decision} kind=${root.kind} markers=${root.markers.join(",") || "none"}`);
    if (root.git?.headRef || root.git?.head) {
      lines.push(`    git: ref=${root.git.headRef ?? "detached"} head=${root.git.head ?? "unknown"}`);
    }
    if (root.entries.length > 0) {
      lines.push(`    entries: ${root.entries.map((entry) => `${entry.kind}:${entry.name}`).join(", ")}${root.truncated ? ", ..." : ""}`);
    }
    for (const warning of root.warnings) lines.push(`    warning: ${warning}`);
  }
  return lines.join("\n");
}

function main() {
  let args;
  try {
    args = parseArgs();
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exit(1);
  }
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const report = buildHostCheckoutCacheBridgeReport(args);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatHostCheckoutCacheBridgeReport(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
