import type {
  ReloadLifecycleDecision,
  ReloadLifecycleDiagnosticInput,
  ReloadLifecycleDiagnosticPacket,
  ReloadLifecyclePhaseName,
  ReloadLifecyclePhaseStatus,
  ReloadLifecyclePhaseTiming,
} from "./guardrails-core-unattended-continuation-types";
import {
  formatAuthorizationEvidence,
  GUARDRAILS_AUTHORIZATION_NONE,
} from "./guardrails-core-authorization";

const RELOAD_LIFECYCLE_PHASES: ReloadLifecyclePhaseName[] = [
  "package-discovery",
  "extension-load",
  "tool-registration",
  "monitor-startup",
  "session-resume-hooks",
];

function normalizeReloadPhase(value: unknown): ReloadLifecyclePhaseName | undefined {
  return RELOAD_LIFECYCLE_PHASES.includes(value as ReloadLifecyclePhaseName)
    ? value as ReloadLifecyclePhaseName
    : undefined;
}

function normalizeReloadPhaseStatus(value: unknown): ReloadLifecyclePhaseStatus {
  if (value === "pending" || value === "running" || value === "completed" || value === "failed" || value === "unknown") {
    return value;
  }
  return "unknown";
}

function normalizeReloadPhaseTiming(value: ReloadLifecyclePhaseTiming): ReloadLifecyclePhaseTiming | undefined {
  const phase = normalizeReloadPhase(value.phase);
  if (!phase) return undefined;
  const durationMs = Number(value.durationMs);
  return {
    phase,
    status: normalizeReloadPhaseStatus(value.status),
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? Math.floor(durationMs) : undefined,
    startedAtIso: typeof value.startedAtIso === "string" && value.startedAtIso.trim() ? value.startedAtIso.trim() : undefined,
    endedAtIso: typeof value.endedAtIso === "string" && value.endedAtIso.trim() ? value.endedAtIso.trim() : undefined,
    note: typeof value.note === "string" && value.note.trim() ? value.note.trim().slice(0, 160) : undefined,
  };
}

function parseOptionalIsoMs(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function resolveReloadLifecycleDecision(input: {
  phases: ReloadLifecyclePhaseTiming[];
  lastProgressAgeMs?: number;
  cpuPressure?: boolean;
  diskPressure?: boolean;
}): ReloadLifecycleDecision {
  if (input.phases.some((phase) => phase.status === "failed")) return "failed";
  if (input.phases.length === 0) return "insufficient-evidence";
  const hasRunning = input.phases.some((phase) => phase.status === "running");
  const hasCompleted = input.phases.some((phase) => phase.status === "completed");
  const longRunningPhase = input.phases.some((phase) => phase.status === "running" && Number(phase.durationMs ?? 0) >= 120_000);
  const staleProgress = typeof input.lastProgressAgeMs === "number" && input.lastProgressAgeMs >= 120_000;
  if (longRunningPhase || staleProgress) return "possibly-hung";
  const slowPhase = input.phases.some((phase) => Number(phase.durationMs ?? 0) >= 30_000);
  if (slowPhase || input.cpuPressure || input.diskPressure || hasRunning) return "slow-progressing";
  return hasCompleted ? "healthy" : "insufficient-evidence";
}

function formatReloadDuration(ms: number): string {
  if (ms >= 60_000) return `${Math.round(ms / 1000)}s`;
  return `${ms}ms`;
}

export function buildReloadLifecycleDiagnosticPacket(input: ReloadLifecycleDiagnosticInput): ReloadLifecycleDiagnosticPacket {
  const phases = input.phases
    .map(normalizeReloadPhaseTiming)
    .filter((phase): phase is ReloadLifecyclePhaseTiming => phase !== undefined)
    .slice(0, RELOAD_LIFECYCLE_PHASES.length);
  const knownPhases = new Set(phases.map((phase) => phase.phase));
  const missingPhases = RELOAD_LIFECYCLE_PHASES.filter((phase) => !knownPhases.has(phase));
  const totalKnownDurationMs = phases.reduce((sum, phase) => sum + Math.max(0, Math.floor(Number(phase.durationMs ?? 0))), 0);
  const slowPhases = phases
    .filter((phase) => Number(phase.durationMs ?? 0) >= 30_000 || phase.status === "running")
    .map((phase) => `${phase.phase}:${phase.status}${phase.durationMs !== undefined ? `:${formatReloadDuration(phase.durationMs)}` : ""}`)
    .slice(0, 5);
  const lastProgressAtMs = parseOptionalIsoMs(input.lastProgressAtIso);
  const lastProgressAgeMs = lastProgressAtMs === undefined ? undefined : Math.max(0, Math.floor(input.nowMs - lastProgressAtMs));
  const decision = resolveReloadLifecycleDecision({
    phases,
    lastProgressAgeMs,
    cpuPressure: input.cpuPressure,
    diskPressure: input.diskPressure,
  });
  const lastVisiblePhase = normalizeReloadPhase(input.lastVisiblePhase) ?? phases.find((phase) => phase.status === "running")?.phase ?? phases.at(-1)?.phase ?? "unknown";
  const pressure = [
    input.cpuPressure ? "cpu" : undefined,
    input.diskPressure ? "disk" : undefined,
  ].filter((item): item is string => Boolean(item));
  const evidenceChecklist = [
    "timestamp when reload started and last visible phase changed",
    "last visible phase: package-discovery | extension-load | tool-registration | monitor-startup | session-resume-hooks",
    "CPU and disk pressure from environment doctor or host monitor",
    "session path or sandbox root involved in the reload",
    "whether auto-resume was suppressed or reload suppression was active",
  ];
  const rollbackPath = [
    "do not force a destructive restart first",
    "capture the diagnostic packet and current handoff",
    "use /safe-mode on or /safe-boot recover if the live session is still responsive",
    "start a fresh control-plane session only after checkpoint evidence is saved",
  ];
  const recommendation = decision === "possibly-hung"
    ? "Treat reload as possibly hung: capture evidence, avoid destructive restart, and use safe-mode/recover before retrying."
    : decision === "slow-progressing"
      ? "Reload appears slow but still diagnosable: keep collecting phase evidence and check CPU/disk pressure before retrying."
      : decision === "failed"
        ? "Reload failure needs targeted schema/registration evidence before another live reload attempt."
        : decision === "insufficient-evidence"
          ? "Capture at least one phase timing and last visible phase before classifying reload health."
          : "Reload lifecycle evidence is within the expected bounded window.";
  return {
    effect: "none",
    mode: "advisory",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    decision,
    phases,
    totalKnownDurationMs,
    slowPhases,
    missingPhases,
    evidenceChecklist,
    rollbackPath,
    summary: [
      `reload-lifecycle-diagnostic: decision=${decision}`,
      `phases=${phases.length}/${RELOAD_LIFECYCLE_PHASES.length}`,
      `last=${lastVisiblePhase}`,
      `total=${formatReloadDuration(totalKnownDurationMs)}`,
      `pressure=${pressure.length ? pressure.join("|") : "none"}`,
      `autoResumeSuppressed=${input.autoResumeSuppressed === true ? "yes" : "no"}`,
      `reloadSuppression=${input.reloadSuppressionActive === true ? "yes" : "no"}`,
      formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE),
    ].join(" "),
    recommendation,
  };
}
