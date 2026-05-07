import { describe, expect, it, vi } from "vitest";
import guardrailsCore, { buildSimpleAgentRunPlan, evaluateAgentSpawnReadiness } from "../../extensions/guardrails-core";

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

  it("builds a report-only simple agent run plan when all L1 controls are present", () => {
    const result = buildSimpleAgentRunPlan({
      goal: "create provider canary scorecard",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      declaredFiles: ["docs/research/provider-canary-scorecard-2026-05.md"],
      timeoutMs: 45_000,
      validationGateKnown: true,
      rollbackPlanKnown: true,
      budgetKnown: true,
      abortKnown: true,
      logTailKnown: true,
    });

    expect(result).toMatchObject({
      mode: "simple-agent-run-plan",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      executorApproved: false,
      requiresHumanDecision: true,
      oneSliceOnly: true,
      decision: "ready-for-human-decision",
      recommendationCode: "simple-agent-run-ready-for-human-decision",
      blockers: [],
    });
  });

  it("blocks simple agent run plans without abort and bounded logs", () => {
    const result = buildSimpleAgentRunPlan({
      goal: "create provider canary scorecard",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      declaredFiles: ["docs/research/provider-canary-scorecard-2026-05.md"],
      timeoutMs: 45_000,
      validationGateKnown: true,
      rollbackPlanKnown: true,
      budgetKnown: true,
      abortKnown: false,
      logTailKnown: false,
    });

    expect(result.decision).toBe("blocked");
    expect(result.recommendationCode).toBe("simple-agent-run-blocked-abort");
    expect(result.blockers).toContain("abort-contract-missing");
    expect(result.blockers).toContain("bounded-log-tail-missing");
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
      ) => Promise<{ content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }> | { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
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
    expect(result.content?.[0]?.text).toContain("agent-spawn-readiness: decision=ready-for-simple-spawn");
    expect(result.content?.[0]?.text).toContain("payload completo disponível em details");
    expect(result.content?.[0]?.text).not.toContain('\"decision\"');
  });

  it("exposes simple_agent_run_plan as report-only tool", async () => {
    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsCore>[0];

    guardrailsCore(pi);
    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "simple_agent_run_plan");
    const tool = toolCall?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => Promise<{ content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }> | { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
    };

    const result = await tool.execute(
      "tc-simple-agent-run-plan",
      {
        goal: "create provider canary scorecard",
        provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
        declared_files: ["docs/research/provider-canary-scorecard-2026-05.md"],
        timeout_ms: 45000,
        validation_gate_known: true,
        rollback_plan_known: true,
        budget_known: true,
        abort_known: true,
        log_tail_known: true,
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );

    expect(result.details?.mode).toBe("simple-agent-run-plan");
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.details?.executorApproved).toBe(false);
    expect(result.details?.decision).toBe("ready-for-human-decision");
    expect(result.content?.[0]?.text).toContain("simple-agent-run-plan: decision=ready-for-human-decision");
    expect(result.content?.[0]?.text).not.toContain('"runSpec"');
  });
});
