#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    planPath: ".artifacts/agent-run-driver/pi-provider-fanout-plan.json",
    dispatchPaths: [],
    outPath: "",
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--plan") out.planPath = argv[++index] ?? out.planPath;
    else if (arg === "--dispatch") out.dispatchPaths.push(argv[++index] ?? "");
    else if (arg === "--out") out.outPath = argv[++index] ?? out.outPath;
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function readJson(cwd, relPath) {
  const fullPath = path.resolve(cwd, relPath);
  return existsSync(fullPath) ? JSON.parse(readFileSync(fullPath, "utf8")) : undefined;
}

function workerIdFor(packet, index) {
  return String(packet?.workerId ?? packet?.workerPacketId ?? `worker-${index}`).trim();
}

function runIdFor(packet) {
  return String(packet?.payload?.run_spec?.run_id ?? packet?.driverStepCall?.params?.run_spec?.run_id ?? "").trim();
}

function outcomeFor(dispatch) {
  return dispatch?.agentRunOutcomePacket ?? dispatch?.driverStep?.agentRunOutcomePacket;
}

function buildDispatchByRunId(dispatchReports) {
  const out = new Map();
  for (const report of dispatchReports) {
    const runId = String(report?.runId ?? report?.driverStep?.runSpec?.runId ?? outcomeFor(report)?.runId ?? "").trim();
    if (runId) out.set(runId, report);
  }
  return out;
}

export function buildLocalSafeFanoutOutcome(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const planPath = String(options.planPath || ".artifacts/agent-run-driver/pi-provider-fanout-plan.json");
  const plan = readJson(cwd, planPath);
  const blockers = [];
  if (!plan) blockers.push("fanout-plan-missing");
  if (plan && plan.mode !== "agent-run-pi-provider-fanout-plan") blockers.push("fanout-plan-mode-invalid");
  if (plan && plan.source !== "local-safe-board") blockers.push("fanout-plan-source-not-local-safe");
  if (plan && plan.decision !== "ready-for-operator-decision") blockers.push("fanout-plan-not-ready");

  const dispatchPaths = Array.isArray(options.dispatchPaths) ? options.dispatchPaths.filter(Boolean) : [];
  const dispatchReports = dispatchPaths.map((dispatchPath) => readJson(cwd, dispatchPath)).filter(Boolean);
  const dispatchByRunId = buildDispatchByRunId(dispatchReports);
  const workerPackets = Array.isArray(plan?.workerPackets) ? plan.workerPackets : [];
  const workerSummaries = workerPackets.map((packet, index) => {
    const workerId = workerIdFor(packet, index);
    const runId = runIdFor(packet);
    const dispatch = dispatchByRunId.get(runId);
    const outcome = outcomeFor(dispatch);
    const workerBlockers = [];
    if (!runId) workerBlockers.push("run-id-missing");
    if (!dispatch) workerBlockers.push("dispatch-report-missing");
    if (dispatch && dispatch.terminalProcessState !== "completed") workerBlockers.push(`process-state-${dispatch.terminalProcessState ?? "unknown"}`);
    if (!outcome) workerBlockers.push("outcome-packet-missing");
    if (outcome && outcome.contractDecision !== "pass") workerBlockers.push(`outcome-contract-${outcome.contractDecision ?? "unknown"}`);
    if (outcome && Array.isArray(outcome.blockers) && outcome.blockers.length > 0) workerBlockers.push(...outcome.blockers.map((blocker) => `outcome-blocker:${blocker}`));
    return {
      workerId,
      runId,
      processState: dispatch?.terminalProcessState,
      contractDecision: outcome?.contractDecision,
      outputBytes: outcome?.outputBytes,
      blockers: [...new Set(workerBlockers)],
      decision: workerBlockers.length === 0 ? "pass" : "block",
    };
  });

  if (workerPackets.length === 0) blockers.push("fanout-workers-missing");
  blockers.push(...workerSummaries.flatMap((worker) => worker.blockers.map((blocker) => `${worker.workerId}:${blocker}`)));
  const decision = blockers.length === 0 ? "pass" : "block";
  return {
    mode: "agent-run-pi-provider-local-safe-fanout-outcome",
    schemaVersion: SCHEMA_VERSION,
    planPath,
    decision,
    recommendation: decision === "pass" ? "allow-parent-materialization-review" : "block-parent-materialization",
    dispatchAllowed: false,
    processStartAllowed: false,
    workflowDispatchAllowed: false,
    tagAllowed: false,
    publishAllowed: false,
    workerCount: workerPackets.length,
    passedWorkerCount: workerSummaries.filter((worker) => worker.decision === "pass").length,
    workerSummaries,
    blockers: [...new Set(blockers)],
    nextActions: decision === "pass"
      ? ["parent may review evidence before editing .project/tasks.json"]
      : ["resolve worker outcome blockers before materializing board tasks"],
    summary: `local-safe-fanout-outcome: decision=${decision} workers=${workerPackets.length} passed=${workerSummaries.filter((worker) => worker.decision === "pass").length} dispatch=no`,
  };
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-pi-provider-local-safe-fanout-outcome.mjs --plan PATH --dispatch PATH [--dispatch PATH] [--out PATH]",
    "",
    "Aggregates local-safe board fanout worker dispatch reports. It never dispatches or edits the board.",
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
    const result = buildLocalSafeFanoutOutcome(args);
    if (args.outPath) {
      const outPath = path.resolve(args.cwd, args.outPath);
      mkdirSync(path.dirname(outPath), { recursive: true });
      writeFileSync(outPath, `${JSON.stringify(result, null, args.pretty ? 2 : 0)}\n`, "utf8");
    }
    process.stdout.write(`${JSON.stringify(result, null, args.pretty ? 2 : 0)}\n`);
    if (result.decision === "block") process.exit(1);
  }
}
