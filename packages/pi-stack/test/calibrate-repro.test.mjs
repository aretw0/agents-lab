import assert from "node:assert/strict";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

function runCalibrate(args) {
  const scriptPath = join(process.cwd(), "scripts", "calibrate-repro.mjs");
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = (result.stdout ?? "").trim();
  let json;
  try {
    json = stdout ? JSON.parse(stdout) : undefined;
  } catch {
    json = undefined;
  }
  return {
    status: typeof result.status === "number" ? result.status : 0,
    stdout,
    stderr: (result.stderr ?? "").trim(),
    json,
  };
}

describe("calibrate-repro", () => {
  it("dry-run deterministic prints planned steps", () => {
    const run = runCalibrate(["--dry-run"]);
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.ok(run.json, "expected JSON output");
    assert.equal(run.json.mode, "deterministic");
    assert.equal(run.json.dryRun, true);
    assert.ok(Array.isArray(run.json.steps));
    assert.ok(run.json.steps.some((s) => s.id === "monitor-stability-gate"));
    assert.ok(run.json.steps.some((s) => s.id === "subagent-readiness-gate-strict"));
  });

  it("dry-run canary includes write-report steps", () => {
    const run = runCalibrate(["--dry-run", "--canary", "--skip-monitor-tests"]);
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.ok(run.json, "expected JSON output");
    assert.equal(run.json.mode, "canary");
    const ids = run.json.steps.map((s) => s.id);
    assert.ok(ids.includes("monitor-stability-evidence-write"));
    assert.ok(ids.includes("subagent-readiness-write"));
  });

  it("dry-run real-token canary includes capped request steps", () => {
    const cmdJson = JSON.stringify([process.execPath, "-e", "console.log('rt-ok')"]);
    const run = runCalibrate([
      "--dry-run",
      "--skip-monitor-tests",
      "--real-token-canary",
      "--real-token-max-requests",
      "2",
      "--real-token-command-json",
      cmdJson,
    ]);
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.ok(run.json, "expected JSON output");
    assert.equal(run.json.mode, "canary+real-token");
    assert.equal(run.json.budget.realTokenMaxRequests, 2);
    const ids = run.json.steps.map((s) => s.id);
    assert.ok(ids.includes("real-token-canary-1"));
    assert.ok(ids.includes("real-token-canary-2"));
  });

  it("fails when real-token canary has no command configured", () => {
    const run = runCalibrate([
      "--dry-run",
      "--real-token-canary",
      "--real-token-command-file",
      ".pi/does-not-exist.json",
      "--skip-monitor-tests",
    ]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /real-token canary requer comando/i);
  });

  it("fails with unknown argument", () => {
    const run = runCalibrate(["--unknown-flag"]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Argumento desconhecido/i);
  });
});
