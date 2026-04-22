import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { CURATED_DEFAULT } from "../../packages/pi-stack/package-list.mjs";

const SCRIPT = path.resolve("scripts/pi-parity.mjs");

test("pi-parity supports curated-default profile", () => {
  const run = spawnSync(process.execPath, [
    SCRIPT,
    "--scope",
    "project",
    "--profile",
    "curated-default",
    "--json",
  ], {
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  assert.ok(Array.isArray(payload.results));
  assert.equal(payload.results.length, 1);
  assert.equal(payload.results[0].profile, "curated-default");
  assert.equal(payload.results[0].expectedCount, CURATED_DEFAULT.length);
});
