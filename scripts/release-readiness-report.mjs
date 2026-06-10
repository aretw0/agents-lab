#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const PACKAGES = [
  "packages/pi-stack/package.json",
  "packages/git-skills/package.json",
  "packages/web-skills/package.json",
  "packages/pi-skills/package.json",
  "packages/lab-skills/package.json",
];

const AGENT_RUN_DRIVER_GATE_TESTS = [
  "scripts/test/agent-run-driver-step.test.mjs",
  "scripts/test/agent-run-pi-driver.test.mjs",
  "scripts/test/agent-run-pi-driver-payload.test.mjs",
];

function runGit(args, cwd = process.cwd()) {
  const out = spawnSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
  if (out.status !== 0) return "";
  return String(out.stdout ?? "").trim();
}

function readJson(cwd, relPath) {
  return JSON.parse(readFileSync(path.join(cwd, relPath), "utf8"));
}

function hasRootScript(cwd, scriptName) {
  const packagePath = path.join(cwd, "package.json");
  if (!existsSync(packagePath)) return false;
  const json = JSON.parse(readFileSync(packagePath, "utf8"));
  return typeof json?.scripts?.[scriptName] === "string" && json.scripts[scriptName].trim().length > 0;
}

function rootScript(cwd, scriptName) {
  const packagePath = path.join(cwd, "package.json");
  if (!existsSync(packagePath)) return "";
  const json = JSON.parse(readFileSync(packagePath, "utf8"));
  return typeof json?.scripts?.[scriptName] === "string" ? json.scripts[scriptName].trim() : "";
}

function hasAgentRunDriverGate(cwd) {
  const script = rootScript(cwd, "test:agent-run:drivers");
  return hasRootScript(cwd, "test:agent-run:drivers")
    && script.includes("node --test")
    && AGENT_RUN_DRIVER_GATE_TESTS.every((testPath) => script.includes(testPath));
}

function normalizeStatus(value) {
  return String(value ?? "unknown").trim().toLowerCase().replace(/_/g, "-") || "unknown";
}

function normalizePriority(value) {
  return String(value ?? "unknown").trim().toLowerCase() || "unknown";
}

function taskOneLine(task) {
  const id = String(task?.id ?? "?");
  const status = normalizeStatus(task?.status);
  const priority = normalizePriority(task?.priority);
  const description = String(task?.description ?? "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\\n/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${id} [${priority}/${status}] ${description}`.slice(0, 180);
}

function taskDependencies(task) {
  return Array.isArray(task?.depends_on)
    ? task.depends_on.map((dep) => String(dep ?? "").trim()).filter(Boolean)
    : [];
}

export function summarizeBoard(cwd = process.cwd()) {
  const tasksPath = path.join(cwd, ".project", "tasks.json");
  if (!existsSync(tasksPath)) {
    return {
      exists: false,
      total: 0,
      byStatus: {},
      byPriority: {},
      openP0: [],
      p0Ready: [],
      p0BlockedByDependency: [],
      inProgress: [],
      blocked: [],
      releaseReady: false,
      blockers: ["board-missing"],
    };
  }

  const tasksBlock = readJson(cwd, ".project/tasks.json");
  const tasks = Array.isArray(tasksBlock.tasks) ? tasksBlock.tasks : [];
  const byStatus = {};
  const byPriority = {};
  const openP0 = [];
  const p0Ready = [];
  const p0BlockedByDependency = [];
  const inProgress = [];
  const blocked = [];
  const statusById = new Map();

  for (const task of tasks) {
    statusById.set(String(task?.id ?? ""), normalizeStatus(task?.status));
  }

  for (const task of tasks) {
    const status = normalizeStatus(task?.status);
    const priority = normalizePriority(task?.priority);
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    byPriority[priority] = (byPriority[priority] ?? 0) + 1;
    const open = status !== "completed" && status !== "cancelled";
    if (priority === "p0" && open) {
      const unmetDeps = taskDependencies(task).filter((dep) => statusById.get(dep) !== "completed");
      openP0.push(task);
      if (unmetDeps.length > 0) {
        p0BlockedByDependency.push(`${taskOneLine(task)} blockedBy=${unmetDeps.slice(0, 5).join(",")}`);
      } else {
        p0Ready.push(task);
      }
    }
    if (status === "in-progress") inProgress.push(task);
    if (status === "blocked") blocked.push(task);
  }

  const blockers = [];
  if (openP0.length > 0) blockers.push(`open-p0=${openP0.length}`);
  if (inProgress.length > 0) blockers.push(`in-progress=${inProgress.length}`);
  if (blocked.length > 0) blockers.push(`blocked=${blocked.length}`);

  return {
    exists: true,
    total: tasks.length,
    byStatus,
    byPriority,
    openP0: openP0.map(taskOneLine).slice(0, 12),
    p0Ready: p0Ready.map(taskOneLine).slice(0, 12),
    p0BlockedByDependency: p0BlockedByDependency.slice(0, 12),
    inProgress: inProgress.map(taskOneLine).slice(0, 12),
    blocked: blocked.map(taskOneLine).slice(0, 12),
    releaseReady: blockers.length === 0,
    blockers,
  };
}

function parseArgs(argv) {
  const out = {
    target: "0.8.0",
    out: "",
    strict: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--target" && v) { out.target = v; i++; continue; }
    if (k === "--out" && v) { out.out = v; i++; continue; }
    if (k === "--strict") { out.strict = true; continue; }
  }
  return out;
}

export function gather(target, cwd = process.cwd()) {
  const versions = PACKAGES.map((pkg) => {
    const json = readJson(cwd, pkg);
    return { pkg, version: String(json.version ?? "unknown") };
  });
  const uniqueVersions = [...new Set(versions.map((v) => v.version))];
  const versionsAligned = uniqueVersions.length === 1;
  const targetVersionReady = versionsAligned && uniqueVersions[0] === target;

  const latestTag = runGit(["describe", "--tags", "--abbrev=0"], cwd);
  const head = runGit(["rev-parse", "--short", "HEAD"], cwd);

  const workflows = {
    ci: existsSync(path.join(cwd, ".github", "workflows", "ci.yml")),
    publish: existsSync(path.join(cwd, ".github", "workflows", "publish.yml")),
    releaseDraft: existsSync(path.join(cwd, ".github", "workflows", "release-draft.yml")),
  };

  return {
    target,
    head,
    latestTag,
    versions,
    versionsAligned,
    targetVersionReady,
    workflows,
    gates: {
      agentRunDrivers: hasAgentRunDriverGate(cwd),
    },
    board: summarizeBoard(cwd),
  };
}

export function buildReport(data) {
  const now = new Date().toISOString();
  const checklist = [
    { id: "versions-aligned", ok: data.versionsAligned, evidence: data.versions.map((v) => `${v.pkg}:${v.version}`).join(", ") },
    { id: "target-version-ready", ok: data.targetVersionReady, evidence: `target=v${data.target}` },
    { id: "workflow-ci", ok: data.workflows.ci, evidence: ".github/workflows/ci.yml" },
    { id: "workflow-publish", ok: data.workflows.publish, evidence: ".github/workflows/publish.yml" },
    { id: "workflow-release-draft", ok: data.workflows.releaseDraft, evidence: ".github/workflows/release-draft.yml" },
    { id: "agent-run-driver-gate", ok: data.gates.agentRunDrivers, evidence: `package.json scripts.test:agent-run:drivers includes ${AGENT_RUN_DRIVER_GATE_TESTS.join(", ")}` },
    { id: "board-release-clear", ok: data.board.releaseReady, evidence: data.board.blockers.length ? data.board.blockers.join(", ") : "no open P0/in-progress/blocked tasks" },
  ];
  const ready = checklist.every((item) => item.ok);
  const failedChecklist = checklist.filter((item) => !item.ok);

  const lines = [
    `# Release readiness report v${data.target}`,
    "",
    `- generatedAt: ${now}`,
    `- head: ${data.head || "unknown"}`,
    `- latestTag: ${data.latestTag || "none"}`,
    `- decision: ${ready ? "ready" : "not-ready"}`,
    "",
    "## Checklist",
    ...checklist.map((c) => `- [${c.ok ? "x" : " "}] ${c.id} — ${c.evidence}`),
    "",
    "## Release Blockers",
    ...(failedChecklist.length ? failedChecklist.map((c) => `- ${c.id}: ${c.evidence}`) : ["- none"]),
    "",
    "## Board Summary",
    `- tasks: ${data.board.total}`,
    `- byStatus: ${Object.entries(data.board.byStatus).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
    `- byPriority: ${Object.entries(data.board.byPriority).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
    `- releaseBlockers: ${data.board.blockers.length ? data.board.blockers.join(", ") : "none"}`,
    "",
    "### Open P0",
    ...(data.board.openP0.length ? data.board.openP0.map((line) => `- ${line}`) : ["- none"]),
    "",
    "### P0 Ready To Start",
    ...(data.board.p0Ready.length ? data.board.p0Ready.map((line) => `- ${line}`) : ["- none"]),
    "",
    "### P0 Blocked By Dependency",
    ...(data.board.p0BlockedByDependency.length ? data.board.p0BlockedByDependency.map((line) => `- ${line}`) : ["- none"]),
    "",
    "### In Progress",
    ...(data.board.inProgress.length ? data.board.inProgress.map((line) => `- ${line}`) : ["- none"]),
    "",
    "### Blocked",
    ...(data.board.blocked.length ? data.board.blocked.map((line) => `- ${line}`) : ["- none"]),
    "",
    "## Governance notes",
    "- publish permanece gateado por tag semver + smoke/test/verify/audit",
    "- draft release é manual (workflow_dispatch) para revisão do operador",
    "- promotion de release exige evidência canônica no board/handoff",
    "",
  ];

  return { markdown: lines.join("\n"), checklist, ready };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const data = gather(args.target);
  const report = buildReport(data);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const defaultOut = path.join(process.cwd(), ".artifacts", "release-readiness", `v${args.target}-${stamp}.md`);
  const outPath = args.out ? path.resolve(process.cwd(), args.out) : defaultOut;

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${report.markdown}\n`);

  process.stdout.write(`release-readiness-report: wrote ${path.relative(process.cwd(), outPath).replace(/\\/g, "/")}\n`);
  if (args.strict && !report.ready) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
