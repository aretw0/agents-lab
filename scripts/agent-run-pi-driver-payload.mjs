#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    runId: "agent-run-pi-help-canary",
    logPath: "",
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--run-id") out.runId = argv[++index] ?? out.runId;
    else if (arg === "--log-path") out.logPath = argv[++index] ?? out.logPath;
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

export function resolveLocalPiCli(cwd = process.cwd()) {
  const candidates = [
    path.join(cwd, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js"),
    path.join(cwd, "node_modules", "@mariozechner", "pi-coding-agent", "dist", "cli.js"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

export function buildPiHelpDriverStepPayload(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const runId = typeof options.runId === "string" && options.runId.trim()
    ? options.runId.trim()
    : "agent-run-pi-help-canary";
  const cliPath = options.cliPath ?? resolveLocalPiCli(cwd);
  const logPath = typeof options.logPath === "string" && options.logPath.trim()
    ? options.logPath.trim()
    : `.pi/reports/${runId}.log`;

  if (!cliPath) {
    return {
      mode: "agent-run-pi-driver-payload",
      decision: "blocked",
      blockers: ["local-pi-cli-missing"],
      dispatchAllowed: false,
      processStartAllowed: false,
      cwd,
      runId,
    };
  }

  return {
    mode: "agent-run-pi-driver-payload",
    decision: "ready-for-driver-step",
    blockers: [],
    dispatchAllowed: false,
    processStartAllowed: false,
    payload: {
      run_spec: {
        run_id: runId,
        provider_model_ref: "local/pi-cli",
        cwd,
        declared_files: ["package.json"],
        log_path: logPath,
        timeout_ms: 30_000,
        execution_preview: {
          command: process.execPath,
          args: [cliPath, "--help"],
        },
      },
    },
    summary: `agent-run-pi-driver-payload: decision=ready-for-driver-step runId=${runId} dispatch=no`,
  };
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-pi-driver-payload.mjs [--cwd DIR] [--run-id ID] [--log-path PATH] [--pretty]",
    "Builds a local Pi CLI --help canary payload for scripts/agent-run-driver-step.mjs.",
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
    const result = buildPiHelpDriverStepPayload(args);
    process.stdout.write(JSON.stringify(result, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (result.decision === "blocked") process.exit(1);
  }
}
