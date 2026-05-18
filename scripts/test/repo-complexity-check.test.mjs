import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { scanFiles } from "../repo-complexity-check.mjs";

test("scanFiles reports only files above the configured line budget", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "repo-complexity-"));
  const small = path.join(cwd, "small.ts");
  const large = path.join(cwd, "large.ts");

  try {
    writeFileSync(small, "one\ntwo", "utf8");
    writeFileSync(large, "one\ntwo\nthree\nfour", "utf8");

    const findings = scanFiles([small, large], 3);

    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, large);
    assert.equal(findings[0].lines, 4);
    assert.equal(findings[0].note, "over-limit");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("scanFiles marks known structured state and lockfiles as allowed large files", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "repo-complexity-allowed-"));
  const projectDir = path.join(cwd, ".project");
  const tasks = path.join(projectDir, "tasks.json");
  const lockfile = path.join(cwd, "package-lock.json");
  const source = path.join(cwd, "large.ts");

  try {
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(tasks, "[]\n[]\n[]\n[]", "utf8");
    writeFileSync(lockfile, "{}\n{}\n{}\n{}", "utf8");
    writeFileSync(source, "one\ntwo\nthree\nfour", "utf8");

    const findings = scanFiles([tasks, lockfile, source], 3)
      .sort((a, b) => a.file.localeCompare(b.file));

    assert.deepEqual(findings.map((finding) => path.relative(cwd, finding.file).replace(/\\/g, "/")), [
      ".project/tasks.json",
      "large.ts",
      "package-lock.json",
    ]);
    assert.deepEqual(findings.map((finding) => finding.note), [
      "allowed:canonical-state",
      "over-limit",
      "allowed:lockfile",
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
