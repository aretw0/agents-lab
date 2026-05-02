#!/usr/bin/env node

import { mkdirSync, readFileSync, existsSync, appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_THRESHOLD_COUNT = 7000;
const DEFAULT_THRESHOLD_SIZE_MIB = 100;
const DEFAULT_DELTA_COUNT = 1500;
const REFLOG_LIMIT = 40;

function runGit(args, cwd) {
  const out = spawnSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
  if (out.status !== 0) {
    const err = (out.stderr || out.stdout || `git ${args.join(" ")} failed`).trim();
    throw new Error(err);
  }
  return String(out.stdout ?? "");
}

function parseCountObjects(stdout) {
  const rows = String(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const map = {};
  for (const row of rows) {
    const idx = row.indexOf(":");
    if (idx <= 0) continue;
    const key = row.slice(0, idx).trim();
    const value = row.slice(idx + 1).trim();
    map[key] = value;
  }

  const count = Number.parseInt(map.count ?? "0", 10) || 0;
  const sizeKiB = Number.parseFloat(map.size ?? "0") || 0;
  const sizeMiB = Number((sizeKiB / 1024).toFixed(2));
  const inPack = Number.parseInt(map["in-pack"] ?? "0", 10) || 0;
  const packs = Number.parseInt(map.packs ?? "0", 10) || 0;

  return {
    raw: map,
    count,
    sizeKiB,
    sizeMiB,
    inPack,
    packs,
  };
}

function parseReflog(stdout) {
  return String(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [selector = "", subject = "", dateIso = ""] = line.split("\t");
      const sig = `${selector}\t${subject}\t${dateIso}`;
      return { selector, subject, dateIso, sig };
    });
}

function operationKind(subject) {
  const text = String(subject ?? "").toLowerCase();
  if (text.includes("rebase")) return "rebase";
  if (text.includes("reset")) return "reset";
  if (text.includes("amend")) return "commit-amend";
  if (text.includes("commit")) return "commit";
  if (text.includes("checkout") || text.includes("switch")) return "checkout/switch";
  if (text.includes("cherry-pick")) return "cherry-pick";
  if (text.includes("merge")) return "merge";
  if (text.includes("revert")) return "revert";
  if (text.includes("pull")) return "pull";
  if (text.includes("clone")) return "clone";
  return "other";
}

function summarizeOps(entries) {
  const byKind = new Map();
  for (const entry of entries) {
    const kind = operationKind(entry.subject);
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }
  return Array.from(byKind.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => ({ kind, count }));
}

function readJson(filePath, fallback) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function ensureDir(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function parseArgs(argv) {
  const out = {
    cwd: process.cwd(),
    json: false,
    thresholdCount: DEFAULT_THRESHOLD_COUNT,
    thresholdSizeMiB: DEFAULT_THRESHOLD_SIZE_MIB,
    deltaCount: DEFAULT_DELTA_COUNT,
    statePath: ".project/runtime/git-loose-watch.state.json",
    eventsPath: ".project/runtime/git-loose-watch-events.jsonl",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd") out.cwd = argv[++i] ?? out.cwd;
    else if (arg === "--json") out.json = true;
    else if (arg === "--threshold-count") out.thresholdCount = Number(argv[++i] ?? out.thresholdCount) || out.thresholdCount;
    else if (arg === "--threshold-size-mib") out.thresholdSizeMiB = Number(argv[++i] ?? out.thresholdSizeMiB) || out.thresholdSizeMiB;
    else if (arg === "--delta-count") out.deltaCount = Number(argv[++i] ?? out.deltaCount) || out.deltaCount;
    else if (arg === "--state") out.statePath = argv[++i] ?? out.statePath;
    else if (arg === "--events") out.eventsPath = argv[++i] ?? out.eventsPath;
  }

  return out;
}

export function runLooseObjectsWatch(config = {}) {
  const cwd = path.resolve(config.cwd ?? process.cwd());
  const thresholdCount = Number(config.thresholdCount ?? DEFAULT_THRESHOLD_COUNT);
  const thresholdSizeMiB = Number(config.thresholdSizeMiB ?? DEFAULT_THRESHOLD_SIZE_MIB);
  const deltaCount = Number(config.deltaCount ?? DEFAULT_DELTA_COUNT);
  const statePath = path.resolve(cwd, config.statePath ?? ".project/runtime/git-loose-watch.state.json");
  const eventsPath = path.resolve(cwd, config.eventsPath ?? ".project/runtime/git-loose-watch-events.jsonl");

  const countStdout = runGit(["count-objects", "-v"], cwd);
  const count = parseCountObjects(countStdout);
  const reflog = parseReflog(
    runGit(["reflog", "--date=iso", `--pretty=%gd%x09%gs%x09%cd`, "-n", String(REFLOG_LIMIT)], cwd),
  );

  const previous = readJson(statePath, {
    lastTopSig: null,
    wasWarning: false,
    lastCount: 0,
    updatedAtIso: null,
  });

  const nowIso = new Date().toISOString();
  const isWarning = count.count >= thresholdCount || count.sizeMiB >= thresholdSizeMiB;

  const topSig = reflog[0]?.sig ?? null;
  let newOps = reflog;
  if (previous.lastTopSig) {
    const idx = reflog.findIndex((entry) => entry.sig === previous.lastTopSig);
    newOps = idx >= 0 ? reflog.slice(0, idx) : reflog;
  }

  const opsSummary = summarizeOps(newOps);
  const countDelta = count.count - Number(previous.lastCount ?? 0);

  const warningReturned = isWarning && !previous.wasWarning;
  const warningEscalated = isWarning && previous.wasWarning && countDelta >= deltaCount;
  const triggered = warningReturned || warningEscalated;

  const event = triggered
    ? {
        atIso: nowIso,
        kind: warningReturned ? "warning-returned" : "warning-escalated",
        count: count.count,
        sizeMiB: count.sizeMiB,
        countDelta,
        thresholdCount,
        thresholdSizeMiB,
        topOperations: opsSummary.slice(0, 6),
        reflogHead: newOps.slice(0, 12).map((entry) => ({
          selector: entry.selector,
          subject: entry.subject,
          dateIso: entry.dateIso,
          operation: operationKind(entry.subject),
        })),
      }
    : null;

  const nextState = {
    lastTopSig: topSig,
    wasWarning: isWarning,
    lastCount: count.count,
    lastSizeMiB: count.sizeMiB,
    updatedAtIso: nowIso,
  };

  ensureDir(statePath);
  writeFileSync(statePath, `${JSON.stringify(nextState, null, 2)}\n`);

  if (event) {
    ensureDir(eventsPath);
    appendFileSync(eventsPath, `${JSON.stringify(event)}\n`);
  }

  const summary = [
    "git-loose-watch:",
    `warning=${isWarning ? "yes" : "no"}`,
    `count=${count.count}`,
    `sizeMiB=${count.sizeMiB}`,
    `delta=${countDelta}`,
    `event=${event?.kind ?? "none"}`,
    `newOps=${newOps.length}`,
  ].join(" ");

  return {
    summary,
    cwd,
    thresholds: { thresholdCount, thresholdSizeMiB, deltaCount },
    metrics: count,
    warning: isWarning,
    warningReturned,
    warningEscalated,
    event,
    operations: {
      newOpsCount: newOps.length,
      topOperations: opsSummary,
    },
    statePath,
    eventsPath,
  };
}

function formatHuman(report) {
  const lines = [report.summary];
  if (report.event) {
    lines.push(`event: ${report.event.kind} at ${report.event.atIso}`);
    const topOps = report.event.topOperations
      .map((row) => `${row.kind}:${row.count}`)
      .join(", ");
    lines.push(`top ops: ${topOps || "none"}`);
    for (const row of report.event.reflogHead.slice(0, 8)) {
      lines.push(`- ${row.dateIso} ${row.operation} :: ${row.subject}`);
    }
  }
  lines.push(`state: ${path.relative(report.cwd, report.statePath).replace(/\\/g, "/")}`);
  lines.push(`events: ${path.relative(report.cwd, report.eventsPath).replace(/\\/g, "/")}`);
  return lines.join("\n");
}

function isMain() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return path.resolve(argv1) === path.resolve(fileURLToPath(import.meta.url));
}

if (isMain()) {
  const args = parseArgs(process.argv.slice(2));
  const report = runLooseObjectsWatch(args);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatHuman(report));
  }
}
