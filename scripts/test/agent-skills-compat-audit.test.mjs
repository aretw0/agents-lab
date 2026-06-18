import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildAgentSkillsCompatAudit, formatAgentSkillsCompatAudit } from "../agent-skills-compat-audit.mjs";

function withWorkspace(name, fn) {
  const root = mkdtempSync(path.join(tmpdir(), `${name}-`));
  try {
    mkdirSync(path.join(root, "packages"), { recursive: true });
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeSkill(file, { name = "pdf-processing", description = "Extract PDF text. Use when working with PDF files.", body = "# PDF Processing\n\nFollow the workflow.\n" } = {}) {
  writeFileSync(file, `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`, "utf8");
}

test("agent skills compatibility audit passes for current first-party skills", () => {
  const report = buildAgentSkillsCompatAudit(process.cwd());

  assert.equal(report.mode, "agent-skills-compat-audit");
  assert.equal(report.decision, "pass");
  assert.equal(report.skillCount, 28);
  assert.deepEqual(report.blockers, []);
  assert.match(formatAgentSkillsCompatAudit(report), /agent-skills-compat-audit:/);
});

test("accepts a package with a core Agent Skills directory", () => withWorkspace("agent-skills-ok", (root) => {
  const pkg = path.join(root, "packages", "skills");
  mkdirSync(path.join(pkg, "skills", "pdf-processing"), { recursive: true });
  writeJson(path.join(root, "package.json"), {
    name: "workspace",
    pi: { skills: ["packages/skills/skills"] },
  });
  writeJson(path.join(pkg, "package.json"), {
    name: "@example/skills",
    files: ["skills", "README.md"],
    pi: { skills: ["./skills"] },
  });
  writeSkill(path.join(pkg, "skills", "pdf-processing", "SKILL.md"));

  const report = buildAgentSkillsCompatAudit(root);

  assert.equal(report.decision, "pass");
  assert.equal(report.skillCount, 1);
  assert.equal(report.packageCount, 1);
}));

test("blocks invalid skill names and directory mismatches", () => withWorkspace("agent-skills-name", (root) => {
  const pkg = path.join(root, "packages", "skills");
  mkdirSync(path.join(pkg, "skills", "pdf-processing"), { recursive: true });
  writeJson(path.join(pkg, "package.json"), {
    name: "@example/skills",
    files: ["skills"],
    pi: { skills: ["./skills"] },
  });
  writeSkill(path.join(pkg, "skills", "pdf-processing", "SKILL.md"), { name: "PDF--processing" });

  const report = buildAgentSkillsCompatAudit(root);

  assert.equal(report.decision, "blocked");
  assert.deepEqual(report.blockers.map((blocker) => blocker.code).sort(), ["invalid-name", "name-directory-mismatch"]);
}));

test("blocks packages that expose skills without publishing the skills directory", () => withWorkspace("agent-skills-files", (root) => {
  const pkg = path.join(root, "packages", "skills");
  mkdirSync(path.join(pkg, "skills", "pdf-processing"), { recursive: true });
  writeJson(path.join(pkg, "package.json"), {
    name: "@example/skills",
    files: ["README.md"],
    pi: { skills: ["./skills"] },
  });
  writeSkill(path.join(pkg, "skills", "pdf-processing", "SKILL.md"));

  const report = buildAgentSkillsCompatAudit(root);

  assert.equal(report.decision, "blocked");
  assert.equal(report.blockers[0].code, "skills-not-published-in-files");
}));

test("blocks missing required frontmatter fields", () => withWorkspace("agent-skills-frontmatter", (root) => {
  const pkg = path.join(root, "packages", "skills");
  mkdirSync(path.join(pkg, "skills", "pdf-processing"), { recursive: true });
  writeJson(path.join(pkg, "package.json"), {
    name: "@example/skills",
    files: ["skills"],
    pi: { skills: ["./skills"] },
  });
  writeFileSync(path.join(pkg, "skills", "pdf-processing", "SKILL.md"), "---\nname: pdf-processing\n---\n\n# Body\n", "utf8");

  const report = buildAgentSkillsCompatAudit(root);

  assert.equal(report.decision, "blocked");
  assert.equal(report.blockers[0].code, "missing-description");
}));
