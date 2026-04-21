import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("commit-hygiene calibration", () => {
  const monitor = loadJson(
    join(process.cwd(), ".pi", "monitors", "commit-hygiene.monitor.json"),
  );
  const instructions = loadJson(
    join(process.cwd(), ".pi", "monitors", "commit-hygiene.instructions.json"),
  );
  const classifyPrompt = readFileSync(
    join(process.cwd(), ".pi", "monitors", "commit-hygiene", "classify.md"),
    "utf8",
  );

  it("keeps advisory-only trigger semantics", () => {
    assert.equal(monitor.event, "agent_end");
    assert.equal(monitor.when, "has_file_writes");
    assert.equal(monitor.ceiling, 2);
    assert.match(monitor.actions?.on_flag?.steer ?? "", /^\[L1:advisory\]/);
  });

  it("keeps context lean for low token overhead", () => {
    const context = monitor.classify?.context ?? [];
    assert.deepEqual(context, ["tool_calls", "assistant_text", "user_text"]);
    assert.ok(!context.includes("tool_results"), "commit-hygiene should avoid tool_results context");
    assert.ok(!context.includes("conversation_history"), "commit-hygiene should avoid conversation_history context");
  });

  it("documents clean deferral for exploratory runs and ephemeral writes", () => {
    const blob = JSON.stringify(instructions).toLowerCase();
    assert.match(blob, /advisory only/);
    assert.match(blob, /exploratory|investigative|calibration/);
    assert.match(blob, /ephemeral|ignored runtime paths/);
    assert.match(blob, /\.sandbox\//);
  });

  it("classifier prompt includes explicit noise filters", () => {
    const text = classifyPrompt.toLowerCase();
    assert.match(text, /important noise filter/);
    assert.match(text, /ephemeral\/ignored runtime paths/);
    assert.match(text, /calibration\/investigation workflow updates without commit as clean/);
  });
});
