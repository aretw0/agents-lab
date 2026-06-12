#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
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
    evidencePath: "",
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--target") out.target = argv[++index] ?? out.target;
    else if (arg === "--tag") out.tag = argv[++index] ?? "";
    else if (arg === "--evidence") out.evidencePath = argv[++index] ?? "";
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function defaultEvidencePath(tag) {
  return `.artifacts/release-cut/${tag}-evidence-refresh.json`;
}

function readJson(cwd, relPath) {
  const fullPath = path.resolve(cwd, relPath);
  if (!existsSync(fullPath)) return { ok: false, value: null };
  return { ok: true, value: JSON.parse(readFileSync(fullPath, "utf8")) };
}

function runGit(cwd, args) {
  const out = spawnSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
  return {
    ok: out.status === 0,
    stdout: String(out.stdout ?? "").trim(),
    stderr: String(out.stderr ?? "").trim(),
  };
}

function expectedApprovalPrompts(tag) {
  return [
    `approve release tag create ${tag}`,
    `approve release tag push ${tag}`,
    `approve release draft prepare-draft-release ${tag}`,
    `approve release publish ${tag}`,
  ];
}

function protectedFlagsFalse(packet, prefix, blockers) {
  for (const flag of ["protectedActionsAllowed", "tagAllowed", "publishAllowed", "workflowDispatchAllowed", "processStartAllowed"]) {
    if (packet?.[flag] !== false) blockers.push(`${prefix}-${flag}-not-false`);
  }
}

function targetTagMatches(packet, prefix, target, tag, blockers) {
  if (!packet) return;
  if (String(packet.target) !== target) blockers.push(`${prefix}-target-mismatch`);
  if (packet.tag !== tag) blockers.push(`${prefix}-tag-mismatch`);
}

export function buildReleaseEvidenceStatus(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const target = String(options.target ?? "0.8.0");
  const tag = String(options.tag || `v${target}`);
  const evidencePath = options.evidencePath || defaultEvidencePath(tag);
  const evidenceRead = options.evidence ?? readJson(cwd, evidencePath);
  const refresh = evidenceRead.ok === false ? null : (evidenceRead.value ?? evidenceRead);
  const finalGatePath = refresh?.paths?.finalGatePath || `.artifacts/release-cut/${tag}-final-gate.json`;
  const finalGateRead = options.finalGate ?? readJson(cwd, finalGatePath);
  const finalGate = finalGateRead.ok === false ? null : (finalGateRead.value ?? finalGateRead);
  const currentHead = String(options.head ?? runGit(cwd, ["rev-parse", "--short", "HEAD"]).stdout ?? "");
  const approvalPrompts = refresh?.requiredApprovalPrompts ?? finalGate?.requiredApprovalPrompts ?? [];
  const expectedPrompts = expectedApprovalPrompts(tag);
  const blockers = [];

  if (!currentHead) blockers.push("release-current-head-missing");
  if (!refresh) blockers.push("release-evidence-refresh-missing");
  if (refresh && refresh.mode !== "release-evidence-refresh") blockers.push("release-evidence-mode-mismatch");
  if (refresh && refresh.target !== target) blockers.push("release-evidence-target-mismatch");
  if (refresh && refresh.tag !== tag) blockers.push("release-evidence-tag-mismatch");
  if (refresh && refresh.decision !== "pass") blockers.push("release-evidence-not-pass");
  if (refresh && refresh.finalGateDecision !== "pass") blockers.push("release-evidence-final-gate-not-pass");
  if (refresh?.finalGateHead && currentHead && refresh.finalGateHead !== currentHead) blockers.push("release-evidence-final-gate-stale-head");
  if (refresh?.finalGateHead && finalGate?.head && refresh.finalGateHead !== finalGate.head) blockers.push("release-evidence-final-gate-head-mismatch");
  if (!finalGate) blockers.push("release-final-gate-missing");
  if (finalGate && finalGate.mode !== "release-final-gate") blockers.push("release-final-gate-mode-mismatch");
  targetTagMatches(finalGate, "release-final-gate", target, tag, blockers);
  targetTagMatches(finalGate?.cutPreview, "release-final-gate-cut-preview", target, tag, blockers);
  targetTagMatches(finalGate?.artifactAudit, "release-final-gate-artifact-audit", target, tag, blockers);
  if (finalGate && finalGate.decision !== "pass") blockers.push("release-final-gate-not-pass");
  if (finalGate && finalGate.head && currentHead && finalGate.head !== currentHead) blockers.push("release-final-gate-stale-head");
  if (refresh) protectedFlagsFalse(refresh, "release-evidence", blockers);
  if (finalGate) protectedFlagsFalse(finalGate, "release-final-gate", blockers);
  for (const prompt of expectedPrompts) {
    if (!approvalPrompts.includes(prompt)) blockers.push(`release-approval-prompt-missing:${prompt}`);
    if (refresh && !(refresh.requiredApprovalPrompts ?? []).includes(prompt)) blockers.push(`release-evidence-approval-prompt-missing:${prompt}`);
    if (finalGate && !(finalGate.requiredApprovalPrompts ?? []).includes(prompt)) blockers.push(`release-final-gate-approval-prompt-missing:${prompt}`);
  }

  const decision = blockers.length === 0 ? "pass" : "block";
  const protectedRecoveryPrompt = refresh?.protectedBoardRecoveryApprovalDecision === "approval-required"
    ? String(refresh?.protectedBoardRecoveryApprovalPrompt ?? "")
    : "";
  const protectedReviewPrompts = [
    ...(protectedRecoveryPrompt ? [protectedRecoveryPrompt] : []),
    ...approvalPrompts,
  ];
  const protectedReviewRows = [
    ...(protectedRecoveryPrompt
      ? [{
          action: "rerun-protected-recovery-worker",
          source: "protected-board-recovery-approval",
          requiredApprovalPrompt: protectedRecoveryPrompt,
          selectedWorkerId: refresh?.protectedBoardRecoveryApprovalSelectedWorkerId ?? "",
          approvalScope: refresh?.protectedBoardRecoveryApprovalScope ?? "",
          dispatchAllowed: false,
          processStartAllowed: false,
        }]
      : []),
    ...expectedPrompts.map((prompt) => ({
      action: prompt.replace(/^approve release /, ""),
      source: "release-final-gate",
      requiredApprovalPrompt: prompt,
      dispatchAllowed: false,
      processStartAllowed: false,
    })),
  ];
  return {
    mode: "release-evidence-status",
    schemaVersion: SCHEMA_VERSION,
    decision,
    recommendation: decision === "pass" ? "ready-for-protected-operator-review" : "refresh-or-repair-release-evidence",
    target,
    tag,
    evidencePath,
    finalGatePath,
    currentHead,
    finalGateHead: finalGate?.head ?? "",
    headMatches: Boolean(finalGate?.head && currentHead && finalGate.head === currentHead),
    refreshDecision: refresh?.decision ?? "missing",
    finalGateDecision: finalGate?.decision ?? "missing",
    canarySuiteDecision: refresh?.canarySuiteDecision ?? "missing",
    readinessDecision: refresh?.readinessDecision ?? "missing",
    protectedBoardRecoveryApprovalDecision: refresh?.protectedBoardRecoveryApprovalDecision ?? "missing",
    protectedBoardRecoveryApprovalPrompt: refresh?.protectedBoardRecoveryApprovalPrompt ?? "",
    protectedBoardRecoveryApprovalSelectedWorkerId: refresh?.protectedBoardRecoveryApprovalSelectedWorkerId ?? "",
    protectedBoardRecoveryApprovalScope: refresh?.protectedBoardRecoveryApprovalScope ?? "",
    draftDecision: refresh?.draftDecision ?? "missing",
    approvalPromptCount: approvalPrompts.length,
    requiredApprovalPrompts: approvalPrompts,
    protectedReviewPromptCount: protectedReviewPrompts.length,
    protectedReviewPrompts,
    protectedReviewRows,
    protectedActionsAllowed: false,
    tagAllowed: false,
    publishAllowed: false,
    workflowDispatchAllowed: false,
    processStartAllowed: false,
    blockers,
    summary: `release-evidence-status: decision=${decision} target=${target} tag=${tag} refresh=${refresh?.decision ?? "missing"} finalGate=${finalGate?.decision ?? "missing"} protectedRecoveryApproval=${refresh?.protectedBoardRecoveryApprovalDecision ?? "missing"} protectedActionsAllowed=no`,
  };
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/release-evidence-status.mjs [--target 0.8.0] [--tag v0.8.0] [--evidence PATH] [--pretty]",
    "",
    "Reads already-materialized release evidence and returns a compact protected-review status. It never runs canaries, creates tags, pushes, publishes, or dispatches workflows.",
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
    const result = buildReleaseEvidenceStatus(args);
    process.stdout.write(JSON.stringify(result, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (result.decision === "block") process.exit(1);
  }
}
