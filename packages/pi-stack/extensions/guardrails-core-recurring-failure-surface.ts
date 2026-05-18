import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { asBooleanWithDefault, asNumberWithDefault } from "./guardrails-core-param-normalizers";
import { resolveRecurringFailureHardening } from "./guardrails-core-recurring-failure";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

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
        occurrenceCount: asNumberWithDefault(p.occurrence_count, 0),
        hasDocumentedRule: asBooleanWithDefault(p.has_documented_rule, false),
        hasPrimitive: asBooleanWithDefault(p.has_primitive, false),
        hasRegressionTest: asBooleanWithDefault(p.has_regression_test, false),
        hasRuntimeGuard: asBooleanWithDefault(p.has_runtime_guard, false),
        oldPathStillAvailable: asBooleanWithDefault(p.old_path_still_available, true),
      });
      return buildOperatorVisibleToolResponse({
        label: "recurring_failure_hardening_plan",
        summary: result.summary,
        details: result,
      });
    },
  });
}
