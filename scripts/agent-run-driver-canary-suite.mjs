#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { runAgentRunDriverCanary } from "./agent-run-driver-canary.mjs";

const SCHEMA_VERSION = 1;
const DEFAULT_OUT = ".artifacts/agent-run-driver/suite.json";
const READ_ONLY_OUT = ".artifacts/agent-run-driver/latest.json";
const MUTATION_OUT = ".artifacts/agent-run-driver/latest-mutation.json";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    outPath: DEFAULT_OUT,
    execute: true,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--out") out.outPath = argv[++index] ?? out.outPath;
    else if (arg === "--preview") out.execute = false;
    else if (arg === "--execute") out.execute = true;
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

function canaryPassed(report) {
  return report?.decision === "dispatched"
    && report?.followTerminal === true
    && report?.contractDecision === "pass"
    && Array.isArray(report?.blockers)
    && report.blockers.length === 0;
}

function gitHead(cwd) {
  const out = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8", stdio: "pipe" });
  if (out.status !== 0) return "";
  return String(out.stdout ?? "").trim();
}

export async function runAgentRunDriverCanarySuite(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const execute = options.execute !== false;
  const pretty = options.pretty === true;
  const generatedAtIso = new Date().toISOString();
  const head = gitHead(cwd);
  const readOnly = await runAgentRunDriverCanary({
    cwd,
    execute,
    runId: "agent-run-driver-local-node-version-canary",
    mode: "read-only",
  });
  writeJson(cwd, READ_ONLY_OUT, readOnly, pretty);

  const mutation = await runAgentRunDriverCanary({
    cwd,
    execute,
    runId: "agent-run-driver-local-mutation-canary",
    mode: "mutation",
  });
  writeJson(cwd, MUTATION_OUT, mutation, pretty);

  const blockers = [
    ...(!canaryPassed(readOnly) ? ["read-only-canary-not-pass"] : []),
    ...(!canaryPassed(mutation) ? ["mutation-canary-not-pass"] : []),
  ];
  const report = {
    mode: "agent-run-driver-canary-suite-report",
    schemaVersion: SCHEMA_VERSION,
    generatedAtIso,
    gitHead: head,
    decision: blockers.length === 0 ? "pass" : "block",
    executeRequested: execute,
    dispatchAllowed: readOnly.dispatchAllowed === true || mutation.dispatchAllowed === true,
    processStartAllowed: readOnly.processStartAllowed === true || mutation.processStartAllowed === true,
    outputs: {
      readOnly: READ_ONLY_OUT,
      mutation: MUTATION_OUT,
    },
    canaries: {
      readOnly,
      mutation,
    },
    blockers,
    summary: `agent-run-driver-canary-suite: decision=${blockers.length === 0 ? "pass" : "block"} readOnly=${readOnly.contractDecision ?? "none"} mutation=${mutation.contractDecision ?? "none"}`,
  };
  writeJson(cwd, options.outPath || DEFAULT_OUT, report, pretty);
  return report;
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-driver-canary-suite.mjs [--preview|--execute] [--cwd DIR] [--out PATH] [--pretty]",
    "",
    "Runs the read-only and mutation driver canaries in sequence and writes latest evidence artifacts.",
    `Default output path: ${DEFAULT_OUT}`,
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
    const report = await runAgentRunDriverCanarySuite(args);
    process.stdout.write(JSON.stringify(report, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (report.decision === "block") process.exit(1);
  }
}
