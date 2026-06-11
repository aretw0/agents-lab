#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { buildDockerExecArgs } from "./devcontainer-lab.mjs";

const SCHEMA_VERSION = 1;
const DEFAULT_REPORT_OUT = ".artifacts/agent-run-driver/container-suite-report.json";
const DEFAULT_SUITE_OUT = ".artifacts/agent-run-driver/container-suite.json";

function toContainerPath(relPath) {
  return String(relPath || DEFAULT_SUITE_OUT).replace(/\\/g, "/");
}

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    container: "",
    cwd: process.cwd(),
    reportOutPath: DEFAULT_REPORT_OUT,
    suiteOutPath: DEFAULT_SUITE_OUT,
    execute: true,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--container") out.container = argv[++index] ?? "";
    else if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--out") out.reportOutPath = argv[++index] ?? out.reportOutPath;
    else if (arg === "--suite-out") out.suiteOutPath = argv[++index] ?? out.suiteOutPath;
    else if (arg === "--preview") out.execute = false;
    else if (arg === "--execute") out.execute = true;
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

export function buildContainerCanaryDockerArgs(options) {
  const command = [
    "node",
    "scripts/agent-run-driver-canary-suite.mjs",
    options.execute === false ? "--preview" : "--execute",
      "--out",
    toContainerPath(options.suiteOutPath || DEFAULT_SUITE_OUT),
  ];
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

export function runAgentRunDriverContainerCanarySuite(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const container = String(options.container ?? "").trim();
  const pretty = options.pretty === true;
  if (!container) {
    return {
      mode: "agent-run-driver-container-canary-suite-report",
      schemaVersion: SCHEMA_VERSION,
      decision: "block",
      container,
      executeRequested: options.execute !== false,
      dispatchAllowed: false,
      processStartAllowed: false,
      suiteOutPath: options.suiteOutPath || DEFAULT_SUITE_OUT,
      blockers: ["container-missing"],
      summary: "agent-run-driver-container-canary-suite: decision=block blocker=container-missing",
    };
  }

  const dockerArgs = buildContainerCanaryDockerArgs({
    container,
    suiteOutPath: toContainerPath(options.suiteOutPath || DEFAULT_SUITE_OUT),
    execute: options.execute !== false,
    pretty,
  });
  const result = spawnSync("docker", dockerArgs, { cwd, encoding: "utf8", stdio: "pipe" });
  let suiteReport;
  try {
    suiteReport = JSON.parse(String(result.stdout ?? "").trim());
  } catch {
    suiteReport = undefined;
  }
  const blockers = [
    ...(result.status === 0 ? [] : [`docker-exec-failed:${result.status ?? "unknown"}`]),
    ...(suiteReport ? [] : ["container-suite-json-missing"]),
    ...(suiteReport?.decision === "pass" ? [] : ["container-suite-not-pass"]),
  ];
  const report = {
    mode: "agent-run-driver-container-canary-suite-report",
    schemaVersion: SCHEMA_VERSION,
    generatedAtIso: new Date().toISOString(),
    container,
    decision: blockers.length === 0 ? "pass" : "block",
    executeRequested: options.execute !== false,
    dispatchAllowed: suiteReport?.dispatchAllowed === true,
    processStartAllowed: suiteReport?.processStartAllowed === true,
    suiteOutPath: toContainerPath(options.suiteOutPath || DEFAULT_SUITE_OUT),
    dockerArgs,
    suiteReport: suiteReport ?? null,
    stderrPreview: String(result.stderr ?? "").slice(0, 2000),
    blockers,
    summary: `agent-run-driver-container-canary-suite: decision=${blockers.length === 0 ? "pass" : "block"} container=${container} suite=${suiteReport?.decision ?? "missing"}`,
  };
  writeJson(cwd, options.reportOutPath || DEFAULT_REPORT_OUT, report, pretty);
  return report;
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-driver-container-canary-suite.mjs --container NAME [--execute|--preview] [--out PATH] [--suite-out PATH] [--pretty]",
    "",
    "Runs the agent-run driver canary suite inside the devcontainer through the headless lab wrapper.",
    `Default wrapper report: ${DEFAULT_REPORT_OUT}`,
    `Default in-container suite artifact: ${DEFAULT_SUITE_OUT}`,
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
    const report = runAgentRunDriverContainerCanarySuite(args);
    process.stdout.write(JSON.stringify(report, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (report.decision === "block") process.exit(1);
  }
}
