import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { resolveHumanConfirmationImplementationChannelPlan } from "./guardrails-core-human-confirmation";

function normalizePreferredChannel(value: unknown): "guard-owned" | "wrapper" | "upstream-pr" | undefined {
  return value === "guard-owned" || value === "wrapper" || value === "upstream-pr" ? value : undefined;
}

export function registerGuardrailsHumanConfirmationSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "human_confirmation_implementation_channel_plan",
    label: "Human Confirmation Implementation Channel Plan",
    description: "Read-only report-only plan for structured human-confirmation signal implementation. Never enables destructive dialogs, dispatch, overrides, or node_modules patches.",
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
      const result = resolveHumanConfirmationImplementationChannelPlan({
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
