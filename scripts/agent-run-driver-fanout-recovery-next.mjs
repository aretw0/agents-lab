#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;
const DEFAULT_SOURCE = ".artifacts/agent-run-driver/fanout-outcome.json";
const DEFAULT_OUT = ".artifacts/agent-run-driver/fanout-recovery-next.json";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    sourcePath: DEFAULT_SOURCE,
    outPath: DEFAULT_OUT,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--source") out.sourcePath = argv[++index] ?? out.sourcePath;
    else if (arg === "--out") out.outPath = argv[++index] ?? out.outPath;
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

function failedWorkers(payload) {
  return asArray(payload?.workerSummaries)
    .filter((worker) => worker?.contractDecision !== "pass" || asArray(worker?.blockers).length > 0 || worker?.followTerminal === false);
}

function classifyFailure(worker) {
  const blockers = asArray(worker?.blockers).map(String);
  const markerFailures = asArray(worker?.markerFailures).map(String);
  if (blockers.some((blocker) => blocker.includes("worker-output-fail")) || markerFailures.includes("worker-output-fail")) {
    return "worker-output-fail";
  }
  if (worker?.followTerminal === false || blockers.some((blocker) => blocker.includes("not-terminal"))) {
    return "worker-not-terminal";
  }
  if (worker?.contractDecision && worker.contractDecision !== "pass") {
    return `contract-not-pass:${worker.contractDecision}`;
  }
  return blockers[0] || "worker-recovery-needed";
}

function refreshCommandFor(sourcePath, planPath) {
  return {
    command: "node",
    args: [
      "scripts/agent-run-driver-fanout-outcome.mjs",
      "--plan",
      planPath || sourcePath,
      "--out",
      sourcePath,
      "--exit-zero-on-block",
    ],
    shellInterpolationAllowed: false,
  };
}

function nextActionsFor(failureKind, worker) {
  if (failureKind === "worker-output-fail") {
    return [
      `inspect the worker log for ${worker.runId || worker.workerId || "selected worker"} and resolve the declared FAIL/blockers before rerun`,
      "rerun only this worker after explicit operator approval if the fix requires fresh evidence",
      "rebuild fanout outcome after the worker contract passes",
    ];
  }
  if (failureKind === "worker-not-terminal") {
    return [
      `check registry/log state for ${worker.runId || worker.workerId || "selected worker"}`,
      "do not select another worker until this run is terminal or explicitly abandoned",
      "rebuild fanout outcome after registry state is corrected",
    ];
  }
  return [
    `resolve ${failureKind} for ${worker.runId || worker.workerId || "selected worker"}`,
    "rerun or re-evaluate the selected worker only after the underlying blocker is addressed",
    "rebuild fanout outcome before promotion",
  ];
}

export function buildAgentRunDriverFanoutRecoveryNext(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const sourcePath = options.sourcePath || DEFAULT_SOURCE;
  const payload = readJsonIfExists(cwd, sourcePath);
  const blockers = [
    ...(payload ? [] : ["fanout-outcome-missing"]),
    ...(payload && payload.mode !== "agent-run-driver-fanout-outcome-report" ? ["fanout-outcome-mode-invalid"] : []),
  ];
  const workersNeedingRecovery = blockers.length === 0 ? failedWorkers(payload) : [];
  const selectedWorker = workersNeedingRecovery[0];
  const complete = blockers.length === 0 && payload?.decision === "pass" && workersNeedingRecovery.length === 0;
  const failureKind = selectedWorker ? classifyFailure(selectedWorker) : "";
  const decision = blockers.length > 0 ? "blocked" : complete ? "complete" : selectedWorker ? "next-action-ready" : "blocked";
  const derivedBlockers = [
    ...blockers,
    ...(blockers.length === 0 && !complete && !selectedWorker ? ["fanout-recovery-worker-missing"] : []),
  ];
  const report = {
    mode: "agent-run-driver-fanout-recovery-next",
    schemaVersion: SCHEMA_VERSION,
    generatedAtIso: new Date().toISOString(),
    decision,
    dispatchAllowed: false,
    processStartAllowed: false,
    automationAllowed: false,
    sourcePath,
    sourceDecision: payload?.decision ?? "missing",
    batchId: payload?.batchId,
    workerCount: payload?.workerCount ?? 0,
    passedWorkerCount: payload?.passedWorkerCount ?? 0,
    failedWorkerCount: workersNeedingRecovery.length,
    selectedWorker: selectedWorker
      ? {
          workerId: selectedWorker.workerId,
          runId: selectedWorker.runId,
          processState: selectedWorker.processState,
          contractDecision: selectedWorker.contractDecision,
          blockers: asArray(selectedWorker.blockers),
          markerFailures: asArray(selectedWorker.markerFailures),
        }
      : null,
    failureKind,
    selectedCommandPreview: selectedWorker ? refreshCommandFor(sourcePath, payload?.planPath) : undefined,
    blockers: derivedBlockers,
    nextActions: decision === "next-action-ready"
      ? nextActionsFor(failureKind, selectedWorker)
      : decision === "complete"
        ? ["fanout outcome is pass; no recovery action is pending"]
        : ["create or fix fanout outcome evidence before selecting recovery action"],
    summary: `agent-run-driver-fanout-recovery-next: decision=${decision} source=${sourcePath} failed=${workersNeedingRecovery.length} selected=${selectedWorker?.workerId ?? "none"} dispatch=no`,
  };
  if (options.outPath) writeJson(cwd, options.outPath, report, options.pretty === true);
  return report;
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-driver-fanout-recovery-next.mjs [--cwd DIR] [--source PATH] [--out PATH] [--pretty]",
    "",
    "Selects the next report-only recovery action from an existing agent-run fanout outcome artifact.",
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
    const report = buildAgentRunDriverFanoutRecoveryNext(args);
    if (!args.outPath) writeJson(path.resolve(args.cwd), DEFAULT_OUT, report, args.pretty);
    process.stdout.write(JSON.stringify(report, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (report.decision === "blocked") process.exit(1);
  }
}
