#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { buildReleasePackageSmokeReport } from "./release-package-smoke.mjs";

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
  "scripts/test/agent-run-driver-canary.test.mjs",
  "scripts/test/agent-run-driver-canary-suite.test.mjs",
];

const BOARD_RELEASE_EVIDENCE = {
  "TASK-BUD-480": {
    kind: "external-influence-agent-patterns",
    evidencePath: "docs/research/task-bud-480-local-agent-patterns-canary-2026-06.md",
    decision: "operator-may-park-for-target-release",
  },
  "TASK-BUD-521": {
    kind: "external-influence-isolation",
    evidencePath: "docs/research/task-bud-521-local-isolation-canary-2026-06.md",
    decision: "operator-may-park-for-target-release",
  },
  "TASK-BUD-676": {
    kind: "external-influence-memory",
    evidencePath: "docs/research/task-bud-676-local-memory-canary-2026-06.md",
    decision: "operator-may-park-for-target-release",
  },
};

const REPORT_ONLY_PERMISSIONS = {
  tagAllowed: false,
  publishAllowed: false,
  workflowDispatchAllowed: false,
  processStartAllowed: false,
};

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

function agentRunDriverGateReport(cwd) {
  const script = rootScript(cwd, "test:agent-run:drivers");
  const missingTests = AGENT_RUN_DRIVER_GATE_TESTS.filter((testPath) => !script.includes(testPath));
  const nodeTest = script.includes("node --test");
  const scriptPresent = hasRootScript(cwd, "test:agent-run:drivers");
  return {
    ok: scriptPresent && nodeTest && missingTests.length === 0,
    scriptName: "test:agent-run:drivers",
    script,
    nodeTest,
    requiredTests: AGENT_RUN_DRIVER_GATE_TESTS,
    missingTests,
  };
}

function agentRunDriverCanaryEvidence(cwd, relPath = ".artifacts/agent-run-driver/latest.json") {
  const fullPath = path.join(cwd, relPath);
  if (!existsSync(fullPath)) {
    return {
      path: relPath,
      present: false,
      decision: "missing",
      summary: "no local agent-run driver canary artifact found",
    };
  }
  try {
    const payload = JSON.parse(readFileSync(fullPath, "utf8"));
    const driverStep = payload.driverStep ?? payload;
    const outcome = payload.agentRunOutcomePacket ?? driverStep.agentRunOutcomePacket;
    const contractDecision = payload.contractDecision ?? outcome?.contractDecision;
    const runId = payload.runId ?? driverStep.runSpec?.runId;
    const followTerminal = payload.followTerminal === true || driverStep.follow?.terminal === true;
    const decision = contractDecision === "pass" && followTerminal ? "pass" : "review";
    return {
      path: relPath,
      present: true,
      decision,
      mode: payload.mode,
      schemaVersion: payload.schemaVersion,
      runId,
      followTerminal,
      contractDecision,
      outputBytes: payload.outputBytes ?? driverStep.follow?.outputBytes,
      summary: payload.summary ?? driverStep.summary ?? "agent-run driver canary artifact present",
    };
  } catch (error) {
    return {
      path: relPath,
      present: true,
      decision: "invalid-json",
      summary: `could not parse local agent-run driver canary artifact: ${String(error?.message ?? error)}`,
    };
  }
}

function agentRunDriverCanarySuiteEvidence(cwd) {
  const relPath = ".artifacts/agent-run-driver/suite.json";
  const fullPath = path.join(cwd, relPath);
  if (!existsSync(fullPath)) {
    return {
      path: relPath,
      present: false,
      decision: "missing",
      summary: "no local agent-run driver canary suite artifact found",
    };
  }
  try {
    const payload = JSON.parse(readFileSync(fullPath, "utf8"));
    return {
      path: relPath,
      present: true,
      decision: payload.decision === "pass" ? "pass" : "review",
      mode: payload.mode,
      schemaVersion: payload.schemaVersion,
      readOnlyDecision: payload.canaries?.readOnly?.contractDecision,
      mutationDecision: payload.canaries?.mutation?.contractDecision,
      blockers: Array.isArray(payload.blockers) ? payload.blockers : [],
      summary: payload.summary ?? "agent-run driver canary suite artifact present",
    };
  } catch (error) {
    return {
      path: relPath,
      present: true,
      decision: "invalid-json",
      summary: `could not parse local agent-run driver canary suite artifact: ${String(error?.message ?? error)}`,
    };
  }
}

function releaseGateKind(id) {
  if (id === "target-version-ready") return "operator-decision";
  if (id === "board-release-clear") return "board-state";
  return "technical-gate";
}

function releaseBlockerRow(item) {
  return {
    id: item.id,
    kind: item.kind,
    evidence: item.evidence,
  };
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

function taskRow(task) {
  return {
    taskId: String(task?.id ?? ""),
    status: normalizeStatus(task?.status),
    priority: normalizePriority(task?.priority),
    description: String(task?.description ?? "")
      .replace(/\u001b\[[0-9;]*m/g, "")
      .replace(/\\n/g, " ")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  };
}

function taskRowOneLine(row) {
  const id = String(row?.taskId ?? "?");
  const status = normalizeStatus(row?.status);
  const priority = normalizePriority(row?.priority);
  const description = String(row?.description ?? "")
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

function boardEvidenceCandidate(cwd, task) {
  const id = String(task?.id ?? "");
  const evidence = BOARD_RELEASE_EVIDENCE[id];
  if (!evidence) return undefined;
  const present = existsSync(path.join(cwd, evidence.evidencePath));
  return {
    taskId: id,
    status: normalizeStatus(task?.status),
    priority: normalizePriority(task?.priority),
    kind: evidence.kind,
    evidencePath: evidence.evidencePath,
    evidencePresent: present,
    decision: present ? evidence.decision : "evidence-missing",
  };
}

function boardEvidenceOneLine(row) {
  return [
    `${row.taskId} [${row.priority}/${row.status}]`,
    row.kind,
    row.evidencePresent ? row.evidencePath : `missing:${row.evidencePath}`,
    row.decision,
  ].join(" — ");
}

function operatorDecisionLines(decisions) {
  return decisions.map((decision) => `- ${decision.id}: ${decision.summary}`);
}

function operatorDecisionPackets(data, failedChecklist) {
  const decisions = [];
  if (failedChecklist.some((item) => item.id === "target-version-ready")) {
    decisions.push({
      id: "decide-target-version",
      kind: "operator-decision",
      recommendation: "bump-tag-release-when-ready",
      target: data.target,
      currentVersions: data.versions,
      allowedActions: ["defer-release", "bump-tag-release-when-ready"],
      requiresOperatorDecision: true,
      automationAllowed: false,
      summary: `packages are not yet at v${data.target}; bump/tag/release remains operator-gated`,
    });
  }
  if (failedChecklist.some((item) => item.id === "board-release-clear") && data.board.releaseDecisionReady) {
    const candidateRows = data.board.evidenceCandidateRows;
    decisions.push({
      id: "decide-board-evidence-candidates",
      kind: "board-state",
      recommendation: "choose-park-for-target-release-or-require-work",
      target: data.target,
      candidateTaskIds: candidateRows.map((row) => row.taskId),
      evidenceCandidateRows: candidateRows,
      allowedActions: ["park-for-target-release", "require-work"],
      requiresOperatorDecision: true,
      automationAllowed: false,
      summary: "choose park-for-target-release or require-work for current Board Evidence Candidates",
    });
  }
  return decisions;
}

function releaseNextActionPacket({ ready, releaseBlockers, operatorDecisions }) {
  if (ready) {
    return {
      nextActionCode: "review-release-draft",
      nextActions: [{
        id: "review-release-draft",
        kind: "operator-decision",
        allowedActions: ["defer-release", "prepare-draft-release"],
        requiresOperatorDecision: true,
        automationAllowed: false,
        summary: "release readiness is green; draft and publish remain operator-gated",
      }],
    };
  }
  if (operatorDecisions.length > 0) {
    return {
      nextActionCode: "resolve-operator-decisions",
      nextActions: operatorDecisions.map((decision) => ({
        id: decision.id,
        kind: decision.kind,
        allowedActions: decision.allowedActions,
        requiresOperatorDecision: decision.requiresOperatorDecision,
        automationAllowed: decision.automationAllowed,
        target: decision.target,
        candidateTaskIds: decision.candidateTaskIds ?? [],
        summary: decision.summary,
      })),
    };
  }
  return {
    nextActionCode: "resolve-release-blockers",
    nextActions: releaseBlockers.map((blocker) => ({
      id: `resolve-${blocker.id}`,
      kind: blocker.kind,
      blockerId: blocker.id,
      evidence: blocker.evidence,
      requiresOperatorDecision: false,
      automationAllowed: false,
      summary: `clear ${blocker.id} before release promotion`,
    })),
  };
}

export function summarizeBoard(cwd = process.cwd()) {
  const tasksPath = path.join(cwd, ".project", "tasks.json");
  if (!existsSync(tasksPath)) {
    return {
      exists: false,
      total: 0,
      byStatus: {},
      byPriority: {},
      openP0Rows: [],
      p0ReadyRows: [],
      p0BlockedByDependencyRows: [],
      inProgressRows: [],
      blockedRows: [],
      evidenceCandidateRows: [],
      releaseDecisionReady: false,
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
  const evidenceCandidates = [];
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
        p0BlockedByDependency.push({ task, blockedBy: unmetDeps.slice(0, 5) });
      } else {
        p0Ready.push(task);
      }
    }
    if (status === "in-progress") inProgress.push(task);
    if (status === "blocked") blocked.push(task);
    const evidence = boardEvidenceCandidate(cwd, task);
    if (evidence && status !== "completed" && status !== "cancelled") evidenceCandidates.push(evidence);
  }

  const blockers = [];
  if (openP0.length > 0) blockers.push(`open-p0=${openP0.length}`);
  if (inProgress.length > 0) blockers.push(`in-progress=${inProgress.length}`);
  if (blocked.length > 0) blockers.push(`blocked=${blocked.length}`);
  const evidenceCandidateTaskIds = new Set(
    evidenceCandidates
      .filter((row) => row.evidencePresent)
      .map((row) => row.taskId),
  );
  const inProgressCoveredByEvidence = inProgress.length > 0
    && inProgress.every((task) => evidenceCandidateTaskIds.has(String(task?.id ?? "")));
  const releaseDecisionReady = blockers.length > 0
    && openP0.length === 0
    && blocked.length === 0
    && inProgressCoveredByEvidence;

  return {
    exists: true,
    total: tasks.length,
    byStatus,
    byPriority,
    openP0Rows: openP0.map(taskRow).slice(0, 12),
    p0ReadyRows: p0Ready.map(taskRow).slice(0, 12),
    p0BlockedByDependencyRows: p0BlockedByDependency.map(({ task, blockedBy }) => ({ ...taskRow(task), blockedBy })).slice(0, 12),
    inProgressRows: inProgress.map(taskRow).slice(0, 12),
    blockedRows: blocked.map(taskRow).slice(0, 12),
    evidenceCandidateRows: evidenceCandidates.slice(0, 12),
    releaseDecisionReady,
    releaseReady: blockers.length === 0,
    blockers,
  };
}

function parseArgs(argv) {
  const out = {
    target: "0.8.0",
    out: "",
    strict: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--target" && v) { out.target = v; i++; continue; }
    if (k === "--out" && v) { out.out = v; i++; continue; }
    if (k === "--strict") { out.strict = true; continue; }
    if (k === "--json") { out.json = true; continue; }
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
  const packageSmoke = buildReleasePackageSmokeReport({ cwd, runPack: false });
  const agentRunDrivers = agentRunDriverGateReport(cwd);
  agentRunDrivers.canarySuiteEvidence = agentRunDriverCanarySuiteEvidence(cwd);
  agentRunDrivers.lastCanaryEvidence = agentRunDriverCanaryEvidence(cwd);
  agentRunDrivers.lastMutationCanaryEvidence = agentRunDriverCanaryEvidence(cwd, ".artifacts/agent-run-driver/latest-mutation.json");

  return {
    target,
    head,
    latestTag,
    versions,
    versionsAligned,
    targetVersionReady,
    workflows,
    gates: {
      agentRunDrivers: agentRunDrivers.ok,
      packageSmoke: packageSmoke.ok,
    },
    agentRunDrivers,
    packageSmoke,
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
    { id: "agent-run-driver-gate", ok: data.gates.agentRunDrivers, evidence: data.agentRunDrivers.missingTests.length ? `missing ${data.agentRunDrivers.missingTests.join(", ")}` : `package.json scripts.test:agent-run:drivers includes ${data.agentRunDrivers.requiredTests.join(", ")}` },
    { id: "release-package-smoke", ok: data.packageSmoke.ok, evidence: data.packageSmoke.packageBlockers.length ? data.packageSmoke.packageBlockers.map((blocker) => blocker.id).join(", ") : "release package smoke report pass" },
    { id: "board-release-clear", ok: data.board.releaseReady, evidence: data.board.blockers.length ? data.board.blockers.join(", ") : "no open P0/in-progress/blocked tasks" },
  ].map((item) => ({ ...item, kind: releaseGateKind(item.id) }));
  const ready = checklist.every((item) => item.ok);
  const decision = ready ? "ready" : "not-ready";
  const failedChecklist = checklist.filter((item) => !item.ok);
  const releaseBlockers = failedChecklist.map(releaseBlockerRow);
  const operatorDecisions = operatorDecisionPackets(data, failedChecklist);
  const { nextActionCode, nextActions } = releaseNextActionPacket({ ready, releaseBlockers, operatorDecisions });
  const decisions = operatorDecisionLines(operatorDecisions);

  const lines = [
    `# Release readiness report v${data.target}`,
    "",
    `- generatedAt: ${now}`,
    `- head: ${data.head || "unknown"}`,
    `- latestTag: ${data.latestTag || "none"}`,
    `- decision: ${decision}`,
    "",
    "## Checklist",
    ...checklist.map((c) => `- [${c.ok ? "x" : " "}] ${c.id} — ${c.evidence}`),
    "",
    "## Release Blockers",
    ...(releaseBlockers.length ? releaseBlockers.map((c) => `- ${c.id} [${c.kind}]: ${c.evidence}`) : ["- none"]),
    "",
    "## Operator Decisions",
    ...(decisions.length ? decisions : ["- none"]),
    "",
    "## Board Summary",
    `- tasks: ${data.board.total}`,
    `- byStatus: ${Object.entries(data.board.byStatus).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
    `- byPriority: ${Object.entries(data.board.byPriority).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
    `- releaseBlockers: ${data.board.blockers.length ? data.board.blockers.join(", ") : "none"}`,
    `- releaseDecisionReady: ${data.board.releaseDecisionReady ? "yes" : "no"}`,
    "",
    "### Open P0",
    ...(data.board.openP0Rows.length ? data.board.openP0Rows.map((row) => `- ${taskRowOneLine(row)}`) : ["- none"]),
    "",
    "### P0 Ready To Start",
    ...(data.board.p0ReadyRows.length ? data.board.p0ReadyRows.map((row) => `- ${taskRowOneLine(row)}`) : ["- none"]),
    "",
    "### P0 Blocked By Dependency",
    ...(data.board.p0BlockedByDependencyRows.length ? data.board.p0BlockedByDependencyRows.map((row) => `- ${taskRowOneLine(row)} blockedBy=${row.blockedBy.join(",")}`) : ["- none"]),
    "",
    "### In Progress",
    ...(data.board.inProgressRows.length ? data.board.inProgressRows.map((row) => `- ${taskRowOneLine(row)}`) : ["- none"]),
    "",
    "### Blocked",
    ...(data.board.blockedRows.length ? data.board.blockedRows.map((row) => `- ${taskRowOneLine(row)}`) : ["- none"]),
    "",
    "### Board Evidence Candidates",
    ...(data.board.evidenceCandidateRows.length ? data.board.evidenceCandidateRows.map((row) => `- ${boardEvidenceOneLine(row)}`) : ["- none"]),
    "",
    "## Governance notes",
    "- publish permanece gateado por tag semver + smoke/test/verify/audit",
    "- draft release é manual (workflow_dispatch) para revisão do operador",
    "- promotion de release exige evidência canônica no board/handoff",
    "",
  ];

  return {
    markdown: lines.join("\n"),
    generatedAt: now,
    decision,
    checklist,
    ready,
    releaseBlockers,
    operatorDecisions,
    nextActionCode,
    nextActions,
    automationPermissions: REPORT_ONLY_PERMISSIONS,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const data = gather(args.target);
  const report = buildReport(data);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const defaultOut = path.join(process.cwd(), ".artifacts", "release-readiness", `v${args.target}-${stamp}.${args.json ? "json" : "md"}`);
  const outPath = args.out ? path.resolve(process.cwd(), args.out) : defaultOut;

  mkdirSync(path.dirname(outPath), { recursive: true });
  if (args.json) {
    writeFileSync(outPath, `${JSON.stringify({
      mode: "release-readiness-report",
      schemaVersion: 1,
      target: data.target,
      generatedAt: report.generatedAt,
      head: data.head,
      latestTag: data.latestTag,
      versions: data.versions,
      versionsAligned: data.versionsAligned,
      targetVersionReady: data.targetVersionReady,
      workflows: data.workflows,
      gates: data.gates,
      agentRunDrivers: data.agentRunDrivers,
      packageSmoke: data.packageSmoke,
      decision: report.decision,
      ready: report.ready,
      checklist: report.checklist,
      releaseBlockers: report.releaseBlockers,
      operatorDecisions: report.operatorDecisions,
      nextActionCode: report.nextActionCode,
      nextActions: report.nextActions,
      automationPermissions: report.automationPermissions,
      board: data.board,
    }, null, 2)}\n`);
  } else {
    writeFileSync(outPath, `${report.markdown}\n`);
  }

  process.stdout.write(`release-readiness-report: wrote ${path.relative(process.cwd(), outPath).replace(/\\/g, "/")}\n`);
  if (args.strict && !report.ready) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
