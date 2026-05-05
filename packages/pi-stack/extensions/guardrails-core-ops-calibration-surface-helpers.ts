import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildBackgroundProcessReadinessScore, resolveBackgroundProcessControlPlan } from "./guardrails-core-background-process";
import { evaluateBackgroundProcessRehearsal } from "./guardrails-core-background-process-rehearsal";
import {
  buildDelegateOrExecuteDecisionPacket,
  buildSimpleDelegateRehearsalDecisionPacket,
} from "./guardrails-core-ops-calibration";
import { buildAgentsAsToolsCalibrationScore, type ToolHygieneInputTool } from "./guardrails-core-tool-hygiene";
import { evaluateAutonomyLaneTaskSelection, readAutonomyHandoffFocusTaskIds } from "./guardrails-core-autonomy-task-selector";
import { consumeContextPreloadPack } from "./context-watchdog-continuation";
import { buildUnavailableGitDirtySnapshot, readGitDirtySnapshot } from "./guardrails-core-git-maintenance-surface";

export function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function inferDelegationCapabilityDefaults(cwd: string): {
  preloadDecision: "use-pack" | "fallback-canonical";
  dirtySignal: "clean" | "dirty" | "unknown";
} {
  const preload = consumeContextPreloadPack(cwd, { profile: "control-plane-core" });
  let dirtySignal: "clean" | "dirty" | "unknown" = "unknown";
  try {
    const snapshot = readGitDirtySnapshot(cwd);
    dirtySignal = snapshot.clean ? "clean" : "dirty";
  } catch (error) {
    const unavailable = buildUnavailableGitDirtySnapshot(error);
    dirtySignal = unavailable.available ? (unavailable.clean ? "clean" : "dirty") : "unknown";
  }
  return {
    preloadDecision: preload.decision,
    dirtySignal,
  };
}

export type AutoAdvanceCompositeDecision = {
  decision: "eligible" | "blocked";
  blockedReasons: string[];
  source: "override" | "telemetry" | "telemetry+live" | "live-board-fallback";
  liveSnapshot: {
    decision: "eligible" | "blocked";
    blockedReasons: string[];
    focusTaskIds: string[];
    nextTaskId?: string;
    focusSelectionReason: string;
  };
};

export function inferLiveAutoAdvanceSnapshot(cwd: string): AutoAdvanceCompositeDecision["liveSnapshot"] {
  const focusTaskIds = readAutonomyHandoffFocusTaskIds(cwd);
  const focusSelection = evaluateAutonomyLaneTaskSelection(cwd, {
    sampleLimit: 5,
    focusTaskIds,
    focusSource: focusTaskIds.length > 0 ? "handoff" : undefined,
  });
  const fallbackSelection = evaluateAutonomyLaneTaskSelection(cwd, { sampleLimit: 5 });

  if (!(focusSelection.reason === "focus-complete" && focusTaskIds.length > 0)) {
    return {
      decision: "blocked",
      blockedReasons: [focusTaskIds.length > 0 ? "focus-not-complete" : "focus-missing"],
      focusTaskIds,
      nextTaskId: fallbackSelection.nextTaskId,
      focusSelectionReason: focusSelection.reason,
    };
  }

  if (!fallbackSelection.ready || !fallbackSelection.nextTaskId) {
    return {
      decision: "blocked",
      blockedReasons: ["no-eligible-local-safe-successor"],
      focusTaskIds,
      nextTaskId: fallbackSelection.nextTaskId,
      focusSelectionReason: focusSelection.reason,
    };
  }

  return {
    decision: "eligible",
    blockedReasons: [],
    focusTaskIds,
    nextTaskId: fallbackSelection.nextTaskId,
    focusSelectionReason: focusSelection.reason,
  };
}

export function resolveAutoAdvanceCompositeDecision(input: {
  autoAdvanceDecisionOverride?: unknown;
  autoAdvanceBlockedReasonsOverride?: unknown;
  telemetryDecision: "ready" | "needs-evidence";
  telemetryBlockedReasons: string[];
  telemetryEligibleEvents: number;
  liveSnapshot: AutoAdvanceCompositeDecision["liveSnapshot"];
}): AutoAdvanceCompositeDecision {
  if (typeof input.autoAdvanceDecisionOverride === "string") {
    const decision = input.autoAdvanceDecisionOverride === "eligible" ? "eligible" : "blocked";
    const blockedReasons = Array.isArray(input.autoAdvanceBlockedReasonsOverride)
      ? normalizeAutoAdvanceBlockedReasons((input.autoAdvanceBlockedReasonsOverride as unknown[])
        .filter((row): row is string => typeof row === "string" && row.trim().length > 0))
      : [];
    return {
      decision,
      blockedReasons: decision === "blocked" ? (blockedReasons.length > 0 ? blockedReasons : ["override-blocked"]) : [],
      source: "override",
      liveSnapshot: input.liveSnapshot,
    };
  }

  const telemetryDecision = input.telemetryDecision === "ready" && input.telemetryEligibleEvents > 0
    ? "eligible"
    : "blocked";
  const telemetryReasons = input.telemetryBlockedReasons.length > 0
    ? input.telemetryBlockedReasons
    : telemetryDecision === "blocked"
      ? ["auto-advance-telemetry-not-ready"]
      : [];

  if (telemetryDecision === "eligible") {
    return {
      decision: "eligible",
      blockedReasons: [],
      source: "telemetry",
      liveSnapshot: input.liveSnapshot,
    };
  }

  if (input.liveSnapshot.decision === "eligible") {
    return {
      decision: "eligible",
      blockedReasons: [],
      source: "live-board-fallback",
      liveSnapshot: input.liveSnapshot,
    };
  }

  const blockedReasons = normalizeAutoAdvanceBlockedReasons(Array.from(new Set([...telemetryReasons, ...input.liveSnapshot.blockedReasons])));
  return {
    decision: "blocked",
    blockedReasons: blockedReasons.length > 0 ? blockedReasons : ["auto-advance-telemetry-not-ready"],
    source: "telemetry+live",
    liveSnapshot: input.liveSnapshot,
  };
}

export function normalizeAutoAdvanceBlockedReasons(reasons: string[]): string[] {
  const normalized = [...new Set(reasons.filter((row): row is string => typeof row === "string" && row.trim().length > 0))];
  if (normalized.length > 1) {
    return normalized.filter((row) => row !== "unknown");
  }
  return normalized;
}

export type EffectiveTelemetrySignals = {
  decision: "ready" | "needs-evidence";
  score: number;
  blockedRatePct: number;
  source: "override" | "telemetry" | "live-fallback-equivalent";
  normalized: boolean;
};

export function clampUnitIntervalPercent(value: unknown, fallback = 0): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return Math.max(0, Math.min(100, Math.round(fallback)));
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function resolveEffectiveTelemetrySignals(input: {
  telemetryDecisionOverride?: unknown;
  telemetryScoreOverride?: unknown;
  telemetryBlockedRatePctOverride?: unknown;
  telemetryDecisionRaw: "ready" | "needs-evidence";
  telemetryScoreRaw: number;
  telemetryBlockedRatePctRaw: number;
  autoAdvanceComposite: AutoAdvanceCompositeDecision;
}): EffectiveTelemetrySignals {
  const baseScore = clampUnitIntervalPercent(input.telemetryScoreRaw, 0);
  const baseBlockedRatePct = clampUnitIntervalPercent(input.telemetryBlockedRatePctRaw, 100);

  if (typeof input.telemetryDecisionOverride === "string") {
    return {
      decision: input.telemetryDecisionOverride === "ready" ? "ready" : "needs-evidence",
      score: clampUnitIntervalPercent(input.telemetryScoreOverride, baseScore),
      blockedRatePct: clampUnitIntervalPercent(input.telemetryBlockedRatePctOverride, baseBlockedRatePct),
      source: "override",
      normalized: false,
    };
  }

  if (input.autoAdvanceComposite.source === "live-board-fallback" && input.autoAdvanceComposite.decision === "eligible") {
    return {
      decision: "ready",
      score: Math.max(60, baseScore),
      blockedRatePct: Math.min(60, baseBlockedRatePct),
      source: "live-fallback-equivalent",
      normalized: true,
    };
  }

  return {
    decision: input.telemetryDecisionRaw,
    score: baseScore,
    blockedRatePct: baseBlockedRatePct,
    source: "telemetry",
    normalized: false,
  };
}

export function buildSimpleDelegateResolutionSummary(input: {
  baseSummary: string;
  source: AutoAdvanceCompositeDecision["source"];
  liveDecision: "eligible" | "blocked";
  liveNextTaskId?: string;
  telemetrySource?: EffectiveTelemetrySignals["source"];
}): string {
  return [
    input.baseSummary,
    `source=${input.source}`,
    `liveAutoAdvance=${input.liveDecision}`,
    input.liveNextTaskId ? `liveNext=${input.liveNextTaskId}` : undefined,
    input.telemetrySource ? `telemetrySource=${input.telemetrySource}` : undefined,
  ].filter(Boolean).join(" ");
}

export type DelegationReadinessDecision = "ready-simple-delegate" | "local-execute-first" | "defer";
export type DelegationReadinessCode =
  | "delegation-readiness-ready-simple-delegate"
  | "delegation-readiness-local-execute-first"
  | "delegation-readiness-defer-blocked";

export function buildDelegationReadinessStatus(input: {
  delegatePacket: ReturnType<typeof buildDelegateOrExecuteDecisionPacket>;
  rehearsalPacket: ReturnType<typeof buildSimpleDelegateRehearsalDecisionPacket>;
}): {
  decision: DelegationReadinessDecision;
  recommendationCode: DelegationReadinessCode;
  recommendation: string;
  nextAction: string;
  blockers: string[];
  summary: string;
} {
  const blockers = [...new Set([
    ...input.delegatePacket.blockers,
    ...input.rehearsalPacket.blockers,
  ])];

  if (input.delegatePacket.recommendedOption === "simple-delegate" && input.rehearsalPacket.decision === "ready") {
    const summary = [
      "delegation-readiness-status:",
      "decision=ready-simple-delegate",
      "code=delegation-readiness-ready-simple-delegate",
      `execute=${input.delegatePacket.recommendedOption}`,
      `rehearsal=${input.rehearsalPacket.decision}`,
      "next=simple_delegate_rehearsal_start_packet",
      "authorization=none",
    ].join(" ");
    return {
      decision: "ready-simple-delegate",
      recommendationCode: "delegation-readiness-ready-simple-delegate",
      recommendation: "simple-delegate runway looks ready; keep one-task canary with explicit human start/defer decision.",
      nextAction: "run simple_delegate_rehearsal_start_packet and apply explicit human start/defer decision.",
      blockers,
      summary,
    };
  }

  if (input.delegatePacket.recommendedOption === "local-execute" || input.rehearsalPacket.decision === "needs-evidence") {
    const summary = [
      "delegation-readiness-status:",
      "decision=local-execute-first",
      "code=delegation-readiness-local-execute-first",
      `execute=${input.delegatePacket.recommendedOption}`,
      `rehearsal=${input.rehearsalPacket.decision}`,
      "next=collect-bounded-evidence",
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
      "authorization=none",
    ].filter(Boolean).join(" ");
    return {
      decision: "local-execute-first",
      recommendationCode: "delegation-readiness-local-execute-first",
      recommendation: "continue local execution slices while collecting delegation evidence (mix + auto-advance telemetry).",
      nextAction: "execute one bounded local-safe slice and refresh delegation/simple-delegate packets.",
      blockers,
      summary,
    };
  }

  const summary = [
    "delegation-readiness-status:",
    "decision=defer",
    "code=delegation-readiness-defer-blocked",
    `execute=${input.delegatePacket.recommendedOption}`,
    `rehearsal=${input.rehearsalPacket.decision}`,
    "next=resolve-blockers",
    blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    "authorization=none",
  ].filter(Boolean).join(" ");

  return {
    decision: "defer",
    recommendationCode: "delegation-readiness-defer-blocked",
    recommendation: "delegation remains blocked; resolve hard blockers before attempting simple-delegate canary.",
    nextAction: "resolve blockers and rerun readiness packets before delegation attempt.",
    blockers,
    summary,
  };
}

export type OperationalRunwayRecommendedOption = "local-execute" | "simple-delegate" | "defer";
export type OperationalRunwayRecommendationCode =
  | "operational-runway-simple-delegate"
  | "operational-runway-local-execute"
  | "operational-runway-defer-blocked";
export type OperationalBackgroundDecision = "ready-window" | "needs-evidence" | "blocked";

export function resolveOperationalBackgroundDecision(input: {
  planDecision: string;
  rehearsalDecision: "ready" | "needs-evidence" | "blocked";
}): OperationalBackgroundDecision {
  if (input.planDecision === "blocked" || input.rehearsalDecision === "blocked") return "blocked";
  if (input.planDecision === "ready-for-design" && input.rehearsalDecision === "ready") return "ready-window";
  return "needs-evidence";
}

export function buildOperationalRunwayPacket(input: {
  delegation: {
    decision: DelegationReadinessDecision;
    recommendationCode: DelegationReadinessCode;
    blockers: string[];
  };
  background: {
    planDecision: string;
    rehearsalDecision: "ready" | "needs-evidence" | "blocked";
    planBlockers: string[];
    rehearsalBlockers: string[];
  };
}): {
  recommendedOption: OperationalRunwayRecommendedOption;
  recommendationCode: OperationalRunwayRecommendationCode;
  recommendation: string;
  nextAction: string;
  blockers: string[];
  normalizedBlockers: string[];
  summary: string;
  decision: {
    delegation: DelegationReadinessDecision;
    background: OperationalBackgroundDecision;
  };
} {
  const backgroundDecision = resolveOperationalBackgroundDecision({
    planDecision: input.background.planDecision,
    rehearsalDecision: input.background.rehearsalDecision,
  });

  const normalizedBlockers = [...new Set([
    ...input.delegation.blockers,
    ...input.background.planBlockers,
    ...input.background.rehearsalBlockers,
  ].filter((row) => typeof row === "string" && row.trim().length > 0))];

  if (input.delegation.decision === "defer" || backgroundDecision === "blocked") {
    const summary = [
      "operational-runway-packet:",
      "option=defer",
      "code=operational-runway-defer-blocked",
      `delegation=${input.delegation.decision}`,
      `background=${backgroundDecision}`,
      normalizedBlockers.length > 0 ? `blockers=${normalizedBlockers.join("|")}` : undefined,
      "authorization=none",
    ].filter(Boolean).join(" ");
    return {
      recommendedOption: "defer",
      recommendationCode: "operational-runway-defer-blocked",
      recommendation: "runway blocked; resolve hard blockers before attempting scale promotion.",
      nextAction: "resolve normalized blockers and rerun delegation/background packets.",
      blockers: normalizedBlockers,
      normalizedBlockers,
      summary,
      decision: {
        delegation: input.delegation.decision,
        background: backgroundDecision,
      },
    };
  }

  if (input.delegation.decision === "ready-simple-delegate" && backgroundDecision === "ready-window") {
    const summary = [
      "operational-runway-packet:",
      "option=simple-delegate",
      "code=operational-runway-simple-delegate",
      `delegation=${input.delegation.decision}`,
      `background=${backgroundDecision}`,
      "authorization=none",
    ].join(" ");
    return {
      recommendedOption: "simple-delegate",
      recommendationCode: "operational-runway-simple-delegate",
      recommendation: "delegation and background runway are mature; run bounded simple-delegate canary under explicit human start/defer decision.",
      nextAction: "run simple_delegate_rehearsal_start_packet, then choose explicit start/defer; keep background packet as corroborating evidence.",
      blockers: normalizedBlockers,
      normalizedBlockers,
      summary,
      decision: {
        delegation: input.delegation.decision,
        background: backgroundDecision,
      },
    };
  }

  const summary = [
    "operational-runway-packet:",
    "option=local-execute",
    "code=operational-runway-local-execute",
    `delegation=${input.delegation.decision}`,
    `background=${backgroundDecision}`,
    normalizedBlockers.length > 0 ? `blockers=${normalizedBlockers.join("|")}` : undefined,
    "authorization=none",
  ].filter(Boolean).join(" ");
  return {
    recommendedOption: "local-execute",
    recommendationCode: "operational-runway-local-execute",
    recommendation: "runway still needs evidence; continue local execution slices while collecting delegation/background readiness signals.",
    nextAction: "execute one bounded local-safe slice, then refresh delegation_readiness_status_packet and background_process_readiness_packet.",
    blockers: normalizedBlockers,
    normalizedBlockers,
    summary,
    decision: {
      delegation: input.delegation.decision,
      background: backgroundDecision,
    },
  };
}

export type UnlockChecklist = {
  decision: "ready" | "needs-action";
  topBlockers: string[];
  nextAction: string;
  items: string[];
  summary: string;
};

export function buildUnlockChecklist(input: {
  option: "simple-delegate" | "local-execute" | "defer";
  blockers: string[];
  nextAction: string;
}): UnlockChecklist {
  const topBlockers = [...new Set(input.blockers.filter((row) => typeof row === "string" && row.trim().length > 0))].slice(0, 3);
  const decision = input.option === "simple-delegate" ? "ready" : "needs-action";
  const items = [
    ...topBlockers.map((blocker, index) => `blocker:${index + 1}:${blocker}`),
    `next:${input.nextAction}`,
  ];
  const summary = [
    "unlock-checklist:",
    `decision=${decision}`,
    topBlockers.length > 0 ? `topBlockers=${topBlockers.join("|")}` : "topBlockers=none",
    `next=${input.nextAction}`,
  ].join(" ");
  return {
    decision,
    topBlockers,
    nextAction: input.nextAction,
    items,
    summary,
  };
}

export type OperatorPauseOption = {
  option: "start" | "defer" | "abort";
  impact: string;
};

export type SimpleDelegateOperatorPauseBrief = {
  whyPaused: string;
  gate: "human-canary-decision" | "blocked-rehearsal-gate";
  focusTaskId?: string;
  focusMnemonic?: string;
  nextTaskId?: string;
  nextTaskMnemonic?: string;
  options: OperatorPauseOption[];
  recommendation: "start" | "defer" | "abort";
};

export function readTaskDescriptionById(cwd: string, taskId?: string): string | undefined {
  if (!taskId) return undefined;
  const filePath = path.join(cwd, ".project", "tasks.json");
  if (!existsSync(filePath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    const tasks = Array.isArray(parsed)
      ? parsed
      : (parsed as { tasks?: unknown[] } | undefined)?.tasks;
    if (!Array.isArray(tasks)) return undefined;
    const match = tasks.find((task) => {
      const id = (task as { id?: unknown }).id;
      return typeof id === "string" && id.toUpperCase() === taskId.toUpperCase();
    }) as { description?: unknown } | undefined;
    return typeof match?.description === "string" ? match.description.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function toTaskMnemonic(taskId?: string, description?: string): string | undefined {
  if (!taskId) return undefined;
  const cleanedDescription = typeof description === "string"
    ? description
      .replace(/\[[^\]]+\]\s*/g, "")
      .replace(/\s+/g, " ")
      .trim()
    : "";
  const shortDescription = cleanedDescription.length > 0
    ? cleanedDescription.split(/[.;]/)[0].trim().slice(0, 72)
    : "";
  return shortDescription.length > 0 ? `${taskId}:${shortDescription}` : taskId;
}

export function buildSimpleDelegateOperatorPauseBrief(input: {
  cwd: string;
  startDecision: "ready-for-human-decision" | "blocked";
  blockers: string[];
  focusTaskId?: string;
  nextTaskId?: string;
}): SimpleDelegateOperatorPauseBrief {
  const focusTaskId = input.focusTaskId;
  const nextTaskId = input.nextTaskId;
  const focusTaskMnemonic = toTaskMnemonic(focusTaskId, readTaskDescriptionById(input.cwd, focusTaskId));
  const nextTaskMnemonic = toTaskMnemonic(nextTaskId, readTaskDescriptionById(input.cwd, nextTaskId));

  if (input.startDecision === "ready-for-human-decision") {
    return {
      whyPaused: "Canary gate reached: explicit human start/defer decision is required.",
      gate: "human-canary-decision",
      focusTaskId,
      focusMnemonic: focusTaskMnemonic,
      nextTaskId,
      nextTaskMnemonic,
      options: [
        { option: "start", impact: "Executes one bounded local-safe canary slice now." },
        { option: "defer", impact: "Keeps canary pending and continues local-safe throughput." },
        { option: "abort", impact: "Cancels this canary attempt and returns to backlog-only flow." },
      ],
      recommendation: "start",
    };
  }

  return {
    whyPaused: `Canary start remains blocked: ${(input.blockers.slice(0, 3).join("|") || "unknown-blocker")}.`,
    gate: "blocked-rehearsal-gate",
    focusTaskId,
    focusMnemonic: focusTaskMnemonic,
    nextTaskId,
    nextTaskMnemonic,
    options: [
      { option: "start", impact: "Not recommended while blockers are active." },
      { option: "defer", impact: "Wait for blockers to clear and retry at next checkpoint." },
      { option: "abort", impact: "Drop canary lane and keep only non-canary local-safe work." },
    ],
    recommendation: "defer",
  };
}

export function formatSimpleDelegateOperatorPauseBriefSummary(brief: SimpleDelegateOperatorPauseBrief): string {
  return [
    `why=${brief.gate}`,
    brief.focusMnemonic ? `focus=${brief.focusMnemonic}` : undefined,
    brief.nextTaskMnemonic ? `next=${brief.nextTaskMnemonic}` : undefined,
    `recommend=${brief.recommendation}`,
  ].filter(Boolean).join(" ");
}

export function inferBackgroundCapabilitySignals(toolNames: Set<string>): {
  hasProcessRegistry: boolean;
  hasPortLeaseLock: boolean;
  hasBoundedLogTail: boolean;
  hasStructuredStacktraceCapture: boolean;
  hasHealthcheckProbe: boolean;
  hasGracefulStopThenKill: boolean;
  hasReloadHandoffCleanup: boolean;
} {
  const has = (name: string): boolean => toolNames.has(name);
  const hasAnyContaining = (fragment: string): boolean => {
    const f = fragment.toLowerCase();
    return Array.from(toolNames).some((name) => name.toLowerCase().includes(f));
  };
  const hasBgStatus = has("bg_status");

  return {
    hasProcessRegistry: hasBgStatus,
    hasPortLeaseLock: has("background_process_plan") && hasAnyContaining("port"),
    hasBoundedLogTail: hasBgStatus,
    hasStructuredStacktraceCapture: hasAnyContaining("stacktrace") || has("background_process_plan"),
    hasHealthcheckProbe: hasAnyContaining("healthcheck"),
    hasGracefulStopThenKill: hasBgStatus,
    hasReloadHandoffCleanup: hasAnyContaining("context_watch_checkpoint") || hasAnyContaining("handoff"),
  };
}

export function toolInfoToInput(tool: unknown): ToolHygieneInputTool | undefined {
  if (!tool || typeof tool !== "object") return undefined;
  const t = tool as Record<string, unknown>;
  if (typeof t.name !== "string") return undefined;
  return {
    name: t.name,
    description: typeof t.description === "string" ? t.description : typeof t.label === "string" ? t.label : undefined,
    parameters: t.parameters,
  };
}
