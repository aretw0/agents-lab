import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import guardrailsCore, { buildAgentRunPlan, buildAgentRunStartPacket, evaluateAgentSpawnReadiness, resolveProviderExecutionBudgetEvidence } from "../../extensions/guardrails-core";
import { buildAgentRunAbortPlan, buildAgentRunOutcomePacket, buildAgentRunRegistryUpsertPacket, buildAgentRunStatus } from "../../extensions/guardrails-core-agent-run-runtime";

describe("agent spawn readiness contract", () => {
  it("keeps the agent-run family free of superseded naming", () => {
    const focalFiles = [
      "packages/pi-stack/extensions/guardrails-core-agent-spawn-readiness.ts",
      "packages/pi-stack/extensions/guardrails-core-agent-run-plan.ts",
      "packages/pi-stack/extensions/guardrails-core-agent-run-runtime.ts",
      "packages/pi-stack/extensions/guardrails-core-agent-run-start.ts",
      "packages/pi-stack/extensions/guardrails-core-agent-spawn-readiness-surface.ts",
      "packages/pi-stack/extensions/guardrails-core-provider-budget-evidence.ts",
    ];
    const supersededMarkers = [
      "one_slice_agent_run",
      "one-slice-agent-run",
      "buildOneSliceAgentRun",
      "ready-for-simple-spawn",
      "agent-spawn-ready-simple",
      "simpleSpawn",
    ];

    for (const file of focalFiles) {
      const text = readFileSync(path.join(process.cwd(), file), "utf8");
      for (const marker of supersededMarkers) {
        expect(text, `${file} should not contain ${marker}`).not.toContain(marker);
      }
    }
  });

  it("returns ready-for-agent-run for single agent with explicit bounded controls", () => {
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
      decision: "ready-for-agent-run",
      recommendationCode: "agent-spawn-ready-agent-run",
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

  it("builds a report-only agent run plan when all L1 controls are present", () => {
    const result = buildAgentRunPlan({
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
      mode: "agent-run-plan",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      executorApproved: false,
      requiresHumanDecision: true,
      singleRunOnly: true,
      decision: "ready-for-human-decision",
      recommendationCode: "agent-run-ready-for-human-decision",
      blockers: [],
    });
  });

  it("keeps provider execution budget evidence generic for control-plane and agent starts", () => {
    expect(resolveProviderExecutionBudgetEvidence({ budgetDecision: "ok", budgetEvidence: "dashscope ok" })).toMatchObject({
      decision: "ok",
      evidence: "dashscope ok",
      readyForExecution: true,
      blockers: [],
    });
    expect(resolveProviderExecutionBudgetEvidence({ budgetDecision: "blocked", budgetEvidence: "aggregate policy blocked" })).toMatchObject({
      decision: "blocked",
      readyForExecution: false,
      blockers: ["budget-blocked"],
    });
    expect(resolveProviderExecutionBudgetEvidence({})).toMatchObject({
      decision: "unknown",
      readyForExecution: false,
      blockers: ["budget-decision-missing"],
    });
  });

  it("builds a report-only provider-native agent run start packet", () => {
    const result = buildAgentRunStartPacket({
      runId: "task-bud-990-stale-resume-review",
      goal: "Review TASK-BUD-990 stale resume guidance fix and return a bounded note.",
      providerModelRef: "dashscope/qwen3-coder-plus",
      cwd: process.cwd(),
      declaredFiles: ["packages/pi-stack/extensions/context-watchdog-auto-resume.ts"],
      timeoutMs: 90_000,
      logPath: ".pi/reports/task-bud-990-stale-resume-review.log",
      budgetDecision: "ok",
      budgetEvidence: "dashscope provider budget ok from quota_visibility_provider_budgets",
    });

    expect(result).toMatchObject({
      mode: "agent-run-start-packet",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      processStartAllowed: false,
      processStopAllowed: false,
      requiresHumanDecision: true,
      singleRunOnly: true,
      decision: "ready-for-human-decision",
      recommendationCode: "agent-run-start-ready-for-human-decision",
      blockers: [],
      commandPreview: {
        command: "pi",
        shellInterpolationAllowed: false,
      },
      humanConfirmationPhrase: "execute o worker task-bud-990-stale-resume-review",
    });
    expect(result.runSpec.budgetDecision).toBe("ok");
    expect(result.runSpec.extensionIsolation).toBe("minimal-no-extensions");
    expect(result.commandPreview.args).toContain("--no-extensions");
    expect(result.commandPreview.args).toContain("--no-skills");
    expect(result.commandPreview.args).toContain("--no-prompt-templates");
    expect(result.commandPreview.args).toContain("--no-themes");
    expect(result.commandPreview.args).toContain("--no-context-files");
    expect(result.commandPreview.args).toContain("--model");
    expect(result.commandPreview.args).toContain("dashscope/qwen3-coder-plus");
    expect(result.commandPreview.args).toContain("read,grep,find,ls");

    const inherited = buildAgentRunStartPacket({
      ...result.runSpec,
      extensionIsolation: "inherit",
    });
    expect(inherited.commandPreview.args).not.toContain("--no-extensions");
  });

  it("blocks provider-native start packets without explicit non-blocked budget evidence", () => {
    const missing = buildAgentRunStartPacket({
      runId: "run-budget-missing",
      goal: "review one local file",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      declaredFiles: ["docs/research/provider-canary-scorecard-2026-05.md"],
      timeoutMs: 90_000,
      logPath: ".pi/reports/run-budget-missing.log",
    });
    expect(missing.decision).toBe("blocked");
    expect(missing.blockers).toContain("budget-decision-missing");

    const blocked = buildAgentRunStartPacket({
      runId: "run-budget-blocked",
      goal: "review one local file",
      providerModelRef: "openai-codex/gpt-5.3-codex",
      cwd: process.cwd(),
      declaredFiles: ["docs/research/provider-canary-scorecard-2026-05.md"],
      timeoutMs: 90_000,
      logPath: ".pi/reports/run-budget-blocked.log",
      budgetDecision: "blocked",
      budgetEvidence: "provider-level local budget blocked",
    });
    expect(blocked.decision).toBe("blocked");
    expect(blocked.recommendationCode).toBe("agent-run-start-blocked-budget");
    expect(blocked.blockers).toContain("budget-blocked");
  });

  it("blocks provider-native start packets that request write tools or protected scope", () => {
    const result = buildAgentRunStartPacket({
      runId: "run-write-blocked",
      goal: "edit protected settings",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      declaredFiles: [".pi/settings.json"],
      timeoutMs: 90_000,
      toolAllowlist: ["read", "edit", "bash"],
      logPath: ".pi/reports/run-write-blocked.log",
      protectedScopeRequested: true,
    });

    expect(result.decision).toBe("blocked");
    expect(result.recommendationCode).toBe("agent-run-start-blocked-protected-scope");
    expect(result.blockers).toContain("protected-scope-requested");
    expect(result.blockers).toContain("non-read-only-tools:edit,bash");
    expect(result.processStartAllowed).toBe(false);
  });

  it("blocks agent run plans without abort and bounded logs", () => {
    const result = buildAgentRunPlan({
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
    expect(result.recommendationCode).toBe("agent-run-blocked-abort");
    expect(result.blockers).toContain("abort-contract-missing");
    expect(result.blockers).toContain("bounded-log-tail-missing");
  });

  it("builds dry-first registry upsert packets without dispatch", () => {
    const dryRun = buildAgentRunRegistryUpsertPacket({
      runId: "run-upsert",
      state: "planned",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      declaredFiles: ["docs/research/provider-canary-scorecard-2026-05.md"],
      logPath: ".pi/reports/run-upsert.log",
      timeoutMs: 90_000,
    });

    expect(dryRun).toMatchObject({
      mode: "agent-run-registry-upsert",
      decision: "dry-run",
      writeAllowed: false,
      dispatchAllowed: false,
      processStartAllowed: false,
      processStopAllowed: false,
      authorization: "none",
    });

    const apply = buildAgentRunRegistryUpsertPacket({
      ...dryRun.entry,
      dryRun: false,
      nowIso: "2026-05-07T00:00:00.000Z",
    });
    expect(apply).toMatchObject({
      decision: "write-ready",
      writeAllowed: true,
      authorization: "explicit-apply",
      entry: {
        runId: "run-upsert",
        state: "planned",
        declaredFiles: ["docs/research/provider-canary-scorecard-2026-05.md"],
      },
    });
  });

  it("reports agent run status and dry-first abort plans", () => {
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

    const status = buildAgentRunStatus("run-1", entry, Date.parse("2026-05-07T00:00:45.000Z"));
    expect(status).toMatchObject({
      mode: "agent-run-status",
      dispatchAllowed: false,
      processStartAllowed: false,
      processStopAllowed: false,
      found: true,
      state: "running",
      stale: false,
    });

    const dryRun = buildAgentRunAbortPlan({ runId: "run-1", entry, cwdExpected: process.cwd() });
    expect(dryRun).toMatchObject({
      mode: "agent-run-abort-plan",
      decision: "dry-run",
      processStopAllowed: false,
      authorization: "none",
    });

    const confirmed = buildAgentRunAbortPlan({ runId: "run-1", entry, execute: true, operatorConfirmed: true, cwdExpected: process.cwd() });
    expect(confirmed).toMatchObject({
      decision: "abort-ready",
      processStopAllowed: true,
      authorization: "explicit-human",
      pid: 12345,
    });
  });

  it("separates process completion from agent-run contract outcome", () => {
    const entry = {
      runId: "run-outcome",
      state: "completed" as const,
      providerModelRef: "dashscope/qwen-plus",
      cwd: process.cwd(),
      declaredFiles: ["docs/research/provider-canary-scorecard-dashscope-2026-05.md"],
    };

    const passed = buildAgentRunOutcomePacket({
      runId: "run-outcome",
      entry,
      touchedFiles: ["docs/research/provider-canary-scorecard-dashscope-2026-05.md"],
      markerResults: [{ label: "provider-marker", ok: true }],
    });
    expect(passed).toMatchObject({
      mode: "agent-run-outcome-packet",
      processState: "completed",
      contractDecision: "pass",
      recommendation: "stop",
      rollbackFiles: [],
    });

    const readOnlyPassed = buildAgentRunOutcomePacket({
      runId: "run-outcome",
      entry,
      touchedFiles: [],
      markerResults: [{ label: "provider-marker", ok: true }],
      outputBytes: 128,
      fileContract: "read-only",
    });
    expect(readOnlyPassed).toMatchObject({
      processState: "completed",
      contractDecision: "pass",
      fileContract: "read-only",
      recommendationCode: "agent-run-outcome-pass",
      touchedFiles: [],
    });

    const emptyOutput = buildAgentRunOutcomePacket({
      runId: "run-outcome",
      entry,
      touchedFiles: ["docs/research/provider-canary-scorecard-dashscope-2026-05.md"],
      markerResults: [{ label: "provider-marker", ok: true }],
      outputBytes: 0,
    });
    expect(emptyOutput).toMatchObject({
      processState: "completed",
      contractDecision: "fail",
      recommendationCode: "agent-run-outcome-fail-empty-output",
      blockers: ["empty-output"],
      outputBytes: 0,
    });

    const failed = buildAgentRunOutcomePacket({
      runId: "run-outcome",
      entry,
      touchedFiles: ["file1.txt", "file2.txt"],
      markerResults: [{ label: "dashscope-path-marker", ok: false }],
    });
    expect(failed).toMatchObject({
      processState: "completed",
      contractDecision: "fail",
      recommendationCode: "agent-run-outcome-fail-unexpected-files",
      unexpectedFiles: ["file1.txt", "file2.txt"],
      markerFailures: ["dashscope-path-marker"],
      rollbackFiles: ["file1.txt", "file2.txt"],
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
    expect(result.details?.decision).toBe("ready-for-agent-run");
    expect(result.content?.[0]?.text).toContain("agent-spawn-readiness: decision=ready-for-agent-run");
    expect(result.content?.[0]?.text).toContain("payload completo disponível em details");
    expect(result.content?.[0]?.text).not.toContain('\"decision\"');
  });

  it("exposes provider-native agent_run_start_packet as report-only tool", async () => {
    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsCore>[0];
    guardrailsCore(pi);

    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_start_packet");
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
      "tc-agent-run-start-packet",
      {
        run_id: "run-provider-native",
        goal: "return a bounded review note",
        provider_model_ref: "dashscope/qwen3-coder-plus",
        declared_files: ["docs/research/agent-run-provider-native-runner-2026-05.md"],
        timeout_ms: 90000,
        log_path: ".pi/reports/run-provider-native.log",
        extension_isolation: "minimal-no-extensions",
        budget_decision: "ok",
        budget_evidence: "dashscope provider budget ok",
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );

    expect(result.details?.mode).toBe("agent-run-start-packet");
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.details?.processStartAllowed).toBe(false);
    expect(result.details?.decision).toBe("ready-for-human-decision");
    expect(result.content?.[0]?.text).toContain("agent-run-start-packet: decision=ready-for-human-decision");
    expect(result.content?.[0]?.text).not.toContain('"commandPreview"');
  });

  it("exposes agent run status, log tail, and abort surfaces", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "agent-run-"));
    const reportsDir = path.join(cwd, ".pi", "reports");
    mkdirSync(reportsDir, { recursive: true });
    const logPath = path.join(reportsDir, "run-1.log");
    writeFileSync(logPath, "line-1\nline-2\nline-3\n", "utf8");
    writeFileSync(path.join(reportsDir, "agent-runs.json"), JSON.stringify({
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
      }, {
        runId: "run-outcome",
        state: "completed",
        providerModelRef: "openai-codex/gpt-5.3-codex-spark",
        cwd,
        declaredFiles: ["docs/research/provider-canary-scorecard-2026-05.md"],
        logPath,
        startedAtIso: "2026-05-07T00:00:00.000Z",
        lastEventAtIso: "2026-05-07T00:00:40.000Z",
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

    const registryFile = path.join(reportsDir, "agent-runs.json");
    const upsertDry = await getTool("agent_run_registry_upsert").execute(
      "tc-upsert-dry",
      {
        run_id: "run-dry",
        state: "planned",
        provider_model_ref: "dashscope/qwen-plus",
        declared_files: ["docs/research/provider-canary-scorecard-dashscope-2026-05.md"],
        log_path: path.join(reportsDir, "run-dry.log"),
        timeout_ms: 90000,
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd },
    );
    expect(upsertDry.details?.decision).toBe("dry-run");
    expect(readFileSync(registryFile, "utf8")).not.toContain("run-dry");

    const upsertApply = await getTool("agent_run_registry_upsert").execute(
      "tc-upsert-apply",
      {
        run_id: "run-apply",
        state: "planned",
        provider_model_ref: "dashscope/qwen-plus",
        declared_files: ["docs/research/provider-canary-scorecard-dashscope-2026-05.md"],
        log_path: path.join(reportsDir, "run-apply.log"),
        timeout_ms: 90000,
        dry_run: false,
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd },
    );
    expect(upsertApply.details?.decision).toBe("write-ready");
    expect(existsSync(registryFile)).toBe(true);
    expect(readFileSync(registryFile, "utf8")).toContain("run-apply");

    const status = await getTool("agent_run_status").execute("tc-status", { run_id: "run-1" }, undefined as unknown as AbortSignal, () => {}, { cwd });
    expect(status.details?.mode).toBe("agent-run-status");
    expect(status.details?.processStopAllowed).toBe(false);
    expect(status.content?.[0]?.text).toContain("state=running");

    const outcome = await getTool("agent_run_outcome_packet").execute(
      "tc-outcome",
      {
        run_id: "run-outcome",
        touched_files: ["docs/research/provider-canary-scorecard-2026-05.md"],
        marker_results: [{ label: "scorecard-marker", ok: true }],
        output_bytes: 128,
        file_contract: "mutation",
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd },
    );
    expect(outcome.details?.mode).toBe("agent-run-outcome-packet");
    expect(outcome.details?.contractDecision).toBe("pass");
    expect(outcome.details?.outputBytes).toBe(128);
    expect(outcome.content?.[0]?.text).toContain("contract=pass");

    const tail = await getTool("agent_run_log_tail").execute("tc-tail", { run_id: "run-1", max_lines: 2 }, undefined as unknown as AbortSignal, () => {}, { cwd });
    expect(tail.details?.mode).toBe("agent-run-log-tail");
    expect(tail.details?.lines).toEqual(["line-3", ""]);

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const dryAbort = await getTool("agent_run_abort").execute("tc-abort-dry", { run_id: "run-1" }, undefined as unknown as AbortSignal, () => {}, { cwd });
      expect(dryAbort.details?.decision).toBe("dry-run");
      expect(dryAbort.details?.processStopAllowed).toBe(false);
      expect(killSpy).not.toHaveBeenCalled();

      const confirmedAbort = await getTool("agent_run_abort").execute("tc-abort", { run_id: "run-1", execute: true, operator_confirmed: true }, undefined as unknown as AbortSignal, () => {}, { cwd });
      expect(confirmedAbort.details?.decision).toBe("abort-ready");
      expect(confirmedAbort.details?.processStopAllowed).toBe(true);
      expect(killSpy).toHaveBeenCalledWith(12345, "SIGTERM");
    } finally {
      killSpy.mockRestore();
    }
  });

  it("exposes agent_run_plan as report-only tool", async () => {
    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsCore>[0];

    guardrailsCore(pi);
    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_plan");
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
      "tc-agent-run-plan",
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

    expect(result.details?.mode).toBe("agent-run-plan");
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.details?.executorApproved).toBe(false);
    expect(result.details?.decision).toBe("ready-for-human-decision");
    expect(result.content?.[0]?.text).toContain("agent-run-plan: decision=ready-for-human-decision");
    expect(result.content?.[0]?.text).not.toContain('"runSpec"');
  });
});
