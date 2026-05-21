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

test("classifyDiscourseText ignores generated package guide copies", () => {
  const findings = classifyDiscourseText(
    "packages/lab-skills/docs/guides/control-plane-operating-doctrine.md",
    "human approval in generated copy",
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

test("classifyDiscourseText ignores legacy terms inside inline code", () => {
  const findings = classifyDiscourseText(
    "docs/guides/control-plane-operating-doctrine.md",
    "`ready-for-human-decision` and `human-confirmation-evidence` are runtime ids.",
  );

  assert.equal(findings.length, 0);
});

test("classifyDiscourseText ignores legacy terms inside fenced code", () => {
  const findings = classifyDiscourseText(
    "docs/guides/control-plane-operating-doctrine.md",
    [
      "```text",
      "packet=ready-for-human-decision reasons=human-confirmation-missing",
      "```",
    ].join("\n"),
  );

  assert.equal(findings.length, 0);
});

test("classifyDiscourseText reports deprecated local slice human contract alias inside inline code", () => {
  const findings = classifyDiscourseText(
    "docs/primitives/nudge-free-local-continuity.md",
    "`local_slice_human_contract_review` should not return to public primitive docs.",
  );

  assert.deepEqual(findings.map((finding) => finding.rule), ["deprecated-local-slice-human-contract"]);
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


test("classifyDiscourseText reports speculative control-plane aliases", () => {
  const findings = classifyDiscourseText(
    "docs/guides/control-plane-evolution-playbook.md",
    "Contrato de operação do coordenador queen-of-queens.",
  );

  assert.deepEqual(findings.map((finding) => finding.rule), ["speculative-control-plane-alias"]);
});

test("classifyDiscourseText reports self-congratulatory claims", () => {
  const findings = classifyDiscourseText(
    "docs/guides/control-plane-glossary.md",
    "Uma experiência world-class e incrível para liberar o potencial da jornada.",
  );

  assert.deepEqual(findings.map((finding) => finding.rule), ["self-congratulatory-claim"]);
});

test("classifyDiscourseText scans the root README as public surface", () => {
  const findings = classifyDiscourseText(
    "README.md",
    "Uma experiencia incrivel para human-in-the-loop.",
  );

  assert.deepEqual(findings.map((finding) => finding.rule), [
    "legacy-human-term",
    "self-congratulatory-claim",
  ]);
});

test("classifyDiscourseText keeps the public 0.8 map free of release slogans", () => {
  const findings = classifyDiscourseText(
    "docs/research/0-8-readiness-map.md",
    "A release incrível é o estado da arte para liberar o potencial da jornada.",
  );

  assert.deepEqual(findings.map((finding) => finding.rule), ["self-congratulatory-claim"]);
});

test("classifyDiscourseText reports stale CI failure claims in public docs", () => {
  const findings = classifyDiscourseText(
    "docs/research/0-8-readiness-map.md",
    "GitHub Actions está falhando e precisa coesão com gates locais.",
  );

  assert.deepEqual(findings.map((finding) => finding.rule), ["stale-ci-failure-claim"]);
});
