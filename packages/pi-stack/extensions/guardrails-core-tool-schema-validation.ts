import { createHash } from "node:crypto";
import {
  formatAuthorizationEvidence,
  GUARDRAILS_AUTHORIZATION_NONE,
  type GuardrailsAuthorizationNone,
} from "./guardrails-core-authorization";

export type ToolSchemaValidationDecision = "valid" | "cached-valid" | "invalid" | "needs-validation";
export type ToolSchemaValidationCacheStatus = "hit" | "miss" | "stale" | "unavailable";

export interface ToolSchemaValidationTool {
  name: string;
  parameters?: unknown;
}

export interface ToolSchemaValidationCache {
  fingerprint: string;
  decision: "valid" | "cached-valid";
  validatedAtIso?: string;
}

export interface ToolSchemaValidationFinding {
  tool: string;
  reason: string;
}

export interface ToolSchemaValidationPacket {
  mode: "tool-schema-validation";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  mutationAllowed: false;
  decision: ToolSchemaValidationDecision;
  cacheStatus: ToolSchemaValidationCacheStatus;
  fingerprint: string;
  validatedAtIso?: string;
  total: number;
  invalid: number;
  findings: ToolSchemaValidationFinding[];
  rollbackPath: string[];
  summary: string;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function schemaObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function validateToolSchema(tool: ToolSchemaValidationTool): ToolSchemaValidationFinding[] {
  const parameters = schemaObject(tool.parameters);
  if (!parameters) return [{ tool: tool.name, reason: "parameters-not-object" }];
  if (parameters.type !== "object") return [{ tool: tool.name, reason: "parameters-root-not-json-object" }];
  if (parameters.allOf || parameters.anyOf || parameters.oneOf) return [{ tool: tool.name, reason: "parameters-root-composition" }];
  if (parameters.properties !== undefined && !schemaObject(parameters.properties)) {
    return [{ tool: tool.name, reason: "parameters-properties-not-object" }];
  }
  return [];
}

export function buildToolSchemaFingerprint(tools: ToolSchemaValidationTool[]): string {
  const payload = tools
    .map((tool) => ({ name: tool.name, parameters: tool.parameters ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return createHash("sha256").update(stableJson(payload)).digest("hex").slice(0, 16);
}

export function buildToolSchemaValidationPacket(input: {
  tools: ToolSchemaValidationTool[];
  cache?: ToolSchemaValidationCache;
  nowIso?: string;
}): ToolSchemaValidationPacket {
  const tools = input.tools
    .filter((tool) => typeof tool.name === "string" && tool.name.trim().length > 0)
    .map((tool) => ({ name: tool.name.trim(), parameters: tool.parameters }));
  const fingerprint = buildToolSchemaFingerprint(tools);
  const findings = tools.flatMap(validateToolSchema);
  const cacheStatus: ToolSchemaValidationCacheStatus = input.cache
    ? input.cache.fingerprint === fingerprint
      ? findings.length === 0 ? "hit" : "stale"
      : "miss"
    : "unavailable";
  const decision: ToolSchemaValidationDecision = findings.length > 0
    ? "invalid"
    : cacheStatus === "hit" && (input.cache?.decision === "valid" || input.cache?.decision === "cached-valid")
      ? "cached-valid"
      : tools.length > 0 ? "valid" : "needs-validation";
  const rollbackPath = [
    "do not reload into invalid tool schemas",
    "keep L1/manual operation active while schema findings are fixed",
    "re-run the focused schema validation packet before retrying reload or hatch",
  ];
  return {
    mode: "tool-schema-validation",
    activation: "none",
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    mutationAllowed: false,
    decision,
    cacheStatus,
    fingerprint,
    validatedAtIso: decision === "valid" || decision === "cached-valid" ? input.cache?.validatedAtIso ?? input.nowIso : undefined,
    total: tools.length,
    invalid: findings.length,
    findings,
    rollbackPath,
    summary: [
      `tool-schema-validation: decision=${decision}`,
      `tools=${tools.length}`,
      `invalid=${findings.length}`,
      `cache=${cacheStatus}`,
      `fingerprint=${fingerprint}`,
      "mutation=no",
      formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE),
    ].join(" "),
  };
}
