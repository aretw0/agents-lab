import { describe, expect, it } from "vitest";
import { registerGuardrailsUnattendedContinuationSurface } from "../../extensions/guardrails-core-unattended-continuation-surface";

type RegisteredTool = {
  name: string;
  execute: (toolCallId: string, params: Record<string, unknown>) => {
    content?: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  };
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

    expect(result?.content?.[0]?.text).toBe("unattended-continuation: decision=continue-local continue=yes reasons=local-safe-next-step,checkpoint-progress-saved");
    expect(result?.details.canContinue).toBe(true);
    expect(result?.details.decision).toBe("continue-local");
    expect(result?.details.summary).toBe("unattended-continuation: decision=continue-local continue=yes reasons=local-safe-next-step,checkpoint-progress-saved");
  });

  it("registers compact read-only nudge-free loop canary tool", () => {
    const tools: RegisteredTool[] = [];
    registerGuardrailsUnattendedContinuationSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const canaryTool = tools.find((tool) => tool.name === "nudge_free_loop_canary");
    const ready = canaryTool?.execute("call-ready", {
      opt_in: true,
      next_local_safe: true,
      checkpoint_fresh: true,
      handoff_budget_ok: true,
      git_state_expected: true,
      protected_scopes_clear: true,
      cooldown_ready: true,
      validation_known: true,
      stop_conditions_clear: true,
    });
    const blocked = canaryTool?.execute("call-blocked", {
      opt_in: true,
      next_local_safe: true,
      checkpoint_fresh: true,
      handoff_budget_ok: true,
      git_state_expected: false,
      protected_scopes_clear: false,
      cooldown_ready: true,
      validation_known: true,
      stop_conditions_clear: false,
    });

    expect(ready?.content?.[0]?.text).toBe("nudge-free-loop: decision=ready continue=yes reasons=all-gates-green");
    expect(ready?.details.canContinueWithoutNudge).toBe(true);
    expect(blocked?.content?.[0]?.text).toBe("nudge-free-loop: decision=blocked continue=no reasons=unexpected-git-state,protected-scope-pending,stop-condition-present");
    expect(blocked?.details.canContinueWithoutNudge).toBe(false);
  });
});
