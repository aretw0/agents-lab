import { describe, expect, it } from "vitest";
import { buildShellSpoofingCoverageScore } from "../../extensions/guardrails-core-shell-spoofing-score";

describe("guardrails shell spoofing coverage score", () => {
  it("returns strong recommendation when all anti-spoofing checks are present", () => {
    const result = buildShellSpoofingCoverageScore({
      hasCommandSensitivePolicyRule: true,
      hasDoctrineSpoofingRule: true,
      hasPolicyTriggerForSample: true,
      hasSafeMarkerCheckTool: true,
      hasValidationMethodPlanTool: true,
      hasBashGuardPolicyTest: true,
      hasValidationMethodTest: true,
      hasMarkerCheckTest: true,
      hasToolHygieneScorecardTool: true,
      hasPolicyAuditKey: true,
      hasValidationMethodSurfaceTest: true,
    });

    expect(result.score).toBe(100);
    expect(result.recommendationCode).toBe("shell-spoofing-coverage-strong");
    expect(result.dispatchAllowed).toBe(false);
    expect(result.authorization).toBe("none");
    expect(result.summary).toContain("shell-spoofing-coverage:");
  });

  it("prioritizes runtime gap when policy trigger/tooling is missing", () => {
    const result = buildShellSpoofingCoverageScore({
      hasCommandSensitivePolicyRule: true,
      hasDoctrineSpoofingRule: true,
      hasPolicyTriggerForSample: false,
      hasSafeMarkerCheckTool: false,
      hasValidationMethodPlanTool: false,
      hasBashGuardPolicyTest: true,
      hasValidationMethodTest: true,
      hasMarkerCheckTest: true,
      hasToolHygieneScorecardTool: true,
      hasPolicyAuditKey: true,
      hasValidationMethodSurfaceTest: true,
    });

    expect(result.dimensions.runtimePrevention).toBe(0);
    expect(result.recommendationCode).toBe("shell-spoofing-coverage-gap-runtime");
  });

  it("flags regression gap when runtime is healthy but tests are missing", () => {
    const result = buildShellSpoofingCoverageScore({
      hasCommandSensitivePolicyRule: true,
      hasDoctrineSpoofingRule: true,
      hasPolicyTriggerForSample: true,
      hasSafeMarkerCheckTool: true,
      hasValidationMethodPlanTool: true,
      hasBashGuardPolicyTest: false,
      hasValidationMethodTest: false,
      hasMarkerCheckTest: false,
      hasToolHygieneScorecardTool: true,
      hasPolicyAuditKey: true,
      hasValidationMethodSurfaceTest: true,
    });

    expect(result.dimensions.regressionCoverage).toBe(0);
    expect(result.recommendationCode).toBe("shell-spoofing-coverage-gap-regression");
  });
});
