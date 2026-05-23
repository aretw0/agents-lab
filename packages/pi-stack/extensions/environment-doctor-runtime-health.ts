type RuntimeHealthDecision = "continue" | "safe-mode" | "stop-and-investigate";

export function resolveEnvironmentRuntimeHealthDecision(input: {
  doctorIssues?: unknown[];
  devPressureRecommendation?: string;
  devPressureSeverity?: string;
  runtimeArtifactViolations?: unknown[];
}): RuntimeHealthDecision {
  const doctorIssues = Array.isArray(input.doctorIssues) ? input.doctorIssues.length : 0;
  const runtimeArtifactViolations = Array.isArray(input.runtimeArtifactViolations)
    ? input.runtimeArtifactViolations.length
    : 0;
  const recommendation = String(input.devPressureRecommendation ?? "");
  const severity = String(input.devPressureSeverity ?? "");

  if (
    doctorIssues > 0 ||
    runtimeArtifactViolations > 0 ||
    recommendation === "block-and-clean" ||
    severity === "block"
  ) {
    return "stop-and-investigate";
  }
  if (recommendation === "new-session" || severity === "pause") return "safe-mode";
  return "continue";
}

export function buildEnvironmentRuntimeHealthPayload(input: {
  allResults: Array<{ status: string; optional?: boolean }>;
  terminalId: string;
  shellId: string;
  devPressure: Record<string, any>;
  runtimeArtifacts: Record<string, any>;
  runtimeArtifactSummary: string;
}) {
  const doctorIssues = input.allResults.filter((row) => row.status !== "ok" && !row.optional);
  const optionalIssues = input.allResults.filter((row) => row.status !== "ok" && row.optional);
  const decision = resolveEnvironmentRuntimeHealthDecision({
    doctorIssues,
    devPressureRecommendation: input.devPressure.recommendation,
    devPressureSeverity: input.devPressure.velocityPressure?.severity,
    runtimeArtifactViolations: input.runtimeArtifacts.violations,
  });
  const payload = {
    mode: "environment-runtime-health",
    decision,
    doctor: {
      terminalId: input.terminalId,
      shellId: input.shellId,
      okCount: input.allResults.filter((row) => row.status === "ok").length,
      totalCount: input.allResults.length,
      issues: doctorIssues,
      optionalIssues,
    },
    devPressure: input.devPressure,
    runtimeArtifacts: input.runtimeArtifacts,
    runtimeArtifactSummary: input.runtimeArtifactSummary,
    watchdog: {
      liveMetricsAvailable: false,
      note: "Pi watchdog slash commands are TUI commands; this tool uses external pressure facts and persisted evidence only.",
    },
  };
  const summary = [
    "environment-runtime-health:",
    `decision=${decision}`,
    `doctorIssues=${doctorIssues.length}`,
    optionalIssues.length > 0 ? `optionalIssues=${optionalIssues.length}` : undefined,
    `devPressure=${input.devPressure.recommendation}`,
    `velocity=${input.devPressure.velocityPressure?.severity ?? "unknown"}`,
    input.devPressure.boardPressurePlan?.status ? `boardPressure=${input.devPressure.boardPressurePlan.status}` : undefined,
    `runtimeArtifacts=${Array.isArray(input.runtimeArtifacts.violations) && input.runtimeArtifacts.violations.length === 0 ? "clean" : "violations"}`,
    "liveWatchdog=runtime-local",
  ].filter(Boolean).join(" ");

  return { payload, summary };
}
