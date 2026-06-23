import process from "node:process";
import { runPiDriver } from "../../../scripts/agent-run-pi-driver.mjs";

/**
 * Build an eval-contract agent backed by Pi, driven headlessly through
 * scripts/agent-run-pi-driver.mjs. Returns a `(task) => AgentResult` function
 * that the runtime-agnostic runner can drive — the runner never imports Pi.
 *
 * Defaults to the driver's PREVIEW path (execute:false), so the measurement is
 * deterministic and CI-safe: a capability task verifies that Pi WOULD dispatch
 * (decision/dispatchAllowed), not live model output. Real `--execute --approve`
 * runs are an opt-in cold path (see EVAL_PI_LIVE in the README).
 *
 * @param {object} [defaults]
 * @param {string} [defaults.model]
 * @param {string} [defaults.mode] - default "print-readonly"
 * @param {string} [defaults.fileContract] - default "read-only"
 * @param {string[]} [defaults.tools]
 * @param {string[]} [defaults.files]
 * @param {string} [defaults.cwd]
 * @param {(options: object) => Promise<object>} [defaults.driver] - injectable, defaults to runPiDriver
 * @returns {(task: import("../contract/task.mjs").Task) => Promise<object>}
 */
export function createPiAgent(defaults = {}) {
  const { driver = runPiDriver, ...baseEnv } = defaults;
  return async (task) => {
    const env = { ...baseEnv, ...(task.env ?? {}) }; // per-task env overrides defaults
    const result = await driver({
      cwd: env.cwd ?? process.cwd(),
      mode: env.mode ?? "print-readonly",
      prompt: task.instruction,
      model: env.model ?? "",
      tools: env.tools ?? [],
      files: env.files ?? [],
      fileContract: env.fileContract ?? "read-only",
      execute: false,
      approve: false,
    });
    return {
      output: result.summary ?? `pi-driver: decision=${result.decision}`,
      files: {},
      decision: result.decision,
      dispatchAllowed: result.dispatchAllowed === true,
      processStartAllowed: result.processStartAllowed === true,
      driver: result,
    };
  };
}
