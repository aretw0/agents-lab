import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  CURATED_DEFAULT,
  CURATED_RUNTIME,
  STRICT_CURATED,
} from "../../packages/pi-stack/package-list.mjs";

const SCRIPT = path.resolve("scripts/pi-parity.mjs");

test("pi-parity defaults to strict-curated profile", () => {
  const run = spawnSync(process.execPath, [
    SCRIPT,
    "--scope",
    "project",
    "--json",
  ], {
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.results[0].profile, "strict-curated");
  assert.equal(payload.results[0].expectedCount, STRICT_CURATED.length);
});

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

test("pi-parity supports strict-curated profile", () => {
  const run = spawnSync(process.execPath, [
    SCRIPT,
    "--scope",
    "project",
    "--profile",
    "strict-curated",
    "--json",
  ], {
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.results[0].profile, "strict-curated");
  assert.equal(payload.results[0].expectedCount, STRICT_CURATED.length);
});

test("pi-parity supports curated-runtime profile", () => {
  const run = spawnSync(process.execPath, [
    SCRIPT,
    "--scope",
    "project",
    "--profile",
    "curated-runtime",
    "--json",
  ], {
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.results[0].profile, "curated-runtime");
  assert.equal(payload.results[0].expectedCount, CURATED_RUNTIME.length);
});

test("pi-parity help hides the legacy curated-default alias", () => {
  const run = spawnSync(process.execPath, [SCRIPT, "--help"], {
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /strict-curated/);
  assert.doesNotMatch(run.stdout, /curated-default/);
});

test("pi-parity invalid profile hint hides the legacy curated-default alias", () => {
  const run = spawnSync(process.execPath, [SCRIPT, "--profile", "missing"], {
    encoding: "utf8",
  });

  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /strict-curated/);
  assert.doesNotMatch(run.stderr, /curated-default/);
});
