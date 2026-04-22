import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = resolve("scripts/pi-parity.mjs");

function withTempProject(fn) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-parity-curation-"));
  try {
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    return fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("pi-parity classifies official/opt-in/non-permitted for curated-default", () => {
  withTempProject((cwd) => {
    writeFileSync(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify(
        {
          packages: [
            "npm:@aretw0/pi-stack",
            "npm:mitsupi",
            "npm:@acme/pi-experimental",
          ],
        },
        null,
        2,
      ),
    );

    const run = spawnSync(
      process.execPath,
      [SCRIPT, "--scope", "project", "--profile", "curated-default", "--json"],
      { cwd, encoding: "utf8" },
    );

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const payload = JSON.parse(run.stdout);
    const result = payload.results[0];

    assert.ok(Array.isArray(result.classification.official.missing));
    assert.ok(result.classification.official.missing.length > 0);
    assert.ok(result.classification.optIn.managed.includes("mitsupi"));
    assert.ok(result.classification.nonPermitted.packages.includes("@acme/pi-experimental"));
    assert.ok(Array.isArray(result.remediation));
    assert.ok(result.remediation.length > 0);
  });
});

test("pi-parity --strict blocks curated-default on non-permitted items", () => {
  withTempProject((cwd) => {
    writeFileSync(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify(
        {
          packages: ["npm:@aretw0/pi-stack", "npm:@acme/pi-experimental"],
        },
        null,
        2,
      ),
    );

    const run = spawnSync(
      process.execPath,
      [SCRIPT, "--scope", "project", "--profile", "curated-default", "--strict"],
      { cwd, encoding: "utf8" },
    );

    assert.equal(run.status, 1, run.stderr || run.stdout);
  });
});
