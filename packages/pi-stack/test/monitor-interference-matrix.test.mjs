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

  it("keeps authorization monitors context-aware but bounded", () => {
    assert.ok(
      hedge.classify?.context?.includes("conversation_history"),
      "hedge needs bounded history to avoid stale intent false positives",
    );
    assert.ok(
      unauthorized.classify?.context?.includes("conversation_history"),
      "unauthorized-action needs bounded history before L3 blocking",
    );
  });

  it("documents anti-overlap and critical-only blocker guidance", () => {
    const fragilityInstructions = loadJson(
      join(process.cwd(), ".pi", "monitors", "fragility.instructions.json"),
    );
    const unauthorizedInstructions = loadJson(
      join(process.cwd(), ".pi", "monitors", "unauthorized-action.instructions.json"),
    );
    const fragilityBlob = JSON.stringify(fragilityInstructions).toLowerCase();
    const unauthorizedBlob = JSON.stringify(unauthorizedInstructions).toLowerCase();

    assert.match(fragilityBlob, /investigative or reporting-only requests are clean/);
    assert.match(fragilityBlob, /avoid overlap with unauthorized-action monitor/);
    assert.match(unauthorizedBlob, /l3 blocker must fail closed only for concrete critical risk/);
    assert.match(unauthorizedBlob, /absence of the exact phrase 'explicit authorization' is not enough/);
  });

  it("keeps classifier prompts aligned with calibrated responsibilities", () => {
    const fragilityPrompt = loadText(
      join(process.cwd(), ".pi", "monitors", "fragility", "classify.md"),
    ).toLowerCase();
    const unauthorizedPrompt = loadText(
      join(process.cwd(), ".pi", "monitors", "unauthorized-action", "classify.md"),
    ).toLowerCase();

    assert.match(fragilityPrompt, /investigative/);
    assert.match(fragilityPrompt, /observing-and-reporting is not a fragility/);
    assert.match(unauthorizedPrompt, /prior conversation context/);
    assert.match(unauthorizedPrompt, /flag only concrete critical risk/);
  });
});
