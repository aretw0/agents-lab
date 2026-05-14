import { describe, expect, it, vi } from "vitest";
import guardrailsCore, { buildAgentRunSdkCachePackPacket, buildAgentRunSdkInProcessPacket, buildAgentRunSdkReadOnlyBatchPacket } from "../../extensions/guardrails-core";

describe("agent run SDK packet surfaces", () => {
  it("builds sdk in-process packet preview without dispatch", async () => {
    const result = buildAgentRunSdkInProcessPacket({
      runId: "task-bud-1068-sdk-preview-canary",
      goal: "Preview an SDK in-process worker without dispatch.",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      declaredFiles: ["packages/pi-stack/extensions/guardrails-core-agent-run-sdk-preview.ts"],
      sharedEvidence: ["VERIF-TASK-BUD-1071-SDK-CACHE-PACK-LIVE-PREVIEW-20260513"],
      timeoutMs: 90_000,
      toolAllowlist: ["read", "grep"],
      sessionMode: "in-memory",
      fileContract: "read-only",
      validationGateKnown: true,
      rollbackPlanKnown: true,
      budgetDecision: "ok",
      budgetEvidence: "Spark model-specific capacity available",
      budgetEvidenceSource: "manual",
      budgetEvidenceProvider: "openai-codex/gpt-5.3-codex-spark",
      abortKnown: true,
      eventStreamKnown: true,
      finalOutputContractKnown: true,
    });
    expect(result).toMatchObject({
      mode: "agent-run-sdk-in-process-packet",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      processStartAllowed: false,
      processStopAllowed: false,
      requiresHumanDecision: true,
      singleRunOnly: true,
      executorKind: "pi-sdk-in-process",
      decision: "ready-for-human-decision",
      humanConfirmationPhrase: "execute o sdk worker task-bud-1068-sdk-preview-canary",
    });
    expect(result.sdkPreview).toMatchObject({
      factory: "createAgentSession",
      authPattern: "AuthStorage.create + ModelRegistry.create",
      sessionPattern: "SessionManager.inMemory",
      toolSelection: ["read", "grep"],
    });
    expect(result.sdkPreview.abortContract).toContain("timeout calls session.abort()");
    expect(result.runSpec.sharedEvidence).toEqual(["VERIF-TASK-BUD-1071-SDK-CACHE-PACK-LIVE-PREVIEW-20260513"]);
    expect(result.sdkPreview.finalOutputContract).toContain("require final output bytes > 0");
    expect(result.sdkPreview.cacheEconomyContract.join("\n")).toContain("bounded to 20 items of 300 chars each");
    expect(result.sdkPreview.cacheEconomyContract.join("\n")).toContain("shared evidence pack");
    expect(result.sdkPreview.cacheEconomyContract.join("\n")).toContain("cache-hit/cache-miss");
    expect(result.sdkPreview.parallelReadOnlyContract.join("\n")).toContain("separate batch gate");
    expect(result.sdkPreview.parallelReadOnlyContract.join("\n")).toContain("fan-in");
    expect(result.sdkPreview.isolationNotes.join("\n")).toContain("Live-validated safe envelope");
    expect(result.sdkPreview.isolationNotes.join("\n")).toContain("Live-validated board-question rung");
    expect(result.sdkPreview.isolationNotes.join("\n")).toContain("Live-validated synthesis rung");
    expect(result.sdkPreview.isolationNotes.join("\n")).toContain("Failed evidence rung");
    expect(result.sdkPreview.isolationNotes.join("\n")).toContain("Live-validated one-symbol review rung");
    expect(result.sdkPreview.isolationNotes.join("\n")).toContain("Next maturity rung");
    expect(result.nextActions.join("\n")).toContain("validated SDK safe envelope");
    expect(result.nextActions.join("\n")).toContain("one target file or one named symbol");
    expect(result.nextActions.join("\n")).toContain("shared parent-side cache/evidence packs");
    expect(result.nextActions.join("\n")).toContain("read-only batch packet");
    expect(result.sdkMaturity).toMatchObject({
      rung: "validated-narrow-readgrep",
      validatedEnvelope: true,
      scope: "narrow",
      maxDeclaredFilesValidated: 2,
      supportedToolsValidated: ["read", "grep"],
    });
    expect(result.summary).toContain("sharedEvidence=1");
    expect(result.summary).toContain("sdkMaturity=validated-narrow-readgrep");

    const twoFileCodeReview = buildAgentRunSdkInProcessPacket({
      runId: "sdk-two-file-code-review",
      goal: "Produce a narrow read-only code/test review answering: what is one parent-side patch that would further unlock pragmatic SDK in-process worker use without broadening scope?",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      declaredFiles: [
        "packages/pi-stack/extensions/guardrails-core-agent-run-sdk-preview.ts",
        "packages/pi-stack/test/smoke/guardrails-agent-spawn-readiness.test.ts",
      ],
      timeoutMs: 90_000,
      toolAllowlist: ["read", "grep"],
      validationGateKnown: true,
      rollbackPlanKnown: true,
      budgetDecision: "ok",
      abortKnown: true,
      eventStreamKnown: true,
      finalOutputContractKnown: true,
    });
    expect(twoFileCodeReview.decision).toBe("ready-for-human-decision");
    expect(twoFileCodeReview.sdkMaturity).toMatchObject({
      rung: "needs-evidence-code-review",
      validatedEnvelope: false,
      scope: "narrow",
    });
    expect(twoFileCodeReview.nextActions.join("\n")).toContain("new evidence rung");
    expect(twoFileCodeReview.nextActions.join("\n")).toContain("shrink to one target file or one named symbol");

    const oneSymbolCodeReview = buildAgentRunSdkInProcessPacket({
      runId: "sdk-one-symbol-code-review",
      goal: "Read only the declared file and focus only on the readyNextActions / buildSdkMaturity area; recommend one parent-side patch.",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      declaredFiles: ["packages/pi-stack/extensions/guardrails-core-agent-run-sdk-preview.ts"],
      timeoutMs: 90_000,
      toolAllowlist: ["read", "grep"],
      validationGateKnown: true,
      rollbackPlanKnown: true,
      budgetDecision: "ok",
      abortKnown: true,
      eventStreamKnown: true,
      finalOutputContractKnown: true,
    });
    expect(oneSymbolCodeReview.sdkMaturity).toMatchObject({
      rung: "validated-narrow-readgrep",
      validatedEnvelope: true,
      scope: "narrow",
    });

    const broadReadOnly = buildAgentRunSdkInProcessPacket({
      runId: "sdk-broad-readonly",
      goal: "broad read-only",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      declaredFiles: [
        "packages/pi-stack/extensions/guardrails-core-agent-run-sdk-preview.ts",
        "packages/pi-stack/extensions/guardrails-core-agent-spawn-readiness-surface.ts",
        "packages/pi-stack/test/smoke/guardrails-agent-spawn-readiness.test.ts",
      ],
      timeoutMs: 90_000,
      toolAllowlist: ["read", "grep"],
      validationGateKnown: true,
      rollbackPlanKnown: true,
      budgetDecision: "ok",
      abortKnown: true,
      eventStreamKnown: true,
      finalOutputContractKnown: true,
    });
    expect(broadReadOnly.decision).toBe("ready-for-human-decision");
    expect(broadReadOnly.sdkMaturity).toMatchObject({
      rung: "needs-evidence-broad-readonly",
      validatedEnvelope: false,
      scope: "broad",
    });
    expect(broadReadOnly.nextActions.join("\n")).toContain("new evidence rung");
    expect(broadReadOnly.nextActions.join("\n")).toContain("shrink to one or two declared files");

    const blocked = buildAgentRunSdkInProcessPacket({
      runId: "sdk-blocked",
      goal: "blocked",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      declaredFiles: ["packages/pi-stack/extensions/guardrails-core-agent-run-sdk-preview.ts"],
      timeoutMs: 90_000,
      toolAllowlist: ["read"],
      validationGateKnown: true,
      rollbackPlanKnown: true,
      budgetDecision: "blocked",
      abortKnown: true,
      eventStreamKnown: true,
      finalOutputContractKnown: true,
    });
    expect(blocked.decision).toBe("blocked");
    expect(blocked.blockers).toContain("budget-blocked");
    expect(blocked.sdkMaturity.rung).toBe("blocked");

    const dirtyBlocked = buildAgentRunSdkInProcessPacket({
      runId: "sdk-dirty-blocked",
      goal: "blocked dirty",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      declaredFiles: ["packages/pi-stack/extensions/guardrails-core-agent-run-sdk-preview.ts"],
      timeoutMs: 90_000,
      toolAllowlist: ["read"],
      validationGateKnown: true,
      rollbackPlanKnown: true,
      budgetDecision: "ok",
      abortKnown: true,
      eventStreamKnown: true,
      finalOutputContractKnown: true,
      unexpectedDirty: true,
    });
    expect(dirtyBlocked.decision).toBe("blocked");
    expect(dirtyBlocked.blockers).toContain("unexpected-dirty-state");
    expect(dirtyBlocked.summary).toContain("unexpectedDirty=yes");

    const unsupportedToolsBlocked = buildAgentRunSdkInProcessPacket({
      runId: "sdk-unsupported-tools-blocked",
      goal: "blocked unsupported tools",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      declaredFiles: ["packages/pi-stack/extensions/guardrails-core-agent-run-sdk-preview.ts"],
      timeoutMs: 90_000,
      toolAllowlist: ["read", "grep", "write", "edit", "find", "ls"],
      validationGateKnown: true,
      rollbackPlanKnown: true,
      budgetDecision: "ok",
      abortKnown: true,
      eventStreamKnown: true,
      finalOutputContractKnown: true,
    });
    expect(unsupportedToolsBlocked.decision).toBe("blocked");
    expect(unsupportedToolsBlocked.recommendationCode).toBe("agent-run-sdk-blocked-tools");
    expect(unsupportedToolsBlocked.blockers).toContain("unsupported-tool-policy:find,ls");

    const mutationCanaryReady = buildAgentRunSdkInProcessPacket({
      runId: "sdk-one-file-mutation-canary",
      goal: "Mutate only the declared file and stop.",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      declaredFiles: ["docs/research/agent-runner-maturity-checkpoint-2026-05.md"],
      timeoutMs: 90_000,
      toolAllowlist: ["read", "write"],
      sessionMode: "in-memory",
      fileContract: "mutation",
      validationGateKnown: true,
      rollbackPlanKnown: true,
      budgetDecision: "ok",
      abortKnown: true,
      eventStreamKnown: true,
      finalOutputContractKnown: true,
    });
    expect(mutationCanaryReady.decision).toBe("ready-for-human-decision");
    expect(mutationCanaryReady.blockers).not.toContain("unsupported-tool-policy:write");
    expect(mutationCanaryReady.sdkMaturity).toMatchObject({
      rung: "validated-one-file-mutation",
      validatedEnvelope: true,
      maxDeclaredFilesValidated: 1,
      supportedToolsValidated: ["read", "write", "edit"],
    });
    expect(mutationCanaryReady.nextActions.join("\n")).toContain("validated one-file mutation envelope");
    expect(mutationCanaryReady.nextActions.join("\n")).toContain("do not promote broad mutation");
    expect(mutationCanaryReady.sdkPreview.isolationNotes.join("\n")).toContain("Live-validated one-file mutation rung");

    const multiFileMutationStillNeedsEvidence = buildAgentRunSdkInProcessPacket({
      runId: "sdk-two-file-mutation-still-blocked",
      goal: "Mutate two declared files and stop.",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      declaredFiles: [
        "docs/research/agent-runner-maturity-checkpoint-2026-05.md",
        "docs/research/single-worker-board-driven-lane-2026-05.md",
      ],
      timeoutMs: 90_000,
      toolAllowlist: ["read", "write"],
      sessionMode: "in-memory",
      fileContract: "mutation",
      validationGateKnown: true,
      rollbackPlanKnown: true,
      budgetDecision: "ok",
      abortKnown: true,
      eventStreamKnown: true,
      finalOutputContractKnown: true,
    });
    expect(multiFileMutationStillNeedsEvidence.decision).toBe("ready-for-human-decision");
    expect(multiFileMutationStillNeedsEvidence.sdkMaturity).toMatchObject({
      rung: "needs-evidence-mutation",
      validatedEnvelope: false,
      maxDeclaredFilesValidated: 1,
    });

    const cachePack = buildAgentRunSdkCachePackPacket({
      packId: "task-bud-1071-shared-evidence-pack",
      entries: [
        {
          id: "sdk-contract",
          path: "packages/pi-stack/extensions/guardrails-core-agent-run-sdk-preview.ts",
          summary: "SDK packet exposes report-only cache and batch contracts.",
          freshness: "fresh",
          evidence: "VERIF-TASK-BUD-1071-SDK-CACHE-PARALLEL-CONTRACT-20260512",
        },
        {
          id: "batch-outcome",
          summary: "Batch outcome fan-in requires explicit cache hit/miss evidence.",
          freshness: "fresh",
          evidence: "VERIF-TASK-BUD-1071-SDK-BATCH-OUTCOME-LIVE-PREVIEW-20260512",
        },
      ],
    });
    expect(cachePack).toMatchObject({
      mode: "agent-run-sdk-cache-pack-packet",
      decision: "ready-for-human-decision",
      dispatchAllowed: false,
      packSpec: {
        entryCount: 2,
        freshCount: 2,
        staleCount: 0,
        unknownCount: 0,
        maxSummaryChars: 600,
        maxEvidenceChars: 300,
      },
      humanConfirmationPhrase: "approve sdk cache pack task-bud-1071-shared-evidence-pack",
    });
    expect(cachePack.entries[0]?.summaryChars).toBe("SDK packet exposes report-only cache and batch contracts.".length);
    expect(cachePack.entries[0]?.evidenceChars).toBe("VERIF-TASK-BUD-1071-SDK-CACHE-PARALLEL-CONTRACT-20260512".length);
    expect(cachePack.cacheKeyContract.join("\n")).toContain("verification id evidence");
    expect(cachePack.cacheKeyContract.join("\n")).toContain("bounded to 600 chars");
    expect(cachePack.workerUseContract.join("\n")).toContain("cache-hit/cache-miss");

    const staleCachePack = buildAgentRunSdkCachePackPacket({
      packId: "task-bud-1071-stale-evidence-pack",
      entries: [
        {
          id: "stale-entry",
          summary: "Stale evidence must not be attached to fan-out workers.",
          freshness: "stale",
          evidence: "old-verification",
        },
      ],
    });
    expect(staleCachePack.decision).toBe("blocked");
    expect(staleCachePack.blockers).toContain("entry-not-fresh:stale-entry:stale");

    const oversizedCachePack = buildAgentRunSdkCachePackPacket({
      packId: "task-bud-1071-oversized-evidence-pack",
      entries: [
        {
          id: "oversized-entry",
          summary: "x".repeat(601),
          freshness: "fresh",
          evidence: "y".repeat(301),
        },
      ],
    });
    expect(oversizedCachePack.decision).toBe("blocked");
    expect(oversizedCachePack.blockers).toContain("entry-summary-too-large:oversized-entry:601>600");
    expect(oversizedCachePack.blockers).toContain("entry-evidence-too-large:oversized-entry:301>300");

    const batchPacket = buildAgentRunSdkReadOnlyBatchPacket({
      batchId: "task-bud-1071-sdk-readonly-batch-preview",
      sharedEvidence: ["VERIF-TASK-BUD-1071-SDK-CACHE-PARALLEL-CONTRACT-20260512"],
      workers: [
        {
          runId: "batch-worker-a",
          goal: "Read only one declared file and answer with PASS/FAIL.",
          providerModelRef: "openai-codex/gpt-5.3-codex-spark",
          cwd: process.cwd(),
          declaredFiles: ["packages/pi-stack/extensions/guardrails-core-agent-run-sdk-preview.ts"],
          timeoutMs: 45_000,
          toolAllowlist: ["read", "grep"],
          validationGateKnown: true,
          rollbackPlanKnown: true,
          budgetDecision: "ok",
          abortKnown: true,
          eventStreamKnown: true,
          finalOutputContractKnown: true,
        },
        {
          runId: "batch-worker-b",
          goal: "Read only one declared file and answer with PASS/FAIL.",
          providerModelRef: "openai-codex/gpt-5.3-codex-spark",
          cwd: process.cwd(),
          declaredFiles: ["packages/pi-stack/test/smoke/guardrails-agent-spawn-readiness.test.ts"],
          timeoutMs: 45_000,
          toolAllowlist: ["read", "grep"],
          validationGateKnown: true,
          rollbackPlanKnown: true,
          budgetDecision: "ok",
          abortKnown: true,
          eventStreamKnown: true,
          finalOutputContractKnown: true,
        },
      ],
    });
    expect(batchPacket).toMatchObject({
      mode: "agent-run-sdk-readonly-batch-packet",
      decision: "ready-for-human-decision",
      dispatchAllowed: false,
      parallelDispatchAllowed: false,
      readyWorkerCount: 2,
      humanConfirmationPhrase: "approve sdk readonly batch task-bud-1071-sdk-readonly-batch-preview",
    });
    expect(batchPacket.fanOutContract.join("\n")).toContain("never dispatches workers by itself");
    expect(batchPacket.fanInContract.join("\n")).toContain("cache-hit/cache-miss evidence");
    expect(batchPacket.cacheEconomyContract.join("\n")).toContain("shared evidence pack");
    expect(batchPacket.cacheEconomyContract.join("\n")).toContain("bounded to 20 items of 300 chars each");
    expect(batchPacket.batchSpec.maxSharedEvidenceItems).toBe(20);
    expect(batchPacket.batchSpec.maxSharedEvidenceChars).toBe(300);
    expect(batchPacket.workers[0]?.runSpec.sharedEvidence).toEqual(["VERIF-TASK-BUD-1071-SDK-CACHE-PARALLEL-CONTRACT-20260512"]);
    expect(batchPacket.summary).toContain("parallelDispatch=no");

    const batchBlocked = buildAgentRunSdkReadOnlyBatchPacket({
      batchId: "batch-blocked",
      workers: [
        {
          runId: "batch-single",
          goal: "single worker is not a batch",
          providerModelRef: "openai-codex/gpt-5.3-codex-spark",
          cwd: process.cwd(),
          declaredFiles: ["packages/pi-stack/extensions/guardrails-core-agent-run-sdk-preview.ts"],
          timeoutMs: 45_000,
          toolAllowlist: ["read", "grep"],
          validationGateKnown: true,
          rollbackPlanKnown: true,
          budgetDecision: "ok",
          abortKnown: true,
          eventStreamKnown: true,
          finalOutputContractKnown: true,
        },
      ],
    });
    expect(batchBlocked.decision).toBe("blocked");
    expect(batchBlocked.blockers).toContain("shared-evidence-missing");
    expect(batchBlocked.blockers).toContain("batch-needs-at-least-two-workers");

    const oversizedSharedEvidenceBatch = buildAgentRunSdkReadOnlyBatchPacket({
      batchId: "batch-oversized-shared-evidence",
      sharedEvidence: ["VERIF-DUPLICATE", "VERIF-DUPLICATE", "x".repeat(301)],
      workers: [
        {
          runId: "batch-oversized-a",
          goal: "Read only one declared file and answer with PASS/FAIL.",
          providerModelRef: "openai-codex/gpt-5.3-codex-spark",
          cwd: process.cwd(),
          declaredFiles: ["packages/pi-stack/extensions/guardrails-core-agent-run-sdk-preview.ts"],
          timeoutMs: 45_000,
          toolAllowlist: ["read", "grep"],
          validationGateKnown: true,
          rollbackPlanKnown: true,
          budgetDecision: "ok",
          abortKnown: true,
          eventStreamKnown: true,
          finalOutputContractKnown: true,
        },
        {
          runId: "batch-oversized-b",
          goal: "Read only one declared file and answer with PASS/FAIL.",
          providerModelRef: "openai-codex/gpt-5.3-codex-spark",
          cwd: process.cwd(),
          declaredFiles: ["packages/pi-stack/test/smoke/guardrails-agent-run-sdk.test.ts"],
          timeoutMs: 45_000,
          toolAllowlist: ["read", "grep"],
          validationGateKnown: true,
          rollbackPlanKnown: true,
          budgetDecision: "ok",
          abortKnown: true,
          eventStreamKnown: true,
          finalOutputContractKnown: true,
        },
      ],
    });
    expect(oversizedSharedEvidenceBatch.decision).toBe("blocked");
    expect(oversizedSharedEvidenceBatch.blockers).toContain("duplicate-shared-evidence:VERIF-DUPLICATE");
    expect(oversizedSharedEvidenceBatch.blockers).toContain("shared-evidence-too-large:3:301>300");

    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsCore>[0];
    guardrailsCore(pi);
    const cachePackToolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_sdk_cache_pack_packet");
    const cachePackTool = cachePackToolCall?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
    };
    const cachePackSurface = cachePackTool.execute("tc-sdk-cache-pack-preview", {
      pack_id: "task-bud-1071-shared-evidence-pack",
      entries: [
        {
          id: "sdk-contract",
          path: "packages/pi-stack/extensions/guardrails-core-agent-run-sdk-preview.ts",
          summary: "SDK packet exposes report-only cache and batch contracts.",
          freshness: "fresh",
          evidence: "VERIF-TASK-BUD-1071-SDK-CACHE-PARALLEL-CONTRACT-20260512",
        },
      ],
    }, undefined as unknown as AbortSignal, () => {}, { cwd: process.cwd() });
    expect(cachePackSurface.details?.mode).toBe("agent-run-sdk-cache-pack-packet");
    expect(cachePackSurface.details?.dispatchAllowed).toBe(false);
    expect(cachePackSurface.content?.[0]?.text).toContain("dispatch=no");
    const batchToolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_sdk_readonly_batch_packet");
    const batchTool = batchToolCall?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
    };
    const batchSurface = batchTool.execute("tc-sdk-batch-preview", {
      batch_id: "task-bud-1071-sdk-readonly-batch-preview",
      shared_evidence: ["VERIF-TASK-BUD-1071-SDK-CACHE-PARALLEL-CONTRACT-20260512"],
      workers: [
        {
          run_id: "batch-surface-worker-a",
          goal: "Read one file and stop.",
          provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
          declared_files: ["packages/pi-stack/extensions/guardrails-core-agent-run-sdk-preview.ts"],
          timeout_ms: 45_000,
          tool_allowlist: ["read", "grep"],
          validation_gate_known: true,
          rollback_plan_known: true,
          budget_decision: "ok",
          abort_known: true,
          event_stream_known: true,
          final_output_contract_known: true,
        },
        {
          run_id: "batch-surface-worker-b",
          goal: "Read one file and stop.",
          provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
          declared_files: ["packages/pi-stack/test/smoke/guardrails-agent-spawn-readiness.test.ts"],
          timeout_ms: 45_000,
          tool_allowlist: ["read", "grep"],
          validation_gate_known: true,
          rollback_plan_known: true,
          budget_decision: "ok",
          abort_known: true,
          event_stream_known: true,
          final_output_contract_known: true,
        },
      ],
    }, undefined as unknown as AbortSignal, () => {}, { cwd: process.cwd() });
    expect(batchSurface.details?.mode).toBe("agent-run-sdk-readonly-batch-packet");
    expect(batchSurface.details?.parallelDispatchAllowed).toBe(false);
    expect(batchSurface.content?.[0]?.text).toContain("parallelDispatch=no");
    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_sdk_in_process_packet");
    const tool = toolCall?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
    };
    const surfaceResult = tool.execute("tc-sdk-preview", {
      run_id: "task-bud-1068-sdk-preview-canary",
      goal: "Preview SDK worker.",
      provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
      declared_files: ["packages/pi-stack/extensions/guardrails-core-agent-run-sdk-preview.ts"],
      shared_evidence: ["VERIF-TASK-BUD-1071-SDK-CACHE-PACK-LIVE-PREVIEW-20260513"],
      timeout_ms: 90_000,
      tool_allowlist: ["read", "grep"],
      validation_gate_known: true,
      rollback_plan_known: true,
      budget_decision: "ok",
      budget_evidence: "Spark model-specific capacity available",
      budget_evidence_provider: "openai-codex/gpt-5.3-codex-spark",
      abort_known: true,
      event_stream_known: true,
      final_output_contract_known: true,
    }, undefined as unknown as AbortSignal, () => {}, { cwd: process.cwd() });
    expect(surfaceResult.details?.mode).toBe("agent-run-sdk-in-process-packet");
    expect((surfaceResult.details?.runSpec as { sharedEvidence?: string[] })?.sharedEvidence).toEqual(["VERIF-TASK-BUD-1071-SDK-CACHE-PACK-LIVE-PREVIEW-20260513"]);
    expect(surfaceResult.details?.processStartAllowed).toBe(false);
    expect(surfaceResult.content?.[0]?.text).toContain("dispatch=no");

    const dispatchToolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([registered]) => registered?.name === "agent_run_sdk_in_process_dispatch");
    const dispatchTool = dispatchToolCall?.[0] as typeof tool;
    const dispatchPreview = dispatchTool.execute("tc-sdk-dispatch-preview", {
      run_id: "task-bud-1068-sdk-dispatch-preview-canary",
      goal: "Preview SDK dispatch without execution.",
      provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
      declared_files: ["packages/pi-stack/extensions/guardrails-core-agent-spawn-readiness-surface.ts"],
      timeout_ms: 90_000,
      tool_allowlist: ["read", "grep"],
      validation_gate_known: true,
      rollback_plan_known: true,
      budget_decision: "ok",
      budget_evidence: "Spark model-specific capacity available",
      budget_evidence_provider: "openai-codex/gpt-5.3-codex-spark",
      abort_known: true,
      event_stream_known: true,
      final_output_contract_known: true,
    }, undefined as unknown as AbortSignal, () => {}, { cwd: process.cwd() });
    expect(dispatchPreview.details?.mode).toBe("agent-run-sdk-in-process-dispatch");
    expect(dispatchPreview.details?.processStartAllowed).toBe(false);
    expect(dispatchPreview.details?.humanConfirmationPhrase).toBe("execute o sdk worker task-bud-1068-sdk-dispatch-preview-canary");
    expect(dispatchPreview.content?.[0]?.text).toContain("decision=preview");
    expect(dispatchPreview.content?.[0]?.text).toContain("dispatch=no");

    const dispatchMismatch = dispatchTool.execute("tc-sdk-dispatch-mismatch", {
      run_id: "task-bud-1068-sdk-dispatch-preview-canary",
      goal: "Preview SDK dispatch mismatch.",
      provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
      declared_files: ["packages/pi-stack/extensions/guardrails-core-agent-spawn-readiness-surface.ts"],
      timeout_ms: 90_000,
      tool_allowlist: ["read", "grep"],
      validation_gate_known: true,
      rollback_plan_known: true,
      budget_decision: "ok",
      budget_evidence: "Spark model-specific capacity available",
      budget_evidence_provider: "openai-codex/gpt-5.3-codex-spark",
      abort_known: true,
      event_stream_known: true,
      final_output_contract_known: true,
      execute: true,
      operator_confirmation: "wrong confirmation",
    }, undefined as unknown as AbortSignal, () => {}, { cwd: process.cwd() });
    expect(dispatchMismatch.details?.processStartAllowed).toBe(false);
    expect(dispatchMismatch.content?.[0]?.text).toContain("operator-confirmation-mismatch");
  });
});
