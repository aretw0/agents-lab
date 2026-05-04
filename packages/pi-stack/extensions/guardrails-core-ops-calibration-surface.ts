import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { buildBackgroundProcessReadinessScore, resolveBackgroundProcessControlPlan } from "./guardrails-core-background-process";
import { evaluateBackgroundProcessRehearsal } from "./guardrails-core-background-process-rehearsal";
import {
  buildDelegateOrExecuteDecisionPacket,
  buildOpsCalibrationDecisionPacket,
  buildSimpleDelegateRehearsalDecisionPacket,
  buildSimpleDelegateRehearsalStartPacket,
} from "./guardrails-core-ops-calibration";
import { buildAgentsAsToolsCalibrationScore, type ToolHygieneInputTool } from "./guardrails-core-tool-hygiene";
import { evaluateDelegationLaneCapabilitySnapshot } from "./guardrails-core-autonomy-lane";
import {
  evaluateAutonomyLaneTaskSelection,
  readAutonomyHandoffFocusTaskIds,
} from "./guardrails-core-autonomy-task-selector";
import { consumeContextPreloadPack } from "./context-watchdog-continuation";
import { buildUnavailableGitDirtySnapshot, readGitDirtySnapshot } from "./guardrails-core-git-maintenance-surface";
import {
  collectSessionRecords,
  parseAutoAdvanceHardIntentTelemetry,
  parseDelegationMixScore,
} from "./session-analytics";

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function inferDelegationCapabilityDefaults(cwd: string): {
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

type AutoAdvanceCompositeDecision = {
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

function inferLiveAutoAdvanceSnapshot(cwd: string): AutoAdvanceCompositeDecision["liveSnapshot"] {
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

function resolveAutoAdvanceCompositeDecision(input: {
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

function normalizeAutoAdvanceBlockedReasons(reasons: string[]): string[] {
  const normalized = [...new Set(reasons.filter((row): row is string => typeof row === "string" && row.trim().length > 0))];
  if (normalized.length > 1) {
    return normalized.filter((row) => row !== "unknown");
  }
  return normalized;
}

type EffectiveTelemetrySignals = {
  decision: "ready" | "needs-evidence";
  score: number;
  blockedRatePct: number;
  source: "override" | "telemetry" | "live-fallback-equivalent";
  normalized: boolean;
};

function clampUnitIntervalPercent(value: unknown, fallback = 0): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return Math.max(0, Math.min(100, Math.round(fallback)));
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function resolveEffectiveTelemetrySignals(input: {
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

function buildSimpleDelegateResolutionSummary(input: {
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

type DelegationReadinessDecision = "ready-simple-delegate" | "local-execute-first" | "defer";
type DelegationReadinessCode =
  | "delegation-readiness-ready-simple-delegate"
  | "delegation-readiness-local-execute-first"
  | "delegation-readiness-defer-blocked";

function buildDelegationReadinessStatus(input: {
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

type OperationalRunwayRecommendedOption = "local-execute" | "simple-delegate" | "defer";
type OperationalRunwayRecommendationCode =
  | "operational-runway-simple-delegate"
  | "operational-runway-local-execute"
  | "operational-runway-defer-blocked";
type OperationalBackgroundDecision = "ready-window" | "needs-evidence" | "blocked";

function resolveOperationalBackgroundDecision(input: {
  planDecision: string;
  rehearsalDecision: "ready" | "needs-evidence" | "blocked";
}): OperationalBackgroundDecision {
  if (input.planDecision === "blocked" || input.rehearsalDecision === "blocked") return "blocked";
  if (input.planDecision === "ready-for-design" && input.rehearsalDecision === "ready") return "ready-window";
  return "needs-evidence";
}

function buildOperationalRunwayPacket(input: {
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

type OperatorPauseOption = {
  option: "start" | "defer" | "abort";
  impact: string;
};

type SimpleDelegateOperatorPauseBrief = {
  whyPaused: string;
  gate: "human-canary-decision" | "blocked-rehearsal-gate";
  focusTaskId?: string;
  focusMnemonic?: string;
  nextTaskId?: string;
  nextTaskMnemonic?: string;
  options: OperatorPauseOption[];
  recommendation: "start" | "defer" | "abort";
};

function readTaskDescriptionById(cwd: string, taskId?: string): string | undefined {
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

function toTaskMnemonic(taskId?: string, description?: string): string | undefined {
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

function buildSimpleDelegateOperatorPauseBrief(input: {
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

function formatSimpleDelegateOperatorPauseBriefSummary(brief: SimpleDelegateOperatorPauseBrief): string {
  return [
    `why=${brief.gate}`,
    brief.focusMnemonic ? `focus=${brief.focusMnemonic}` : undefined,
    brief.nextTaskMnemonic ? `next=${brief.nextTaskMnemonic}` : undefined,
    `recommend=${brief.recommendation}`,
  ].filter(Boolean).join(" ");
}

function inferBackgroundCapabilitySignals(toolNames: Set<string>): {
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

function toolInfoToInput(tool: unknown): ToolHygieneInputTool | undefined {
  if (!tool || typeof tool !== "object") return undefined;
  const t = tool as Record<string, unknown>;
  if (typeof t.name !== "string") return undefined;
  return {
    name: t.name,
    description: typeof t.description === "string" ? t.description : typeof t.label === "string" ? t.label : undefined,
    parameters: t.parameters,
  };
}

export function registerGuardrailsOpsCalibrationSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "delegate_or_execute_decision_packet",
    label: "Delegate or Execute Decision Packet",
    description: "Report-only packet recommending local-execute vs simple-delegate vs defer from delegation capability + mix signals. Never dispatches execution.",
    parameters: Type.Object({
      lookback_hours: Type.Optional(Type.Number({ description: "How many hours back to scan local session evidence for mix score. Default: 24." })),
      preload_decision: Type.Optional(Type.String({ description: "use-pack | fallback-canonical" })),
      dirty_signal: Type.Optional(Type.String({ description: "clean | dirty | unknown" })),
      monitor_classify_failures: Type.Optional(Type.Number({ description: "Classify-failure count. Default 0." })),
      subagents_ready: Type.Optional(Type.Boolean({ description: "Subagent readiness signal. Default true." })),
      capability_decision: Type.Optional(Type.String({ description: "Override capability decision: ready | needs-evidence | blocked" })),
      capability_recommendation_code: Type.Optional(Type.String({ description: "Optional capability recommendation code override." })),
      capability_blockers: Type.Optional(Type.Array(Type.String())),
      capability_evidence_gaps: Type.Optional(Type.Array(Type.String())),
      mix_decision: Type.Optional(Type.String({ description: "Override mix decision: ready | needs-evidence" })),
      mix_score: Type.Optional(Type.Number({ description: "Override mix score (0..100)." })),
      mix_recommendation_code: Type.Optional(Type.String({ description: "Optional mix recommendation code override." })),
      mix_simple_delegate_events: Type.Optional(Type.Number({ description: "Override simple-delegate event count." })),
      mix_swarm_events: Type.Optional(Type.Number({ description: "Override swarm event count." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const lookbackHoursRaw = Number(p.lookback_hours);
      const lookbackHours = Number.isFinite(lookbackHoursRaw) && lookbackHoursRaw > 0
        ? lookbackHoursRaw
        : 24;
      const cwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();

      const inferredCapabilityDefaults = inferDelegationCapabilityDefaults(cwd);
      const capability = evaluateDelegationLaneCapabilitySnapshot({
        preloadDecision: typeof p.preload_decision === "string"
          ? p.preload_decision
          : inferredCapabilityDefaults.preloadDecision,
        dirtySignal: typeof p.dirty_signal === "string"
          ? p.dirty_signal
          : inferredCapabilityDefaults.dirtySignal,
        monitorClassifyFailures: typeof p.monitor_classify_failures === "number" ? p.monitor_classify_failures : 0,
        subagentsReady: typeof p.subagents_ready === "boolean" ? p.subagents_ready : true,
      });

      const collected = collectSessionRecords(cwd, lookbackHours);
      const mix = parseDelegationMixScore(collected.allRecords, lookbackHours, collected.files.length);

      const packet = buildDelegateOrExecuteDecisionPacket({
        capabilityDecision: typeof p.capability_decision === "string"
          ? p.capability_decision as "ready" | "needs-evidence" | "blocked"
          : capability.decision,
        capabilityRecommendationCode: typeof p.capability_recommendation_code === "string"
          ? p.capability_recommendation_code
          : capability.recommendationCode,
        capabilityBlockers: Array.isArray(p.capability_blockers) ? p.capability_blockers as string[] : capability.blockers,
        capabilityEvidenceGaps: Array.isArray(p.capability_evidence_gaps) ? p.capability_evidence_gaps as string[] : capability.evidenceGaps,
        mixDecision: typeof p.mix_decision === "string"
          ? p.mix_decision as "ready" | "needs-evidence"
          : mix.decision,
        mixScore: typeof p.mix_score === "number" ? p.mix_score : mix.score,
        mixRecommendationCode: typeof p.mix_recommendation_code === "string"
          ? p.mix_recommendation_code
          : mix.recommendationCode,
        mixSimpleDelegateEvents: typeof p.mix_simple_delegate_events === "number"
          ? p.mix_simple_delegate_events
          : mix.totals.simpleDelegate,
        mixSwarmEvents: typeof p.mix_swarm_events === "number"
          ? p.mix_swarm_events
          : mix.totals.swarm,
      });

      return {
        content: [{ type: "text", text: packet.summary }],
        details: {
          ...packet,
          capability,
          inferredCapabilityDefaults,
          mix,
          scan: collected.scan,
        },
      };
    },
  });

  pi.registerTool({
    name: "simple_delegate_rehearsal_packet",
    label: "Simple-Delegate Rehearsal Packet",
    description: "Report-only readiness packet for bounded simple-delegate rehearsal from capability + mix + auto-advance telemetry signals.",
    parameters: Type.Object({
      lookback_hours: Type.Optional(Type.Number({ description: "How many hours back to scan local session evidence. Default: 24." })),
      preload_decision: Type.Optional(Type.String({ description: "use-pack | fallback-canonical" })),
      dirty_signal: Type.Optional(Type.String({ description: "clean | dirty | unknown" })),
      monitor_classify_failures: Type.Optional(Type.Number({ description: "Classify-failure count. Default 0." })),
      subagents_ready: Type.Optional(Type.Boolean({ description: "Subagent readiness signal. Default true." })),
      capability_decision: Type.Optional(Type.String({ description: "Override capability decision: ready | needs-evidence | blocked" })),
      capability_recommendation_code: Type.Optional(Type.String({ description: "Optional capability recommendation code override." })),
      capability_blockers: Type.Optional(Type.Array(Type.String())),
      mix_decision: Type.Optional(Type.String({ description: "Override mix decision: ready | needs-evidence" })),
      mix_score: Type.Optional(Type.Number({ description: "Override mix score (0..100)." })),
      mix_simple_delegate_events: Type.Optional(Type.Number({ description: "Override simple-delegate event count." })),
      auto_advance_decision: Type.Optional(Type.String({ description: "Override auto-advance decision: eligible | blocked" })),
      auto_advance_blocked_reasons: Type.Optional(Type.Array(Type.String())),
      telemetry_decision: Type.Optional(Type.String({ description: "Override telemetry decision: ready | needs-evidence" })),
      telemetry_score: Type.Optional(Type.Number({ description: "Override telemetry score (0..100)." })),
      telemetry_blocked_rate_pct: Type.Optional(Type.Number({ description: "Override telemetry blocked rate pct (0..100)." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const lookbackHoursRaw = Number(p.lookback_hours);
      const lookbackHours = Number.isFinite(lookbackHoursRaw) && lookbackHoursRaw > 0
        ? lookbackHoursRaw
        : 24;
      const cwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();

      const inferredCapabilityDefaults = inferDelegationCapabilityDefaults(cwd);
      const capability = evaluateDelegationLaneCapabilitySnapshot({
        preloadDecision: typeof p.preload_decision === "string"
          ? p.preload_decision
          : inferredCapabilityDefaults.preloadDecision,
        dirtySignal: typeof p.dirty_signal === "string"
          ? p.dirty_signal
          : inferredCapabilityDefaults.dirtySignal,
        monitorClassifyFailures: typeof p.monitor_classify_failures === "number" ? p.monitor_classify_failures : 0,
        subagentsReady: typeof p.subagents_ready === "boolean" ? p.subagents_ready : true,
      });

      const collected = collectSessionRecords(cwd, lookbackHours);
      const mix = parseDelegationMixScore(collected.allRecords, lookbackHours, collected.files.length);
      const autoAdvanceTelemetry = parseAutoAdvanceHardIntentTelemetry(collected.allRecords, lookbackHours, collected.files.length);

      const telemetryBlockedReasons = autoAdvanceTelemetry.blockedReasons.map((row) => row.reason);
      const liveAutoAdvanceSnapshot = inferLiveAutoAdvanceSnapshot(cwd);
      const autoAdvanceComposite = resolveAutoAdvanceCompositeDecision({
        autoAdvanceDecisionOverride: p.auto_advance_decision,
        autoAdvanceBlockedReasonsOverride: p.auto_advance_blocked_reasons,
        telemetryDecision: autoAdvanceTelemetry.decision,
        telemetryBlockedReasons,
        telemetryEligibleEvents: autoAdvanceTelemetry.totals.eligibleEvents,
        liveSnapshot: liveAutoAdvanceSnapshot,
      });

      const effectiveTelemetry = resolveEffectiveTelemetrySignals({
        telemetryDecisionOverride: p.telemetry_decision,
        telemetryScoreOverride: p.telemetry_score,
        telemetryBlockedRatePctOverride: p.telemetry_blocked_rate_pct,
        telemetryDecisionRaw: autoAdvanceTelemetry.decision,
        telemetryScoreRaw: autoAdvanceTelemetry.score,
        telemetryBlockedRatePctRaw: autoAdvanceTelemetry.totals.blockedRatePct,
        autoAdvanceComposite,
      });

      const packet = buildSimpleDelegateRehearsalDecisionPacket({
        capabilityDecision: typeof p.capability_decision === "string"
          ? p.capability_decision as "ready" | "needs-evidence" | "blocked"
          : capability.decision,
        capabilityRecommendationCode: typeof p.capability_recommendation_code === "string"
          ? p.capability_recommendation_code
          : capability.recommendationCode,
        capabilityBlockers: Array.isArray(p.capability_blockers) ? p.capability_blockers as string[] : capability.blockers,
        mixDecision: typeof p.mix_decision === "string"
          ? p.mix_decision as "ready" | "needs-evidence"
          : mix.decision,
        mixScore: typeof p.mix_score === "number" ? p.mix_score : mix.score,
        mixSimpleDelegateEvents: typeof p.mix_simple_delegate_events === "number"
          ? p.mix_simple_delegate_events
          : mix.totals.simpleDelegate,
        autoAdvanceDecision: autoAdvanceComposite.decision,
        autoAdvanceBlockedReasons: autoAdvanceComposite.blockedReasons,
        telemetryDecision: effectiveTelemetry.decision,
        telemetryScore: effectiveTelemetry.score,
        telemetryBlockedRatePct: effectiveTelemetry.blockedRatePct,
      });

      const summary = buildSimpleDelegateResolutionSummary({
        baseSummary: packet.summary,
        source: autoAdvanceComposite.source,
        liveDecision: liveAutoAdvanceSnapshot.decision,
        liveNextTaskId: liveAutoAdvanceSnapshot.nextTaskId,
        telemetrySource: effectiveTelemetry.source,
      });

      return {
        content: [{ type: "text", text: summary }],
        details: {
          ...packet,
          summary,
          capability,
          inferredCapabilityDefaults,
          mix,
          autoAdvanceTelemetry,
          effectiveTelemetrySignals: effectiveTelemetry,
          autoAdvanceLiveSnapshot: liveAutoAdvanceSnapshot,
          autoAdvanceResolutionSource: autoAdvanceComposite.source,
          scan: collected.scan,
        },
      };
    },
  });

  pi.registerTool({
    name: "delegation_readiness_status_packet",
    label: "Delegation Readiness Status Packet",
    description: "Report-only unified runway status composing delegation + background readiness with explicit options local-execute | simple-delegate | defer. Never dispatches execution.",
    parameters: Type.Object({
      lookback_hours: Type.Optional(Type.Number({ description: "How many hours back to scan local session evidence. Default: 24." })),
      preload_decision: Type.Optional(Type.String({ description: "use-pack | fallback-canonical" })),
      dirty_signal: Type.Optional(Type.String({ description: "clean | dirty | unknown" })),
      monitor_classify_failures: Type.Optional(Type.Number({ description: "Classify-failure count. Default 0." })),
      subagents_ready: Type.Optional(Type.Boolean({ description: "Subagent readiness signal. Default true." })),
      capability_decision: Type.Optional(Type.String({ description: "Override capability decision: ready | needs-evidence | blocked" })),
      capability_recommendation_code: Type.Optional(Type.String({ description: "Optional capability recommendation code override." })),
      capability_blockers: Type.Optional(Type.Array(Type.String())),
      capability_evidence_gaps: Type.Optional(Type.Array(Type.String())),
      mix_decision: Type.Optional(Type.String({ description: "Override mix decision: ready | needs-evidence" })),
      mix_score: Type.Optional(Type.Number({ description: "Override mix score (0..100)." })),
      mix_recommendation_code: Type.Optional(Type.String({ description: "Optional mix recommendation code override." })),
      mix_simple_delegate_events: Type.Optional(Type.Number({ description: "Override simple-delegate event count." })),
      mix_swarm_events: Type.Optional(Type.Number({ description: "Override swarm event count." })),
      auto_advance_decision: Type.Optional(Type.String({ description: "Override auto-advance decision: eligible | blocked" })),
      auto_advance_blocked_reasons: Type.Optional(Type.Array(Type.String())),
      telemetry_decision: Type.Optional(Type.String({ description: "Override telemetry decision: ready | needs-evidence" })),
      telemetry_score: Type.Optional(Type.Number({ description: "Override telemetry score (0..100)." })),
      telemetry_blocked_rate_pct: Type.Optional(Type.Number({ description: "Override telemetry blocked rate pct (0..100)." })),
      background_kind: Type.Optional(Type.String({ description: "Override background kind (frontend | backend | test-server | worker | generic)." })),
      background_requested_mode: Type.Optional(Type.String({ description: "Override background mode (auto | shared-service | isolated-worker)." })),
      background_needs_server: Type.Optional(Type.Boolean({ description: "Override background server requirement." })),
      background_requested_port: Type.Optional(Type.Number({ description: "Override desired background port." })),
      background_parallel_agents: Type.Optional(Type.Number({ description: "Override expected parallel agents for background runway cue." })),
      background_existing_service_reusable: Type.Optional(Type.Boolean({ description: "Override existing-service-reusable signal for background runway cue." })),
      background_destructive_restart: Type.Optional(Type.Boolean({ description: "Override destructive restart signal for background runway cue." })),
      background_log_tail_max_lines: Type.Optional(Type.Number({ description: "Override log tail max lines for background runway cue." })),
      background_stacktrace_capture: Type.Optional(Type.Boolean({ description: "Override stacktrace capture signal for background runway cue." })),
      background_healthcheck_known: Type.Optional(Type.Boolean({ description: "Override healthcheck-known signal for background runway cue." })),
      background_has_process_registry: Type.Optional(Type.Boolean({ description: "Override process registry capability signal." })),
      background_has_port_lease_lock: Type.Optional(Type.Boolean({ description: "Override port lease/lock capability signal." })),
      background_has_bounded_log_tail: Type.Optional(Type.Boolean({ description: "Override bounded log tail capability signal." })),
      background_has_structured_stacktrace_capture: Type.Optional(Type.Boolean({ description: "Override structured stacktrace capability signal." })),
      background_has_healthcheck_probe: Type.Optional(Type.Boolean({ description: "Override healthcheck probe capability signal." })),
      background_has_graceful_stop_then_kill: Type.Optional(Type.Boolean({ description: "Override graceful-stop capability signal." })),
      background_has_reload_handoff_cleanup: Type.Optional(Type.Boolean({ description: "Override reload/handoff cleanup capability signal." })),
      background_has_plan_surface: Type.Optional(Type.Boolean({ description: "Override background plan-surface availability signal." })),
      background_has_lifecycle_surface: Type.Optional(Type.Boolean({ description: "Override background lifecycle-surface availability signal." })),
      background_rehearsal_slices: Type.Optional(Type.Number({ description: "Override rehearsal slices evidence for background runway cue." })),
      background_stop_source_coverage_pct: Type.Optional(Type.Number({ description: "Override stopSource coverage pct for background runway cue." })),
      background_lifecycle_classified: Type.Optional(Type.Boolean({ description: "Override lifecycle-classified signal for background runway cue." })),
      background_rollback_plan_known: Type.Optional(Type.Boolean({ description: "Override rollback-known signal for background runway cue." })),
      background_unresolved_blockers: Type.Optional(Type.Number({ description: "Override unresolved blockers count for background runway cue." })),
      background_destructive_restart_requested: Type.Optional(Type.Boolean({ description: "Override destructive-restart-requested gate for background runway cue." })),
      background_protected_scope_requested: Type.Optional(Type.Boolean({ description: "Override protected-scope-requested gate for background runway cue." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const lookbackHoursRaw = Number(p.lookback_hours);
      const lookbackHours = Number.isFinite(lookbackHoursRaw) && lookbackHoursRaw > 0
        ? lookbackHoursRaw
        : 24;
      const cwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();

      const inferredCapabilityDefaults = inferDelegationCapabilityDefaults(cwd);
      const capability = evaluateDelegationLaneCapabilitySnapshot({
        preloadDecision: typeof p.preload_decision === "string"
          ? p.preload_decision
          : inferredCapabilityDefaults.preloadDecision,
        dirtySignal: typeof p.dirty_signal === "string"
          ? p.dirty_signal
          : inferredCapabilityDefaults.dirtySignal,
        monitorClassifyFailures: typeof p.monitor_classify_failures === "number" ? p.monitor_classify_failures : 0,
        subagentsReady: typeof p.subagents_ready === "boolean" ? p.subagents_ready : true,
      });

      const collected = collectSessionRecords(cwd, lookbackHours);
      const mix = parseDelegationMixScore(collected.allRecords, lookbackHours, collected.files.length);
      const autoAdvanceTelemetry = parseAutoAdvanceHardIntentTelemetry(collected.allRecords, lookbackHours, collected.files.length);

      const telemetryBlockedReasons = autoAdvanceTelemetry.blockedReasons.map((row) => row.reason);
      const liveAutoAdvanceSnapshot = inferLiveAutoAdvanceSnapshot(cwd);
      const autoAdvanceComposite = resolveAutoAdvanceCompositeDecision({
        autoAdvanceDecisionOverride: p.auto_advance_decision,
        autoAdvanceBlockedReasonsOverride: p.auto_advance_blocked_reasons,
        telemetryDecision: autoAdvanceTelemetry.decision,
        telemetryBlockedReasons,
        telemetryEligibleEvents: autoAdvanceTelemetry.totals.eligibleEvents,
        liveSnapshot: liveAutoAdvanceSnapshot,
      });

      const effectiveTelemetry = resolveEffectiveTelemetrySignals({
        telemetryDecisionOverride: p.telemetry_decision,
        telemetryScoreOverride: p.telemetry_score,
        telemetryBlockedRatePctOverride: p.telemetry_blocked_rate_pct,
        telemetryDecisionRaw: autoAdvanceTelemetry.decision,
        telemetryScoreRaw: autoAdvanceTelemetry.score,
        telemetryBlockedRatePctRaw: autoAdvanceTelemetry.totals.blockedRatePct,
        autoAdvanceComposite,
      });

      const delegatePacket = buildDelegateOrExecuteDecisionPacket({
        capabilityDecision: typeof p.capability_decision === "string"
          ? p.capability_decision as "ready" | "needs-evidence" | "blocked"
          : capability.decision,
        capabilityRecommendationCode: typeof p.capability_recommendation_code === "string"
          ? p.capability_recommendation_code
          : capability.recommendationCode,
        capabilityBlockers: Array.isArray(p.capability_blockers) ? p.capability_blockers as string[] : capability.blockers,
        capabilityEvidenceGaps: Array.isArray(p.capability_evidence_gaps) ? p.capability_evidence_gaps as string[] : capability.evidenceGaps,
        mixDecision: typeof p.mix_decision === "string"
          ? p.mix_decision as "ready" | "needs-evidence"
          : mix.decision,
        mixScore: typeof p.mix_score === "number" ? p.mix_score : mix.score,
        mixRecommendationCode: typeof p.mix_recommendation_code === "string"
          ? p.mix_recommendation_code
          : mix.recommendationCode,
        mixSimpleDelegateEvents: typeof p.mix_simple_delegate_events === "number"
          ? p.mix_simple_delegate_events
          : mix.totals.simpleDelegate,
        mixSwarmEvents: typeof p.mix_swarm_events === "number"
          ? p.mix_swarm_events
          : mix.totals.swarm,
      });

      const rehearsalPacket = buildSimpleDelegateRehearsalDecisionPacket({
        capabilityDecision: typeof p.capability_decision === "string"
          ? p.capability_decision as "ready" | "needs-evidence" | "blocked"
          : capability.decision,
        capabilityRecommendationCode: typeof p.capability_recommendation_code === "string"
          ? p.capability_recommendation_code
          : capability.recommendationCode,
        capabilityBlockers: Array.isArray(p.capability_blockers) ? p.capability_blockers as string[] : capability.blockers,
        mixDecision: typeof p.mix_decision === "string"
          ? p.mix_decision as "ready" | "needs-evidence"
          : mix.decision,
        mixScore: typeof p.mix_score === "number" ? p.mix_score : mix.score,
        mixSimpleDelegateEvents: typeof p.mix_simple_delegate_events === "number"
          ? p.mix_simple_delegate_events
          : mix.totals.simpleDelegate,
        autoAdvanceDecision: autoAdvanceComposite.decision,
        autoAdvanceBlockedReasons: autoAdvanceComposite.blockedReasons,
        telemetryDecision: effectiveTelemetry.decision,
        telemetryScore: effectiveTelemetry.score,
        telemetryBlockedRatePct: effectiveTelemetry.blockedRatePct,
      });

      const status = buildDelegationReadinessStatus({
        delegatePacket,
        rehearsalPacket,
      });

      const allToolNames = new Set(pi.getAllTools().map((tool) => tool.name));
      const inferredBackgroundSignals = inferBackgroundCapabilitySignals(allToolNames);
      const backgroundPlan = resolveBackgroundProcessControlPlan({
        kind: typeof p.background_kind === "string" ? p.background_kind : undefined,
        requestedMode: typeof p.background_requested_mode === "string" ? p.background_requested_mode : undefined,
        needsServer: asOptionalBoolean(p.background_needs_server),
        requestedPort: typeof p.background_requested_port === "number" ? p.background_requested_port : undefined,
        parallelAgents: typeof p.background_parallel_agents === "number" ? p.background_parallel_agents : undefined,
        existingServiceReusable: asOptionalBoolean(p.background_existing_service_reusable),
        destructiveRestart: asOptionalBoolean(p.background_destructive_restart),
        logTailMaxLines: typeof p.background_log_tail_max_lines === "number" ? p.background_log_tail_max_lines : undefined,
        stacktraceCapture: asOptionalBoolean(p.background_stacktrace_capture),
        healthcheckKnown: asOptionalBoolean(p.background_healthcheck_known),
      });
      const backgroundReadiness = buildBackgroundProcessReadinessScore({
        hasProcessRegistry: asOptionalBoolean(p.background_has_process_registry) ?? inferredBackgroundSignals.hasProcessRegistry,
        hasPortLeaseLock: asOptionalBoolean(p.background_has_port_lease_lock) ?? inferredBackgroundSignals.hasPortLeaseLock,
        hasBoundedLogTail: asOptionalBoolean(p.background_has_bounded_log_tail) ?? inferredBackgroundSignals.hasBoundedLogTail,
        hasStructuredStacktraceCapture: asOptionalBoolean(p.background_has_structured_stacktrace_capture) ?? inferredBackgroundSignals.hasStructuredStacktraceCapture,
        hasHealthcheckProbe: asOptionalBoolean(p.background_has_healthcheck_probe) ?? inferredBackgroundSignals.hasHealthcheckProbe,
        hasGracefulStopThenKill: asOptionalBoolean(p.background_has_graceful_stop_then_kill) ?? inferredBackgroundSignals.hasGracefulStopThenKill,
        hasReloadHandoffCleanup: asOptionalBoolean(p.background_has_reload_handoff_cleanup) ?? inferredBackgroundSignals.hasReloadHandoffCleanup,
        hasPlanSurface: asOptionalBoolean(p.background_has_plan_surface) ?? allToolNames.has("background_process_plan"),
        hasLifecycleSurface: asOptionalBoolean(p.background_has_lifecycle_surface) ?? allToolNames.has("background_process_lifecycle_plan"),
        rehearsalSlices: typeof p.background_rehearsal_slices === "number" ? p.background_rehearsal_slices : undefined,
        stopSourceCoveragePct: typeof p.background_stop_source_coverage_pct === "number" ? p.background_stop_source_coverage_pct : undefined,
      });
      const backgroundRehearsal = evaluateBackgroundProcessRehearsal({
        readinessScore: backgroundReadiness.score,
        readinessRecommendationCode: backgroundReadiness.recommendationCode,
        lifecycleClassified: asOptionalBoolean(p.background_lifecycle_classified),
        stopSourceCoveragePct: typeof p.background_stop_source_coverage_pct === "number" ? p.background_stop_source_coverage_pct : undefined,
        rollbackPlanKnown: asOptionalBoolean(p.background_rollback_plan_known),
        rehearsalSlices: typeof p.background_rehearsal_slices === "number" ? p.background_rehearsal_slices : undefined,
        unresolvedBlockers: typeof p.background_unresolved_blockers === "number" ? p.background_unresolved_blockers : undefined,
        destructiveRestartRequested: asOptionalBoolean(p.background_destructive_restart_requested),
        protectedScopeRequested: asOptionalBoolean(p.background_protected_scope_requested),
      });
      const operationalRunway = buildOperationalRunwayPacket({
        delegation: {
          decision: status.decision,
          recommendationCode: status.recommendationCode,
          blockers: status.blockers,
        },
        background: {
          planDecision: backgroundPlan.decision,
          rehearsalDecision: backgroundRehearsal.decision,
          planBlockers: backgroundPlan.blockers,
          rehearsalBlockers: backgroundRehearsal.blockers,
        },
      });
      const summary = `${status.summary} ${operationalRunway.summary}`;

      return {
        content: [{ type: "text", text: summary }],
        details: {
          mode: "delegation-readiness-status-packet",
          activation: "none",
          authorization: "none",
          dispatchAllowed: false,
          mutationAllowed: false,
          decision: status.decision,
          recommendationCode: status.recommendationCode,
          recommendation: status.recommendation,
          nextAction: status.nextAction,
          blockers: status.blockers,
          summary,
          delegatePacket,
          rehearsalPacket,
          operationalRunway,
          backgroundPlan,
          backgroundReadiness,
          backgroundRehearsal,
          capability,
          inferredCapabilityDefaults,
          inferredBackgroundSignals,
          mix,
          autoAdvanceTelemetry,
          effectiveTelemetrySignals: effectiveTelemetry,
          autoAdvanceLiveSnapshot: liveAutoAdvanceSnapshot,
          autoAdvanceResolutionSource: autoAdvanceComposite.source,
          scan: collected.scan,
        },
      };
    },
  });

  pi.registerTool({
    name: "simple_delegate_rehearsal_start_packet",
    label: "Simple-Delegate Rehearsal Start Packet",
    description: "Report-only start/abort packet for one-task simple-delegate rehearsal. Never dispatches execution and always requires explicit human decision.",
    parameters: Type.Object({
      lookback_hours: Type.Optional(Type.Number({ description: "How many hours back to scan local session evidence. Default: 24." })),
      preload_decision: Type.Optional(Type.String({ description: "use-pack | fallback-canonical" })),
      dirty_signal: Type.Optional(Type.String({ description: "clean | dirty | unknown" })),
      monitor_classify_failures: Type.Optional(Type.Number({ description: "Classify-failure count. Default 0." })),
      subagents_ready: Type.Optional(Type.Boolean({ description: "Subagent readiness signal. Default true." })),
      capability_decision: Type.Optional(Type.String({ description: "Override capability decision: ready | needs-evidence | blocked" })),
      capability_recommendation_code: Type.Optional(Type.String({ description: "Optional capability recommendation code override." })),
      capability_blockers: Type.Optional(Type.Array(Type.String())),
      mix_decision: Type.Optional(Type.String({ description: "Override mix decision: ready | needs-evidence" })),
      mix_score: Type.Optional(Type.Number({ description: "Override mix score (0..100)." })),
      mix_simple_delegate_events: Type.Optional(Type.Number({ description: "Override simple-delegate event count." })),
      auto_advance_decision: Type.Optional(Type.String({ description: "Override auto-advance decision: eligible | blocked" })),
      auto_advance_blocked_reasons: Type.Optional(Type.Array(Type.String())),
      telemetry_decision: Type.Optional(Type.String({ description: "Override telemetry decision: ready | needs-evidence" })),
      telemetry_score: Type.Optional(Type.Number({ description: "Override telemetry score (0..100)." })),
      telemetry_blocked_rate_pct: Type.Optional(Type.Number({ description: "Override telemetry blocked rate pct (0..100)." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Block when protected scope is requested." })),
      declared_files_known: Type.Optional(Type.Boolean({ description: "Whether file scope for rehearsal task is explicitly declared." })),
      validation_gate_known: Type.Optional(Type.Boolean({ description: "Whether a bounded validation gate is known before start." })),
      rollback_plan_known: Type.Optional(Type.Boolean({ description: "Whether non-destructive rollback is known." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const lookbackHoursRaw = Number(p.lookback_hours);
      const lookbackHours = Number.isFinite(lookbackHoursRaw) && lookbackHoursRaw > 0
        ? lookbackHoursRaw
        : 24;
      const cwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();

      const inferredCapabilityDefaults = inferDelegationCapabilityDefaults(cwd);
      const capability = evaluateDelegationLaneCapabilitySnapshot({
        preloadDecision: typeof p.preload_decision === "string"
          ? p.preload_decision
          : inferredCapabilityDefaults.preloadDecision,
        dirtySignal: typeof p.dirty_signal === "string"
          ? p.dirty_signal
          : inferredCapabilityDefaults.dirtySignal,
        monitorClassifyFailures: typeof p.monitor_classify_failures === "number" ? p.monitor_classify_failures : 0,
        subagentsReady: typeof p.subagents_ready === "boolean" ? p.subagents_ready : true,
      });

      const collected = collectSessionRecords(cwd, lookbackHours);
      const mix = parseDelegationMixScore(collected.allRecords, lookbackHours, collected.files.length);
      const autoAdvanceTelemetry = parseAutoAdvanceHardIntentTelemetry(collected.allRecords, lookbackHours, collected.files.length);

      const telemetryBlockedReasons = autoAdvanceTelemetry.blockedReasons.map((row) => row.reason);
      const liveAutoAdvanceSnapshot = inferLiveAutoAdvanceSnapshot(cwd);
      const autoAdvanceComposite = resolveAutoAdvanceCompositeDecision({
        autoAdvanceDecisionOverride: p.auto_advance_decision,
        autoAdvanceBlockedReasonsOverride: p.auto_advance_blocked_reasons,
        telemetryDecision: autoAdvanceTelemetry.decision,
        telemetryBlockedReasons,
        telemetryEligibleEvents: autoAdvanceTelemetry.totals.eligibleEvents,
        liveSnapshot: liveAutoAdvanceSnapshot,
      });

      const effectiveTelemetry = resolveEffectiveTelemetrySignals({
        telemetryDecisionOverride: p.telemetry_decision,
        telemetryScoreOverride: p.telemetry_score,
        telemetryBlockedRatePctOverride: p.telemetry_blocked_rate_pct,
        telemetryDecisionRaw: autoAdvanceTelemetry.decision,
        telemetryScoreRaw: autoAdvanceTelemetry.score,
        telemetryBlockedRatePctRaw: autoAdvanceTelemetry.totals.blockedRatePct,
        autoAdvanceComposite,
      });

      const readiness = buildSimpleDelegateRehearsalDecisionPacket({
        capabilityDecision: typeof p.capability_decision === "string"
          ? p.capability_decision as "ready" | "needs-evidence" | "blocked"
          : capability.decision,
        capabilityRecommendationCode: typeof p.capability_recommendation_code === "string"
          ? p.capability_recommendation_code
          : capability.recommendationCode,
        capabilityBlockers: Array.isArray(p.capability_blockers) ? p.capability_blockers as string[] : capability.blockers,
        mixDecision: typeof p.mix_decision === "string"
          ? p.mix_decision as "ready" | "needs-evidence"
          : mix.decision,
        mixScore: typeof p.mix_score === "number" ? p.mix_score : mix.score,
        mixSimpleDelegateEvents: typeof p.mix_simple_delegate_events === "number"
          ? p.mix_simple_delegate_events
          : mix.totals.simpleDelegate,
        autoAdvanceDecision: autoAdvanceComposite.decision,
        autoAdvanceBlockedReasons: autoAdvanceComposite.blockedReasons,
        telemetryDecision: effectiveTelemetry.decision,
        telemetryScore: effectiveTelemetry.score,
        telemetryBlockedRatePct: effectiveTelemetry.blockedRatePct,
      });

      const startPacket = buildSimpleDelegateRehearsalStartPacket({
        rehearsalDecision: readiness.decision,
        rehearsalRecommendationCode: readiness.recommendationCode,
        rehearsalBlockers: readiness.blockers,
        protectedScopeRequested: p.protected_scope_requested === true,
        declaredFilesKnown: p.declared_files_known === true,
        validationGateKnown: p.validation_gate_known === true,
        rollbackPlanKnown: p.rollback_plan_known === true,
      });

      const handoffFocusTaskId = readAutonomyHandoffFocusTaskIds(cwd)[0];
      const operatorPauseBrief = buildSimpleDelegateOperatorPauseBrief({
        cwd,
        startDecision: startPacket.decision,
        blockers: startPacket.blockers,
        focusTaskId: handoffFocusTaskId,
        nextTaskId: liveAutoAdvanceSnapshot.nextTaskId,
      });
      const enrichedSummary = [
        startPacket.summary,
        formatSimpleDelegateOperatorPauseBriefSummary(operatorPauseBrief),
      ].join(" ");

      return {
        content: [{ type: "text", text: enrichedSummary }],
        details: {
          ...startPacket,
          summary: enrichedSummary,
          operatorPauseBrief,
          readiness,
          capability,
          inferredCapabilityDefaults,
          mix,
          autoAdvanceTelemetry,
          effectiveTelemetrySignals: effectiveTelemetry,
          autoAdvanceLiveSnapshot: liveAutoAdvanceSnapshot,
          autoAdvanceResolutionSource: autoAdvanceComposite.source,
          scan: collected.scan,
        },
      };
    },
  });

  pi.registerTool({
    name: "ops_calibration_decision_packet",
    label: "Ops Calibration Decision Packet",
    description: "Report-only decision packet that composes background-process readiness and agents-as-tools calibration before bounded rehearsal.",
    parameters: Type.Object({
      has_process_registry: Type.Optional(Type.Boolean({ description: "Whether process registry capability exists." })),
      has_port_lease_lock: Type.Optional(Type.Boolean({ description: "Whether port lease/lock capability exists." })),
      has_bounded_log_tail: Type.Optional(Type.Boolean({ description: "Whether bounded stdout/stderr tail capability exists." })),
      has_structured_stacktrace_capture: Type.Optional(Type.Boolean({ description: "Whether structured stacktrace capture exists." })),
      has_healthcheck_probe: Type.Optional(Type.Boolean({ description: "Whether bounded healthcheck probe exists." })),
      has_graceful_stop_then_kill: Type.Optional(Type.Boolean({ description: "Whether graceful-stop-then-kill contract exists." })),
      has_reload_handoff_cleanup: Type.Optional(Type.Boolean({ description: "Whether reload/compact/handoff cleanup exists." })),
      rehearsal_slices: Type.Optional(Type.Number({ description: "Completed bounded rehearsal slices (evidence count)." })),
      stop_source_coverage_pct: Type.Optional(Type.Number({ description: "Percent of lifecycle events with explicit stopSource evidence (0..100)." })),
      lifecycle_classified: Type.Optional(Type.Boolean({ description: "Whether lifecycle evidence is classified." })),
      rollback_plan_known: Type.Optional(Type.Boolean({ description: "Whether rollback plan is known." })),
      unresolved_blockers: Type.Optional(Type.Number({ description: "Count of unresolved blockers." })),
      destructive_restart_requested: Type.Optional(Type.Boolean({ description: "Whether destructive restart is being requested." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Whether protected scope was requested." })),
      min_score_for_rehearsal: Type.Optional(Type.Number({ description: "Minimum score threshold (60..95, default=80)." })),
      live_reload_completed: Type.Optional(Type.Boolean({ description: "Whether runtime reload was completed after wiring new tools." })),
      tool_names: Type.Optional(Type.Array(Type.String({ description: "Optional tool-name filter for agents-as-tools calibration scope." }))),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const allTools = pi.getAllTools().map(toolInfoToInput).filter((tool): tool is ToolHygieneInputTool => Boolean(tool));
      const selectedNames = Array.isArray(p.tool_names)
        ? new Set(p.tool_names.filter((name): name is string => typeof name === "string"))
        : undefined;
      const scopedTools = selectedNames ? allTools.filter((tool) => selectedNames.has(tool.name)) : allTools;

      const allToolNames = new Set(allTools.map((tool) => tool.name));
      const inferred = inferBackgroundCapabilitySignals(allToolNames);
      const background = buildBackgroundProcessReadinessScore({
        hasProcessRegistry: asOptionalBoolean(p.has_process_registry) ?? inferred.hasProcessRegistry,
        hasPortLeaseLock: asOptionalBoolean(p.has_port_lease_lock) ?? inferred.hasPortLeaseLock,
        hasBoundedLogTail: asOptionalBoolean(p.has_bounded_log_tail) ?? inferred.hasBoundedLogTail,
        hasStructuredStacktraceCapture: asOptionalBoolean(p.has_structured_stacktrace_capture) ?? inferred.hasStructuredStacktraceCapture,
        hasHealthcheckProbe: asOptionalBoolean(p.has_healthcheck_probe) ?? inferred.hasHealthcheckProbe,
        hasGracefulStopThenKill: asOptionalBoolean(p.has_graceful_stop_then_kill) ?? inferred.hasGracefulStopThenKill,
        hasReloadHandoffCleanup: asOptionalBoolean(p.has_reload_handoff_cleanup) ?? inferred.hasReloadHandoffCleanup,
        hasPlanSurface: allToolNames.has("background_process_plan"),
        hasLifecycleSurface: allToolNames.has("background_process_lifecycle_plan"),
        rehearsalSlices: typeof p.rehearsal_slices === "number" ? p.rehearsal_slices : undefined,
        stopSourceCoveragePct: typeof p.stop_source_coverage_pct === "number" ? p.stop_source_coverage_pct : undefined,
      });
      const backgroundRehearsal = evaluateBackgroundProcessRehearsal({
        readinessScore: background.score,
        readinessRecommendationCode: background.recommendationCode,
        lifecycleClassified: asOptionalBoolean(p.lifecycle_classified),
        stopSourceCoveragePct: typeof p.stop_source_coverage_pct === "number" ? p.stop_source_coverage_pct : undefined,
        rollbackPlanKnown: asOptionalBoolean(p.rollback_plan_known),
        rehearsalSlices: typeof p.rehearsal_slices === "number" ? p.rehearsal_slices : undefined,
        unresolvedBlockers: typeof p.unresolved_blockers === "number" ? p.unresolved_blockers : undefined,
        destructiveRestartRequested: asOptionalBoolean(p.destructive_restart_requested),
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
      });
      const agents = buildAgentsAsToolsCalibrationScore({ tools: scopedTools });
      const packet = buildOpsCalibrationDecisionPacket({
        background,
        backgroundRehearsal,
        agents,
        minScoreForRehearsal: typeof p.min_score_for_rehearsal === "number" ? p.min_score_for_rehearsal : undefined,
        liveReloadCompleted: p.live_reload_completed === true,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(packet, null, 2) }],
        details: packet,
      };
    },
  });
}
