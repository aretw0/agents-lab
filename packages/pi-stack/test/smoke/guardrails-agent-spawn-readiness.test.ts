import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import guardrailsCore, { buildAgentInvocationSpecPacket, buildAgentRunOperatorPacket, buildAgentRunPlan, buildAgentRunStartPacket, buildAgentRunTaskPacket, buildAgentRunTaskStartPacket, buildToolkitContract, evaluateAgentSpawnReadiness, resolveProviderExecutionBudgetEvidence } from "../../extensions/guardrails-core";
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
      requiresHumanDecision: true,
      singleRunOnly: true,
      decision: "ready-for-human-decision",
      blockers: [],
    });
    expect(result.runSpec.runId).toBe("task-bud-998-ergonomic-wrapper-review");
    expect(result.runSpec.logPath).toBe(".pi/reports/task-bud-998-ergonomic-wrapper-review.log");
    expect(result.runSpec.extensionIsolation).toBe("minimal-no-extensions");
    expect(result.runSpec.fileContract).toBe("read-only");
    expect(result.runSpec.attachmentMode).toBe("attach-declared-files");
    expect(result.runSpec.economyMode).toBe("conserve");
    expect(result.runSpec.economyInstructions.join("\n")).toContain("use only declared files");
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
      requiresHumanDecision: true,
      singleRunOnly: true,
      decision: "ready-for-human-decision",
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
    expect(mutationReady.decision).toBe("ready-for-human-decision");
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
      decision: "ready-for-human-decision",
      blockers: [],
    });
    expect(contract.contract.availableCapabilities).toContain("filesystem-read");
    expect(contract.contract.availableCapabilities).toContain("filesystem-write");
  });

  it("derives a report-only agent invocation spec from a board task", () => {
    const result = buildAgentRunTaskPacket({
      taskId: "TASK-BUD-1010",
      task: {
        id: "TASK-BUD-1010",
        description: "Implement report-only board-to-agent packetizer.",
        status: "planned",
        files: [
          "packages/pi-stack/extensions/guardrails-core-agent-run-start.ts",
          "packages/pi-stack/extensions/guardrails-core-agent-spawn-readiness-surface.ts",
        ],
        acceptance_criteria: [
          "returns typed invocation spec",
          "keeps dispatchAllowed=false",
        ],
      },
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      budgetDecision: "warn",
      budgetEvidence: "model-specific Spark budget usable while aggregate Codex may be pressured",
      budgetEvidenceSource: "manual",
      budgetEvidenceProvider: "openai-codex/gpt-5.3-codex-spark",
      tokenBudgetEvidence: "Spark scoped pool usable; conserve tokens",
    });

    expect(result).toMatchObject({
      mode: "agent-run-task-packet",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      processStartAllowed: false,
      processStopAllowed: false,
      requiresHumanDecision: true,
      singleRunOnly: true,
      decision: "ready-for-human-decision",
      blockers: [],
    });
    expect(result.invocationSpec.runId).toBe("task-bud-1010-task-packet");
    expect(result.invocationSpec.fileContract).toBe("mutation");
    expect(result.invocationSpec.profile).toBe("small-mutation");
    expect(result.invocationSpec.declaredFiles).toEqual([
      "packages/pi-stack/extensions/guardrails-core-agent-run-start.ts",
      "packages/pi-stack/extensions/guardrails-core-agent-spawn-readiness-surface.ts",
    ]);
    expect(result.invocationSpec.validation.join("\n")).toContain("acceptance criterion: returns typed invocation spec");
    expect(result.rollback.join("\n")).toContain("git restore packages/pi-stack/extensions/guardrails-core-agent-run-start.ts");
    expect(result.invocationSpec.economyMode).toBe("critical");
    expect(result.invocationSpec.maxOutputLines).toBe(20);
    expect(result.invocationSpec.budgetEvidence).toContain("Spark budget usable");
    expect(result.invocationSpec.budgetEvidenceProvider).toBe("openai-codex/gpt-5.3-codex-spark");
    expect(result.humanConfirmationPhrase).toBe("execute o worker task-bud-1010-task-packet");
  });

  it("fails closed for unsafe or incomplete board-to-agent packets", () => {
    const readyTask = {
      id: "TASK-BUD-1010",
      description: "Implement report-only board-to-agent packetizer.",
      status: "planned",
      files: ["packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
      acceptance_criteria: ["returns typed invocation spec"],
    };

    const missingTask = buildAgentRunTaskPacket({
      taskId: "TASK-MISSING",
      providerModelRef: "dashscope/qwen3-coder-plus",
      cwd: process.cwd(),
      budgetDecision: "ok",
      budgetEvidence: "dashscope ok",
    });
    expect(missingTask.decision).toBe("blocked");
    expect(missingTask.blockers).toContain("task-not-found");

    const missingFiles = buildAgentRunTaskPacket({
      taskId: "TASK-NO-FILES",
      task: { ...readyTask, id: "TASK-NO-FILES", files: [] },
      providerModelRef: "dashscope/qwen3-coder-plus",
      cwd: process.cwd(),
      budgetDecision: "ok",
      budgetEvidence: "dashscope ok",
    });
    expect(missingFiles.decision).toBe("blocked");
    expect(missingFiles.blockers).toContain("task-files-missing");

    const protectedScope = buildAgentRunTaskPacket({
      taskId: "TASK-PROTECTED",
      task: { ...readyTask, id: "TASK-PROTECTED", files: [".github/workflows/ci.yml"] },
      providerModelRef: "dashscope/qwen3-coder-plus",
      cwd: process.cwd(),
      budgetDecision: "ok",
      budgetEvidence: "dashscope ok",
    });
    expect(protectedScope.decision).toBe("blocked");
    expect(protectedScope.blockers).toContain("protected-scope-requested");

    const completed = buildAgentRunTaskPacket({
      taskId: "TASK-DONE",
      task: { ...readyTask, id: "TASK-DONE", status: "completed" },
      providerModelRef: "dashscope/qwen3-coder-plus",
      cwd: process.cwd(),
      budgetDecision: "ok",
      budgetEvidence: "dashscope ok",
    });
    expect(completed.decision).toBe("blocked");
    expect(completed.blockers).toContain("task-already-completed");

    const rawBoardScope = buildAgentRunTaskPacket({
      taskId: "TASK-RAW-BOARD",
      task: { ...readyTask, id: "TASK-RAW-BOARD", files: [".project/tasks.json"] },
      providerModelRef: "dashscope/qwen3-coder-plus",
      cwd: process.cwd(),
      budgetDecision: "ok",
      budgetEvidence: "dashscope ok",
    });
    expect(rawBoardScope.decision).toBe("blocked");
    expect(rawBoardScope.blockers).toContain("raw-board-state-file-declared-use-derived-board-packet");
    expect(rawBoardScope.task.rawBoardScopeDetected).toBe(true);
  });

  it("composes task packets with registry/start/status/log/abort/outcome previews", () => {
    const result = buildAgentRunTaskStartPacket({
      taskId: "TASK-BUD-1012",
      task: {
        id: "TASK-BUD-1012",
        description: "Implement report-only task start packet bridge.",
        status: "planned",
        files: ["packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
        acceptance_criteria: ["includes registry preview", "keeps processStartAllowed=false"],
      },
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      budgetDecision: "warn",
      budgetEvidence: "Spark scoped budget usable",
      budgetEvidenceSource: "manual",
      budgetEvidenceProvider: "openai-codex/gpt-5.3-codex-spark",
    });

    expect(result).toMatchObject({
      mode: "agent-run-task-start-packet",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      processStartAllowed: false,
      processStopAllowed: false,
      requiresHumanDecision: true,
      decision: "ready-for-human-decision",
      blockers: [],
    });
    expect(result.taskPacket.mode).toBe("agent-run-task-packet");
    expect(result.registryPreview).toMatchObject({
      mode: "agent-run-registry-upsert",
      decision: "dry-run",
      writeAllowed: false,
      dispatchAllowed: false,
    });
    expect(result.startPreview.command).toBe("pi");
    expect(result.statusPreview.processStartAllowed).toBe(false);
    expect(result.logTailPreview.readOnly).toBe(true);
    expect(result.abortPreview.processStopAllowed).toBe(false);
    expect(result.outcomeChecklist.join("\n")).toContain("fail contract on empty output");
    expect(result.summary).toContain("dispatch=no");
  });

  it("propagates inherited extension isolation for custom-provider task workers", () => {
    const result = buildAgentRunTaskStartPacket({
      taskId: "TASK-BUD-1065",
      task: {
        id: "TASK-BUD-1065",
        description: "Allow custom provider workers to inherit extensions.",
        status: "planned",
        files: ["packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
        acceptance_criteria: ["argv can omit no-extensions for inherit isolation"],
      },
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      budgetDecision: "ok",
      budgetEvidence: "Spark scoped budget usable",
      budgetEvidenceSource: "manual",
      budgetEvidenceProvider: "openai-codex/gpt-5.3-codex-spark",
      extensionIsolation: "inherit",
    });

    expect(result.decision).toBe("ready-for-human-decision");
    expect(result.taskPacket.invocationSpec.extensionIsolation).toBe("inherit");
    expect(result.startPreview.args).not.toContain("--no-extensions");
    expect(result.startPreview.args).not.toContain("--no-skills");
    expect(result.summary).toContain("dispatch=no");
  });

  it("blocks task start packets when the underlying task packet is blocked", () => {
    const result = buildAgentRunTaskStartPacket({
      taskId: "TASK-PROTECTED",
      task: {
        id: "TASK-PROTECTED",
        description: "Change CI settings.",
        status: "planned",
        files: [".github/workflows/ci.yml"],
        acceptance_criteria: ["updates protected workflow"],
      },
      providerModelRef: "dashscope/qwen3-coder-plus",
      cwd: process.cwd(),
      budgetDecision: "ok",
      budgetEvidence: "dashscope ok",
    });

    expect(result.decision).toBe("blocked");
    expect(result.processStartAllowed).toBe(false);
    expect(result.blockers).toContain("protected-scope-requested");
    expect(result.blockers).toContain("task-packet-blocked");
  });

  it("exposes agent_run_task_packet as a report-only board surface", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "agent-run-task-packet-"));
    mkdirSync(path.join(tmp, ".project"), { recursive: true });
    writeFileSync(path.join(tmp, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-BUD-1010",
          description: "Implement report-only board-to-agent packetizer.",
          status: "planned",
          files: ["packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
          acceptance_criteria: ["returns typed invocation spec"],
        },
      ],
    }, null, 2), "utf8");

    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsCore>[0];
    guardrailsCore(pi);

    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_task_packet");
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
      "tc-agent-run-task-packet",
      {
        task_id: "TASK-BUD-1010",
        provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
        budget_decision: "warn",
        budget_evidence: "Spark scoped budget usable",
        budget_evidence_source: "manual",
        budget_evidence_provider: "openai-codex/gpt-5.3-codex-spark",
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: tmp },
    );

    expect(result.details?.mode).toBe("agent-run-task-packet");
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.details?.processStartAllowed).toBe(false);
    expect(result.details?.decision).toBe("ready-for-human-decision");
    expect(result.content?.[0]?.text).toContain("agent-run-task-packet: decision=ready-for-human-decision");
    expect(result.content?.[0]?.text).toContain("dispatch=no");
  });

  it("exposes agent_run_task_dispatch_check as report-only confirmation check", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "agent-run-task-dispatch-check-"));
    mkdirSync(path.join(tmp, ".project"), { recursive: true });
    writeFileSync(path.join(tmp, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-BUD-1016",
          description: "Implement report-only dispatch confirmation check.",
          status: "planned",
          files: ["packages/pi-stack/extensions/guardrails-core-agent-spawn-readiness-surface.ts"],
          acceptance_criteria: ["missing mismatch match without dispatch"],
        },
        {
          id: "TASK-PROTECTED",
          description: "Change CI settings.",
          status: "planned",
          files: [".github/workflows/ci.yml"],
          acceptance_criteria: ["updates protected workflow"],
        },
      ],
    }, null, 2), "utf8");

    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsCore>[0];
    guardrailsCore(pi);

    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_task_dispatch_check");
    const tool = toolCall?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => Promise<{ content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }> | { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
    };

    const commonParams = {
      task_id: "TASK-BUD-1016",
      provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
      budget_decision: "warn",
      budget_evidence: "Spark scoped budget usable",
      budget_evidence_source: "manual",
      budget_evidence_provider: "openai-codex/gpt-5.3-codex-spark",
    };
    const missing = await tool.execute("tc-dispatch-check-missing", commonParams, undefined as unknown as AbortSignal, () => {}, { cwd: tmp });
    expect(missing.details?.mode).toBe("agent-run-task-dispatch-check");
    expect(missing.details?.confirmation).toBe("missing");
    expect(missing.details?.dispatchAllowed).toBe(false);
    expect(missing.details?.processStartAllowed).toBe(false);
    expect(missing.details?.wouldDispatchAfterExplicitExecute).toBe(false);

    const mismatch = await tool.execute("tc-dispatch-check-mismatch", { ...commonParams, operator_confirmation: "wrong phrase" }, undefined as unknown as AbortSignal, () => {}, { cwd: tmp });
    expect(mismatch.details?.confirmation).toBe("mismatch");
    expect(mismatch.details?.wouldDispatchAfterExplicitExecute).toBe(false);

    const match = await tool.execute(
      "tc-dispatch-check-match",
      { ...commonParams, operator_confirmation: "execute o worker task-bud-1016-task-packet" },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: tmp },
    );
    expect(match.details?.confirmation).toBe("match");
    expect(match.details?.wouldDispatchAfterExplicitExecute).toBe(true);
    expect(match.details?.dispatchAllowed).toBe(false);
    expect(match.content?.[0]?.text).toContain("dispatch=no");
    expect(existsSync(path.join(tmp, ".pi", "reports", "agent-runs.json"))).toBe(false);

    const blocked = await tool.execute(
      "tc-dispatch-check-blocked",
      { ...commonParams, task_id: "TASK-PROTECTED", operator_confirmation: "execute o worker task-protected-task-packet" },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: tmp },
    );
    expect(blocked.details?.decision).toBe("blocked");
    expect((blocked.details?.blockers as string[])).toContain("protected-scope-requested");
    expect(blocked.details?.wouldDispatchAfterExplicitExecute).toBe(false);
  });

  it("exposes agent_run_task_dispatch as preview-only by default and blocks confirmation mismatch", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "agent-run-task-dispatch-"));
    mkdirSync(path.join(tmp, ".project"), { recursive: true });
    writeFileSync(path.join(tmp, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-BUD-1014",
          description: "Implement exact-confirmation dispatch gate.",
          status: "planned",
          files: ["packages/pi-stack/extensions/guardrails-core-agent-spawn-readiness-surface.ts"],
          acceptance_criteria: ["preview by default", "confirmation mismatch blocks"],
        },
        {
          id: "TASK-PROTECTED",
          description: "Change CI settings.",
          status: "planned",
          files: [".github/workflows/ci.yml"],
          acceptance_criteria: ["updates protected workflow"],
        },
      ],
    }, null, 2), "utf8");

    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsCore>[0];
    guardrailsCore(pi);

    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_task_dispatch");
    const tool = toolCall?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => Promise<{ content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }> | { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
    };

    const commonParams = {
      task_id: "TASK-BUD-1014",
      provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
      budget_decision: "warn",
      budget_evidence: "Spark scoped budget usable",
      budget_evidence_source: "manual",
      budget_evidence_provider: "openai-codex/gpt-5.3-codex-spark",
    };
    const preview = await tool.execute("tc-agent-run-task-dispatch-preview", commonParams, undefined as unknown as AbortSignal, () => {}, { cwd: tmp });
    expect(preview.details?.mode).toBe("agent-run-task-dispatch");
    expect(preview.details?.decision).toBe("preview");
    expect(preview.details?.dispatchAllowed).toBe(false);
    expect(preview.details?.processStartAllowed).toBe(false);
    expect(existsSync(path.join(tmp, ".pi", "reports", "agent-runs.json"))).toBe(false);
    expect(preview.content?.[0]?.text).toContain("dispatch=no");

    const mismatch = await tool.execute("tc-agent-run-task-dispatch-mismatch", { ...commonParams, execute: true, operator_confirmation: "wrong phrase" }, undefined as unknown as AbortSignal, () => {}, { cwd: tmp });
    expect(mismatch.details?.decision).toBe("blocked");
    expect(mismatch.details?.dispatchAllowed).toBe(false);
    expect((mismatch.details?.blockers as string[])).toContain("operator-confirmation-mismatch");
    expect(existsSync(path.join(tmp, ".pi", "reports", "agent-runs.json"))).toBe(false);

    const protectedScope = await tool.execute(
      "tc-agent-run-task-dispatch-protected",
      { ...commonParams, task_id: "TASK-PROTECTED" },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: tmp },
    );
    expect(protectedScope.details?.decision).toBe("blocked");
    expect(protectedScope.details?.dispatchAllowed).toBe(false);
    expect((protectedScope.details?.blockers as string[])).toContain("protected-scope-requested");
  });

  it("hardens agent_run_task_dispatch against subprocess spawn errors", () => {
    const source = readFileSync(path.join(process.cwd(), "packages/pi-stack/extensions/guardrails-core-agent-spawn-readiness-surface.ts"), "utf8");
    expect(source).toContain("resolvePiSubprocessInvocation(packet.startPreview)");
    expect(source).toContain("spawn(subprocess.command, subprocess.args");
    expect(source).toContain("child.on(\"error\", (error: NodeJS.ErrnoException)");
    expect(source).toContain("spawn error code=${code}");
    expect(source).toContain("[agent-runner] close exitCode=${exitCode}");
    expect(source).toContain("outputBytes: readLogByteCount(logPath)");
    expect(source).toContain("errorCode: code");
    expect(source).toContain("state: \"failed\"");
    expect(source).not.toContain("spawn(packet.startPreview.command, packet.startPreview.args");
  });

  it("exposes agent_run_task_start_packet as a report-only bridge surface", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "agent-run-task-start-packet-"));
    mkdirSync(path.join(tmp, ".project"), { recursive: true });
    writeFileSync(path.join(tmp, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-BUD-1012",
          description: "Implement report-only task start packet bridge.",
          status: "planned",
          files: ["packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
          acceptance_criteria: ["includes registry preview"],
        },
      ],
    }, null, 2), "utf8");

    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsCore>[0];
    guardrailsCore(pi);

    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_task_start_packet");
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
      "tc-agent-run-task-start-packet",
      {
        task_id: "TASK-BUD-1012",
        provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
        budget_decision: "warn",
        budget_evidence: "Spark scoped budget usable",
        budget_evidence_source: "manual",
        budget_evidence_provider: "openai-codex/gpt-5.3-codex-spark",
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: tmp },
    );

    expect(result.details?.mode).toBe("agent-run-task-start-packet");
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.details?.processStartAllowed).toBe(false);
    expect(result.details?.decision).toBe("ready-for-human-decision");
    expect(result.content?.[0]?.text).toContain("agent-run-task-start-packet: decision=ready-for-human-decision");
    expect(result.content?.[0]?.text).toContain("dispatch=no");
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
    expect(ready.decision).toBe("ready-for-human-decision");
    expect(ready.runSpec).toMatchObject({
      budgetEvidenceSource: "route-advisory",
      budgetEvidenceFreshness: "fresh",
      budgetEvidenceConsistency: "consistent",
      budgetEvidenceHumanReviewRequired: false,
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

    const entryWithOutput = { ...entry, outputBytes: 128 };
    const readOnlyPassed = buildAgentRunOutcomePacket({
      runId: "run-outcome",
      entry: entryWithOutput,
      touchedFiles: [],
      markerResults: [{ label: "provider-marker", ok: true }],
      fileContract: "read-only",
    });
    expect(readOnlyPassed).toMatchObject({
      processState: "completed",
      contractDecision: "pass",
      fileContract: "read-only",
      recommendationCode: "agent-run-outcome-pass",
      touchedFiles: [],
      outputBytes: 128,
    });

    const readOnlyTouched = buildAgentRunOutcomePacket({
      runId: "run-outcome",
      entry: entryWithOutput,
      touchedFiles: ["docs/research/provider-canary-scorecard-dashscope-2026-05.md"],
      markerResults: [{ label: "provider-marker", ok: true }],
      fileContract: "read-only",
    });
    expect(readOnlyTouched).toMatchObject({
      processState: "completed",
      contractDecision: "fail",
      fileContract: "read-only",
      recommendationCode: "agent-run-outcome-fail-read-only-touched-files",
      blockers: ["read-only-touched-files"],
      rollbackFiles: ["docs/research/provider-canary-scorecard-dashscope-2026-05.md"],
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

    const mutationWithReadOnlyPacket = buildAgentRunOutcomePacket({
      runId: "run-outcome",
      entry: {
        ...entryWithOutput,
        declaredFiles: [
          "docs/research/task-bud-1033-small-mutation-worker-packet-2026-05.md",
          "docs/research/control-plane-signal-integrity-audit-2026-05.md",
        ],
      },
      touchedFiles: ["docs/research/control-plane-signal-integrity-audit-2026-05.md"],
      mutationTargetFiles: ["docs/research/control-plane-signal-integrity-audit-2026-05.md"],
      markerResults: [{ label: "triage-marker", ok: true }],
      fileContract: "mutation",
    });
    expect(mutationWithReadOnlyPacket).toMatchObject({
      processState: "completed",
      contractDecision: "pass",
      recommendationCode: "agent-run-outcome-pass",
      declaredFiles: [
        "docs/research/task-bud-1033-small-mutation-worker-packet-2026-05.md",
        "docs/research/control-plane-signal-integrity-audit-2026-05.md",
      ],
      mutationTargetFiles: ["docs/research/control-plane-signal-integrity-audit-2026-05.md"],
      touchedFiles: ["docs/research/control-plane-signal-integrity-audit-2026-05.md"],
      missingDeclaredFiles: [],
      unexpectedFiles: [],
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

  it("exposes ergonomic agent_run_operator_packet as report-only tool", async () => {
    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsCore>[0];
    guardrailsCore(pi);

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
    expect(result.details?.decision).toBe("ready-for-human-decision");
    expect((result.details as { runSpec?: { economyMode?: string; maxOutputLines?: number } })?.runSpec?.economyMode).toBe("critical");
    expect((result.details as { runSpec?: { economyMode?: string; maxOutputLines?: number } })?.runSpec?.maxOutputLines).toBe(18);
    expect(result.content?.[0]?.text).toContain("agent-run-operator-packet: decision=ready-for-human-decision");
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
    const pi = rawPi as unknown as Parameters<typeof guardrailsCore>[0];
    guardrailsCore(pi);

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
    expect(result.details?.decision).toBe("ready-for-human-decision");
    expect((result.details as { invocationSpec?: { economyMode?: string; maxOutputLines?: number } })?.invocationSpec?.economyMode).toBe("conserve");
    expect((result.details as { invocationSpec?: { economyMode?: string; maxOutputLines?: number } })?.invocationSpec?.maxOutputLines).toBe(24);
    expect(result.content?.[0]?.text).toContain("agent-invocation-spec-packet: decision=ready-for-human-decision");
    expect(result.content?.[0]?.text).not.toContain('"executionPreview"');
  });

  it("keeps actionable diagnostics for silent agent-runner failures", () => {
    const text = readFileSync(path.join(process.cwd(), "packages/pi-stack/extensions/guardrails-core-agent-spawn-readiness-surface.ts"), "utf8");
    expect(text).toContain("formatAgentRunnerArgvForLog");
    expect(text).toContain("childOutputBytes");
    expect(text).toContain("silent-runner-failure");
    expect(text).toContain("cwd=${ctx.cwd}");
  });

  it("exposes agent run status, follow, log tail, and abort surfaces", async () => {
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
        exitCode: 0,
        outputBytes: 21,
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

    const tail = await getTool("agent_run_log_tail").execute("tc-tail", { run_id: "run-1", max_lines: 2 }, undefined as unknown as AbortSignal, () => {}, { cwd });
    expect(tail.details?.mode).toBe("agent-run-log-tail");
    expect(tail.details?.lines).toEqual(["line-3", ""]);

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
