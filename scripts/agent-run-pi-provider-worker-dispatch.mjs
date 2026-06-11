#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { runAgentRunDriverStep } from "./agent-run-driver-step.mjs";
import { buildAgentRunPiProviderReadiness } from "./agent-run-pi-provider-readiness.mjs";

const SCHEMA_VERSION = 1;
const DEFAULT_PLAN = ".artifacts/agent-run-driver/pi-provider-fanout-plan.json";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    planPath: DEFAULT_PLAN,
    workerIndex: 0,
    workerId: "",
    execute: false,
    skipReadiness: false,
    approve: false,
    operatorApprovalFile: "",
    outPath: "",
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--plan") out.planPath = argv[++index] ?? out.planPath;
    else if (arg === "--worker-index") out.workerIndex = Number(argv[++index] ?? "");
    else if (arg === "--worker-id") out.workerId = argv[++index] ?? "";
    else if (arg === "--execute") out.execute = true;
    else if (arg === "--preview") out.execute = false;
    else if (arg === "--skip-readiness") out.skipReadiness = true;
    else if (arg === "--approve") out.approve = true;
    else if (arg === "--operator-approval-file") out.operatorApprovalFile = argv[++index] ?? "";
    else if (arg === "--out") out.outPath = argv[++index] ?? "";
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

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value, pretty = false) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
}

function asWorkerPackets(plan) {
  return Array.isArray(plan?.workerPackets) ? plan.workerPackets : [];
}

function runIdFor(packet) {
  return packet?.payload?.run_spec?.run_id ?? packet?.driverStepCall?.params?.run_spec?.run_id ?? "";
}

function workerIdFor(packet, plan, index) {
  const explicit = packet?.workerId ?? packet?.workerPacketId;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  const runId = runIdFor(packet);
  const prefix = typeof plan?.batchId === "string" && plan.batchId ? `${plan.batchId}-` : "";
  return prefix && runId.startsWith(prefix) ? runId.slice(prefix.length) : `worker-${index}`;
}

function selectWorker(plan, workerIndex, workerId) {
  const workerPackets = asWorkerPackets(plan);
  if (workerId) {
    const foundIndex = workerPackets.findIndex((packet, index) => workerIdFor(packet, plan, index) === workerId);
    return { index: foundIndex, packet: foundIndex >= 0 ? workerPackets[foundIndex] : undefined };
  }
  const index = Number.isInteger(workerIndex) ? workerIndex : -1;
  return { index, packet: index >= 0 && index < workerPackets.length ? workerPackets[index] : undefined };
}

function approvalFor(options) {
  if (options.operatorApprovalFile) return readJson(path.resolve(options.cwd, options.operatorApprovalFile));
  return options.approve ? structuredApproval() : undefined;
}

function withExecutionIntent(driverStepCall, execute, operatorApproval) {
  const params = driverStepCall?.params && typeof driverStepCall.params === "object" && !Array.isArray(driverStepCall.params)
    ? driverStepCall.params
    : {};
  return {
    ...driverStepCall,
    params: {
      ...params,
      ...(execute ? { execute: true } : {}),
    },
    ...(operatorApproval ? { operator_approval: operatorApproval } : {}),
  };
}

function outcomeBlockersFor(agentRunOutcomePacket) {
  return Array.isArray(agentRunOutcomePacket?.blockers) ? agentRunOutcomePacket.blockers : [];
}

function buildPreview({ plan, planPath, worker, workerIndex, workerId, driverStepCall, blockers }) {
  const runId = runIdFor(worker);
  const decision = blockers.length === 0 ? "ready-for-operator-decision" : "blocked";
  return {
    mode: "agent-run-pi-provider-worker-dispatch",
    schemaVersion: SCHEMA_VERSION,
    decision,
    recommendation: decision === "blocked" ? "resolve-blockers" : "approve-selected-worker",
    planPath,
    batchId: plan?.batchId,
    model: plan?.model,
    workerIndex,
    workerId,
    workerCount: worker ? 1 : 0,
    runId,
    executeRequested: false,
    dispatchAllowed: false,
    processStartAllowed: false,
    batchExecutionAllowed: false,
    singleRunOnly: true,
    driverStepCall,
    blockers,
    nextActions: decision === "blocked"
      ? ["resolve blockers before requesting worker dispatch"]
      : [
          "review selected driverStepCall",
          "rerun with --execute and structured operator approval to start exactly this worker",
          "after terminal run, require agentRunOutcomePacket pass before selecting any next worker",
        ],
    summary: `agent-run-pi-provider-worker-dispatch: decision=${decision} worker=${workerId || "missing"} runId=${runId || "missing"} dispatch=no`,
  };
}

function buildReadinessBlocked({ plan, planPath, worker, workerIndex, workerId, driverStepCall, readiness }) {
  const runId = runIdFor(worker);
  return {
    mode: "agent-run-pi-provider-worker-dispatch",
    schemaVersion: SCHEMA_VERSION,
    decision: "blocked",
    recommendation: "resolve-provider-readiness-blockers",
    planPath,
    batchId: plan?.batchId,
    model: plan?.model,
    workerIndex,
    workerId,
    workerCount: worker ? 1 : 0,
    runId,
    executeRequested: true,
    dispatchAllowed: false,
    processStartAllowed: false,
    batchExecutionAllowed: false,
    singleRunOnly: true,
    driverStepCall,
    providerReadiness: readiness,
    providerDiagnostics: readiness.providerDiagnostics ?? [],
    providerNextActions: readiness.nextActions ?? [],
    blockers: (readiness.blockers ?? []).map((blocker) => `provider-readiness:${blocker}`),
    nextActions: [
      ...(readiness.nextActions ?? ["resolve provider readiness blockers before executing this worker"]),
      "rerun provider readiness after provider auth/connectivity changes",
    ],
    summary: `agent-run-pi-provider-worker-dispatch: decision=blocked worker=${workerId || "missing"} runId=${runId || "missing"} readiness=blocked dispatch=no`,
  };
}

export async function runAgentRunPiProviderWorkerDispatch(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const planPath = path.resolve(cwd, options.planPath || DEFAULT_PLAN);
  const blockers = [];
  if (!existsSync(planPath)) blockers.push("provider-fanout-plan-missing");
  const plan = blockers.length === 0 ? readJson(planPath) : undefined;
  const workerPackets = asWorkerPackets(plan);
  if (plan && plan.mode !== "agent-run-pi-provider-fanout-plan") blockers.push("provider-fanout-plan-mode-invalid");
  if (plan && plan.decision !== "ready-for-operator-decision") blockers.push("provider-fanout-plan-not-ready");
  if (plan && workerPackets.length === 0) blockers.push("worker-packets-missing");

  const selected = plan ? selectWorker(plan, options.workerIndex ?? 0, options.workerId ?? "") : { index: -1, packet: undefined };
  if (plan && !selected.packet) blockers.push("worker-selection-missing");
  const fallbackWorkerId = options.workerId || String(options.workerIndex ?? "missing");
  const workerId = selected.packet ? workerIdFor(selected.packet, plan, selected.index) : fallbackWorkerId;
  const approval = approvalFor({ ...options, cwd });
  const driverStepCall = selected.packet?.driverStepCall
    ? withExecutionIntent(selected.packet.driverStepCall, options.execute === true, approval)
    : undefined;
  if (selected.packet && !driverStepCall) blockers.push("driver-step-call-missing");

  if (options.execute !== true || blockers.length > 0) {
    return buildPreview({
      plan,
      planPath: path.relative(cwd, planPath) || planPath,
      worker: selected.packet,
      workerIndex: selected.index,
      workerId,
      driverStepCall,
      blockers,
    });
  }

  const readiness = options.skipReadiness === true
    ? undefined
    : buildAgentRunPiProviderReadiness({
        cwd,
        planPath: path.relative(cwd, planPath) || planPath,
      });
  if (readiness?.decision === "blocked") {
    return buildReadinessBlocked({
      plan,
      planPath: path.relative(cwd, planPath) || planPath,
      worker: selected.packet,
      workerIndex: selected.index,
      workerId,
      driverStepCall,
      readiness,
    });
  }

  const driverStep = await runAgentRunDriverStep(driverStepCall, cwd);
  const outcomeBlockers = outcomeBlockersFor(driverStep.agentRunOutcomePacket);
  return {
    mode: "agent-run-pi-provider-worker-dispatch",
    schemaVersion: SCHEMA_VERSION,
    decision: driverStep.decision,
    recommendation: driverStep.decision === "dispatched" ? "record-outcome-before-next-worker" : "resolve-blockers",
    planPath: path.relative(cwd, planPath) || planPath,
    batchId: plan.batchId,
    model: plan.model,
    workerIndex: selected.index,
    workerId,
    workerCount: 1,
    runId: runIdFor(selected.packet),
    executeRequested: true,
    dispatchAllowed: driverStep.dispatchAllowed === true,
    processStartAllowed: driverStep.processStartAllowed === true,
    batchExecutionAllowed: false,
    singleRunOnly: true,
    driverStepCall,
    driverStep,
    agentRunOutcomePacket: driverStep.agentRunOutcomePacket,
    terminalProcessState: driverStep.follow?.status?.state,
    contractDecision: driverStep.agentRunOutcomePacket?.contractDecision,
    outcomeBlockers,
    blockers: driverStep.blockers ?? [],
    nextActions: driverStep.agentRunOutcomePacket?.contractDecision === "pass"
      ? ["record this outcome before selecting another worker; do not fan-in until all required outcomes pass"]
      : ["resolve driver step blockers or outcome blockers before selecting any next worker"],
    summary: `agent-run-pi-provider-worker-dispatch: decision=${driverStep.decision} worker=${workerId} runId=${runIdFor(selected.packet)} dispatch=${driverStep.dispatchAllowed ? "yes" : "no"} contract=${driverStep.agentRunOutcomePacket?.contractDecision ?? "not-built"}`,
  };
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-pi-provider-worker-dispatch.mjs [--plan PATH] [--worker-index N|--worker-id ID] [--execute --approve] [--out PATH] [--pretty]",
    "",
    "Selects exactly one worker from agent-run-pi-provider-fanout-plan and previews or dispatches it through agent-run-driver-step.",
    "Default mode is preview-only. Provider execution requires --execute plus structured approval (--approve or --operator-approval-file).",
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
    const result = await runAgentRunPiProviderWorkerDispatch(args);
    const json = JSON.stringify(result, null, args.pretty ? 2 : 0);
    if (args.outPath) writeJson(path.resolve(args.cwd, args.outPath), result, args.pretty);
    process.stdout.write(json);
    process.stdout.write("\n");
    if (result.decision === "blocked") process.exit(1);
  }
}
