/**
 * @capability-id runtime-guardrails
 * @capability-criticality high
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { resolveOperatorConfirmationImplementationChannelPlan } from "./guardrails-core-operator-confirmation";
import { buildOperatorApprovalPacket, type OperatorApprovalIntentKind } from "./guardrails-core-operator-approval";

function normalizePreferredChannel(value: unknown): "guard-owned" | "wrapper" | "upstream-pr" | undefined {
  return value === "guard-owned" || value === "wrapper" || value === "upstream-pr" ? value : undefined;
}

function normalizeApprovalIntentKind(value: unknown): OperatorApprovalIntentKind {
  if (value === "worker-single-run" || value === "worker-suite" || value === "protected" || value === "destructive") return value;
  return "local-safe";
}

export function registerGuardrailsOperatorConfirmationSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "operator_approval_packet",
    label: "Operator Approval Packet",
    description: "Report-only UX approval packet. Recommends yes/no, choice, or suite approval without authorizing dispatch.",
    parameters: Type.Object({
      intent_kind: Type.String({ description: "local-safe | worker-single-run | worker-suite | protected | destructive" }),
      recommended_action: Type.Optional(Type.String({ description: "Short recommended action shown to the operator." })),
      options: Type.Optional(Type.Array(Type.String(), { description: "Optional short choices for structured choice approval." })),
      suite_id: Type.Optional(Type.String({ description: "Suite id for worker-suite approvals." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Provider/model for worker approvals." })),
      max_calls: Type.Optional(Type.Number({ description: "Maximum model calls for suite approval." })),
      max_cost_usd: Type.Optional(Type.Number({ description: "Maximum suite cost." })),
      parallelism: Type.Optional(Type.Number({ description: "Maximum parallelism." })),
      structured_approval_available: Type.Optional(Type.Boolean({ description: "Whether runtime can record trusted structured operator approval." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks if intent kind is not protected." })),
      destructive_action_requested: Type.Optional(Type.Boolean({ description: "Blocks if intent kind is not destructive." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = buildOperatorApprovalPacket({
        intentKind: normalizeApprovalIntentKind(p.intent_kind),
        recommendedAction: typeof p.recommended_action === "string" ? p.recommended_action : undefined,
        options: Array.isArray(p.options) ? p.options.filter((entry): entry is string => typeof entry === "string") : undefined,
        suiteId: typeof p.suite_id === "string" ? p.suite_id : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        maxCalls: typeof p.max_calls === "number" ? p.max_calls : undefined,
        maxCostUsd: typeof p.max_cost_usd === "number" ? p.max_cost_usd : undefined,
        parallelism: typeof p.parallelism === "number" ? p.parallelism : undefined,
        structuredApprovalAvailable: typeof p.structured_approval_available === "boolean" ? p.structured_approval_available : undefined,
        protectedScopeRequested: typeof p.protected_scope_requested === "boolean" ? p.protected_scope_requested : undefined,
        destructiveActionRequested: typeof p.destructive_action_requested === "boolean" ? p.destructive_action_requested : undefined,
      });
      return {
        content: [{ type: "text", text: result.summary }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "operator_confirmation_implementation_channel_plan",
    label: "Operator Confirmation Implementation Channel Plan",
    description: "Read-only report-only plan for structured operator approval signal implementation. Never enables destructive dialogs, dispatch, overrides, or node_modules patches.",
    parameters: Type.Object({
      preferred_channel: Type.Optional(Type.String({ description: "guard-owned | wrapper | upstream-pr" })),
      guard_can_own_dialog: Type.Optional(Type.Boolean({ description: "Whether a first-party guard can own the confirmation dialog." })),
      wrapper_can_preserve_structured_details: Type.Optional(Type.Boolean({ description: "Whether a wrapper can preserve structured envelope details to the consumer." })),
      upstream_change_accepted: Type.Optional(Type.Boolean({ description: "Whether an upstream confirmation-signal change is already accepted/released." })),
      direct_node_modules_patch_requested: Type.Optional(Type.Boolean({ description: "Blocks when direct node_modules mutation is requested." })),
      destructive_runtime_enable_requested: Type.Optional(Type.Boolean({ description: "Blocks when enabling operational destructive confirmation runtime is requested." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = resolveOperatorConfirmationImplementationChannelPlan({
        preferredChannel: normalizePreferredChannel(p.preferred_channel),
        guardCanOwnDialog: typeof p.guard_can_own_dialog === "boolean" ? p.guard_can_own_dialog : undefined,
        wrapperCanPreserveStructuredDetails: typeof p.wrapper_can_preserve_structured_details === "boolean" ? p.wrapper_can_preserve_structured_details : undefined,
        upstreamChangeAccepted: typeof p.upstream_change_accepted === "boolean" ? p.upstream_change_accepted : undefined,
        directNodeModulesPatchRequested: typeof p.direct_node_modules_patch_requested === "boolean" ? p.direct_node_modules_patch_requested : undefined,
        destructiveRuntimeEnableRequested: typeof p.destructive_runtime_enable_requested === "boolean" ? p.destructive_runtime_enable_requested : undefined,
      });
      return {
        content: [{ type: "text", text: result.summary }],
        details: result,
      };
    },
  });
}
