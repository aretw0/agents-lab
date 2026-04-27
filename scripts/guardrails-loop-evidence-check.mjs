#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_MAX_AGE_MIN = 30;

export function evidencePath(cwd = process.cwd()) {
  return path.join(cwd, ".pi", "guardrails-loop-evidence.json");
}

export function readLoopEvidence(cwd = process.cwd()) {
  const filePath = evidencePath(cwd);
  if (!existsSync(filePath)) {
    return {
      exists: false,
      filePath,
      evidence: undefined,
    };
  }

  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    return {
      exists: true,
      filePath,
      evidence: raw,
    };
  } catch (error) {
    return {
      exists: true,
      filePath,
      evidence: undefined,
      parseError: String(error?.message ?? error),
    };
  }
}

export function computeEvidenceReadiness(evidence) {
  const loopReady = evidence?.lastLoopReady;
  const boardAuto = evidence?.lastBoardAutoAdvance;

  const boardRuntimeActive = Boolean(boardAuto && boardAuto.runtimeCodeState === "active");
  const boardEmLoop = Boolean(boardAuto && boardAuto.emLoop === true);
  const loopRuntimeActive = Boolean(loopReady && loopReady.runtimeCodeState === "active");

  const criteria = [
    `boardAuto.runtime=active:${boardAuto ? (boardRuntimeActive ? "yes" : "no") : "n/a"}`,
    `boardAuto.emLoop=yes:${boardAuto ? (boardEmLoop ? "yes" : "no") : "n/a"}`,
    `loopReady.runtime=active:${loopReady ? (loopRuntimeActive ? "yes" : "no") : "n/a"}`,
  ];

  return {
    readyForTaskBud125: boardRuntimeActive && boardEmLoop && loopRuntimeActive,
    criteria,
  };
}

export function assessLoopEvidence({ cwd = process.cwd(), nowMs = Date.now(), maxAgeMin = DEFAULT_MAX_AGE_MIN } = {}) {
  const loaded = readLoopEvidence(cwd);

  if (!loaded.exists) {
    return {
      status: "missing",
      filePath: loaded.filePath,
      updatedAtIso: undefined,
      ageSec: undefined,
      stale: true,
      readyForTaskBud125: false,
      criteria: [
        "boardAuto.runtime=active:n/a",
        "boardAuto.emLoop=yes:n/a",
        "loopReady.runtime=active:n/a",
      ],
      boardAuto: undefined,
      loopReady: undefined,
    };
  }

  if (!loaded.evidence) {
    return {
      status: "invalid-json",
      filePath: loaded.filePath,
      parseError: loaded.parseError,
      updatedAtIso: undefined,
      ageSec: undefined,
      stale: true,
      readyForTaskBud125: false,
      criteria: [
        "boardAuto.runtime=active:n/a",
        "boardAuto.emLoop=yes:n/a",
        "loopReady.runtime=active:n/a",
      ],
      boardAuto: undefined,
      loopReady: undefined,
    };
  }

  const updatedAtIso = typeof loaded.evidence.updatedAtIso === "string"
    ? loaded.evidence.updatedAtIso
    : new Date(0).toISOString();
  const updatedMs = Date.parse(updatedAtIso);
  const ageSec = Number.isFinite(updatedMs)
    ? Math.max(0, Math.floor((nowMs - updatedMs) / 1000))
    : undefined;
  const stale = ageSec === undefined
    ? true
    : ageSec > Math.max(0, Math.floor(maxAgeMin * 60));

  const readiness = computeEvidenceReadiness(loaded.evidence);

  return {
    status: stale ? "stale" : "ok",
    filePath: loaded.filePath,
    updatedAtIso,
    ageSec,
    stale,
    readyForTaskBud125: readiness.readyForTaskBud125,
    criteria: readiness.criteria,
    boardAuto: loaded.evidence.lastBoardAutoAdvance,
    loopReady: loaded.evidence.lastLoopReady,
  };
}

function parseArgs(argv) {
  const out = {
    cwd: process.cwd(),
    maxAgeMin: DEFAULT_MAX_AGE_MIN,
    strict: false,
    json: false,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--strict") out.strict = true;
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--cwd=")) out.cwd = path.resolve(a.slice("--cwd=".length));
    else if (a === "--cwd") {
      i += 1;
      out.cwd = path.resolve(argv[i] ?? process.cwd());
    } else if (a.startsWith("--max-age-min=")) {
      const n = Number(a.slice("--max-age-min=".length));
      if (Number.isFinite(n) && n >= 0) out.maxAgeMin = n;
    } else if (a === "--max-age-min") {
      i += 1;
      const n = Number(argv[i]);
      if (Number.isFinite(n) && n >= 0) out.maxAgeMin = n;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  return out;
}

function printHelp() {
  console.log([
    "guardrails loop evidence check",
    "",
    "Usage:",
    "  npm run ops:loop-evidence:check",
    "  npm run ops:loop-evidence:strict",
    "  node scripts/guardrails-loop-evidence-check.mjs --json",
    "",
    "Options:",
    "  --cwd <path>          Workspace root (default: process.cwd)",
    "  --max-age-min <n>     Freshness window in minutes (default: 30)",
    "  --strict              Exit 1 if missing/stale/not-ready",
    "  --json                JSON output",
    "  -h, --help",
  ].join("\n"));
}

function printTextReport(report) {
  console.log("guardrails loop evidence");
  console.log(`status: ${report.status}`);
  console.log(`file: ${report.filePath}`);
  console.log(`updatedAt: ${report.updatedAtIso ?? "n/a"}`);
  console.log(`ageSec: ${report.ageSec ?? "n/a"}`);
  console.log(`stale: ${report.stale ? "yes" : "no"}`);
  console.log(`readyForTaskBud125: ${report.readyForTaskBud125 ? "yes" : "no"}`);
  console.log(`criteria: ${report.criteria.join(" | ")}`);

  if (report.boardAuto) {
    console.log(`boardAuto: task=${report.boardAuto.taskId}${report.boardAuto.milestone ? ` milestone=${report.boardAuto.milestone}` : ""} runtime=${report.boardAuto.runtimeCodeState} emLoop=${report.boardAuto.emLoop ? "yes" : "no"} at=${report.boardAuto.atIso}`);
  } else {
    console.log("boardAuto: n/a");
  }

  if (report.loopReady) {
    console.log(`loopReady: runtime=${report.loopReady.runtimeCodeState} gate=${report.loopReady.boardAutoAdvanceGate} next=${report.loopReady.nextTaskId ?? "n/a"}${report.loopReady.milestone ? ` milestone=${report.loopReady.milestone}` : ""} at=${report.loopReady.atIso}`);
  } else {
    console.log("loopReady: n/a");
  }
}

function shouldFailStrict(report) {
  return report.status !== "ok" || report.stale || !report.readyForTaskBud125;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exit(1);
  }

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const report = assessLoopEvidence({ cwd: opts.cwd, maxAgeMin: opts.maxAgeMin });

  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else printTextReport(report);

  if (opts.strict && shouldFailStrict(report)) process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
