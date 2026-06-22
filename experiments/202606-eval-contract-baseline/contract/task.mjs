/**
 * Capability tier ladder (basic -> advanced).
 * T0 single-tool/single-file deterministic; T1 multi-step single-agent;
 * T2 orchestration/guardrails; T3 multi-modal interaction.
 */
export const TIERS = ["T0", "T1", "T2", "T3"];

/**
 * @typedef {object} AgentResult
 * @property {string} output
 * @property {Record<string, string>} [files]
 *
 * @typedef {object} Task
 * @property {string} id
 * @property {string} tier
 * @property {string} instruction
 * @property {(r: AgentResult) => boolean} verify
 */

/** Validate and normalize a Task. Throws on invalid input. @returns {Task} */
export function defineTask({ id, tier, instruction, verify } = {}) {
  if (typeof id !== "string" || id.length === 0) throw new Error("task.id is required");
  if (!TIERS.includes(tier)) throw new Error(`task.tier must be one of ${TIERS.join(", ")}`);
  if (typeof instruction !== "string" || instruction.length === 0) throw new Error("task.instruction is required");
  if (typeof verify !== "function") throw new Error("task.verify must be a function");
  return { id, tier, instruction, verify };
}
