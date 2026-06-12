#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { runAgentRunDriverCanarySuite } from "./agent-run-driver-canary-suite.mjs";
import { buildReleaseDraftPreview } from "./release-draft-preview.mjs";
import { buildReleaseFinalGate } from "./release-final-gate.mjs";
import { buildReport, gather } from "./release-readiness-report.mjs";

const SCHEMA_VERSION = 1;

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    target: "0.8.0",
    tag: "",
    outPath: "",
    pretty: false,
    executeCanaries: true,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--target") out.target = argv[++index] ?? out.target;
    else if (arg === "--tag") out.tag = argv[++index] ?? "";
    else if (arg === "--out") out.outPath = argv[++index] ?? out.outPath;
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--execute-canaries") out.executeCanaries = true;
    else if (arg === "--preview-canaries") out.executeCanaries = false;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function writeText(cwd, relPath, value) {
  const fullPath = path.resolve(cwd, relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, value, "utf8");
}

function writeJson(cwd, relPath, value, pretty = false) {
  writeText(cwd, relPath, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
}

function pathsFor(target, tag) {
  return {
    canarySuitePath: ".artifacts/agent-run-driver/suite.json",
    readinessPath: `.artifacts/release-readiness/latest-ready-final-${target}.json`,
    draftPath: `.artifacts/release-draft/${tag}-preview.json`,
    cutPreviewPath: `.artifacts/release-cut/${tag}-preview.json`,
    artifactAuditPath: `.artifacts/release-cut/${tag}-artifact-audit.json`,
    finalGatePath: `.artifacts/release-cut/${tag}-final-gate.json`,
  };
}

export async function runReleaseEvidenceRefresh(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const target = String(options.target ?? "0.8.0");
  const tag = String(options.tag || `v${target}`);
  const pretty = options.pretty === true;
  const executeCanaries = options.executeCanaries !== false;
  const outPath = options.outPath || `.artifacts/release-cut/${tag}-evidence-refresh.json`;
  const paths = pathsFor(target, tag);
  const canarySuite = options.canarySuite ?? await runAgentRunDriverCanarySuite({
    cwd,
    execute: executeCanaries,
    outPath: paths.canarySuitePath,
    pretty,
  });
  if (options.canarySuite) writeJson(cwd, paths.canarySuitePath, canarySuite, pretty);
  const readiness = options.readiness ?? buildReport(gather(target, cwd));
  if (!readiness.mode) readiness.mode = "release-readiness-report";
  writeJson(cwd, paths.readinessPath, readiness, pretty);
  const draft = buildReleaseDraftPreview({
    cwd,
    target,
    tag,
    readinessPath: paths.readinessPath,
    readiness,
  });
  writeJson(cwd, paths.draftPath, draft, pretty);
  const finalGate = buildReleaseFinalGate({
    cwd,
    target,
    tag,
    readinessPath: paths.readinessPath,
    draftPath: paths.draftPath,
    readiness,
    draft,
  });
  writeJson(cwd, paths.cutPreviewPath, finalGate.cutPreview, pretty);
  writeJson(cwd, paths.artifactAuditPath, finalGate.artifactAudit, pretty);
  writeJson(cwd, paths.finalGatePath, finalGate, pretty);
  const protectedRecoveryApproval = readiness?.agentRunDrivers?.providerProtectedBoardRecoveryApprovalEvidence;

  const blockers = [
    ...(canarySuite.decision !== "pass" ? ["canary-suite-not-pass"] : []),
    ...(readiness.decision !== "ready" || readiness.ready !== true ? ["release-readiness-not-ready"] : []),
    ...(draft.decision !== "ready-for-operator-review" ? ["release-draft-not-ready-for-review"] : []),
    ...(finalGate.decision !== "pass" ? ["release-final-gate-not-pass"] : []),
  ];
  const decision = blockers.length === 0 ? "pass" : "block";
  const result = {
    mode: "release-evidence-refresh",
    schemaVersion: SCHEMA_VERSION,
    decision,
    recommendation: decision === "pass" ? "ready-for-protected-operator-review" : "repair-release-evidence",
    target,
    tag,
    executeCanaries,
    paths,
    canarySuiteDecision: canarySuite.decision,
    readinessDecision: readiness.decision,
    readinessReady: readiness.ready === true,
    protectedBoardRecoveryApprovalDecision: protectedRecoveryApproval?.decision ?? "missing",
    protectedBoardRecoveryApprovalPrompt: protectedRecoveryApproval?.requiredApprovalPrompt ?? "",
    protectedBoardRecoveryApprovalSelectedWorkerId: protectedRecoveryApproval?.selectedWorkerId ?? "",
    protectedBoardRecoveryApprovalScope: protectedRecoveryApproval?.approvalScope ?? "",
    draftDecision: draft.decision,
    finalGateDecision: finalGate.decision,
    finalGateHead: finalGate.head,
    requiredApprovalPrompts: finalGate.requiredApprovalPrompts ?? [],
    protectedActionsAllowed: false,
    tagAllowed: false,
    publishAllowed: false,
    workflowDispatchAllowed: false,
    processStartAllowed: false,
    blockers,
    summary: `release-evidence-refresh: decision=${decision} target=${target} tag=${tag} canaries=${canarySuite.decision} readiness=${readiness.decision} finalGate=${finalGate.decision} protectedActionsAllowed=no`,
  };
  writeJson(cwd, outPath, result, pretty);
  return result;
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/release-evidence-refresh.mjs [--target 0.8.0] [--tag v0.8.0] [--execute-canaries|--preview-canaries] [--out PATH] [--pretty]",
    "",
    "Refreshes local release evidence: driver canary suite, readiness, draft, and final gate. It never creates tags, pushes, publishes, or dispatches workflows.",
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
    const result = await runReleaseEvidenceRefresh(args);
    process.stdout.write(JSON.stringify(result, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (result.decision === "block") process.exit(1);
  }
}
