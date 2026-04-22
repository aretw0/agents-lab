import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRemediationCommands,
  classifyTrackedFiles,
  isAllowlistedPiPath,
  normalizeTrackedPath,
} from "../pi-runtime-artifact-audit.mjs";

test("allowlist accepts only curated .pi config paths", () => {
  assert.equal(isAllowlistedPiPath(".pi/settings.json"), true);
  assert.equal(isAllowlistedPiPath(".pi/agents/hedge-classifier.agent.yaml"), true);
  assert.equal(isAllowlistedPiPath(".pi/agent/sessions/a.jsonl"), false);
  assert.equal(isAllowlistedPiPath(".pi/deferred-intents.json"), false);
});

test("classifyTrackedFiles flags sandbox and non-allowlisted .pi artifacts", () => {
  const report = classifyTrackedFiles([
    ".pi/settings.json",
    ".pi/agents/work-quality.agent.yaml",
    ".pi/deferred-intents.json",
    ".pi/agent/sessions/run.jsonl",
    ".sandbox/pi-agent/sessions/abc.jsonl",
    "docs/guides/project-canonical-pipeline.md",
  ]);

  const flagged = report.violations.map((x) => x.path).sort();
  assert.deepEqual(flagged, [
    ".pi/agent/sessions/run.jsonl",
    ".pi/deferred-intents.json",
    ".sandbox/pi-agent/sessions/abc.jsonl",
  ]);
});

test("buildRemediationCommands emits git rm --cached commands", () => {
  const cmds = buildRemediationCommands([
    { path: ".pi/agent/sessions/one.jsonl", reason: "pi-runtime-artifact" },
    { path: ".sandbox/pi-agent/sessions/two.jsonl", reason: "sandbox-runtime-artifact" },
  ]);

  assert.equal(cmds[0], 'git rm --cached -- ".pi/agent/sessions/one.jsonl"');
  assert.equal(cmds[1], 'git rm --cached -- ".sandbox/pi-agent/sessions/two.jsonl"');
  assert.match(cmds[2], /\.gitignore/);
});

test("normalizeTrackedPath normalizes separators and leading ./", () => {
  assert.equal(normalizeTrackedPath("./.pi\\agent\\sessions\\a.jsonl"), ".pi/agent/sessions/a.jsonl");
});
