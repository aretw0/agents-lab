import { describe, expect, it } from "vitest";
import { registerGuardrailsRecurringFailureSurface } from "../../extensions/guardrails-core-recurring-failure-surface";

type RegisteredTool = {
  name: string;
  execute: (toolCallId: string, params: Record<string, unknown>) => { content?: Array<{ type: "text"; text: string }>; details: Record<string, unknown> };
};

describe("guardrails recurring failure surface", () => {
  it("registers read-only recurring failure hardening plan tool", () => {
    const tools: RegisteredTool[] = [];
    registerGuardrailsRecurringFailureSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const tool = tools.find((item) => item.name === "recurring_failure_hardening_plan");
    const result = tool?.execute("call-test", {
      occurrence_count: 2,
      has_documented_rule: true,
      has_primitive: false,
      has_regression_test: false,
      has_runtime_guard: false,
      old_path_still_available: true,
    });

    expect(result?.details.decision).toBe("create-primitive");
    expect(result?.details.hardIntentRequired).toBe(true);
    expect(result?.details.summary).toBe("recurring-failure: decision=create-primitive hardIntent=yes occurrences=2 reasons=primitive-missing,regression-test-missing");
    expect(result?.content?.[0]?.text).toContain("recurring-failure: decision=create-primitive hardIntent=yes occurrences=2");
    expect(result?.content?.[0]?.text).toContain("payload completo disponível em details");
    expect(result?.content?.[0]?.text).not.toContain('\"decision\"');
  });
});
