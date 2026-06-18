import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildReleaseContentReviewAudit } from "../release-content-review-audit.mjs";

const APPROVED = [
  "Decision: pass",
  "## Package Promise",
  "ok",
  "## Installed Surface",
  "ok",
  "## Dogfood Evidence",
  "ok",
  "## Public Docs",
  "ok",
  "## Installer Profiles",
  "ok",
  "## Non-Claims",
  "ok",
  "## Operator Decision",
  "approved",
].join("\n");

test("release content review audit passes approved review artifact", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "content-review-pass-"));
  try {
    const rel = "docs/research/0-8-release-content-review-2026-06-18.md";
    mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
    writeFileSync(path.join(cwd, rel), APPROVED);
    const report = buildReleaseContentReviewAudit({ cwd });
    assert.equal(report.decision, "pass");
    assert.deepEqual(report.blockers, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("release content review audit blocks hold decision", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "content-review-hold-"));
  try {
    const rel = "docs/research/0-8-release-content-review-2026-06-18.md";
    mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
    writeFileSync(path.join(cwd, rel), APPROVED.replace("Decision: pass", "Decision: hold"));
    const report = buildReleaseContentReviewAudit({ cwd });
    assert.equal(report.decision, "blocked");
    assert.ok(report.blockers.some((blocker) => blocker.code === "release-content-review-not-approved"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
