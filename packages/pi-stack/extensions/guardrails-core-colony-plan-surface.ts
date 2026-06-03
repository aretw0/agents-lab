import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { asOptionalBoolean, asOptionalStringArray } from "./guardrails-core-agent-run-basic-surface";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";
import { buildColonyPlanPacket, type ColonyPlanInput } from "./guardrails-core-colony-plan";

function parseWorkerInputs(raw: unknown): NonNullable<ColonyPlanInput["workers"]> {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((worker): worker is Record<string, unknown> => worker != null && typeof worker === "object")
    .map((record): NonNullable<ColonyPlanInput["workers"]>[number] => ({
      id: typeof record.packet_id === "string" ? record.packet_id : undefined,
      objective: typeof record.objective === "string" ? record.objective : undefined,
      declaredFiles: asOptionalStringArray(record.declared_files),
      allowedTools: asOptionalStringArray(record.allowed_tools),
      allowedCapabilities: asOptionalStringArray(record.allowed_capabilities),
      providerModelRef: typeof record.provider_model_ref === "string" ? record.provider_model_ref : undefined,
      budgetEvidencePolicy: typeof record.budget_evidence_policy === "string" ? record.budget_evidence_policy : undefined,
      budgetEvidence: typeof record.budget_evidence === "string" ? record.budget_evidence : undefined,
      stopConditions: asOptionalStringArray(record.stop_conditions),
      expectedArtifact: typeof record.expected_artifact === "string" ? record.expected_artifact : undefined,
    }));
}

export function registerColonyPlanPacketSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "colony_plan_packet",
    label: "Colony Plan Packet",
    description:
      "Report-only colony local-safe plan packetizer. Decomposes one objective into 2–5 worker packets and a fail-closed fan-in contract. The packet never dispatches execution.",
    parameters: Type.Object({
      plan_id: Type.Optional(Type.String({ description: "Stable plan id used to derive outcome ids." })),
      objective: Type.Optional(Type.String({ description: "Top-level objective for the colony plan." })),
      workers: Type.Optional(Type.Array(Type.Object({
        packet_id: Type.Optional(Type.String({ description: "Stable worker packet id." })),
        objective: Type.Optional(Type.String({ description: "Worker objective/prompt." })),
        declared_files: Type.Optional(Type.Array(Type.String(), { description: "Exact declared files scoped to this worker." })),
        allowed_tools: Type.Optional(Type.Array(Type.String(), { description: "Allowed tool names for this worker packet." })),
        allowed_capabilities: Type.Optional(Type.Array(Type.String(), { description: "Allowed capability labels for this worker packet." })),
        provider_model_ref: Type.Optional(Type.String({ description: "Optional provider/model for this worker." })),
        budget_evidence_policy: Type.Optional(Type.String({ description: "Budget decision hint: ok/warn/blocked/unknown." })),
        budget_evidence: Type.Optional(Type.String({ description: "Budget evidence text." })),
        stop_conditions: Type.Optional(Type.Array(Type.String(), { description: "Explicit stop conditions for this worker." })),
        expected_artifact: Type.Optional(Type.String({ description: "Expected artifact produced by this worker packet." })),
      }), { description: "2 to 5 bounded worker packet definitions." })),
      validation_known: Type.Optional(Type.Boolean({ description: "Whether validation is known." })),
      rollback_plan_known: Type.Optional(Type.Boolean({ description: "Whether rollback is known." })),
      stop_conditions_clear: Type.Optional(Type.Boolean({ description: "Whether stop conditions are explicit and clear before fan-in." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Optional fallback provider/model applied to workers without explicit provider/model." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Block when protected scope is requested." })),
      scheduler_requested: Type.Optional(Type.Boolean({ description: "Block scheduler/daemon execution requests." })),
      repeat_requested: Type.Optional(Type.Boolean({ description: "Block repeat request because it changes lane continuity assumptions." })),
      remote_or_offload_requested: Type.Optional(Type.Boolean({ description: "Block remote/offload requests." })),
      github_actions_requested: Type.Optional(Type.Boolean({ description: "Block GitHub Actions/protected CI requests." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const input: ColonyPlanInput = {
        planId: typeof p.plan_id === "string" ? p.plan_id : undefined,
        objective: typeof p.objective === "string" ? p.objective : undefined,
        workers: parseWorkerInputs(p.workers),
        validationKnown: asOptionalBoolean(p.validation_known),
        rollbackPlanKnown: asOptionalBoolean(p.rollback_plan_known),
        stopConditionsClear: asOptionalBoolean(p.stop_conditions_clear),
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
        schedulerRequested: asOptionalBoolean(p.scheduler_requested),
        repeatRequested: asOptionalBoolean(p.repeat_requested),
        remoteOrOffloadRequested: asOptionalBoolean(p.remote_or_offload_requested),
        githubActionsRequested: asOptionalBoolean(p.github_actions_requested),
      };

      const result = buildColonyPlanPacket(input);
      return buildOperatorVisibleToolResponse({
        label: "colony_plan_packet",
        summary: result.summary,
        details: result,
      });
    },
  });
}
