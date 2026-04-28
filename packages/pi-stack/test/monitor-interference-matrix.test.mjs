import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadMonitor(name) {
  return loadJson(join(process.cwd(), ".pi", "monitors", `${name}.monitor.json`));
}

function loadText(path) {
  return readFileSync(path, "utf8");
}

describe("monitor interference matrix (fragility/hedge/unauthorized)", () => {
  const fragility = loadMonitor("fragility");
  const hedge = loadMonitor("hedge");
  const unauthorized = loadMonitor("unauthorized-action");

  it("maintains reciprocal excludes to reduce overlap churn", () => {
    assert.ok(
      Array.isArray(fragility.classify?.excludes) &&
        fragility.classify.excludes.includes("unauthorized-action"),
      "fragility must exclude unauthorized-action",
    );

    assert.ok(
      Array.isArray(hedge.classify?.excludes) &&
        hedge.classify.excludes.includes("fragility") &&
        hedge.classify.excludes.includes("unauthorized-action"),
      "hedge must exclude fragility and unauthorized-action",
    );

    assert.ok(
      Array.isArray(unauthorized.classify?.excludes) &&
        unauthorized.classify.excludes.includes("fragility") &&
        unauthorized.classify.excludes.includes("hedge"),
      "unauthorized-action must exclude fragility and hedge",
    );
  });

  it("keeps severity bands separated by steering level", () => {
    assert.match(fragility.actions?.on_flag?.steer ?? "", /^\[L2:confirm\]/);
    assert.match(hedge.actions?.on_flag?.steer ?? "", /^\[L1:advisory\]/);
    assert.match(unauthorized.actions?.on_flag?.steer ?? "", /^\[L3:block\]/);
  });

  it("keeps trigger timing staggered across monitor responsibilities", () => {
    assert.equal(fragility.event, "message_end");
    assert.equal(hedge.event, "turn_end");
    assert.equal(unauthorized.event, "tool_call");

    assert.equal(fragility.when, "has_file_writes");
    assert.equal(hedge.when, "has_bash");
    assert.equal(unauthorized.when, "always");
  });

  it("documents anti-overlap guidance in fragility instructions", () => {
    const instructions = loadJson(
      join(process.cwd(), ".pi", "monitors", "fragility.instructions.json"),
    );
    const blob = JSON.stringify(instructions).toLowerCase();

    assert.match(blob, /investigative or reporting-only requests are clean/);
    assert.match(blob, /avoid overlap with unauthorized-action monitor/);
  });

  it("keeps fragility classifier prompt aligned with investigative-clean behavior", () => {
    const classifyPrompt = loadText(
      join(process.cwd(), ".pi", "monitors", "fragility", "classify.md"),
    ).toLowerCase();

    assert.match(classifyPrompt, /investigative/);
    assert.match(classifyPrompt, /observing-and-reporting is not a fragility/);
  });
});
