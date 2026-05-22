import { describe, expect, it, vi } from "vitest";
import guardrailsAgentRun from "../../extensions/guardrails-agent-run";
import { buildAgentRunBatchDryRunPacket } from "../../extensions/guardrails-core-exports";

describe("agent run batch dry-run contract", () => {
  it("builds a report-only local batch dry-run without bypassing lower start gates", () => {
    const result = buildAgentRunBatchDryRunPacket({
      batchId: "task-bud-1051-control-plane-batch",
      authorization: "explicit-local-batch",
      localSafeScope: true,
      validationGateKnown: true,
      rollbackPlanKnown: true,
      stopConditionsClear: true,
      concurrentWorkerLimit: 1,
      requestedRunId: "task-bud-1051-control-plane-batch-task-bud-1051",
      workers: [
        {
          taskId: "TASK-BUD-1051",
          goal: "review the batch dry-run primitive and return a bounded finding list",
          providerModelRef: "openai-codex/gpt-5.3-codex-spark",
          cwd: process.cwd(),
          declaredFiles: ["packages/pi-stack/extensions/guardrails-core-agent-run-batch-dry-run.ts"],
          timeoutMs: 90_000,
          budgetDecision: "ok",
          budgetEvidence: "local dry-run budget ok",
        },
      ],
    });

    expect(result).toMatchObject({
      mode: "agent-run-batch-dry-run",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      processStartAllowed: false,
      workerDispatchAllowed: false,
      batchExecutionAllowed: false,
      maxConcurrentWorkers: 1,
      decision: "ready-for-operator-decision",
      blockers: [],
      plannedRunIds: ["task-bud-1051-control-plane-batch-task-bud-1051"],
    });
    expect(result.workerPlans[0]?.lowerGateDecision).toBe("ready-for-operator-decision");
    expect(result.lowerGateRequired).toContain("agent_run_start_packet per planned worker");
    expect(result.summary).toContain("dispatch=no");
    expect(result.summary).toContain("processStart=no");
  });

  it("blocks local batch dry-run when selected runId is outside the batch", () => {
    const result = buildAgentRunBatchDryRunPacket({
      batchId: "task-bud-1051-control-plane-batch",
      authorization: "explicit-local-batch",
      localSafeScope: true,
      validationGateKnown: true,
      rollbackPlanKnown: true,
      stopConditionsClear: true,
      requestedRunId: "outside-run",
      workers: [
        {
          taskId: "TASK-BUD-1051",
          goal: "bounded review",
          providerModelRef: "openai-codex/gpt-5.3-codex-spark",
          cwd: process.cwd(),
          declaredFiles: ["packages/pi-stack/extensions/guardrails-core-agent-run-batch-dry-run.ts"],
          timeoutMs: 90_000,
          budgetDecision: "ok",
          budgetEvidence: "local dry-run budget ok",
        },
      ],
    });

    expect(result.decision).toBe("blocked");
    expect(result.blockers).toContain("run-id-outside-batch:outside-run");
    expect(result.processStartAllowed).toBe(false);
  });

  it("blocks local batch dry-run for protected scope, scheduler, repeat, or concurrent workers", () => {
    const result = buildAgentRunBatchDryRunPacket({
      batchId: "task-bud-1051-control-plane-batch",
      authorization: "generic",
      localSafeScope: true,
      validationGateKnown: true,
      rollbackPlanKnown: true,
      stopConditionsClear: true,
      concurrentWorkerLimit: 2,
      protectedScopeRequested: true,
      schedulerRequested: true,
      repeatRequested: true,
      workers: [
        {
          taskId: "TASK-BUD-1051",
          goal: "bounded review",
          providerModelRef: "openai-codex/gpt-5.3-codex-spark",
          cwd: process.cwd(),
          declaredFiles: ["packages/pi-stack/extensions/guardrails-core-agent-run-batch-dry-run.ts"],
          timeoutMs: 90_000,
          budgetDecision: "ok",
          budgetEvidence: "local dry-run budget ok",
        },
      ],
    });

    expect(result.decision).toBe("blocked");
    expect(result.blockers).toEqual(expect.arrayContaining([
      "authorization-generic",
      "multi-worker-concurrency-requested",
      "protected-scope-requested",
      "scheduler-requested",
      "repeat-requested",
    ]));
    expect(result.blockedRequests).toEqual(expect.arrayContaining(["multi-worker", "protected-scope", "scheduler", "repeat"]));
  });

  it("exposes agent_run_batch_dry_run as report-only tool", async () => {
    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsAgentRun>[0];
    guardrailsAgentRun(pi);

    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_batch_dry_run");
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
      "tc-agent-run-batch-dry-run",
      {
        batch_id: "task-bud-1051-control-plane-batch",
        authorization: "explicit-local-batch",
        local_safe_scope: true,
        validation_gate_known: true,
        rollback_plan_known: true,
        stop_conditions_clear: true,
        workers: [
          {
            task_id: "TASK-BUD-1051",
            goal: "return a bounded review note",
            provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
            declared_files: ["packages/pi-stack/extensions/guardrails-core-agent-run-batch-dry-run.ts"],
            timeout_ms: 90_000,
            budget_decision: "ok",
            budget_evidence: "local dry-run budget ok",
          },
        ],
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );

    expect(result.details?.mode).toBe("agent-run-batch-dry-run");
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.details?.processStartAllowed).toBe(false);
    expect(result.details?.decision).toBe("ready-for-operator-decision");
    expect(result.content?.[0]?.text).toContain("agent-run-batch-dry-run: decision=ready-for-operator-decision");
    expect(result.content?.[0]?.text).not.toContain('"workerPlans"');
  });
});
