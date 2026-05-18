import test from "node:test";
import assert from "node:assert/strict";

import { classifyDiscourseText } from "../repo-discourse-audit.mjs";

test("classifyDiscourseText ignores historical research data", () => {
  const findings = classifyDiscourseText(
    "docs/research/data/session-triage/sample.json",
    JSON.stringify({ note: "human factory engine" }),
  );

  assert.equal(findings.length, 0);
});

test("classifyDiscourseText reports legacy human terminology in canonical docs", () => {
  const findings = classifyDiscourseText(
    "docs/guides/control-plane-glossary.md",
    "Decision packet for human approval.",
  );

  assert.deepEqual(findings.map((finding) => finding.rule), ["legacy-human-term"]);
});

test("classifyDiscourseText reports aspirational language in canonical docs", () => {
  const findings = classifyDiscourseText(
    "docs/primitives/example.md",
    "Este é o farol da maturidade plena.",
  );

  assert.deepEqual(findings.map((finding) => finding.rule), ["aspirational-release-claim"]);
});

test("classifyDiscourseText reports uppercase semantic labels", () => {
  const findings = classifyDiscourseText(
    "packages/pi-stack/extensions/guardrails-core.ts",
    "const mode = 'PRAGMATIC';",
  );

  assert.deepEqual(findings.map((finding) => finding.rule), ["loaded-pragmatic-label"]);
});
