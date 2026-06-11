#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;
const DEFAULT_SOURCES = [
  ".artifacts/agent-run-driver/pi-provider-container-canary-report.json",
  ".artifacts/agent-run-driver/pi-provider-canary.json",
  ".artifacts/agent-run-driver/pi-provider-readiness.json",
];
const DEFAULT_NETWORK_CHECK = ".artifacts/agent-run-driver/pi-provider-network-check.json";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    sourcePath: "",
    networkCheckPath: DEFAULT_NETWORK_CHECK,
    outPath: "",
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--source") out.sourcePath = argv[++index] ?? "";
    else if (arg === "--network-check") out.networkCheckPath = argv[++index] ?? out.networkCheckPath;
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

function artifactMtimeMs(cwd, relPath) {
  try {
    return statSync(path.resolve(cwd, relPath)).mtimeMs;
  } catch {
    return -1;
  }
}

function sourcePathsForSelection(cwd, sourcePath) {
  if (sourcePath) return [sourcePath];
  return [...DEFAULT_SOURCES].sort((left, right) => artifactMtimeMs(cwd, right) - artifactMtimeMs(cwd, left));
}

function recoveryPlanFromPayload(payload) {
  if (payload?.providerRecoveryPlan && typeof payload.providerRecoveryPlan === "object") return payload.providerRecoveryPlan;
  if (payload?.canaryReport?.providerRecoveryPlan && typeof payload.canaryReport.providerRecoveryPlan === "object") {
    return payload.canaryReport.providerRecoveryPlan;
  }
  if (payload?.providerReadiness?.providerRecoveryPlan && typeof payload.providerReadiness.providerRecoveryPlan === "object") {
    return payload.providerReadiness.providerRecoveryPlan;
  }
  const canaryContractPass = payload?.canaryReport?.agentRunOutcomePacket?.contractDecision === "pass"
    || payload?.agentRunOutcomePacket?.contractDecision === "pass";
  if ((payload?.mode === "agent-run-pi-provider-container-canary-report" && payload.decision === "pass")
    || (payload?.mode === "agent-run-pi-provider-canary" && payload.decision === "dispatched" && canaryContractPass)) {
    return {
      mode: "agent-run-pi-provider-recovery-plan",
      decision: "ready",
      dispatchAllowed: false,
      processStartAllowed: false,
      automationAllowed: false,
      blockers: [],
      actions: [],
      nextVerification: "provider recovery canary passed; no recovery action is pending",
    };
  }
  return undefined;
}

function commandPreviewFor(scriptName, extraArgs = []) {
  return scriptName
    ? {
        command: "pnpm",
        args: ["run", scriptName, ...extraArgs],
        shellInterpolationAllowed: false,
      }
    : undefined;
}

function retryCanaryCommandPreviewFor(scriptName, recoveryRetry) {
  return commandPreviewFor(scriptName, recoveryRetry === true ? ["--", "--recovery-retry"] : []);
}

function networkCheckEvidence(cwd, relPath = DEFAULT_NETWORK_CHECK) {
  try {
    const payload = readJsonIfExists(cwd, relPath);
    if (!payload) return { path: relPath, present: false, decision: "missing" };
    return {
      path: relPath,
      present: true,
      decision: payload.decision ?? "unknown",
      executeRequested: payload.executeRequested === true,
      networkRequestAllowed: payload.networkRequestAllowed === true,
      networkDecision: payload.networkDecision,
      httpStatus: payload.httpStatus,
      commandPreview: payload.commandPreview && typeof payload.commandPreview === "object"
        ? payload.commandPreview
        : undefined,
      blockers: Array.isArray(payload.blockers) ? payload.blockers : [],
      summary: payload.summary ?? "provider network check artifact present",
    };
  } catch (error) {
    return {
      path: relPath,
      present: true,
      decision: "invalid-json",
      error: String(error?.message ?? error),
    };
  }
}

function nextActionStage({ nextAction, networkEvidence, payload }) {
  if (nextAction?.actionCode !== "verify-provider-network") return "run-verification";
  if (networkEvidence?.decision === "pass"
    && (payload?.lastExecutionSource === "provider-canary" || payload?.mode === "agent-run-pi-provider-canary")) {
    return "retry-provider-canary";
  }
  if (networkEvidence?.decision === "pass") return "rerun-readiness";
  if (networkEvidence?.decision === "blocked") return "resolve-network-blockers";
  return "run-network-check";
}

export function buildAgentRunPiProviderRecoveryNext(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const sourcePaths = sourcePathsForSelection(cwd, options.sourcePath);
  const attempts = [];
  let sourcePath = "";
  let payload;
  let providerRecoveryPlan;

  for (const candidate of sourcePaths) {
    try {
      const parsed = readJsonIfExists(cwd, candidate);
      attempts.push({ path: candidate, present: parsed !== undefined });
      const plan = recoveryPlanFromPayload(parsed);
      if (plan) {
        sourcePath = candidate;
        payload = parsed;
        providerRecoveryPlan = plan;
        break;
      }
    } catch (error) {
      attempts.push({ path: candidate, present: true, error: String(error?.message ?? error) });
    }
  }

  const actions = Array.isArray(providerRecoveryPlan?.actions) ? providerRecoveryPlan.actions : [];
  const nextAction = actions[0];
  const providerNetworkCheck = networkCheckEvidence(cwd, options.networkCheckPath || DEFAULT_NETWORK_CHECK);
  const recoveryReady = providerRecoveryPlan?.decision === "ready" && actions.length === 0;
  const blockers = [
    ...(providerRecoveryPlan ? [] : ["provider-recovery-plan-missing"]),
    ...(providerRecoveryPlan && actions.length === 0 && !recoveryReady ? ["provider-recovery-actions-missing"] : []),
  ];
  const decision = blockers.length === 0 ? "next-action-ready" : "blocked";
  const actionStage = recoveryReady
    ? "retry-provider-canary"
    : decision === "next-action-ready"
    ? nextActionStage({ nextAction, networkEvidence: providerNetworkCheck, payload })
    : "blocked";
  const recoveryRetrySelected = actionStage === "retry-provider-canary" && Boolean(nextAction);
  const selectedCommandPreview = actionStage === "rerun-readiness"
    ? commandPreviewFor(nextAction?.rerunReadinessScript)
    : actionStage === "resolve-network-blockers"
      ? commandPreviewFor(nextAction?.verificationScript)
      : actionStage === "retry-provider-canary"
        ? retryCanaryCommandPreviewFor(nextAction?.retryCanaryScript ?? "agent-run:pi-provider-canary", recoveryRetrySelected)
      : providerNetworkCheck.commandPreview ?? commandPreviewFor(nextAction?.verificationScript);
  return {
    mode: "agent-run-pi-provider-recovery-next",
    schemaVersion: SCHEMA_VERSION,
    decision,
    dispatchAllowed: false,
    processStartAllowed: false,
    automationAllowed: false,
    sourcePath,
    sourceMode: payload?.mode,
    sourceDecision: payload?.decision,
    attempts,
    providerRecoveryPlan: providerRecoveryPlan ?? null,
    providerNetworkCheck,
    actionCount: actions.length,
    nextAction: nextAction ?? null,
    actionStage,
    selectedCommandPreview,
    commandPreviews: nextAction
      ? {
          verification: commandPreviewFor(nextAction.verificationScript),
          retryCanary: retryCanaryCommandPreviewFor(nextAction.retryCanaryScript, true),
          rerunReadiness: commandPreviewFor(nextAction.rerunReadinessScript),
        }
      : {},
    blockers,
    nextActions: decision === "next-action-ready"
      ? actionStage === "retry-provider-canary"
        ? [
            nextAction
              ? `provider network check passed; retry with ${nextAction.retryCanaryScript}`
              : "provider recovery is clear; run agent-run:pi-provider-canary preview before any approved execute",
            "execute only one provider worker canary after explicit approval",
          ]
        : actionStage === "rerun-readiness"
        ? [
            "provider network check passed; rerun agent-run:pi-provider-readiness",
            `retry with ${nextAction.retryCanaryScript} only after readiness improves`,
          ]
        : actionStage === "resolve-network-blockers"
          ? [
              "provider network check is blocked; resolve network reachability before retrying readiness",
              `rerun ${nextAction.verificationScript} after remediation`,
            ]
          : [
              `review provider recovery action ${nextAction.actionCode}`,
              `run ${nextAction.verificationScript} after external remediation`,
              `retry with ${nextAction.retryCanaryScript} only after verification improves`,
            ]
      : ["generate provider readiness/canary evidence with providerRecoveryPlan before selecting a recovery action"],
    summary: `agent-run-pi-provider-recovery-next: decision=${decision} action=${nextAction?.actionCode ?? "missing"} stage=${actionStage} source=${sourcePath || "missing"} dispatch=no`,
  };
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-pi-provider-recovery-next.mjs [--source PATH] [--network-check PATH] [--out PATH] [--pretty]",
    "",
    "Report-only selector for the next provider recovery action. It never starts a process.",
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
    const result = buildAgentRunPiProviderRecoveryNext(args);
    if (args.outPath) writeJson(args.cwd, args.outPath, result, args.pretty);
    process.stdout.write(JSON.stringify(result, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (result.decision === "blocked") process.exit(1);
  }
}
