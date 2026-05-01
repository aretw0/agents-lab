import {
  LOCAL_STOP_PROTECTED_FOCUS_REQUIRED_CODE,
  NEEDS_HUMAN_FOCUS_PROTECTED_CODE,
  SEED_LOCAL_SAFE_LANE_CODE,
  STOP_NO_LOCAL_SAFE_CODE,
} from "./guardrails-core-local-stop-guidance";

export type BrainstormLevel = "high" | "medium" | "low";

export interface BrainstormIdeaInput {
  id: string;
  theme: string;
  value: BrainstormLevel | string;
  risk: BrainstormLevel | string;
  effort: BrainstormLevel | string;
}

export interface RankedBrainstormIdea extends BrainstormIdeaInput {
  value: BrainstormLevel;
  risk: BrainstormLevel;
  effort: BrainstormLevel;
  score: number;
}

export interface LaneBrainstormSelectionInput {
  ready: boolean;
  recommendationCode: string;
  recommendation: string;
  eligibleTaskIds: string[];
}

export interface LaneBrainstormSelectedSlice {
  id: string;
  title: string;
  acceptance: string[];
  rollback: string;
  sourceIdeaId?: string;
  sourceTaskId?: string;
}

export interface LaneBrainstormPacket {
  decision: "ready-for-human-review" | "blocked";
  goal: string;
  recommendationCode: string;
  nextAction: string;
  ideas: RankedBrainstormIdea[];
  selectedSlices: LaneBrainstormSelectedSlice[];
  selection: LaneBrainstormSelectionInput;
  dispatchAllowed: false;
  mutationAllowed: false;
  authorization: "none";
  mode: "report-only";
}

function normalizeLevel(value: unknown): BrainstormLevel {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function levelValue(level: BrainstormLevel): number {
  if (level === "high") return 3;
  if (level === "medium") return 2;
  return 1;
}

function normalizeCount(value: unknown, fallback: number, min: number, max: number): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

export function parseBrainstormIdeas(value: unknown): BrainstormIdeaInput[] {
  if (!Array.isArray(value)) return [];
  const ideas: BrainstormIdeaInput[] = [];
  for (const row of value) {
    const item = row && typeof row === "object" ? row as Record<string, unknown> : undefined;
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    const theme = typeof item?.theme === "string" ? item.theme.trim() : "";
    if (!id || !theme) continue;
    ideas.push({
      id,
      theme,
      value: typeof item?.value === "string" ? item.value : "medium",
      risk: typeof item?.risk === "string" ? item.risk : "medium",
      effort: typeof item?.effort === "string" ? item.effort : "medium",
    });
  }
  return ideas;
}

export function scoreBrainstormIdea(idea: BrainstormIdeaInput): RankedBrainstormIdea {
  const value = normalizeLevel(idea.value);
  const risk = normalizeLevel(idea.risk);
  const effort = normalizeLevel(idea.effort);
  const score = (levelValue(value) * 5) - (levelValue(risk) * 3) - (levelValue(effort) * 2);
  return {
    ...idea,
    value,
    risk,
    effort,
    score,
  };
}

function compareRankedIdeas(a: RankedBrainstormIdea, b: RankedBrainstormIdea): number {
  if (b.score !== a.score) return b.score - a.score;
  if (levelValue(b.value) !== levelValue(a.value)) return levelValue(b.value) - levelValue(a.value);
  if (levelValue(a.risk) !== levelValue(b.risk)) return levelValue(a.risk) - levelValue(b.risk);
  if (levelValue(a.effort) !== levelValue(b.effort)) return levelValue(a.effort) - levelValue(b.effort);
  return a.id.localeCompare(b.id);
}

export function rankBrainstormIdeas(ideas: BrainstormIdeaInput[], maxItems = 12): RankedBrainstormIdea[] {
  const seen = new Set<string>();
  const ranked: RankedBrainstormIdea[] = [];
  for (const idea of ideas) {
    if (!idea?.id || seen.has(idea.id)) continue;
    seen.add(idea.id);
    ranked.push(scoreBrainstormIdea(idea));
  }
  ranked.sort(compareRankedIdeas);
  const cap = normalizeCount(maxItems, 12, 1, 50);
  return ranked.slice(0, cap);
}

export function resolveLaneBrainstormRecommendation(selection: LaneBrainstormSelectionInput): {
  decision: "ready-for-human-review" | "blocked";
  recommendationCode: string;
  nextAction: string;
} {
  if (selection.ready) {
    return {
      decision: "ready-for-human-review",
      recommendationCode: SEED_LOCAL_SAFE_LANE_CODE,
      nextAction: "review ranked slices and materialize bounded local-safe tasks.",
    };
  }
  if (selection.recommendationCode === LOCAL_STOP_PROTECTED_FOCUS_REQUIRED_CODE) {
    return {
      decision: "blocked",
      recommendationCode: NEEDS_HUMAN_FOCUS_PROTECTED_CODE,
      nextAction: selection.recommendation,
    };
  }
  return {
    decision: "blocked",
    recommendationCode: STOP_NO_LOCAL_SAFE_CODE,
    nextAction: selection.recommendation,
  };
}

function buildSelectedSlices(input: {
  rankedIdeas: RankedBrainstormIdea[];
  eligibleTaskIds: string[];
  maxSlices: number;
}): LaneBrainstormSelectedSlice[] {
  if (input.rankedIdeas.length > 0) {
    return input.rankedIdeas.slice(0, input.maxSlices).map((idea, index) => ({
      id: `slice-${index + 1}`,
      sourceIdeaId: idea.id,
      title: idea.theme,
      acceptance: ["focal validation green", "scope remains bounded"],
      rollback: "git revert commit",
    }));
  }
  return input.eligibleTaskIds.slice(0, input.maxSlices).map((taskId, index) => ({
    id: `slice-${index + 1}`,
    sourceTaskId: taskId,
    title: `execute bounded slice for ${taskId}`,
    acceptance: ["focal validation green", "scope remains bounded"],
    rollback: "git revert commit",
  }));
}

export function buildLaneBrainstormPacket(input: {
  goal?: unknown;
  ideas?: unknown;
  maxIdeas?: unknown;
  maxSlices?: unknown;
  selection: LaneBrainstormSelectionInput;
}): LaneBrainstormPacket {
  const recommendation = resolveLaneBrainstormRecommendation(input.selection);
  const rankedIdeas = rankBrainstormIdeas(parseBrainstormIdeas(input.ideas), normalizeCount(input.maxIdeas, 12, 1, 50));
  const maxSlices = normalizeCount(input.maxSlices, 5, 1, 10);
  const selectedSlices = buildSelectedSlices({
    rankedIdeas,
    eligibleTaskIds: input.selection.eligibleTaskIds,
    maxSlices,
  });

  return {
    decision: recommendation.decision,
    goal: typeof input.goal === "string" && input.goal.trim().length > 0 ? input.goal.trim() : "seed local-safe lane",
    recommendationCode: recommendation.recommendationCode,
    nextAction: recommendation.nextAction,
    ideas: rankedIdeas,
    selectedSlices,
    selection: input.selection,
    dispatchAllowed: false,
    mutationAllowed: false,
    authorization: "none",
    mode: "report-only",
  };
}
