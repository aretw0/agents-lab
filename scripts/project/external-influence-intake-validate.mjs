#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;

const REQUIRED_FIELDS = [
  "influence_ref",
  "target_scope",
  "intended_consumer",
  "hypothesis",
  "expected_value",
  "risk_level",
  "effort_level",
  "local_safe_prework",
  "protected_need",
  "applicable_patterns",
  "non_applicable_patterns",
  "objective",
  "declared_files",
  "expected_artifact",
  "file_contract",
  "stop_conditions",
  "required_outcomes",
  "pass_when",
  "block_when",
  "validation_gate",
  "rollback_plan",
  "non_goals",
  "recommendation",
];

const TARGET_SCOPES = new Set(["current-target", "future-target", "post-target", "project-general"]);
const INTENDED_CONSUMERS = new Set(["pi-stack", "refarm", "external-agent", "docs-only", "other"]);
const FILE_CONTRACTS = new Set(["read-only", "mutation"]);
const RECOMMENDATIONS = new Set(["promote", "skip", "defer"]);

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    file: "",
    json: false,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file") out.file = argv[++index] ?? "";
    else if (arg === "--json") out.json = true;
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function fieldValue(markdown, field) {
  const match = markdown.match(new RegExp(`^\\s*-\\s*${field}:\\s*(.*)$`, "mi"));
  return match ? String(match[1] ?? "").trim() : "";
}

function hasPlaceholder(value) {
  return /<[^>]+>/.test(value);
}

function parseListValue(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseExternalInfluenceIntake(markdown) {
  const fields = {};
  for (const field of REQUIRED_FIELDS) fields[field] = fieldValue(markdown, field);
  return fields;
}

export function validateExternalInfluenceIntake(fields) {
  const blockers = [];
  const warnings = [];

  for (const field of REQUIRED_FIELDS) {
    if (!fields[field]) blockers.push(`missing-field:${field}`);
    else if (hasPlaceholder(fields[field])) blockers.push(`placeholder-field:${field}`);
  }

  if (fields.target_scope && !TARGET_SCOPES.has(fields.target_scope)) blockers.push(`invalid-target-scope:${fields.target_scope}`);
  if (fields.intended_consumer && !INTENDED_CONSUMERS.has(fields.intended_consumer)) blockers.push(`invalid-intended-consumer:${fields.intended_consumer}`);
  if (fields.file_contract && !FILE_CONTRACTS.has(fields.file_contract)) blockers.push(`invalid-file-contract:${fields.file_contract}`);
  if (fields.recommendation && !RECOMMENDATIONS.has(fields.recommendation)) blockers.push(`invalid-recommendation:${fields.recommendation}`);

  for (const field of ["expected_value", "risk_level", "effort_level"]) {
    const value = fields[field] ?? "";
    if (value && !/^(high|medium|low)\b/.test(value)) blockers.push(`invalid-level:${field}:${value}`);
  }

  const declaredFiles = parseListValue(fields.declared_files ?? "");
  if (fields.declared_files && declaredFiles.length === 0) blockers.push("declared-files-empty-or-invalid");

  const requiredOutcomes = parseListValue(fields.required_outcomes ?? "");
  if (fields.required_outcomes && requiredOutcomes.length === 0) blockers.push("required-outcomes-empty-or-invalid");

  const nonGoals = (fields.non_goals ?? "").toLowerCase();
  for (const requiredNonGoal of ["release", "publish", "workflow dispatch", "implicit recall"]) {
    if (nonGoals && !nonGoals.includes(requiredNonGoal)) blockers.push(`missing-non-goal:${requiredNonGoal}`);
  }

  const blockWhen = (fields.block_when ?? "").toLowerCase();
  for (const requiredBlocker of ["missing artifact", "unexpected touched files", "external execution"]) {
    if (blockWhen && !blockWhen.includes(requiredBlocker)) warnings.push(`recommended-blocker-missing:${requiredBlocker}`);
  }

  return {
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    declaredFiles,
    requiredOutcomes,
  };
}

export function buildExternalInfluenceIntakeValidation(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const file = String(options.file ?? "");
  const blockers = [];

  if (!file) blockers.push("file-missing");
  const fullPath = file ? path.resolve(cwd, file) : "";
  if (fullPath && !existsSync(fullPath)) blockers.push(`file-not-found:${file}`);

  const markdown = blockers.length === 0 ? readFileSync(fullPath, "utf8") : "";
  const fields = parseExternalInfluenceIntake(markdown);
  const validation = validateExternalInfluenceIntake(fields);
  blockers.push(...validation.blockers);

  const decision = blockers.length === 0 ? "pass" : "block";
  return {
    mode: "external-influence-intake-validation",
    schemaVersion: SCHEMA_VERSION,
    decision,
    dispatchAllowed: false,
    processStartAllowed: false,
    workflowDispatchAllowed: false,
    tagAllowed: false,
    publishAllowed: false,
    file,
    fields,
    declaredFiles: validation.declaredFiles,
    requiredOutcomes: validation.requiredOutcomes,
    blockers,
    warnings: validation.warnings,
    summary: `external-influence-intake-validation: decision=${decision} blockers=${blockers.length} dispatch=no`,
  };
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/project/external-influence-intake-validate.mjs --file PATH [--json] [--pretty]",
    "",
    "Validates a target-agnostic external influence intake Markdown file.",
    "This is report-only and never fetches URLs, dispatches workers, publishes, tags, or starts processes.",
  ].join("\n") + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let args;
  try {
    args = parseArgs();
  } catch (error) {
    process.stderr.write(`${String(error?.message ?? error)}\n`);
    process.exit(2);
  }
  if (args.help) {
    printHelp();
  } else {
    const report = buildExternalInfluenceIntakeValidation(args);
    process.stdout.write(args.json ? JSON.stringify(report, null, args.pretty ? 2 : 0) : `${report.summary}\n`);
    if (args.json) process.stdout.write("\n");
    if (report.decision === "block") process.exit(1);
  }
}
