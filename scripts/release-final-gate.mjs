#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { buildReleaseArtifactAudit } from "./release-artifact-audit.mjs";
import { buildReleaseCutPreview } from "./release-cut-preview.mjs";

const SCHEMA_VERSION = 1;

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    target: "0.8.0",
    tag: "",
    readinessPath: "",
    draftPath: "",
    auditPath: "",
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
    else if (arg === "--audit") out.auditPath = argv[++index] ?? "";
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

function defaultAuditPath(tag) {
  return `.artifacts/release-cut/${tag}-artifact-audit.json`;
}

function defaultCutPreviewPath(tag) {
  return `.artifacts/release-cut/${tag}-preview.json`;
}

export function buildReleaseFinalGate(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const target = String(options.target ?? "0.8.0");
  const tag = String(options.tag || `v${target}`);
  const readinessPath = options.readinessPath || defaultReadinessPath(target);
  const draftPath = options.draftPath || defaultDraftPath(tag);
  const auditPath = options.auditPath || defaultAuditPath(tag);
  const cutPreviewPath = options.cutPreviewPath || defaultCutPreviewPath(tag);
  const head = options.head ?? runGit(cwd, ["rev-parse", "--short", "HEAD"]).stdout;
  const cutBase = buildReleaseCutPreview({
    cwd,
    target,
    tag,
    readinessPath,
    draftPath,
    readiness: options.readiness,
    draft: options.draft,
  });
  const artifactAudit = buildReleaseArtifactAudit({
    cwd,
    target,
    tag,
    readinessPath,
    draftPath,
    cutPath: cutPreviewPath,
    readiness: options.readiness,
    draft: options.draft,
    cut: cutBase,
    head,
  });
  const cutPreview = buildReleaseCutPreview({
    cwd,
    target,
    tag,
    readinessPath,
    draftPath,
    auditPath,
    readiness: options.readiness,
    draft: options.draft,
    artifactAudit,
  });
  const blockers = [
    ...(cutBase.blockers ?? []).map((blocker) => `cut-base:${blocker}`),
    ...(artifactAudit.blockers ?? []).map((blocker) => `artifact-audit:${blocker}`),
    ...(cutPreview.blockers ?? []).map((blocker) => `cut-preview:${blocker}`),
  ];
  const decision = blockers.length === 0 ? "pass" : "block";
  return {
    mode: "release-final-gate",
    schemaVersion: SCHEMA_VERSION,
    decision,
    recommendation: decision === "pass" ? "ready-for-protected-operator-review" : "repair-release-evidence",
    target,
    tag,
    head,
    releaseReadinessPath: readinessPath,
    draftPreviewPath: draftPath,
    cutPreviewPath,
    releaseArtifactAuditPath: auditPath,
    cutBaseDecision: cutBase.decision,
    artifactAuditDecision: artifactAudit.decision,
    cutPreviewDecision: cutPreview.decision,
    cutPreview,
    artifactAudit,
    requiredApprovalPrompts: cutPreview.requiredApprovalPrompts ?? [],
    protectedActionsAllowed: false,
    tagAllowed: false,
    publishAllowed: false,
    workflowDispatchAllowed: false,
    processStartAllowed: false,
    blockers,
    summary: `release-final-gate: decision=${decision} target=${target} tag=${tag} cut=${cutPreview.decision} audit=${artifactAudit.decision} protectedActionsAllowed=no`,
  };
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/release-final-gate.mjs [--target 0.8.0] [--tag v0.8.0] [--readiness PATH] [--draft PATH] [--audit PATH] [--out PATH] [--pretty]",
    "",
    "Builds an in-memory final release evidence gate. It never creates tags, pushes, publishes, or dispatches workflows.",
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
    const result = buildReleaseFinalGate(args);
    if (args.outPath) writeJson(args.cwd, args.outPath, result, args.pretty);
    process.stdout.write(JSON.stringify(result, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (result.decision === "block") process.exit(1);
  }
}
