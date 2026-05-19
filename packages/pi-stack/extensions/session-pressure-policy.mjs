export const DEFAULT_SESSION_PRESSURE_THRESHOLDS = {
  largeSessionMb: 50,
  blockingSessionMb: 150,
};

export function detectSessionResumeIntent(piArgs) {
  if (!Array.isArray(piArgs)) return false;
  return piArgs.some((arg) => typeof arg === "string" && arg.trim() === "--resume");
}

export function buildSessionBudget(sessions, thresholds = DEFAULT_SESSION_PRESSURE_THRESHOLDS) {
  const largeSessionMb = Number.isFinite(Number(thresholds.largeSessionMb))
    ? Number(thresholds.largeSessionMb)
    : DEFAULT_SESSION_PRESSURE_THRESHOLDS.largeSessionMb;
  const blockingSessionMb = Number.isFinite(Number(thresholds.blockingSessionMb))
    ? Number(thresholds.blockingSessionMb)
    : DEFAULT_SESSION_PRESSURE_THRESHOLDS.blockingSessionMb;

  const files = Array.isArray(sessions?.files) ? sessions.files : [];
  const oversized = files
    .filter((row) => row.mb >= largeSessionMb)
    .map((row) => ({
      ...row,
      level: row.mb >= blockingSessionMb ? "block" : "warn",
      overLargeByMb: Number((row.mb - largeSessionMb).toFixed(2)),
      overBlockByMb: row.mb >= blockingSessionMb ? Number((row.mb - blockingSessionMb).toFixed(2)) : 0,
    }));

  const blockers = oversized.filter((row) => row.level === "block");
  const recommendation = blockers.length > 0
    ? "do-not-resume-archive-or-delete-after-checkpoint"
    : oversized.length > 0
      ? "prefer-new-session-and-checkpoint-before-resume"
      : "within-budget";

  return {
    largeSessionMb,
    blockingSessionMb,
    oversized,
    blockers,
    recommendation,
  };
}

export function computeStrictFailures(report) {
  const failures = [];
  for (const signal of report?.signals ?? []) {
    if (signal.level === "block") failures.push(signal.code);
  }
  return failures;
}

export function resolveSessionPressureGate(report, { force = false, resume = false } = {}) {
  const failures = computeStrictFailures(report);
  const newSessionRecoverableFailures = new Set(["huge-resume-session"]);
  const blockingFailures = failures.filter((code) => !newSessionRecoverableFailures.has(code));
  if (failures.length === 0) {
    return { allowed: true, failures, reason: "clean" };
  }
  if (force) {
    return { allowed: true, failures, reason: "forced" };
  }
  if (blockingFailures.length > 0) {
    return { allowed: false, failures, reason: "machine-pressure-strict" };
  }
  if (!resume) {
    return { allowed: true, failures, reason: "new-session-advisory" };
  }
  return { allowed: false, failures, reason: "strict-failures" };
}
