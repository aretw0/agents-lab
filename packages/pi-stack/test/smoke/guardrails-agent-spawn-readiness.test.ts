import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import guardrailsAgentRun from "../../extensions/guardrails-agent-run";
import { buildAgentInvocationSpecPacket, buildAgentRunOperatorPacket, buildAgentRunPlan, buildAgentRunStartPacket, buildToolkitContract, evaluateAgentSpawnReadiness, resolveExecutionCwdParam, resolveProviderExecutionBudgetEvidence, sameCwd } from "../../extensions/guardrails-core-exports";
import { buildAgentRunAbortPlan } from "../../extensions/guardrails-core-agent-run-runtime";

describe("agent spawn readiness contract", () => {
  it("keeps the agent-run family free of superseded naming", () => {
    const focalFiles = [
      "packages/pi-stack/extensions/guardrails-core-agent-spawn-readiness.ts",
      "packages/pi-stack/extensions/guardrails-core-agent-run-plan.ts",
      "packages/pi-stack/extensions/guardrails-core-agent-run-runtime.ts",
      "packages/pi-stack/extensions/guardrails-core-agent-run-start.ts",
      "packages/pi-stack/extensions/guardrails-core-agent-run-sdk-preview.ts",
      "packages/pi-stack/extensions/guardrails-core-agent-spawn-readiness-surface.ts",
      "packages/pi-stack/extensions/guardrails-core-agent-run-diagnostics.ts",
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
      requiresOperatorDecision: true,
      singleRunOnly: true,
      decision: "ready-for-operator-decision",
      recommendationCode: "agent-run-ready-for-operator-decision",
      blockers: [],
    });
  });

  it("canonicalizes execution cwd inputs for control-plane surfaces", () => {
    const cwd = process.cwd();
    const cwdWithTrailingSeparator = `${cwd}${path.sep}`;

    expect(resolveExecutionCwdParam(undefined, cwd)).toBe(cwd);
    expect(resolveExecutionCwdParam("   ", cwd)).toBe(cwd);
    expect(resolveExecutionCwdParam(cwdWithTrailingSeparator, cwd)).toBe(cwd);
    expect(sameCwd(cwdWithTrailingSeparator, cwd)).toBe(true);

    const abortPlan = buildAgentRunAbortPlan({
      runId: "cwd-normalized-abort",
      entry: {
        runId: "cwd-normalized-abort",
        state: "running",
        pid: 12345,
        cwd: cwdWithTrailingSeparator,
      },
      cwdExpected: cwd,
      execute: false,
    });
    expect(abortPlan.blockers).not.toContain("cwd-mismatch");
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

    const generatedAtIso = new Date().toISOString();
    const sparkScoped = resolveProviderExecutionBudgetEvidence({
      budgetDecision: "ok",
      budgetEvidence: "Spark model-specific capacity available",
      budgetEvidenceSource: "provider-budget-snapshot",
      budgetEvidenceProvider: "openai-codex/gpt-5.3-codex-spark",
      budgetEvidenceGeneratedAtIso: generatedAtIso,
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
    });
    expect(sparkScoped).toMatchObject({
      decision: "ok",
      provider: "openai-codex/gpt-5.3-codex-spark",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      scope: "provider-model",
      consistency: "consistent",
      freshness: "fresh",
      readyForExecution: true,
      blockers: [],
    });

    const aggregateMismatch = resolveProviderExecutionBudgetEvidence({
      budgetDecision: "ok",
      budgetEvidence: "different model capacity",
      budgetEvidenceSource: "provider-budget-snapshot",
      budgetEvidenceProvider: "openai-codex/other-model",
      budgetEvidenceGeneratedAtIso: generatedAtIso,
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
    });
    expect(aggregateMismatch).toMatchObject({
      consistency: "mismatch",
      readyForExecution: false,
      blockers: ["budget-evidence-provider-mismatch"],
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
      requiresOperatorDecision: true,
      singleRunOnly: true,
      decision: "ready-for-operator-decision",
      recommendationCode: "agent-run-start-ready-for-operator-decision",
      nextActionCode: "present-structured-operator-approval",
      blockers: [],
      commandPreview: {
        command: "pi",
        shellInterpolationAllowed: false,
      },
      operatorApprovalPrompt: "approve worker task-bud-990-stale-resume-review",
    });
    expect(result.runSpec.budgetDecision).toBe("ok");
    expect(result.summary).toContain("nextActionCode=present-structured-operator-approval");
    expect(result.runSpec.extensionIsolation).toBe("minimal-no-extensions");
    expect(result.commandPreview.args).toContain("--no-extensions");
    expect(result.commandPreview.args).toContain("--no-skills");
    expect(result.commandPreview.args).toContain("--no-prompt-templates");
    expect(result.commandPreview.args).toContain("--no-themes");
    expect(result.commandPreview.args).toContain("--no-context-files");
    expect(result.commandPreview.args).toContain("--model");
    expect(result.commandPreview.args).toContain("dashscope/qwen3-coder-plus");
    expect(result.commandPreview.args).toContain("read,grep,find,ls");
    expect(result.commandPreview.args).toContain("--print");
    expect(result.commandPreview.args).toContain("@packages/pi-stack/extensions/context-watchdog-auto-resume.ts");

    const inherited = buildAgentRunStartPacket({
      ...result.runSpec,
      extensionIsolation: "inherit",
    });
    expect(inherited.commandPreview.args).not.toContain("--no-extensions");

    const researchWithoutWeb = buildAgentRunStartPacket({
      ...result.runSpec,
      runId: "research-without-web-tool",
      profile: "research",
      goal: "Do web research and return citations.",
      toolAllowlist: ["read", "grep", "find", "ls"],
      availableTools: ["read", "grep", "find", "ls"],
    });
    expect(researchWithoutWeb.decision).toBe("blocked");
    expect(researchWithoutWeb.recommendationCode).toBe("agent-run-start-blocked-toolkit");
    expect(researchWithoutWeb.nextActionCode).toBe("resolve-start-packet-blockers");
    expect(researchWithoutWeb.blockers).toContain("toolkit-contract:missing-required-capability:web-research");
    expect(researchWithoutWeb.runSpec.toolkitContract?.satisfied).toBe(false);
  });

  it("builds an ergonomic provider-native operator packet with safe defaults", () => {
    const generatedAtIso = new Date().toISOString();
    const result = buildAgentRunOperatorPacket({
      taskId: "TASK-BUD-998",
      purpose: "ergonomic-wrapper-review",
      goal: "Review the ergonomic wrapper and return PASS or FAIL.",
      providerModelRef: "dashscope/qwen3-coder-plus",
      cwd: process.cwd(),
      declaredFiles: ["packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
      budgetDecision: "ok",
      budgetEvidence: "dashscope ok generatedAt=now",
      budgetEvidenceSource: "route-advisory",
      budgetEvidenceProvider: "dashscope",
      budgetEvidenceGeneratedAtIso: generatedAtIso,
    });

    expect(result).toMatchObject({
      mode: "agent-run-operator-packet",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      processStartAllowed: false,
      requiresOperatorDecision: true,
      singleRunOnly: true,
      decision: "ready-for-operator-decision",
      blockers: [],
    });
    expect(result.runSpec.runId).toBe("task-bud-998-ergonomic-wrapper-review");
    expect(result.runSpec.logPath).toBe(".pi/reports/task-bud-998-ergonomic-wrapper-review.log");
    expect(result.runSpec.extensionIsolation).toBe("minimal-no-extensions");
    expect(result.runSpec.fileContract).toBe("read-only");
    expect(result.runSpec.attachmentMode).toBe("attach-declared-files");
    expect(result.runSpec.economyMode).toBe("conserve");
    expect(result.runSpec.economyInstructions.join("\n")).toContain("use only declared files");
    expect(result.operatorApprovalPrompt).toBe("approve worker task-bud-998-ergonomic-wrapper-review");
    expect(result.nextAction).toContain("approve worker task-bud-998-ergonomic-wrapper-review");
    expect(result.nextActions[0]).toContain("present operator approval prompt exactly");
    expect(result.startPacket.commandPreview.args).toContain("--print");
    expect(result.startPacket.commandPreview.args).toContain("@packages/pi-stack/extensions/guardrails-core-agent-run-start.ts");
    expect(result.startPacket.commandPreview.args.join("\n")).toContain("Worker economy contract (conserve)");
    expect(result.validationChecklist.join("\n")).toContain("file_contract=read-only");
    expect(result.validationChecklist.join("\n")).toContain("worker economy contract");
  });

  it("builds typed agent invocation specs without dispatching", () => {
    const generatedAtIso = new Date().toISOString();
    const readOnly = buildAgentInvocationSpecPacket({
      taskId: "TASK-BUD-1002",
      purpose: "spec-review",
      profile: "read-only-review",
      goal: "Review typed invocation spec and return PASS or FAIL.",
      providerModelRef: "dashscope/qwen3-coder-plus",
      cwd: process.cwd(),
      declaredFiles: ["packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
      budgetDecision: "warn",
      budgetEvidence: "dashscope qwen3-coder-plus remaining 246,289 / total 1,000,000",
      budgetEvidenceSource: "manual",
      budgetEvidenceProvider: "dashscope",
      budgetEvidenceGeneratedAtIso: generatedAtIso,
      economyMode: "critical",
      tokenBudgetEvidence: "remaining 246,289 / total 1,000,000",
      maxOutputLines: 18,
    });

    expect(readOnly).toMatchObject({
      mode: "agent-invocation-spec-packet",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      processStartAllowed: false,
      requiresOperatorDecision: true,
      singleRunOnly: true,
      decision: "ready-for-operator-decision",
      blockers: [],
    });
    expect(readOnly.invocationSpec.profile).toBe("read-only-review");
    expect(readOnly.invocationSpec.fileContract).toBe("read-only");
    expect(readOnly.invocationSpec.outputContract).toBe("non-empty-text");
    expect(readOnly.invocationSpec.economyMode).toBe("critical");
    expect(readOnly.invocationSpec.maxOutputLines).toBe(18);
    expect(readOnly.invocationSpec.tokenBudgetEvidence).toContain("246,289");
    expect(readOnly.invocationSpec.executionPreview.args).toContain("@packages/pi-stack/extensions/guardrails-core-agent-run-start.ts");
    expect(readOnly.invocationSpec.executionPreview.args.join("\n")).toContain("Worker economy contract (critical)");

    const standardWarn = buildAgentInvocationSpecPacket({
      ...readOnly.invocationSpec,
      economyMode: "standard",
    });
    expect(standardWarn.decision).toBe("blocked");
    expect(standardWarn.blockers).toContain("economy-contract-required-for-warn-budget");

    const mutationBlocked = buildAgentInvocationSpecPacket({
      ...readOnly.invocationSpec,
      profile: "small-mutation",
      fileContract: "mutation",
    });
    expect(mutationBlocked.decision).toBe("blocked");
    expect(mutationBlocked.blockers).toContain("validation-required-for-mutation-profile");
    expect(mutationBlocked.blockers).toContain("rollback-required-for-mutation-profile");

    const mutationReady = buildAgentInvocationSpecPacket({
      ...readOnly.invocationSpec,
      profile: "small-mutation",
      fileContract: "mutation",
      validation: ["npx vitest run packages/pi-stack/test/smoke/guardrails-agent-spawn-readiness.test.ts --reporter=dot"],
      rollback: ["git restore packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
    });
    expect(mutationReady.decision).toBe("ready-for-operator-decision");
    expect(mutationReady.invocationSpec.fileContract).toBe("mutation");
    const mutationToolsIndex = mutationReady.invocationSpec.executionPreview.args.indexOf("--tools") + 1;
    expect(mutationReady.invocationSpec.executionPreview.args[mutationToolsIndex]).toContain("edit");
    expect(mutationReady.invocationSpec.executionPreview.args[mutationToolsIndex]).toContain("write");
    expect(mutationReady.invocationSpec.toolkitContract.satisfied).toBe(true);
    expect(mutationReady.invocationSpec.toolkitContract.availableCapabilities).toContain("filesystem-write");
  });

  it("blocks worker packets when the toolkit contract is missing required capabilities", () => {
    const researchBlocked = buildAgentInvocationSpecPacket({
      taskId: "TASK-BUD-1059",
      purpose: "web-research-gap",
      profile: "research",
      goal: "Do web research on prior art and summarize exact citations.",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      declaredFiles: ["docs/research/provider-canary-scorecard-2026-05.md"],
      budgetDecision: "ok",
      budgetEvidence: "Spark model-specific budget ok",
      budgetEvidenceSource: "manual",
      budgetEvidenceProvider: "openai-codex/gpt-5.3-codex-spark",
      economyMode: "critical",
    });

    expect(researchBlocked.decision).toBe("blocked");
    expect(researchBlocked.recommendationCode).toBe("agent-invocation-spec-blocked-toolkit");
    expect(researchBlocked.blockers).toContain("toolkit-contract:missing-required-capability:web-research");
    expect(researchBlocked.invocationSpec.toolkitContract.satisfied).toBe(false);
    expect(researchBlocked.invocationSpec.toolkitContract.gapAnalysis.missingTools).toContain("web_search|browse_url|web-browser");
    expect(researchBlocked.invocationSpec.toolkitContract.nextActionCode).toBe("resolve-toolkit-capability-gaps");

    const testFixBlocked = buildAgentInvocationSpecPacket({
      ...researchBlocked.invocationSpec,
      profile: "test-fix",
      fileContract: "mutation",
      goal: "Fix the focal test failure.",
      validation: [],
      rollback: ["git restore packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
    });
    expect(testFixBlocked.blockers).toContain("validation-required-for-mutation-profile");
    expect(testFixBlocked.blockers).toContain("toolkit-contract:missing-required-capability:focal-validation");
  });

  it("builds a standalone toolkit contract with explicit capabilities", () => {
    const contract = buildToolkitContract({
      profile: "small-mutation",
      goal: "Patch a bounded file",
      availableTools: ["read", "grep", "find", "ls", "edit", "write"],
      declaredFiles: ["packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
    });

    expect(contract).toMatchObject({
      mode: "toolkit-contract",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      processStartAllowed: false,
      requiresOperatorDecision: true,
      decision: "ready-for-operator-decision",
      recommendationCode: "toolkit-contract-ready",
      nextActionCode: "include-toolkit-contract-in-worker-packet",
      blockers: [],
    });
    expect(contract.contract.availableCapabilities).toContain("filesystem-read");
    expect(contract.contract.availableCapabilities).toContain("filesystem-write");
    expect(contract.summary).toContain("nextActionCode=include-toolkit-contract-in-worker-packet");
  });

  it("accepts fresh structured budget evidence and blocks stale or mismatched route evidence", () => {
    const generatedAtIso = new Date().toISOString();
    const ready = buildAgentRunStartPacket({
      runId: "run-budget-structured",
      goal: "review one local file",
      providerModelRef: "dashscope/qwen3-coder-plus",
      cwd: process.cwd(),
      declaredFiles: ["docs/research/provider-canary-scorecard-2026-05.md"],
      timeoutMs: 90_000,
      logPath: ".pi/reports/run-budget-structured.log",
      budgetDecision: "ok",
      budgetEvidence: "dashscope ok generatedAt=now",
      budgetEvidenceSource: "route-advisory",
      budgetEvidenceProvider: "dashscope",
      budgetEvidenceGeneratedAtIso: generatedAtIso,
    });
    expect(ready.decision).toBe("ready-for-operator-decision");
    expect(ready.runSpec).toMatchObject({
      budgetEvidenceSource: "route-advisory",
      budgetEvidenceFreshness: "fresh",
      budgetEvidenceConsistency: "consistent",
      budgetEvidenceOperatorReviewRequired: false,
    });

    const stale = buildAgentRunStartPacket({
      ...ready.runSpec,
      budgetEvidenceGeneratedAtIso: "2026-01-01T00:00:00.000Z",
      budgetEvidenceMaxAgeMs: 1,
    });
    expect(stale.decision).toBe("blocked");
    expect(stale.blockers).toContain("budget-evidence-stale");

    const mismatch = buildAgentRunStartPacket({
      ...ready.runSpec,
      budgetEvidenceProvider: "openai-codex",
      budgetEvidenceGeneratedAtIso: generatedAtIso,
    });
    expect(mismatch.decision).toBe("blocked");
    expect(mismatch.blockers).toContain("budget-evidence-provider-mismatch");
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

  it("blocks provider-native start packets that request unsupported tools or protected scope", () => {
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
    expect(result.blockers).toContain("unsupported-tools:bash");
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

  it("exposes agent_spawn_readiness_gate as read-only tool", async () => {
    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsAgentRun>[0];

    guardrailsAgentRun(pi);
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
    const pi = rawPi as unknown as Parameters<typeof guardrailsAgentRun>[0];
    guardrailsAgentRun(pi);

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
    expect(result.details?.decision).toBe("ready-for-operator-decision");
    expect(result.content?.[0]?.text).toContain("agent-run-start-packet: decision=ready-for-operator-decision");
    expect(result.content?.[0]?.text).not.toContain('"commandPreview"');
  });

  it("exposes ergonomic agent_run_operator_packet as report-only tool", async () => {
    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsAgentRun>[0];
    guardrailsAgentRun(pi);

    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_operator_packet");
    const tool = toolCall?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => Promise<{ content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }> | { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
    };

    const generatedAtIso = new Date().toISOString();
    const result = await tool.execute(
      "tc-agent-run-operator-packet",
      {
        task_id: "TASK-BUD-998",
        purpose: "operator-wrapper",
        goal: "return a bounded review note",
        provider_model_ref: "dashscope/qwen3-coder-plus",
        declared_files: ["docs/research/agent-run-provider-native-runner-2026-05.md"],
        budget_decision: "ok",
        budget_evidence: "dashscope ok",
        budget_evidence_source: "route-advisory",
        budget_evidence_provider: "dashscope",
        budget_evidence_generated_at_iso: generatedAtIso,
        economy_mode: "critical",
        token_budget_evidence: "remaining 246,289 / total 1,000,000",
        max_output_lines: 18,
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );

    expect(result.details?.mode).toBe("agent-run-operator-packet");
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.details?.processStartAllowed).toBe(false);
    expect(result.details?.decision).toBe("ready-for-operator-decision");
    expect((result.details as { runSpec?: { economyMode?: string; maxOutputLines?: number } })?.runSpec?.economyMode).toBe("critical");
    expect((result.details as { runSpec?: { economyMode?: string; maxOutputLines?: number } })?.runSpec?.maxOutputLines).toBe(18);
    expect(result.content?.[0]?.text).toContain("agent-run-operator-packet: decision=ready-for-operator-decision");
    expect(result.content?.[0]?.text).toContain("next=present-operator-approval");
    expect((result.details as { nextAction?: string })?.nextAction).toContain("approve worker task-bud-998-operator-wrapper");
    expect(result.content?.[0]?.text).not.toContain('"commandPreview"');
  });

  it("exposes typed agent_invocation_spec_packet as report-only tool", async () => {
    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsAgentRun>[0];
    guardrailsAgentRun(pi);

    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_invocation_spec_packet");
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
      "tc-agent-invocation-spec-packet",
      {
        task_id: "TASK-BUD-1002",
        purpose: "typed-spec",
        profile: "small-mutation",
        goal: "prepare a tiny patch and return PASS or FAIL",
        provider_model_ref: "dashscope/qwen3-coder-plus",
        declared_files: ["packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
        validation: ["npx vitest run packages/pi-stack/test/smoke/guardrails-agent-spawn-readiness.test.ts --reporter=dot"],
        rollback: ["git restore packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
        budget_decision: "ok",
        budget_evidence: "dashscope ok",
        budget_evidence_source: "route-advisory",
        budget_evidence_provider: "dashscope",
        budget_evidence_generated_at_iso: new Date().toISOString(),
        economy_mode: "conserve",
        token_budget_evidence: "remaining 246,289 / total 1,000,000",
        max_output_lines: 24,
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );

    expect(result.details?.mode).toBe("agent-invocation-spec-packet");
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.details?.processStartAllowed).toBe(false);
    expect(result.details?.decision).toBe("ready-for-operator-decision");
    expect((result.details as { invocationSpec?: { economyMode?: string; maxOutputLines?: number } })?.invocationSpec?.economyMode).toBe("conserve");
    expect((result.details as { invocationSpec?: { economyMode?: string; maxOutputLines?: number } })?.invocationSpec?.maxOutputLines).toBe(24);
    expect(result.content?.[0]?.text).toContain("agent-invocation-spec-packet: decision=ready-for-operator-decision");
    expect(result.content?.[0]?.text).not.toContain('"executionPreview"');
  });

  it("exposes agent run status, follow, log tail, failure classification, and abort surfaces", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "agent-run-"));
    const reportsDir = path.join(cwd, ".pi", "reports");
    mkdirSync(reportsDir, { recursive: true });
    const logPath = path.join(reportsDir, "run-1.log");
    const silentLogPath = path.join(reportsDir, "run-silent.log");
    writeFileSync(logPath, "line-1\nline-2\nline-3\n", "utf8");
    writeFileSync(silentLogPath, [
      "[agent-runner] starting command=node source=current-node-entrypoint cwd=C:/repo",
      "[agent-runner] argv=[\"cli.js\",\"--no-session\",\"--model\",\"openai-codex/gpt-5.3-codex-spark\",\"--tools\",\"read,grep,find,ls,edit,write\",\"--print\",\"@docs/research/provider-canary-scorecard-2026-05.md\",\"review\"]",
      "[agent-runner] failure code=silent-runner-failure message=subprocess exited non-zero without stdout/stderr; inspect argv/cwd/source and provider/toolkit setup",
      "[agent-runner] close exitCode=1 childOutputBytes=0",
    ].join("\n"), "utf8");
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
        exitCode: 0,
        outputBytes: 21,
      }, {
        runId: "run-silent",
        state: "failed",
        providerModelRef: "openai-codex/gpt-5.3-codex-spark",
        cwd,
        declaredFiles: ["docs/research/provider-canary-scorecard-2026-05.md"],
        logPath: silentLogPath,
        startedAtIso: "2026-05-07T00:00:00.000Z",
        lastEventAtIso: "2026-05-07T00:00:50.000Z",
        exitCode: 1,
        outputBytes: 512,
        errorCode: "silent-runner-failure",
      }],
    }), "utf8");

    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsAgentRun>[0];
    guardrailsAgentRun(pi);

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

    const completedStatus = await getTool("agent_run_status").execute("tc-status-completed", { run_id: "run-outcome" }, undefined as unknown as AbortSignal, () => {}, { cwd });
    expect(completedStatus.details?.exitCode).toBe(0);
    expect(completedStatus.details?.outputBytes).toBe(21);

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

    const batchOutcome = await getTool("agent_run_batch_outcome_packet").execute(
      "tc-batch-outcome",
      {
        batch_id: "task-bud-1071-sdk-readonly-batch-live-preview",
        expected_run_ids: ["run-outcome", "run-other"],
        worker_outcomes: [
          {
            run_id: "run-outcome",
            process_state: "completed",
            contract_decision: "pass",
            touched_files: [],
            marker_failures: [],
            output_bytes: 128,
            cache_status: "hit",
          },
          {
            run_id: "run-other",
            process_state: "completed",
            contract_decision: "pass",
            touched_files: [],
            marker_failures: [],
            output_bytes: 64,
            cache_status: "miss",
          },
        ],
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd },
    );
    expect(batchOutcome.details?.mode).toBe("agent-run-batch-outcome-packet");
    expect(batchOutcome.details?.decision).toBe("pass");
    expect(batchOutcome.details?.processStartAllowed).toBe(false);
    expect(batchOutcome.content?.[0]?.text).toContain("dispatch=no");

    const tail = await getTool("agent_run_log_tail").execute("tc-tail", { run_id: "run-1", max_lines: 2 }, undefined as unknown as AbortSignal, () => {}, { cwd });
    expect(tail.details?.mode).toBe("agent-run-log-tail");
    expect(tail.details?.lines).toEqual(["line-3", ""]);

    const classification = await getTool("agent_run_failure_classification").execute("tc-classify", { run_id: "run-silent" }, undefined as unknown as AbortSignal, () => {}, { cwd });
    expect(classification.details?.mode).toBe("agent-run-failure-classification");
    expect(classification.details?.failureClass).toBe("silent-runner-failure");
    expect(classification.details?.preflightDecision).toBe("needs-evidence");
    expect(classification.details?.retryAllowed).toBe(false);
    expect((classification.details?.nextProbeProfiles as string[])).not.toContain("prompt-file-argv-probe");
    expect((classification.details?.nextProbeProfiles as string[])).toContain("stream-byte-split-probe");
    expect((classification.details?.nextProbeProfiles as string[])).toContain("stderr-preservation-probe");
    expect(classification.content?.[0]?.text).toContain("retryAllowed=no");
    expect(classification.content?.[0]?.text).toContain("next=run-structured-diagnostic-before-retry");

    const startupDiagnostic = await getTool("agent_run_startup_diagnostic_packet").execute("tc-startup-diagnostic", {
      run_id: "run-silent",
      provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
      budget_decision: "ok",
      live_reload_completed: true,
    }, undefined as unknown as AbortSignal, () => {}, { cwd });
    expect(startupDiagnostic.details?.mode).toBe("agent-run-startup-diagnostic-packet");
    expect(startupDiagnostic.details?.decision).toBe("structured-probe-first");
    expect(startupDiagnostic.details?.canaryAllowed).toBe(false);
    expect(startupDiagnostic.details?.processStartAllowed).toBe(false);
    expect(startupDiagnostic.content?.[0]?.text).toContain("next=run-structured-startup-probe-before-retry");
    expect(startupDiagnostic.content?.[0]?.text).toContain("dispatch=no");

    const followCompleted = await getTool("agent_run_follow").execute("tc-follow-completed", { run_id: "run-outcome", max_wait_ms: 0, max_lines: 2 }, undefined as unknown as AbortSignal, () => {}, { cwd });
    expect(followCompleted.details?.mode).toBe("agent-run-follow");
    expect(followCompleted.details?.decision).toBe("terminal");
    expect(followCompleted.details?.terminal).toBe(true);
    expect(followCompleted.details?.outputBytes).toBe(21);
    expect(followCompleted.content?.[0]?.text).toContain("dispatch=no");

    const followStale = await getTool("agent_run_follow").execute("tc-follow-stale", { run_id: "run-1", max_wait_ms: 0 }, undefined as unknown as AbortSignal, () => {}, { cwd });
    expect(followStale.details?.decision).toBe("running-stale");
    expect(followStale.details?.terminal).toBe(false);
    expect((followStale.details?.status as { stale?: boolean })?.stale).toBe(true);

    const followMissing = await getTool("agent_run_follow").execute("tc-follow-missing", { run_id: "missing-run", max_wait_ms: 0 }, undefined as unknown as AbortSignal, () => {}, { cwd });
    expect(followMissing.details?.decision).toBe("missing-run");
    expect(followMissing.details?.processStartAllowed).toBe(false);
    expect(followMissing.details?.processStopAllowed).toBe(false);

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const dryAbort = await getTool("agent_run_abort").execute("tc-abort-dry", { run_id: "run-1" }, undefined as unknown as AbortSignal, () => {}, { cwd });
      expect(dryAbort.details?.decision).toBe("dry-run");
      expect(dryAbort.details?.processStopAllowed).toBe(false);
      expect(killSpy).not.toHaveBeenCalled();

      const confirmedAbort = await getTool("agent_run_abort").execute("tc-abort", { run_id: "run-1", execute: true, operator_approval: structuredApproval() }, undefined as unknown as AbortSignal, () => {}, { cwd });
      expect(confirmedAbort.details?.decision).toBe("abort-ready");
      expect(confirmedAbort.details?.processStopAllowed).toBe(true);
      expect(killSpy).toHaveBeenCalledWith(12345, "SIGTERM");
    } finally {
      killSpy.mockRestore();
    }
  });

});

function structuredApproval(): Record<string, unknown> {
  return {
    packet_mode: "operator-approval-packet",
    approved: true,
    approval_state: "approved",
  };
}
