#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { summarizeBoard } from "./release-readiness-report.mjs";

const SCHEMA_VERSION = 1;
const VALID_ACTIONS = new Set(["park-for-target-release", "require-work"]);

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    target: "0.8.0",
    action: "park-for-target-release",
    taskIds: [],
    execute: false,
    approve: false,
    outPath: "",
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--target") out.target = argv[++index] ?? out.target;
    else if (arg === "--action") out.action = argv[++index] ?? out.action;
    else if (arg === "--task") out.taskIds.push(argv[++index] ?? "");
    else if (arg === "--tasks") out.taskIds.push(...String(argv[++index] ?? "").split(","));
    else if (arg === "--execute") out.execute = true;
    else if (arg === "--approve") out.approve = true;
    else if (arg === "--out") out.outPath = argv[++index] ?? "";
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  out.taskIds = out.taskIds.map((id) => String(id).trim()).filter(Boolean);
  return out;
}

function readTasksFile(cwd) {
  const tasksPath = path.join(cwd, ".project", "tasks.json");
  if (!existsSync(tasksPath)) return { tasksPath, payload: undefined };
  return { tasksPath, payload: JSON.parse(readFileSync(tasksPath, "utf8")) };
}

function writeJson(filePath, value, pretty = false) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
}

function unique(values) {
  return [...new Set(values)];
}

function appendNote(existing, note) {
  const current = String(existing ?? "").trim();
  return current ? `${current}\n${note}` : note;
}

function applyDisposition({ payload, taskIds, action, target }) {
  const today = new Date().toISOString().slice(0, 10);
  const nextPayload = JSON.parse(JSON.stringify(payload));
  const tasks = Array.isArray(nextPayload.tasks) ? nextPayload.tasks : [];
  const changedTaskIds = [];
  for (const task of tasks) {
    const id = String(task?.id ?? "");
    if (!taskIds.includes(id)) continue;
    if (action === "park-for-target-release") {
      task.status = "planned";
      task.milestone = `parked-for-${target}`;
      task.notes = appendNote(
        task.notes,
        `${today}: board release disposition = park-for-target-release for ${target}; local evidence accepted for release gating; external research remains parked/protected.`,
      );
    } else if (action === "require-work") {
      task.status = "in_progress";
      task.notes = appendNote(
        task.notes,
        `${today}: board release disposition = require-work for ${target}; keep active until additional evidence is produced.`,
      );
    }
    changedTaskIds.push(id);
  }
  return { nextPayload, changedTaskIds };
}

export function buildBoardReleaseDisposition(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const action = String(options.action ?? "park-for-target-release");
  const target = String(options.target ?? "0.8.0");
  const executeRequested = options.execute === true;
  const structuredOperatorApproval = options.approve === true || options.operatorApproval?.approved === true || options.operatorApproval?.approval_state === "approved";
  const board = summarizeBoard(cwd);
  const candidateRows = Array.isArray(board.evidenceCandidateRows) ? board.evidenceCandidateRows : [];
  const requestedTaskIds = unique((Array.isArray(options.taskIds) && options.taskIds.length > 0
    ? options.taskIds
    : candidateRows.map((row) => row.taskId)).map((id) => String(id).trim()).filter(Boolean));
  const candidateById = new Map(candidateRows.map((row) => [row.taskId, row]));
  const missingCandidateTaskIds = requestedTaskIds.filter((id) => !candidateById.has(id));
  const missingEvidenceTaskIds = action === "park-for-target-release"
    ? requestedTaskIds.filter((id) => candidateById.get(id)?.evidencePresent !== true)
    : [];
  const requiredApprovalPrompt = `approve board release disposition ${action} ${requestedTaskIds.join(",")}`;
  const blockers = [
    ...(VALID_ACTIONS.has(action) ? [] : [`invalid-action:${action}`]),
    ...(requestedTaskIds.length > 0 ? [] : ["task-ids-missing"]),
    ...missingCandidateTaskIds.map((id) => `task-not-release-evidence-candidate:${id}`),
    ...missingEvidenceTaskIds.map((id) => `evidence-missing:${id}`),
    ...(executeRequested && !structuredOperatorApproval ? ["structured-operator-approval-missing"] : []),
  ];
  const { payload } = readTasksFile(cwd);
  if (!payload) blockers.push("tasks-file-missing");
  if (payload && !Array.isArray(payload.tasks)) blockers.push("tasks-array-missing");

  const decision = blockers.length > 0
    ? "blocked"
    : executeRequested
      ? "applied"
      : "ready-for-operator-decision";
  const result = {
    mode: "board-release-disposition",
    schemaVersion: SCHEMA_VERSION,
    decision,
    recommendation: action,
    target,
    action,
    executeRequested,
    dispatchAllowed: false,
    processStartAllowed: false,
    automationAllowed: false,
    structuredOperatorApproval,
    requiredApprovalPrompt,
    taskIds: requestedTaskIds,
    candidateRows: requestedTaskIds.map((id) => candidateById.get(id)).filter(Boolean),
    blockers,
    changedTaskIds: [],
    nextActions: decision === "ready-for-operator-decision"
      ? [`rerun with --execute --approve to apply ${action} to ${requestedTaskIds.join(",")}`]
      : decision === "blocked"
        ? ["resolve blockers before editing .project/tasks.json"]
        : ["rerun release readiness report"],
    summary: `board-release-disposition: decision=${decision} action=${action} tasks=${requestedTaskIds.length} execute=${executeRequested ? "yes" : "no"} dispatch=no`,
  };

  if (decision === "applied") {
    const { nextPayload, changedTaskIds } = applyDisposition({ payload, taskIds: requestedTaskIds, action, target });
    writeJson(path.join(cwd, ".project", "tasks.json"), nextPayload, true);
    result.changedTaskIds = changedTaskIds;
  }
  return result;
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/board-release-disposition.mjs [--target 0.8.0] [--action park-for-target-release|require-work] [--task ID|--tasks A,B] [--execute --approve] [--out PATH] [--pretty]",
    "",
    "Preview or apply a board release disposition to evidence-backed board tasks. It never dispatches processes.",
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
    const result = buildBoardReleaseDisposition(args);
    if (args.outPath) writeJson(path.resolve(args.cwd, args.outPath), result, args.pretty);
    process.stdout.write(JSON.stringify(result, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (result.decision === "blocked") process.exit(1);
  }
}
