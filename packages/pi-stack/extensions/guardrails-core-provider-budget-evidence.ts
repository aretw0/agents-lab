export type ProviderExecutionBudgetDecision = "ok" | "warn" | "blocked" | "unknown";

export interface ProviderExecutionBudgetEvidenceInput {
  budgetDecision?: ProviderExecutionBudgetDecision | string;
  budgetEvidence?: string;
}

export interface ProviderExecutionBudgetEvidence {
  decision: ProviderExecutionBudgetDecision;
  evidence: string;
  readyForExecution: boolean;
  blockers: string[];
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeProviderExecutionBudgetDecision(value: unknown): ProviderExecutionBudgetDecision {
  return value === "ok" || value === "warn" || value === "blocked" ? value : "unknown";
}

export function resolveProviderExecutionBudgetEvidence(input: ProviderExecutionBudgetEvidenceInput = {}): ProviderExecutionBudgetEvidence {
  const decision = normalizeProviderExecutionBudgetDecision(input.budgetDecision);
  const evidence = normalizeText(input.budgetEvidence);
  const blockers: string[] = [];

  if (decision === "unknown") blockers.push("budget-decision-missing");
  if (decision === "blocked") blockers.push("budget-blocked");

  return {
    decision,
    evidence,
    readyForExecution: blockers.length === 0,
    blockers,
  };
}
