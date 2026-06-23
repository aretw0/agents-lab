import test from "node:test";
import assert from "node:assert/strict";
import { defineTask } from "../contract/task.mjs";
import { runTask } from "../contract/runner.mjs";
import { createPiAgent } from "../adapters/agent-pi.mjs";
import { fakePiDriver } from "./fixtures/fake-pi-driver.mjs";

const projectTask = defineTask({
  id: "pi-dispatch-ready",
  tier: "T1",
  instruction: "set up the project monitor",
  verify: (r) => r.dispatchAllowed === true,
  env: { model: "task-model", tools: ["bash"] },
});

test("adapter maps instruction->prompt and merges defaults with task.env", async () => {
  const driver = fakePiDriver();
  const agent = createPiAgent({ model: "default-model", mode: "print-readonly", driver });
  await agent(projectTask);
  assert.equal(driver.calls.length, 1);
  const call = driver.calls[0];
  assert.equal(call.prompt, "set up the project monitor");
  assert.equal(call.model, "task-model"); // task.env overrides defaults
  assert.deepEqual(call.tools, ["bash"]);
  assert.equal(call.mode, "print-readonly");
  assert.deepEqual(call.files, []); // default when task.env omits it
  assert.equal(call.fileContract, "read-only"); // default when task.env omits it
});

test("adapter always runs the driver in preview (execute false)", async () => {
  const driver = fakePiDriver();
  const agent = createPiAgent({ driver });
  await agent(projectTask);
  assert.equal(driver.calls[0].execute, false);
  assert.equal(driver.calls[0].approve, false);
});

test("adapter flattens decision fields and keeps the full driver packet", async () => {
  const driver = fakePiDriver({ decision: "ready", dispatchAllowed: true });
  const agent = createPiAgent({ driver });
  const result = await agent(projectTask);
  assert.equal(result.decision, "ready");
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.processStartAllowed, false);
  assert.equal(typeof result.output, "string");
  assert.deepEqual(result.files, {});
  assert.equal(result.driver.mode, "agent-run-pi-driver");
});

test("adapter returns blocked as data, not a throw", async () => {
  const driver = fakePiDriver({ decision: "blocked", dispatchAllowed: false });
  const agent = createPiAgent({ driver });
  const result = await agent(projectTask);
  assert.equal(result.decision, "blocked");
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.output, "pi-driver: decision=blocked"); // summary-absent fallback
});

test("adapter propagates a driver throw (runner records it as a non-pass)", async () => {
  const driver = fakePiDriver({ throwError: true });
  const result = await runTask(projectTask, createPiAgent({ driver }));
  assert.equal(result.passes, 0);
  assert.match(result.outcomes[0].error, /fake pi-driver failed/);
});

test("adapter plugs into runTask and produces a scored result", async () => {
  const driver = fakePiDriver({ dispatchAllowed: true });
  const result = await runTask(projectTask, createPiAgent({ driver }), { repetitions: 3 });
  assert.equal(result.taskId, "pi-dispatch-ready");
  assert.equal(result.tier, "T1");
  assert.equal(result.attempts, 3);
  assert.equal(result.passes, 3);
  assert.equal(result.passRate, 1);
});
