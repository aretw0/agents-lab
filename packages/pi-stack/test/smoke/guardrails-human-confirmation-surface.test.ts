import { describe, expect, it, vi } from "vitest";
import { registerGuardrailsHumanConfirmationSurface } from "../../extensions/guardrails-core-human-confirmation-surface";

describe("human confirmation implementation channel surface", () => {
  it("registers a report-only planning tool", () => {
    const pi = { registerTool: vi.fn() } as any;
    registerGuardrailsHumanConfirmationSurface(pi);

    const tool = pi.registerTool.mock.calls
      .map(([registered]) => registered)
      .find((registered) => registered.name === "human_confirmation_implementation_channel_plan");
    expect(tool.name).toBe("human_confirmation_implementation_channel_plan");
    expect(tool.description).toContain("Never enables destructive dialogs");

    const result = tool.execute("call-1", { guard_can_own_dialog: true });
    expect(result.content[0].text).toContain("channel=guard-owned-report-only");
    expect(result.details).toMatchObject({
      channel: "guard-owned-report-only",
      dispatchAllowed: false,
      implementationAllowed: false,
      runtimeDestructiveDialogEnabled: false,
      directNodeModulesPatchAllowed: false,
      authorization: "none",
    });
  });

  it("blocks prohibited runtime enablement and direct node_modules patches", () => {
    const pi = { registerTool: vi.fn() } as any;
    registerGuardrailsHumanConfirmationSurface(pi);
    const tool = pi.registerTool.mock.calls
      .map(([registered]) => registered)
      .find((registered) => registered.name === "human_confirmation_implementation_channel_plan");

    const result = tool.execute("call-1", {
      direct_node_modules_patch_requested: true,
      destructive_runtime_enable_requested: true,
    });
    expect(result.details.channel).toBe("blocked");
    expect(result.details.reasons).toContain("direct-node-modules-patch-prohibited");
    expect(result.details.reasons).toContain("destructive-runtime-enable-requires-separate-authorization");
    expect(result.details.dispatchAllowed).toBe(false);
  });

  it("registers an operator approval packet tool", () => {
    const pi = { registerTool: vi.fn() } as any;
    registerGuardrailsHumanConfirmationSurface(pi);
    const tool = pi.registerTool.mock.calls
      .map(([registered]) => registered)
      .find((registered) => registered.name === "operator_approval_packet");

    const result = tool.execute("call-approval", {
      intent_kind: "worker-suite",
      suite_id: "arena-openai-spark",
      provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
      max_calls: 3,
      max_cost_usd: 0.25,
      parallelism: 1,
      structured_approval_available: true,
    });

    expect(result.details.interaction).toBe("suite-approval");
    expect(result.details.acceptsShortAnswer).toBe(true);
    expect(result.details.dispatchAllowed).toBe(false);
    expect(result.content[0].text).toContain("interaction=suite-approval");
  });
});
