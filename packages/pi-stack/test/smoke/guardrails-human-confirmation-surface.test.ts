import { describe, expect, it, vi } from "vitest";
import { registerGuardrailsHumanConfirmationSurface } from "../../extensions/guardrails-core-human-confirmation-surface";

describe("human confirmation implementation channel surface", () => {
  it("registers a report-only planning tool", () => {
    const pi = { registerTool: vi.fn() } as any;
    registerGuardrailsHumanConfirmationSurface(pi);

    const tool = pi.registerTool.mock.calls[0][0];
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
    const tool = pi.registerTool.mock.calls[0][0];

    const result = tool.execute("call-1", {
      direct_node_modules_patch_requested: true,
      destructive_runtime_enable_requested: true,
    });
    expect(result.details.channel).toBe("blocked");
    expect(result.details.reasons).toContain("direct-node-modules-patch-prohibited");
    expect(result.details.reasons).toContain("destructive-runtime-enable-requires-separate-authorization");
    expect(result.details.dispatchAllowed).toBe(false);
  });
});
