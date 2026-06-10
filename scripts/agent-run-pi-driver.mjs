#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";
import { buildPiDriverStepPayload } from "./agent-run-pi-driver-payload.mjs";
import { runAgentRunDriverStep } from "./agent-run-driver-step.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    mode: "help",
    runId: "",
    logPath: "",
    model: "",
    prompt: "",
    files: [],
    tools: [],
    fileContract: "read-only",
    touchedFiles: [],
    mutationTargetFiles: [],
    markerResults: [],
    execute: false,
    approve: false,
    follow: false,
    buildOutcome: false,
    summary: false,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--mode") out.mode = argv[++index] ?? out.mode;
    else if (arg === "--run-id") out.runId = argv[++index] ?? out.runId;
    else if (arg === "--log-path") out.logPath = argv[++index] ?? out.logPath;
    else if (arg === "--model") out.model = argv[++index] ?? out.model;
    else if (arg === "--prompt") out.prompt = argv[++index] ?? out.prompt;
    else if (arg === "--file") out.files.push(argv[++index] ?? "");
    else if (arg === "--tool") out.tools.push(argv[++index] ?? "");
    else if (arg === "--file-contract") out.fileContract = argv[++index] ?? out.fileContract;
    else if (arg === "--touched-file") out.touchedFiles.push(argv[++index] ?? "");
    else if (arg === "--mutation-target-file") out.mutationTargetFiles.push(argv[++index] ?? "");
    else if (arg === "--marker") {
      const raw = argv[++index] ?? "";
      const [label, state = "true"] = raw.split("=");
      out.markerResults.push({ label, ok: state !== "false" && state !== "fail" });
    }
    else if (arg === "--execute") out.execute = true;
    else if (arg === "--approve") out.approve = true;
    else if (arg === "--follow") out.follow = true;
    else if (arg === "--build-outcome") out.buildOutcome = true;
    else if (arg === "--summary") out.summary = true;
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
  };
}

export async function runPiDriver(options = {}) {
  const payloadPacket = buildPiDriverStepPayload({
    cwd: options.cwd,
    mode: options.mode,
    runId: options.runId,
    logPath: options.logPath,
    model: options.model,
    prompt: options.prompt,
    files: options.files,
    tools: options.tools,
    fileContract: options.fileContract,
  });

  if (payloadPacket.decision === "blocked") {
    return {
      mode: "agent-run-pi-driver",
      decision: "blocked",
      dispatchAllowed: false,
      processStartAllowed: false,
      payloadPacket,
      blockers: payloadPacket.blockers ?? [],
    };
  }

  const driverPayload = {
    ...payloadPacket.payload,
    run_spec: {
      ...payloadPacket.payload.run_spec,
      file_contract: options.fileContract === "mutation" ? "mutation" : "read-only",
    },
    execute: options.execute === true,
    ...(options.approve === true ? { operator_approval: structuredApproval() } : {}),
    follow: options.follow === true,
    build_outcome: options.buildOutcome === true,
    ...(Array.isArray(options.touchedFiles) && options.touchedFiles.length > 0 ? { touched_files: options.touchedFiles } : {}),
    ...(Array.isArray(options.markerResults) && options.markerResults.length > 0 ? { marker_results: options.markerResults } : {}),
    ...(Array.isArray(options.mutationTargetFiles) && options.mutationTargetFiles.length > 0 ? { mutation_target_files: options.mutationTargetFiles } : {}),
  };
  const driverStep = await runAgentRunDriverStep(driverPayload, options.cwd || process.cwd());

  return {
    mode: "agent-run-pi-driver",
    decision: driverStep.decision,
    dispatchAllowed: driverStep.dispatchAllowed,
    processStartAllowed: driverStep.processStartAllowed,
    payloadPacket,
    driverStep,
    summary: `agent-run-pi-driver: decision=${driverStep.decision} mode=${options.mode || "help"} dispatch=${driverStep.dispatchAllowed ? "yes" : "no"}`,
  };
}

export function buildPiDriverSummary(result) {
  const driverStep = result?.driverStep ?? {};
  const runSpec = driverStep.runSpec ?? {};
  const follow = driverStep.follow ?? {};
  const outcome = driverStep.agentRunOutcomePacket;
  return {
    mode: "agent-run-pi-driver-summary",
    decision: result?.decision ?? "unknown",
    dispatchAllowed: result?.dispatchAllowed === true,
    processStartAllowed: result?.processStartAllowed === true,
    runId: runSpec.runId,
    providerModelRef: runSpec.providerModelRef,
    payloadMode: result?.payloadPacket?.payloadMode ?? "help",
    pid: driverStep.pid,
    followTerminal: follow.terminal === true,
    followDecision: follow.decision,
    followState: follow.status?.state,
    outputBytes: follow.outputBytes,
    contractDecision: outcome?.contractDecision,
    fileContract: outcome?.fileContract ?? driverStep.runSpec?.fileContract,
    touchedFileCount: Array.isArray(outcome?.touchedFiles) ? outcome.touchedFiles.length : undefined,
    markerFailureCount: Array.isArray(outcome?.markerFailures) ? outcome.markerFailures.length : undefined,
    blockers: [
      ...(Array.isArray(result?.blockers) ? result.blockers : []),
      ...(Array.isArray(driverStep.blockers) ? driverStep.blockers : []),
      ...(Array.isArray(outcome?.blockers) ? outcome.blockers : []),
    ],
    logTail: Array.isArray(follow.lines) ? follow.lines.slice(-8) : [],
  };
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-pi-driver.mjs [--mode help|print-readonly] [options] [--execute --approve] [--follow] [--build-outcome] [--summary] [--pretty]",
    "",
    "This composes agent-run-pi-driver-payload and agent-run-driver-step.",
    "It previews by default. Real execution requires both --execute and --approve.",
    "Outcome evidence options: --file-contract read-only|mutation --touched-file PATH --mutation-target-file PATH --marker label=true|false",
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
    const result = await runPiDriver(args);
    const output = args.summary ? buildPiDriverSummary(result) : result;
    process.stdout.write(JSON.stringify(output, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (result.decision === "blocked") process.exit(1);
  }
}
