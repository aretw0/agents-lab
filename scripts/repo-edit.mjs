#!/usr/bin/env node

/**
 * repo-edit
 *
 * Small, deterministic text edits for repo automation and agent handoffs.
 *
 * Usage:
 *   node scripts/repo-edit.mjs replace --file README.md --old-file /tmp/old.txt --new-file /tmp/new.txt
 *   node scripts/repo-edit.mjs insert-before --file README.md --anchor-file /tmp/anchor.txt --insert-file /tmp/insert.txt --check
 *   node scripts/repo-edit.mjs insert-after --file README.md --anchor-file /tmp/anchor.txt --insert-file /tmp/insert.txt
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const COMMANDS = new Set(["replace", "insert-before", "insert-after"]);

export function parseArgs(argv) {
  const firstArg = argv[2] === "--" ? 3 : 2;
  const command = argv[firstArg];
  if (!command || command === "--help" || command === "-h") {
    return { help: true };
  }
  if (!COMMANDS.has(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  const opts = {
    command,
    root: process.cwd(),
    check: false,
  };

  for (let i = firstArg + 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") {
      opts.check = true;
    } else if (arg === "--root") {
      opts.root = requireValue(argv, ++i, "--root");
    } else if (arg === "--file") {
      opts.file = requireValue(argv, ++i, "--file");
    } else if (arg === "--old-file") {
      opts.oldFile = requireValue(argv, ++i, "--old-file");
    } else if (arg === "--new-file") {
      opts.newFile = requireValue(argv, ++i, "--new-file");
    } else if (arg === "--anchor-file") {
      opts.anchorFile = requireValue(argv, ++i, "--anchor-file");
    } else if (arg === "--insert-file") {
      opts.insertFile = requireValue(argv, ++i, "--insert-file");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return opts;
}

export function runRepoEdit(options) {
  if (options.help) {
    return { help: true };
  }

  const root = resolveRoot(options.root);
  const file = resolveInsideRoot(root, requireOption(options.file, "--file"));
  const original = readTextFile(file, "target file");

  let next;
  let matchCount;

  if (options.command === "replace") {
    const oldText = readTextFile(resolveReadablePath(root, requireOption(options.oldFile, "--old-file")), "--old-file");
    const newText = readTextFile(resolveReadablePath(root, requireOption(options.newFile, "--new-file")), "--new-file");
    matchCount = countMatches(original, oldText);
    requireSingleMatch(matchCount, "--old-file");
    next = original.replace(oldText, newText);
  } else {
    const anchor = readTextFile(resolveReadablePath(root, requireOption(options.anchorFile, "--anchor-file")), "--anchor-file");
    const insert = readTextFile(resolveReadablePath(root, requireOption(options.insertFile, "--insert-file")), "--insert-file");
    matchCount = countMatches(original, anchor);
    requireSingleMatch(matchCount, "--anchor-file");
    next = options.command === "insert-before"
      ? original.replace(anchor, `${insert}${anchor}`)
      : original.replace(anchor, `${anchor}${insert}`);
  }

  const changed = next !== original;
  if (changed && !options.check) {
    fs.writeFileSync(file, next, "utf8");
  }

  return {
    command: options.command,
    file: path.relative(root, file).replace(/\\/g, "/"),
    changed,
    check: Boolean(options.check),
    matchCount,
  };
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function requireOption(value, flag) {
  if (!value) {
    throw new Error(`${flag} is required`);
  }
  return value;
}

function resolveRoot(value) {
  const root = path.resolve(value);
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) {
    throw new Error(`--root is not a directory: ${value}`);
  }
  return root;
}

function resolveInsideRoot(root, value) {
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Target file must be inside --root: ${value}`);
  }
  return resolved;
}

function resolveReadablePath(root, value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
}

function readTextFile(file, label) {
  const buffer = fs.readFileSync(file);
  if (buffer.includes(0)) {
    throw new Error(`${label} must be a text file: ${file}`);
  }
  return buffer.toString("utf8");
}

function countMatches(text, needle) {
  if (needle.length === 0) {
    throw new Error("Match text cannot be empty");
  }
  let count = 0;
  let index = 0;
  while (true) {
    const found = text.indexOf(needle, index);
    if (found === -1) return count;
    count += 1;
    index = found + needle.length;
  }
}

function requireSingleMatch(matchCount, flag) {
  if (matchCount === 0) {
    throw new Error(`${flag} did not match target file`);
  }
  if (matchCount > 1) {
    throw new Error(`${flag} matched target file ${matchCount} times`);
  }
}

function printHelp() {
  console.log([
    "repo-edit",
    "",
    "Usage:",
    "  node scripts/repo-edit.mjs replace --file <path> --old-file <path> --new-file <path> [--check]",
    "  node scripts/repo-edit.mjs insert-before --file <path> --anchor-file <path> --insert-file <path> [--check]",
    "  node scripts/repo-edit.mjs insert-after --file <path> --anchor-file <path> --insert-file <path> [--check]",
    "",
    "Notes:",
    "  --file must stay inside --root, which defaults to the current working directory.",
    "  Match text must appear exactly once.",
    "  --check reports without writing.",
  ].join("\n"));
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
    if (opts.help) {
      printHelp();
      return;
    }

    const result = runRepoEdit(opts);
    console.log(`repo-edit: ${result.command} file=${result.file} changed=${result.changed ? "yes" : "no"} check=${result.check ? "yes" : "no"}`);
  } catch (err) {
    console.error(String(err.message ?? err));
    process.exit(1);
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  main();
}
