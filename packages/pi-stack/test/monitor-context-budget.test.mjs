import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const MONITOR_NAMES = [
  "commit-hygiene",
  "fragility",
  "hedge",
  "unauthorized-action",
  "work-quality",
];

const WEIGHTS = {
  user_text: 8,
  assistant_text: 8,
  tool_calls: 10,
  custom_messages: 10,
  tool_results: 34,
  project_vision: 20,
  project_conventions: 20,
  conversation_history: 80,
};

const BUDGET_BY_MONITOR = {
  "commit-hygiene": 30,
  fragility: 80,
  hedge: 40,
  "unauthorized-action": 40,
  "work-quality": 90,
};

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadMonitor(name) {
  const path = join(process.cwd(), ".pi", "monitors", `${name}.monitor.json`);
  return loadJson(path);
}

function contextScore(context) {
  return (Array.isArray(context) ? context : []).reduce(
    (acc, key) => acc + (WEIGHTS[key] ?? 12),
    0,
  );
}

describe("monitor context budget", () => {
  it("keeps classify contexts bounded by monitor budget", () => {
    for (const name of MONITOR_NAMES) {
      const monitor = loadMonitor(name);
      const context = monitor?.classify?.context ?? [];
      const score = contextScore(context);
      const budget = BUDGET_BY_MONITOR[name];

      assert.ok(
        score <= budget,
        `${name} score ${score} exceeded budget ${budget} (context=${JSON.stringify(context)})`,
      );
    }
  });

  it("forbids conversation_history in default monitor contexts", () => {
    for (const name of MONITOR_NAMES) {
      const monitor = loadMonitor(name);
      const context = monitor?.classify?.context ?? [];
      assert.ok(
        !context.includes("conversation_history"),
        `${name} must not include conversation_history by default`,
      );
    }
  });

  it("restricts project_* context to work-quality only", () => {
    for (const name of MONITOR_NAMES) {
      const monitor = loadMonitor(name);
      const context = monitor?.classify?.context ?? [];
      const hasProjectContext =
        context.includes("project_vision") ||
        context.includes("project_conventions");

      if (name === "work-quality") {
        assert.ok(hasProjectContext, "work-quality should include project context");
      } else {
        assert.ok(!hasProjectContext, `${name} should not include project context`);
      }
    }
  });

  it("keeps fragility prefiltered away from tool_results payloads", () => {
    const monitor = loadMonitor("fragility");
    const context = monitor?.classify?.context ?? [];
    assert.ok(
      !context.includes("tool_results"),
      "fragility should not include tool_results by default",
    );
  });
});

describe("fragility anti-false-positive calibration", () => {
  it("documents investigative/reporting turns as CLEAN when findings are communicated", () => {
    const instructionsPath = join(
      process.cwd(),
      ".pi",
      "monitors",
      "fragility.instructions.json",
    );
    const classifyPath = join(
      process.cwd(),
      ".pi",
      "monitors",
      "fragility",
      "classify.md",
    );

    const instructions = loadJson(instructionsPath);
    const classifyText = readFileSync(classifyPath, "utf8");

    const instructionBlob = JSON.stringify(instructions);
    assert.match(
      instructionBlob,
      /Investigative or reporting-only requests are CLEAN when findings are clearly reported/i,
    );
    assert.match(classifyText, /investigative/i);
    assert.match(classifyText, /observing-and-reporting is not a fragility/i);
  });

  it("guards empty-response pattern against monitor-feedback hallucinations", () => {
    const classifyPath = join(
      process.cwd(),
      ".pi",
      "monitors",
      "fragility",
      "classify.md",
    );
    const classifyText = readFileSync(classifyPath, "utf8");

    assert.match(
      classifyText,
      /only classify empty-output fragility when assistant_text is actually empty/i,
    );
    assert.match(
      classifyText,
      /automated monitor feedback.*not.*evidence/i,
    );
    assert.match(
      classifyText,
      /substantive non-whitespace content.*do not flag empty-output fragility/i,
    );
  });
});
