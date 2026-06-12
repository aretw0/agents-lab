#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { buildReleaseEvidenceStatus } from "./release-evidence-status.mjs";
import { buildReleaseProtectedReviewApproval } from "./release-protected-review-approval.mjs";

const SCHEMA_VERSION = 1;
const DEFAULT_OUT = ".artifacts/release-cut/protected-review-plan.json";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    target: "0.8.0",
    tag: "",
    evidencePath: "",
    statusPath: "",
    approvalPath: "",
    outPath: "",
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--target") out.target = argv[++index] ?? out.target;
    else if (arg === "--tag") out.tag = argv[++index] ?? "";
    else if (arg === "--evidence") out.evidencePath = argv[++index] ?? "";
    else if (arg === "--status") out.statusPath = argv[++index] ?? "";
    else if (arg === "--approval") out.approvalPath = argv[++index] ?? "";
    else if (arg === "--out") out.outPath = argv[++index] ?? "";
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function readJsonIfExists(cwd, relPath) {
  const fullPath = path.resolve(cwd, relPath);
  return existsSync(fullPath) ? JSON.parse(readFileSync(fullPath, "utf8")) : undefined;
}

function writeJson(cwd, relPath, value, pretty = false) {
  const fullPath = path.resolve(cwd, relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
}

function statusFromOptions(options, cwd) {
  if (options.status && typeof options.status === "object") return options.status;
  if (options.statusPath) return readJsonIfExists(cwd, options.statusPath);
  return buildReleaseEvidenceStatus({
    cwd,
    target: options.target,
    tag: options.tag,
    evidencePath: options.evidencePath,
    head: options.head,
  });
}

function approvalFromOptions(options, cwd, status) {
  if (options.approval && typeof options.approval === "object") return options.approval;
  if (options.approvalPath) return readJsonIfExists(cwd, options.approvalPath);
  return buildReleaseProtectedReviewApproval({
    cwd,
    status,
    target: options.target,
    tag: options.tag,
    evidencePath: options.evidencePath,
  });
}

function rampRows(nextRow) {
  return [
    {
      stage: "single-protected-worker",
      maxConcurrentProtectedWorkers: 1,
      allowedNow: true,
      requiredBeforeNextStage: "selected protected worker outcome/recovery/status rebuilt and passing",
      selectedWorkerId: nextRow?.selectedWorkerId ?? "",
    },
    {
      stage: "paired-protected-workers",
      maxConcurrentProtectedWorkers: 2,
      allowedNow: false,
      requiredBeforeNextStage: "one protected recovery cycle must pass with no manual artifact repair",
    },
    {
      stage: "bounded-protected-fanout",
      maxConcurrentProtectedWorkers: 3,
      allowedNow: false,
      requiredBeforeNextStage: "two consecutive protected cycles must pass with fail-closed outcome and recovery-next evidence",
    },
  ];
}

function protectedReviewExecutionGate({ approved, blockers, nextRow, requiredApprovalPrompt }) {
  const blocked = blockers.length > 0;
  return {
    mode: "protected-review-execution-gate",
    decision: blocked ? "blocked" : approved ? "single-worker-approved" : "approval-required",
    selectedWorkerId: nextRow?.selectedWorkerId ?? "",
    approvalScope: nextRow?.approvalScope ?? "",
    requiredApprovalPrompt,
    approvedProtectedWorkerSlotsNow: blocked ? 0 : approved ? 1 : 0,
    pendingApprovalProtectedWorkerSlots: blocked || approved ? 0 : 1,
    maxProtectedWorkerSlotsAfterApproval: blocked ? 0 : 1,
    workerVolumeAllowedNow: false,
    dispatchAllowed: false,
    processStartAllowed: false,
    protectedActionsAllowed: false,
  };
}

function protectedReviewProgress(status) {
  const passed = Number(status?.protectedReviewEvidenceFanoutPassedWorkerCount ?? 0);
  const total = Number(status?.protectedReviewEvidenceFanoutWorkerCount ?? 0);
  return {
    mode: "protected-review-progress",
    evidenceDecision: status?.protectedReviewEvidenceDecision ?? "missing",
    approvedWorkerId: status?.protectedReviewEvidenceApprovedWorkerId ?? "",
    approvedRunId: status?.protectedReviewEvidenceApprovedRunId ?? "",
    approvedContractDecision: status?.protectedReviewEvidenceApprovedContractDecision ?? "",
    fanoutPassedWorkerCount: Number.isFinite(passed) ? passed : 0,
    fanoutWorkerCount: Number.isFinite(total) ? total : 0,
    complete: total > 0 && passed === total,
    dispatchAllowed: false,
    processStartAllowed: false,
    protectedActionsAllowed: false,
  };
}

export function buildReleaseProtectedReviewPlan(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const status = statusFromOptions(options, cwd);
  const approval = approvalFromOptions(options, cwd, status);
  const nextRow = status?.nextProtectedReviewRow ?? approval?.nextProtectedReviewRow ?? null;
  const blockers = [
    ...(status ? [] : ["release-evidence-status-missing"]),
    ...(status && status.mode !== "release-evidence-status" ? ["release-evidence-status-mode-invalid"] : []),
    ...(status && status.decision !== "pass" ? [`release-evidence-status-not-pass:${status.decision ?? "missing"}`] : []),
    ...(approval ? [] : ["release-protected-review-approval-missing"]),
    ...(approval && approval.mode !== "release-protected-review-approval" ? ["release-protected-review-approval-mode-invalid"] : []),
    ...(approval && approval.decision === "blocked" ? ["release-protected-review-approval-blocked"] : []),
    ...(status && !nextRow ? ["next-protected-review-row-missing"] : []),
  ];
  const approved = approval?.decision === "approved-for-next-protected-review";
  const requiredApprovalPrompt = approval?.requiredApprovalPrompt ?? nextRow?.requiredApprovalPrompt ?? "";
  const decision = blockers.length > 0
    ? "blocked"
    : approved
      ? "single-worker-approved"
      : "single-worker-approval-required";
  const executionGate = protectedReviewExecutionGate({
    approved,
    blockers,
    nextRow,
    requiredApprovalPrompt,
  });
  const progress = protectedReviewProgress(status);
  const plan = {
    mode: "release-protected-review-plan",
    schemaVersion: SCHEMA_VERSION,
    decision,
    target: status?.target ?? approval?.target ?? String(options.target ?? "0.8.0"),
    tag: status?.tag ?? approval?.tag ?? String(options.tag || `v${String(options.target ?? "0.8.0")}`),
    statusDecision: status?.decision ?? "missing",
    approvalDecision: approval?.decision ?? "missing",
    nextProtectedReviewRow: nextRow,
    requiredApprovalPrompt,
    maxConcurrentProtectedWorkersAllowedNow: blockers.length === 0 ? 1 : 0,
    approvedProtectedWorkerSlotsNow: executionGate.approvedProtectedWorkerSlotsNow,
    pendingApprovalProtectedWorkerSlots: executionGate.pendingApprovalProtectedWorkerSlots,
    maxProtectedWorkerSlotsAfterApproval: executionGate.maxProtectedWorkerSlotsAfterApproval,
    workerVolumeAllowedNow: false,
    singleWorkerAllowedAfterApproval: approved,
    protectedReviewExecutionGate: executionGate,
    protectedReviewProgress: progress,
    protectedRamp: rampRows(nextRow),
    dispatchAllowed: false,
    processStartAllowed: false,
    protectedActionsAllowed: false,
    blockers,
    nextActions: decision === "single-worker-approval-required"
      ? [`approve exactly one protected action first: ${approval?.requiredApprovalPrompt ?? nextRow?.requiredApprovalPrompt ?? ""}`]
      : decision === "single-worker-approved"
        ? ["run only the approved source-specific path for one protected worker, then rebuild outcome/recovery/status before increasing volume"]
        : ["repair protected review status/approval evidence before planning protected worker volume"],
    summary: `release-protected-review-plan: decision=${decision} maxProtectedNow=${blockers.length === 0 ? 1 : 0} progress=${progress.fanoutPassedWorkerCount}/${progress.fanoutWorkerCount} volume=no dispatch=no`,
  };
  if (options.outPath) writeJson(cwd, options.outPath, plan, options.pretty === true);
  return plan;
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/release-protected-review-plan.mjs [--target 0.8.0] [--tag v0.8.0] [--evidence PATH] [--status PATH] [--approval PATH] [--out PATH] [--pretty]",
    "",
    "Builds a report-only protected review volume plan. It never starts workers, creates tags, pushes, publishes, dispatches workflows, or launches ant_colony.",
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
    const outPath = args.outPath || DEFAULT_OUT;
    const result = buildReleaseProtectedReviewPlan({ ...args, outPath });
    process.stdout.write(JSON.stringify(result, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (result.decision === "blocked") process.exit(1);
  }
}
