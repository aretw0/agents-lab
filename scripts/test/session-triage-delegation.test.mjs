import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = path.resolve("scripts/session-triage.mjs");

function runTriage({ workspace, eventsPath }) {
  const result = spawnSync(process.execPath, [
    SCRIPT,
    "--workspace",
    workspace,
    "--days",
    "30",
    "--limit",
    "1",
    "--events",
    eventsPath,
    "--json",
    "--no-summary-store",
  ], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
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
