#!/usr/bin/env node
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateAgentWorkerIsolation } from "./agent-worker-isolation.mjs";

const SCHEMA_VERSION = 1;

function parseArgs(argv) {
  const out = { input: "", cwd: process.cwd(), outPath: "", pretty: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") out.input = argv[++index] ?? "";
    else if (arg === "--cwd") out.cwd = argv[++index] ?? "";
    else if (arg === "--out") out.outPath = argv[++index] ?? "";
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help") out.help = true;
  }
  return out;
}

function readPayload(inputPath) {
  if (inputPath) return JSON.parse(readFileSync(inputPath, "utf8"));
  const stdin = readFileSync(0, "utf8").trim();
  return stdin ? JSON.parse(stdin) : {};
}

function normalizeDriverPayload(payload) {
  if (
    payload
    && typeof payload === "object"
    && !Array.isArray(payload)
    && payload.driverStepCall
    && typeof payload.driverStepCall === "object"
    && !Array.isArray(payload.driverStepCall)
  ) {
    const approvalParam = asString(payload.driverStepCall.operatorApprovalParam) || "operator_approval";
    const outerApproval = payload.operator_approval ?? payload[approvalParam];
    const driverStepCall = outerApproval && !payload.driverStepCall.operator_approval && !payload.driverStepCall[approvalParam]
      ? { ...payload.driverStepCall, [approvalParam]: outerApproval }
      : payload.driverStepCall;
    return normalizeDriverPayload(driverStepCall);
  }
  if (
    payload
    && typeof payload === "object"
    && !Array.isArray(payload)
    && payload.tool === "agent_run_driver_step_dispatch"
    && payload.params
    && typeof payload.params === "object"
    && !Array.isArray(payload.params)
  ) {
    const approvalParam = asString(payload.operatorApprovalParam) || "operator_approval";
    const params = payload.params;
    const wrapperApproval = payload.operator_approval ?? payload[approvalParam];
    return {
      ...params,
      ...(wrapperApproval ? { operator_approval: wrapperApproval } : {}),
      ...(!wrapperApproval && params[approvalParam] ? { operator_approval: params[approvalParam] } : {}),
    };
  }
  return payload;
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean) : [];
}

function asEnv(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = new Set(["PI_CODING_AGENT_DIR"]);
  return Object.fromEntries(Object.entries(value)
    .filter(([key, entry]) => allowed.has(key) && typeof entry === "string" && entry.trim())
    .map(([key, entry]) => [key, entry.trim()]));
}

function asFileContract(value) {
  return value === "mutation" ? "mutation" : "read-only";
}

function asMarkerResults(value) {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({
      label: asString(entry.label),
      ...(entry.ok === true || entry.ok === false ? { ok: entry.ok } : {}),
    }));
}

function outputHasFailMarker(lines = []) {
  return lines
    .filter((line) => typeof line === "string")
    .map((line) => line.trim())
    .some((line) => /^[\s*_`>#-]*FAIL(?::|\b)/i.test(line)
      || /^[\s*_`>#-]*PASS\/FAIL(?:\s*\([^)]*\))?\s*:\s*[\s*_`>#-]*FAIL\b/i.test(line));
}

function normalizeTimeoutMs(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 90_000;
}

function registryPath(cwd) {
  return path.join(cwd, ".pi", "reports", "agent-runs.json");
}

function readRegistryRows(cwd) {
  const filePath = registryPath(cwd);
  if (!existsSync(filePath)) return [];
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  return Array.isArray(parsed) ? parsed : Array.isArray(parsed.runs) ? parsed.runs : [];
}

function readRegistryEntry(cwd, runId) {
  return readRegistryRows(cwd).find((row) => row?.runId === runId);
}

function writeRegistryEntry(cwd, entry) {
  const filePath = registryPath(cwd);
  const rows = readRegistryRows(cwd).filter((row) => row?.runId !== entry.runId);
  rows.push(entry);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify({ runs: rows }, null, 2), "utf8");
}

function logByteCount(logPath) {
  return logPath && existsSync(logPath) ? statSync(logPath).size : 0;
}

function readLogTail(logPath, maxLines) {
  if (!logPath || !existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").split(/\r?\n/).slice(-Math.max(1, Math.min(500, maxLines)));
}

function hasStructuredApproval(value) {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && value.packet_mode === "operator-approval-packet"
    && value.approved === true
    && value.approval_state === "approved";
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function parseRunSpec(raw) {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const preview = row.execution_preview && typeof row.execution_preview === "object" && !Array.isArray(row.execution_preview)
    ? row.execution_preview
    : {};
  return {
    runId: asString(row.run_id),
    providerModelRef: asString(row.provider_model_ref),
    cwd: asString(row.cwd) || ".",
    declaredFiles: asStringArray(row.declared_files),
    logPath: asString(row.log_path),
    timeoutMs: normalizeTimeoutMs(row.timeout_ms),
    fileContract: asFileContract(row.file_contract),
    env: asEnv(row.env),
    executionPreview: {
      command: asString(preview.command),
      args: asStringArray(preview.args),
    },
  };
}

function buildStatus(runId, entry) {
  return {
    mode: "agent-run-status",
    runId,
    found: !!entry,
    state: entry?.state ?? "unknown",
    pid: entry?.pid,
    exitCode: entry?.exitCode,
    outputBytes: entry?.outputBytes,
    logPath: entry?.logPath,
    declaredFiles: asStringArray(entry?.declaredFiles),
  };
}

function isTerminal(state) {
  return state === "completed" || state === "failed" || state === "timed-out" || state === "aborted";
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function followRun(cwd, runId, maxWaitMs, pollIntervalMs, maxLines) {
  const deadline = Date.now() + maxWaitMs;
  let entry = readRegistryEntry(cwd, runId);
  let status = buildStatus(runId, entry);
  while (status.found && !isTerminal(status.state) && Date.now() < deadline) {
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    entry = readRegistryEntry(cwd, runId);
    status = buildStatus(runId, entry);
  }
  const terminal = status.found && isTerminal(status.state);
  const logPath = entry?.logPath
    ? path.isAbsolute(entry.logPath) ? entry.logPath : path.join(cwd, entry.logPath)
    : undefined;
  return {
    entry,
    status,
    terminal,
    decision: !status.found ? "missing-run" : terminal ? "terminal" : "timeout",
    outputBytes: logByteCount(logPath),
    logPath,
    lines: readLogTail(logPath, maxLines),
  };
}

function buildOutcome({ runId, entry, outputBytes, fileContract, touchedFiles = [], markerResults = [], mutationTargetFiles = [], outputLines = [] }) {
  const found = !!entry;
  const processState = entry?.state ?? "unknown";
  const declaredFiles = asStringArray(entry?.declaredFiles);
  const expectedTouched = fileContract === "mutation" && mutationTargetFiles.length > 0 ? mutationTargetFiles : declaredFiles;
  const unexpectedFiles = touchedFiles.filter((file) => !expectedTouched.includes(file));
  const missingDeclaredFiles = fileContract === "mutation" && touchedFiles.length > 0
    ? expectedTouched.filter((file) => !touchedFiles.includes(file))
    : [];
  const markerFailures = markerResults.filter((marker) => marker?.ok === false).map((marker, index) => asString(marker.label) || `marker-${index + 1}`);
  const workerOutputFail = outputHasFailMarker(outputLines);
  const blockers = [];
  if (!found) blockers.push("run-not-found");
  if (found && processState !== "completed") blockers.push(`process-state-${processState}`);
  if (found && processState === "completed" && outputBytes === 0) blockers.push("empty-output");
  if (fileContract === "read-only" && touchedFiles.length > 0) blockers.push("read-only-touched-files");
  if (unexpectedFiles.length > 0) blockers.push("unexpected-files");
  if (fileContract !== "read-only" && touchedFiles.length > 0 && missingDeclaredFiles.length > 0) blockers.push("declared-files-missing");
  if (markerFailures.length > 0) blockers.push("marker-failures");
  if (workerOutputFail) blockers.push("worker-output-fail");
  const mutationMissingEvidence = found
    && processState === "completed"
    && outputBytes > 0
    && fileContract === "mutation"
    && touchedFiles.length === 0
    && blockers.length === 0;
  return {
    mode: "agent-run-outcome-packet",
    schemaVersion: SCHEMA_VERSION,
    dispatchAllowed: false,
    processStartAllowed: false,
    processStopAllowed: false,
    runId,
    found,
    processState,
    contractDecision: blockers.length > 0 ? "fail" : mutationMissingEvidence ? "partial" : "pass",
    recommendation: blockers.length === 0 && !mutationMissingEvidence ? "stop" : "ask-operator",
    outputBytes,
    fileContract,
    declaredFiles,
    touchedFiles,
    missingDeclaredFiles,
    unexpectedFiles,
    markerFailures: workerOutputFail ? [...markerFailures, "worker-output-fail"] : markerFailures,
    blockers,
  };
}

function outcomePacket({ runId, outputBytes, fileContract, touchedFiles, markerResults, mutationTargetFiles }) {
  return {
    tool: "agent_run_outcome_packet",
    params: {
      run_id: runId,
      output_bytes: outputBytes,
      file_contract: fileContract,
      ...(touchedFiles.length > 0 ? { touched_files: touchedFiles } : {}),
      ...(markerResults.length > 0 ? { marker_results: markerResults } : {}),
      ...(mutationTargetFiles.length > 0 ? { mutation_target_files: mutationTargetFiles } : {}),
    },
  };
}

function buildDriverStepSummary({ decision, runSpec, dispatchAllowed, blockers, follow, agentRunOutcomePacket }) {
  const parts = [
    "agent-run-driver-step:",
    `decision=${decision}`,
    `runId=${runSpec.runId || "missing"}`,
    `dispatch=${dispatchAllowed ? "yes" : "no"}`,
    follow ? `follow=${follow.decision}` : "follow=not-requested",
    follow?.status?.state ? `state=${follow.status.state}` : undefined,
    typeof follow?.outputBytes === "number" ? `outputBytes=${follow.outputBytes}` : undefined,
    agentRunOutcomePacket ? `contract=${agentRunOutcomePacket.contractDecision}` : "contract=not-built",
    `blockers=${blockers.length + (Array.isArray(agentRunOutcomePacket?.blockers) ? agentRunOutcomePacket.blockers.length : 0)}`,
  ].filter(Boolean);
  return parts.join(" ");
}

async function dispatchRun(cwd, runSpec) {
  const logPath = path.isAbsolute(runSpec.logPath) ? runSpec.logPath : path.join(cwd, runSpec.logPath);
  mkdirSync(path.dirname(logPath), { recursive: true });
  const now = new Date().toISOString();
  const planned = {
    runId: runSpec.runId,
    state: "planned",
    providerModelRef: runSpec.providerModelRef,
    cwd,
    declaredFiles: runSpec.declaredFiles,
    logPath,
    timeoutMs: runSpec.timeoutMs,
    envKeys: Object.keys(runSpec.env),
    createdAtIso: now,
    lastEventAtIso: now,
  };
  writeRegistryEntry(cwd, planned);
  const startedAtMs = Date.now();
  const logStream = createWriteStream(logPath, { flags: "w" });
  logStream.write(`[agent-runner] starting command=${runSpec.executionPreview.command} source=preview-command cwd=${cwd}\n`);
  logStream.write(`[agent-runner] argv=${JSON.stringify(runSpec.executionPreview.args)}\n`);
  logStream.write(`[agent-runner] preflight platform=${process.platform} node=${process.version} cwdExists=${existsSync(cwd) ? "yes" : "no"}\n`);
  logStream.write(`[agent-runner] envKeys=${JSON.stringify(Object.keys(runSpec.env))}\n`);
  const child = spawn(runSpec.executionPreview.command, runSpec.executionPreview.args, {
    cwd,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...runSpec.env },
  });
  let outputBytes = 0;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let firstOutputElapsedMs;
  const capture = (streamName) => (chunk) => {
    const byteLength = Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(chunk);
    outputBytes += byteLength;
    if (streamName === "stdout") stdoutBytes += byteLength;
    if (streamName === "stderr") stderrBytes += byteLength;
    if (firstOutputElapsedMs === undefined) {
      firstOutputElapsedMs = Date.now() - startedAtMs;
      logStream.write(`[agent-runner] first-byte stream=${streamName} elapsedMs=${firstOutputElapsedMs} bytes=${byteLength}\n`);
    }
    logStream.write(chunk);
  };
  child.stdout?.on("data", capture("stdout"));
  child.stderr?.on("data", capture("stderr"));
  const running = { ...planned, state: "running", pid: child.pid, startedAtIso: new Date().toISOString(), lastEventAtIso: new Date().toISOString() };
  writeRegistryEntry(cwd, running);
  const exit = await new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      if (!child.killed) child.kill("SIGTERM");
    }, runSpec.timeoutMs);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: 1, errorCode: error.code || "spawn-error", errorMessage: error.message, signal: "none", timedOut: false });
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: typeof code === "number" ? code : timedOut ? 124 : 1, signal: signal || "none", timedOut });
    });
  });
  const elapsedMs = Date.now() - startedAtMs;
  logStream.write(`[agent-runner] close exitCode=${exit.exitCode} signal=${exit.signal} timedOut=${exit.timedOut ? "yes" : "no"} elapsedMs=${elapsedMs} childOutputBytes=${outputBytes} stdoutBytes=${stdoutBytes} stderrBytes=${stderrBytes} firstOutputElapsedMs=${firstOutputElapsedMs ?? "none"}\n`);
  await new Promise((resolve) => logStream.end(resolve));
  const completed = {
    ...running,
    state: exit.exitCode === 0 ? "completed" : exit.timedOut ? "timed-out" : "failed",
    exitCode: exit.exitCode,
    ...(exit.errorCode ? { errorCode: exit.errorCode, errorMessage: exit.errorMessage } : {}),
    outputBytes: logByteCount(logPath),
    lastEventAtIso: new Date().toISOString(),
  };
  writeRegistryEntry(cwd, completed);
  return { pid: child.pid, registryEntry: completed };
}

export async function runAgentRunDriverStep(payload, cwd = process.cwd()) {
  payload = normalizeDriverPayload(payload);
  const runSpec = parseRunSpec(payload.run_spec);
  const executeRequested = payload.execute === true;
  const followRequested = payload.follow === true;
  const buildOutcomeRequested = payload.build_outcome === true;
  const touchedFiles = asStringArray(payload.touched_files);
  const markerResults = asMarkerResults(payload.marker_results) ?? [];
  const mutationTargetFiles = asStringArray(payload.mutation_target_files);
  const blockers = [];
  const runCwd = runSpec.cwd === "." || runSpec.cwd === "" ? cwd : runSpec.cwd;
  const existing = runSpec.runId ? readRegistryEntry(cwd, runSpec.runId) : undefined;
  if (!runSpec.runId) blockers.push("run-id-missing");
  if (runSpec.declaredFiles.length === 0) blockers.push("declared-files-missing");
  if (!runSpec.logPath) blockers.push("log-path-missing");
  if (!runSpec.executionPreview.command) blockers.push("execution-preview-command-missing");
  if (executeRequested && !hasStructuredApproval(payload.operator_approval)) blockers.push("structured-operator-approval-missing");
  const existingRunAlive = existing?.state === "running" && processIsAlive(existing.pid);
  if (executeRequested && existingRunAlive) blockers.push("run-already-running");
  const isolation = validateAgentWorkerIsolation({
    workspaceRoot: cwd,
    runCwd,
    declaredFiles: runSpec.declaredFiles,
    logPath: runSpec.logPath,
    envKeys: Object.keys(runSpec.env),
  });
  if (executeRequested) blockers.push(...isolation.blockers);

  const dispatchAllowed = executeRequested && blockers.length === 0;
  let dispatch;
  if (dispatchAllowed) dispatch = await dispatchRun(cwd, runSpec);
  const maxWaitMs = Math.max(0, Math.min(30_000, Math.floor(typeof payload.follow_max_wait_ms === "number" ? payload.follow_max_wait_ms : 5_000)));
  const pollIntervalMs = Math.max(100, Math.min(5_000, Math.floor(typeof payload.follow_poll_interval_ms === "number" ? payload.follow_poll_interval_ms : 500)));
  const maxLines = Math.max(1, Math.min(500, Math.floor(typeof payload.follow_max_lines === "number" ? payload.follow_max_lines : 80)));
  const follow = followRequested && runSpec.runId ? await followRun(cwd, runSpec.runId, maxWaitMs, pollIntervalMs, maxLines) : undefined;
  const terminal = follow?.terminal === true;
  const decision = dispatchAllowed ? "dispatched" : blockers.length > 0 ? "blocked" : "ready-for-operator-decision";
  const nextAgentRunOutcomePacket = terminal ? outcomePacket({
    runId: runSpec.runId,
    outputBytes: follow.outputBytes,
    fileContract: runSpec.fileContract,
    touchedFiles,
    markerResults,
    mutationTargetFiles,
  }) : undefined;
  const agentRunOutcomePacket = terminal && buildOutcomeRequested ? buildOutcome({
    runId: runSpec.runId,
    entry: follow.entry,
    outputBytes: follow.outputBytes,
    fileContract: runSpec.fileContract,
    touchedFiles,
    markerResults,
    mutationTargetFiles,
    outputLines: follow.lines,
  }) : undefined;
  return {
    mode: executeRequested ? "agent-run-driver-step-dispatch" : "agent-run-driver-step-packet",
    schemaVersion: SCHEMA_VERSION,
    decision,
    dispatchAllowed,
    processStartAllowed: dispatchAllowed,
    processStopAllowed: false,
    singleRunOnly: true,
    blockers,
    runSpec,
    executeRequested,
    structuredOperatorApproval: hasStructuredApproval(payload.operator_approval),
    isolation,
    followRequested,
    pid: dispatch?.pid,
    registryEntry: dispatch?.registryEntry,
    follow,
    nextAgentRunOutcomePacket,
    agentRunOutcomePacket,
    summary: buildDriverStepSummary({ decision, runSpec, dispatchAllowed, blockers, follow, agentRunOutcomePacket }),
  };
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-driver-step.mjs --input payload.json [--cwd DIR] [--out result.json] [--pretty]",
    "Reads JSON payload compatible with agent_run_driver_step_dispatch and prints JSON result.",
  ].join("\n") + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
  } else {
    const result = await runAgentRunDriverStep(readPayload(args.input), args.cwd || process.cwd());
    const json = JSON.stringify(result, null, args.pretty ? 2 : 0);
    if (args.outPath) {
      const outPath = path.resolve(args.outPath);
      mkdirSync(path.dirname(outPath), { recursive: true });
      writeFileSync(outPath, `${json}\n`, "utf8");
    }
    process.stdout.write(json);
    process.stdout.write("\n");
  }
}
