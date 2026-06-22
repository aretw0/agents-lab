import test from "node:test";
import assert from "node:assert/strict";
import { defineTask } from "../contract/task.mjs";
import { runTask } from "../contract/runner.mjs";
import { fakeAgent } from "./fixtures/fake-agent.mjs";

const helloTask = defineTask({ id: "echo-hello", tier: "T0", instruction: "say hello", verify: (r) => r.output === "hello" });

test("runTask reports a pass when verify succeeds", async () => {
  const result = await runTask(helloTask, fakeAgent("hello"));
  assert.equal(result.taskId, "echo-hello");
  assert.equal(result.tier, "T0");
  assert.equal(result.attempts, 1);
  assert.equal(result.passes, 1);
  assert.equal(result.passRate, 1);
});

test("runTask reports a fail when verify fails", async () => {
  const result = await runTask(helloTask, fakeAgent("goodbye"));
  assert.equal(result.passes, 0);
  assert.equal(result.passRate, 0);
});

test("runTask records a thrown agent as a non-pass with the error", async () => {
  const result = await runTask(helloTask, fakeAgent("hello", { throwOn: "echo-hello" }));
  assert.equal(result.passes, 0);
  assert.match(result.outcomes[0].error, /fake agent failed/);
});

test("runTask computes passRate across repetitions for variance", async () => {
  let n = 0;
  const flaky = () => ({ output: (n++ % 2 === 0) ? "hello" : "miss" });
  const result = await runTask(helloTask, flaky, { repetitions: 4 });
  assert.equal(result.attempts, 4);
  assert.equal(result.passes, 2);
  assert.equal(result.passRate, 0.5);
});

test("runTask rejects an invalid repetitions value", async () => {
  await assert.rejects(() => runTask(helloTask, fakeAgent("hello"), { repetitions: 0 }), /positive integer/);
});
