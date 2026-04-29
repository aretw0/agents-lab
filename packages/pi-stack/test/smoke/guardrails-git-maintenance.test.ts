import { describe, expect, it } from "vitest";
import { evaluateGitMaintenanceSignal } from "../../extensions/guardrails-core-git-maintenance";

describe("guardrails git maintenance", () => {
  it("treats small clean repositories as informational", () => {
    const signal = evaluateGitMaintenanceSignal({
      looseObjectCount: 120,
      looseSizeMiB: 2,
      garbageCount: 0,
      garbageSizeMiB: 0,
      gcLogPresent: false,
    });

    expect(signal).toMatchObject({
      severity: "informational",
      action: "continue",
      cleanupAllowedAutomatically: false,
      reasons: [],
      summary: "git-maintenance: severity=informational action=continue loose=120 sizeMiB=2 garbage=0 gcLog=no",
    });
  });

  it("classifies the current observed loose-object shape as warning without auto cleanup", () => {
    const signal = evaluateGitMaintenanceSignal({
      looseObjectCount: 6089,
      looseSizeMiB: 10.14,
      garbageCount: 0,
      garbageSizeMiB: 0,
      gcLogPresent: true,
    });

    expect(signal.severity).toBe("warning");
    expect(signal.action).toBe("monitor");
    expect(signal.cleanupAllowedAutomatically).toBe(false);
    expect(signal.reasons).toEqual(["gc-log-present", "many-loose-objects"]);
  });

  it("requires operator-controlled intervention for disk or performance pressure", () => {
    const signal = evaluateGitMaintenanceSignal({
      looseObjectCount: 9000,
      looseSizeMiB: 1200,
      garbageCount: 10,
      garbageSizeMiB: 2,
      gcLogPresent: true,
      diskLow: true,
      performanceDegraded: true,
    });

    expect(signal.severity).toBe("intervention");
    expect(signal.action).toBe("ask-before-maintenance");
    expect(signal.cleanupAllowedAutomatically).toBe(false);
    expect(signal.reasons).toEqual(expect.arrayContaining([
      "disk-low",
      "performance-degraded",
      "large-loose-object-size",
    ]));
  });
});
