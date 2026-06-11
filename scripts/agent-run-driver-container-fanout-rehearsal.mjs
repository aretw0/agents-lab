#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { buildDockerExecArgs } from "./devcontainer-lab.mjs";

const SCHEMA_VERSION = 1;
const DEFAULT_REPORT_OUT = ".artifacts/agent-run-driver/container-fanout-rehearsal-report.json";
const DEFAULT_REHEARSAL_OUT = ".artifacts/agent-run-driver/container-fanout-rehearsal.json";
const DEFAULT_MANIFEST_OUT = ".artifacts/agent-run-driver/container-fanout-manifest.json";

function toContainerPath(relPath) {
  return String(relPath || DEFAULT_REHEARSAL_OUT).replace(/\\/g, "/");
}

function shellWord(value) {
  return JSON.stringify(String(value));
}

function shellCommand(parts) {
  return parts.map((part) => (part === "&&" || part === ">" ? part : shellWord(part))).join(" ");
}

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    container: "",
    cwd: process.cwd(),
    reportOutPath: DEFAULT_REPORT_OUT,
    rehearsalOutPath: DEFAULT_REHEARSAL_OUT,
    manifestOutPath: DEFAULT_MANIFEST_OUT,
    batchId: "agent-run-driver-container-fanout-rehearsal",
    execute: true,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--container") out.container = argv[++index] ?? "";
    else if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--out") out.reportOutPath = argv[++index] ?? out.reportOutPath;
    else if (arg === "--rehearsal-out") out.rehearsalOutPath = argv[++index] ?? out.rehearsalOutPath;
    else if (arg === "--manifest-out") out.manifestOutPath = argv[++index] ?? out.manifestOutPath;
    else if (arg === "--batch-id") out.batchId = argv[++index] ?? out.batchId;
    else if (arg === "--preview") out.execute = false;
    else if (arg === "--execute") out.execute = true;
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

export function buildContainerFanoutDockerArgs(options) {
  const manifestStdoutPath = ".artifacts/agent-run-driver/container-fanout-manifest.stdout";
  const command = [
    "sh",
    "-lc",
    shellCommand([
      "node",
      "scripts/agent-run-driver-fanout-manifest.mjs",
      "--batch-id",
      options.batchId || "agent-run-driver-container-fanout-rehearsal",
      "--out",
      toContainerPath(options.manifestOutPath || DEFAULT_MANIFEST_OUT),
      ">",
      manifestStdoutPath,
      "&&",
      "node",
      "scripts/agent-run-driver-fanout-rehearsal.mjs",
      options.execute === false ? "--preview" : "--execute",
      "--batch-id",
      options.batchId || "agent-run-driver-container-fanout-rehearsal",
      "--manifest",
      toContainerPath(options.manifestOutPath || DEFAULT_MANIFEST_OUT),
      "--out",
      toContainerPath(options.rehearsalOutPath || DEFAULT_REHEARSAL_OUT),
    ]),
  ];
  if (options.pretty === true) command[2] += " --pretty";
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

export function runAgentRunDriverContainerFanoutRehearsal(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const container = String(options.container ?? "").trim();
  const pretty = options.pretty === true;
  if (!container) {
    return {
      mode: "agent-run-driver-container-fanout-rehearsal-report",
      schemaVersion: SCHEMA_VERSION,
      decision: "block",
      container,
      executeRequested: options.execute !== false,
      dispatchAllowed: false,
      processStartAllowed: false,
      manifestOutPath: toContainerPath(options.manifestOutPath || DEFAULT_MANIFEST_OUT),
      rehearsalOutPath: toContainerPath(options.rehearsalOutPath || DEFAULT_REHEARSAL_OUT),
      blockers: ["container-missing"],
      summary: "agent-run-driver-container-fanout-rehearsal: decision=block blocker=container-missing",
    };
  }

  const dockerArgs = buildContainerFanoutDockerArgs({
    container,
    batchId: options.batchId || "agent-run-driver-container-fanout-rehearsal",
    manifestOutPath: options.manifestOutPath || DEFAULT_MANIFEST_OUT,
    rehearsalOutPath: options.rehearsalOutPath || DEFAULT_REHEARSAL_OUT,
    execute: options.execute !== false,
    pretty,
  });
  const result = spawnSync("docker", dockerArgs, { cwd, encoding: "utf8", stdio: "pipe" });
  let rehearsalReport;
  try {
    rehearsalReport = JSON.parse(String(result.stdout ?? "").trim());
  } catch {
    rehearsalReport = undefined;
  }
  const blockers = [
    ...(result.status === 0 ? [] : [`docker-exec-failed:${result.status ?? "unknown"}`]),
    ...(rehearsalReport ? [] : ["container-fanout-json-missing"]),
    ...(rehearsalReport?.decision === "pass" ? [] : ["container-fanout-not-pass"]),
  ];
  const report = {
    mode: "agent-run-driver-container-fanout-rehearsal-report",
    schemaVersion: SCHEMA_VERSION,
    generatedAtIso: new Date().toISOString(),
    container,
    decision: blockers.length === 0 ? "pass" : "block",
    executeRequested: options.execute !== false,
    dispatchAllowed: rehearsalReport?.dispatchAllowed === true,
    processStartAllowed: rehearsalReport?.processStartAllowed === true,
    manifestOutPath: toContainerPath(options.manifestOutPath || DEFAULT_MANIFEST_OUT),
    rehearsalOutPath: toContainerPath(options.rehearsalOutPath || DEFAULT_REHEARSAL_OUT),
    dockerArgs,
    rehearsalReport: rehearsalReport ?? null,
    stderrPreview: String(result.stderr ?? "").slice(0, 2000),
    blockers,
    summary: `agent-run-driver-container-fanout-rehearsal: decision=${blockers.length === 0 ? "pass" : "block"} container=${container} rehearsal=${rehearsalReport?.decision ?? "missing"}`,
  };
  writeJson(cwd, options.reportOutPath || DEFAULT_REPORT_OUT, report, pretty);
  return report;
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-driver-container-fanout-rehearsal.mjs --container NAME [--execute|--preview] [--out PATH] [--manifest-out PATH] [--rehearsal-out PATH] [--batch-id ID] [--pretty]",
    "",
    "Builds a fan-out manifest and runs the bounded fan-out rehearsal inside the devcontainer through the headless lab wrapper.",
    `Default wrapper report: ${DEFAULT_REPORT_OUT}`,
    `Default in-container rehearsal artifact: ${DEFAULT_REHEARSAL_OUT}`,
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
    const report = runAgentRunDriverContainerFanoutRehearsal(args);
    process.stdout.write(JSON.stringify(report, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (report.decision === "block") process.exit(1);
  }
}
