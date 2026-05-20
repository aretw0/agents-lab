import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPackageBoundaryAudit } from "../package-boundary-audit.mjs";

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

test("accepts package runtime refs covered by files", () => withWorkspace("package-boundary-ok", (root) => {
  const pkg = path.join(root, "packages", "stack");
  mkdirSync(path.join(pkg, "extensions"), { recursive: true });
  writeJson(path.join(pkg, "package.json"), {
    name: "stack",
    files: ["extensions", "README.md"],
    pi: { extensions: ["./extensions/main.ts"] },
  });
  writeFileSync(path.join(pkg, "extensions", "helper.ts"), "export const ok = true;\n", "utf8");
  writeFileSync(path.join(pkg, "extensions", "main.ts"), "import { ok } from './helper';\nexport default ok;\n", "utf8");

  const report = buildPackageBoundaryAudit(root);

  assert.equal(report.packageCount, 1);
  assert.equal(report.blockerCount, 0);
}));

test("ignores unpublished package test files", () => withWorkspace("package-boundary-tests", (root) => {
  const pkg = path.join(root, "packages", "stack");
  mkdirSync(path.join(pkg, "extensions"), { recursive: true });
  mkdirSync(path.join(pkg, "test"), { recursive: true });
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  writeJson(path.join(pkg, "package.json"), {
    name: "stack",
    files: ["extensions"],
    pi: { extensions: ["./extensions/main.ts"] },
  });
  writeFileSync(path.join(root, "scripts", "helper.mjs"), "export const helper = true;\n", "utf8");
  writeFileSync(path.join(pkg, "extensions", "main.ts"), "export default {};\n", "utf8");
  writeFileSync(path.join(pkg, "test", "main.test.ts"), "import '../../../scripts/helper.mjs';\n", "utf8");

  const report = buildPackageBoundaryAudit(root);

  assert.equal(report.blockerCount, 0);
}));

test("blocks package source importing repo-local files", () => withWorkspace("package-boundary-local", (root) => {
  const pkg = path.join(root, "packages", "stack");
  mkdirSync(path.join(pkg, "extensions"), { recursive: true });
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  writeJson(path.join(pkg, "package.json"), {
    name: "stack",
    files: ["extensions"],
    pi: { extensions: ["./extensions/main.ts"] },
  });
  writeFileSync(path.join(root, "scripts", "helper.mjs"), "export const helper = true;\n", "utf8");
  writeFileSync(path.join(pkg, "extensions", "main.ts"), "import { helper } from '../../../scripts/helper.mjs';\nexport default helper;\n", "utf8");

  const report = buildPackageBoundaryAudit(root);

  assert.equal(report.blockerCount, 1);
  assert.equal(report.blockers[0].code, "package-source-imports-repo-local-file");
}));

test("blocks manifest runtime refs not covered by files", () => withWorkspace("package-boundary-files", (root) => {
  const pkg = path.join(root, "packages", "stack");
  mkdirSync(path.join(pkg, "extensions"), { recursive: true });
  writeJson(path.join(pkg, "package.json"), {
    name: "stack",
    files: ["README.md"],
    pi: { extensions: ["./extensions/main.ts"] },
  });
  writeFileSync(path.join(pkg, "extensions", "main.ts"), "export default {};\n", "utf8");

  const report = buildPackageBoundaryAudit(root);

  assert.equal(report.blockerCount, 1);
  assert.equal(report.blockers[0].code, "manifest-ref-not-in-files");
}));
