import { describe, expect, it } from "vitest";
import {
  evaluateProjectIntakePlan,
  INTAKE_NEEDS_HUMAN_FOCUS_PROTECTED_CODE,
  INTAKE_PLAN_FIRST_SLICE_CODE,
} from "../../extensions/project-intake-primitive";

describe("project-intake-primitive", () => {
  it("classifies light notes projects and keeps report-only guardrails", () => {
    const plan = evaluateProjectIntakePlan({
      dominantArtifacts: ["markdown", "obsidian"],
      hasBuildFiles: false,
      repositoryScale: "small",
    });

    expect(plan.profile).toBe("light-notes");
    expect(plan.decision).toBe("ready-for-human-review");
    expect(plan.recommendationCode).toBe(INTAKE_PLAN_FIRST_SLICE_CODE);
    expect(plan.dispatchAllowed).toBe(false);
    expect(plan.mutationAllowed).toBe(false);
    expect(plan.authorization).toBe("none");
    expect(plan.mode).toBe("report-only");
  });

  it("classifies heavy projects deterministically", () => {
    const plan = evaluateProjectIntakePlan({
      dominantArtifacts: ["java", "yaml"],
      hasBuildFiles: true,
      hasCi: true,
      repositoryScale: "large",
    });

    expect(plan.profile).toBe("monorepo-heavy");
    expect(plan.firstSlice.title).toContain("module");
  });

  it("blocks when protected scope is requested", () => {
    const plan = evaluateProjectIntakePlan({
      dominantArtifacts: ["typescript"],
      hasBuildFiles: true,
      protectedScopeRequested: true,
    });

    expect(plan.decision).toBe("blocked");
    expect(plan.recommendationCode).toBe(INTAKE_NEEDS_HUMAN_FOCUS_PROTECTED_CODE);
    expect(plan.nextAction).toContain("human focus");
  });

  it("keeps recommendations short and structured across lightweight and heavy scenarios", () => {
    const light = evaluateProjectIntakePlan({
      dominantArtifacts: ["markdown"],
      hasBuildFiles: false,
      repositoryScale: "small",
    });
    const heavy = evaluateProjectIntakePlan({
      dominantArtifacts: ["java", "typescript"],
      hasBuildFiles: true,
      hasCi: true,
      repositoryScale: "large",
    });

    for (const plan of [light, heavy]) {
      expect(plan.recommendationCode.length).toBeGreaterThan(8);
      expect(plan.nextAction.length).toBeLessThanOrEqual(140);
      expect(plan.firstSlice.validation.length).toBeLessThanOrEqual(80);
      expect(plan.firstSlice.rollback).toBe("git revert commit");
      expect(plan.dispatchAllowed).toBe(false);
      expect(plan.mutationAllowed).toBe(false);
      expect(plan.authorization).toBe("none");
    }
  });
});
