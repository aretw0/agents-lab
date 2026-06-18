import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildHostCheckoutCacheBridgeReport,
  formatHostCheckoutCacheBridgeReport,
} from "../host-checkout-cache-bridge.mjs";

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "host-bridge-"));
}

test("reports no configured roots without scanning", () => {
  const cwd = makeTmp();
  const report = buildHostCheckoutCacheBridgeReport({ cwd, roots: [], env: { HOME: cwd } });

  assert.equal(report.decision, "no-configured-roots");
  assert.equal(report.recursiveScan, false);
  assert.equal(report.contentScan, false);
  assert.equal(report.rootCount, 0);
});

test("summarizes an explicit git checkout root read-only", () => {
  const cwd = makeTmp();
  const checkout = path.join(cwd, "refarm");
  fs.mkdirSync(path.join(checkout, ".git", "refs", "heads"), { recursive: true });
  fs.writeFileSync(path.join(checkout, ".git", "HEAD"), "ref: refs/heads/main\n");
  fs.writeFileSync(path.join(checkout, ".git", "refs", "heads", "main"), "0123456789abcdef0123456789abcdef01234567\n");
  fs.writeFileSync(path.join(checkout, "package.json"), "{}\n");
  fs.writeFileSync(path.join(checkout, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  fs.mkdirSync(path.join(checkout, "src"));

  const report = buildHostCheckoutCacheBridgeReport({ cwd, roots: ["refarm"], env: { HOME: cwd }, maxEntries: 10 });

  assert.equal(report.decision, "ready-for-read-only-evidence");
  assert.equal(report.availableCount, 1);
  assert.equal(report.roots[0].decision, "summarized-read-only");
  assert.ok(report.roots[0].markers.includes("git-checkout"));
  assert.ok(report.roots[0].markers.includes("node-package"));
  assert.equal(report.roots[0].git.headRef, "refs/heads/main");
  assert.equal(report.roots[0].git.head, "0123456789abcdef0123456789abcdef01234567");
  assert.match(formatHostCheckoutCacheBridgeReport(report), /recursive=no contentScan=no/);
});

test("keeps missing configured roots explicit", () => {
  const cwd = makeTmp();
  const report = buildHostCheckoutCacheBridgeReport({ cwd, roots: ["../missing"], env: { HOME: cwd } });

  assert.equal(report.decision, "configured-roots-unavailable");
  assert.equal(report.missingCount, 1);
  assert.deepEqual(report.roots[0].warnings, ["root-not-found"]);
});

test("limits first-level entries and marks truncation", () => {
  const cwd = makeTmp();
  const cache = path.join(cwd, ".cache", "checkouts");
  fs.mkdirSync(cache, { recursive: true });
  for (const name of ["a", "b", "c"]) fs.mkdirSync(path.join(cache, name));

  const report = buildHostCheckoutCacheBridgeReport({ cwd, roots: [".cache/checkouts"], env: { HOME: cwd }, maxEntries: 2 });

  assert.equal(report.roots[0].entries.length, 2);
  assert.equal(report.roots[0].truncated, true);
  assert.ok(report.roots[0].markers.includes("cache-path"));
  assert.ok(report.roots[0].markers.includes("checkout-cache-path"));
});
