export type UnattendedRehearsalDecision = "ready-for-canary" | "continue-local" | "blocked";

export interface UnattendedRehearsalInput {
  completedLocalSlices: number;
  focusPreserved: boolean;
  focalSmokeGreen: boolean;
  smallCommits: boolean;
  handoffFresh: boolean;
  protectedScopeAutoSelections: number;
  unresolvedBlockers?: number;
}

export interface UnattendedRehearsalGate {
  ready: boolean;
  decision: UnattendedRehearsalDecision;
  score: number;
  requiredScore: number;
  blockers: string[];
  recommendation: string;
  criteria: {
    completedLocalSlices: number;
    requiredLocalSlices: number;
    focusPreserved: boolean;
    focalSmokeGreen: boolean;
    smallCommits: boolean;
    handoffFresh: boolean;
    protectedScopeAutoSelections: number;
    unresolvedBlockers: number;
  };
}

export interface UnattendedRehearsalSliceEvidenceInput {
  slice: number;
  focus: string;
  gate: string;
  commit: string;
  drift: boolean;
  next: string;
}

const REQUIRED_LOCAL_SLICES = 3;
const REQUIRED_SCORE = 6;

function compactToken(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, "-").trim();
  if (!normalized) return fallback;
  return normalized.length <= 96 ? normalized : `${normalized.slice(0, 95)}…`;
}

export function formatUnattendedRehearsalSliceEvidence(input: UnattendedRehearsalSliceEvidenceInput): string {
  const slice = Math.max(0, Math.floor(Number(input.slice ?? 0)));
  return [
    `slice=${slice}`,
    `focus=${compactToken(input.focus, "unknown")}`,
    `gate=${compactToken(input.gate, "unknown")}`,
    `commit=${compactToken(input.commit, "pending")}`,
    `drift=${input.drift ? "yes" : "no"}`,
    `next=${compactToken(input.next, "none")}`,
  ].join(" ");
}

export function evaluateUnattendedRehearsalGate(input: UnattendedRehearsalInput): UnattendedRehearsalGate {
  const completedLocalSlices = Math.max(0, Math.floor(Number(input.completedLocalSlices ?? 0)));
  const protectedScopeAutoSelections = Math.max(0, Math.floor(Number(input.protectedScopeAutoSelections ?? 0)));
  const unresolvedBlockers = Math.max(0, Math.floor(Number(input.unresolvedBlockers ?? 0)));
  const blockers: string[] = [];

  if (completedLocalSlices < REQUIRED_LOCAL_SLICES) blockers.push("insufficient-local-slices");
  if (input.focusPreserved !== true) blockers.push("focus-not-preserved");
  if (input.focalSmokeGreen !== true) blockers.push("focal-smoke-not-green");
  if (input.smallCommits !== true) blockers.push("commits-not-small");
  if (input.handoffFresh !== true) blockers.push("handoff-not-fresh");
  if (protectedScopeAutoSelections > 0) blockers.push("protected-scope-auto-selected");
  if (unresolvedBlockers > 0) blockers.push("unresolved-blockers");

  const score = [
    completedLocalSlices >= REQUIRED_LOCAL_SLICES,
    input.focusPreserved === true,
    input.focalSmokeGreen === true,
    input.smallCommits === true,
    input.handoffFresh === true,
    protectedScopeAutoSelections === 0,
  ].filter(Boolean).length;

  if (blockers.length === 0 && score >= REQUIRED_SCORE) {
    return {
      ready: true,
      decision: "ready-for-canary",
      score,
      requiredScore: REQUIRED_SCORE,
      blockers,
      recommendation: "unattended-rehearsal: local loop is ready to consider a controlled remote/offload canary; keep board/handoff as authority.",
      criteria: {
        completedLocalSlices,
        requiredLocalSlices: REQUIRED_LOCAL_SLICES,
        focusPreserved: input.focusPreserved === true,
        focalSmokeGreen: input.focalSmokeGreen === true,
        smallCommits: input.smallCommits === true,
        handoffFresh: input.handoffFresh === true,
        protectedScopeAutoSelections,
        unresolvedBlockers,
      },
    };
  }

  const hardBlocked = unresolvedBlockers > 0 || protectedScopeAutoSelections > 0;
  return {
    ready: false,
    decision: hardBlocked ? "blocked" : "continue-local",
    score,
    requiredScore: REQUIRED_SCORE,
    blockers,
    recommendation: hardBlocked
      ? "unattended-rehearsal: stop escalation; resolve blockers/protected-scope drift before continuing."
      : "unattended-rehearsal: continue local-first bounded slices until all maturity criteria are met.",
    criteria: {
      completedLocalSlices,
      requiredLocalSlices: REQUIRED_LOCAL_SLICES,
      focusPreserved: input.focusPreserved === true,
      focalSmokeGreen: input.focalSmokeGreen === true,
      smallCommits: input.smallCommits === true,
      handoffFresh: input.handoffFresh === true,
      protectedScopeAutoSelections,
      unresolvedBlockers,
    },
  };
}
