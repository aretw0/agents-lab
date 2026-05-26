import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { checksForProfile, resolveCheck } from "../verify-pi-stack.mjs";

test("resolveCheck accepts alternate dependency paths", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "verify-pi-stack-"));
  const root = path.join(cwd, "node_modules");
  const multiEdit = path.join(root, "mitsupi", "extensions", "multi-edit.ts");

  try {
    mkdirSync(path.dirname(multiEdit), { recursive: true });
    writeFileSync(multiEdit, "export {};\n", "utf8");

    const result = resolveCheck({
      label: "multi-edit",
      paths: ["mitsupi/extensions/multi-edit.ts", "mitsupi/pi-extensions/multi-edit.ts"],
      required: true,
    }, [root]);

    assert.equal(result.ok, true);
    assert.equal(result.found, multiEdit);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("resolveCheck treats curated optional surfaces as non-blocking", () => {
  const result = resolveCheck({
    label: "safe-guard (filtered/optional)",
    paths: ["@ifi/oh-pi-extensions/extensions/safe-guard.ts"],
    required: false,
    missingOk: "curated installs suppress safe-guard",
  }, ["missing-node-modules"]);

  assert.equal(result.ok, true);
  assert.equal(result.optionalMissing, true);
  assert.match(result.missingOk, /curated installs/);
});

test("verify profile defaults to strict-curated without full diagnostic extras", () => {
  const labels = checksForProfile("strict-curated").map((check) => check.label);

  assert.ok(labels.includes("monitors (hedge, fragility, etc.)"));
  assert.ok(!labels.some((label) => label.includes("pi-lens")));
  assert.ok(!labels.some((label) => label.includes("pi-web-access")));
  assert.ok(!labels.some((label) => label.includes("multi-edit")));
});

test("verify stack-full profile includes diagnostic extras", () => {
  const labels = checksForProfile("stack-full").map((check) => check.label);

  assert.ok(labels.some((label) => label.includes("pi-lens")));
  assert.ok(labels.some((label) => label.includes("pi-web-access")));
  assert.ok(labels.some((label) => label.includes("multi-edit")));
});
