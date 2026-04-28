import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const PROFILE_NAMES = ["balanced", "exploratory", "strict"];
const EXPECTED_MONITORS = [
  "commit-hygiene",
  "fragility",
  "hedge",
  "unauthorized-action",
  "work-quality",
].sort();
const VALID_MODES = new Set(["L1", "L2", "L3-critical-only"]);

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadProfile(name) {
  return loadJson(join(process.cwd(), ".pi", "monitors", "profiles", `${name}.json`));
}

function loadMonitor(name) {
  return loadJson(join(process.cwd(), ".pi", "monitors", `${name}.monitor.json`));
}

function inferModeFromSteer(steer) {
  if (typeof steer !== "string") return undefined;
  if (steer.startsWith("[L1:")) return "L1";
  if (steer.startsWith("[L2:")) return "L2";
  if (steer.startsWith("[L3:")) return "L3-critical-only";
  return undefined;
}

const profiles = Object.fromEntries(PROFILE_NAMES.map((name) => [name, loadProfile(name)]));

describe("monitor profile policy", () => {
  it("keeps exactly one default profile and complete monitor coverage", () => {
    const defaults = Object.values(profiles).filter((profile) => profile.default === true);
    assert.deepEqual(defaults.map((profile) => profile.name), ["balanced"]);

    for (const [name, profile] of Object.entries(profiles)) {
      assert.equal(profile.name, name);
      assert.deepEqual(Object.keys(profile.monitors ?? {}).sort(), EXPECTED_MONITORS);
      assert.deepEqual(profile.ladder, {
        L1: "advisory",
        L2: "explicit-confirmation",
        L3: "critical-block",
      });
    }
  });

  it("keeps monitor modes and ceilings bounded in every profile", () => {
    for (const [profileName, profile] of Object.entries(profiles)) {
      for (const [monitorName, policy] of Object.entries(profile.monitors ?? {})) {
        assert.ok(VALID_MODES.has(policy.mode), `${profileName}/${monitorName} invalid mode`);
        assert.ok(
          Number.isFinite(policy.ceiling) && policy.ceiling >= 1 && policy.ceiling <= 6,
          `${profileName}/${monitorName} invalid ceiling: ${policy.ceiling}`,
        );
      }
    }
  });

  it("keeps balanced profile aligned with active project monitor ceilings and steering bands", () => {
    const balanced = profiles.balanced.monitors;

    for (const monitorName of EXPECTED_MONITORS) {
      const monitor = loadMonitor(monitorName);
      const policy = balanced[monitorName];
      assert.equal(policy.ceiling, monitor.ceiling, `${monitorName} ceiling drift`);
      assert.equal(
        policy.mode,
        inferModeFromSteer(monitor.actions?.on_flag?.steer),
        `${monitorName} steering band drift`,
      );
    }
  });

  it("keeps exploratory no stricter than balanced and strict no looser than balanced", () => {
    for (const monitorName of EXPECTED_MONITORS) {
      const balanced = profiles.balanced.monitors[monitorName].ceiling;
      const exploratory = profiles.exploratory.monitors[monitorName].ceiling;
      const strict = profiles.strict.monitors[monitorName].ceiling;

      assert.ok(exploratory >= balanced, `${monitorName} exploratory ceiling below balanced`);
      assert.ok(strict <= balanced, `${monitorName} strict ceiling above balanced`);
    }

    assert.equal(profiles.balanced.monitors["unauthorized-action"].ceiling, 1);
    assert.equal(profiles.exploratory.monitors["unauthorized-action"].ceiling, 1);
    assert.equal(profiles.strict.monitors["unauthorized-action"].ceiling, 1);
  });
});
