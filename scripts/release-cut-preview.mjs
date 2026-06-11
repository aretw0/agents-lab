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

function commandPreview(command, args, reason) {
  return {
    command,
    args,
    reason,
    shellInterpolationAllowed: false,
    dispatchAllowed: false,
    processStartAllowed: false,
  };
}

function buildReleaseCutOperatorPacket({ decision, target, tag, targetSha, readiness, draft, draftNotesReview, commandPreviews, blockers }) {
  const approvalRows = [
    {
      action: "create-local-tag",
      requiredApprovalPrompt: `approve release tag create ${tag}`,
      commandPreview: commandPreviews.createLocalTag,
    },
    {
      action: "push-tag",
      requiredApprovalPrompt: `approve release tag push ${tag}`,
      commandPreview: commandPreviews.pushTag,
    },
    {
      action: "prepare-draft-release",
      requiredApprovalPrompt: `approve release draft prepare-draft-release ${tag}`,
      commandPreview: commandPreviews.prepareDraftRelease,
    },
    {
      action: "publish-release",
      requiredApprovalPrompt: `approve release publish ${tag}`,
      commandPreview: commandPreviews.publishGate,
    },
  ];
  return {
    mode: "release-cut-operator-packet",
    schemaVersion: SCHEMA_VERSION,
    decision,
    target,
    tag,
    targetSha,
    readinessDecision: readiness?.decision ?? "missing",
    readinessReady: readiness?.ready === true,
    draftDecision: draft?.decision ?? "missing",
    draftNotesReviewDecision: draftNotesReview?.decision ?? "missing",
    approvalRows,
    requiredApprovalPrompts: approvalRows.map((row) => row.requiredApprovalPrompt),
    tagAllowed: false,
    publishAllowed: false,
    workflowDispatchAllowed: false,
    processStartAllowed: false,
    blockers: Array.isArray(blockers) ? blockers : [],
    summary: `release-cut-operator-packet: decision=${decision} tag=${tag} approvals=${approvalRows.length} dispatch=no`,
  };
}

export function buildReleaseCutPreview(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const target = String(options.target ?? "0.8.0");
  const tag = String(options.tag || `v${target}`);
  const readinessPath = options.readinessPath || defaultReadinessPath(target);
  const draftPath = options.draftPath || defaultDraftPath(tag);
  const readiness = options.readiness ?? readJsonIfExists(cwd, readinessPath);
  const draft = options.draft ?? readJsonIfExists(cwd, draftPath);
  const auditPath = options.auditPath || "";
  const artifactAudit = options.artifactAudit ?? (auditPath ? readJsonIfExists(cwd, auditPath) : undefined);
  const head = runGit(cwd, ["rev-parse", "--short", "HEAD"]).stdout;
  const status = runGit(cwd, ["status", "--short"]).stdout;
  const blockers = [];

  if (!readiness) blockers.push("release-readiness-missing");
  if (!draft) blockers.push("release-draft-preview-missing");
  if (readiness && readiness.ready !== true) blockers.push("release-readiness-not-ready");
  if (readiness && readiness.decision !== "ready") blockers.push("release-readiness-decision-not-ready");
  if (draft && draft.decision !== "ready-for-operator-review") blockers.push("release-draft-not-ready-for-operator-review");
  if (draft?.decision === "ready-for-operator-review" && draft.releaseDraftNotesReviewPacket?.decision !== "ready-for-operator-review") {
    blockers.push("release-draft-notes-review-missing");
  }
  if (tag !== `v${target}`) blockers.push("tag-target-mismatch");
  if (draft?.tag && draft.tag !== tag) blockers.push("draft-tag-mismatch");
  if (draft?.target && String(draft.target) !== target) blockers.push("draft-target-mismatch");
  if (readiness?.head && readiness.head !== head) blockers.push("release-readiness-stale-head");
  if (draft?.targetSha && draft.targetSha !== head) blockers.push("release-draft-stale-head");
  if (auditPath && !artifactAudit) blockers.push("release-artifact-audit-missing");
  if (artifactAudit && artifactAudit.decision !== "pass") blockers.push("release-artifact-audit-not-pass");
  if (artifactAudit?.target && String(artifactAudit.target) !== target) blockers.push("release-artifact-audit-target-mismatch");
  if (artifactAudit?.tag && artifactAudit.tag !== tag) blockers.push("release-artifact-audit-tag-mismatch");
  if (artifactAudit?.head && artifactAudit.head !== head) blockers.push("release-artifact-audit-stale-head");
  if (artifactAudit?.blockers && Array.isArray(artifactAudit.blockers) && artifactAudit.blockers.length > 0) {
    blockers.push("release-artifact-audit-has-blockers");
  }
  if (status) blockers.push("worktree-not-clean");

  const decision = blockers.length === 0 ? "ready-for-operator-review" : "blocked";
  const previousTag = draft?.previousTag ?? null;
  const targetSha = head || draft?.targetSha || readiness?.head || "";
  const draftNotesReview = draft?.releaseDraftNotesReviewPacket && typeof draft.releaseDraftNotesReviewPacket === "object"
    ? draft.releaseDraftNotesReviewPacket
    : undefined;
  const tagMessage = `Release ${tag}`;
  const commandPreviews = {
    createLocalTag: commandPreview("git", ["tag", "-a", tag, targetSha, "-m", tagMessage], "protected local tag creation"),
    pushTag: commandPreview("git", ["push", "origin", tag], "protected remote tag push"),
    prepareDraftRelease: commandPreview("gh", ["workflow", "run", "release-draft.yml", "-f", `tag=${tag}`], "protected GitHub Actions workflow dispatch"),
    publishGate: {
      workflow: ".github/workflows/publish.yml",
      trigger: "tag-gated CI workflow_run or explicit workflow_dispatch",
      reason: "publish remains protected and is not started by this packet",
      publishAllowed: false,
      workflowDispatchAllowed: false,
      processStartAllowed: false,
    },
  };
  const releaseCutOperatorPacket = buildReleaseCutOperatorPacket({
    decision,
    target,
    tag,
    targetSha,
    readiness,
    draft,
    draftNotesReview,
    commandPreviews,
    blockers,
  });

  return {
    mode: "release-cut-preview",
    schemaVersion: SCHEMA_VERSION,
    decision,
    target,
    tag,
    targetSha,
    previousTag,
    releaseReadinessPath: readinessPath,
    draftPreviewPath: draftPath,
    releaseArtifactAuditPath: auditPath || null,
    artifactAuditDecision: artifactAudit?.decision ?? (auditPath ? "missing" : "not-required"),
    readinessReady: readiness?.ready === true,
    readinessDecision: readiness?.decision ?? "missing",
    draftDecision: draft?.decision ?? "missing",
    draftNotesReview,
    tagAllowed: false,
    publishAllowed: false,
    workflowDispatchAllowed: false,
    processStartAllowed: false,
    requiresOperatorDecision: true,
    requiredApprovalPrompts: releaseCutOperatorPacket.requiredApprovalPrompts,
    releaseCutOperatorPacket,
    commandPreviews,
    protectedActions: [
      "create annotated release tag",
      "push release tag",
      "dispatch release-draft workflow",
      "publish npm packages through tag-gated workflow",
    ],
    blockers,
    summary: `release-cut-preview: decision=${decision} tag=${tag} targetSha=${targetSha || "unknown"} tagAllowed=no publishAllowed=no workflowDispatchAllowed=no`,
  };
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/release-cut-preview.mjs [--target 0.8.0] [--tag v0.8.0] [--readiness PATH] [--draft PATH] [--audit PATH] [--out PATH] [--pretty]",
    "",
    "Builds a protected release cut operator packet. It never creates tags, pushes, publishes, or dispatches workflows.",
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
    const result = buildReleaseCutPreview(args);
    if (args.outPath) writeJson(args.cwd, args.outPath, result, args.pretty);
    process.stdout.write(JSON.stringify(result, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (result.decision === "blocked") process.exit(1);
  }
}
