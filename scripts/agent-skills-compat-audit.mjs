#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OPTIONAL_DIRS = new Set(["scripts", "references", "assets"]);

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function normalizePath(value) {
  return String(value ?? "").replaceAll("\\", "/");
}

function listPackageDirs(root) {
  const packagesRoot = path.join(root, "packages");
  if (!existsSync(packagesRoot)) return [];
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join("packages", entry.name))
    .filter((relDir) => existsSync(path.join(root, relDir, "package.json")))
    .sort();
}

function parseFrontmatter(content) {
  if (!content.startsWith("---\n")) {
    return { ok: false, error: "missing-yaml-frontmatter" };
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    return { ok: false, error: "unclosed-yaml-frontmatter" };
  }
  const raw = content.slice(4, end);
  const body = content.slice(end + 4).trim();
  const fields = {};
  let currentKey = null;
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*$/.test(line)) continue;
    const continuation = line.match(/^(\s+)(.+)$/);
    if (continuation && currentKey) {
      fields[currentKey] = `${fields[currentKey]}\n${continuation[2].trimEnd()}`.trim();
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      return { ok: false, error: "unsupported-yaml-frontmatter-line", line };
    }
    currentKey = match[1];
    let value = match[2].trim();
    if (value === ">" || value === "|") value = "";
    value = value.replace(/^["']|["']$/g, "");
    fields[currentKey] = value;
  }
  return { ok: true, fields, body };
}

function validateSkill({ packageName, packageDir, skillRoot, skillDir, skillName }) {
  const skillMdPath = path.join(skillDir, "SKILL.md");
  const relSkill = normalizePath(path.relative(skillRoot, skillDir));
  const relFile = normalizePath(path.relative(packageDir, skillMdPath));
  const blockers = [];
  const warnings = [];

  if (!existsSync(skillMdPath)) {
    blockers.push({ code: "missing-skill-md", skill: skillName, file: relFile });
    return { name: skillName, dirName: skillName, file: relFile, blockers, warnings };
  }

  const content = readFileSync(skillMdPath, "utf8");
  const parsed = parseFrontmatter(content);
  if (!parsed.ok) {
    blockers.push({ code: parsed.error, skill: skillName, file: relFile, line: parsed.line });
    return { name: skillName, dirName: skillName, file: relFile, blockers, warnings };
  }

  const name = String(parsed.fields.name ?? "").trim();
  const description = String(parsed.fields.description ?? "").trim();
  const compatibility = parsed.fields.compatibility;
  const allowedTools = parsed.fields["allowed-tools"];

  if (!name) blockers.push({ code: "missing-name", skill: skillName, file: relFile });
  else {
    if (name.length > 64) blockers.push({ code: "name-too-long", skill: name, file: relFile, max: 64, actual: name.length });
    if (!NAME_RE.test(name)) blockers.push({ code: "invalid-name", skill: name, file: relFile });
    if (name !== path.basename(skillDir)) blockers.push({ code: "name-directory-mismatch", skill: name, dirName: path.basename(skillDir), file: relFile });
  }

  if (!description) blockers.push({ code: "missing-description", skill: name || skillName, file: relFile });
  else if (description.length > 1024) blockers.push({ code: "description-too-long", skill: name || skillName, file: relFile, max: 1024, actual: description.length });

  if (compatibility !== undefined) {
    const value = String(compatibility).trim();
    if (!value) blockers.push({ code: "empty-compatibility", skill: name || skillName, file: relFile });
    if (value.length > 500) blockers.push({ code: "compatibility-too-long", skill: name || skillName, file: relFile, max: 500, actual: value.length });
  }

  if (allowedTools !== undefined && typeof allowedTools !== "string") {
    blockers.push({ code: "invalid-allowed-tools", skill: name || skillName, file: relFile });
  }

  if (!parsed.body) warnings.push({ code: "empty-body", skill: name || skillName, file: relFile });
  const lineCount = content.split(/\r?\n/).length;
  if (lineCount > 500) warnings.push({ code: "skill-md-over-500-lines", skill: name || skillName, file: relFile, actual: lineCount });

  for (const entry of readdirSync(skillDir, { withFileTypes: true })) {
    if (OPTIONAL_DIRS.has(entry.name) && !entry.isDirectory()) {
      blockers.push({ code: "optional-resource-not-directory", skill: name || skillName, file: relFile, resource: `${relSkill}/${entry.name}` });
    }
  }

  return { name: name || skillName, dirName: path.basename(skillDir), file: relFile, blockers, warnings };
}

function validateSkillRoot({ packageName, packageDir, skillRoot, skillRootRel }) {
  const blockers = [];
  const warnings = [];
  const skills = [];
  if (!existsSync(skillRoot)) {
    blockers.push({ code: "missing-skill-root", packageName, path: skillRootRel });
    return { path: skillRootRel, skillCount: 0, skills, blockers, warnings };
  }

  const entries = readdirSync(skillRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const skill = validateSkill({
      packageName,
      packageDir,
      skillRoot,
      skillDir: path.join(skillRoot, entry.name),
      skillName: entry.name,
    });
    skills.push(skill);
    blockers.push(...skill.blockers);
    warnings.push(...skill.warnings);
  }
  if (entries.length === 0) warnings.push({ code: "empty-skill-root", packageName, path: skillRootRel });
  return { path: skillRootRel, skillCount: skills.length, skills, blockers, warnings };
}

function packageFilesCoverSkills(manifest) {
  const files = Array.isArray(manifest.files) ? manifest.files.map(normalizePath) : [];
  return files.includes("skills") || files.includes("./skills");
}

export function buildAgentSkillsCompatAudit(cwd = process.cwd()) {
  const root = path.resolve(cwd);
  const packageDirs = listPackageDirs(root);
  const packages = [];
  const workspaceManifest = existsSync(path.join(root, "package.json")) ? readJson(path.join(root, "package.json")) : {};
  const workspaceSkillRoots = Array.isArray(workspaceManifest.pi?.skills) ? workspaceManifest.pi.skills.map(normalizePath) : [];
  const workspaceRootReports = workspaceSkillRoots.map((skillRootRel) => validateSkillRoot({
    packageName: workspaceManifest.name ?? "(workspace)",
    packageDir: root,
    skillRoot: path.join(root, skillRootRel),
    skillRootRel,
  }));

  for (const relDir of packageDirs) {
    const packageDir = path.join(root, relDir);
    const manifest = readJson(path.join(packageDir, "package.json"));
    const skillRefs = Array.isArray(manifest.pi?.skills) ? manifest.pi.skills.map(normalizePath) : [];
    if (skillRefs.length === 0) continue;
    const blockers = [];
    const warnings = [];
    if (!packageFilesCoverSkills(manifest)) {
      blockers.push({ code: "skills-not-published-in-files", packageName: manifest.name, packageDir: relDir });
    }
    const roots = skillRefs.map((ref) => validateSkillRoot({
      packageName: manifest.name,
      packageDir,
      skillRoot: path.join(packageDir, ref),
      skillRootRel: ref,
    }));
    for (const rootReport of roots) {
      blockers.push(...rootReport.blockers);
      warnings.push(...rootReport.warnings);
    }
    const skillCount = roots.reduce((sum, rootReport) => sum + rootReport.skillCount, 0);
    packages.push({
      packageName: manifest.name,
      packageDir: relDir,
      skillRoots: skillRefs,
      skillCount,
      roots,
      blockers,
      warnings,
      decision: blockers.length === 0 ? "pass" : "blocked",
    });
  }

  const blockers = [
    ...workspaceRootReports.flatMap((rootReport) => rootReport.blockers.map((blocker) => ({ ...blocker, scope: "workspace" }))),
    ...packages.flatMap((pkg) => pkg.blockers.map((blocker) => ({ ...blocker, packageName: pkg.packageName, packageDir: pkg.packageDir }))),
  ];
  const warnings = [
    ...workspaceRootReports.flatMap((rootReport) => rootReport.warnings.map((warning) => ({ ...warning, scope: "workspace" }))),
    ...packages.flatMap((pkg) => pkg.warnings.map((warning) => ({ ...warning, packageName: pkg.packageName, packageDir: pkg.packageDir }))),
  ];
  const skillCount = packages.reduce((sum, pkg) => sum + pkg.skillCount, 0);
  const decision = blockers.length === 0 ? "pass" : "blocked";

  return {
    mode: "agent-skills-compat-audit",
    schemaVersion: 1,
    generatedAtIso: new Date().toISOString(),
    spec: {
      source: "https://agentskills.io/specification",
      profile: "core-format",
      piExtension: "package.json#pi.skills is a Pi distribution hint; portable Agent Skills compatibility is validated at each skill directory.",
    },
    decision,
    skillCount,
    packageCount: packages.length,
    blockers,
    warnings,
    workspace: {
      skillRoots: workspaceSkillRoots,
      roots: workspaceRootReports,
    },
    packages,
    summary: `agent-skills-compat-audit: decision=${decision} skills=${skillCount} packages=${packages.length} blockers=${blockers.length} warnings=${warnings.length}`,
  };
}

export function formatAgentSkillsCompatAudit(report) {
  const lines = [report.summary, `spec=${report.spec.source} profile=${report.spec.profile}`];
  for (const pkg of report.packages) {
    lines.push(`- ${pkg.packageName}: ${pkg.decision} skills=${pkg.skillCount} blockers=${pkg.blockers.length} warnings=${pkg.warnings.length}`);
    for (const blocker of pkg.blockers.slice(0, 8)) {
      lines.push(`  - blocker ${blocker.code}: ${blocker.file ?? blocker.path ?? blocker.packageDir}`);
    }
    for (const warning of pkg.warnings.slice(0, 4)) {
      lines.push(`  - warning ${warning.code}: ${warning.file ?? warning.path}`);
    }
  }
  return lines.join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const out = { json: false, strict: false, help: false };
  for (const arg of argv) {
    if (arg === "--json") out.json = true;
    else if (arg === "--strict") out.strict = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function main() {
  const args = parseArgs();
  if (args.help) {
    console.log("Usage: node scripts/agent-skills-compat-audit.mjs [--json] [--strict]");
    process.exit(0);
  }
  const report = buildAgentSkillsCompatAudit();
  console.log(args.json ? JSON.stringify(report, null, 2) : formatAgentSkillsCompatAudit(report));
  if (args.strict && report.decision !== "pass") process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
