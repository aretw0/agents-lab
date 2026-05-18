import { describe, expect, it } from "vitest";
import {
  normalizeTaskDependencyIds,
  normalizeTaskId,
  taskHasLocalProtectedSignal,
  taskHasLocalRiskSignal,
  taskValidationGateKnown,
} from "../../extensions/guardrails-core-task-contracts";

describe("guardrails task contracts", () => {
  it("normalizes task ids and dependencies", () => {
    expect(normalizeTaskId(" TASK-1 ")).toBe("TASK-1");
    expect(normalizeTaskId("   ")).toBeUndefined();
    expect(normalizeTaskDependencyIds([" TASK-A ", "", 42, "TASK-B"])).toEqual(["TASK-A", "TASK-B"]);
  });

  it("classifies local protected, risk, and validation signals", () => {
    const local = {
      description: "Small local marker update",
      files: ["packages/pi-stack/extensions/foo.ts"],
      acceptance_criteria: ["Run vitest smoke."],
    };
    const protectedTask = {
      description: "Update GitHub Actions lane",
      files: [".github/workflows/ci.yml"],
    };
    const riskyTask = {
      description: "Cleanup data",
      notes: "delete obsolete generated state",
      files: ["packages/pi-stack/extensions/foo.ts"],
    };

    expect(taskHasLocalProtectedSignal(local)).toBe(false);
    expect(taskHasLocalRiskSignal(local)).toBe(false);
    expect(taskValidationGateKnown(local)).toBe(true);
    expect(taskHasLocalProtectedSignal(protectedTask)).toBe(true);
    expect(taskHasLocalRiskSignal(protectedTask)).toBe(true);
    expect(taskHasLocalRiskSignal(riskyTask)).toBe(true);
  });
});
