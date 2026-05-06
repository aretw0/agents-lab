#!/usr/bin/env node

/**
 * Board debt hygiene audit (hard vs soft vs parked).
 *
 * - hard: required schema/reference violations that block trust.
 * - soft: legacy/textual artifacts that are historically accepted but should be normalized.
 * - parked: non-blocking notes for triage/evidence planning.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function findWorkspaceRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (existsSync(path.join(current, ".project", "tasks.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir);
    current = parent;
  }
}

const ROOT = findWorkspaceRoot(process.cwd());
const TASKS_PATH = path.join(ROOT, ".project", "tasks.json");
const ISSUES_PATH = path.join(ROOT, ".project", "issues.json");
const VERIFICATIONS_PATH = path.join(ROOT, ".project", "verification.json");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    strict: false,
    json: false,
    help: false,
  };

  for (const arg of args) {
    if (arg === "--strict") out.strict = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return out;
}

function printHelp() {
  console.log([
    "board-debt-hygiene",
    "",
    "Usage:",
    "  node scripts/project/board-debt-hygiene.mjs",
    "  node scripts/project/board-debt-hygiene.mjs --strict",
    "  node scripts/project/board-debt-hygiene.mjs --json",
    "",
    "Options:",
    "  --strict   exit 1 when hard debt exists",
    "  --json     emit JSON summary",
    "  -h, --help",
  ].join("\n"));
}

function isLikelyVerificationId(value) {
  return /^VER-[A-Za-z0-9][A-Za-z0-9-_:.]*$/.test(value);
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(1);
  }

  if (opts.help) {
    printHelp();
    return;
  }

  const tasksData = readJson(TASKS_PATH);
  const issuesData = readJson(ISSUES_PATH);
  const verificationsData = readJson(VERIFICATIONS_PATH);

  const tasks = Array.isArray(tasksData.tasks) ? tasksData.tasks : [];
  const issues = Array.isArray(issuesData.issues) ? issuesData.issues : [];
  const verifications = Array.isArray(verificationsData.verifications)
    ? verificationsData.verifications
    : [];

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const verificationIds = new Set(verifications.map((verification) => verification.id));

  const hard = [];
  const soft = [];
  const parked = [];

  for (const task of tasks) {
    if (!task || typeof task.id !== "string") continue;

    if (task.status !== "completed") continue;

    const verification =
      typeof task.verification === "string" ? task.verification.trim() : "";

    if (!verification) {
      hard.push({
        kind: "task",
        id: task.id,
        issue: "completed task missing verification",
        evidence: "status=completed and verification undefined/blank",
      });
      continue;
    }

    if (!isLikelyVerificationId(verification)) {
      soft.push({
        kind: "task",
        id: task.id,
        issue: "non-conforming verification reference",
        evidence: `verification="${verification}"`,
      });
      continue;
    }

    if (!verificationIds.has(verification)) {
      hard.push({
        kind: "task",
        id: task.id,
        issue: "verification id missing in verification.json",
        evidence: verification,
      });
    }
  }

  for (const issue of issues) {
    if (!issue || typeof issue.id !== "string") continue;
    const status = issue.status ?? "open";
    const resolvedBy =
      typeof issue.resolved_by === "string" ? issue.resolved_by.trim() : "";
    if (status === "resolved" || status === "closed") {
      if (!resolvedBy) {
        soft.push({
          kind: "issue",
          id: issue.id,
          issue: "resolved issue missing resolved_by",
          evidence: "status resolved/closed but resolved_by blank",
        });
        continue;
      }
      if (!taskById.has(resolvedBy)) {
        soft.push({
          kind: "issue",
          id: issue.id,
          issue: "resolved_by points to non-existent task",
          evidence: resolvedBy,
        });
      }
    }
  }

  const parkedCandidates = [
    ...issues.filter((issue) => issue?.status === "blocked" && !issue.resolved_by),
  ].map((issue) => ({ kind: "issue", id: issue.id, note: "blocked issue without resolved_by" }));

  parked.push(...parkedCandidates);

  const summary = {
    paths: {
      tasks: path.relative(ROOT, TASKS_PATH).replace(/\\/g, "/"),
      issues: path.relative(ROOT, ISSUES_PATH).replace(/\\/g, "/"),
      verification: path.relative(ROOT, VERIFICATIONS_PATH).replace(/\\/g, "/"),
    },
    totals: {
      hard: hard.length,
      soft: soft.length,
      parked: parked.length,
    },
    hard,
    soft,
    parked,
    recommendation:
      hard.length > 0
        ? "resolve hard debt before protected scopes or long-run planning"
        : soft.length > 0
          ? "schedule soft cleanup in next local-safe slice"
          : "board debt hygiene green",
  };

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log("Board-debt hygiene summary:");
    console.log(`  hard: ${summary.totals.hard}`);
    console.log(`  soft: ${summary.totals.soft}`);
    console.log(`  parked: ${summary.totals.parked}`);
    console.log(`  recommendation: ${summary.recommendation}`);

    if (hard.length) {
      console.log("\n[hard]");
      for (const item of hard) {
        console.log(`- ${item.kind}:${item.id} ${item.issue} (${item.evidence})`);
      }
    }

    if (soft.length) {
      console.log("\n[soft]");
      for (const item of soft) {
        console.log(`- ${item.kind}:${item.id} ${item.issue} (${item.evidence})`);
      }
    }

    if (parked.length) {
      console.log("\n[parked]");
      for (const item of parked) {
        console.log(`- ${item.kind}:${item.id} ${item.note}`);
      }
    }
  }

  if (opts.strict && hard.length > 0) {
    process.exit(1);
  }
}

main();
