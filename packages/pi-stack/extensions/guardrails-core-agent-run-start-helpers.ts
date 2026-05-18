import type {
  AgentInvocationProfile,
  AgentRunOperatorFileContract,
  CodexSparkPromotedEnvelope,
} from "./guardrails-core-agent-run-start";

export const AGENT_RUN_START_TIMEOUT_MIN_MS = 5_000;
export const AGENT_RUN_START_TIMEOUT_MAX_MS = 180_000;
export const READ_ONLY_TOOL_ALLOWLIST = ["read", "grep", "find", "ls"];
export const MUTATION_TOOL_ALLOWLIST = [...READ_ONLY_TOOL_ALLOWLIST, "edit", "write"];
export const SUPPORTED_AGENT_RUN_TOOL_ALLOWLIST = [...MUTATION_TOOL_ALLOWLIST];
export const CODEX_SPARK_PROVIDER_MODEL_REF = "openai-codex/gpt-5.3-codex-spark" as const;
export const CODEX_SPARK_PROMOTED_ENVELOPES: CodexSparkPromotedEnvelope[] = [
  "readonly-one-file",
  "readonly-two-file-synthesis",
  "readonly-one-symbol-review",
  "failure-contract",
  "readonly-three-file-inventory",
  "readonly-ci-cache-risk-scan",
  "readonly-monitor-fragility-hardening-scan",
  "readonly-declared-evidence-synthesis",
  "readonly-source-backed-evidence-synthesis",
  "mutation-one-file-marker",
];

export function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizePositiveInt(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
}

export function normalizeToolAllowlist(value: unknown): string[] {
  const requested = normalizeStringArray(value);
  return requested.length > 0 ? Array.from(new Set(requested)) : READ_ONLY_TOOL_ALLOWLIST;
}

export function normalizeSessionIsolation(value: unknown): "no-session" | "run-session-dir" | "unknown" {
  return value === "no-session" || value === "run-session-dir" ? value : "unknown";
}

export function normalizeExtensionIsolation(value: unknown): "minimal-no-extensions" | "inherit" | "unknown" {
  return value === "minimal-no-extensions" || value === "inherit" ? value : "unknown";
}

export function normalizeFileContract(value: unknown): AgentRunOperatorFileContract {
  return value === "mutation" ? "mutation" : "read-only";
}

export function normalizeInvocationProfile(value: unknown): AgentInvocationProfile | "unknown" {
  return value === "read-only-review" || value === "small-mutation" || value === "test-fix" || value === "research" ? value : "unknown";
}

export function sanitizeRunIdPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export function normalizeCodexSparkPromotedEnvelope(value: unknown): CodexSparkPromotedEnvelope | "unknown" {
  const text = normalizeText(value) || "readonly-one-file";
  return CODEX_SPARK_PROMOTED_ENVELOPES.includes(text as CodexSparkPromotedEnvelope) ? text as CodexSparkPromotedEnvelope : "unknown";
}

export function inferPromotedEnvelopeProfile(envelope: string): AgentInvocationProfile {
  return envelope.startsWith("mutation-") ? "small-mutation" : "read-only-review";
}
