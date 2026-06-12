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

function buildProposedTasks(audit) {
  const commonGuards = [
    "Não promover protected/parked tasks sem decisão explícita do operador.",
    "Não autorizar release tag, publish, workflow dispatch, process start ou agent dispatch.",
    "Manter a proposta local-safe e revisável antes de editar .project/tasks.json.",
  ];
  const provenance = `Draft gerado por board-next-scope-intake quando audit=${audit.decision}; revisar antes de materializar no board.`;

  return [
    {
      id: "TASK-BUD-DRAFT-CORE-WORKER-QUEUE",
      description: "[P1] Definir fila agnóstica de worker steps para atacar tasks do board sem depender de colony ou release.",
      status: "planned",
      priority: "p1",
      files: [
        "docs/primitives/agent-worker-envelope.md",
        "docs/primitives/agent-worker-isolation.md",
        "scripts/agent-run-driver-step.mjs",
        "scripts/agent-worker-isolation.mjs",
        "scripts/test/agent-run-driver-step.test.mjs",
      ],
      corePrimitives: [
        "worker envelope agnóstico",
        "driver step single-run",
        "isolamento de cwd/files/log/env",
      ],
      adapterExtensions: [
        "Pi provider como executor opcional",
        "board fanout como consumidor de fila",
      ],
      validationFocus: [
        "node --test scripts/test/agent-run-driver-step.test.mjs",
        "node scripts/agent-run-driver-canary-suite.mjs --execute --out .artifacts/agent-run-driver/suite.json",
      ],
      acceptance_criteria: [
        "Fila descreve cada step por runSpec/handoff genérico, sem termos colony no contrato core.",
        "Cada step mantém singleRunOnly, cwd/files/logPath e approval gates antes de dispatch.",
        "Adapters Pi/board consomem a fila sem alterar o contrato core.",
        ...commonGuards,
      ],
      milestone: "0.8-worker-orchestration",
      notes: provenance,
    },
    {
      id: "TASK-BUD-DRAFT-BOARD-FANOUT-ASSIMILATION",
      description: "[P1] Transformar tasks acionáveis do board em fanout local-safe com critérios de fan-in parent-side.",
      status: "planned",
      priority: "p1",
      files: [
        "scripts/project/board-spec-audit.mjs",
        "scripts/project/board-next-scope-intake.mjs",
        "scripts/agent-run-pi-provider-fanout-plan.mjs",
        "scripts/agent-run-pi-provider-worker-dispatch.mjs",
        "scripts/test/board-spec-audit.test.mjs",
        "scripts/test/agent-run-pi-provider-fanout-plan.test.mjs",
      ],
      corePrimitives: [
        "task readiness",
        "bounded fanout manifest",
        "parent-side outcome aggregation",
      ],
      adapterExtensions: [
        "Pi worker dispatch adapter",
        "board-specific task selection",
      ],
      validationFocus: [
        "node --test scripts/test/board-spec-audit.test.mjs scripts/test/agent-run-pi-provider-fanout-plan.test.mjs",
        "node scripts/project/board-spec-audit.mjs --json",
      ],
      acceptance_criteria: [
        "Fanout plan seleciona apenas tasks local-safe acionáveis e declara arquivos/criteria por worker.",
        "Resultado de workers vira evidência parent-side antes de materializar novas tasks.",
        "Protected/parked tasks aparecem como gated, não como dispatch candidates.",
        ...commonGuards,
      ],
      milestone: "0.8-potential-completeness",
      notes: provenance,
    },
    {
      id: "TASK-BUD-DRAFT-OPERATIONAL-MEMORY-GATE",
      description: "[P2] Usar memória operacional validada para reduzir cola manual sem introduzir recall implícito ou provider-specific.",
      status: "planned",
      priority: "p2",
      files: [
        "scripts/context-preload-consume.mjs",
        "scripts/test/context-preload-consume.test.mjs",
        "docs/primitives/agent-worker-envelope.md",
        "docs/research/0-8-potential-completeness-map-2026-06.md",
      ],
      corePrimitives: [
        "memory packet com provenance/freshness",
        "context preload validado",
        "expiration/fail-closed",
      ],
      adapterExtensions: [
        "Pi prompt preload",
        "board/report artifact producer",
      ],
      validationFocus: [
        "node --test scripts/test/context-preload-consume.test.mjs",
      ],
      acceptance_criteria: [
        "Memória operacional só entra quando possui provenance, timestamp e freshness válidos.",
        "Memórias expiradas ou sem provenance tornam o preload stale sem bloquear trabalho local-safe simples.",
        "Adapters podem anexar memória, mas o core preserva o contrato agnóstico.",
        ...commonGuards,
      ],
      milestone: "0.8-operational-memory",
      notes: provenance,
    },
  ];
}

export function buildBoardNextScopeIntake(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const boardPath = String(options.boardPath || DEFAULT_BOARD_PATH);
  const audit = buildBoardSpecAudit({ cwd, boardPath });
  const blockers = [];
  if (audit.decision === "blocked") blockers.push(...audit.blockers);

  const proposedBoardTasks = audit.decision === "no-local-safe-work" && blockers.length === 0
    ? buildProposedTasks(audit)
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
