import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = path.resolve("scripts/session-triage.mjs");

function runTriage({ workspace, eventsPath, extraArgs = [] }) {
  const args = [
    SCRIPT,
    "--workspace",
    workspace,
    "--days",
    "30",
    "--limit",
    "1",
    "--json",
    "--no-summary-store",
  ];
  if (eventsPath) {
    args.push("--events", eventsPath);
  }
  args.push(...extraArgs);

  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function toSessionWorkspaceKey(absPath) {
  const resolved = path.resolve(absPath).replace(/\\/g, "/");
  const drive = resolved.match(/^([A-Za-z]):\/(.*)$/);
  if (drive) {
    const letter = drive[1].toUpperCase();
    const rest = drive[2]
      .split("/")
      .filter(Boolean)
      .map((s) => s.replace(/[^A-Za-z0-9._-]/g, "-"))
      .join("-");
    return `--${letter}--${rest}--`;
  }
  const rest = resolved
    .replace(/^\//, "")
    .split("/")
    .filter(Boolean)
    .map((s) => s.replace(/[^A-Za-z0-9._-]/g, "-"))
    .join("-");
  return `--${rest}--`;
}

function makeWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), "triage-delegation-"));
  mkdirSync(path.join(root, ".project"), { recursive: true });
  return root;
}

test("session-triage recommends bootstrap-first when tooling gaps are present", () => {
  const workspace = makeWorkspace();
  try {
    writeFileSync(
      path.join(workspace, ".project", "tasks.json"),
      JSON.stringify({ tasks: [] }, null, 2),
    );

    const eventsPath = path.join(workspace, "events.jsonl");
    const event = {
      source: { provider: "pi" },
      event: {
        timestampIso: new Date().toISOString(),
        role: "assistant",
        text: "falhou: command not found ao preparar ambiente",
      },
    };
    writeFileSync(eventsPath, `${JSON.stringify(event)}\n${JSON.stringify(event)}\n`);

    const report = runTriage({ workspace, eventsPath });
    assert.equal(report.recommendation.lane, "bootstrap-first");
    assert.equal(report.recommendation.confidence, "high");
    assert.ok(report.aggregate.toolingGaps["command-not-found"] >= 1);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("session-triage recommends swarm-candidate when complete signal exists and unlock-now backlog is high", () => {
  const workspace = makeWorkspace();
  try {
    writeFileSync(
      path.join(workspace, ".project", "tasks.json"),
      JSON.stringify(
        {
          tasks: [
            { id: "TASK-P0-1", status: "in-progress", description: "[P0] item 1" },
            { id: "TASK-P0-2", status: "blocked", description: "item 2" },
            { id: "item-promotion", status: "planned", description: "candidate-promotion" },
          ],
        },
        null,
        2,
      ),
    );

    const eventsPath = path.join(workspace, "events.jsonl");
    const event = {
      source: { provider: "pi" },
      event: {
        timestampIso: new Date().toISOString(),
        role: "assistant",
        text: "[COLONY_SIGNAL:COMPLETE] lote finalizado",
      },
    };
    writeFileSync(eventsPath, `${JSON.stringify(event)}\n${JSON.stringify(event)}\n`);

    const report = runTriage({ workspace, eventsPath });
    assert.equal(report.recommendation.lane, "swarm-candidate");
    assert.equal(report.recommendation.confidence, "medium");
    assert.equal(report.recommendation.metrics.unlockNowCount, 3);
    assert.ok(report.recommendation.metrics.completeSignals >= 1);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("session-triage defaults to local sandbox sessions with tail-batch window", () => {
  const workspace = makeWorkspace();
  try {
    writeFileSync(
      path.join(workspace, ".project", "tasks.json"),
      JSON.stringify({ tasks: [] }, null, 2),
    );

    const key = toSessionWorkspaceKey(workspace);
    const localSessionDir = path.join(workspace, ".sandbox", "pi-agent", "sessions", key);
    mkdirSync(localSessionDir, { recursive: true });
    const sessionPath = path.join(localSessionDir, "2026-04-22T00-00-00-000Z_test.jsonl");

    const lines = [];
    for (let i = 1; i <= 5; i++) {
      lines.push(JSON.stringify({
        type: "message",
        timestamp: new Date(Date.now() - (6 - i) * 1000).toISOString(),
        message: {
          role: "assistant",
          content: [{ type: "text", text: `line-${i}` }],
        },
      }));
    }
    writeFileSync(sessionPath, `${lines.join("\n")}\n`);

    const report = runTriage({
      workspace,
      extraArgs: ["--tail-lines", "2", "--window", "1"],
    });

    assert.equal(report.sessionDir, localSessionDir);
    assert.equal(report.sources.sessionDirSource, "local-sandbox");
    assert.equal(report.scanWindow.lineBudget, 2);
    assert.equal(report.scanWindow.truncatedSessions, 1);
    assert.equal(report.sessions.length, 1);
    assert.equal(report.sessions[0].messageCount, 2);
    assert.equal(report.sessions[0].scannedLineCount, 2);
    assert.equal(report.sessions[0].totalLineCount, 5);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
