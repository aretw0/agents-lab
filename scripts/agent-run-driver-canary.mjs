#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { runAgentRunDriverStep } from "./agent-run-driver-step.mjs";

const SCHEMA_VERSION = 1;
const DEFAULT_RUN_ID = "agent-run-driver-local-node-version-canary";
const DEFAULT_OUT = ".artifacts/agent-run-driver/latest.json";
const DEFAULT_MUTATION_TARGET = ".artifacts/agent-run-driver/mutation-target.txt";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    runId: DEFAULT_RUN_ID,
    outPath: DEFAULT_OUT,
    mode: "read-only",
    execute: true,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--mode") out.mode = argv[++index] ?? out.mode;
    else if (arg === "--run-id") out.runId = argv[++index] ?? out.runId;
    else if (arg === "--out") out.outPath = argv[++index] ?? out.outPath;
    else if (arg === "--preview") out.execute = false;
    else if (arg === "--execute") out.execute = true;
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function structuredApproval() {
  return {
    packet_mode: "operator-approval-packet",
    approved: true,
    approval_state: "approved",
    approval_reason: "bounded local node --version canary",
  };
}

function buildCanaryPayload({ cwd, runId, execute, mode }) {
  const mutationMode = mode === "mutation";
  const mutationTarget = DEFAULT_MUTATION_TARGET;
  return {
    run_spec: {
      run_id: runId,
      provider_model_ref: "local/process",
      cwd,
      declared_files: mutationMode ? [mutationTarget] : ["package.json"],
      log_path: `.pi/reports/${runId}.log`,
      timeout_ms: 30_000,
      file_contract: mutationMode ? "mutation" : "read-only",
      execution_preview: {
        command: process.execPath,
        args: mutationMode
          ? ["-e", "require('node:fs').writeFileSync(process.argv[1], `driver canary ${Date.now()}\\n`)", mutationTarget]
          : ["--version"],
      },
    },
    execute,
    ...(execute ? { operator_approval: structuredApproval() } : {}),
    follow: true,
    build_outcome: true,
    follow_max_wait_ms: 5_000,
    follow_poll_interval_ms: 100,
    follow_max_lines: 40,
    ...(mutationMode ? {
      touched_files: [mutationTarget],
      mutation_target_files: [mutationTarget],
      marker_results: [{ label: "mutation-target-written", ok: true }],
    } : {}),
  };
}

export async function runAgentRunDriverCanary(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const runId = options.runId || DEFAULT_RUN_ID;
  const execute = options.execute !== false;
  const mode = options.mode === "mutation" ? "mutation" : "read-only";
  if (mode === "mutation") {
    const mutationPath = path.join(cwd, DEFAULT_MUTATION_TARGET);
    mkdirSync(path.dirname(mutationPath), { recursive: true });
    if (!existsSync(mutationPath) || execute) {
      writeFileSync(mutationPath, "", "utf8");
    }
  }
  const driverStep = await runAgentRunDriverStep(buildCanaryPayload({ cwd, runId, execute, mode }), cwd);
  const outcome = driverStep.agentRunOutcomePacket;
  const report = {
    mode: "agent-run-driver-canary-report",
    schemaVersion: SCHEMA_VERSION,
    canaryMode: mode,
    decision: driverStep.decision,
    runId,
    dispatchAllowed: driverStep.dispatchAllowed,
    processStartAllowed: driverStep.processStartAllowed,
    followTerminal: driverStep.follow?.terminal === true,
    followDecision: driverStep.follow?.decision,
    followState: driverStep.follow?.status?.state,
    outputBytes: driverStep.follow?.outputBytes,
    contractDecision: outcome?.contractDecision,
    fileContract: outcome?.fileContract ?? driverStep.runSpec?.fileContract,
    touchedFiles: outcome?.touchedFiles,
    mutationTargetFiles: mode === "mutation" ? [DEFAULT_MUTATION_TARGET] : [],
    blockers: [
      ...(Array.isArray(driverStep.blockers) ? driverStep.blockers : []),
      ...(Array.isArray(outcome?.blockers) ? outcome.blockers : []),
    ],
    driverStep,
    summary: `agent-run-driver-canary: decision=${driverStep.decision} runId=${runId} dispatch=${driverStep.dispatchAllowed ? "yes" : "no"} contract=${outcome?.contractDecision ?? "not-built"}`,
  };
  return report;
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-driver-canary.mjs [--mode read-only|mutation] [--preview|--execute] [--cwd DIR] [--run-id ID] [--out PATH] [--pretty]",
    "",
    "Runs a bounded local canary through agent-run-driver-step.",
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
    const report = await runAgentRunDriverCanary(args);
    const json = JSON.stringify(report, null, args.pretty ? 2 : 0);
    const outPath = path.resolve(args.cwd, args.outPath);
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${json}\n`, "utf8");
    process.stdout.write(json);
    process.stdout.write("\n");
    if (report.decision === "blocked") process.exit(1);
  }
}
