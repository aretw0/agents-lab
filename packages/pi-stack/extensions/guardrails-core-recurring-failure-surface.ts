import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { resolveRecurringFailureHardening } from "./guardrails-core-recurring-failure";

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const raw = Number(value);
  return Number.isFinite(raw) ? raw : fallback;
}

export function registerGuardrailsRecurringFailureSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "recurring_failure_hardening_plan",
    label: "Recurring Failure Hardening Plan",
    description: "Plan when repeated failures must escalate from soft guidance to documented rule, primitive/test, runtime guard, or old-path blocking. Read-only and side-effect-free.",
    parameters: Type.Object({
      occurrence_count: Type.Number({ description: "How many times the same failure pattern has occurred." }),
      has_documented_rule: Type.Optional(Type.Boolean({ description: "Whether a short documented rule already exists." })),
      has_primitive: Type.Optional(Type.Boolean({ description: "Whether a reusable primitive/helper already exists." })),
      has_regression_test: Type.Optional(Type.Boolean({ description: "Whether regression test coverage already exists." })),
      has_runtime_guard: Type.Optional(Type.Boolean({ description: "Whether a runtime tool/monitor/guard already steers away from the failure." })),
      old_path_still_available: Type.Optional(Type.Boolean({ description: "Whether the old unsafe/manual path is still available. Default true." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = resolveRecurringFailureHardening({
        occurrenceCount: asNumber(p.occurrence_count, 0),
        hasDocumentedRule: asBool(p.has_documented_rule, false),
        hasPrimitive: asBool(p.has_primitive, false),
        hasRegressionTest: asBool(p.has_regression_test, false),
        hasRuntimeGuard: asBool(p.has_runtime_guard, false),
        oldPathStillAvailable: asBool(p.old_path_still_available, true),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}
