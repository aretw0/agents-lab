#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

function readTasks(cwd) {
  const file = path.join(cwd, ".project", "tasks.json");
  const json = JSON.parse(readFileSync(file, "utf8"));
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.tasks)) return json.tasks;
  return [];
}

function statusById(tasks, id) {
  const row = tasks.find((task) => String(task?.id ?? "") === id);
  return String(row?.status ?? "unknown");
}

function resolveStage(task637, task638, task639) {
  if (task639 === "completed") return "decouple";
  if (task638 === "completed") return "delegate";
  if (task637 === "completed") return "stabilize";
  return "bootstrap";
}

function nextActionForStage(stage) {
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
  const task637 = statusById(tasks, "TASK-BUD-637");
  const task638 = statusById(tasks, "TASK-BUD-638");
  const task639 = statusById(tasks, "TASK-BUD-639");

  const stage = resolveStage(task637, task638, task639);
  const action = nextActionForStage(stage);

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
    evidenceSources: {
      sessionTriage: triageRun.ok ? "ok" : `error(${triageRun.status})`,
      sessionTriageParse: triage?.parseError ? "invalid-json" : "ok",
      boardTasks: ".project/tasks.json",
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
}

main();
