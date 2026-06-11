#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { runAgentRunDriverStep } from "./agent-run-driver-step.mjs";

const SCHEMA_VERSION = 1;
const DEFAULT_OUT = ".artifacts/agent-run-driver/fanout-rehearsal.json";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    outPath: DEFAULT_OUT,
    batchId: "agent-run-driver-local-fanout-rehearsal",
    execute: true,
    manifestPath: "",
    maxConcurrency: 2,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--out") out.outPath = argv[++index] ?? out.outPath;
    else if (arg === "--batch-id") out.batchId = argv[++index] ?? out.batchId;
    else if (arg === "--manifest") out.manifestPath = argv[++index] ?? "";
    else if (arg === "--max-concurrency") out.maxConcurrency = Number(argv[++index] ?? out.maxConcurrency);
    else if (arg === "--preview") out.execute = false;
    else if (arg === "--execute") out.execute = true;
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function readJson(relOrAbsPath, cwd) {
  const filePath = path.resolve(cwd, relOrAbsPath);
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function structuredApproval(workerId) {
  return {
    packet_mode: "operator-approval-packet",
    approved: true,
    approval_state: "approved",
    approval_reason: `bounded local fan-out rehearsal worker ${workerId}`,
  };
}

function defaultWorkerSpecs() {
  return [{ workerId: "worker-a" }, { workerId: "worker-b" }];
}

function workerPayload({ cwd, batchId, workerId, execute, runSpec }) {
  const runId = `${batchId}-${workerId}`;
  return {
    run_spec: {
      run_id: runId,
      provider_model_ref: "local/process",
      cwd,
      declared_files: ["package.json"],
      log_path: `.pi/reports/${runId}.log`,
      timeout_ms: 30_000,
      file_contract: "read-only",
      execution_preview: {
        command: process.execPath,
        args: ["-e", `console.log(${JSON.stringify(`fanout-rehearsal:${workerId}`)})`],
      },
      ...(runSpec ?? {}),
    },
    execute,
    ...(execute ? { operator_approval: structuredApproval(workerId) } : {}),
    follow: true,
    build_outcome: true,
    follow_max_wait_ms: 5_000,
    follow_poll_interval_ms: 100,
    follow_max_lines: 20,
  };
}

function normalizeManifestWorkers(options, cwd) {
  const source = options.workerSpecs
    ?? options.workers
    ?? (options.manifestPath ? readJson(options.manifestPath, cwd) : undefined);
  const rawWorkers = Array.isArray(source) ? source : Array.isArray(source?.workerSpecs) ? source.workerSpecs : Array.isArray(source?.workers) ? source.workers : undefined;
  const workers = rawWorkers ?? defaultWorkerSpecs();
  return workers.map((worker, index) => {
    const workerId = typeof worker?.workerId === "string" && worker.workerId.trim()
      ? worker.workerId.trim()
      : typeof worker?.worker_id === "string" && worker.worker_id.trim()
        ? worker.worker_id.trim()
        : "";
    const runSpec = worker?.runSpec && typeof worker.runSpec === "object"
      ? worker.runSpec
      : worker?.run_spec && typeof worker.run_spec === "object"
        ? worker.run_spec
        : undefined;
    return {
      workerId,
      index,
      runSpec,
      manifestSource: rawWorkers ? "custom" : "default",
    };
  });
}

function validateWorkerSpecs(workerSpecs, batchId) {
  const blockers = [];
  if (workerSpecs.length === 0) blockers.push("workers-missing");
  const workerIds = new Set();
  const runIds = new Set();
  for (const worker of workerSpecs) {
    if (!worker.workerId) {
      blockers.push(`worker-id-missing:${worker.index}`);
      continue;
    }
    if (workerIds.has(worker.workerId)) blockers.push(`duplicate-worker-id:${worker.workerId}`);
    workerIds.add(worker.workerId);
    const runId = String(worker.runSpec?.run_id ?? worker.runSpec?.runId ?? `${batchId}-${worker.workerId}`);
    if (runIds.has(runId)) blockers.push(`duplicate-run-id:${runId}`);
    runIds.add(runId);
  }
  return blockers;
}

function workerPassed(worker) {
  return worker?.decision === "dispatched"
    && worker?.follow?.terminal === true
    && worker?.agentRunOutcomePacket?.contractDecision === "pass"
    && Array.isArray(worker?.blockers)
    && worker.blockers.length === 0
    && Array.isArray(worker?.agentRunOutcomePacket?.blockers)
    && worker.agentRunOutcomePacket.blockers.length === 0;
}

function normalizeMaxConcurrency(value) {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

async function runBounded(items, maxConcurrency, workerFn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(maxConcurrency, items.length);
  const runners = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await workerFn(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function writeJson(cwd, relPath, value, pretty = false) {
  const outPath = path.resolve(cwd, relPath);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
}

export async function runAgentRunDriverFanoutRehearsal(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const batchId = String(options.batchId || "agent-run-driver-local-fanout-rehearsal").trim();
  const execute = options.execute !== false;
  const maxConcurrency = normalizeMaxConcurrency(options.maxConcurrency ?? 2);
  const pretty = options.pretty === true;
  const workerSpecs = normalizeManifestWorkers(options, cwd);
  const manifestSource = workerSpecs.some((worker) => worker.manifestSource === "custom") ? "custom" : "default";
  const setupBlockers = [
    ...(maxConcurrency > 0 ? [] : ["max-concurrency-invalid"]),
    ...validateWorkerSpecs(workerSpecs, batchId),
  ];
  const workerResults = setupBlockers.length === 0
    ? await runBounded(workerSpecs, maxConcurrency, (workerSpec) => runAgentRunDriverStep(
      workerPayload({ cwd, batchId, workerId: workerSpec.workerId, execute, runSpec: workerSpec.runSpec }),
      cwd,
    ))
    : [];
  const workerSummaries = workerResults.map((worker, index) => ({
    workerId: workerSpecs[index].workerId,
    runId: worker.runSpec.runId,
    decision: worker.decision,
    dispatchAllowed: worker.dispatchAllowed,
    processStartAllowed: worker.processStartAllowed,
    followTerminal: worker.follow?.terminal === true,
    processState: worker.follow?.status?.state ?? "unknown",
    outputBytes: worker.follow?.outputBytes ?? 0,
    contractDecision: worker.agentRunOutcomePacket?.contractDecision ?? "not-built",
    blockers: [
      ...(Array.isArray(worker.blockers) ? worker.blockers : []),
      ...(Array.isArray(worker.agentRunOutcomePacket?.blockers) ? worker.agentRunOutcomePacket.blockers : []),
    ],
  }));
  const blockers = [
    ...setupBlockers,
    ...(!execute ? ["execute-not-requested"] : []),
    ...workerSummaries.flatMap((worker) => worker.blockers.map((blocker) => `${worker.workerId}:${blocker}`)),
    ...workerSummaries.filter((worker) => worker.contractDecision !== "pass").map((worker) => `${worker.workerId}:contract-not-pass:${worker.contractDecision}`),
    ...workerSummaries.filter((worker) => worker.followTerminal !== true).map((worker) => `${worker.workerId}:not-terminal`),
  ];
  const passedWorkerCount = workerResults.filter(workerPassed).length;
  const decision = blockers.length === 0 && passedWorkerCount === workerResults.length ? "pass" : "block";
  const report = {
    mode: "agent-run-driver-fanout-rehearsal-report",
    schemaVersion: SCHEMA_VERSION,
    generatedAtIso: new Date().toISOString(),
    batchId,
    decision,
    executeRequested: execute,
    manifestSource,
    maxConcurrency,
    dispatchAllowed: workerResults.some((worker) => worker.dispatchAllowed === true),
    processStartAllowed: workerResults.some((worker) => worker.processStartAllowed === true),
    workerCount: workerResults.length,
    passedWorkerCount,
    workerSummaries,
    batchOutcomePacket: {
      mode: "agent-run-batch-outcome-packet",
      schemaVersion: SCHEMA_VERSION,
      decision,
      recommendation: decision === "pass" ? "stop" : "block",
      recommendationCode: decision === "pass" ? "agent-run-batch-outcome-pass" : "agent-run-batch-outcome-block",
      batchId,
      maxConcurrency,
      workerCount: workerResults.length,
      passedWorkerCount,
      workerSummaries: workerSummaries.map((worker) => ({
        runId: worker.runId,
        processState: worker.processState,
        contractDecision: worker.contractDecision,
        touchedFileCount: 0,
        outputBytes: worker.outputBytes,
      })),
    },
    blockers,
    summary: `agent-run-driver-fanout-rehearsal: decision=${decision} batchId=${batchId} workers=${workerResults.length} passed=${passedWorkerCount} blockers=${blockers.length}`,
  };
  writeJson(cwd, options.outPath || DEFAULT_OUT, report, pretty);
  return report;
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-driver-fanout-rehearsal.mjs [--execute|--preview] [--cwd DIR] [--batch-id ID] [--manifest PATH] [--max-concurrency N] [--out PATH] [--pretty]",
    "",
    "Runs bounded local driver workers from a manifest, or two default read-only workers, and aggregates a fail-closed batch outcome.",
    `Default output path: ${DEFAULT_OUT}`,
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
    const report = await runAgentRunDriverFanoutRehearsal(args);
    process.stdout.write(JSON.stringify(report, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (report.decision === "block") process.exit(1);
  }
}
