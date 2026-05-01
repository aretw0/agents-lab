import { describe, expect, it, vi } from "vitest";
import guardrailsCore, { evaluateAgentSpawnReadiness } from "../../extensions/guardrails-core";

describe("agent spawn readiness contract", () => {
  it("returns ready-for-simple-spawn for single agent with explicit bounded controls", () => {
    const result = evaluateAgentSpawnReadiness({
      maxAgentsRequested: 1,
      timeoutMs: 120_000,
      cwdIsolationKnown: true,
      budgetKnown: true,
      rollbackPlanKnown: true,
      boundedScopeKnown: true,
      liveReloadCompleted: true,
    });

    expect(result).toMatchObject({
      mode: "agent-spawn-readiness",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      decision: "ready-for-simple-spawn",
      recommendationCode: "agent-spawn-ready-simple",
      blockers: [],
    });
  });

  it("fails closed when bounded controls are missing", () => {
    const result = evaluateAgentSpawnReadiness({
      maxAgentsRequested: 1,
      timeoutMs: 0,
      cwdIsolationKnown: false,
      budgetKnown: false,
      rollbackPlanKnown: false,
      boundedScopeKnown: false,
      liveReloadCompleted: true,
    });

    expect(result.decision).toBe("keep-report-only");
    expect(result.recommendationCode).toBe("agent-spawn-keep-report-only-timeout");
    expect(result.blockers).toContain("timeout-out-of-bounds");
  });

  it("fails closed when more than one agent is requested", () => {
    const result = evaluateAgentSpawnReadiness({
      maxAgentsRequested: 2,
      timeoutMs: 60_000,
      cwdIsolationKnown: true,
      budgetKnown: true,
      rollbackPlanKnown: true,
      boundedScopeKnown: true,
      liveReloadCompleted: true,
    });

    expect(result.decision).toBe("keep-report-only");
    expect(result.recommendationCode).toBe("agent-spawn-keep-report-only-multi-agent");
    expect(result.blockers).toContain("multi-agent-requested");
  });

  it("exposes agent_spawn_readiness_gate as read-only tool", async () => {
    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsCore>[0];

    guardrailsCore(pi);
    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_spawn_readiness_gate");
    const tool = toolCall?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => Promise<{ details?: Record<string, unknown> }> | { details?: Record<string, unknown> };
    };

    const result = await tool.execute(
      "tc-agent-spawn-gate",
      {
        max_agents_requested: 1,
        timeout_ms: 120000,
        cwd_isolation_known: true,
        budget_known: true,
        rollback_plan_known: true,
        bounded_scope_known: true,
        live_reload_completed: true,
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );

    expect(result.details?.mode).toBe("agent-spawn-readiness");
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.details?.decision).toBe("ready-for-simple-spawn");
  });
});
