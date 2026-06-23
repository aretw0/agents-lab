import test from "node:test";
import assert from "node:assert/strict";
import { runTask } from "../contract/runner.mjs";
import { buildReport } from "../contract/report.mjs";
import { createCapabilityProbe } from "../adapters/capability-probe.mjs";
import { ppwTasks, ppwMonitors, ppwProject, ppwWorkflows } from "../tasks/ppw.mjs";

test("ppwTasks lists the three project-workflows capabilities at T1", () => {
  assert.deepEqual(
    ppwTasks.map((t) => t.id),
    ["ppw-monitors", "ppw-project", "ppw-workflows"],
  );
  for (const task of ppwTasks) {
    assert.equal(task.tier, "T1");
    assert.equal(task.env.owner, "@davidorex/pi-project-workflows");
    assert.ok(Array.isArray(task.env.artifacts) && task.env.artifacts.length >= 2);
  }
});

test("each capability resolves with the dep present (baseline)", async () => {
  const probe = createCapabilityProbe();
  for (const task of [ppwMonitors, ppwProject, ppwWorkflows]) {
    const result = await runTask(task, probe);
    assert.equal(result.passes, 1, `${task.id} should resolve with the dep installed`);
    assert.equal(result.passRate, 1);
  }
});

test("the baseline rolls up as a T1 measurement", async () => {
  const probe = createCapabilityProbe();
  const results = [];
  for (const task of ppwTasks) results.push(await runTask(task, probe));
  const report = buildReport(results, { generatedAtIso: "2026-06-23T00:00:00.000Z" });
  assert.deepEqual(report.summary.byTier.T1, { tasks: 3, passes: 3, attempts: 3 });
  assert.equal(report.summary.passRate, 1);
});
