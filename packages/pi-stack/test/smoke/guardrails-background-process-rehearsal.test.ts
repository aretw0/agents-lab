import { describe, expect, it } from "vitest";
import { evaluateBackgroundProcessRehearsal } from "../../extensions/guardrails-core";

describe("background process rehearsal contract", () => {
  it("returns ready when minimum rehearsal evidence is complete", () => {
    const result = evaluateBackgroundProcessRehearsal({
      readinessScore: 85,
      readinessRecommendationCode: "background-process-readiness-strong",
      lifecycleClassified: true,
      stopSourceCoveragePct: 90,
      rollbackPlanKnown: true,
      rehearsalSlices: 1,
      unresolvedBlockers: 0,
    });

    expect(result).toMatchObject({
      mode: "background-process-rehearsal",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      decision: "ready",
      ready: true,
      blockers: [],
      missingEvidence: [],
    });
    expect(result.summary).toContain("decision=ready");
  });

  it("returns needs-evidence when readiness/lifecycle/coverage evidence is incomplete", () => {
    const result = evaluateBackgroundProcessRehearsal({
      readinessScore: 59,
      readinessRecommendationCode: "background-process-readiness-needs-capabilities",
      lifecycleClassified: false,
      stopSourceCoveragePct: 20,
      rollbackPlanKnown: false,
      rehearsalSlices: 0,
    });

    expect(result.decision).toBe("needs-evidence");
    expect(result.ready).toBe(false);
    expect(result.missingEvidence).toEqual(expect.arrayContaining([
      "background-readiness-not-strong",
      "lifecycle-evidence-not-classified",
      "stop-source-coverage-below-threshold",
      "rollback-plan-missing",
      "insufficient-rehearsal-slices",
    ]));
  });

  it("returns blocked when destructive/protected/unresolved blockers are present", () => {
    const result = evaluateBackgroundProcessRehearsal({
      readinessScore: 100,
      readinessRecommendationCode: "background-process-readiness-strong",
      lifecycleClassified: true,
      stopSourceCoveragePct: 100,
      rollbackPlanKnown: true,
      rehearsalSlices: 3,
      unresolvedBlockers: 1,
      destructiveRestartRequested: true,
      protectedScopeRequested: true,
    });

    expect(result.decision).toBe("blocked");
    expect(result.blockers).toEqual(expect.arrayContaining([
      "destructive-restart-requested",
      "protected-scope-requested",
      "unresolved-blockers",
    ]));
  });
});
