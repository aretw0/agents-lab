import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { buildPiHelpDriverStepPayload } from "../agent-run-pi-driver-payload.mjs";

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
