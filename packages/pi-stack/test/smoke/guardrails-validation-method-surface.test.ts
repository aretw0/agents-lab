import { describe, expect, it } from "vitest";
import { registerGuardrailsValidationMethodSurface } from "../../extensions/guardrails-core-validation-method-surface";

type RegisteredTool = {
  name: string;
  execute: (toolCallId: string, params: Record<string, unknown>) => { details: Record<string, unknown> };
};

describe("guardrails validation method surface", () => {
  it("registers read-only validation method plan tool", () => {
    const tools: RegisteredTool[] = [];
    registerGuardrailsValidationMethodSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const tool = tools.find((item) => item.name === "validation_method_plan");
    const result = tool?.execute("call-test", {
      kind: "marker-check",
      safe_marker_tool_available: true,
      shell_inline_requested: true,
      command_sensitive_markers: true,
    });

    expect(result?.details.decision).toBe("use-safe-marker-check");
    expect(result?.details.canValidate).toBe(true);
    expect(result?.details.summary).toBe("validation-method: decision=use-safe-marker-check canValidate=yes kind=marker-check reasons=legacy-shell-inline-requested,command-sensitive-markers");
  });
});
