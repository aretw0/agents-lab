#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    target: "0.8.0",
    tag: "",
    readinessPath: "",
    draftPath: "",
    cutPath: "",
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
    else if (arg === "--draft") out.draftPath = argv[++index] ?? "";
    else if (arg === "--cut") out.cutPath = argv[++index] ?? "";
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

function defaultReadinessPath(target) {
  return `.artifacts/release-readiness/latest-ready-final-${target}.json`;
}

function defaultDraftPath(tag) {
  return `.artifacts/release-draft/${tag}-preview.json`;
}

function defaultCutPath(tag) {
  return `.artifacts/release-cut/${tag}-preview.json`;
}

function arrayEmpty(value) {
  return Array.isArray(value) && value.length === 0;
}

function protectedFlagsFalse(value, prefix, blockers) {
  for (const key of ["tagAllowed", "publishAllowed", "workflowDispatchAllowed", "processStartAllowed"]) {
    if (value?.[key] !== false) blockers.push(`${prefix}-${key}-not-false`);
  }
}

function approvalRowsOk(rows, tag) {
  const expected = [
    `approve release tag create ${tag}`,
    `approve release tag push ${tag}`,
    `approve release draft prepare-draft-release ${tag}`,
    `approve release publish ${tag}`,
  ];
  const actual = Array.isArray(rows) ? rows.map((row) => row?.requiredApprovalPrompt) : [];
  return expected.every((prompt) => actual.includes(prompt));
}

export function buildReleaseArtifactAudit(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const target = String(options.target ?? "0.8.0");
  const tag = String(options.tag || `v${target}`);
  const readinessPath = options.readinessPath || defaultReadinessPath(target);
  const draftPath = options.draftPath || defaultDraftPath(tag);
  const cutPath = options.cutPath || defaultCutPath(tag);
  const readiness = options.readiness ?? readJsonIfExists(cwd, readinessPath);
  const draft = options.draft ?? readJsonIfExists(cwd, draftPath);
  const cut = options.cut ?? readJsonIfExists(cwd, cutPath);
  const head = options.head ?? runGit(cwd, ["rev-parse", "--short", "HEAD"]).stdout;
  const blockers = [];

  if (!readiness) blockers.push("release-readiness-missing");
  if (!draft) blockers.push("release-draft-preview-missing");
  if (!cut) blockers.push("release-cut-preview-missing");

  if (readiness && readiness.mode !== "release-readiness-report") blockers.push("release-readiness-mode-mismatch");
  if (draft && draft.mode !== "release-draft-preview") blockers.push("release-draft-mode-mismatch");
  if (cut && cut.mode !== "release-cut-preview") blockers.push("release-cut-mode-mismatch");

  if (readiness && readiness.ready !== true) blockers.push("release-readiness-not-ready");
  if (readiness && readiness.decision !== "ready") blockers.push("release-readiness-decision-not-ready");
  if (draft && draft.decision !== "ready-for-operator-review") blockers.push("release-draft-not-ready-for-operator-review");
  if (cut && cut.decision !== "ready-for-operator-review") blockers.push("release-cut-not-ready-for-operator-review");

  if (draft && String(draft.target) !== target) blockers.push("release-draft-target-mismatch");
  if (cut && String(cut.target) !== target) blockers.push("release-cut-target-mismatch");
  if (draft && draft.tag !== tag) blockers.push("release-draft-tag-mismatch");
  if (cut && cut.tag !== tag) blockers.push("release-cut-tag-mismatch");

  if (readiness?.head && readiness.head !== head) blockers.push("release-readiness-stale-head");
  if (draft?.targetSha && draft.targetSha !== head) blockers.push("release-draft-stale-head");
  if (cut?.targetSha && cut.targetSha !== head) blockers.push("release-cut-stale-head");
  if (draft?.targetSha && cut?.targetSha && draft.targetSha !== cut.targetSha) blockers.push("release-draft-cut-sha-mismatch");

  const draftReview = draft?.releaseDraftNotesReviewPacket;
  if (!draftReview || draftReview.decision !== "ready-for-operator-review") blockers.push("release-draft-notes-review-missing");
  if (draftReview && draftReview.notesWritten !== true) blockers.push("release-draft-notes-not-written");

  const operatorPacket = cut?.releaseCutOperatorPacket;
  if (!operatorPacket || operatorPacket.mode !== "release-cut-operator-packet") blockers.push("release-cut-operator-packet-missing");
  if (operatorPacket && operatorPacket.decision !== "ready-for-operator-review") blockers.push("release-cut-operator-not-ready-for-review");
  if (operatorPacket && !approvalRowsOk(operatorPacket.approvalRows, tag)) blockers.push("release-cut-operator-approval-rows-incomplete");

  if (readiness?.blockers && !arrayEmpty(readiness.blockers)) blockers.push("release-readiness-has-blockers");
  if (draft?.blockers && !arrayEmpty(draft.blockers)) blockers.push("release-draft-has-blockers");
  if (cut?.blockers && !arrayEmpty(cut.blockers)) blockers.push("release-cut-has-blockers");
  if (operatorPacket?.blockers && !arrayEmpty(operatorPacket.blockers)) blockers.push("release-cut-operator-has-blockers");

  if (draft) protectedFlagsFalse(draft, "release-draft", blockers);
  if (cut) protectedFlagsFalse(cut, "release-cut", blockers);
  if (draftReview) protectedFlagsFalse(draftReview, "release-draft-notes-review", blockers);
  if (operatorPacket) protectedFlagsFalse(operatorPacket, "release-cut-operator", blockers);

  const decision = blockers.length === 0 ? "pass" : "block";
  return {
    mode: "release-artifact-audit",
    schemaVersion: SCHEMA_VERSION,
    decision,
    recommendation: decision === "pass" ? "ready-for-protected-operator-review" : "repair-release-artifacts",
    target,
    tag,
    head,
    artifacts: {
      readinessPath,
      draftPath,
      cutPath,
      readinessPresent: Boolean(readiness),
      draftPresent: Boolean(draft),
      cutPresent: Boolean(cut),
    },
    evidence: {
      readinessDecision: readiness?.decision ?? "missing",
      draftDecision: draft?.decision ?? "missing",
      draftNotesReviewDecision: draftReview?.decision ?? "missing",
      cutDecision: cut?.decision ?? "missing",
      releaseCutOperatorDecision: operatorPacket?.decision ?? "missing",
      approvalPromptCount: Array.isArray(operatorPacket?.requiredApprovalPrompts) ? operatorPacket.requiredApprovalPrompts.length : 0,
    },
    protectedActionsAllowed: false,
    tagAllowed: false,
    publishAllowed: false,
    workflowDispatchAllowed: false,
    processStartAllowed: false,
    blockers,
    summary: `release-artifact-audit: decision=${decision} target=${target} tag=${tag} blockers=${blockers.length} protectedActionsAllowed=no`,
  };
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/release-artifact-audit.mjs [--target 0.8.0] [--tag v0.8.0] [--readiness PATH] [--draft PATH] [--cut PATH] [--out PATH] [--pretty]",
    "",
    "Audits release readiness, draft, and cut artifacts. It never creates tags, pushes, publishes, or dispatches workflows.",
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
    const result = buildReleaseArtifactAudit(args);
    if (args.outPath) writeJson(args.cwd, args.outPath, result, args.pretty);
    process.stdout.write(JSON.stringify(result, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (result.decision === "block") process.exit(1);
  }
}
