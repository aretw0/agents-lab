#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { buildReleaseEvidenceStatus } from "./release-evidence-status.mjs";

const SCHEMA_VERSION = 1;
const DEFAULT_OUT = ".artifacts/release-cut/protected-review-approval.json";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    target: "0.8.0",
    tag: "",
    evidencePath: "",
    statusPath: "",
    operatorApproval: "",
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
    else if (arg === "--operator-approval") out.operatorApproval = argv[++index] ?? "";
    else if (arg === "--out") out.outPath = argv[++index] ?? "";
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function writeJson(cwd, relPath, value, pretty = false) {
  const fullPath = path.resolve(cwd, relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
}

function readJsonIfExists(cwd, relPath) {
  const fullPath = path.resolve(cwd, relPath);
  return existsSync(fullPath) ? JSON.parse(readFileSync(fullPath, "utf8")) : undefined;
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

function approvalValidationCommandPreview({ target, tag, evidencePath, requiredApprovalPrompt }) {
  const args = ["scripts/release-protected-review-approval.mjs"];
  if (target) args.push("--target", target);
  if (tag) args.push("--tag", tag);
  if (evidencePath) args.push("--evidence", evidencePath);
  args.push("--operator-approval", requiredApprovalPrompt);
  return {
    command: "node",
    args,
    shellInterpolationAllowed: false,
    dispatchAllowed: false,
    processStartAllowed: false,
  };
}

export function buildReleaseProtectedReviewApproval(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const status = statusFromOptions(options, cwd);
  const nextRow = status?.nextProtectedReviewRow ?? null;
  const requiredApprovalPrompt = String(nextRow?.requiredApprovalPrompt ?? "");
  const operatorApproval = String(options.operatorApproval ?? "").trim();
  const blockers = [
    ...(status ? [] : ["release-evidence-status-missing"]),
    ...(status && status.mode !== "release-evidence-status" ? ["release-evidence-status-mode-invalid"] : []),
    ...(status && status.decision !== "pass" ? [`release-evidence-status-not-pass:${status.decision ?? "missing"}`] : []),
    ...(status && !nextRow ? ["next-protected-review-row-missing"] : []),
    ...(operatorApproval && operatorApproval !== requiredApprovalPrompt ? ["operator-approval-mismatch"] : []),
  ];
  const statusMode = status?.mode ?? "";
  const approvalMatched = blockers.length === 0 && operatorApproval === requiredApprovalPrompt;
  const decision = blockers.length > 0 ? "blocked" : approvalMatched ? "approved-for-next-protected-review" : "approval-required";
  const target = status?.target ?? String(options.target ?? "0.8.0");
  const tag = status?.tag ?? String(options.tag || `v${String(options.target ?? "0.8.0")}`);
  const approvalValidationPreview = requiredApprovalPrompt
    ? approvalValidationCommandPreview({
        target,
        tag,
        evidencePath: options.evidencePath,
        requiredApprovalPrompt,
      })
    : undefined;
  const report = {
    mode: "release-protected-review-approval",
    schemaVersion: SCHEMA_VERSION,
    decision,
    target,
    tag,
    statusDecision: status?.decision ?? "missing",
    nextProtectedReviewRow: nextRow,
    requiredApprovalPrompt,
    operatorApprovalMatched: approvalMatched,
    approvalValidationCommandPreview: approvalValidationPreview,
    approvedHandoff: approvalMatched
      ? {
          source: nextRow?.source ?? "",
          action: nextRow?.action ?? "",
          selectedWorkerId: nextRow?.selectedWorkerId ?? "",
          approvalScope: nextRow?.approvalScope ?? "",
          requiredApprovalPrompt,
          dispatchAllowed: false,
          processStartAllowed: false,
          nextActionCode: "use-source-specific-gate",
        }
      : null,
    dispatchAllowed: false,
    processStartAllowed: false,
    protectedActionsAllowed: false,
    tagAllowed: false,
    publishAllowed: false,
    workflowDispatchAllowed: false,
    blockers,
    nextActions: decision === "approval-required"
      ? [`present approval prompt exactly: ${requiredApprovalPrompt}`]
      : decision === "approved-for-next-protected-review"
        ? ["approval matched; use the row source-specific dispatch path under its own gates"]
        : statusMode === "release-evidence-refresh"
          ? ["received release-evidence-refresh as --status; rerun with --evidence PATH or pass a release-evidence-status artifact to --status"]
          : ["refresh or repair release evidence status before protected approval"],
    summary: `release-protected-review-approval: decision=${decision} next=${nextRow?.action ?? "none"} dispatch=no`,
  };
  if (options.outPath) writeJson(cwd, options.outPath, report, options.pretty === true);
  return report;
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/release-protected-review-approval.mjs [--target 0.8.0] [--tag v0.8.0] [--evidence PATH] [--status PATH] [--operator-approval TEXT] [--out PATH] [--pretty]",
    "",
    "Validates the next protected review approval prompt from materialized release evidence. It never starts processes, creates tags, pushes, publishes, dispatches workflows, or reruns workers.",
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
    const result = buildReleaseProtectedReviewApproval({ ...args, outPath });
    process.stdout.write(JSON.stringify(result, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (result.decision === "blocked") process.exit(1);
  }
}
