#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    mode: "help",
    runId: "agent-run-pi-help-canary",
    logPath: "",
    model: "",
    prompt: "",
    files: [],
    tools: [],
    fileContract: "read-only",
    touchedFiles: [],
    mutationTargetFiles: [],
    markerResults: [],
    execute: false,
    follow: false,
    buildOutcome: false,
    followMaxWaitMs: undefined,
    followPollIntervalMs: undefined,
    followMaxLines: undefined,
    operatorApproval: undefined,
    operatorApprovalFile: "",
    outPath: "",
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--mode") out.mode = argv[++index] ?? out.mode;
    else if (arg === "--run-id") out.runId = argv[++index] ?? out.runId;
    else if (arg === "--log-path") out.logPath = argv[++index] ?? out.logPath;
    else if (arg === "--model") out.model = argv[++index] ?? out.model;
    else if (arg === "--prompt") out.prompt = argv[++index] ?? out.prompt;
    else if (arg === "--file") out.files.push(argv[++index] ?? "");
    else if (arg === "--tool") out.tools.push(argv[++index] ?? "");
    else if (arg === "--file-contract") out.fileContract = argv[++index] ?? out.fileContract;
    else if (arg === "--touched-file") out.touchedFiles.push(argv[++index] ?? "");
    else if (arg === "--mutation-target-file") out.mutationTargetFiles.push(argv[++index] ?? "");
    else if (arg === "--marker") {
      const raw = argv[++index] ?? "";
      const [label, state = "true"] = raw.split("=");
      out.markerResults.push({ label, ok: state !== "false" && state !== "fail" });
    }
    else if (arg === "--execute") out.execute = true;
    else if (arg === "--follow") out.follow = true;
    else if (arg === "--build-outcome") out.buildOutcome = true;
    else if (arg === "--follow-max-wait-ms") out.followMaxWaitMs = Number(argv[++index] ?? "");
    else if (arg === "--follow-poll-interval-ms") out.followPollIntervalMs = Number(argv[++index] ?? "");
    else if (arg === "--follow-max-lines") out.followMaxLines = Number(argv[++index] ?? "");
    else if (arg === "--operator-approval-file") out.operatorApprovalFile = argv[++index] ?? "";
    else if (arg === "--out") out.outPath = argv[++index] ?? "";
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (out.operatorApprovalFile) {
    out.operatorApproval = JSON.parse(readFileSync(out.operatorApprovalFile, "utf8"));
  }
  return out;
}

function asCleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asCleanStringArray(value) {
  return Array.isArray(value)
    ? value.flatMap((entry) => String(entry ?? "").split(",")).map((entry) => entry.trim()).filter(Boolean)
    : [];
}

function normalizeDeclaredFile(filePath) {
  const clean = asCleanString(filePath);
  return clean.startsWith("@") ? clean.slice(1) : clean;
}

function normalizeFileContract(value) {
  return value === "mutation" ? "mutation" : "read-only";
}

function normalizeMarkerResults(value) {
  return Array.isArray(value)
    ? value
        .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
        .map((entry) => ({
          label: asCleanString(entry.label),
          ...(entry.ok === true || entry.ok === false ? { ok: entry.ok } : {}),
        }))
        .filter((entry) => entry.label)
    : [];
}

function normalizeAgentDir(value, cwd) {
  const clean = asCleanString(value);
  return clean ? path.resolve(cwd, clean) : path.join(cwd, ".sandbox", "pi-agent");
}

function positiveInteger(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function buildDriverStepCall(payload, options = {}) {
  const touchedFiles = asCleanStringArray(options.touchedFiles);
  const mutationTargetFiles = asCleanStringArray(options.mutationTargetFiles);
  const markerResults = normalizeMarkerResults(options.markerResults);
  const params = {
    ...payload,
    ...(options.execute === true ? { execute: true } : {}),
    ...(options.follow === true ? { follow: true } : {}),
    ...(options.buildOutcome === true ? { build_outcome: true } : {}),
    ...(touchedFiles.length > 0 ? { touched_files: touchedFiles } : {}),
    ...(mutationTargetFiles.length > 0 ? { mutation_target_files: mutationTargetFiles } : {}),
    ...(markerResults.length > 0 ? { marker_results: markerResults } : {}),
    ...(positiveInteger(options.followMaxWaitMs) ? { follow_max_wait_ms: positiveInteger(options.followMaxWaitMs) } : {}),
    ...(positiveInteger(options.followPollIntervalMs) ? { follow_poll_interval_ms: positiveInteger(options.followPollIntervalMs) } : {}),
    ...(positiveInteger(options.followMaxLines) ? { follow_max_lines: positiveInteger(options.followMaxLines) } : {}),
  };
  return {
    tool: "agent_run_driver_step_dispatch",
    params,
    operatorApprovalRequired: true,
    operatorApprovalParam: "operator_approval",
    ...(options.operatorApproval ? { operator_approval: options.operatorApproval } : {}),
  };
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
  const runId = asCleanString(options.runId)
    ? asCleanString(options.runId)
    : "agent-run-pi-help-canary";
  const cliPath = options.cliPath ?? resolveLocalPiCli(cwd);
  const logPath = asCleanString(options.logPath)
    ? asCleanString(options.logPath)
    : `.pi/reports/${runId}.log`;
  const fileContract = normalizeFileContract(options.fileContract);

  if (!cliPath) {
    return {
      mode: "agent-run-pi-driver-payload",
      schemaVersion: SCHEMA_VERSION,
      decision: "blocked",
      blockers: ["local-pi-cli-missing"],
      dispatchAllowed: false,
      processStartAllowed: false,
      cwd,
      runId,
    };
  }

  const payload = {
    run_spec: {
      run_id: runId,
      provider_model_ref: "local/pi-cli",
      cwd,
      declared_files: ["package.json"],
      log_path: logPath,
      timeout_ms: 30_000,
      file_contract: fileContract,
      execution_preview: {
        command: process.execPath,
        args: [cliPath, "--help"],
      },
    },
  };

  return {
    mode: "agent-run-pi-driver-payload",
    schemaVersion: SCHEMA_VERSION,
    decision: "ready-for-driver-step",
    blockers: [],
    dispatchAllowed: false,
    processStartAllowed: false,
    payload,
    ...(options.operatorApproval ? { operator_approval: options.operatorApproval } : {}),
    driverStepCall: buildDriverStepCall(payload, options),
    summary: `agent-run-pi-driver-payload: decision=ready-for-driver-step runId=${runId} dispatch=no`,
  };
}

export function buildPiPrintReadonlyDriverStepPayload(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const runId = asCleanString(options.runId) || "agent-run-pi-print-readonly-canary";
  const cliPath = options.cliPath ?? resolveLocalPiCli(cwd);
  const logPath = asCleanString(options.logPath) || `.pi/reports/${runId}.log`;
  const model = asCleanString(options.model);
  const prompt = asCleanString(options.prompt);
  const declaredFiles = asCleanStringArray(options.files).map(normalizeDeclaredFile);
  const tools = asCleanStringArray(options.tools);
  const toolList = tools.length > 0 ? tools : ["read", "grep", "find", "ls"];
  const fileContract = normalizeFileContract(options.fileContract);
  const agentDir = normalizeAgentDir(options.agentDir, cwd);
  const blockers = [];

  if (!cliPath) blockers.push("local-pi-cli-missing");
  if (!model) blockers.push("model-missing");
  if (!prompt) blockers.push("prompt-missing");
  if (prompt.startsWith("-")) blockers.push("prompt-leading-dash");
  if (declaredFiles.length === 0) blockers.push("declared-files-missing");

  if (blockers.length > 0) {
    return {
      mode: "agent-run-pi-driver-payload",
      schemaVersion: SCHEMA_VERSION,
      payloadMode: "print-readonly",
      decision: "blocked",
      blockers,
      dispatchAllowed: false,
      processStartAllowed: false,
      cwd,
      runId,
    };
  }

  const payload = {
    run_spec: {
      run_id: runId,
      provider_model_ref: model,
      cwd,
      declared_files: declaredFiles,
      log_path: logPath,
      timeout_ms: 90_000,
      file_contract: fileContract,
      env: {
        PI_CODING_AGENT_DIR: agentDir,
      },
      execution_preview: {
        command: process.execPath,
        args: [
          cliPath,
          "--no-session",
          "--no-extensions",
          "--no-skills",
          "--no-prompt-templates",
          "--no-themes",
          "--no-context-files",
          "--model",
          model,
          "--tools",
          toolList.join(","),
          "--print",
          ...declaredFiles.map((filePath) => `@${filePath}`),
          prompt,
        ],
      },
    },
  };

  return {
    mode: "agent-run-pi-driver-payload",
    schemaVersion: SCHEMA_VERSION,
    payloadMode: "print-readonly",
    decision: "ready-for-driver-step",
    blockers: [],
    dispatchAllowed: false,
    processStartAllowed: false,
    payload,
    ...(options.operatorApproval ? { operator_approval: options.operatorApproval } : {}),
    driverStepCall: buildDriverStepCall(payload, options),
    summary: `agent-run-pi-driver-payload: decision=ready-for-driver-step mode=print-readonly runId=${runId} dispatch=no`,
  };
}

export function buildPiDriverStepPayload(options = {}) {
  const mode = asCleanString(options.mode) || "help";
  if (mode === "help") return buildPiHelpDriverStepPayload(options);
  if (mode === "print-readonly") return buildPiPrintReadonlyDriverStepPayload(options);
  return {
    mode: "agent-run-pi-driver-payload",
    schemaVersion: SCHEMA_VERSION,
    decision: "blocked",
    blockers: [`unsupported-payload-mode:${mode}`],
    dispatchAllowed: false,
    processStartAllowed: false,
  };
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-pi-driver-payload.mjs [--mode help|print-readonly] [options] [--pretty]",
    "",
    "help options:",
    "  --cwd DIR --run-id ID --log-path PATH [--execute] [--follow] [--build-outcome] [--operator-approval-file approval.json] [--out driver-packet.json]",
    "",
    "print-readonly options:",
    "  --cwd DIR --run-id ID --model PROVIDER/MODEL --file PATH --prompt TEXT [--file-contract read-only|mutation] [--tool read,grep,find,ls] [--touched-file PATH] [--mutation-target-file PATH] [--marker label=true|false] [--execute] [--follow] [--build-outcome] [--operator-approval-file approval.json] [--out driver-packet.json]",
    "",
    "Builds payloads for scripts/agent-run-driver-step.mjs. It never dispatches by itself.",
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
    const result = buildPiDriverStepPayload(args);
    const json = JSON.stringify(result, null, args.pretty ? 2 : 0);
    if (args.outPath) {
      const outPath = path.resolve(args.outPath);
      mkdirSync(path.dirname(outPath), { recursive: true });
      writeFileSync(outPath, `${json}\n`, "utf8");
    }
    process.stdout.write(json);
    process.stdout.write("\n");
    if (result.decision === "blocked") process.exit(1);
  }
}
