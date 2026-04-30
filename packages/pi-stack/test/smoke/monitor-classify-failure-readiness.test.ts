import { describe, expect, it } from "vitest";
import { newClassifyFailureSummary, bumpClassifyFailure, resolveMonitorClassifyFailureReadiness } from "../../extensions/monitor-observability";

describe("monitor classify failure readiness", () => {
  it("keeps readiness ok when there are no classify failures", () => {
    const result = resolveMonitorClassifyFailureReadiness(newClassifyFailureSummary());

    expect(result).toMatchObject({
      mode: "monitor-classify-failure-readiness",
      decision: "ok",
      readinessImpact: "none",
      readyForStrongUnattended: true,
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
    });
  });

  it("treats one classifier-format failure as advisory warning", () => {
    const summary = newClassifyFailureSummary();
    bumpClassifyFailure(summary, "commit-hygiene", "No tool call in response (stopReason: stop, content: [text])");

    const result = resolveMonitorClassifyFailureReadiness(summary);

    expect(result.decision).toBe("warn");
    expect(result.readinessImpact).toBe("advisory");
    expect(result.readyForStrongUnattended).toBe(false);
    expect(result.lastErrorClass).toBe("classifier-format");
    expect(result.nextActions).toContain("watch-for-repeat-before-unattended");
  });

  it("degrades unattended readiness after repeated failures", () => {
    const summary = newClassifyFailureSummary();
    bumpClassifyFailure(summary, "commit-hygiene", "No tool call in response");
    bumpClassifyFailure(summary, "commit-hygiene", "No tool call in response");

    const result = resolveMonitorClassifyFailureReadiness(summary);

    expect(result.decision).toBe("degrade");
    expect(result.readinessImpact).toBe("degrade-unattended");
    expect(result.repeatedMonitors).toEqual(["commit-hygiene"]);
  });

  it("blocks strong unattended past the block threshold", () => {
    const summary = newClassifyFailureSummary();
    for (let i = 0; i < 4; i += 1) bumpClassifyFailure(summary, "fragility", "Instructions are required");

    const result = resolveMonitorClassifyFailureReadiness(summary);

    expect(result.decision).toBe("block");
    expect(result.readinessImpact).toBe("block-unattended");
    expect(result.lastErrorClass).toBe("instructions");
    expect(result.nextActions).toContain("block-strong-unattended");
  });
});
