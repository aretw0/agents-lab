import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTask } from "../contract/task.mjs";
import { createCapabilityProbe } from "../adapters/capability-probe.mjs";

function withTmpRoot(run) {
  const dir = mkdtempSync(join(tmpdir(), "cap-probe-"));
  try {
    writeFileSync(join(dir, "present.txt"), "ok");
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const mkTask = (artifacts) =>
  defineTask({ id: "cap-x", tier: "T1", instruction: "i", verify: (r) => r.resolved === true, env: { artifacts } });

test("probe resolves when every artifact exists", () => {
  withTmpRoot((dir) => {
    const probe = createCapabilityProbe({ roots: ["."], cwd: dir });
    const result = probe(mkTask(["present.txt"]));
    assert.equal(result.resolved, true);
    assert.equal(result.artifacts[0].found, true);
    assert.deepEqual(result.files, {});
  });
});

test("probe is unresolved when any artifact is missing", () => {
  withTmpRoot((dir) => {
    const probe = createCapabilityProbe({ roots: ["."], cwd: dir });
    const result = probe(mkTask(["present.txt", "missing.txt"]));
    assert.equal(result.resolved, false);
    assert.equal(result.artifacts[0].found, true);
    assert.equal(result.artifacts[1].found, false);
    assert.match(result.output, /1\/2/);
  });
});

test("probe treats an empty surface as unresolved (no vacuous pass)", () => {
  withTmpRoot((dir) => {
    const probe = createCapabilityProbe({ roots: ["."], cwd: dir });
    assert.equal(probe(mkTask([])).resolved, false);
  });
});

test("probe treats a task without env as unresolved, not a crash", () => {
  withTmpRoot((dir) => {
    const probe = createCapabilityProbe({ roots: ["."], cwd: dir });
    const task = defineTask({ id: "no-env", tier: "T1", instruction: "i", verify: () => true });
    assert.equal(probe(task).resolved, false);
  });
});

test("probe searches multiple roots in order", () => {
  withTmpRoot((dir) => {
    const probe = createCapabilityProbe({ roots: ["does-not-exist", "."], cwd: dir });
    assert.equal(probe(mkTask(["present.txt"])).resolved, true);
  });
});
