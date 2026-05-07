import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import guardrailsCore, { buildOneSliceAgentRunPlan, evaluateAgentSpawnReadiness } from "../../extensions/guardrails-core";
import { buildOneSliceAgentAbortPlan, buildOneSliceAgentRunStatus } from "../../extensions/guardrails-core-one-slice-agent-run-runtime";

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

  it("builds a report-only one-slice agent run plan when all L1 controls are present", () => {
    const result = buildOneSliceAgentRunPlan({
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
      mode: "one-slice-agent-run-plan",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      executorApproved: false,
      requiresHumanDecision: true,
      oneSliceOnly: true,
      decision: "ready-for-human-decision",
      recommendationCode: "one-slice-agent-run-ready-for-human-decision",
      blockers: [],
    });
  });

  it("blocks one-slice agent run plans without abort and bounded logs", () => {
    const result = buildOneSliceAgentRunPlan({
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
    expect(result.recommendationCode).toBe("one-slice-agent-run-blocked-abort");
    expect(result.blockers).toContain("abort-contract-missing");
    expect(result.blockers).toContain("bounded-log-tail-missing");
  });

  it("reports one-slice agent run status and dry-first abort plans", () => {
    const entry = {
      runId: "run-1",
      pid: 12345,
      state: "running" as const,
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      declaredFiles: ["docs/research/provider-canary-scorecard-2026-05.md"],
      startedAtIso: "2026-05-07T00:00:00.000Z",
      lastEventAtIso: "2026-05-07T00:00:30.000Z",
    };

    const status = buildOneSliceAgentRunStatus("run-1", entry, Date.parse("2026-05-07T00:00:45.000Z"));
    expect(status).toMatchObject({
      mode: "one-slice-agent-run-status",
      dispatchAllowed: false,
      processStartAllowed: false,
      processStopAllowed: false,
      found: true,
      state: "running",
      stale: false,
    });

    const dryRun = buildOneSliceAgentAbortPlan({ runId: "run-1", entry, cwdExpected: process.cwd() });
    expect(dryRun).toMatchObject({
      mode: "one-slice-agent-abort-plan",
      decision: "dry-run",
      processStopAllowed: false,
      authorization: "none",
    });

    const confirmed = buildOneSliceAgentAbortPlan({ runId: "run-1", entry, execute: true, operatorConfirmed: true, cwdExpected: process.cwd() });
    expect(confirmed).toMatchObject({
      decision: "abort-ready",
      processStopAllowed: true,
      authorization: "explicit-human",
      pid: 12345,
    });
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

  it("exposes one-slice agent status, log tail, and abort surfaces", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "one-slice-agent-run-"));
    const reportsDir = path.join(cwd, ".pi", "reports");
    mkdirSync(reportsDir, { recursive: true });
    const logPath = path.join(reportsDir, "run-1.log");
    writeFileSync(logPath, "line-1\nline-2\nline-3\n", "utf8");
    writeFileSync(path.join(reportsDir, "one-slice-agent-runs.json"), JSON.stringify({
      runs: [{
        runId: "run-1",
        pid: 12345,
        state: "running",
        providerModelRef: "openai-codex/gpt-5.3-codex-spark",
        cwd,
        declaredFiles: ["docs/research/provider-canary-scorecard-2026-05.md"],
        logPath,
        startedAtIso: "2026-05-07T00:00:00.000Z",
        lastEventAtIso: "2026-05-07T00:00:30.000Z",
      }],
    }), "utf8");

    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsCore>[0];
    guardrailsCore(pi);

    const getTool = (name: string) => {
      const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === name);
      return toolCall?.[0] as {
        execute: (
          toolCallId: string,
          params: Record<string, unknown>,
          signal: AbortSignal,
          onUpdate: (update: unknown) => void,
          ctx: { cwd: string },
        ) => Promise<{ content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }> | { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
      };
    };

    const status = await getTool("one_slice_agent_run_status").execute("tc-status", { run_id: "run-1" }, undefined as unknown as AbortSignal, () => {}, { cwd });
    expect(status.details?.mode).toBe("one-slice-agent-run-status");
    expect(status.details?.processStopAllowed).toBe(false);
    expect(status.content?.[0]?.text).toContain("state=running");

    const tail = await getTool("one_slice_agent_run_log_tail").execute("tc-tail", { run_id: "run-1", max_lines: 2 }, undefined as unknown as AbortSignal, () => {}, { cwd });
    expect(tail.details?.mode).toBe("one-slice-agent-run-log-tail");
    expect(tail.details?.lines).toEqual(["line-3", ""]);

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const dryAbort = await getTool("one_slice_agent_run_abort").execute("tc-abort-dry", { run_id: "run-1" }, undefined as unknown as AbortSignal, () => {}, { cwd });
      expect(dryAbort.details?.decision).toBe("dry-run");
      expect(dryAbort.details?.processStopAllowed).toBe(false);
      expect(killSpy).not.toHaveBeenCalled();

      const confirmedAbort = await getTool("one_slice_agent_run_abort").execute("tc-abort", { run_id: "run-1", execute: true, operator_confirmed: true }, undefined as unknown as AbortSignal, () => {}, { cwd });
      expect(confirmedAbort.details?.decision).toBe("abort-ready");
      expect(confirmedAbort.details?.processStopAllowed).toBe(true);
      expect(killSpy).toHaveBeenCalledWith(12345, "SIGTERM");
    } finally {
      killSpy.mockRestore();
    }
  });

  it("exposes one_slice_agent_run_plan as report-only tool", async () => {
    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsCore>[0];

    guardrailsCore(pi);
    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "one_slice_agent_run_plan");
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
      "tc-one-slice-agent-run-plan",
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

    expect(result.details?.mode).toBe("one-slice-agent-run-plan");
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.details?.executorApproved).toBe(false);
    expect(result.details?.decision).toBe("ready-for-human-decision");
    expect(result.content?.[0]?.text).toContain("one-slice-agent-run-plan: decision=ready-for-human-decision");
    expect(result.content?.[0]?.text).not.toContain('"runSpec"');
  });
});
