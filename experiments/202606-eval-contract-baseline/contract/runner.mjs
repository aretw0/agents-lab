/**
 * Run a task against an agent, verifying each attempt; repeat for variance.
 * The agent is any function `(task) => AgentResult | Promise<AgentResult>`,
 * so the runner stays runtime-agnostic (no Pi/Refarm import here).
 * @param {import("./task.mjs").Task} task
 * @param {(task: any) => any} agent
 * @param {object} [opts]
 * @param {number} [opts.repetitions]
 */
export async function runTask(task, agent, { repetitions = 1 } = {}) {
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new Error("repetitions must be a positive integer");
  }
  const outcomes = [];
  for (let attempt = 1; attempt <= repetitions; attempt++) {
    let pass = false;
    let error = null;
    try {
      const result = await agent(task);
      pass = task.verify(result) === true;
    } catch (e) {
      error = String(e?.message ?? e);
    }
    outcomes.push({ attempt, pass, error });
  }
  const passes = outcomes.filter((o) => o.pass).length;
  return { taskId: task.id, tier: task.tier, attempts: repetitions, passes, passRate: passes / repetitions, outcomes };
}
