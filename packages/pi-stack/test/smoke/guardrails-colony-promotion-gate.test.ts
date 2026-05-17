import { describe, expect, it } from "vitest";
import { evaluateColonyPromotionGate } from "../../extensions/guardrails-core-exports";

describe("colony promotion readiness gate", () => {
  it("returns ready-for-colony-gate only when background and agent-run signals are green", () => {
    const result = evaluateColonyPromotionGate({
      backgroundReadinessScore: 85,
      backgroundReadinessCode: "background-process-readiness-strong",
      agentRunDecision: "ready-for-agent-run",
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
      agentRunDecision: "ready-for-agent-run",
      liveReloadCompleted: true,
    });

    expect(result.decision).toBe("keep-report-only");
    expect(result.recommendationCode).toBe("colony-gate-keep-report-only-background");
    expect(result.blockers).toContain("background-readiness-signal-missing");
  });

  it("keeps report-only when agent-run signal is missing", () => {
    const result = evaluateColonyPromotionGate({
      backgroundReadinessScore: 85,
      backgroundReadinessCode: "background-process-readiness-strong",
      agentRunDecision: "keep-report-only",
      liveReloadCompleted: true,
    });

    expect(result.decision).toBe("keep-report-only");
    expect(result.recommendationCode).toBe("colony-gate-keep-report-only-agent-run");
    expect(result.blockers).toContain("agent-run-readiness-signal-missing");
  });
});
