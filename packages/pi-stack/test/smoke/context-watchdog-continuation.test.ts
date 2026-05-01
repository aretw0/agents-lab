import { describe, expect, it } from "vitest";
import { resolveContextWatchContinuationRecommendation } from "../../extensions/context-watchdog-continuation";

describe("context-watchdog continuation recommendation", () => {
  it("returns continue-local when readiness is true", () => {
    const result = resolveContextWatchContinuationRecommendation({
      ready: true,
      focusTasks: "TASK-1",
      staleFocusCount: 0,
      localAuditReasons: [],
    });

    expect(result.recommendationCode).toBe("continue-local");
    expect(result.nextAction.length).toBeGreaterThan(10);
  });

  it("returns local-stop-no-local-safe-next-step when local-safe next step is missing", () => {
    const result = resolveContextWatchContinuationRecommendation({
      ready: false,
      focusTasks: "TASK-1",
      staleFocusCount: 0,
      localAuditReasons: ["no-local-safe-next-step"],
    });

    expect(result.recommendationCode).toBe("local-stop-no-local-safe-next-step");
    expect(result.nextAction).toContain("local stop condition");
  });

  it("returns refresh-focus-checkpoint for stale/invalid focus contexts", () => {
    const result = resolveContextWatchContinuationRecommendation({
      ready: false,
      focusTasks: "none-listed",
      staleFocusCount: 1,
      localAuditReasons: ["candidate:invalid"],
    });

    expect(result.recommendationCode).toBe("refresh-focus-checkpoint");
  });

  it("returns local-audit-blocked for generic blocked conditions", () => {
    const result = resolveContextWatchContinuationRecommendation({
      ready: false,
      focusTasks: "TASK-1",
      staleFocusCount: 0,
      localAuditReasons: ["validation:invalid"],
    });

    expect(result.recommendationCode).toBe("local-audit-blocked");
  });
});
