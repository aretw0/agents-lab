import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, it } from "node:test";

function runScript(scriptRelativePath, args, env = {}) {
  const scriptPath = join(process.cwd(), scriptRelativePath);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
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

function msg(role, text) {
  return JSON.stringify({
    type: "message",
    message: { role, content: [{ type: "text", text }] },
  });
}

function writeSession(agentDir, fileName, lines) {
  const sessionDir = join(agentDir, "sessions", "--replay-fixture--");
  mkdirSync(sessionDir, { recursive: true });
  const sessionPath = join(sessionDir, fileName);
  writeFileSync(sessionPath, `${lines.join("\n")}\n`, "utf8");
}

describe("monitor replay regression (false-positive + stability)", () => {
  let tmpAgentDir;

  beforeEach(() => {
    tmpAgentDir = mkdtempSync(join(tmpdir(), "monitor-replay-agent-"));
  });

  afterEach(() => {
    rmSync(tmpAgentDir, { recursive: true, force: true });
  });

  it("does not count automated monitor feedback text as classify failure", () => {
    writeSession(tmpAgentDir, "session-fp-noise.jsonl", [
      msg("user", "validate monitor calibration"),
      msg(
        "assistant",
        "[monitor:fragility] The agent investigated and ran tests, then responded with an empty message, leaving findings and conclusions uncommunicated to the user.",
      ),
      msg(
        "assistant",
        "Suggestion: [L2:confirm] If next step changes scope, request explicit user confirmation first.",
      ),
      msg(
        "assistant",
        "monitor-sovereign-delta · sovereignFlag=0 · thirdPartyDelta=0 · divergence=0",
      ),
    ]);

    const run = runScript(
      "scripts/monitor-stability-evidence.mjs",
      ["--source", "auto", "--tail-bytes", "500000"],
      { PI_CODING_AGENT_DIR: tmpAgentDir },
    );

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.ok(run.json, "expected JSON output");
    assert.equal(run.json.classifyFailures.total, 0);
    assert.deepEqual(run.json.classifyFailures.byMonitor, {});
  });

  it("counts only explicit classify failed signatures", () => {
    writeSession(tmpAgentDir, "session-classify-one.jsonl", [
      msg("user", "turn1"),
      msg("user", "turn2"),
      msg("user", "turn3"),
      msg("assistant", "Warning: [fragility] classify failed: No tool call in response"),
      msg("assistant", "User quoted error text: Instructions are required"),
      msg(
        "assistant",
        "monitor-sovereign-delta · sovereignFlag=0 · thirdPartyDelta=1 · divergence=1",
      ),
    ]);

    const run = runScript(
      "scripts/monitor-stability-evidence.mjs",
      ["--source", "auto", "--tail-bytes", "500000"],
      { PI_CODING_AGENT_DIR: tmpAgentDir },
    );

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.ok(run.json, "expected JSON output");
    assert.equal(run.json.classifyFailures.total, 1);
    assert.equal(run.json.classifyFailures.byMonitor.fragility, 1);
  });

  it("gate stays stable on noisy feedback when no classify failure exists", () => {
    writeSession(tmpAgentDir, "session-gate-clean.jsonl", [
      msg("user", "turn1"),
      msg("user", "turn2"),
      msg("user", "turn3"),
      msg(
        "assistant",
        "[monitor:fragility] The agent completed investigative checks but returned an empty response.",
      ),
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
      { PI_CODING_AGENT_DIR: tmpAgentDir },
    );

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.ok(run.json, "expected JSON output");
    assert.equal(run.json.stable, true);
    assert.equal(run.json.summary.classifyFailures, 0);
  });

  it("gate blocks when classify failure appears amid noisy feedback", () => {
    writeSession(tmpAgentDir, "session-gate-fail.jsonl", [
      msg("user", "turn1"),
      msg("user", "turn2"),
      msg("user", "turn3"),
      msg(
        "assistant",
        "[monitor:fragility] automated feedback text that should not count by itself",
      ),
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
      { PI_CODING_AGENT_DIR: tmpAgentDir },
    );

    assert.equal(run.status, 3, run.stderr || run.stdout);
    assert.ok(run.json, "expected JSON output");
    assert.equal(run.json.stable, false);
    assert.equal(run.json.summary.classifyFailures, 1);
  });
});
