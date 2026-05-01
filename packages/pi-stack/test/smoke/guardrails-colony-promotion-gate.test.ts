import { describe, expect, it } from "vitest";
import { evaluateColonyPromotionGate } from "../../extensions/guardrails-core";

describe("colony promotion readiness gate", () => {
  it("returns ready-for-colony-gate only when background and simple-spawn signals are green", () => {
    const result = evaluateColonyPromotionGate({
      backgroundReadinessScore: 85,
      backgroundReadinessCode: "background-process-readiness-strong",
      simpleSpawnDecision: "ready-for-simple-spawn",
      liveReloadCompleted: true,
      protectedScopeRequested: false,
    });

    expect(result).toMatchObject({
      mode: "colony-promotion-readiness-gate",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      colonyDispatchAllowed: false,
      decision: "ready-for-colony-gate",
      recommendationCode: "colony-gate-ready",
      blockers: [],
    });
  });

  it("keeps report-only when background readiness signal is missing", () => {
    const result = evaluateColonyPromotionGate({
      backgroundReadinessScore: 59,
      backgroundReadinessCode: "background-process-readiness-needs-capabilities",
      simpleSpawnDecision: "ready-for-simple-spawn",
      liveReloadCompleted: true,
    });

    expect(result.decision).toBe("keep-report-only");
    expect(result.recommendationCode).toBe("colony-gate-keep-report-only-background");
    expect(result.blockers).toContain("background-readiness-signal-missing");
  });

  it("keeps report-only when simple spawn signal is missing", () => {
    const result = evaluateColonyPromotionGate({
      backgroundReadinessScore: 85,
      backgroundReadinessCode: "background-process-readiness-strong",
      simpleSpawnDecision: "keep-report-only",
      liveReloadCompleted: true,
    });

    expect(result.decision).toBe("keep-report-only");
    expect(result.recommendationCode).toBe("colony-gate-keep-report-only-simple-spawn");
    expect(result.blockers).toContain("simple-spawn-readiness-signal-missing");
  });
});
