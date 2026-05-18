import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
