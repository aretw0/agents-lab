#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { buildDockerExecArgs } from "./devcontainer-lab.mjs";

const SCHEMA_VERSION = 1;
const DEFAULT_REPORT_OUT = ".artifacts/agent-run-driver/pi-provider-container-canary-report.json";
const DEFAULT_CANARY_OUT = ".artifacts/agent-run-driver/pi-provider-container-canary.json";

function toContainerPath(relPath) {
  return String(relPath || DEFAULT_CANARY_OUT).replace(/\\/g, "/");
}

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    container: "",
    cwd: process.cwd(),
    reportOutPath: DEFAULT_REPORT_OUT,
    canaryOutPath: DEFAULT_CANARY_OUT,
    workerIndex: 0,
    workerId: "",
    execute: false,
    approve: false,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--container") out.container = argv[++index] ?? "";
    else if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--out") out.reportOutPath = argv[++index] ?? out.reportOutPath;
    else if (arg === "--canary-out") out.canaryOutPath = argv[++index] ?? out.canaryOutPath;
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

export function buildProviderContainerCanaryDockerArgs(options) {
  const command = [
    "node",
    "scripts/agent-run-pi-provider-canary.mjs",
    options.execute === true ? "--execute" : "--preview",
    "--worker-index",
    String(Number.isInteger(options.workerIndex) ? options.workerIndex : 0),
    "--out",
    toContainerPath(options.canaryOutPath || DEFAULT_CANARY_OUT),
  ];
  if (options.workerId) command.push("--worker-id", String(options.workerId));
  if (options.approve === true) command.push("--approve");
  if (options.pretty === true) command.push("--pretty");
  return buildDockerExecArgs({
    headless: true,
    container: options.container,
    command,
  });
}

function writeJson(cwd, relPath, value, pretty = false) {
  const outPath = path.resolve(cwd, relPath);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
}

export function runAgentRunPiProviderContainerCanary(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const container = String(options.container ?? "").trim();
  const pretty = options.pretty === true;
  if (!container) {
    return {
      mode: "agent-run-pi-provider-container-canary-report",
      schemaVersion: SCHEMA_VERSION,
      decision: "block",
      container,
      executeRequested: options.execute === true,
      dispatchAllowed: false,
      processStartAllowed: false,
      canaryOutPath: toContainerPath(options.canaryOutPath || DEFAULT_CANARY_OUT),
      blockers: ["container-missing"],
      summary: "agent-run-pi-provider-container-canary: decision=block blocker=container-missing",
    };
  }

  const dockerArgs = buildProviderContainerCanaryDockerArgs({
    container,
    canaryOutPath: options.canaryOutPath || DEFAULT_CANARY_OUT,
    workerIndex: options.workerIndex,
    workerId: options.workerId,
    execute: options.execute === true,
    approve: options.approve === true,
    pretty,
  });
  const result = spawnSync("docker", dockerArgs, { cwd, encoding: "utf8", stdio: "pipe" });
  let canaryReport;
  try {
    canaryReport = JSON.parse(String(result.stdout ?? "").trim());
  } catch {
    canaryReport = undefined;
  }
  const blockers = [
    ...(result.status === 0 ? [] : [`docker-exec-failed:${result.status ?? "unknown"}`]),
    ...(canaryReport ? [] : ["container-provider-canary-json-missing"]),
    ...(canaryReport && canaryReport.decision !== "blocked" ? [] : ["container-provider-canary-blocked"]),
  ];
  const report = {
    mode: "agent-run-pi-provider-container-canary-report",
    schemaVersion: SCHEMA_VERSION,
    generatedAtIso: new Date().toISOString(),
    container,
    decision: blockers.length === 0 ? "pass" : "block",
    executeRequested: options.execute === true,
    dispatchAllowed: canaryReport?.dispatchAllowed === true,
    processStartAllowed: canaryReport?.processStartAllowed === true,
    canaryOutPath: toContainerPath(options.canaryOutPath || DEFAULT_CANARY_OUT),
    dockerArgs,
    canaryReport: canaryReport ?? null,
    providerDiagnostics: canaryReport?.providerDiagnostics ?? [],
    stderrPreview: String(result.stderr ?? "").slice(0, 2000),
    blockers,
    summary: `agent-run-pi-provider-container-canary: decision=${blockers.length === 0 ? "pass" : "block"} container=${container} canary=${canaryReport?.decision ?? "missing"}`,
  };
  writeJson(cwd, options.reportOutPath || DEFAULT_REPORT_OUT, report, pretty);
  return report;
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-pi-provider-container-canary.mjs --container NAME [--preview|--execute --approve] [--out PATH] [--canary-out PATH] [--pretty]",
    "",
    "Runs the single-worker provider canary inside the devcontainer through the headless lab wrapper.",
    `Default wrapper report: ${DEFAULT_REPORT_OUT}`,
    `Default in-container canary artifact: ${DEFAULT_CANARY_OUT}`,
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
    const report = runAgentRunPiProviderContainerCanary(args);
    process.stdout.write(JSON.stringify(report, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (report.decision === "block") process.exit(1);
  }
}
