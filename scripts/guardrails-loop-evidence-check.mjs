#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_MAX_AGE_MIN = 30;

function normalizeMilestone(value) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const unwrapped = text.length >= 2
    && ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'")))
    ? text.slice(1, -1)
    : text;
  const normalized = unwrapped.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function resolveDefaultMilestoneFromSettings(cwd) {
  const settingsPath = path.join(cwd, ".pi", "settings.json");
  if (!existsSync(settingsPath)) return undefined;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    return normalizeMilestone(settings?.piStack?.guardrailsCore?.longRunIntentQueue?.defaultBoardMilestone);
  } catch {
    return undefined;
  }
}

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

export function evaluateMilestoneScopeMatch(report, expectedMilestone) {
  const expected = normalizeMilestone(expectedMilestone);
  if (!expected) return { expectedMilestone: undefined, matches: true, reason: "no-expectation" };
  const boardAutoMilestone = normalizeMilestone(report?.boardAuto?.milestone);
  const loopReadyMilestone = normalizeMilestone(report?.loopReady?.milestone);
  const matches = boardAutoMilestone === expected && loopReadyMilestone === expected;
  return {
    expectedMilestone: expected,
    boardAutoMilestone,
    loopReadyMilestone,
    matches,
    reason: matches ? "match" : "mismatch",
  };
}

function parseArgs(argv) {
  const out = {
    cwd: process.cwd(),
    maxAgeMin: DEFAULT_MAX_AGE_MIN,
    strict: false,
    json: false,
    help: false,
    expectMilestone: undefined,
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
    } else if (a.startsWith("--expect-milestone=")) {
      const expected = normalizeMilestone(a.slice("--expect-milestone=".length));
      if (!expected) throw new Error("Invalid --expect-milestone: expected non-empty label");
      out.expectMilestone = expected;
    } else if (a === "--expect-milestone") {
      i += 1;
      const expected = normalizeMilestone(argv[i]);
      if (!expected) throw new Error("Invalid --expect-milestone: expected non-empty label");
      out.expectMilestone = expected;
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
    "  --expect-milestone <label|@default>  Also require boardAuto+loopReady milestone match",
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

export function computeLoopEvidenceStrictFailures(report, milestoneCheck) {
  const failures = [];
  if (report.status === "missing") failures.push("evidence-missing");
  else if (report.status === "invalid-json") failures.push("evidence-invalid-json");
  else if (report.status !== "ok") failures.push(`evidence-${report.status}`);
  if (report.stale) failures.push("evidence-stale");
  if (!report.readyForTaskBud125) failures.push("readiness-not-ready");
  if (milestoneCheck && milestoneCheck.matches === false) failures.push("milestone-mismatch");
  return [...new Set(failures)];
}

export function describeLoopEvidenceStrictFailure(code) {
  switch (code) {
    case "evidence-missing":
      return "run /lane-queue status or resume loop until .pi/guardrails-loop-evidence.json is written";
    case "evidence-invalid-json":
      return "inspect/restore .pi/guardrails-loop-evidence.json before trusting loop evidence";
    case "evidence-stale":
      return "refresh loop evidence with /lane-queue status or rerun after a fresh loop heartbeat";
    case "readiness-not-ready":
      return "check boardAuto/loopReady criteria and /lane-queue evidence for runtime/IN_LOOP gaps";
    case "milestone-mismatch":
      return "rerun with matching --expect-milestone or align defaultBoardMilestone/loop scope";
    default:
      return "inspect loop evidence status and criteria";
  }
}

function shouldFailStrict(report, milestoneCheck) {
  return computeLoopEvidenceStrictFailures(report, milestoneCheck).length > 0;
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
  const expectedMilestone = opts.expectMilestone === "@default"
    ? resolveDefaultMilestoneFromSettings(opts.cwd)
    : opts.expectMilestone;
  if (opts.expectMilestone === "@default" && !expectedMilestone) {
    console.error("Invalid --expect-milestone=@default: no defaultBoardMilestone found in .pi/settings.json");
    process.exit(1);
  }
  const milestoneCheck = evaluateMilestoneScopeMatch(report, expectedMilestone);
  const strictFailures = computeLoopEvidenceStrictFailures(report, milestoneCheck);
  const strictFailureHints = strictFailures.map((code) => ({ code, hint: describeLoopEvidenceStrictFailure(code) }));
  const milestoneGate = milestoneCheck.expectedMilestone ? "active" : "inactive";
  const output = { ...report, milestoneGate, milestoneCheck, strictFailures, strictFailureHints };

  if (opts.json) console.log(JSON.stringify(output, null, 2));
  else {
    printTextReport(report);
    console.log(`milestoneGate: ${milestoneGate}`);
    if (milestoneCheck.expectedMilestone) {
      console.log(`milestoneCheck: expected=${milestoneCheck.expectedMilestone} boardAuto=${milestoneCheck.boardAutoMilestone ?? "n/a"} loopReady=${milestoneCheck.loopReadyMilestone ?? "n/a"} matches=${milestoneCheck.matches ? "yes" : "no"} reason=${milestoneCheck.reason}`);
    } else {
      console.log(`milestoneCheck: expected=n/a matches=yes reason=${milestoneCheck.reason}`);
    }
    console.log(`strictFailures: ${strictFailures.length > 0 ? strictFailures.join(",") : "none"}`);
    for (const row of strictFailureHints) console.log(`strictHint(${row.code}): ${row.hint}`);
  }

  if (opts.strict && shouldFailStrict(report, milestoneCheck)) process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
