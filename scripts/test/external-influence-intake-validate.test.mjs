import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildExternalInfluenceIntakeValidation,
  parseExternalInfluenceIntake,
  validateExternalInfluenceIntake,
} from "../project/external-influence-intake-validate.mjs";

const CLI_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../project/external-influence-intake-validate.mjs");

function validIntake(overrides = {}) {
  const fields = {
    influence_ref: "example/reference",
    target_scope: "project-general",
    intended_consumer: "external-agent",
    hypothesis: "Improve worker handoff quality.",
    expected_value: "high because it reduces operator glue",
    risk_level: "medium because the source is external",
    effort_level: "low because this is report-only",
    local_safe_prework: "Review local docs and produce task candidates.",
    protected_need: "URL fetch requires explicit source approval.",
    applicable_patterns: "[worker handoff, parent-side fan-in]",
    non_applicable_patterns: "[implicit orchestration]",
    objective: "Validate the reference against local primitives.",
    declared_files: "[docs/primitives/agent-worker-envelope.md, docs/primitives/external-influence-intake-template.md]",
    expected_artifact: ".project/reports/reference-intake.json",
    file_contract: "read-only",
    stop_conditions: "[external execution, unexpected touched files]",
    required_outcomes: "[outcome:reference:intake]",
    pass_when: "artifact exists and outcome is PASS",
    block_when: "[missing artifact, unexpected touched files, external execution]",
    validation_gate: "node scripts/project/board-spec-audit.mjs --json",
    rollback_plan: "No mutation expected.",
    non_goals: "[release, publish, workflow dispatch, implicit recall]",
    recommendation: "promote",
    ...overrides,
  };
  return [
    "### External influence intake",
    ...Object.entries(fields).map(([key, value]) => `- ${key}: ${value}`),
    "",
  ].join("\n");
}

test("external influence intake validation passes complete target-agnostic intake", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "external-influence-intake-"));
  try {
    mkdirSync(path.join(cwd, "docs"), { recursive: true });
    writeFileSync(path.join(cwd, "docs", "intake.md"), validIntake(), "utf8");

    const report = buildExternalInfluenceIntakeValidation({ cwd, file: "docs/intake.md" });

    assert.equal(report.mode, "external-influence-intake-validation");
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.decision, "pass");
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.equal(report.workflowDispatchAllowed, false);
    assert.equal(report.tagAllowed, false);
    assert.equal(report.publishAllowed, false);
    assert.deepEqual(report.blockers, []);
    assert.deepEqual(report.declaredFiles, [
      "docs/primitives/agent-worker-envelope.md",
      "docs/primitives/external-influence-intake-template.md",
    ]);
    assert.deepEqual(report.requiredOutcomes, ["outcome:reference:intake"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("external influence intake validation blocks placeholders and invalid enums", () => {
  const fields = parseExternalInfluenceIntake(validIntake({
    target_scope: "0.8-only",
    intended_consumer: "colony",
    file_contract: "execute",
    recommendation: "auto-run",
    hypothesis: "<placeholder>",
  }));

  const result = validateExternalInfluenceIntake(fields);

  assert.ok(result.blockers.includes("placeholder-field:hypothesis"));
  assert.ok(result.blockers.includes("invalid-target-scope:0.8-only"));
  assert.ok(result.blockers.includes("invalid-intended-consumer:colony"));
  assert.ok(result.blockers.includes("invalid-file-contract:execute"));
  assert.ok(result.blockers.includes("invalid-recommendation:auto-run"));
});

test("external influence intake validation blocks incomplete non-goals", () => {
  const result = validateExternalInfluenceIntake(parseExternalInfluenceIntake(validIntake({
    non_goals: "[release]",
  })));

  assert.ok(result.blockers.includes("missing-non-goal:publish"));
  assert.ok(result.blockers.includes("missing-non-goal:workflow dispatch"));
  assert.ok(result.blockers.includes("missing-non-goal:implicit recall"));
});

test("external influence intake validation cli emits pass json with zero exit", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "external-influence-intake-cli-"));
  try {
    mkdirSync(path.join(cwd, "docs"), { recursive: true });
    writeFileSync(path.join(cwd, "docs", "intake.md"), validIntake(), "utf8");

    const result = spawnSync(process.execPath, [CLI_PATH, "--file", "docs/intake.md", "--json"], {
      cwd,
      encoding: "utf8",
    });

    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    const report = JSON.parse(result.stdout);
    assert.equal(report.mode, "external-influence-intake-validation");
    assert.equal(report.decision, "pass");
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.processStartAllowed, false);
    assert.equal(report.workflowDispatchAllowed, false);
    assert.deepEqual(report.blockers, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("external influence intake validation cli exits nonzero with block json", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "external-influence-intake-cli-"));
  try {
    mkdirSync(path.join(cwd, "docs"), { recursive: true });
    writeFileSync(path.join(cwd, "docs", "intake.md"), validIntake({
      hypothesis: "<placeholder>",
      recommendation: "auto-run",
    }), "utf8");

    const result = spawnSync(process.execPath, [CLI_PATH, "--file", "docs/intake.md", "--json"], {
      cwd,
      encoding: "utf8",
    });

    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    const report = JSON.parse(result.stdout);
    assert.equal(report.mode, "external-influence-intake-validation");
    assert.equal(report.decision, "block");
    assert.ok(report.blockers.includes("placeholder-field:hypothesis"));
    assert.ok(report.blockers.includes("invalid-recommendation:auto-run"));
    assert.equal(report.dispatchAllowed, false);
    assert.equal(report.publishAllowed, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
