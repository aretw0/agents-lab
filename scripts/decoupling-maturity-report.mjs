#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DECUPLING_LANE_PHASES = ["stabilize", "delegate", "decouple"];
const DOC_FILES = {
  decouplingLane: path.join("docs", "research", "control-plane-decoupling-lane-2026-05.md"),
  singleWorkerLane: path.join("docs", "research", "single-worker-board-driven-lane-maturity-2026-05.md"),
  agentRunnerCheckpoint: path.join("docs", "research", "agent-runner-maturity-checkpoint-2026-05.md"),
  firstWorkerMode: path.join("docs", "research", "agent-first-operating-mode-2026-05.md"),
  firstPartyArch: path.join("docs", "research", "first-party-agent-lane-architecture-2026-05.md"),
  nativeRunner: path.join("docs", "research", "agent-run-provider-native-runner-2026-05.md"),
  colonyGapReport: path.join(".project", "reports", "TASK-BUD-521-executor-propagation-gap.md"),
};

function parseArgs(argv) {
  const out = { days: 7, json: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    if ((key === "--days" || key === "-d") && val) {
      out.days = Math.max(1, Number(val) || out.days);
      i++;
      continue;
    }
    if (key === "--json") {
      out.json = true;
      continue;
    }
  }
  return out;
}

function runNodeScript(args) {
  const out = spawnSync("node", args, { encoding: "utf8", stdio: "pipe" });
  return {
    ok: out.status === 0,
    stdout: String(out.stdout ?? ""),
    stderr: String(out.stderr ?? ""),
    status: out.status,
  };
}

function readText(cwd, relPath) {
  try {
    return readFileSync(path.join(cwd, relPath), "utf8");
  } catch {
    return "";
  }
}

export function readTasks(cwd) {
  const file = path.join(cwd, ".project", "tasks.json");
  const json = JSON.parse(readFileSync(file, "utf8"));
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.tasks)) return json.tasks;
  return [];
}

export function readVerificationRows(cwd) {
  const file = path.join(cwd, ".project", "verification.json");
  const json = JSON.parse(readFileSync(file, "utf8"));
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.verifications)) return json.verifications;
  if (Array.isArray(json.items)) return json.items;
  return [];
}

export function statusById(tasks, id) {
  const row = tasks.find((task) => String(task?.id ?? "") === id);
  return String(row?.status ?? "unknown");
}

export function extractTaskIdsFromText(text) {
  const taskIds = [];
  const seen = new Set();
  const regex = /TASK-BUD-\d+/g;
  for (const match of String(text ?? "").matchAll(regex)) {
    const id = match[0];
    if (!seen.has(id)) {
      seen.add(id);
      taskIds.push(id);
    }
  }
  return taskIds;
}

export function resolveLanePhases(cwd) {
  const decouplingLaneText = readText(cwd, DOC_FILES.decouplingLane);
  const ids = extractTaskIdsFromText(decouplingLaneText);
  const phases = Object.fromEntries(DECUPLING_LANE_PHASES.map((name) => [name, { id: undefined, status: "missing" }]));

  for (let i = 0; i < DECUPLING_LANE_PHASES.length; i += 1) {
    const phase = DECUPLING_LANE_PHASES[i];
    const id = ids[i];
    if (id) {
      phases[phase].id = id;
    }
  }

  return phases;
}

export function resolveLaneTaskStatuses(tasks = [], verificationRows = [], phases = {}) {
  const out = {};
  for (const phase of DECUPLING_LANE_PHASES) {
    const ref = phases[phase] ?? { id: undefined };
    const id = ref.id;
    const boardStatus = id ? statusById(tasks, id) : "missing";
    const verified = Boolean(id && hasVerificationEvidence(verificationRows, id));
    let status = boardStatus;

    if (id && status === "unknown" && verified) status = "completed";
    out[phase] = {
      id,
      status: id ? (status === "unknown" ? "missing" : status) : "missing",
    };
  }

  return out;
}

export function resolveStageFromLaneStatuses(laneStatuses = {}) {
  const decouple = laneStatuses.decouple?.status;
  const delegate = laneStatuses.delegate?.status;
  const stabilize = laneStatuses.stabilize?.status;

  if (decouple === "completed") return "decouple";
  if (delegate === "completed") return "delegate";
  if (stabilize === "completed") return "stabilize";
  return "bootstrap";
}

export function resolveStage(task637, task638, task639) {
  const lane = {
    stabilize: { status: task637 },
    delegate: { status: task638 },
    decouple: { status: task639 },
  };
  return resolveStageFromLaneStatuses(lane);
}

export function nextActionForStage(stage) {
  if (stage === "bootstrap") {
    return {
      recommendationCode: "decoupling-bootstrap-complete-task-637",
      nextAction: "complete TASK-BUD-637 lane contract first (stabilize phase).",
    };
  }
  if (stage === "stabilize") {
    return {
      recommendationCode: "decoupling-stage-stabilize-execute-638",
      nextAction: "execute TASK-BUD-638 (report-only maturity telemetry) and keep local-safe slices bounded.",
    };
  }
  if (stage === "delegate") {
    return {
      recommendationCode: "decoupling-stage-delegate-execute-639",
      nextAction: "execute TASK-BUD-639 (3-5 slices runbook with stop contracts) before expanding unattended cadence.",
    };
  }
  return {
    recommendationCode: "decoupling-stage-decouple-maintain",
    nextAction: "maintain decouple lane with periodic KPI review and fail-closed rollback to stabilize on drift.",
  };
}

function nextActionForMaturityState(state, laneStatuses = {}) {
  if (state === "colony-blocked-by-executor-propagation-gap") {
    return {
      recommendationCode: "decoupling-colony-blocked-executor-propagation-gap",
      nextAction: "pause colony promotion/research until executor propagation contract is fixed and revalidated with report-only anti-flux evidence.",
    };
  }
  if (state === "single-worker-ready") {
    const stableTask = laneStatuses.stabilize?.id ?? "decoupling-control-plane lane";
    return {
      recommendationCode: "decoupling-single-worker-ready",
      nextAction: `advance single-worker lane with bounded local-safe slices; keep ${stableTask} as traceable first-party target.`,
    };
  }
  if (state === "multi-worker-not-ready") {
    return {
      recommendationCode: "decoupling-multi-worker-not-ready",
      nextAction: "multi-worker/colony remain blocked by evidence policy; continue single-worker lane until evidence for stable parallel execution is added.",
    };
  }
  return {
    recommendationCode: "decoupling-control-plane-only",
    nextAction: "continue control-plane-only lane (local-safe, bounded, explicit operator authorization) until decoupling evidence appears on board/verification.",
  };
}

export function hasVerificationEvidence(rows, taskId, marker) {
  const list = Array.isArray(rows) ? rows : [];
  const normalizedMarker = typeof marker === "string" ? marker : "";
  return list.some((row) => {
    const id = String(row?.id ?? "");
    const rowTaskId = String(row?.task_id ?? row?.taskId ?? "");
    const evidence = String(row?.evidence ?? "");
    const matchesTask = id.includes(taskId) || rowTaskId === taskId;
    if (!matchesTask) return false;
    if (!normalizedMarker) return true;
    return id.includes(normalizedMarker) || evidence.includes(normalizedMarker);
  });
}

export function resolveColonyPropagationGap(verificationRows = [], cwd = process.cwd()) {
  const rows = Array.isArray(verificationRows) ? verificationRows : [];
  const byVerification = rows.some((row) => {
    const evidence = `${row?.id ?? ""} ${row?.task_id ?? ""} ${row?.target ?? ""} ${row?.evidence ?? ""}`.toLowerCase();
    return evidence.includes("executor") && evidence.includes("propagation")
      || evidence.includes("modeloverrides")
      || evidence.includes("ant_colony")
      || evidence.includes("ant-colony");
  });

  if (byVerification) return true;

  const gapReport = readText(cwd, DOC_FILES.colonyGapReport).toLowerCase();
  return gapReport.includes("executor propagation gap") || gapReport.includes("modeloverrides");
}

function fileContains(cwd, relPath, marker) {
  const text = readText(cwd, relPath);
  return text.includes(marker);
}

function hasAny(cwd, relPath, markers) {
  const text = readText(cwd, relPath).toLowerCase();
  return markers.some((marker) => text.includes(marker.toLowerCase()));
}

export function resolveDecouplingState({ laneStage, laneStatuses = {}, docsSignals = {} }) {
  const multiWorkerBlocked = docsSignals.multiWorkerBlocked === true;

  if (docsSignals.colonyGap === true) {
    return "colony-blocked-by-executor-propagation-gap";
  }

  if (laneStage !== "bootstrap" && !multiWorkerBlocked) {
    return "single-worker-ready";
  }

  if (laneStage === "delegate" || laneStage === "decouple") {
    return "multi-worker-not-ready";
  }

  if (laneStage === "stabilize") {
    return "single-worker-ready";
  }

  return "control-plane-only";
}

export function resolveAgentWorkerLane({ docs = {}, tasks = {}, verification = {} } = {}) {
  const maturityDecision = docs.singleWorkerMaturity === true;
  const runnerCheckpoint = docs.agentRunnerMaturity === true;
  const firstWorkerMode = docs.agentFirstMode === true;
  const task1068 = String(tasks["TASK-BUD-1068"] ?? "unknown");
  const task1075 = String(tasks["TASK-BUD-1075"] ?? "unknown");
  const task1066 = String(tasks["TASK-BUD-1066"] ?? "unknown");
  const task1075PassEvidence = verification.task1075OneFileMutationPass === true
    && verification.task1075RungCodified === true;
  const hasSingleWorkerEvidence = maturityDecision && runnerCheckpoint && (task1075 === "completed" || task1075PassEvidence);
  const boardAligned = task1075 === "completed";
  const subprocessBlocked = task1066 !== "completed";

  if (hasSingleWorkerEvidence) {
    if (!boardAligned) {
      return {
        stage: "single-worker-evidence-ready-board-open",
        recommendationCode: "agent-worker-lane-align-board-before-expansion",
        nextAction: "single-worker evidence exists; align TASK-BUD-1075 board status before expanding worker autonomy.",
        gates: {
          singleWorkerMaturityDecision: maturityDecision,
          agentRunnerMaturityCheckpoint: runnerCheckpoint,
          agentFirstMode: firstWorkerMode,
          task1068,
          task1075,
          task1066,
          task1075PassEvidence,
          boardAligned,
          subprocessBlocked,
        },
      };
    }
    return {
      stage: "single-worker-operational",
      recommendationCode: subprocessBlocked
        ? "agent-worker-lane-use-single-worker-hold-subprocess"
        : "agent-worker-lane-use-single-worker",
      nextAction: subprocessBlocked
        ? "use bounded single-worker SDK lane for local-safe work; keep subprocess and colony promotion gated."
        : "use bounded single-worker lane for local-safe work; consider the next explicit multi-worker rehearsal gate.",
      gates: {
        singleWorkerMaturityDecision: maturityDecision,
        agentRunnerMaturityCheckpoint: runnerCheckpoint,
        agentFirstMode: firstWorkerMode,
        task1068,
        task1075,
        task1066,
        task1075PassEvidence,
        boardAligned,
        subprocessBlocked,
      },
    };
  }

  return {
    stage: "needs-evidence",
    recommendationCode: "agent-worker-lane-needs-evidence",
    nextAction: "complete bounded single-worker evidence before expanding worker autonomy.",
    gates: {
      singleWorkerMaturityDecision: maturityDecision,
      agentRunnerMaturityCheckpoint: runnerCheckpoint,
      agentFirstMode: firstWorkerMode,
      task1068,
      task1075,
      task1066,
      task1075PassEvidence,
      boardAligned,
      subprocessBlocked,
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  const triageRun = runNodeScript([
    path.join("scripts", "session-triage.mjs"),
    "--days",
    String(args.days),
    "--limit",
    "12",
    "--json",
  ]);

  let triage = { recommendation: {}, aggregate: {}, board: {} };
  if (triageRun.ok) {
    try {
      triage = JSON.parse(triageRun.stdout);
    } catch {
      triage = { recommendation: {}, aggregate: {}, board: {}, parseError: true };
    }
  }

  const tasks = readTasks(cwd);
  const verificationRows = readVerificationRows(cwd);

  const lanePhases = resolveLanePhases(cwd);
  const laneStatuses = resolveLaneTaskStatuses(tasks, verificationRows, lanePhases);
  const stage = resolveStageFromLaneStatuses(laneStatuses);

  const task1066 = statusById(tasks, "TASK-BUD-1066");
  const task1068 = statusById(tasks, "TASK-BUD-1068");
  const task1075 = statusById(tasks, "TASK-BUD-1075");

  const docsSignals = {
    colonyGap: resolveColonyPropagationGap(verificationRows, cwd),
    multiWorkerBlocked: hasAny(cwd, DOC_FILES.singleWorkerLane, ["no multi-worker", "blocked", "colony promotion"]) ||
      hasAny(cwd, DOC_FILES.firstPartyArch, ["current background gates not green", "parallel/background/colony", "multi-agent / colony"]) ||
      hasAny(cwd, DOC_FILES.nativeRunner, ["keep multi-worker", "colony", "background"]),
  };

  const maturityState = resolveDecouplingState({
    laneStage: stage,
    laneStatuses,
    docsSignals,
  });
  const maturityAction = nextActionForMaturityState(maturityState, laneStatuses);

  const agentWorkerLane = resolveAgentWorkerLane({
    docs: {
      singleWorkerMaturity: fileContains(
        cwd,
        DOC_FILES.singleWorkerLane,
        "single-worker-board-driven-lane-maturity-decision",
      ),
      agentRunnerMaturity: fileContains(
        cwd,
        DOC_FILES.agentRunnerCheckpoint,
        "agent-first-worker-lane",
      ),
      agentFirstMode: fileContains(
        cwd,
        DOC_FILES.firstWorkerMode,
        "single-worker",
      ),
    },
    tasks: {
      "TASK-BUD-1066": task1066,
      "TASK-BUD-1068": task1068,
      "TASK-BUD-1075": task1075,
    },
    verification: {
      task1075OneFileMutationPass: hasVerificationEvidence(
        verificationRows,
        "TASK-BUD-1075",
        "SDK-ONE-FILE-MUTATION-PASS",
      ),
      task1075RungCodified: hasVerificationEvidence(
        verificationRows,
        "TASK-BUD-1075",
        "SDK-MUTATION-RUNG-CODIFIED",
      ),
    },
  });

  const completeSignals = Number(triage?.recommendation?.metrics?.completeSignals ?? 0);
  const unlockNowCount = Number(triage?.recommendation?.metrics?.unlockNowCount ?? 0);
  const blockedNowCount = Number(triage?.recommendation?.metrics?.blockedNowCount ?? 0);
  const pendingCount = Array.isArray(triage?.board?.pending) ? triage.board.pending.length : 0;

  const summary = `decoupling-maturity: stage=${stage} maturity=${maturityState} recommendationCode=${maturityAction.recommendationCode} next=${maturityAction.nextAction}`;

  const report = {
    summary,
    generatedAt: new Date().toISOString(),
    lookbackDays: args.days,
    stage,
    recommendationCode: maturityAction.recommendationCode,
    nextAction: maturityAction.nextAction,
    maturityState,

    metrics: {
      completeSignals,
      unlockNowCount,
      blockedNowCount,
      pendingCount,
    },
    laneTasks: laneStatuses,
    lanePhases,
    agentWorkerLane,
    evidenceSources: {
      sessionTriage: triageRun.ok ? "ok" : `error(${triageRun.status})`,
      sessionTriageParse: triage?.parseError ? "invalid-json" : "ok",
      boardTasks: ".project/tasks.json",
      verification: ".project/verification.json",
      laneDocs: DOC_FILES.decouplingLane,
      colonyGapReport: docsSignals.colonyGap ? DOC_FILES.colonyGapReport : "none",
    },
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${summary}\n`);
  process.stdout.write(
    `metrics: completeSignals=${completeSignals} unlockNow=${unlockNowCount} blockedNow=${blockedNowCount} pending=${pendingCount}\n`,
  );
  for (const phase of DECUPLING_LANE_PHASES) {
    const row = laneStatuses[phase];
    process.stdout.write(`lanePhase ${phase}: ${row?.id ?? "-"} -> ${row?.status ?? "missing"}\n`);
  }
  process.stdout.write(
    `agentWorkerLane: stage=${agentWorkerLane.stage} recommendationCode=${agentWorkerLane.recommendationCode} next=${agentWorkerLane.nextAction}\n`,
  );
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main();
}
