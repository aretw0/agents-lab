import { describe, expect, it, vi } from "vitest";
import { registerGuardrailsCoreToolCallGuard } from "../../extensions/guardrails-core-tool-call-guard";
import { resolveCommandRoutingProfile } from "../../extensions/guardrails-core-shell-routing";

describe("guardrails-core tool-call guard", () => {
  it("blocks Pi TUI slash commands routed through bash", async () => {
    let handler: ((event: unknown, ctx: { cwd: string }) => unknown | Promise<unknown>) | undefined;
    const emitter = {
      on: vi.fn((_eventName: "tool_call", cb: typeof handler) => {
        handler = cb;
      }),
    };
    const runtime = {
      isToolCallEventType: (toolName: string, event: unknown): event is { input: { command: string } } =>
        toolName === "bash" && Boolean((event as any)?.input?.command),
      getShellRoutingProfile: () => resolveCommandRoutingProfile("linux", {} as NodeJS.ProcessEnv),
      getStrictInteractiveMode: () => false,
      getPortConflictConfig: () => ({ enabled: false, suggestedTestPort: 0 }),
      getBloatSmellConfig: () => ({ enabled: false }),
      getEventSurfaceRuntime: () => ({ enabled: false }),
    };

    registerGuardrailsCoreToolCallGuard(emitter, runtime as any);
    const result = await handler?.(
      { input: { command: "/watchdog:status" } },
      { cwd: process.cwd() },
    ) as { block?: boolean; reason?: string } | undefined;

    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("TUI/operator commands");
    expect(result?.reason).toContain("directly in the Pi input");
  });
});
