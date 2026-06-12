#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;
const DEFAULT_DRIVER_STEP_RESULT = ".artifacts/agent-run-driver/protected-board-task-bud-480-approved-driver-step-result.json";
const DEFAULT_FANOUT_OUTCOME = ".artifacts/agent-run-driver/pi-provider-protected-board-fanout-outcome.json";
const DEFAULT_RECOVERY_NEXT = ".artifacts/agent-run-driver/pi-provider-protected-board-recovery-next.json";
const DEFAULT_RECOVERY_APPROVAL = ".artifacts/agent-run-driver/pi-provider-protected-board-recovery-approval.json";
const DEFAULT_OUT = ".artifacts/agent-run-driver/protected-review-evidence.json";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    driverStepResultPath: DEFAULT_DRIVER_STEP_RESULT,
    fanoutOutcomePath: DEFAULT_FANOUT_OUTCOME,
    recoveryNextPath: DEFAULT_RECOVERY_NEXT,
    recoveryApprovalPath: DEFAULT_RECOVERY_APPROVAL,
    outPath: "",
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--driver-step-result") out.driverStepResultPath = argv[++index] ?? out.driverStepResultPath;
    else if (arg === "--fanout-outcome") out.fanoutOutcomePath = argv[++index] ?? out.fanoutOutcomePath;
    else if (arg === "--recovery-next") out.recoveryNextPath = argv[++index] ?? out.recoveryNextPath;
    else if (arg === "--recovery-approval") out.recoveryApprovalPath = argv[++index] ?? out.recoveryApprovalPath;
    else if (arg === "--out") out.outPath = argv[++index] ?? "";
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

function selectedWorkerFrom(driverStep) {
  const runId = String(driverStep?.runSpec?.runId ?? "");
  return {
    runId,
    workerId: runId.replace(/^protected-board-research-0-8-/, ""),
    processState: driverStep?.follow?.status?.state ?? driverStep?.registryEntry?.state ?? "unknown",
    contractDecision: driverStep?.agentRunOutcomePacket?.contractDecision ?? "missing",
    outputBytes: driverStep?.agentRunOutcomePacket?.outputBytes ?? driverStep?.follow?.outputBytes ?? 0,
    touchedFiles: asArray(driverStep?.agentRunOutcomePacket?.touchedFiles),
    blockers: asArray(driverStep?.agentRunOutcomePacket?.blockers),
  };
}

function providerRetrySummary(driverStep) {
  const lines = asArray(driverStep?.follow?.lines).map(String);
  return {
    fetchFailedObservedInFinalAttempt: lines.some((line) => line.includes("fetch failed")),
    terminal: driverStep?.follow?.terminal === true,
    pid: driverStep?.pid,
    exitCode: driverStep?.registryEntry?.exitCode,
  };
}

export function buildAgentRunProtectedReviewEvidence(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const driverStep = readJsonIfExists(cwd, options.driverStepResultPath || DEFAULT_DRIVER_STEP_RESULT);
  const fanoutOutcome = readJsonIfExists(cwd, options.fanoutOutcomePath || DEFAULT_FANOUT_OUTCOME);
  const recoveryNext = readJsonIfExists(cwd, options.recoveryNextPath || DEFAULT_RECOVERY_NEXT);
  const recoveryApproval = readJsonIfExists(cwd, options.recoveryApprovalPath || DEFAULT_RECOVERY_APPROVAL);
  const selectedWorker = driverStep ? selectedWorkerFrom(driverStep) : null;
  const fanoutComplete = fanoutOutcome?.decision === "pass" && Number(fanoutOutcome?.passedWorkerCount ?? 0) === Number(fanoutOutcome?.workerCount ?? -1);
  const nextWorker = fanoutComplete ? null : (recoveryApproval?.selectedWorker ?? recoveryNext?.selectedWorker ?? null);
  const blockers = [
    ...(driverStep ? [] : ["driver-step-result-missing"]),
    ...(driverStep && driverStep.mode !== "agent-run-driver-step-dispatch" ? ["driver-step-result-mode-invalid"] : []),
    ...(driverStep && driverStep.dispatchAllowed !== true ? ["approved-worker-dispatch-not-observed"] : []),
    ...(driverStep && selectedWorker?.contractDecision !== "pass" ? [`approved-worker-contract-not-pass:${selectedWorker?.contractDecision ?? "missing"}`] : []),
    ...(driverStep && selectedWorker?.touchedFiles.length > 0 ? ["approved-read-only-worker-touched-files"] : []),
    ...(fanoutOutcome ? [] : ["fanout-outcome-missing"]),
    ...(fanoutOutcome && fanoutOutcome.mode !== "agent-run-driver-fanout-outcome-report" ? ["fanout-outcome-mode-invalid"] : []),
    ...(recoveryNext ? [] : ["recovery-next-missing"]),
    ...(recoveryApproval ? [] : ["recovery-approval-missing"]),
  ];
  const decision = blockers.length === 0 ? "pass" : "block";
  const report = {
    mode: "agent-run-protected-review-evidence",
    schemaVersion: SCHEMA_VERSION,
    decision,
    recommendation: decision === "pass" ? "continue-protected-review-gate" : "repair-protected-review-evidence",
    driverStepResultPath: options.driverStepResultPath || DEFAULT_DRIVER_STEP_RESULT,
    fanoutOutcomePath: options.fanoutOutcomePath || DEFAULT_FANOUT_OUTCOME,
    recoveryNextPath: options.recoveryNextPath || DEFAULT_RECOVERY_NEXT,
    recoveryApprovalPath: options.recoveryApprovalPath || DEFAULT_RECOVERY_APPROVAL,
    approvedWorker: selectedWorker,
    providerRetrySummary: driverStep ? providerRetrySummary(driverStep) : undefined,
    fanoutProgress: fanoutOutcome
      ? {
          decision: fanoutOutcome.decision ?? "missing",
          workerCount: fanoutOutcome.workerCount ?? 0,
          passedWorkerCount: fanoutOutcome.passedWorkerCount ?? 0,
          complete: fanoutComplete,
          blockers: asArray(fanoutOutcome.blockers),
        }
      : undefined,
    nextProtectedReview: nextWorker
      ? {
          workerId: nextWorker.workerId ?? "",
          runId: nextWorker.runId ?? "",
          requiredApprovalPrompt: recoveryApproval?.requiredApprovalPrompt ?? "",
          approvalScope: recoveryApproval?.approvalScope ?? "",
          decision: recoveryApproval?.decision ?? recoveryNext?.decision ?? "missing",
        }
      : undefined,
    dispatchAllowed: false,
    processStartAllowed: false,
    batchExecutionAllowed: false,
    protectedActionsAllowed: false,
    blockers,
    nextActions: decision === "pass"
      ? fanoutComplete
        ? ["protected review fanout is complete; no recovery approval is pending"]
        : [`present approval prompt exactly: ${recoveryApproval?.requiredApprovalPrompt ?? ""}`]
      : ["rebuild driver-step/fanout/recovery artifacts before asking for another protected approval"],
    summary: `agent-run-protected-review-evidence: decision=${decision} approved=${selectedWorker?.workerId ?? "none"} fanout=${fanoutOutcome?.passedWorkerCount ?? 0}/${fanoutOutcome?.workerCount ?? 0} next=${nextWorker?.workerId ?? "none"} dispatch=no`,
  };
  if (options.outPath) writeJson(cwd, options.outPath, report, options.pretty === true);
  return report;
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-protected-review-evidence.mjs [--driver-step-result PATH] [--fanout-outcome PATH] [--recovery-next PATH] [--recovery-approval PATH] [--out PATH] [--pretty]",
    "",
    "Builds a report-only evidence summary for one approved protected worker and the next protected review gate. It never starts processes or dispatches workers.",
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
    const outPath = args.outPath || DEFAULT_OUT;
    const result = buildAgentRunProtectedReviewEvidence({ ...args, outPath });
    process.stdout.write(JSON.stringify(result, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (result.decision === "block") process.exit(1);
  }
}
