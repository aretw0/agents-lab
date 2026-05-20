import {
  formatAuthorizationEvidence,
  GUARDRAILS_AUTHORIZATION_NONE,
  type GuardrailsAuthorizationNone,
} from "./guardrails-core-authorization";

export type CapabilityRoiLevel = "low" | "medium" | "high";
export type CapabilityRoiRisk = CapabilityRoiLevel | "blocked";

export type CapabilityRoiRecommendationCode =
  | "capability-roi-use-local-tool"
  | "capability-roi-recommend-worker-candidate"
  | "capability-roi-needs-operator-authorization"
  | "capability-roi-missing-capability";

export interface CapabilityRoiInputCapability {
  name: string;
  description?: string;
  parameters?: unknown;
  capabilityKind?: "local-tool" | "worker" | "provider" | "protected" | string;
  value?: CapabilityRoiLevel | string;
  effort?: CapabilityRoiLevel | string;
  available?: boolean;
}

export interface CapabilityRoiRow {
  name: string;
  capabilityKind: string;
  value: CapabilityRoiLevel;
  effort: CapabilityRoiLevel;
  risk: CapabilityRoiRisk;
  available: boolean;
  recommendationCode: CapabilityRoiRecommendationCode;
  recommendation: string;
  authorizationQuestion?: string;
}

export interface CapabilityRoiPacket {
  mode: "capability-roi-packet";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  mutationAllowed: false;
  providerMutationAllowed: false;
  total: number;
  recommended: number;
  blocked: number;
  rows: CapabilityRoiRow[];
  summary: string;
}

function normalizeRoiLevel(value: unknown, fallback: CapabilityRoiLevel): CapabilityRoiLevel {
  return value === "low" || value === "medium" || value === "high" ? value : fallback;
}

function capabilityRisk(input: { name: string; description?: string; kind: string; available: boolean }): CapabilityRoiRisk {
  if (!input.available) return "blocked";
  if (input.kind === "protected" || input.kind === "provider") return "high";
  if (input.kind === "worker") return "medium";

  const text = `${input.name} ${input.description ?? ""}`.toLowerCase();
  if (/\b(publish|deploy|release|delete|credential|secret|token|provider|production|prod)\b/.test(text)) {
    return "high";
  }
  if (/\b(external|network|web|background|worker|subagent)\b/.test(text)) {
    return "medium";
  }
  return "low";
}

export function buildCapabilityRoiPacket(input: { capabilities: CapabilityRoiInputCapability[]; limit?: number }): CapabilityRoiPacket {
  const limit = Math.max(1, Math.min(80, Math.floor(input.limit ?? 20)));
  const seen = new Set<string>();
  const rows = (input.capabilities ?? [])
    .filter((capability) => typeof capability.name === "string" && capability.name.trim().length > 0)
    .flatMap((capability) => {
      const name = capability.name.trim().slice(0, 80);
      const key = name.toLowerCase();
      if (seen.has(key)) return [];
      seen.add(key);
      const kind = typeof capability.capabilityKind === "string" && capability.capabilityKind.trim()
        ? capability.capabilityKind.trim().toLowerCase().slice(0, 40)
        : "local-tool";
      const available = capability.available !== false;
      const value = normalizeRoiLevel(capability.value, kind === "worker" ? "high" : "medium");
      const effort = normalizeRoiLevel(capability.effort, kind === "worker" ? "medium" : "low");
      const risk = capabilityRisk({ name, description: capability.description, kind, available });

      let recommendationCode: CapabilityRoiRecommendationCode = "capability-roi-use-local-tool";
      let recommendation = "use this local capability for the current local-safe slice when it reduces ambiguity or validation cost.";
      let authorizationQuestion: string | undefined;

      if (!available) {
        recommendationCode = "capability-roi-missing-capability";
        recommendation = "capability is not available; reformulate the step or install/enable it through a separate explicit action.";
        authorizationQuestion = "Should this capability be enabled or should the step be reformulated without it?";
      } else if (risk === "high") {
        recommendationCode = "capability-roi-needs-operator-authorization";
        recommendation = "protected capability: keep report-only until the operator authorizes exact scope and action.";
        authorizationQuestion = "Authorize this protected capability for the named scope, or keep it parked?";
      } else if (kind === "worker") {
        recommendationCode = "capability-roi-recommend-worker-candidate";
        recommendation = "worker is a candidate when it reduces time, risk, or cognitive load; keep dispatch gated by toolkit and batch contracts.";
        authorizationQuestion = "Use a worker candidate for this bounded scope after toolkit gates are green?";
      }

      return [{
        name,
        capabilityKind: kind,
        value,
        effort,
        risk,
        available,
        recommendationCode,
        recommendation,
        authorizationQuestion,
      } satisfies CapabilityRoiRow];
    })
    .sort((a, b) => {
      const valueRank = { high: 0, medium: 1, low: 2 } as const;
      const riskRank = { low: 0, medium: 1, high: 2, blocked: 3 } as const;
      return valueRank[a.value] - valueRank[b.value] || riskRank[a.risk] - riskRank[b.risk] || a.name.localeCompare(b.name);
    })
    .slice(0, limit);

  const recommended = rows.filter((row) => row.recommendationCode === "capability-roi-use-local-tool" || row.recommendationCode === "capability-roi-recommend-worker-candidate").length;
  const blocked = rows.filter((row) => row.risk === "blocked" || row.risk === "high").length;
  const summary = [
    "capability-roi-packet:",
    "dispatch=no",
    "mutation=no",
    "providerMutation=no",
    "recommended=" + recommended,
    "blocked=" + blocked,
    formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE),
  ].join(" ");

  return {
    mode: "capability-roi-packet",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    mutationAllowed: false,
    providerMutationAllowed: false,
    total: rows.length,
    recommended,
    blocked,
    rows,
    summary,
  };
}
