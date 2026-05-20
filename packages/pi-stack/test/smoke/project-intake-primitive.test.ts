import { describe, expect, it } from "vitest";
import {
  buildFirstHatchIntakePacket,
  evaluateProjectIntakePlan,
  INTAKE_NEEDS_OPERATOR_FOCUS_PROTECTED_CODE,
  INTAKE_PLAN_FIRST_SLICE_CODE,
  FIRST_HATCH_EMPTY_WORKSPACE_CODE,
  FIRST_HATCH_READY_CODE,
  FIRST_HATCH_SANDBOX_BLOCKED_CODE,
} from "../../extensions/project-intake-primitive";
import { GUARDRAILS_AUTHORIZATION_NONE } from "../../extensions/guardrails-core-authorization";

describe("project-intake-primitive", () => {
  it("classifies light notes projects and keeps report-only guardrails", () => {
    const plan = evaluateProjectIntakePlan({
      dominantArtifacts: ["markdown", "obsidian"],
      hasBuildFiles: false,
      repositoryScale: "small",
    });

    expect(plan.profile).toBe("light-notes");
    expect(plan.decision).toBe("ready-for-operator-decision");
    expect(plan.recommendationCode).toBe(INTAKE_PLAN_FIRST_SLICE_CODE);
    expect(plan.dispatchAllowed).toBe(false);
    expect(plan.mutationAllowed).toBe(false);
    expect(plan.authorization).toBe(GUARDRAILS_AUTHORIZATION_NONE);
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
    expect(plan.recommendationCode).toBe(INTAKE_NEEDS_OPERATOR_FOCUS_PROTECTED_CODE);
    expect(plan.nextAction).toContain("operator focus");
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
      expect(plan.authorization).toBe(GUARDRAILS_AUTHORIZATION_NONE);
    }
  });

  it("keeps output bounded even with noisy artifact inputs", () => {
    const noisyArtifacts = Array.from({ length: 80 }, (_, i) => `artifact-${i + 1}-${"x".repeat(40)}`);
    const plan = evaluateProjectIntakePlan({
      dominantArtifacts: noisyArtifacts,
      hasBuildFiles: true,
      hasTests: true,
      hasCi: true,
      repositoryScale: "large",
    });

    expect(plan.profile).toBe("monorepo-heavy");
    expect(plan.nextAction.length).toBeLessThanOrEqual(140);
    expect(plan.firstSlice.title.length).toBeLessThanOrEqual(90);
    expect(plan.firstSlice.validation.length).toBeLessThanOrEqual(80);
  });

  it("builds first hatch packet for a ready local-safe workspace", () => {
    const packet = buildFirstHatchIntakePacket({
      workspaceName: "agents-lab",
      topLevelEntries: ["package.json", ".project", "packages"],
      dominantArtifacts: ["typescript", "markdown", "typescript"],
      packageManagers: ["pnpm"],
      hasGit: true,
      hasProjectBoard: true,
      hasTests: true,
      sandboxMode: "workspace-write",
    });

    expect(packet.decision).toBe("ready-for-operator-decision");
    expect(packet.recommendationCode).toBe(FIRST_HATCH_READY_CODE);
    expect(packet.workspace.artifactKinds).toEqual(["typescript", "markdown"]);
    expect(packet.sandbox.localSafeMutationPossible).toBe(true);
    expect(packet.dispatchAllowed).toBe(false);
    expect(packet.mutationAllowed).toBe(false);
    expect(packet.authorization).toBe(GUARDRAILS_AUTHORIZATION_NONE);
    expect(packet.mode).toBe("report-only");
  });

  it("keeps first hatch empty workspace interview short", () => {
    const packet = buildFirstHatchIntakePacket({ sandboxMode: "workspace-write" });

    expect(packet.recommendationCode).toBe(FIRST_HATCH_EMPTY_WORKSPACE_CODE);
    expect(packet.missingQuestions.length).toBeLessThanOrEqual(3);
    expect(packet.missingQuestions.join(" ")).toContain("workspace");
    expect(packet.nextAction.length).toBeLessThanOrEqual(100);
    expect(packet.dispatchAllowed).toBe(false);
  });

  it("blocks first hatch mutation when sandbox is read-only", () => {
    const packet = buildFirstHatchIntakePacket({
      topLevelEntries: ["README.md"],
      dominantArtifacts: ["markdown"],
      hasGit: true,
      sandboxMode: "read-only",
    });

    expect(packet.decision).toBe("blocked");
    expect(packet.recommendationCode).toBe(FIRST_HATCH_SANDBOX_BLOCKED_CODE);
    expect(packet.sandbox.writeBlocked).toBe(true);
    expect(packet.sandbox.localSafeMutationPossible).toBe(false);
    expect(packet.mutationAllowed).toBe(false);
  });

});
