#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildBoardSpecAudit } from "./board-spec-audit.mjs";

const DEFAULT_BOARD_PATH = ".project/tasks.json";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    boardPath: DEFAULT_BOARD_PATH,
    outPath: "",
    json: false,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--board") out.boardPath = argv[++index] ?? out.boardPath;
    else if (arg === "--out") out.outPath = argv[++index] ?? out.outPath;
    else if (arg === "--json") out.json = true;
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function buildProposedTask(audit) {
  return {
    id: "TASK-BUD-DRAFT-NEXT-LOCAL-SCOPE",
    description: "[P1] Propor a próxima lane local-safe a partir do board/readiness atual, sem abrir protected scope nem release.",
    status: "planned",
    priority: "p1",
    files: [
      "scripts/project/board-spec-audit.mjs",
      "scripts/project/board-next-scope-intake.mjs",
      "scripts/test/board-next-scope-intake.test.mjs",
      "scripts/release-readiness-report.mjs",
      "docs/research/0-8-potential-completeness-map-2026-06.md",
      ".project/tasks.json",
    ],
    acceptance_criteria: [
      "Gerar 2-3 propostas de tasks local-safe com arquivos e critérios de aceite, sem editar o board automaticamente.",
      "Não promover protected/parked tasks sem decisão explícita do operador.",
      "Não autorizar release tag, publish, workflow dispatch, process start ou agent dispatch.",
      "Cada proposta diferencia core/primitives de adapters e aponta validação focal.",
    ],
    milestone: "0.8-potential-completeness",
    notes: `Draft gerado por board-next-scope-intake quando audit=${audit.decision}; revisar antes de materializar no board.`,
  };
}

export function buildBoardNextScopeIntake(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const boardPath = String(options.boardPath || DEFAULT_BOARD_PATH);
  const audit = buildBoardSpecAudit({ cwd, boardPath });
  const blockers = [];
  if (audit.decision === "blocked") blockers.push(...audit.blockers);

  const proposedBoardTasks = audit.decision === "no-local-safe-work" && blockers.length === 0
    ? [buildProposedTask(audit)]
    : [];
  const decision = blockers.length > 0
    ? "blocked"
    : proposedBoardTasks.length > 0
      ? "ready-for-operator-decision"
      : "defer-to-existing-board-work";
  const recommendationCode = decision === "ready-for-operator-decision"
    ? "board-next-scope-intake-ready"
    : decision === "defer-to-existing-board-work"
      ? "board-next-scope-intake-defer-existing-work"
      : "board-next-scope-intake-blocked";

  return {
    mode: "board-next-scope-intake",
    schemaVersion: 1,
    generatedAtIso: new Date().toISOString(),
    boardPath,
    decision,
    recommendationCode,
    dispatchAllowed: false,
    processStartAllowed: false,
    workflowDispatchAllowed: false,
    tagAllowed: false,
    publishAllowed: false,
    automationAllowed: false,
    auditDecision: audit.decision,
    protectedTaskIds: audit.protectedTaskIds,
    nextScopeCandidates: audit.nextScopeCandidates,
    proposedBoardTasks,
    blockers,
    nextActions: proposedBoardTasks.length > 0
      ? [
          "review proposedBoardTasks before editing .project/tasks.json",
          "materialize at most one local-safe task with explicit files and acceptance criteria",
          "keep protected/parked tasks gated by explicit operator decision",
        ]
      : [
          "continue existing actionable/spec-maturation board work before generating new scope",
        ],
    summary: `board-next-scope-intake: decision=${decision} audit=${audit.decision} proposed=${proposedBoardTasks.length} protected=${audit.protectedTaskIds.length} dispatch=no`,
  };
}

export function writeBoardNextScopeIntake(options = {}) {
  const report = buildBoardNextScopeIntake(options);
  if (options.outPath) {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const outPath = path.resolve(cwd, String(options.outPath));
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`, "utf8");
  }
  return report;
}

function formatSummary(report) {
  return [
    "board next scope intake",
    `decision: ${report.decision}`,
    `auditDecision: ${report.auditDecision}`,
    `proposed: ${report.proposedBoardTasks.length}`,
    `protected: ${report.protectedTaskIds.length}`,
    `summary: ${report.summary}`,
  ].join("\n");
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/project/board-next-scope-intake.mjs [--json] [--out PATH]",
    "",
    "Builds a report-only next-scope packet from the current board audit.",
    "It never edits the board, dispatches workers, starts processes, creates tags, or publishes.",
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

  const report = writeBoardNextScopeIntake(args);
  process.stdout.write(args.json ? `${JSON.stringify(report, null, args.pretty ? 2 : 0)}\n` : `${formatSummary(report)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
