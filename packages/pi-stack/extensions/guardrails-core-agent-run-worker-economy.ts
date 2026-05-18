export type AgentInvocationEconomyMode = "standard" | "conserve" | "critical";

function normalizePositiveInt(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

export function normalizeEconomyMode(value: unknown): AgentInvocationEconomyMode {
  return value === "standard" || value === "critical" || value === "conserve" ? value : "conserve";
}

export function normalizeMaxOutputLines(value: unknown, mode: AgentInvocationEconomyMode): number {
  const fallback = mode === "critical" ? 20 : mode === "conserve" ? 40 : 80;
  const requested = normalizePositiveInt(value, fallback);
  return Math.max(5, Math.min(120, requested || fallback));
}

export function buildEconomyInstructions(mode: AgentInvocationEconomyMode, maxOutputLines: number): string[] {
  const base = [
    "use only declared files unless the parent explicitly expands scope",
    "avoid broad scans, dependency installs, remote calls, and repeated context restatement",
    `keep final output concise: <=${maxOutputLines} lines unless reporting a hard blocker`,
    "prefer exact file/line evidence over narrative explanation",
    "stop and report missing context instead of exploring outside the declared scope",
  ];
  return mode === "standard" ? base.slice(0, 3) : base;
}

export function buildEconomyGoalPrefix(mode: AgentInvocationEconomyMode, maxOutputLines: number, tokenBudgetEvidence: string): string {
  const evidence = tokenBudgetEvidence ? ` Token budget evidence: ${tokenBudgetEvidence}.` : "";
  return `Worker economy contract (${mode}): use declared files only; avoid broad scans; avoid restating context; keep output <=${maxOutputLines} lines.${evidence}`;
}
