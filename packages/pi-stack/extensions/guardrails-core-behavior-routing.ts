export type BehaviorRouteSkillName =
  | "github"
  | "glab"
  | "web-browser"
  | "source-research"
  | "pi-project"
  | "pi-workflows"
  | "terminal-setup";

export interface BehaviorRouteMatch {
  skill: BehaviorRouteSkillName;
  score: number;
  confidence: "medium" | "high";
  reasons: string[];
}

export interface BehaviorRouteDecision {
  kind: "matched" | "none";
  match?: BehaviorRouteMatch;
}

interface BehaviorRouteRule {
  skill: BehaviorRouteSkillName;
  keywords: string[];
  strongKeywords?: string[];
}

const ROUTE_RULES: BehaviorRouteRule[] = [
  {
    skill: "github",
    keywords: ["github", "pull request", "issue", "workflow", "actions", "gh "],
    strongKeywords: ["github actions", "pull request", "gh pr", "gh issue"],
  },
  {
    skill: "glab",
    keywords: ["gitlab", "merge request", "pipeline", "glab", "mr "],
    strongKeywords: ["gitlab", "merge request", "glab"],
  },
  {
    skill: "web-browser",
    keywords: ["browser", "website", "web page", "screenshot", "click", "fill form", "cdp"],
    strongKeywords: ["web page", "screenshot", "fill form", "cdp"],
  },
  {
    skill: "source-research",
    keywords: ["library internals", "source code", "permalink", "open-source", "why changed", "upstream"],
    strongKeywords: ["library internals", "source code", "permalink"],
  },
  {
    skill: "pi-project",
    keywords: [".project", "tasks.json", "verification.json", "board", "task-bud", "project block"],
    strongKeywords: [".project", "tasks.json", "verification.json"],
  },
  {
    skill: "pi-workflows",
    keywords: ["workflow", ".workflows", "dag", "workflow step", "agent workflow"],
    strongKeywords: [".workflows", "workflow step", "agent workflow"],
  },
  {
    skill: "terminal-setup",
    keywords: ["shift+enter", "keybinding", "terminal", "shell", "powershell", "wsl"],
    strongKeywords: ["shift+enter", "keybinding", "wsl"],
  },
];

function includesKeyword(text: string, keyword: string): boolean {
  const normalizedKeyword = keyword.toLowerCase();
  if (!normalizedKeyword) return false;
  if (normalizedKeyword.endsWith(" ")) {
    return text.includes(normalizedKeyword);
  }
  return text.includes(normalizedKeyword);
}

export function classifyBehaviorRoute(prompt: string): BehaviorRouteDecision {
  const text = String(prompt ?? "").trim().toLowerCase();
  if (!text) return { kind: "none" };

  const candidates: BehaviorRouteMatch[] = [];
  for (const rule of ROUTE_RULES) {
    const reasons = new Set<string>();
    let score = 0;

    for (const keyword of rule.keywords) {
      if (includesKeyword(text, keyword)) {
        reasons.add(keyword);
        score += 1;
      }
    }
    for (const keyword of rule.strongKeywords ?? []) {
      if (includesKeyword(text, keyword)) {
        reasons.add(keyword);
        score += 2;
      }
    }

    if (score > 0) {
      candidates.push({
        skill: rule.skill,
        score,
        confidence: score >= 4 ? "high" : "medium",
        reasons: Array.from(reasons).slice(0, 4),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.skill.localeCompare(b.skill));
  const best = candidates[0];
  if (!best || best.score < 2) return { kind: "none" };
  return { kind: "matched", match: best };
}

export function buildBehaviorRouteSystemPrompt(match: BehaviorRouteMatch): string[] {
  return [
    "Deterministic behavior routing advisory is active for this turn.",
    `- selected_skill: ${match.skill} (confidence=${match.confidence}, score=${match.score})`,
    `- matched_signals: ${match.reasons.join(", ") || "n/a"}`,
    "- apply this skill-specific workflow first when available; keep fallback deterministic.",
    "- if selected skill/capability is unavailable, continue with default behavior and report fallback explicitly.",
  ];
}
