import test from "node:test";
import assert from "node:assert/strict";
import { defineTask, TIERS } from "../contract/task.mjs";

test("defineTask returns a normalized task for valid input", () => {
  const task = defineTask({ id: "echo-hello", tier: "T0", instruction: "say hello", verify: (r) => r.output === "hello" });
  assert.equal(task.id, "echo-hello");
  assert.equal(task.tier, "T0");
  assert.equal(typeof task.verify, "function");
});

test("defineTask rejects an unknown tier", () => {
  assert.throws(() => defineTask({ id: "x", tier: "T9", instruction: "i", verify: () => true }), /tier must be one of/);
});

test("defineTask rejects a missing verify function", () => {
  assert.throws(() => defineTask({ id: "x", tier: "T0", instruction: "i" }), /verify must be a function/);
});

test("TIERS lists the basic-to-advanced ladder", () => {
  assert.deepEqual(TIERS, ["T0", "T1", "T2", "T3"]);
});
