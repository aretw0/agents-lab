export type ProviderExecutionBudgetDecision = "ok" | "warn" | "blocked" | "unknown";
export type ProviderExecutionBudgetEvidenceSource = "route-advisory" | "provider-budget-snapshot" | "manual" | "unknown";
export type ProviderExecutionBudgetFreshness = "fresh" | "stale" | "missing" | "not-required";
export type ProviderExecutionBudgetConsistency = "consistent" | "mismatch" | "needs-operator-review";

export interface ProviderExecutionBudgetEvidenceInput {
  budgetDecision?: ProviderExecutionBudgetDecision | string;
  budgetEvidence?: string;
  budgetEvidenceSource?: ProviderExecutionBudgetEvidenceSource | string;
  budgetEvidenceProvider?: string;
  budgetEvidenceGeneratedAtIso?: string;
  providerModelRef?: string;
  nowMs?: number;
  maxAgeMs?: number;
}

export interface ProviderExecutionBudgetEvidence {
  decision: ProviderExecutionBudgetDecision;
  evidence: string;
  source: ProviderExecutionBudgetEvidenceSource;
  provider?: string;
  providerModelRef?: string;
  scope: "provider" | "provider-model" | "unknown";
  generatedAtIso?: string;
  freshness: ProviderExecutionBudgetFreshness;
  consistency: ProviderExecutionBudgetConsistency;
  operatorReviewRequired: boolean;
  readyForExecution: boolean;
  blockers: string[];
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeProviderExecutionBudgetDecision(value: unknown): ProviderExecutionBudgetDecision {
  return value === "ok" || value === "warn" || value === "blocked" ? value : "unknown";
}

export function normalizeProviderExecutionBudgetEvidenceSource(value: unknown): ProviderExecutionBudgetEvidenceSource {
  return value === "route-advisory" || value === "provider-budget-snapshot" || value === "manual" ? value : "unknown";
}

function providerFromModelRef(value: unknown): string {
  const text = normalizeText(value);
  const slash = text.indexOf("/");
  return slash > 0 ? text.slice(0, slash) : text;
}

function providerModelRefFromEvidenceProvider(value: unknown): string {
  const text = normalizeText(value);
  return text.includes("/") ? text : "";
}

function resolveBudgetEvidenceScope(evidenceProvider: string): "provider" | "provider-model" | "unknown" {
  if (!evidenceProvider) return "unknown";
  return evidenceProvider.includes("/") ? "provider-model" : "provider";
}

function resolveFreshness(source: ProviderExecutionBudgetEvidenceSource, generatedAtIso: string, nowMs: number, maxAgeMs: number): ProviderExecutionBudgetFreshness {
  if (source === "manual" || source === "unknown") return "not-required";
  if (!generatedAtIso) return "missing";
  const parsed = Date.parse(generatedAtIso);
  if (!Number.isFinite(parsed)) return "missing";
  return Math.max(0, nowMs - parsed) <= maxAgeMs ? "fresh" : "stale";
}

export function resolveProviderExecutionBudgetEvidence(input: ProviderExecutionBudgetEvidenceInput = {}): ProviderExecutionBudgetEvidence {
  const decision = normalizeProviderExecutionBudgetDecision(input.budgetDecision);
  const evidence = normalizeText(input.budgetEvidence);
  const source = normalizeProviderExecutionBudgetEvidenceSource(input.budgetEvidenceSource ?? (evidence ? "manual" : undefined));
  const provider = normalizeText(input.budgetEvidenceProvider);
  const providerModelRef = normalizeText(input.providerModelRef);
  const providerModelEvidenceRef = providerModelRefFromEvidenceProvider(provider);
  const scope = resolveBudgetEvidenceScope(provider);
  const generatedAtIso = normalizeText(input.budgetEvidenceGeneratedAtIso);
  const expectedProvider = providerFromModelRef(providerModelRef);
  const maxAgeMs = typeof input.maxAgeMs === "number" && Number.isFinite(input.maxAgeMs) && input.maxAgeMs > 0 ? input.maxAgeMs : 30 * 60_000;
  const nowMs = typeof input.nowMs === "number" && Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const freshness = resolveFreshness(source, generatedAtIso, nowMs, maxAgeMs);
  const hasStructuredSource = source === "route-advisory" || source === "provider-budget-snapshot";
  const consistency: ProviderExecutionBudgetConsistency = hasStructuredSource
    ? providerModelEvidenceRef && providerModelRef && providerModelEvidenceRef !== providerModelRef
      ? "mismatch"
      : provider && expectedProvider && providerFromModelRef(provider) !== expectedProvider
        ? "mismatch"
        : "consistent"
    : "needs-operator-review";
  const operatorReviewRequired = !hasStructuredSource;
  const blockers: string[] = [];

  if (decision === "unknown") blockers.push("budget-decision-missing");
  if (decision === "blocked") blockers.push("budget-blocked");
  if (hasStructuredSource && freshness === "missing") blockers.push("budget-evidence-timestamp-missing");
  if (hasStructuredSource && freshness === "stale") blockers.push("budget-evidence-stale");
  if (hasStructuredSource && consistency === "mismatch") blockers.push("budget-evidence-provider-mismatch");

  return {
    decision,
    evidence,
    source,
    ...(provider ? { provider } : {}),
    ...(providerModelRef ? { providerModelRef } : {}),
    scope,
    ...(generatedAtIso ? { generatedAtIso } : {}),
    freshness,
    consistency,
    operatorReviewRequired,
    readyForExecution: blockers.length === 0,
    blockers,
  };
}
