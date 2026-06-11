#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;
const DEFAULT_PLAN = ".artifacts/agent-run-driver/pi-provider-fanout-plan.json";
const DEFAULT_LAST_EXECUTION = ".artifacts/agent-run-driver/pi-provider-worker-a-real-execute.json";
const DEFAULT_NETWORK_CHECK = ".artifacts/agent-run-driver/pi-provider-network-check.json";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    planPath: DEFAULT_PLAN,
    lastExecutionPath: DEFAULT_LAST_EXECUTION,
    networkCheckPath: DEFAULT_NETWORK_CHECK,
    outPath: "",
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--plan") out.planPath = argv[++index] ?? out.planPath;
    else if (arg === "--last-execution") out.lastExecutionPath = argv[++index] ?? out.lastExecutionPath;
    else if (arg === "--network-check") out.networkCheckPath = argv[++index] ?? out.networkCheckPath;
    else if (arg === "--out") out.outPath = argv[++index] ?? "";
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function readJsonIfExists(filePath) {
  return existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf8")) : undefined;
}

function writeJson(filePath, value, pretty = false) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
}

function asWorkerPackets(plan) {
  return Array.isArray(plan?.workerPackets) ? plan.workerPackets : [];
}

function workerEnvKeys(plan) {
  return asWorkerPackets(plan).map((packet) => Object.keys(packet?.payload?.run_spec?.env ?? {}));
}

function collectLogLines(execution) {
  const direct = execution?.driverStep?.follow?.lines;
  return Array.isArray(direct) ? direct.filter((line) => typeof line === "string") : [];
}

export function classifyProviderSignals(lines) {
  const text = lines.join("\n").toLowerCase();
  const signals = [];
  if (text.includes("no api key found")) signals.push("provider-auth-missing");
  if (text.includes("fetch failed")) signals.push("provider-fetch-failed");
  if (text.includes("eperm") && text.includes("settings.json.lock")) signals.push("provider-global-settings-lock-error");
  return signals;
}

function providerNetworkCheckEvidence(payload) {
  if (!payload) return { present: false, decision: "missing" };
  return {
    present: true,
    decision: payload.decision ?? "unknown",
    executeRequested: payload.executeRequested === true,
    networkRequestAllowed: payload.networkRequestAllowed === true,
    networkDecision: payload.networkDecision,
    httpStatus: payload.httpStatus,
    blockers: Array.isArray(payload.blockers) ? payload.blockers : [],
    summary: payload.summary ?? "provider network check artifact present",
  };
}

export function buildProviderDiagnostics({ providerSignals, plan, lastExecution, providerNetworkCheck }) {
  const diagnostics = [];
  if (!plan) {
    diagnostics.push({
      code: "provider-fanout-plan-missing",
      category: "plan",
      severity: "blocker",
      evidence: "provider fanout plan artifact is missing",
      operatorAction: "generate the provider fanout plan before checking readiness",
    });
  }
  if (!lastExecution) {
    diagnostics.push({
      code: "last-provider-execution-missing",
      category: "evidence",
      severity: "warning",
      evidence: "no prior provider execution artifact was found",
      operatorAction: "run a single approved provider canary when all plan-level blockers are clear",
    });
  }
  if (providerSignals.includes("provider-auth-missing")) {
    diagnostics.push({
      code: "provider-auth-missing",
      category: "auth",
      severity: "blocker",
      evidence: "last execution log reported missing provider API key",
      operatorAction: "configure provider credentials for the selected model before executing provider workers",
    });
  }
  if (providerSignals.includes("provider-fetch-failed") && providerNetworkCheck?.decision !== "pass") {
    diagnostics.push({
      code: "provider-fetch-failed",
      category: "network-or-provider",
      severity: "blocker",
      evidence: "last execution log reported fetch failed",
      operatorAction: "verify network, proxy, and provider endpoint reachability, then rerun readiness",
    });
  }
  if (providerSignals.includes("provider-fetch-failed") && providerNetworkCheck?.decision === "pass") {
    diagnostics.push({
      code: "provider-fetch-failed-cleared-by-network-check",
      category: "network-or-provider",
      severity: "warning",
      evidence: "network check artifact passed after last execution reported fetch failed",
      operatorAction: "retry exactly one provider canary after readiness is clear",
    });
  }
  if (providerSignals.includes("provider-global-settings-lock-error")) {
    diagnostics.push({
      code: "provider-global-settings-lock-error",
      category: "sandbox-or-settings",
      severity: "blocker",
      evidence: "last execution log referenced settings.json.lock EPERM",
      operatorAction: "use an isolated PI_CODING_AGENT_DIR writable by the worker process",
    });
  }
  return diagnostics;
}

function providerRecoveryAction(diagnostic) {
  const code = diagnostic?.code;
  const base = {
    diagnosticCode: code,
    category: diagnostic?.category ?? "unknown",
    severity: diagnostic?.severity ?? "warning",
    operatorAction: diagnostic?.operatorAction ?? "review provider readiness diagnostic",
    automationAllowed: false,
    processStartAllowed: false,
    rerunReadinessScript: "agent-run:pi-provider-readiness",
  };
  if (code === "provider-auth-missing") {
    return {
      ...base,
      actionCode: "configure-provider-credentials",
      verificationScript: "agent-run:pi-provider-readiness",
      retryCanaryScript: "agent-run:pi-provider-canary",
    };
  }
  if (code === "provider-fetch-failed") {
    return {
      ...base,
      actionCode: "verify-provider-network",
      verificationScript: "agent-run:pi-provider-network-check",
      retryCanaryScript: "agent-run:pi-provider-canary:container",
    };
  }
  if (code === "provider-global-settings-lock-error") {
    return {
      ...base,
      actionCode: "repair-provider-settings-isolation",
      verificationScript: "agent-run:pi-provider-readiness",
      retryCanaryScript: "agent-run:pi-provider-canary",
    };
  }
  if (code === "provider-fanout-plan-missing") {
    return {
      ...base,
      actionCode: "generate-provider-fanout-plan",
      verificationScript: "agent-run:pi-provider-fanout-plan",
      retryCanaryScript: "agent-run:pi-provider-readiness",
    };
  }
  return {
    ...base,
    actionCode: `review-${code ?? "provider-diagnostic"}`,
    verificationScript: "agent-run:pi-provider-readiness",
    retryCanaryScript: "agent-run:pi-provider-canary",
  };
}

export function buildProviderRecoveryPlan({ decision, providerDiagnostics }) {
  const blockerDiagnostics = providerDiagnostics.filter((diagnostic) => diagnostic.severity === "blocker");
  const actions = blockerDiagnostics.map(providerRecoveryAction);
  return {
    mode: "agent-run-pi-provider-recovery-plan",
    decision: decision === "blocked" ? "blocked" : "ready",
    dispatchAllowed: false,
    processStartAllowed: false,
    automationAllowed: false,
    blockers: blockerDiagnostics.map((diagnostic) => diagnostic.code),
    actions,
    nextVerification: decision === "blocked"
      ? "resolve recovery actions, then rerun agent-run:pi-provider-readiness before provider dispatch"
      : "execute exactly one provider canary through agent-run:pi-provider-canary",
  };
}

export function buildAgentRunPiProviderReadiness(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const planPath = path.resolve(cwd, options.planPath || DEFAULT_PLAN);
  const lastExecutionPath = path.resolve(cwd, options.lastExecutionPath || DEFAULT_LAST_EXECUTION);
  const networkCheckPath = path.resolve(cwd, options.networkCheckPath || DEFAULT_NETWORK_CHECK);
  const blockers = [];
  const warnings = [];
  const plan = readJsonIfExists(planPath);
  const lastExecution = readJsonIfExists(lastExecutionPath);
  const providerNetworkCheck = providerNetworkCheckEvidence(readJsonIfExists(networkCheckPath));

  if (!plan) blockers.push("provider-fanout-plan-missing");
  if (plan && plan.mode !== "agent-run-pi-provider-fanout-plan") blockers.push("provider-fanout-plan-mode-invalid");
  if (plan && plan.decision !== "ready-for-operator-decision") blockers.push("provider-fanout-plan-not-ready");
  const workers = asWorkerPackets(plan);
  if (plan && workers.length === 0) blockers.push("worker-packets-missing");

  const envKeyRows = workerEnvKeys(plan);
  const missingAgentDir = envKeyRows.some((keys) => !keys.includes("PI_CODING_AGENT_DIR"));
  if (plan && missingAgentDir) blockers.push("pi-coding-agent-dir-missing");

  const lastLines = collectLogLines(lastExecution);
  const providerSignals = classifyProviderSignals(lastLines);
  if (providerSignals.includes("provider-global-settings-lock-error")) blockers.push("provider-global-settings-lock-error");
  if (providerSignals.includes("provider-auth-missing")) blockers.push("provider-auth-missing");
  if (providerSignals.includes("provider-fetch-failed") && providerNetworkCheck.decision !== "pass") blockers.push("provider-fetch-failed");
  if (providerSignals.includes("provider-fetch-failed") && providerNetworkCheck.decision === "pass") {
    warnings.push("provider-fetch-failed-cleared-by-network-check");
  }
  if (!lastExecution) warnings.push("last-provider-execution-missing");
  const providerDiagnostics = buildProviderDiagnostics({ providerSignals, plan, lastExecution, providerNetworkCheck });
  const decision = blockers.length === 0 ? "ready-for-operator-decision" : "blocked";
  const providerRecoveryPlan = buildProviderRecoveryPlan({ decision, providerDiagnostics });
  const operatorActions = providerDiagnostics
    .filter((diagnostic) => diagnostic.severity === "blocker")
    .map((diagnostic) => diagnostic.operatorAction);

  return {
    mode: "agent-run-pi-provider-readiness",
    schemaVersion: SCHEMA_VERSION,
    decision,
    recommendation: decision === "blocked" ? "resolve-provider-readiness-blockers" : "provider-worker-canary-ready",
    dispatchAllowed: false,
    processStartAllowed: false,
    batchExecutionAllowed: false,
    planPath: path.relative(cwd, planPath) || planPath,
    lastExecutionPath: path.relative(cwd, lastExecutionPath) || lastExecutionPath,
    networkCheckPath: path.relative(cwd, networkCheckPath) || networkCheckPath,
    model: plan?.model,
    workerCount: workers.length,
    workerEnvKeys: envKeyRows,
    lastExecution: lastExecution ? {
      decision: lastExecution.decision,
      terminalProcessState: lastExecution.terminalProcessState,
      contractDecision: lastExecution.contractDecision,
      outcomeBlockers: lastExecution.outcomeBlockers ?? [],
      envKeys: lastExecution.driverStep?.registryEntry?.envKeys ?? [],
    } : undefined,
    providerNetworkCheck,
    providerSignals,
    providerDiagnostics,
    providerRecoveryPlan,
    blockers,
    warnings,
    nextActions: decision === "blocked"
      ? [...new Set([
          ...operatorActions,
          "keep using preview-only worker dispatch until readiness is clear",
        ])]
      : [
          "execute exactly one provider worker through agent-run-pi-provider-worker-dispatch",
          "require agentRunOutcomePacket pass before selecting another worker",
        ],
    summary: `agent-run-pi-provider-readiness: decision=${decision} model=${plan?.model ?? "missing"} workers=${workers.length} blockers=${blockers.length} dispatch=no`,
  };
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-pi-provider-readiness.mjs [--plan PATH] [--last-execution PATH] [--out PATH] [--pretty]",
    "",
    "Report-only readiness gate for provider-backed pi workers. It never starts a process.",
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
    const result = buildAgentRunPiProviderReadiness(args);
    const json = JSON.stringify(result, null, args.pretty ? 2 : 0);
    if (args.outPath) writeJson(path.resolve(args.cwd, args.outPath), result, args.pretty);
    process.stdout.write(json);
    process.stdout.write("\n");
    if (result.decision === "blocked") process.exit(1);
  }
}
