import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadMonitor(name) {
  return loadJson(join(process.cwd(), ".pi", "monitors", `${name}.monitor.json`));
}

const MONITORS = {
  commitHygiene: loadMonitor("commit-hygiene"),
  fragility: loadMonitor("fragility"),
  hedge: loadMonitor("hedge"),
  unauthorizedAction: loadMonitor("unauthorized-action"),
  workQuality: loadMonitor("work-quality"),
};

describe("monitor chaos policy: trigger frequency", () => {
  it("keeps non-critical monitors behind selective when clauses", () => {
    assert.equal(MONITORS.commitHygiene.when, "has_file_writes");
    assert.equal(MONITORS.fragility.when, "has_file_writes");
    assert.equal(MONITORS.hedge.when, "has_bash");
  });

  it("keeps unauthorized-action as the only always-on monitor", () => {
    const alwaysOn = Object.entries(MONITORS)
      .filter(([, monitor]) => monitor.when === "always")
      .map(([name]) => name)
      .sort();

    assert.deepEqual(alwaysOn, ["unauthorizedAction", "workQuality"]);
    assert.equal(MONITORS.unauthorizedAction.event, "tool_call");
    assert.equal(MONITORS.workQuality.event, "command");
  });

  it("keeps monitor ceilings bounded (anti-loop amplification)", () => {
    const ceilings = Object.entries(MONITORS).map(([name, monitor]) => ({
      name,
      ceiling: monitor.ceiling,
    }));

    for (const entry of ceilings) {
      assert.ok(
        Number.isFinite(entry.ceiling) && entry.ceiling >= 1 && entry.ceiling <= 5,
        `${entry.name} has invalid/unbounded ceiling: ${entry.ceiling}`,
      );
    }
  });
});

describe("monitor chaos policy: write amplification", () => {
  it("limits .project/issues writes to explicit quality/fragility monitors", () => {
    const writes = Object.entries(MONITORS)
      .filter(([, monitor]) => Boolean(monitor?.actions?.on_flag?.write || monitor?.actions?.on_new?.write))
      .map(([name]) => name)
      .sort();

    assert.deepEqual(writes, ["fragility", "workQuality"]);
  });
});

describe("fragility learned-pattern hygiene", () => {
  it("keeps learned empty-response pattern singular to avoid overfitting duplication", () => {
    const patterns = loadJson(
      join(process.cwd(), ".pi", "monitors", "fragility.patterns.json"),
    );

    const emptyResponseLike = patterns.filter((pattern) =>
      /empty response|empty output|responds with empty/i.test(
        `${pattern.id ?? ""} ${pattern.description ?? ""}`,
      ),
    );

    assert.ok(emptyResponseLike.length <= 1, `expected <=1 empty-response pattern, got ${emptyResponseLike.length}`);
  });
});
