#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { runAgentRunDriverStep } from "./agent-run-driver-step.mjs";

const SCHEMA_VERSION = 1;
const DEFAULT_PLAN = ".artifacts/agent-run-driver/pi-provider-fanout-plan.json";
const DEFAULT_OUT = ".artifacts/agent-run-driver/fanout-outcome.json";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    planPath: DEFAULT_PLAN,
    outPath: DEFAULT_OUT,
    followMaxLines: 80,
    exitZeroOnBlock: false,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--plan") out.planPath = argv[++index] ?? out.planPath;
    else if (arg === "--out") out.outPath = argv[++index] ?? out.outPath;
    else if (arg === "--follow-max-lines") out.followMaxLines = Number(argv[++index] ?? out.followMaxLines);
    else if (arg === "--exit-zero-on-block") out.exitZeroOnBlock = true;
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value, pretty = false) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function displayPath(value) {
  return asString(value).replace(/\\/g, "/");
}

function asWorkers(plan) {
  if (Array.isArray(plan?.workerPackets)) return plan.workerPackets;
  if (Array.isArray(plan?.workerSpecs)) return plan.workerSpecs;
  if (Array.isArray(plan?.workers)) return plan.workers;
  return [];
}

function runSpecFrom(worker) {
  return worker?.driverStepCall?.params?.run_spec
    ?? worker?.driver_step_call?.params?.run_spec
    ?? worker?.payload?.run_spec
    ?? worker?.runSpec
    ?? worker?.run_spec
    ?? {};
}

function driverStepPayloadFor(worker, followMaxLines) {
  const call = worker?.driverStepCall ?? worker?.driver_step_call;
  if (call?.params && typeof call.params === "object" && !Array.isArray(call.params)) {
    return {
      ...call,
      params: {
        ...call.params,
        execute: false,
        follow: true,
        build_outcome: true,
        follow_max_wait_ms: 0,
        follow_max_lines: followMaxLines,
      },
    };
  }
  const runSpec = runSpecFrom(worker);
  return {
    run_spec: runSpec,
    execute: false,
    follow: true,
    build_outcome: true,
    follow_max_wait_ms: 0,
    follow_max_lines: followMaxLines,
  };
}

function workerIdFor(worker, plan, index) {
  const explicit = asString(worker?.workerId) || asString(worker?.worker_id) || asString(worker?.workerPacketId) || asString(worker?.taskId);
  if (explicit) return explicit;
  const runId = asString(runSpecFrom(worker)?.run_id);
  const prefix = asString(plan?.batchId) ? `${plan.batchId}-` : "";
  return prefix && runId.startsWith(prefix) ? runId.slice(prefix.length) : `worker-${index}`;
}

function summarizeWorker({ worker, plan, index, driverStep, cwd }) {
  const runSpec = runSpecFrom(worker);
  const outcome = driverStep?.agentRunOutcomePacket;
  const rawLogPath = driverStep?.follow?.logPath || driverStep?.runSpec?.logPath || asString(runSpec?.log_path);
  const logPath = rawLogPath
    ? displayPath(path.isAbsolute(rawLogPath) ? path.relative(cwd, rawLogPath) || rawLogPath : rawLogPath)
    : "";
  return {
    workerId: workerIdFor(worker, plan, index),
    runId: driverStep?.runSpec?.runId || asString(runSpec?.run_id),
    logPath,
    decision: driverStep?.decision ?? "missing",
    dispatchAllowed: false,
    processStartAllowed: false,
    followTerminal: driverStep?.follow?.terminal === true,
    processState: driverStep?.follow?.status?.state ?? "unknown",
    outputBytes: driverStep?.follow?.outputBytes ?? 0,
    contractDecision: outcome?.contractDecision ?? "not-built",
    markerFailures: Array.isArray(outcome?.markerFailures) ? outcome.markerFailures : [],
    blockers: [
      ...(Array.isArray(driverStep?.blockers) ? driverStep.blockers : []),
      ...(Array.isArray(outcome?.blockers) ? outcome.blockers : []),
    ],
    declaredFiles: Array.isArray(outcome?.declaredFiles) ? outcome.declaredFiles : [],
    touchedFiles: Array.isArray(outcome?.touchedFiles) ? outcome.touchedFiles : [],
  };
}

export async function runAgentRunDriverFanoutOutcome(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const planPath = path.resolve(cwd, options.planPath || DEFAULT_PLAN);
  const blockers = [];
  if (!existsSync(planPath)) blockers.push("fanout-plan-missing");
  const plan = blockers.length === 0 ? readJson(planPath) : undefined;
  const workers = asWorkers(plan);
  if (plan && workers.length === 0) blockers.push("workers-missing");

  const followMaxLines = Number.isInteger(options.followMaxLines) && options.followMaxLines > 0 ? Math.min(options.followMaxLines, 500) : 80;
  const driverSteps = blockers.length === 0
    ? await Promise.all(workers.map((worker) => runAgentRunDriverStep(driverStepPayloadFor(worker, followMaxLines), cwd)))
    : [];
  const workerSummaries = driverSteps.map((driverStep, index) => summarizeWorker({
    worker: workers[index],
    plan,
    index,
    driverStep,
    cwd,
  }));
  const aggregateBlockers = [
    ...blockers,
    ...workerSummaries.flatMap((worker) => worker.blockers.map((blocker) => `${worker.workerId}:${blocker}`)),
    ...workerSummaries.filter((worker) => worker.followTerminal !== true).map((worker) => `${worker.workerId}:not-terminal`),
    ...workerSummaries.filter((worker) => worker.contractDecision !== "pass").map((worker) => `${worker.workerId}:contract-not-pass:${worker.contractDecision}`),
  ];
  const passedWorkerCount = workerSummaries.filter((worker) => worker.followTerminal === true && worker.contractDecision === "pass" && worker.blockers.length === 0).length;
  const decision = aggregateBlockers.length === 0 && passedWorkerCount === workerSummaries.length ? "pass" : "block";
  const report = {
    mode: "agent-run-driver-fanout-outcome-report",
    schemaVersion: SCHEMA_VERSION,
    generatedAtIso: new Date().toISOString(),
    planPath: displayPath(path.relative(cwd, planPath) || planPath),
    batchId: plan?.batchId,
    sourceMode: plan?.mode,
    decision,
    recommendation: decision === "pass" ? "promote-evidence" : "resolve-worker-outcomes",
    dispatchAllowed: false,
    processStartAllowed: false,
    batchExecutionAllowed: false,
    workerCount: workerSummaries.length,
    passedWorkerCount,
    workerSummaries,
    batchOutcomePacket: {
      mode: "agent-run-batch-outcome-packet",
      schemaVersion: SCHEMA_VERSION,
      decision,
      recommendation: decision === "pass" ? "stop" : "block",
      recommendationCode: decision === "pass" ? "agent-run-batch-outcome-pass" : "agent-run-batch-outcome-block",
      batchId: plan?.batchId,
      workerCount: workerSummaries.length,
      passedWorkerCount,
      workerSummaries: workerSummaries.map((worker) => ({
        runId: worker.runId,
        logPath: worker.logPath,
        processState: worker.processState,
        contractDecision: worker.contractDecision,
        touchedFileCount: worker.touchedFiles.length,
        outputBytes: worker.outputBytes,
        markerFailureCount: worker.markerFailures.length,
      })),
    },
    blockers: aggregateBlockers,
    summary: `agent-run-driver-fanout-outcome: decision=${decision} batchId=${plan?.batchId ?? "missing"} workers=${workerSummaries.length} passed=${passedWorkerCount} blockers=${aggregateBlockers.length} dispatch=no`,
  };
  writeJson(path.resolve(cwd, options.outPath || DEFAULT_OUT), report, options.pretty === true);
  return report;
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-driver-fanout-outcome.mjs [--cwd DIR] [--plan PATH] [--out PATH] [--follow-max-lines N] [--exit-zero-on-block] [--pretty]",
    "",
    "Re-evaluates existing fanout worker registry/log evidence through agent-run-driver-step without dispatching processes.",
    `Default plan: ${DEFAULT_PLAN}`,
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
    const report = await runAgentRunDriverFanoutOutcome(args);
    process.stdout.write(JSON.stringify(report, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (report.decision === "block" && args.exitZeroOnBlock !== true) process.exit(1);
  }
}
