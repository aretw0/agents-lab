import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const DEFAULT_ROOTS = ["packages/pi-stack/node_modules", "node_modules"];

/**
 * Build an eval-contract agent that measures whether a capability's declared
 * surface resolves on disk. A task lists its required artifacts in env.artifacts
 * (paths relative to a node_modules root); the probe reports whether all resolve.
 * Deterministic and offline — no Pi import. Absence is data, never a throw.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.roots] - node_modules roots, searched in order
 * @param {string} [opts.cwd] - base dir the roots resolve against
 * @returns {(task: import("../contract/task.mjs").Task) => object}
 */
export function createCapabilityProbe({ roots = DEFAULT_ROOTS, cwd = process.cwd() } = {}) {
  return (task) => {
    const artifacts = task.env?.artifacts ?? [];
    const checked = artifacts.map((rel) => ({
      path: rel,
      found: roots.some((r) => existsSync(join(cwd, r, rel))),
    }));
    // empty surface never counts as a capability (guards a vacuous pass)
    const resolved = checked.length > 0 && checked.every((a) => a.found);
    const foundCount = checked.filter((a) => a.found).length;
    return {
      output: `capability ${task.id}: ${resolved ? "resolved" : "unresolved"} (${foundCount}/${checked.length})`,
      files: {},
      resolved,
      artifacts: checked,
    };
  };
}
