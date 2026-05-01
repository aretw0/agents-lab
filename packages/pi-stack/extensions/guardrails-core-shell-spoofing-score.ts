export interface ShellSpoofingCoverageInput {
  hasCommandSensitivePolicyRule: boolean;
  hasDoctrineSpoofingRule: boolean;
  hasPolicyTriggerForSample: boolean;
  hasSafeMarkerCheckTool: boolean;
  hasValidationMethodPlanTool: boolean;
  hasBashGuardPolicyTest: boolean;
  hasValidationMethodTest: boolean;
  hasMarkerCheckTest: boolean;
  hasToolHygieneScorecardTool: boolean;
  hasPolicyAuditKey: boolean;
  hasValidationMethodSurfaceTest: boolean;
}

export type ShellSpoofingCoverageRecommendationCode =
  | "shell-spoofing-coverage-strong"
  | "shell-spoofing-coverage-gap-runtime"
  | "shell-spoofing-coverage-gap-regression"
  | "shell-spoofing-coverage-gap-observability"
  | "shell-spoofing-coverage-gap-policy";

export interface ShellSpoofingCoverageScore {
  mode: "shell-spoofing-coverage-score";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  score: number;
  recommendationCode: ShellSpoofingCoverageRecommendationCode;
  recommendation: string;
  dimensions: {
    policyCoverage: number;
    runtimePrevention: number;
    regressionCoverage: number;
    observabilityCoverage: number;
  };
  checks: ShellSpoofingCoverageInput;
  summary: string;
}

function ratioScore(values: boolean[]): number {
  if (values.length <= 0) return 0;
  const passed = values.filter(Boolean).length;
  return Math.round((passed / values.length) * 100);
}

function weightedScore(input: {
  policyCoverage: number;
  runtimePrevention: number;
  regressionCoverage: number;
  observabilityCoverage: number;
}): number {
  const raw = (input.policyCoverage * 0.2)
    + (input.runtimePrevention * 0.35)
    + (input.regressionCoverage * 0.3)
    + (input.observabilityCoverage * 0.15);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function buildShellSpoofingCoverageScore(input: ShellSpoofingCoverageInput): ShellSpoofingCoverageScore {
  const policyCoverage = ratioScore([
    input.hasCommandSensitivePolicyRule,
    input.hasDoctrineSpoofingRule,
  ]);

  const runtimePrevention = ratioScore([
    input.hasPolicyTriggerForSample,
    input.hasSafeMarkerCheckTool,
    input.hasValidationMethodPlanTool,
  ]);

  const regressionCoverage = ratioScore([
    input.hasBashGuardPolicyTest,
    input.hasValidationMethodTest,
    input.hasMarkerCheckTest,
  ]);

  const observabilityCoverage = ratioScore([
    input.hasToolHygieneScorecardTool,
    input.hasPolicyAuditKey,
    input.hasValidationMethodSurfaceTest,
  ]);

  const score = weightedScore({
    policyCoverage,
    runtimePrevention,
    regressionCoverage,
    observabilityCoverage,
  });

  let recommendationCode: ShellSpoofingCoverageRecommendationCode = "shell-spoofing-coverage-strong";
  let recommendation = "spoofing-variable coverage is strong; keep bounded maintenance cadence and monitor drift.";

  if (runtimePrevention < 70) {
    recommendationCode = "shell-spoofing-coverage-gap-runtime";
    recommendation = "runtime prevention is weak; prioritize guard/policy wiring before expanding unattended loops.";
  } else if (regressionCoverage < 70) {
    recommendationCode = "shell-spoofing-coverage-gap-regression";
    recommendation = "regression coverage is weak; add/repair smoke tests for policy and validation routing.";
  } else if (observabilityCoverage < 70) {
    recommendationCode = "shell-spoofing-coverage-gap-observability";
    recommendation = "observability coverage is weak; expose maintenance score/audit evidence to react before incidents.";
  } else if (policyCoverage < 70) {
    recommendationCode = "shell-spoofing-coverage-gap-policy";
    recommendation = "policy coverage is weak; document and enforce canonical anti-spoofing rules before proceeding.";
  }

  return {
    mode: "shell-spoofing-coverage-score",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    score,
    recommendationCode,
    recommendation,
    dimensions: {
      policyCoverage,
      runtimePrevention,
      regressionCoverage,
      observabilityCoverage,
    },
    checks: input,
    summary: [
      "shell-spoofing-coverage:",
      "ok=yes",
      `score=${score}`,
      `code=${recommendationCode}`,
      `policy=${policyCoverage}`,
      `runtime=${runtimePrevention}`,
      `regression=${regressionCoverage}`,
      `observability=${observabilityCoverage}`,
    ].join(" "),
  };
}
