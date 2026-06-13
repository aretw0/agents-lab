#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

function readBoardTasks(cwd, boardPath) {
  const fullPath = path.resolve(cwd, boardPath);
  if (!existsSync(fullPath)) return [];
  const board = JSON.parse(readFileSync(fullPath, "utf8"));
  return Array.isArray(board?.tasks) ? board.tasks : [];
}

function materializedDraftIds(tasks) {
  const haystack = tasks.map((task) => [
    task?.id,
    task?.description,
    task?.notes,
  ].join("\n")).join("\n");
  return new Set([...haystack.matchAll(/TASK-BUD-DRAFT-[A-Z0-9-]+/g)].map((match) => match[0]));
}

function filterAlreadyMaterializedProposals(tasks, proposedTasks) {
  const materialized = materializedDraftIds(tasks);
  return proposedTasks.filter((task) => !materialized.has(task.id));
}

function buildExhaustedScopeCandidates({ materializedProposalCount, protectedTaskIds }) {
  const commonBlockers = [
    "operator-review-required-before-board-edit",
    "protected-scope-remains-gated",
  ];
  const candidates = [
    {
      candidateId: "local-safe-external-influence-assimilation",
      category: "local-safe",
      title: "Assimilate approved external influence artifacts into local docs/tests",
      rationale: "Known board proposals are already materialized; the next safe move is to convert approved research artifacts into bounded local tasks without more URL fetches.",
      files: [
        ".project/reports/external-influence-fanin-0-8.json",
        "docs/primitives/agent-worker-envelope.md",
        "docs/primitives/agent-worker-isolation.md",
        "scripts/context-preload-consume.mjs",
        "scripts/test/context-preload-consume.test.mjs",
      ],
      acceptanceCriteria: [
        "Use only existing local fan-in artifacts; do not fetch URLs, clone repositories, install dependencies or execute external code.",
        "Separate 0.8-candidate influence from post-0.8 hardening so sandbox or swarm claims do not expand the release promise.",
        "Produce board-ready tasks with files, validation commands and explicit non-goals before any code changes.",
      ],
      validationCommands: [
        "node scripts/project/board-spec-audit.mjs --json",
        "node --test scripts/test/context-preload-consume.test.mjs",
      ],
      blockers: commonBlockers,
      filesTouched: [],
      dispatchAllowed: false,
      processStartAllowed: false,
      workflowDispatchAllowed: false,
      tagAllowed: false,
      publishAllowed: false,
    },
    {
      candidateId: "local-safe-worker-volume-canary",
      category: "local-safe",
      title: "Define a worker-volume canary from current board tasks using agnostic driver steps",
      rationale: "The board can keep proving coordination by selecting multiple actionable local-safe tasks and requiring parent-side fan-in before mutation.",
      files: [
        "scripts/agent-run-driver-fanout-rehearsal.mjs",
        "scripts/agent-run-driver-fanout-manifest.mjs",
        "scripts/agent-run-driver-fanout-outcome.mjs",
        "scripts/project/board-spec-audit.mjs",
        "scripts/test/agent-run-driver-fanout-rehearsal.test.mjs",
      ],
      acceptanceCriteria: [
        "Generate a bounded worker manifest from actionable local-safe board tasks without using ant_colony or provider-specific semantics.",
        "Require each worker outcome to be present, terminal and parent-side validated before any board mutation.",
        "Keep release, publish, workflow dispatch and protected scope disabled throughout the rehearsal.",
      ],
      validationCommands: [
        "node --test scripts/test/agent-run-driver-fanout-rehearsal.test.mjs",
        "node scripts/project/board-spec-audit.mjs --json",
      ],
      blockers: commonBlockers,
      filesTouched: [],
      dispatchAllowed: false,
      processStartAllowed: false,
      workflowDispatchAllowed: false,
      tagAllowed: false,
      publishAllowed: false,
    },
  ];

  if (protectedTaskIds.length > 0) {
    return candidates.map((candidate) => ({
      ...candidate,
      protectedTaskIds,
      blockers: [
        ...candidate.blockers,
        "protected-task-operator-decision-required",
      ],
    }));
  }

  return candidates.map((candidate) => ({
    ...candidate,
    materializedProposalCount,
  }));
}

export function buildBoardNextScopeIntake(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const boardPath = String(options.boardPath || DEFAULT_BOARD_PATH);
  const audit = buildBoardSpecAudit({ cwd, boardPath });
  const boardTasks = readBoardTasks(cwd, boardPath);
  const blockers = [];
  if (audit.decision === "blocked") blockers.push(...audit.blockers);

  const knownProposals = buildProposedTasks(audit);
  const proposalMode = audit.decision === "no-local-safe-work" && blockers.length === 0;
  const proposedBoardTasks = proposalMode
    ? filterAlreadyMaterializedProposals(boardTasks, knownProposals)
    : [];
  const decision = blockers.length > 0
    ? "blocked"
    : proposedBoardTasks.length > 0
      ? "ready-for-operator-decision"
      : audit.decision === "no-local-safe-work"
        ? "scope-exhausted"
        : "defer-to-existing-board-work";
  const recommendationCode = decision === "ready-for-operator-decision"
    ? "board-next-scope-intake-ready"
    : decision === "defer-to-existing-board-work"
      ? "board-next-scope-intake-defer-existing-work"
      : decision === "scope-exhausted"
        ? "board-next-scope-intake-scope-exhausted"
        : "board-next-scope-intake-blocked";
  const materializedProposalCount = proposalMode ? knownProposals.length - proposedBoardTasks.length : 0;
  const nextScopeCandidates = decision === "scope-exhausted"
    ? buildExhaustedScopeCandidates({
        materializedProposalCount,
        protectedTaskIds: audit.protectedTaskIds,
      })
    : audit.nextScopeCandidates;

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
    nextScopeCandidates,
    proposedBoardTasks,
    materializedProposalCount,
    blockers,
    nextActions: proposedBoardTasks.length > 0
      ? [
          "review proposedBoardTasks before editing .project/tasks.json",
          "materialize at most one local-safe task with explicit files and acceptance criteria",
          "keep protected/parked tasks gated by explicit operator decision",
        ]
      : decision === "scope-exhausted"
        ? [
            "define a new local-safe scope candidate before editing .project/tasks.json",
            "keep protected/parked tasks gated by explicit operator decision",
            "do not dispatch workers, release, publish or start processes from this packet",
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
