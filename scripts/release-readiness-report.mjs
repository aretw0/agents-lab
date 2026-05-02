#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const PACKAGES = [
  "packages/pi-stack/package.json",
  "packages/git-skills/package.json",
  "packages/web-skills/package.json",
  "packages/pi-skills/package.json",
  "packages/lab-skills/package.json",
];

function runGit(args) {
  const out = spawnSync("git", args, { encoding: "utf8", stdio: "pipe" });
  if (out.status !== 0) return "";
  return String(out.stdout ?? "").trim();
}

function readJson(relPath) {
  return JSON.parse(readFileSync(path.join(process.cwd(), relPath), "utf8"));
}

function parseArgs(argv) {
  const out = {
    target: "0.8.0",
    out: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--target" && v) { out.target = v; i++; continue; }
    if (k === "--out" && v) { out.out = v; i++; continue; }
  }
  return out;
}

function gather(target) {
  const versions = PACKAGES.map((pkg) => {
    const json = readJson(pkg);
    return { pkg, version: String(json.version ?? "unknown") };
  });
  const uniqueVersions = [...new Set(versions.map((v) => v.version))];
  const versionsAligned = uniqueVersions.length === 1;

  const latestTag = runGit(["describe", "--tags", "--abbrev=0"]);
  const head = runGit(["rev-parse", "--short", "HEAD"]);

  const workflows = {
    ci: existsSync(path.join(process.cwd(), ".github", "workflows", "ci.yml")),
    publish: existsSync(path.join(process.cwd(), ".github", "workflows", "publish.yml")),
    releaseDraft: existsSync(path.join(process.cwd(), ".github", "workflows", "release-draft.yml")),
  };

  return {
    target,
    head,
    latestTag,
    versions,
    versionsAligned,
    workflows,
  };
}

function buildReport(data) {
  const now = new Date().toISOString();
  const checklist = [
    { id: "versions-aligned", ok: data.versionsAligned, evidence: data.versions.map((v) => `${v.pkg}:${v.version}`).join(", ") },
    { id: "workflow-ci", ok: data.workflows.ci, evidence: ".github/workflows/ci.yml" },
    { id: "workflow-publish", ok: data.workflows.publish, evidence: ".github/workflows/publish.yml" },
    { id: "workflow-release-draft", ok: data.workflows.releaseDraft, evidence: ".github/workflows/release-draft.yml" },
    { id: "target-tag-planned", ok: true, evidence: `v${data.target}` },
  ];

  const lines = [
    `# Release readiness report v${data.target}`,
    "",
    `- generatedAt: ${now}`,
    `- head: ${data.head || "unknown"}`,
    `- latestTag: ${data.latestTag || "none"}`,
    "",
    "## Checklist",
    ...checklist.map((c) => `- [${c.ok ? "x" : " "}] ${c.id} — ${c.evidence}`),
    "",
    "## Governance notes",
    "- publish permanece gateado por tag semver + smoke/test/verify/audit",
    "- draft release é manual (workflow_dispatch) para revisão humana",
    "- promotion de release exige evidência canônica no board/handoff",
    "",
  ];

  return { markdown: lines.join("\n"), checklist };
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
}

main();
