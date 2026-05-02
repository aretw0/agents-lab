import { describe, expect, it } from "vitest";
import {
  buildTurnBoundaryDecisionPacket,
  resolveContextWatchContinuationRecommendation,
  TURN_BOUNDARY_DIRECTION_PROMPT,
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
    expect(packet.directionPrompt).toBe(TURN_BOUNDARY_DIRECTION_PROMPT);
    expect(packet.directionPreview.recommendedOptionId).toBe("similar-lane");
    expect(packet.directionPreview.options.map((option) => option.id)).toEqual(["similar-lane", "next-high-value"]);
    expect(packet.summary).toContain("directionPrompt=similar-lane-or-next-value");
    expect(packet.summary).toContain("directionRecommended=similar-lane");
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
    expect(packet.directionPreview.recommendedOptionId).toBe("next-high-value");
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
    expect(packet.directionPrompt).toBe(TURN_BOUNDARY_DIRECTION_PROMPT);
    expect(packet.directionPreview.recommendedOptionId).toBe("next-high-value");
    const nextLane = packet.directionPreview.options.find((option) => option.id === "next-high-value");
    expect(nextLane?.nextStep).toContain("report-only packet");
  });
});
