#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;
const DEFAULT_SOURCE = ".artifacts/agent-run-driver/fanout-recovery-next.json";
const DEFAULT_OUT = ".artifacts/agent-run-driver/fanout-recovery-approval.json";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    sourcePath: DEFAULT_SOURCE,
    outPath: DEFAULT_OUT,
    operatorApproval: "",
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--source") out.sourcePath = argv[++index] ?? out.sourcePath;
    else if (arg === "--out") out.outPath = argv[++index] ?? out.outPath;
    else if (arg === "--operator-approval") out.operatorApproval = argv[++index] ?? "";
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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function textFromRecovery(payload) {
  return [
    payload?.failureKind,
    payload?.selectedWorker?.workerId,
    payload?.selectedWorker?.runId,
    payload?.selectedWorker?.logPath,
    ...asArray(payload?.selectedWorker?.blockers),
    ...asArray(payload?.selectedWorkerLogTail?.lines),
  ].filter(Boolean).join("\n");
}

function classifyApprovalScope(payload) {
  const text = textFromRecovery(payload);
  if (/\b(protected|scope protegido|human[a-z- ]*approval|aprova[cç][aã]o humana|external|network|remote|publish|release)\b/i.test(text)) {
    return "protected-or-external-scope";
  }
  return "standard-single-worker-recovery";
}

function requiredApprovalPromptFor(worker) {
  const id = worker?.runId || worker?.workerId || "selected-worker";
  return `approve recovery rerun ${id}`;
}

export function buildAgentRunDriverFanoutRecoveryApproval(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const sourcePath = options.sourcePath || DEFAULT_SOURCE;
  const payload = readJsonIfExists(cwd, sourcePath);
  const selectedWorker = payload?.selectedWorker;
  const requiredApprovalPrompt = selectedWorker ? requiredApprovalPromptFor(selectedWorker) : "";
  const operatorApproval = typeof options.operatorApproval === "string" ? options.operatorApproval.trim() : "";
  const approvalScope = payload ? classifyApprovalScope(payload) : "unknown";
  const blockers = [
    ...(payload ? [] : ["fanout-recovery-next-missing"]),
    ...(payload && payload.mode !== "agent-run-driver-fanout-recovery-next" ? ["fanout-recovery-next-mode-invalid"] : []),
    ...(payload && payload.decision !== "next-action-ready" ? [`fanout-recovery-next-not-ready:${payload.decision ?? "missing"}`] : []),
    ...(payload && !selectedWorker ? ["fanout-recovery-selected-worker-missing"] : []),
    ...(operatorApproval && operatorApproval !== requiredApprovalPrompt ? ["operator-approval-mismatch"] : []),
  ];
  const approved = blockers.length === 0 && operatorApproval === requiredApprovalPrompt;
  const decision = blockers.length > 0 ? "blocked" : approved ? "approved-for-single-rerun" : "approval-required";
  const report = {
    mode: "agent-run-driver-fanout-recovery-approval",
    schemaVersion: SCHEMA_VERSION,
    generatedAtIso: new Date().toISOString(),
    decision,
    dispatchAllowed: false,
    processStartAllowed: false,
    automationAllowed: false,
    sourcePath,
    sourceDecision: payload?.decision ?? "missing",
    approvalScope,
    selectedWorker: selectedWorker
      ? {
          workerId: selectedWorker.workerId,
          runId: selectedWorker.runId,
          logPath: selectedWorker.logPath,
          failureKind: payload?.failureKind,
          blockers: asArray(selectedWorker.blockers),
        }
      : null,
    selectedWorkerLogTail: payload?.selectedWorkerLogTail,
    requiredApprovalPrompt,
    operatorApprovalMatched: approved,
    singleRunOnly: true,
    blockers,
    nextActions: decision === "approval-required"
      ? [
          `present approval prompt exactly: ${requiredApprovalPrompt}`,
          "after explicit approval, rerun only the selected worker and rebuild fanout outcome",
          "do not start fan-in or any other worker from this packet",
        ]
      : decision === "approved-for-single-rerun"
        ? [
            "approval matched; the operator may run exactly one selected worker through the existing driver dispatch path",
            "after the worker is terminal, rebuild fanout outcome and recovery-next evidence",
          ]
        : ["fix recovery-next evidence before requesting recovery approval"],
    summary: `agent-run-driver-fanout-recovery-approval: decision=${decision} source=${sourcePath} selected=${selectedWorker?.workerId ?? "none"} dispatch=no`,
  };
  if (options.outPath) writeJson(cwd, options.outPath, report, options.pretty === true);
  return report;
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-driver-fanout-recovery-approval.mjs [--cwd DIR] [--source PATH] [--out PATH] [--operator-approval TEXT] [--pretty]",
    "",
    "Builds a report-only approval packet for rerunning exactly one selected fanout recovery worker.",
    `Default source: ${DEFAULT_SOURCE}`,
    `Default output: ${DEFAULT_OUT}`,
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
    const report = buildAgentRunDriverFanoutRecoveryApproval(args);
    if (!args.outPath) writeJson(path.resolve(args.cwd), DEFAULT_OUT, report, args.pretty);
    process.stdout.write(JSON.stringify(report, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (report.decision === "blocked") process.exit(1);
  }
}
