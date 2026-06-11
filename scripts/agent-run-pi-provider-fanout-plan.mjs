#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { buildPiPrintReadonlyDriverStepPayload } from "./agent-run-pi-driver-payload.mjs";

const SCHEMA_VERSION = 1;
const DEFAULT_MODEL = "openai-codex/gpt-5.3-codex-spark";
const DEFAULT_OUT = ".artifacts/agent-run-driver/pi-provider-fanout-plan.json";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    outPath: DEFAULT_OUT,
    batchId: "agent-run-pi-provider-fanout-rehearsal",
    model: DEFAULT_MODEL,
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
    else if (arg === "--model") out.model = argv[++index] ?? out.model;
    else if (arg === "--file") out.files.push(argv[++index] ?? "");
    else if (arg === "--execute") out.execute = true;
    else if (arg === "--preview") out.execute = false;
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function promptFor(workerId) {
  return [
    "Provider rehearsal contract: read only declared files; do not edit files; do not launch other agents.",
    `Worker ${workerId}: inspect the declared file set and return PASS/FAIL, concise evidence, blockers, and filesTouched. Keep output under 20 lines.`,
  ].join("\n");
}

function writeJson(cwd, relPath, value, pretty = false) {
  const outPath = path.resolve(cwd, relPath);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
}

export function buildAgentRunPiProviderFanoutPlan(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const batchId = String(options.batchId || "agent-run-pi-provider-fanout-rehearsal").trim();
  const model = String(options.model || DEFAULT_MODEL).trim();
  const files = Array.isArray(options.files) ? options.files.filter(Boolean) : ["package.json"];
  const executeRequested = options.execute === true;
  const workerIds = ["worker-a", "worker-b"];
  const workerPackets = workerIds.map((workerId) => {
    const runId = `${batchId}-${workerId}`;
    return buildPiPrintReadonlyDriverStepPayload({
      cwd,
      runId,
      model,
      files,
      prompt: promptFor(workerId),
      tools: ["read", "grep", "find", "ls"],
      execute: false,
      follow: true,
      buildOutcome: true,
      followMaxWaitMs: 90_000,
      followPollIntervalMs: 500,
      followMaxLines: 80,
    });
  });
  const packetBlockers = workerPackets.flatMap((packet, index) => (
    packet.decision === "blocked"
      ? (packet.blockers ?? []).map((blocker) => `${workerIds[index]}:${blocker}`)
      : []
  ));
  const blockers = [
    ...(executeRequested ? ["execute-not-supported-by-provider-fanout-plan"] : []),
    ...packetBlockers,
  ];
  const decision = blockers.length === 0 ? "ready-for-operator-decision" : "blocked";
  return {
    mode: "agent-run-pi-provider-fanout-plan",
    schemaVersion: SCHEMA_VERSION,
    generatedAtIso: new Date().toISOString(),
    batchId,
    model,
    decision,
    executeRequested,
    dispatchAllowed: false,
    processStartAllowed: false,
    workerDispatchAllowed: false,
    batchExecutionAllowed: false,
    workerCount: workerPackets.length,
    workerPackets,
    nextActions: decision === "ready-for-operator-decision"
      ? [
          "review each workerPackets[*].driverStepCall before approval",
          "execute at most one worker first through agent_run_driver_step_dispatch",
          "after each terminal run, require agent_run_outcome_packet pass before fan-in",
          "only after two pass outcomes, aggregate with fail-closed batch/fan-in",
        ]
      : ["resolve blockers before preparing provider/model rehearsal"],
    blockers,
    summary: `agent-run-pi-provider-fanout-plan: decision=${decision} model=${model} workers=${workerPackets.length} dispatch=no`,
  };
}

export function writeAgentRunPiProviderFanoutPlan(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const report = buildAgentRunPiProviderFanoutPlan(options);
  writeJson(cwd, options.outPath || DEFAULT_OUT, report, options.pretty === true);
  return report;
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-pi-provider-fanout-plan.mjs [--model PROVIDER/MODEL] [--file PATH] [--out PATH] [--pretty]",
    "",
    "Builds a report-only two-worker pi --print provider/model rehearsal plan.",
    "It never starts a process; execute requests are blocked here and must go through agent-run driver-step.",
    `Default model: ${DEFAULT_MODEL}`,
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
    const report = writeAgentRunPiProviderFanoutPlan(args);
    process.stdout.write(JSON.stringify(report, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (report.decision === "blocked") process.exit(1);
  }
}
