#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { buildReport, gather } from "./release-readiness-report.mjs";

const SCHEMA_VERSION = 1;

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    target: "0.8.0",
    tag: "",
    readinessPath: "",
    notesOutPath: "",
    outPath: "",
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--target") out.target = argv[++index] ?? out.target;
    else if (arg === "--tag") out.tag = argv[++index] ?? "";
    else if (arg === "--readiness") out.readinessPath = argv[++index] ?? "";
    else if (arg === "--notes-out") out.notesOutPath = argv[++index] ?? "";
    else if (arg === "--out") out.outPath = argv[++index] ?? "";
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function runGit(cwd, args) {
  const out = spawnSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
  return {
    ok: out.status === 0,
    stdout: String(out.stdout ?? "").trim(),
    stderr: String(out.stderr ?? "").trim(),
  };
}

function readJsonIfExists(cwd, relPath) {
  const fullPath = path.resolve(cwd, relPath);
  return existsSync(fullPath) ? JSON.parse(readFileSync(fullPath, "utf8")) : undefined;
}

function writeText(cwd, relPath, value) {
  const fullPath = path.resolve(cwd, relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, value, "utf8");
}

function writeJson(cwd, relPath, value, pretty = false) {
  writeText(cwd, relPath, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
}

function semverTags(cwd) {
  const tags = runGit(cwd, ["tag", "--sort=-v:refname"]);
  if (!tags.ok || !tags.stdout) return [];
  return tags.stdout.split(/\r?\n/).filter((tag) => /^v[0-9]+\.[0-9]+\.[0-9]+$/.test(tag));
}

function releaseChanges(cwd, previousTag) {
  const args = previousTag
    ? ["log", "--no-merges", "--pretty=- %h %s", `${previousTag}..HEAD`]
    : ["log", "--no-merges", "--pretty=- %h %s", "-n", "80"];
  const out = runGit(cwd, args);
  if (!out.ok || !out.stdout) return ["- none"];
  return out.stdout.split(/\r?\n/).filter(Boolean);
}

function buildNotes({ tag, version, targetSha, previousTag, readiness, changes }) {
  return [
    `# Release draft ${tag}`,
    "",
    `- targetTag: ${tag}`,
    `- targetVersion: ${version}`,
    `- targetSha: ${targetSha || "unknown"}`,
    `- previousTag: ${previousTag || "none"}`,
    `- readinessDecision: ${readiness.decision ?? "unknown"}`,
    "",
    "## Cut criteria",
    `- [${readiness.ready === true ? "x" : " "}] release readiness green`,
    `- [${readiness.gates?.agentRunDrivers === true ? "x" : " "}] agent-run driver gate green`,
    `- [${readiness.gates?.packageSmoke === true ? "x" : " "}] package smoke green`,
    `- [${readiness.gates?.userSurface === true ? "x" : " "}] user surface green`,
    `- [${readiness.gates?.worktreeClean === true ? "x" : " "}] worktree clean at readiness snapshot`,
    "- [ ] operator reviewed draft notes",
    "- [ ] rollback path confirmed",
    "",
    "## Changes",
    ...changes,
    "",
  ].join("\n");
}

export function buildReleaseDraftPreview(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const target = String(options.target ?? "0.8.0");
  const tag = String(options.tag || `v${target}`);
  const notesOutPath = options.notesOutPath || `.artifacts/release-draft/${tag}-notes.md`;
  const readiness = options.readiness
    ?? (options.readinessPath ? readJsonIfExists(cwd, options.readinessPath) : undefined)
    ?? buildReport(gather(target, cwd));
  const blockers = [
    ...(readiness?.ready === true ? [] : ["release-readiness-not-ready"]),
    ...(tag === `v${target}` ? [] : ["tag-target-mismatch"]),
  ];
  const tags = semverTags(cwd);
  const previousTag = tags.find((candidate) => candidate !== tag) ?? "";
  const head = runGit(cwd, ["rev-parse", "--short", "HEAD"]).stdout;
  const changes = releaseChanges(cwd, previousTag);
  const notes = buildNotes({ tag, version: target, targetSha: head, previousTag, readiness: readiness ?? {}, changes });
  const decision = blockers.length === 0 ? "ready-for-operator-review" : "blocked";
  if (decision === "ready-for-operator-review") writeText(cwd, notesOutPath, notes);
  return {
    mode: "release-draft-preview",
    schemaVersion: SCHEMA_VERSION,
    decision,
    target,
    tag,
    previousTag: previousTag || null,
    targetSha: head,
    notesOutPath,
    notesWritten: decision === "ready-for-operator-review",
    tagAllowed: false,
    publishAllowed: false,
    workflowDispatchAllowed: false,
    processStartAllowed: false,
    requiredApprovalPrompt: "approve release draft prepare-draft-release",
    readinessDecision: readiness?.decision ?? "missing",
    readinessReady: readiness?.ready === true,
    blockers,
    summary: `release-draft-preview: decision=${decision} tag=${tag} previous=${previousTag || "none"} tagAllowed=no publishAllowed=no workflowDispatchAllowed=no`,
  };
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/release-draft-preview.mjs [--target 0.8.0] [--tag v0.8.0] [--readiness PATH] [--notes-out PATH] [--out PATH] [--pretty]",
    "",
    "Builds local release draft notes for operator review. It never creates tags, publishes, or dispatches workflows.",
  ].join("\n") + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let args;
  try {
    args = parseArgs();
  } catch (error) {
    process.stderr.write(`${String(error?.message ?? error)}\n`);
    process.exit(2);
  }
  if (args.help) {
    printHelp();
  } else {
    const result = buildReleaseDraftPreview(args);
    if (args.outPath) writeJson(args.cwd, args.outPath, result, args.pretty);
    process.stdout.write(JSON.stringify(result, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (result.decision === "blocked") process.exit(1);
  }
}
