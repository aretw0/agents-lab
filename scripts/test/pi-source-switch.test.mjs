import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { rewritePackages } from "../pi-source-switch.mjs";

test("rewritePackages deduplicates managed package entries while preserving unmanaged entries", () => {
  const desired = new Map([
    ["@aretw0/pi-stack", "../packages/pi-stack"],
    ["@aretw0/git-skills", "../packages/git-skills"],
  ]);
  const rewritten = rewritePackages(
    [
      "npm:@aretw0/pi-stack",
      { source: "npm:@aretw0/pi-stack", extensions: [], skills: [], themes: [] },
      "npm:@ifi/oh-pi-extensions",
    ],
    desired,
  );

  assert.deepEqual(rewritten, [
    "../packages/pi-stack",
    "npm:@ifi/oh-pi-extensions",
    "../packages/git-skills",
  ]);
});

test("rewritePackages resolves project-local package paths relative to settings dir", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-source-switch-test-"));
  try {
    const settingsDir = path.join(cwd, ".pi");
    const pkgDir = path.join(cwd, "packages", "pi-stack");
    mkdirSync(settingsDir, { recursive: true });
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name: "@aretw0/pi-stack" }), "utf8");

    const rewritten = rewritePackages(
      [
        "../packages/pi-stack",
        { source: "npm:@aretw0/pi-stack", extensions: [], skills: [], themes: [] },
      ],
      new Map([["@aretw0/pi-stack", "../packages/pi-stack"]]),
      { settingsDir },
    );

    assert.deepEqual(rewritten, ["../packages/pi-stack"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
