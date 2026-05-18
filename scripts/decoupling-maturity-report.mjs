#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

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

export function resolveStage(task637, task638, task639) {
  if (task639 === "completed") return "decouple";
  if (task638 === "completed") return "delegate";
  if (task637 === "completed") return "stabilize";
  return "bootstrap";
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

export function hasVerificationEvidence(rows, taskId, marker) {
  const list = Array.isArray(rows) ? rows : [];
  return list.some((row) => {
    const id = String(row?.id ?? "");
    const rowTaskId = String(row?.task_id ?? row?.taskId ?? "");
    const evidence = String(row?.evidence ?? "");
    const matchesTask = id.includes(taskId) || rowTaskId === taskId;
    return matchesTask && (!marker || id.includes(marker) || evidence.includes(marker));
  });
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

function fileContains(cwd, relPath, marker) {
  try {
    return readFileSync(path.join(cwd, relPath), "utf8").includes(marker);
  } catch {
    return false;
  }
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
  const task637 = statusById(tasks, "TASK-BUD-637");
  const task638 = statusById(tasks, "TASK-BUD-638");
  const task639 = statusById(tasks, "TASK-BUD-639");
  const task1066 = statusById(tasks, "TASK-BUD-1066");
  const task1068 = statusById(tasks, "TASK-BUD-1068");
  const task1075 = statusById(tasks, "TASK-BUD-1075");

  const stage = resolveStage(task637, task638, task639);
  const action = nextActionForStage(stage);
  const agentWorkerLane = resolveAgentWorkerLane({
    docs: {
      singleWorkerMaturity: fileContains(
        cwd,
        path.join("docs", "research", "single-worker-board-driven-lane-maturity-2026-05.md"),
        "single-worker-board-driven-lane-maturity-decision",
      ),
      agentRunnerMaturity: fileContains(
        cwd,
        path.join("docs", "research", "agent-runner-maturity-checkpoint-2026-05.md"),
        "agent-first-worker-lane",
      ),
      agentFirstMode: fileContains(
        cwd,
        path.join("docs", "research", "agent-first-operating-mode-2026-05.md"),
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

  const summary = `decoupling-maturity: stage=${stage} recommendationCode=${action.recommendationCode} next=${action.nextAction}`;

  const report = {
    summary,
    generatedAt: new Date().toISOString(),
    lookbackDays: args.days,
    stage,
    recommendationCode: action.recommendationCode,
    nextAction: action.nextAction,
    metrics: {
      completeSignals,
      unlockNowCount,
      blockedNowCount,
      pendingCount,
    },
    laneTasks: {
      "TASK-BUD-637": task637,
      "TASK-BUD-638": task638,
      "TASK-BUD-639": task639,
    },
    agentWorkerLane,
    evidenceSources: {
      sessionTriage: triageRun.ok ? "ok" : `error(${triageRun.status})`,
      sessionTriageParse: triage?.parseError ? "invalid-json" : "ok",
      boardTasks: ".project/tasks.json",
      verification: ".project/verification.json",
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
  process.stdout.write(
    `lane: 637=${task637} 638=${task638} 639=${task639}\n`,
  );
  process.stdout.write(
    `agentWorkerLane: stage=${agentWorkerLane.stage} recommendationCode=${agentWorkerLane.recommendationCode} next=${agentWorkerLane.nextAction}\n`,
  );
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main();
}
