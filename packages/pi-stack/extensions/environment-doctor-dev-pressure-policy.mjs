export function buildDevelopmentVelocityPressure(report) {
  const signals = Array.isArray(report?.signals) ? report.signals : [];
  const hasBlock = signals.some((signal) => signal.level === "block");
  const blockCount = signals.filter((signal) => signal.level === "block").length;
  const warnCount = signals.filter((signal) => signal.level === "warn").length;
  const score = signals.reduce((sum, signal) => {
    if (signal.level === "block") return sum + 100;
    if (signal.level === "warn") return sum + 35;
    if (signal.level === "info") return sum + 5;
    return sum;
  }, 0);

  const stopConditions = [];
  if (hasBlock) stopConditions.push("block-signal-present");
  if (warnCount >= 2 || hasBlock) stopConditions.push("checkpoint-before-more-work");
  if (signals.some((signal) => signal.code === "huge-resume-session" || signal.code === "large-resume-session")) {
    stopConditions.push("avoid-resume-heavy-session");
  }
  if (signals.some((signal) => signal.code === "heavy-configured-extension-entrypoint")) {
    stopConditions.push("reduce-runtime-surface");
  }

  let severity = "ok";
  if (hasBlock) severity = "block";
  else if (score >= 70) severity = "pause";
  else if (score >= 35) severity = "warn";

  let recommendation = "continue";
  if (severity === "block") recommendation = "stop-and-clean-before-continuing";
  else if (severity === "pause") recommendation = "checkpoint-and-reduce-pressure";
  else if (severity === "warn") recommendation = "continue-with-bounded-slices";

  return {
    mode: "development-velocity-pressure",
    severity,
    score,
    signalCount: signals.length,
    warnCount,
    blockCount,
    stopConditions,
    recommendation,
    summary: `development-velocity-pressure: severity=${severity} score=${score} recommendation=${recommendation} stopConditions=${stopConditions.length}`,
  };
}
