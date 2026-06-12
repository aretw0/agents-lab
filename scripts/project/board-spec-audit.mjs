#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_BOARD_PATH = ".project/tasks.json";
const PROTECTED_SIGNAL_RE = /https?:\/\/|\.github\/|\.obsidian\/|\.pi\/settings\.json|\bgithub actions\b|\bremote\b|\bpublish\b|\bcredential\b|\bsecret\b|\btoken\b/i;

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

function taskText(task) {
  return [
    task?.id,
    task?.description,
    task?.milestone,
    task?.notes,
    ...taskFiles(task),
  ].join("\n");
}

function isProtectedTask(task) {
  return PROTECTED_SIGNAL_RE.test(taskText(task));
}

function isOpenTask(status) {
  return status !== "completed" && status !== "cancelled";
}

function classifyTaskSpec(task) {
  const taskId = String(task?.id || "").trim();
  const status = normalizeStatus(task?.status);
  const priority = normalizePriority(task?.priority);
  const milestone = String(task?.milestone || "").trim();
  const files = taskFiles(task);
  const acceptanceCriteria = taskCriteria(task);
  const protectedScope = isProtectedTask(task);
  const parkedMilestone = /parked/i.test(milestone);
  const open = isOpenTask(status);
  const gaps = [];

  if (!taskId) gaps.push("task-id-missing");
  if (!String(task?.description || "").trim()) gaps.push("description-missing");
  if (!status) gaps.push("status-missing");
  if (!priority) gaps.push("priority-missing");
  if (!milestone) gaps.push("milestone-missing");
  if (open && files.length === 0) gaps.push("files-missing");
  if (open && acceptanceCriteria.length === 0) gaps.push("acceptance-criteria-missing");
  if (protectedScope) gaps.push("protected-scope");
  if (parkedMilestone) gaps.push("parked-milestone");

  let specStatus = "closed";
  if (open && (protectedScope || parkedMilestone)) specStatus = "protected-or-parked";
  else if (open && gaps.length > 0) specStatus = "needs-spec";
  else if (open) specStatus = "actionable";

  return {
    taskId: taskId || null,
    status: status || null,
    priority: priority || null,
    milestone: milestone || null,
    specStatus,
    protectedScope,
    parkedMilestone,
    filesCount: files.length,
    acceptanceCriteriaCount: acceptanceCriteria.length,
    gaps,
  };
}

function countRows(rows, key) {
  return rows.reduce((out, row) => {
    const value = row[key] ?? "unknown";
    out[value] = (out[value] ?? 0) + 1;
    return out;
  }, {});
}

function buildNextScopeCandidates({ decision, protectedTaskIds }) {
  if (decision !== "no-local-safe-work") return [];
  const candidates = [
    {
      candidateId: "local-safe-board-next-scope-intake",
      category: "local-safe",
      title: "Generate next local-safe board scope from current evidence",
      rationale: "The board has no actionable local-safe work; the next safe move is a report-only scope-intake task that proposes new concrete tasks without release, publish, protected research or dispatch.",
      files: [
        "scripts/project/board-spec-audit.mjs",
        "scripts/test/board-spec-audit.test.mjs",
        ".project/tasks.json",
      ],
      acceptanceCriteria: [
        "When no local-safe work remains, the audit emits report-only nextScopeCandidates.",
        "Candidates never authorize dispatch, process start, workflow dispatch, tag or publish.",
        "Protected/parked tasks remain listed as requiring explicit operator decision.",
      ],
      dispatchAllowed: false,
      processStartAllowed: false,
    },
  ];

  if (protectedTaskIds.length > 0) {
    candidates.push({
      candidateId: "protected-parked-operator-decision",
      category: "operator-decision",
      title: "Ask for explicit protected parked focus or defer release",
      rationale: "Only protected/parked tasks remain; they require explicit operator focus and must not be promoted by the local-safe audit.",
      protectedTaskIds,
      allowedActions: ["keep-parked", "approve-protected-focus", "defer-release"],
      dispatchAllowed: false,
      processStartAllowed: false,
    });
  }

  return candidates;
}

export function buildBoardSpecAudit(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const boardPath = String(options.boardPath || DEFAULT_BOARD_PATH);
  const fullPath = path.resolve(cwd, boardPath);
  const exists = existsSync(fullPath);
  const blockers = [];

  if (!exists) {
    blockers.push("board-missing");
  }

  const board = exists ? JSON.parse(readFileSync(fullPath, "utf8")) : { tasks: [] };
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  if (exists && !Array.isArray(board?.tasks)) blockers.push("board-tasks-missing");

  const taskSpecs = tasks.map(classifyTaskSpec);
  const actionableTaskIds = taskSpecs
    .filter((row) => row.specStatus === "actionable")
    .map((row) => row.taskId)
    .filter(Boolean);
  const specMaturationTaskIds = taskSpecs
    .filter((row) => row.specStatus === "needs-spec")
    .map((row) => row.taskId)
    .filter(Boolean);
  const protectedTaskIds = taskSpecs
    .filter((row) => row.specStatus === "protected-or-parked")
    .map((row) => row.taskId)
    .filter(Boolean);

  const decision = blockers.length > 0
    ? "blocked"
    : specMaturationTaskIds.length > 0
      ? "needs-spec"
      : actionableTaskIds.length > 0
        ? "actionable"
        : "no-local-safe-work";
  const nextActionCode = decision === "actionable"
    ? "generate-fanout-manifest"
    : decision === "needs-spec"
      ? "mature-board-specs"
      : decision === "no-local-safe-work"
        ? "review-next-scope-candidates"
        : "resolve-board-blockers";
  const nextScopeCandidates = buildNextScopeCandidates({ decision, protectedTaskIds });

  return {
    mode: "project-board-spec-audit",
    schemaVersion: 1,
    generatedAtIso: new Date().toISOString(),
    boardPath,
    decision,
    nextActionCode,
    dispatchAllowed: false,
    processStartAllowed: false,
    workflowDispatchAllowed: false,
    automationAllowed: false,
    taskCount: taskSpecs.length,
    counts: {
      byStatus: countRows(taskSpecs, "status"),
      byPriority: countRows(taskSpecs, "priority"),
      bySpecStatus: countRows(taskSpecs, "specStatus"),
    },
    actionableTaskIds,
    specMaturationTaskIds,
    protectedTaskIds,
    nextScopeCandidates,
    taskSpecs,
    blockers,
    summary: `project-board-spec-audit: decision=${decision} tasks=${taskSpecs.length} actionable=${actionableTaskIds.length} needsSpec=${specMaturationTaskIds.length} protected=${protectedTaskIds.length} dispatch=no`,
  };
}

export function writeBoardSpecAudit(options = {}) {
  const report = buildBoardSpecAudit(options);
  if (options.outPath) {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const outPath = path.resolve(cwd, String(options.outPath));
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`, "utf8");
  }
  return report;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    boardPath: DEFAULT_BOARD_PATH,
    outPath: "",
    json: false,
    pretty: false,
    strict: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--board") out.boardPath = argv[++index] ?? out.boardPath;
    else if (arg === "--out") out.outPath = argv[++index] ?? out.outPath;
    else if (arg === "--json") out.json = true;
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--strict") out.strict = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function formatSummary(report) {
  return [
    "project board spec audit",
    `decision: ${report.decision}`,
    `tasks: ${report.taskCount}`,
    `actionable: ${report.actionableTaskIds.length}`,
    `needsSpec: ${report.specMaturationTaskIds.length}`,
    `protectedOrParked: ${report.protectedTaskIds.length}`,
    `nextActionCode: ${report.nextActionCode}`,
    `summary: ${report.summary}`,
  ].join("\n");
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/project/board-spec-audit.mjs [--json] [--out PATH] [--strict]",
    "",
    "Audits .project/tasks.json for task spec completeness without mutating the board.",
    "It never dispatches workers or starts processes.",
  ].join("\n") + "\n");
}

function main() {
  let args;
  try {
    args = parseArgs();
  } catch (error) {
    process.stderr.write(`${String(error?.message ?? error)}\n`);
    process.exit(2);
  }
  if (args.help) {
    printHelp();
    return;
  }

  const report = writeBoardSpecAudit(args);
  process.stdout.write(args.json ? `${JSON.stringify(report, null, args.pretty ? 2 : 0)}\n` : `${formatSummary(report)}\n`);
  if (args.strict && report.decision === "blocked") process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
