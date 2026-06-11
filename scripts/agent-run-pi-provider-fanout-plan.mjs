#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { buildPiPrintReadonlyDriverStepPayload } from "./agent-run-pi-driver-payload.mjs";

const SCHEMA_VERSION = 1;
const DEFAULT_MODEL = "openai-codex/gpt-5.3-codex-spark";
const DEFAULT_OUT = ".artifacts/agent-run-driver/pi-provider-fanout-plan.json";
const DEFAULT_BOARD = ".project/tasks.json";
const PROTECTED_SIGNAL_RE = /https?:\/\/|\.github\/|\.obsidian\/|\.pi\/settings\.json|\bgithub actions\b|\bremote\b|\bpublish\b|\bcredential\b|\bsecret\b|\btoken\b/i;

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    outPath: DEFAULT_OUT,
    batchId: "agent-run-pi-provider-fanout-rehearsal",
    model: DEFAULT_MODEL,
    files: ["package.json"],
    fromBoardProtected: false,
    boardPath: DEFAULT_BOARD,
    limit: 3,
    execute: false,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--out") out.outPath = argv[++index] ?? out.outPath;
    else if (arg === "--batch-id") out.batchId = argv[++index] ?? out.batchId;
    else if (arg === "--model") out.model = argv[++index] ?? out.model;
    else if (arg === "--file") out.files.push(argv[++index] ?? "");
    else if (arg === "--from-board-protected") out.fromBoardProtected = true;
    else if (arg === "--board") out.boardPath = argv[++index] ?? out.boardPath;
    else if (arg === "--limit") out.limit = Number(argv[++index] ?? out.limit);
    else if (arg === "--execute") out.execute = true;
    else if (arg === "--preview") out.execute = false;
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/_/g, "-");
}

function normalizePriority(value) {
  const raw = String(value || "").trim().toLowerCase();
  return ["p0", "p1", "p2", "p3"].includes(raw) ? raw : "";
}

function taskFiles(task) {
  return Array.isArray(task?.files) ? task.files.map((file) => String(file || "").trim()).filter(Boolean) : [];
}

function taskCriteria(task) {
  return Array.isArray(task?.acceptance_criteria)
    ? task.acceptance_criteria.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function isProtectedTask(task) {
  const haystack = [
    task?.id,
    task?.description,
    task?.milestone,
    task?.notes,
    ...taskFiles(task),
  ].join("\n");
  return PROTECTED_SIGNAL_RE.test(haystack);
}

function sanitizeWorkerId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function readJsonIfExists(cwd, relPath) {
  const filePath = path.resolve(cwd, relPath);
  return existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf8")) : undefined;
}

function normalizeLimit(value) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 20) : 0;
}

function selectProtectedBoardTasks({ cwd, boardPath, limit }) {
  const board = readJsonIfExists(cwd, boardPath);
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  const selected = [];
  const skipped = [];
  for (const task of tasks) {
    const taskId = String(task?.id || "").trim();
    const status = normalizeStatus(task?.status);
    if (!taskId) {
      skipped.push({ taskId: null, reason: "task-id-missing" });
      continue;
    }
    if (status !== "planned" && status !== "in-progress") {
      skipped.push({ taskId, reason: `status-not-eligible:${status || "missing"}` });
      continue;
    }
    if (!isProtectedTask(task)) {
      skipped.push({ taskId, reason: "not-protected" });
      continue;
    }
    selected.push({
      taskId,
      workerId: sanitizeWorkerId(taskId),
      description: String(task?.description || "").trim(),
      priority: normalizePriority(task?.priority) || "unknown",
      status,
      milestone: String(task?.milestone || "").trim(),
      files: taskFiles(task).length ? taskFiles(task) : ["docs/research/"],
      acceptanceCriteria: taskCriteria(task),
    });
    if (selected.length >= limit) break;
  }
  return { board, tasks, selected, skipped };
}

function promptFor(workerId, task) {
  if (task) {
    return [
      "Protected research planning contract: do not browse, do not call external URLs, do not edit files, and do not launch other agents.",
      "Use only the task metadata and declared local files as evidence. Produce a concise PASS/FAIL research-readiness assessment, safe next step, blockers, and filesTouched.",
      `Task ${task.taskId}: ${task.description}`,
      `Milestone: ${task.milestone || "n/a"}`,
      `Acceptance criteria: ${task.acceptanceCriteria.length ? task.acceptanceCriteria.join(" | ") : "missing"}`,
      "Keep output under 30 lines.",
    ].join("\n");
  }
  return [
    "Provider rehearsal contract: read only declared files; do not edit files; do not launch other agents.",
    `Worker ${workerId}: inspect the declared file set and return PASS/FAIL, concise evidence, blockers, and filesTouched. Keep output under 20 lines.`,
  ].join("\n");
}

function writeJson(cwd, relPath, value, pretty = false) {
  const outPath = path.resolve(cwd, relPath);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
}

export function buildAgentRunPiProviderFanoutPlan(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const batchId = String(options.batchId || "agent-run-pi-provider-fanout-rehearsal").trim();
  const model = String(options.model || DEFAULT_MODEL).trim();
  const fromBoardProtected = options.fromBoardProtected === true;
  const boardPath = String(options.boardPath || DEFAULT_BOARD);
  const limit = normalizeLimit(options.limit ?? 3);
  const boardSelection = fromBoardProtected ? selectProtectedBoardTasks({ cwd, boardPath, limit }) : undefined;
  const files = Array.isArray(options.files) ? options.files.filter(Boolean) : ["package.json"];
  const executeRequested = options.execute === true;
  const workerSpecs = fromBoardProtected
    ? (boardSelection?.selected ?? [])
    : ["worker-a", "worker-b"].map((workerId) => ({ workerId, files, task: undefined }));
  const workerPackets = workerSpecs.map((workerSpec) => {
    const workerId = workerSpec.workerId;
    const runId = `${batchId}-${workerId}`;
    const declaredFiles = workerSpec.files?.length ? workerSpec.files : files;
    return buildPiPrintReadonlyDriverStepPayload({
      cwd,
      runId,
      model,
      files: declaredFiles,
      prompt: promptFor(workerId, fromBoardProtected ? workerSpec : undefined),
      tools: ["read", "grep", "find", "ls"],
      execute: false,
      follow: true,
      buildOutcome: true,
      followMaxWaitMs: 90_000,
      followPollIntervalMs: 500,
      followMaxLines: 80,
    });
  });
  const packetBlockers = workerPackets.flatMap((packet, index) => (
    packet.decision === "blocked"
      ? (packet.blockers ?? []).map((blocker) => `${workerSpecs[index]?.workerId ?? index}:${blocker}`)
      : []
  ));
  const blockers = [
    ...(executeRequested ? ["execute-not-supported-by-provider-fanout-plan"] : []),
    ...(fromBoardProtected && !boardSelection?.board ? ["board-missing"] : []),
    ...(fromBoardProtected && limit === 0 ? ["board-limit-invalid"] : []),
    ...(fromBoardProtected && boardSelection?.selected.length === 0 ? ["protected-board-workers-missing"] : []),
    ...packetBlockers,
  ];
  const decision = blockers.length === 0 ? "ready-for-operator-decision" : "blocked";
  return {
    mode: "agent-run-pi-provider-fanout-plan",
    schemaVersion: SCHEMA_VERSION,
    generatedAtIso: new Date().toISOString(),
    batchId,
    model,
    decision,
    executeRequested,
    source: fromBoardProtected ? "protected-board" : "manual",
    ...(fromBoardProtected ? {
      boardPath,
      boardSelection: {
        limit,
        scannedTaskCount: boardSelection?.tasks.length ?? 0,
        selectedTaskIds: (boardSelection?.selected ?? []).map((task) => task.taskId),
        skippedSamples: (boardSelection?.skipped ?? []).slice(0, 10),
      },
    } : {}),
    dispatchAllowed: false,
    processStartAllowed: false,
    workerDispatchAllowed: false,
    batchExecutionAllowed: false,
    workerCount: workerPackets.length,
    workerPackets: workerPackets.map((packet, index) => ({
      ...(fromBoardProtected ? {
        taskId: workerSpecs[index]?.taskId,
        taskPriority: workerSpecs[index]?.priority,
        taskStatus: workerSpecs[index]?.status,
      } : {}),
      workerId: workerSpecs[index]?.workerId,
      ...packet,
    })),
    nextActions: decision === "ready-for-operator-decision"
      ? [
          "review each workerPackets[*].driverStepCall before approval",
          "execute at most one worker first through agent_run_driver_step_dispatch",
          "after each terminal run, require agent_run_outcome_packet pass before fan-in",
          "only after all required pass outcomes, aggregate with fail-closed batch/fan-in",
        ]
      : ["resolve blockers before preparing provider/model rehearsal"],
    blockers,
    summary: `agent-run-pi-provider-fanout-plan: decision=${decision} source=${fromBoardProtected ? "protected-board" : "manual"} model=${model} workers=${workerPackets.length} dispatch=no`,
  };
}

export function writeAgentRunPiProviderFanoutPlan(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const report = buildAgentRunPiProviderFanoutPlan(options);
  writeJson(cwd, options.outPath || DEFAULT_OUT, report, options.pretty === true);
  return report;
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-pi-provider-fanout-plan.mjs [--model PROVIDER/MODEL] [--file PATH] [--out PATH] [--pretty]",
    "",
    "Builds a report-only two-worker pi --print provider/model rehearsal plan.",
    "Use --from-board-protected to prepare protected board research-planning workers without dispatch.",
    "It never starts a process; execute requests are blocked here and must go through agent-run driver-step.",
    `Default model: ${DEFAULT_MODEL}`,
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
    const report = writeAgentRunPiProviderFanoutPlan(args);
    process.stdout.write(JSON.stringify(report, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (report.decision === "blocked") process.exit(1);
  }
}
