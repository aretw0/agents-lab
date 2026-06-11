#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { buildAgentRunPiProviderReadiness } from "./agent-run-pi-provider-readiness.mjs";
import { runAgentRunPiProviderWorkerDispatch } from "./agent-run-pi-provider-worker-dispatch.mjs";
import { writeAgentRunPiProviderFanoutPlan } from "./agent-run-pi-provider-fanout-plan.mjs";

const SCHEMA_VERSION = 1;
const DEFAULT_PLAN = ".artifacts/agent-run-driver/pi-provider-fanout-plan.json";
const DEFAULT_OUT = ".artifacts/agent-run-driver/pi-provider-canary.json";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    outPath: DEFAULT_OUT,
    planPath: DEFAULT_PLAN,
    workerIndex: 0,
    workerId: "",
    execute: false,
    approve: false,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--out") out.outPath = argv[++index] ?? out.outPath;
    else if (arg === "--plan") out.planPath = argv[++index] ?? out.planPath;
    else if (arg === "--worker-index") out.workerIndex = Number(argv[++index] ?? "");
    else if (arg === "--worker-id") out.workerId = argv[++index] ?? "";
    else if (arg === "--execute") out.execute = true;
    else if (arg === "--preview") out.execute = false;
    else if (arg === "--approve") out.approve = true;
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function writeJson(cwd, relPath, value, pretty = false) {
  const outPath = path.resolve(cwd, relPath);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
}

function canaryDecision({ fanoutPlan, providerReadiness, workerDispatch, executeRequested }) {
  if (fanoutPlan.decision === "blocked") return "blocked";
  if (providerReadiness.decision === "blocked") return "blocked";
  if (workerDispatch.decision === "blocked") return "blocked";
  if (executeRequested) return workerDispatch.decision;
  return "ready-for-operator-decision";
}

export async function runAgentRunPiProviderCanary(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const planPath = options.planPath || DEFAULT_PLAN;
  const executeRequested = options.execute === true;
  const fanoutPlan = writeAgentRunPiProviderFanoutPlan({
    cwd,
    outPath: planPath,
    pretty: options.pretty === true,
  });
  const providerReadiness = buildAgentRunPiProviderReadiness({ cwd, planPath });
  const workerDispatch = await runAgentRunPiProviderWorkerDispatch({
    cwd,
    planPath,
    workerIndex: options.workerIndex ?? 0,
    workerId: options.workerId ?? "",
    execute: executeRequested,
    approve: options.approve === true,
  });
  const decision = canaryDecision({ fanoutPlan, providerReadiness, workerDispatch, executeRequested });
  const blockers = [
    ...(fanoutPlan.blockers ?? []).map((blocker) => `fanout-plan:${blocker}`),
    ...(providerReadiness.blockers ?? []).map((blocker) => `provider-readiness:${blocker}`),
    ...(workerDispatch.blockers ?? []).map((blocker) => `worker-dispatch:${blocker}`),
  ];

  return {
    mode: "agent-run-pi-provider-canary",
    schemaVersion: SCHEMA_VERSION,
    decision,
    recommendation: decision === "blocked"
      ? "resolve-provider-canary-blockers"
      : executeRequested ? "record-provider-canary-outcome" : "approve-provider-worker-canary",
    executeRequested,
    dispatchAllowed: workerDispatch.dispatchAllowed === true,
    processStartAllowed: workerDispatch.processStartAllowed === true,
    batchExecutionAllowed: false,
    singleRunOnly: true,
    planPath,
    workerIndex: workerDispatch.workerIndex,
    workerId: workerDispatch.workerId,
    runId: workerDispatch.runId,
    fanoutPlan: {
      decision: fanoutPlan.decision,
      workerCount: fanoutPlan.workerCount,
      model: fanoutPlan.model,
      blockers: fanoutPlan.blockers ?? [],
    },
    providerReadiness,
    workerDispatch,
    agentRunOutcomePacket: workerDispatch.agentRunOutcomePacket,
    providerDiagnostics: workerDispatch.providerDiagnostics ?? providerReadiness.providerDiagnostics ?? [],
    providerRecoveryPlan: workerDispatch.providerRecoveryPlan ?? providerReadiness.providerRecoveryPlan,
    blockers,
    nextActions: decision === "blocked"
      ? [
          ...(providerReadiness.decision === "blocked"
            ? providerReadiness.nextActions ?? []
            : workerDispatch.nextActions ?? []),
          "do not select another provider worker until this canary is ready or resolved",
        ]
      : executeRequested
        ? ["record provider canary outcome before widening to more workers"]
        : ["rerun with --execute --approve to dispatch exactly one provider worker canary"],
    summary: `agent-run-pi-provider-canary: decision=${decision} worker=${workerDispatch.workerId ?? "missing"} runId=${workerDispatch.runId ?? "missing"} dispatch=${workerDispatch.dispatchAllowed ? "yes" : "no"}`,
  };
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-pi-provider-canary.mjs [--preview|--execute --approve] [--worker-index N|--worker-id ID] [--out PATH] [--pretty]",
    "",
    "Composes provider fanout plan, provider readiness, and exactly one provider worker dispatch.",
    "It never starts a process unless --execute and structured approval are provided and readiness is clear.",
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
    const result = await runAgentRunPiProviderCanary(args);
    if (args.outPath) writeJson(path.resolve(args.cwd), args.outPath, result, args.pretty);
    process.stdout.write(JSON.stringify(result, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (result.decision === "blocked") process.exit(1);
  }
}
