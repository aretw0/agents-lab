#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;
const DEFAULT_OUT = ".artifacts/agent-run-driver/fanout-manifest.json";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    outPath: DEFAULT_OUT,
    batchId: "agent-run-driver-local-fanout-rehearsal",
    workerIds: [],
    files: ["package.json"],
    execute: false,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--out") out.outPath = argv[++index] ?? out.outPath;
    else if (arg === "--batch-id") out.batchId = argv[++index] ?? out.batchId;
    else if (arg === "--worker") out.workerIds.push(argv[++index] ?? "");
    else if (arg === "--file") out.files.push(argv[++index] ?? "");
    else if (arg === "--execute") out.execute = true;
    else if (arg === "--preview") out.execute = false;
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function uniqueBlockers(values, prefix) {
  const blockers = [];
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) blockers.push(`${prefix}:${value}`);
    seen.add(value);
  }
  return blockers;
}

function normalizeList(values, fallback) {
  const normalized = values.map((value) => String(value || "").trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : fallback;
}

function writeJson(cwd, relPath, value, pretty = false) {
  const outPath = path.resolve(cwd, relPath);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
}

export function buildAgentRunDriverFanoutManifest(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const batchId = String(options.batchId || "agent-run-driver-local-fanout-rehearsal").trim();
  const workerIds = normalizeList(Array.isArray(options.workerIds) ? options.workerIds : [], ["worker-a", "worker-b"]);
  const files = normalizeList(Array.isArray(options.files) ? options.files : [], ["package.json"]);
  const executeRequested = options.execute === true;
  const runIds = workerIds.map((workerId) => `${batchId}-${workerId}`);
  const blockers = [
    ...(executeRequested ? ["execute-not-supported-by-fanout-manifest"] : []),
    ...(!batchId ? ["batch-id-missing"] : []),
    ...uniqueBlockers(workerIds, "duplicate-worker-id"),
    ...uniqueBlockers(runIds, "duplicate-run-id"),
  ];
  const decision = blockers.length === 0 ? "ready-for-operator-decision" : "blocked";
  const workerSpecs = workerIds.map((workerId) => {
    const runId = `${batchId}-${workerId}`;
    return {
      workerId,
      runSpec: {
        run_id: runId,
        provider_model_ref: "local/process",
        cwd,
        declared_files: files,
        log_path: `.pi/reports/${runId}.log`,
        timeout_ms: 30_000,
        file_contract: "read-only",
        execution_preview: {
          command: process.execPath,
          args: ["-e", `console.log(${JSON.stringify(`fanout-manifest:${workerId}`)})`],
        },
      },
    };
  });
  return {
    mode: "agent-run-driver-fanout-manifest",
    schemaVersion: SCHEMA_VERSION,
    generatedAtIso: new Date().toISOString(),
    batchId,
    decision,
    executeRequested,
    dispatchAllowed: false,
    processStartAllowed: false,
    batchExecutionAllowed: false,
    workerCount: workerSpecs.length,
    workerSpecs,
    rehearsalPreview: {
      command: "node",
      args: [
        "scripts/agent-run-driver-fanout-rehearsal.mjs",
        "--execute",
        "--manifest",
        options.outPath || DEFAULT_OUT,
        "--max-concurrency",
        "1",
      ],
      dispatchAllowed: false,
      processStartAllowed: false,
      shellInterpolationAllowed: false,
    },
    blockers,
    summary: `agent-run-driver-fanout-manifest: decision=${decision} workers=${workerSpecs.length} dispatch=no`,
  };
}

export function writeAgentRunDriverFanoutManifest(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const report = buildAgentRunDriverFanoutManifest(options);
  writeJson(cwd, options.outPath || DEFAULT_OUT, report, options.pretty === true);
  return report;
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-driver-fanout-manifest.mjs [--worker ID] [--file PATH] [--batch-id ID] [--out PATH] [--pretty]",
    "",
    "Builds a report-only fanout manifest consumable by agent-run-driver-fanout-rehearsal.",
    "It never starts workers; execute requests are blocked.",
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
    const report = writeAgentRunDriverFanoutManifest(args);
    process.stdout.write(JSON.stringify(report, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (report.decision === "blocked") process.exit(1);
  }
}
