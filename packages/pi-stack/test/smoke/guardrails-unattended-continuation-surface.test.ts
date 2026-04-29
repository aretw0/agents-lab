import { describe, expect, it } from "vitest";
import { registerGuardrailsUnattendedContinuationSurface } from "../../extensions/guardrails-core-unattended-continuation-surface";

type RegisteredTool = {
  name: string;
  execute: (toolCallId: string, params: Record<string, unknown>) => { details: Record<string, unknown> };
};

describe("guardrails unattended continuation surface", () => {
  it("registers read-only continuation plan tool", () => {
    const tools: RegisteredTool[] = [];
    registerGuardrailsUnattendedContinuationSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const planTool = tools.find((tool) => tool.name === "unattended_continuation_plan");
    const result = planTool?.execute("call-test", {
      next_local_safe: true,
      protected_scope: false,
      risk: false,
      ambiguous: false,
      progress_saved: true,
      context_level: "checkpoint",
    });

    expect(result?.details.canContinue).toBe(true);
    expect(result?.details.decision).toBe("continue-local");
    expect(result?.details.summary).toBe("unattended-continuation: decision=continue-local continue=yes reasons=local-safe-next-step,checkpoint-progress-saved");
  });
});
