#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;
const DEFAULT_OUT = ".artifacts/agent-run-driver/fanout-manifest.json";
const PROTECTED_BOARD_SIGNAL_RE = /https?:\/\/|\.github\/|\.obsidian\/|\.pi\/settings\.json|\bgithub actions\b|\bremote\b|\bpublish\b|\bcredential\b|\bsecret\b|\btoken\b/i;

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    outPath: DEFAULT_OUT,
    batchId: "agent-run-driver-local-fanout-rehearsal",
    workerIds: [],
    files: ["package.json"],
    fromBoard: false,
    boardPath: ".project/tasks.json",
    limit: 2,
    priority: "",
    execute: false,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--out") out.outPath = argv[++index] ?? out.outPath;
    else if (arg === "--batch-id") out.batchId = argv[++index] ?? out.batchId;
    else if (arg === "--worker") out.workerIds.push(argv[++index] ?? "");
    else if (arg === "--file") out.files.push(argv[++index] ?? "");
    else if (arg === "--from-board") out.fromBoard = true;
    else if (arg === "--board") out.boardPath = argv[++index] ?? out.boardPath;
    else if (arg === "--limit") out.limit = Number(argv[++index] ?? out.limit);
    else if (arg === "--priority") out.priority = argv[++index] ?? "";
    else if (arg === "--execute") out.execute = true;
    else if (arg === "--preview") out.execute = false;
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function uniqueBlockers(values, prefix) {
  const blockers = [];
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) blockers.push(`${prefix}:${value}`);
    seen.add(value);
  }
  return blockers;
}

function normalizeList(values, fallback) {
  const normalized = values.map((value) => String(value || "").trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeLimit(value) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 20) : 0;
}

function readJsonIfExists(cwd, relPath) {
  const filePath = path.resolve(cwd, relPath);
  return existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf8")) : undefined;
}

function normalizePriority(value) {
  const raw = String(value || "").trim().toLowerCase();
  return ["p0", "p1", "p2", "p3"].includes(raw) ? raw : "";
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/_/g, "-");
}

function taskFiles(task) {
  return Array.isArray(task?.files) ? task.files.map((file) => String(file || "").trim()).filter(Boolean) : [];
}

function isProtectedTask(task) {
  const haystack = [
    task?.id,
    task?.description,
    task?.milestone,
    task?.notes,
    ...taskFiles(task),
  ].join("\n");
  return PROTECTED_BOARD_SIGNAL_RE.test(haystack);
}

function isProtectedTaskMetadata(task) {
  const haystack = [
    task?.id,
    task?.description,
    task?.milestone,
    task?.notes,
  ].join("\n");
  return PROTECTED_BOARD_SIGNAL_RE.test(haystack);
}

function isProtectedPath(value) {
  return PROTECTED_BOARD_SIGNAL_RE.test(String(value || ""));
}

function sanitizeWorkerId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function countByReason(skipped) {
  return skipped.reduce((counts, item) => {
    counts[item.reason] = (counts[item.reason] ?? 0) + 1;
    return counts;
  }, {});
}

function skipSample(task, reason) {
  return {
    taskId: String(task?.id || "").trim() || null,
    reason,
    status: normalizeStatus(task?.status) || null,
    priority: normalizePriority(task?.priority) || null,
  };
}

function selectBoardTasks({ cwd, boardPath, limit, priority }) {
  const board = readJsonIfExists(cwd, boardPath);
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  const priorityFilter = normalizePriority(priority);
  const selected = [];
  const skipped = [];
  for (const task of tasks) {
    const status = normalizeStatus(task?.status);
    if (status !== "planned" && status !== "in-progress") {
      skipped.push(skipSample(task, `status-not-eligible:${status || "missing"}`));
      continue;
    }
    const taskPriority = normalizePriority(task?.priority);
    if (priorityFilter && taskPriority !== priorityFilter) {
      skipped.push(skipSample(task, `priority-mismatch:${taskPriority || "missing"}`));
      continue;
    }
    if (isProtectedTaskMetadata(task)) {
      skipped.push(skipSample(task, "protected-scope"));
      continue;
    }
    const taskId = String(task?.id || "").trim();
    if (!taskId) {
      skipped.push(skipSample(task, "task-id-missing"));
      continue;
    }
    const rawFiles = taskFiles(task);
    if (rawFiles.length === 0) {
      skipped.push(skipSample(task, "files-missing"));
      continue;
    }
    const files = taskFiles(task).filter((file) => !isProtectedPath(file));
    if (files.length === 0) {
      skipped.push(skipSample(task, "files-protected"));
      continue;
    }
    selected.push({
      taskId,
      description: String(task?.description || "").trim(),
      priority: taskPriority || "unknown",
      status,
      files,
    });
    if (selected.length >= limit) break;
  }
  return { board, tasks, selected, skipped };
}

function writeJson(cwd, relPath, value, pretty = false) {
  const outPath = path.resolve(cwd, relPath);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
}

export function buildAgentRunDriverFanoutManifest(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const batchId = String(options.batchId || "agent-run-driver-local-fanout-rehearsal").trim();
  const fromBoard = options.fromBoard === true;
  const boardPath = String(options.boardPath || ".project/tasks.json");
  const limit = normalizeLimit(options.limit ?? 2);
  const boardSelection = fromBoard ? selectBoardTasks({ cwd, boardPath, limit, priority: options.priority }) : undefined;
  const workerIds = fromBoard
    ? (boardSelection?.selected ?? []).map((task) => sanitizeWorkerId(task.taskId)).filter(Boolean)
    : normalizeList(Array.isArray(options.workerIds) ? options.workerIds : [], ["worker-a", "worker-b"]);
  const files = normalizeList(Array.isArray(options.files) ? options.files : [], ["package.json"]);
  const executeRequested = options.execute === true;
  const runIds = workerIds.map((workerId) => `${batchId}-${workerId}`);
  const blockers = [
    ...(executeRequested ? ["execute-not-supported-by-fanout-manifest"] : []),
    ...(!batchId ? ["batch-id-missing"] : []),
    ...(fromBoard && !boardSelection?.board ? ["board-missing"] : []),
    ...(fromBoard && limit === 0 ? ["board-limit-invalid"] : []),
    ...(fromBoard && boardSelection?.selected.length === 0 ? ["board-workers-missing"] : []),
    ...uniqueBlockers(workerIds, "duplicate-worker-id"),
    ...uniqueBlockers(runIds, "duplicate-run-id"),
  ];
  const decision = blockers.length === 0 ? "ready-for-operator-decision" : "blocked";
  const workerSpecs = workerIds.map((workerId, index) => {
    const runId = `${batchId}-${workerId}`;
    const boardTask = fromBoard ? boardSelection?.selected[index] : undefined;
    const declaredFiles = boardTask?.files ?? files;
    return {
      workerId,
      ...(boardTask ? { taskId: boardTask.taskId, taskPriority: boardTask.priority, taskStatus: boardTask.status } : {}),
      runSpec: {
        run_id: runId,
        provider_model_ref: "local/process",
        cwd,
        declared_files: declaredFiles,
        log_path: `.pi/reports/${runId}.log`,
        timeout_ms: 30_000,
        file_contract: "read-only",
        execution_preview: {
          command: process.execPath,
          args: ["-e", `console.log(${JSON.stringify(boardTask ? `board-task:${boardTask.taskId}` : `fanout-manifest:${workerId}`)})`],
        },
      },
    };
  });
  return {
    mode: "agent-run-driver-fanout-manifest",
    schemaVersion: SCHEMA_VERSION,
    generatedAtIso: new Date().toISOString(),
    batchId,
    decision,
    executeRequested,
    source: fromBoard ? "board" : "manual",
    ...(fromBoard ? {
      boardPath,
      boardSelection: {
        limit,
        priority: normalizePriority(options.priority) || null,
        scannedTaskCount: boardSelection?.tasks.length ?? 0,
        eligibleCount: boardSelection?.selected.length ?? 0,
        selectedTaskIds: (boardSelection?.selected ?? []).map((task) => task.taskId),
        skippedProtected: (boardSelection?.skipped ?? []).filter((task) => task.reason === "protected-scope" || task.reason === "files-protected").length,
        skippedByReason: countByReason(boardSelection?.skipped ?? []),
        skippedSamples: (boardSelection?.skipped ?? []).slice(0, 10),
      },
    } : {}),
    dispatchAllowed: false,
    processStartAllowed: false,
    batchExecutionAllowed: false,
    workerCount: workerSpecs.length,
    workerSpecs,
    rehearsalPreview: {
      command: "node",
      args: [
        "scripts/agent-run-driver-fanout-rehearsal.mjs",
        "--execute",
        "--manifest",
        options.outPath || DEFAULT_OUT,
        "--max-concurrency",
        "1",
      ],
      dispatchAllowed: false,
      processStartAllowed: false,
      shellInterpolationAllowed: false,
    },
    blockers,
    summary: `agent-run-driver-fanout-manifest: decision=${decision} source=${fromBoard ? "board" : "manual"} workers=${workerSpecs.length} dispatch=no`,
  };
}

export function writeAgentRunDriverFanoutManifest(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const report = buildAgentRunDriverFanoutManifest(options);
  writeJson(cwd, options.outPath || DEFAULT_OUT, report, options.pretty === true);
  return report;
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-driver-fanout-manifest.mjs [--worker ID] [--file PATH] [--from-board] [--limit N] [--priority p1] [--batch-id ID] [--out PATH] [--pretty]",
    "",
    "Builds a report-only fanout manifest consumable by agent-run-driver-fanout-rehearsal.",
    "It never starts workers; execute requests are blocked.",
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
    const report = writeAgentRunDriverFanoutManifest(args);
    process.stdout.write(JSON.stringify(report, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (report.decision === "blocked") process.exit(1);
  }
}
