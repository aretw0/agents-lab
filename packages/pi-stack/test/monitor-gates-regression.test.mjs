import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, it } from "node:test";

function runScript(scriptRelativePath, args, options = {}) {
  const scriptPath = join(process.cwd(), scriptRelativePath);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...(options.env ?? {}) },
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

function writeSessionFixture(agentDir, fileName, lines) {
  const sessionDir = join(agentDir, "sessions", "--fixture-project--");
  mkdirSync(sessionDir, { recursive: true });
  const sessionFile = join(sessionDir, fileName);
  writeFileSync(sessionFile, lines.join("\n") + "\n", "utf8");
  return sessionFile;
}

function msg(role, text) {
  return JSON.stringify({
    type: "message",
    message: { role, content: [{ type: "text", text }] },
  });
}

describe("monitor stability gates (deterministic fixtures)", () => {
  let tmpAgentDir;

  beforeEach(() => {
    tmpAgentDir = mkdtempSync(join(tmpdir(), "monitor-gates-agent-"));
  });

  afterEach(() => {
    rmSync(tmpAgentDir, { recursive: true, force: true });
  });

  it("evidence extracts classify failures + sovereign delta from fixture", () => {
    writeSessionFixture(tmpAgentDir, "session-a.jsonl", [
      msg("user", "check monitors"),
      msg("assistant", "Warning: [fragility] classify failed: No tool call in response"),
      msg(
        "assistant",
        "monitor-sovereign-delta · sovereignFlag=0 · thirdPartyDelta=1 · divergence=1",
      ),
    ]);

    const run = runScript(
      "scripts/monitor-stability-evidence.mjs",
      ["--source", "auto", "--tail-bytes", "500000"],
      { env: { PI_CODING_AGENT_DIR: tmpAgentDir } },
    );

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.ok(run.json, "expected JSON output");
    assert.equal(run.json.classifyFailures.total, 1);
    assert.equal(run.json.classifyFailures.byMonitor.fragility, 1);
    assert.equal(run.json.sovereignDelta.mentions, 1);
  });

  it("gate fails when classify failures exceed threshold", () => {
    writeSessionFixture(tmpAgentDir, "session-b.jsonl", [
      msg("user", "turn1"),
      msg("user", "turn2"),
      msg("user", "turn3"),
      msg("assistant", "Warning: [hedge] classify failed: Instructions are required"),
      msg(
        "assistant",
        "monitor-sovereign-delta · sovereignFlag=0 · thirdPartyDelta=1 · divergence=1",
      ),
    ]);

    const run = runScript(
      "scripts/monitor-stability-gate.mjs",
      [
        "--source",
        "auto",
        "--tail-bytes",
        "500000",
        "--min-user-turns",
        "3",
        "--max-classify-failures",
        "0",
        "--require-sovereign-delta",
      ],
      { env: { PI_CODING_AGENT_DIR: tmpAgentDir } },
    );

    assert.equal(run.status, 3, run.stderr || run.stdout);
    assert.ok(run.json, "expected JSON output");
    assert.equal(run.json.stable, false);
    assert.equal(run.json.summary.classifyFailures, 1);
  });

  it("gate passes clean fixture with enough user turns", () => {
    writeSessionFixture(tmpAgentDir, "session-c.jsonl", [
      msg("user", "turn1"),
      msg("user", "turn2"),
      msg("user", "turn3"),
      msg(
        "assistant",
        "monitor-sovereign-delta · sovereignFlag=0 · thirdPartyDelta=0 · divergence=0",
      ),
    ]);

    const run = runScript(
      "scripts/monitor-stability-gate.mjs",
      [
        "--source",
        "auto",
        "--tail-bytes",
        "500000",
        "--min-user-turns",
        "3",
        "--max-classify-failures",
        "0",
        "--require-sovereign-delta",
      ],
      { env: { PI_CODING_AGENT_DIR: tmpAgentDir } },
    );

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.ok(run.json, "expected JSON output");
    assert.equal(run.json.stable, true);
    assert.equal(run.json.summary.userTurns, 3);
    assert.equal(run.json.summary.classifyFailures, 0);
  });

  it("gate auto-expands tail when initial slice undercounts user turns", () => {
    const huge = "x".repeat(300_000);
    writeSessionFixture(tmpAgentDir, "session-d.jsonl", [
      msg("user", "turn1"),
      msg("user", "turn2"),
      msg("user", "turn3"),
      msg("assistant", huge),
    ]);

    const run = runScript(
      "scripts/monitor-stability-gate.mjs",
      [
        "--source",
        "auto",
        "--tail-bytes",
        "20000",
        "--max-tail-bytes",
        "1000000",
        "--min-user-turns",
        "3",
        "--max-classify-failures",
        "0",
      ],
      { env: { PI_CODING_AGENT_DIR: tmpAgentDir } },
    );

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.ok(run.json, "expected JSON output");
    assert.equal(run.json.stable, true);
    assert.equal(run.json.summary.userTurns, 3);
    assert.ok(run.json.summary.tailBytesUsed > 20000);
    assert.ok(Array.isArray(run.json.summary.tailAttempts));
    assert.ok(run.json.summary.tailAttempts.length >= 2);
  });
});
