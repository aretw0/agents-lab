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

function normalizeLevel(value: unknown): BrainstormLevel {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function levelValue(level: BrainstormLevel): number {
  if (level === "high") return 3;
  if (level === "medium") return 2;
  return 1;
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
  const cap = Number.isFinite(maxItems) ? Math.max(1, Math.min(50, Math.floor(maxItems))) : 12;
  return ranked.slice(0, cap);
}
