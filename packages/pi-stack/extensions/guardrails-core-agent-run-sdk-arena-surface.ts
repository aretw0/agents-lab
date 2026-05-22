/**
 * @capability-id runtime-guardrails
 * @capability-criticality high
 */
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { buildAgentRunSdkProviderModelArenaArtifactPacket, buildAgentRunSdkProviderModelArenaFanInPacket, buildAgentRunSdkProviderModelArenaPacket, type AgentRunSdkProviderModelArenaArtifactPacketResult } from "./guardrails-core-agent-run-sdk-arena";
import { resolveExecutionCwdParam } from "./guardrails-core-execution-context";
import { asOptionalBoolean, asOptionalStringArray } from "./guardrails-core-param-normalizers";
import { operatorApprovalParameter } from "./guardrails-core-operator-approval-schema";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

function buildArenaInput(p: Record<string, unknown>, cwd: string) {
  return {
    arenaId: typeof p.arena_id === "string" ? p.arena_id : undefined,
    providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
    cwd: resolveExecutionCwdParam(p.cwd, cwd),
    envelopes: asOptionalStringArray(p.envelopes),
    maxCalls: typeof p.max_calls === "number" ? p.max_calls : undefined,
    timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
    maxEstimatedCostUsd: typeof p.max_estimated_cost_usd === "number" ? p.max_estimated_cost_usd : undefined,
    budgetEvidence: typeof p.budget_evidence === "string" ? p.budget_evidence : undefined,
    budgetDecision: typeof p.budget_decision === "string" ? p.budget_decision : undefined,
    protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
    unexpectedDirty: asOptionalBoolean(p.unexpected_dirty),
  };
}

function assertArenaArtifactPath(cwd: string, artifactPath: string): string {
  const reportsRoot = path.resolve(cwd, ".pi", "reports");
  const target = path.resolve(cwd, artifactPath);
  const relative = path.relative(reportsRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`arena artifact path escapes .pi/reports: ${artifactPath}`);
  }
  return target;
}

function persistArenaArtifactPreviews(cwd: string, packet: AgentRunSdkProviderModelArenaArtifactPacketResult): Array<{ path: string; bytes: number }> {
  if (!packet.writeAllowed) return [];
  const written: Array<{ path: string; bytes: number }> = [];
  for (const artifact of packet.artifactPreviews) {
    const target = assertArenaArtifactPath(cwd, artifact.path);
    const payload = `${JSON.stringify(artifact.payload, null, 2)}\n`;
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, payload, "utf8");
    written.push({ path: artifact.path, bytes: payload.length });
  }
  return written;
}

const arenaToolParameters = Type.Object({
  arena_id: Type.Optional(Type.String({ description: "Future arena run id." })),
  provider_model_ref: Type.Optional(Type.String({ description: "Provider/model reference." })),
  cwd: Type.Optional(Type.String({ description: "Worker cwd. Defaults to current cwd." })),
  envelopes: Type.Optional(Type.Array(Type.String(), { description: "Arena envelopes to include." })),
  max_calls: Type.Optional(Type.Number({ description: "Maximum paid/model calls allowed by the future arena budget." })),
  timeout_ms: Type.Optional(Type.Number({ description: "Bounded timeout per future canary in milliseconds." })),
  max_estimated_cost_usd: Type.Optional(Type.Number({ description: "Maximum estimated spend for the future arena run." })),
  budget_evidence: Type.Optional(Type.String({ description: "Manual or structured budget evidence for this provider/model." })),
  budget_decision: Type.Optional(Type.String({ description: "Provider/model budget decision: ok, warn, blocked, or unknown." })),
  protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope is requested." })),
  unexpected_dirty: Type.Optional(Type.Boolean({ description: "Blocks when workspace dirty state is unexpected." })),
});

export function registerAgentRunSdkProviderModelArenaTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "agent_run_sdk_provider_model_arena_packet",
    label: "Agent Run SDK Provider/Model Arena Packet",
    description: "Report-only arena packet for comparing SDK worker maturity by provider/model/envelope with explicit budgets. Never dispatches paid/model calls.",
    parameters: arenaToolParameters,
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = buildAgentRunSdkProviderModelArenaPacket(buildArenaInput(p, ctx.cwd));
      return buildOperatorVisibleToolResponse({ label: "agent_run_sdk_provider_model_arena_packet", summary: result.summary, details: result });
    },
  });

  pi.registerTool({
    name: "agent_run_sdk_provider_model_arena_artifact_packet",
    label: "Agent Run SDK Provider/Model Arena Artifact Packet",
    description: "Structured-approval local artifact writer for arena suite manifest, scorecard, and fan-in files. Preview by default; never starts workers or dispatches model calls.",
    parameters: Type.Object({
      ...arenaToolParameters.properties,
      apply: Type.Optional(Type.Boolean({ description: "When true, persist only previewed .pi/reports artifacts after structured operator approval." })),
      operator_approval: operatorApprovalParameter(),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const packet = buildAgentRunSdkProviderModelArenaArtifactPacket({
        ...buildArenaInput(p, ctx.cwd),
        apply: asOptionalBoolean(p.apply),
        operatorApproval: p.operator_approval,
      });
      const persistedArtifacts = persistArenaArtifactPreviews(ctx.cwd, packet);
      const result = {
        ...packet,
        persistedArtifacts,
        summary: persistedArtifacts.length > 0 ? `${packet.summary} persisted=${persistedArtifacts.length}` : packet.summary,
      };
      return buildOperatorVisibleToolResponse({ label: "agent_run_sdk_provider_model_arena_artifact_packet", summary: result.summary, details: result });
    },
  });

  pi.registerTool({
    name: "agent_run_sdk_provider_model_arena_fan_in_packet",
    label: "Agent Run SDK Provider/Model Arena Fan-In Packet",
    description: "Read-only fan-in validator for persisted arena manifest, scorecard, and fan-in artifacts. Never dispatches workers or writes files.",
    parameters: Type.Object({
      suite_manifest: Type.Optional(Type.Any({ description: "Persisted arena suite manifest payload." })),
      scorecard: Type.Optional(Type.Any({ description: "Persisted arena scorecard payload with terminal rows." })),
      fan_in_plan: Type.Optional(Type.Any({ description: "Persisted arena fan-in plan payload." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = buildAgentRunSdkProviderModelArenaFanInPacket({
        suiteManifest: p.suite_manifest as never,
        scorecard: p.scorecard as never,
        fanInPlan: p.fan_in_plan as never,
      });
      return buildOperatorVisibleToolResponse({ label: "agent_run_sdk_provider_model_arena_fan_in_packet", summary: result.summary, details: result });
    },
  });
}
