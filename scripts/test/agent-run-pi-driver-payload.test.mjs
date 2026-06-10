import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import {
  buildPiDriverStepPayload,
  buildPiHelpDriverStepPayload,
  buildPiPrintReadonlyDriverStepPayload,
} from "../agent-run-pi-driver-payload.mjs";

test("builds a headless driver-step payload for local pi help", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-driver-payload-"));
  const cliPath = path.join(cwd, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  mkdirSync(path.dirname(cliPath), { recursive: true });
  writeFileSync(cliPath, "console.log('help')\n", "utf8");

  const result = buildPiHelpDriverStepPayload({ cwd, runId: "pi-help-smoke" });

  assert.equal(result.mode, "agent-run-pi-driver-payload");
  assert.equal(result.decision, "ready-for-driver-step");
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.processStartAllowed, false);
  assert.equal(result.payload.run_spec.run_id, "pi-help-smoke");
  assert.equal(result.payload.run_spec.provider_model_ref, "local/pi-cli");
  assert.equal(result.payload.run_spec.file_contract, "read-only");
  assert.equal(result.payload.run_spec.execution_preview.command, process.execPath);
  assert.deepEqual(result.payload.run_spec.execution_preview.args, [cliPath, "--help"]);
});

test("blocks when local pi cli is missing", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-driver-payload-missing-"));
  const result = buildPiHelpDriverStepPayload({ cwd, runId: "pi-help-missing" });

  assert.equal(result.decision, "blocked");
  assert.equal(result.dispatchAllowed, false);
  assert.ok(result.blockers.includes("local-pi-cli-missing"));
});

test("builds a help payload with mutation file contract when requested", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-driver-payload-help-mutation-"));
  const cliPath = path.join(cwd, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  mkdirSync(path.dirname(cliPath), { recursive: true });
  writeFileSync(cliPath, "console.log('help')\n", "utf8");

  const result = buildPiHelpDriverStepPayload({
    cwd,
    runId: "pi-help-mutation-smoke",
    fileContract: "mutation",
  });

  assert.equal(result.decision, "ready-for-driver-step");
  assert.equal(result.payload.run_spec.file_contract, "mutation");
});

test("builds a print-readonly payload with isolated pi flags", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-driver-print-"));
  const cliPath = path.join(cwd, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  mkdirSync(path.dirname(cliPath), { recursive: true });
  writeFileSync(cliPath, "console.log('pi')\n", "utf8");

  const result = buildPiPrintReadonlyDriverStepPayload({
    cwd,
    runId: "pi-print-readonly-smoke",
    model: "local/test-model",
    files: ["README.md"],
    prompt: "Return PASS.",
  });

  assert.equal(result.decision, "ready-for-driver-step");
  assert.equal(result.payloadMode, "print-readonly");
  assert.equal(result.payload.run_spec.provider_model_ref, "local/test-model");
  assert.equal(result.payload.run_spec.file_contract, "read-only");
  assert.deepEqual(result.payload.run_spec.declared_files, ["README.md"]);
  assert.deepEqual(result.payload.run_spec.execution_preview.args, [
    cliPath,
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--model",
    "local/test-model",
    "--tools",
    "read,grep,find,ls",
    "--print",
    "@README.md",
    "Return PASS.",
  ]);
});

test("builds a print payload with mutation file contract when requested", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-driver-print-mutation-"));
  const cliPath = path.join(cwd, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  mkdirSync(path.dirname(cliPath), { recursive: true });
  writeFileSync(cliPath, "console.log('pi')\n", "utf8");

  const result = buildPiPrintReadonlyDriverStepPayload({
    cwd,
    runId: "pi-print-mutation-smoke",
    model: "local/test-model",
    files: ["README.md"],
    prompt: "Apply scoped change.",
    fileContract: "mutation",
  });

  assert.equal(result.decision, "ready-for-driver-step");
  assert.equal(result.payload.run_spec.file_contract, "mutation");
});

test("blocks incomplete print-readonly payloads", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-driver-print-blocked-"));
  const cliPath = path.join(cwd, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  mkdirSync(path.dirname(cliPath), { recursive: true });
  writeFileSync(cliPath, "console.log('pi')\n", "utf8");

  const result = buildPiPrintReadonlyDriverStepPayload({ cwd, runId: "pi-print-blocked" });

  assert.equal(result.decision, "blocked");
  assert.ok(result.blockers.includes("model-missing"));
  assert.ok(result.blockers.includes("prompt-missing"));
  assert.ok(result.blockers.includes("declared-files-missing"));
});

test("blocks print-readonly prompts that look like flags", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-driver-print-leading-dash-"));
  const cliPath = path.join(cwd, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  mkdirSync(path.dirname(cliPath), { recursive: true });
  writeFileSync(cliPath, "console.log('pi')\n", "utf8");

  const result = buildPiPrintReadonlyDriverStepPayload({
    cwd,
    runId: "pi-print-leading-dash",
    model: "local/test-model",
    files: ["README.md"],
    prompt: "--looks-like-a-flag",
  });

  assert.equal(result.decision, "blocked");
  assert.ok(result.blockers.includes("prompt-leading-dash"));
});

test("dispatches builder by payload mode", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-driver-mode-"));
  const cliPath = path.join(cwd, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  mkdirSync(path.dirname(cliPath), { recursive: true });
  writeFileSync(cliPath, "console.log('pi')\n", "utf8");

  const help = buildPiDriverStepPayload({ cwd, mode: "help", runId: "mode-help" });
  const printReadonly = buildPiDriverStepPayload({
    cwd,
    mode: "print-readonly",
    runId: "mode-print",
    model: "local/test-model",
    files: ["@README.md"],
    prompt: "Return PASS.",
  });
  const unsupported = buildPiDriverStepPayload({ cwd, mode: "unknown" });

  assert.equal(help.decision, "ready-for-driver-step");
  assert.equal(printReadonly.payload.run_spec.declared_files[0], "README.md");
  assert.equal(unsupported.decision, "blocked");
  assert.ok(unsupported.blockers.includes("unsupported-payload-mode:unknown"));
});
