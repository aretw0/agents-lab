import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { resolveValidationMethodPlan, type ValidationMethodKind } from "./guardrails-core-validation-method";

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeKind(value: unknown): ValidationMethodKind {
  return value === "marker-check" || value === "focal-test" || value === "structured-read" || value === "unknown" ? value : "unknown";
}

export function registerGuardrailsValidationMethodSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "validation_method_plan",
    label: "Validation Method Plan",
    description: "Choose a safe validation method for unattended/local-first work. Read-only and side-effect-free.",
    parameters: Type.Object({
      kind: Type.String({ description: "marker-check | focal-test | structured-read | unknown" }),
      safe_marker_tool_available: Type.Optional(Type.Boolean({ description: "Whether safe_marker_check/evaluateTextMarkerCheck is available. Default true." })),
      shell_inline_requested: Type.Optional(Type.Boolean({ description: "Whether a shell-inline marker check was requested. Default false." })),
      command_sensitive_markers: Type.Optional(Type.Boolean({ description: "Whether markers include command-sensitive syntax. Default false." })),
      touches_protected_scope: Type.Optional(Type.Boolean({ description: "Whether validation touches a protected scope. Default false." })),
      needs_mutation: Type.Optional(Type.Boolean({ description: "Whether validation would mutate state. Default false." })),
      focal_gate_known: Type.Optional(Type.Boolean({ description: "Whether the focal test/gate is known. Default false." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = resolveValidationMethodPlan({
        kind: normalizeKind(p.kind),
        safeMarkerToolAvailable: asBool(p.safe_marker_tool_available, true),
        shellInlineRequested: asBool(p.shell_inline_requested, false),
        commandSensitiveMarkers: asBool(p.command_sensitive_markers, false),
        touchesProtectedScope: asBool(p.touches_protected_scope, false),
        needsMutation: asBool(p.needs_mutation, false),
        focalGateKnown: asBool(p.focal_gate_known, false),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}
