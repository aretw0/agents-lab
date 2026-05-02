import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  CONTINUE_LOCAL_CODE,
  LOCAL_AUDIT_BLOCKED_CODE,
  LOCAL_STOP_NO_LOCAL_SAFE_NEXT_STEP_CODE,
  REFRESH_FOCUS_CHECKPOINT_CODE,
  localStopProtectedFocusNextAction,
} from "./guardrails-core-local-stop-guidance";

export type ContextWatchContinuationRecommendationCode =
  | typeof CONTINUE_LOCAL_CODE
  | typeof LOCAL_STOP_NO_LOCAL_SAFE_NEXT_STEP_CODE
  | typeof REFRESH_FOCUS_CHECKPOINT_CODE
  | typeof LOCAL_AUDIT_BLOCKED_CODE;

export type TurnBoundaryDecision = "continue" | "checkpoint" | "pause" | "ask-human";

export type TurnBoundaryReasonCode =
  | "turn-boundary-continue-local"
  | "turn-boundary-checkpoint-refresh-focus"
  | "turn-boundary-pause-local-stop"
  | "turn-boundary-ask-human-decision-required";

export const TURN_BOUNDARY_DIRECTION_PROMPT = "continue in a similar lane to consolidate, or switch to the next lane with higher long-term value?";

export type TurnBoundaryDirectionOptionId = "similar-lane" | "next-high-value";

export interface TurnBoundaryDirectionOptionPreview {
  id: TurnBoundaryDirectionOptionId;
  label: string;
  suitability: "recommended" | "viable" | "blocked";
  recommendationCode: string;
  nextStep: string;
  blockers: string[];
}

export interface TurnBoundaryDirectionPreview {
  recommendedOptionId: TurnBoundaryDirectionOptionId;
  options: TurnBoundaryDirectionOptionPreview[];
}

export interface TurnBoundaryDecisionPacket {
  mode: "report-only";
  decision: TurnBoundaryDecision;
  reasonCode: TurnBoundaryReasonCode;
  humanActionRequired: boolean;
  nextAutoStep: string;
  directionPrompt: string;
  directionPreview: TurnBoundaryDirectionPreview;
  recommendationCode: ContextWatchContinuationRecommendationCode;
  dispatchAllowed: false;
  mutationAllowed: false;
  authorization: "none";
  summary: string;
}

export function resolveContextWatchContinuationRecommendation(input: {
  ready: boolean;
  focusTasks: string;
  staleFocusCount: number;
  localAuditReasons?: string[];
}): { recommendationCode: ContextWatchContinuationRecommendationCode; nextAction: string } {
  if (input.ready) {
    return {
      recommendationCode: CONTINUE_LOCAL_CODE,
      nextAction: "continue bounded local-safe slice and keep checkpoint cadence.",
    };
  }
  const reasons = input.localAuditReasons ?? [];
  if (reasons.includes("no-local-safe-next-step")) {
    return {
      recommendationCode: LOCAL_STOP_NO_LOCAL_SAFE_NEXT_STEP_CODE,
      nextAction: localStopProtectedFocusNextAction(),
    };
  }
  if (input.focusTasks === "none-listed" || reasons.includes("candidate:invalid") || input.staleFocusCount > 0) {
    return {
      recommendationCode: REFRESH_FOCUS_CHECKPOINT_CODE,
      nextAction: "refresh handoff focus/checkpoint with one bounded local-safe candidate before continuing.",
    };
  }
  return {
    recommendationCode: LOCAL_AUDIT_BLOCKED_CODE,
    nextAction: "continuation blocked by local audit; resolve blocking reasons then refresh checkpoint.",
  };
}

function buildTurnBoundaryDirectionPreview(input: {
  decision: TurnBoundaryDecision;
  humanActionRequired: boolean;
  nextAutoStep: string;
  localAuditReasons: string[];
}): TurnBoundaryDirectionPreview {
  const criticalReasons = input.localAuditReasons.filter((reason) =>
    reason === "protected-scopes:invalid"
    || reason === "validation:invalid"
    || reason === "stop-conditions:invalid",
  );

  const similarBlockers: string[] = [];
  if (input.localAuditReasons.includes("no-local-safe-next-step")) similarBlockers.push("no-local-safe-next-step");
  if (criticalReasons.length > 0) similarBlockers.push(...criticalReasons);

  const similarSuitability: "recommended" | "viable" | "blocked" =
    similarBlockers.length > 0
      ? "blocked"
      : (input.decision === "continue" || input.decision === "checkpoint")
        ? "recommended"
        : "viable";

  const nextLaneBlockers: string[] = [];
  nextLaneBlockers.push("requires-explicit-human-focus");
  if (criticalReasons.length > 0) nextLaneBlockers.push(...criticalReasons);

  const nextLaneSuitability: "recommended" | "viable" | "blocked" =
    (input.decision === "pause" || input.decision === "ask-human" || input.humanActionRequired)
      ? "recommended"
      : criticalReasons.length > 0
        ? "blocked"
        : "viable";

  const options: TurnBoundaryDirectionOptionPreview[] = [
    {
      id: "similar-lane",
      label: "continue in a similar lane to consolidate",
      suitability: similarSuitability,
      recommendationCode:
        similarSuitability === "recommended"
          ? "direction-similar-lane-consolidate"
          : similarSuitability === "viable"
            ? "direction-similar-lane-viable"
            : "direction-similar-lane-blocked",
      nextStep: input.nextAutoStep,
      blockers: similarBlockers,
    },
    {
      id: "next-high-value",
      label: "switch to the next lane with higher long-term value",
      suitability: nextLaneSuitability,
      recommendationCode:
        nextLaneSuitability === "recommended"
          ? "direction-next-high-value-shift"
          : nextLaneSuitability === "viable"
            ? "direction-next-high-value-viable"
            : "direction-next-high-value-blocked",
      nextStep: "choose one explicit next-lane focus task and run report-only packet before execution.",
      blockers: nextLaneBlockers,
    },
  ];

  const recommendedOption = options.find((option) => option.suitability === "recommended")
    ?? options.find((option) => option.suitability === "viable")
    ?? options[0];

  return {
    recommendedOptionId: recommendedOption.id,
    options,
  };
}

export function buildTurnBoundaryDecisionPacket(input: {
  ready: boolean;
  focusTasks: string;
  staleFocusCount: number;
  localAuditReasons?: string[];
}): TurnBoundaryDecisionPacket {
  const reasons = input.localAuditReasons ?? [];
  const recommendation = resolveContextWatchContinuationRecommendation(input);

  let decision: TurnBoundaryDecision = "pause";
  let reasonCode: TurnBoundaryReasonCode = "turn-boundary-pause-local-stop";
  let humanActionRequired = false;
  let nextAutoStep = recommendation.nextAction;

  if (input.ready) {
    decision = "continue";
    reasonCode = "turn-boundary-continue-local";
    humanActionRequired = false;
  } else if (reasons.includes("protected-scopes:invalid") || reasons.includes("stop-conditions:invalid") || reasons.includes("validation:invalid")) {
    decision = "ask-human";
    reasonCode = "turn-boundary-ask-human-decision-required";
    humanActionRequired = true;
    nextAutoStep = "request explicit human decision before continuing this lane.";
  } else if (reasons.includes("no-local-safe-next-step")) {
    decision = "pause";
    reasonCode = "turn-boundary-pause-local-stop";
    humanActionRequired = false;
    nextAutoStep = localStopProtectedFocusNextAction();
  } else if (input.focusTasks === "none-listed" || input.staleFocusCount > 0 || reasons.includes("candidate:invalid")) {
    decision = "checkpoint";
    reasonCode = "turn-boundary-checkpoint-refresh-focus";
    humanActionRequired = false;
    nextAutoStep = "write checkpoint with explicit focus and resume bounded local-safe slice.";
  } else {
    decision = "ask-human";
    reasonCode = "turn-boundary-ask-human-decision-required";
    humanActionRequired = true;
    nextAutoStep = "request explicit human decision for blocked local audit reasons.";
  }

  const directionPreview = buildTurnBoundaryDirectionPreview({
    decision,
    humanActionRequired,
    nextAutoStep,
    localAuditReasons: reasons,
  });
  const directionOptionsCompact = directionPreview.options
    .map((option) => `${option.id}:${option.suitability}`)
    .join(",");

  return {
    mode: "report-only",
    decision,
    reasonCode,
    humanActionRequired,
    nextAutoStep,
    recommendationCode: recommendation.recommendationCode,
    directionPrompt: TURN_BOUNDARY_DIRECTION_PROMPT,
    directionPreview,
    dispatchAllowed: false,
    mutationAllowed: false,
    authorization: "none",
    summary: [
      "turn-boundary-decision:",
      `decision=${decision}`,
      `reasonCode=${reasonCode}`,
      `humanActionRequired=${humanActionRequired ? "yes" : "no"}`,
      `recommendationCode=${recommendation.recommendationCode}`,
      "directionPrompt=similar-lane-or-next-value",
      `directionRecommended=${directionPreview.recommendedOptionId}`,
      `directionOptions=${directionOptionsCompact}`,
      "authorization=none",
    ].join(" "),
  };
}

export type ContextPreloadProfile = "control-plane-core" | "agent-worker-lean" | "swarm-scout-min";

export interface ContextPreloadConsumeReport {
  mode: "context-preload-consume";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  workspace: string;
  packPath: string;
  profileRequested: ContextPreloadProfile;
  profileResolved: ContextPreloadProfile;
  decision: "use-pack" | "fallback-canonical";
  selectedPaths: string[];
  fallbackPaths: string[];
  staleReasons: string[];
  currentCanonicalState: {
    fingerprint: string;
    files: Array<{ path: string; exists: boolean; mtimeMs: number }>;
  };
  summary: string;
}

const CANONICAL_PATHS = [
  ".project/handoff.json",
  ".project/tasks.json",
  ".project/verification.json",
] as const;

function readCanonicalState(cwd: string): ContextPreloadConsumeReport["currentCanonicalState"] {
  const files = [...CANONICAL_PATHS].map((rel) => {
    const abs = path.join(cwd, rel);
    if (!existsSync(abs)) return { path: rel, exists: false, mtimeMs: 0 };
    try {
      const st = statSync(abs);
      return { path: rel, exists: true, mtimeMs: Math.floor(st.mtimeMs) };
    } catch {
      return { path: rel, exists: false, mtimeMs: 0 };
    }
  });

  const fingerprint = createHash("sha1")
    .update(files.map((entry) => `${entry.path}:${entry.exists ? 1 : 0}:${entry.mtimeMs}`).join("|"))
    .digest("hex");

  return { fingerprint, files };
}

function resolveRequestedProfile(value: unknown): ContextPreloadProfile {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "agent-worker-lean") return "agent-worker-lean";
  if (raw === "swarm-scout-min") return "swarm-scout-min";
  return "control-plane-core";
}

function readPackJson(packPath: string): Record<string, unknown> | undefined {
  if (!existsSync(packPath)) return undefined;
  try {
    const raw = readFileSync(packPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function resolvePackProfilePaths(pack: Record<string, unknown> | undefined, profile: ContextPreloadProfile): {
  profileResolved: ContextPreloadProfile;
  paths: string[];
} {
  const preloadPack = (pack?.preloadPack && typeof pack.preloadPack === "object")
    ? (pack.preloadPack as Record<string, unknown>)
    : {};
  const map: Record<ContextPreloadProfile, string[]> = {
    "control-plane-core": Array.isArray(preloadPack.controlPlaneCore)
      ? preloadPack.controlPlaneCore.filter((entry): entry is string => typeof entry === "string")
      : [],
    "agent-worker-lean": Array.isArray(preloadPack.agentWorkerLean)
      ? preloadPack.agentWorkerLean.filter((entry): entry is string => typeof entry === "string")
      : [],
    "swarm-scout-min": Array.isArray(preloadPack.swarmScoutMin)
      ? preloadPack.swarmScoutMin.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
  if (map[profile].length > 0) {
    return { profileResolved: profile, paths: map[profile] };
  }
  return { profileResolved: "control-plane-core", paths: map["control-plane-core"] };
}

export function consumeContextPreloadPack(cwd: string, input?: {
  profile?: unknown;
  maxAgeHours?: unknown;
  packPath?: unknown;
}): ContextPreloadConsumeReport {
  const workspace = path.resolve(cwd);
  const profileRequested = resolveRequestedProfile(input?.profile);
  const maxAgeHours = Number(input?.maxAgeHours);
  const maxAgeMs = Number.isFinite(maxAgeHours) && maxAgeHours > 0
    ? Math.floor(maxAgeHours * 60 * 60 * 1000)
    : 24 * 60 * 60 * 1000;
  const packPath = typeof input?.packPath === "string" && input.packPath.trim().length > 0
    ? path.resolve(workspace, input.packPath)
    : path.join(workspace, ".sandbox", "pi-agent", "preload", "context-preload-pack.json");

  const fallbackPaths = [...CANONICAL_PATHS];
  const currentCanonicalState = readCanonicalState(workspace);
  const staleReasons: string[] = [];

  const pack = readPackJson(packPath);
  if (!pack) {
    staleReasons.push("pack-missing-or-invalid");
  }

  if (pack) {
    const generatedAtMs = Date.parse(String(pack.generatedAtIso ?? ""));
    if (!Number.isFinite(generatedAtMs)) {
      staleReasons.push("pack-generated-at-missing");
    } else if (Date.now() - generatedAtMs > maxAgeMs) {
      staleReasons.push("pack-too-old");
    }

    const packFingerprint = String((pack.canonicalState as Record<string, unknown> | undefined)?.fingerprint ?? "").trim();
    if (!packFingerprint) {
      staleReasons.push("canonical-fingerprint-missing");
    } else if (packFingerprint !== currentCanonicalState.fingerprint) {
      staleReasons.push("canonical-state-changed");
    }
  }

  const resolved = resolvePackProfilePaths(pack, profileRequested);
  if (pack && resolved.paths.length === 0) {
    staleReasons.push("profile-pack-empty");
  }

  const decision = staleReasons.length > 0 ? "fallback-canonical" : "use-pack";
  const selectedPaths = decision === "use-pack" ? resolved.paths : fallbackPaths;

  return {
    mode: "context-preload-consume",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    workspace,
    packPath,
    profileRequested,
    profileResolved: resolved.profileResolved,
    decision,
    selectedPaths,
    fallbackPaths,
    staleReasons,
    currentCanonicalState,
    summary: [
      "context-preload-consume:",
      `decision=${decision}`,
      `profile=${resolved.profileResolved}`,
      `selected=${selectedPaths.length}`,
      staleReasons.length > 0 ? `stale=${staleReasons.join("|")}` : "stale=none",
    ].join(" "),
  };
}
