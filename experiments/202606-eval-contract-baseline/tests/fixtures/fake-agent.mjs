/**
 * Deterministic fake agent for harness tests.
 * Returns a fixed output, or throws if `throwOn` matches the task id.
 * @param {string} output
 * @param {object} [opts]
 * @param {string} [opts.throwOn]
 */
export function fakeAgent(output, { throwOn } = {}) {
  return (task) => {
    if (throwOn && task.id === throwOn) throw new Error(`fake agent failed on ${task.id}`);
    return { output };
  };
}
