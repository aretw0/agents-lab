import { describe, expect, it } from "vitest";
import {
  buildTurnBoundaryDecisionPacket,
  resolveContextWatchContinuationRecommendation,
} from "../../extensions/context-watchdog-continuation";

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

  it("builds checkpoint packet when focus must be refreshed", () => {
    const packet = buildTurnBoundaryDecisionPacket({
      ready: false,
      focusTasks: "none-listed",
      staleFocusCount: 1,
      localAuditReasons: ["candidate:invalid"],
    });

    expect(packet.decision).toBe("checkpoint");
    expect(packet.reasonCode).toBe("turn-boundary-checkpoint-refresh-focus");
    expect(packet.humanActionRequired).toBe(false);
    expect(packet.nextAutoStep).toContain("checkpoint");
  });

  it("builds pause packet without human action when local-safe next step is missing", () => {
    const packet = buildTurnBoundaryDecisionPacket({
      ready: false,
      focusTasks: "TASK-1",
      staleFocusCount: 0,
      localAuditReasons: ["no-local-safe-next-step"],
    });

    expect(packet.decision).toBe("pause");
    expect(packet.reasonCode).toBe("turn-boundary-pause-local-stop");
    expect(packet.humanActionRequired).toBe(false);
    expect(packet.nextAutoStep).toContain("local stop condition");
  });

  it("builds ask-human packet when protected/validation blockers are present", () => {
    const packet = buildTurnBoundaryDecisionPacket({
      ready: false,
      focusTasks: "TASK-1",
      staleFocusCount: 0,
      localAuditReasons: ["protected-scopes:invalid", "validation:invalid"],
    });

    expect(packet.decision).toBe("ask-human");
    expect(packet.reasonCode).toBe("turn-boundary-ask-human-decision-required");
    expect(packet.humanActionRequired).toBe(true);
    expect(packet.nextAutoStep).toContain("human decision");
  });
});
