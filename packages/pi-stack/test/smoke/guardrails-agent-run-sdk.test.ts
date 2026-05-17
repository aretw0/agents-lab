import { describe, expect, it, vi } from "vitest";
import guardrailsCore, { buildAgentRunSdkCachePackPacket, buildAgentRunSdkInProcessPacket, buildAgentRunSdkProviderModelArenaArtifactPacket, buildAgentRunSdkProviderModelArenaPacket, buildAgentRunSdkReadOnlyBatchPacket } from "../../extensions/guardrails-core";

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

    const arenaPacket = buildAgentRunSdkProviderModelArenaPacket({
      arenaId: "arena-openai-spark-smoke",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      envelopes: ["readonly-one-file", "mutation-one-file-marker"],
      maxCalls: 2,
      timeoutMs: 90_000,
      maxEstimatedCostUsd: 0.25,
      budgetDecision: "ok",
      budgetEvidence: "manual test budget evidence",
    });
    expect(arenaPacket).toMatchObject({
      mode: "agent-run-sdk-provider-model-arena-packet",
      dispatchAllowed: false,
      paidModelCallsAllowed: false,
      decision: "ready-for-human-decision",
    });
    expect(arenaPacket.arenaSpec.promotionScope).toBe("provider-model-envelope");
    expect(arenaPacket.canaries).toHaveLength(2);
    expect(arenaPacket.canaries.map((canary) => canary.envelope)).toEqual(["readonly-one-file", "mutation-one-file-marker"]);
    expect(arenaPacket.canaries[1]?.packet.sdkMaturity.rung).toBe("validated-one-file-mutation");
    expect(arenaPacket.promotionContract.join("\n")).toContain("passing one provider/model does not promote another provider/model");
    expect(arenaPacket.budgetContract.join("\n")).toContain("never starts paid/model calls by itself");
    expect(arenaPacket.priorArtContract.join("\n")).toContain("do not benchmark in isolation");
    expect(arenaPacket.priorArtContract.join("\n")).toContain("external prior art");
    expect(arenaPacket.nextActions.join("\n")).toContain("collect prior-art references");
    expect(arenaPacket.summary).toContain("paidCalls=no");

    const expandedArenaPacket = buildAgentRunSdkProviderModelArenaPacket({
      arenaId: "arena-expanded-openai-spark-smoke",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      envelopes: [
        "readonly-three-file-risk-table",
        "readonly-source-backed-evidence-synthesis",
        "readonly-web-research-tool-contract-review",
      ],
      maxCalls: 3,
      timeoutMs: 45_000,
      maxEstimatedCostUsd: 0.75,
      budgetDecision: "ok",
      budgetEvidence: "manual expanded suite budget evidence",
    });
    expect(expandedArenaPacket.decision).toBe("ready-for-human-decision");
    expect(expandedArenaPacket.canaries.map((canary) => canary.envelope)).toEqual([
      "readonly-three-file-risk-table",
      "readonly-source-backed-evidence-synthesis",
      "readonly-web-research-tool-contract-review",
    ]);
    expect(expandedArenaPacket.canaries[0]?.declaredFiles).toEqual(["package.json", "packages/pi-stack/package.json", ".github/workflows/publish.yml"]);
    expect(expandedArenaPacket.canaries[0]?.maturityNotes).toContain("generic risk table");
    expect(expandedArenaPacket.canaries[0]?.protectedScope).toBe(false);
    expect(expandedArenaPacket.canaries[1]?.declaredFiles).toContain("docs/research/source-backed-pnpm-supply-chain-evidence-2026-05.md");
    expect(expandedArenaPacket.canaries[2]?.packet.runSpec.goal).toContain("do not use web");
    expect(expandedArenaPacket.suiteManifest).toMatchObject({
      mode: "report-only-suite",
      suiteId: "arena-expanded-openai-spark-smoke",
      parallelism: 1,
      runIds: [
        "arena-expanded-openai-spark-smoke-readonly-three-file-risk-table",
        "arena-expanded-openai-spark-smoke-readonly-source-backed-evidence-synthesis",
        "arena-expanded-openai-spark-smoke-readonly-web-research-tool-contract-review",
      ],
    });
    expect(expandedArenaPacket.suiteManifest.envelopes[1]?.maturityNotes).toContain("parent-curated source-backed synthesis");
    expect(expandedArenaPacket.suiteManifest.envelopes[1]?.protectedScope).toBe(false);
    expect(expandedArenaPacket.suiteManifest.stopOn).toContain("unexpected-touched-file");
    expect(expandedArenaPacket.suiteManifest.fanInValidation.join("\n")).toContain("terminal outcome packet");
    expect(expandedArenaPacket.nextActions.join("\n")).toContain("report-only suite manifest");
    expect(expandedArenaPacket.summary).toContain("envelopes=3");

    const mutationArenaPacket = buildAgentRunSdkProviderModelArenaPacket({
      arenaId: "arena-mutation-openai-spark-smoke",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      envelopes: ["mutation-one-file-doc-marker", "mutation-one-file-test-fixture", "mutation-one-file-code-constant"],
      maxCalls: 3,
      timeoutMs: 45_000,
      maxEstimatedCostUsd: 0.75,
      budgetDecision: "ok",
      budgetEvidence: "manual one-file mutation suite budget evidence",
    });
    expect(mutationArenaPacket.decision).toBe("ready-for-human-decision");
    expect(mutationArenaPacket.canaries.map((canary) => canary.fileContract)).toEqual(["mutation", "mutation", "mutation"]);
    expect(mutationArenaPacket.canaries.every((canary) => canary.packet.sdkMaturity.rung === "validated-one-file-mutation")).toBe(true);
    expect(mutationArenaPacket.canaries[1]?.declaredFiles).toEqual(["packages/pi-stack/test/smoke/guardrails-agent-run-sdk.test.ts"]);
    expect(mutationArenaPacket.canaries[2]?.maturityNotes).toContain("generic one-file code/config mutation");
    expect(mutationArenaPacket.suiteManifest.envelopes[0]?.validation).toContain("touched files must stay within declared files");
    expect(mutationArenaPacket.scorecardTemplate.artifactPath).toBe(".pi/reports/arena-mutation-openai-spark-smoke.scorecard.json");
    expect(mutationArenaPacket.scorecardTemplate.rows).toHaveLength(3);
    expect(mutationArenaPacket.scorecardTemplate.rows[0]).toMatchObject({
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      envelope: "mutation-one-file-doc-marker",
      processState: "pending",
      contractDecision: "pending",
    });
    expect(mutationArenaPacket.scorecardTemplate.requiredFields).toContain("contractDecision");
    expect(mutationArenaPacket.fanInPlan).toMatchObject({
      artifactPath: ".pi/reports/arena-mutation-openai-spark-smoke.fanin.json",
      expectedRunIds: [
        "arena-mutation-openai-spark-smoke-mutation-one-file-doc-marker",
        "arena-mutation-openai-spark-smoke-mutation-one-file-test-fixture",
        "arena-mutation-openai-spark-smoke-mutation-one-file-code-constant",
      ],
    });
    expect(mutationArenaPacket.fanInPlan.requiredOutcomePackets[0]).toContain("agent_run_outcome_packet");
    expect(mutationArenaPacket.fanInPlan.failClosedOn).toContain("contract-failure");
    expect(mutationArenaPacket.serialSuiteDispatchPlan).toMatchObject({
      mode: "exact-confirmed-serial-suite-preview",
      dispatchAllowed: false,
      executeSupported: false,
      humanConfirmationPhrase: "execute arena serial suite arena-mutation-openai-spark-smoke",
      runOrder: [
        "arena-mutation-openai-spark-smoke-mutation-one-file-doc-marker",
        "arena-mutation-openai-spark-smoke-mutation-one-file-test-fixture",
        "arena-mutation-openai-spark-smoke-mutation-one-file-code-constant",
      ],
    });
    expect(mutationArenaPacket.serialSuiteDispatchPlan.preflightChecks.join("\n")).toContain("operator confirmation exactly matches");
    expect(mutationArenaPacket.serialSuiteDispatchPlan.blockedUntil.join("\n")).toContain("serial-suite executor exists");
    expect(mutationArenaPacket.suiteArtifactPlan).toMatchObject({
      mode: "report-only-artifact-write-preview",
      writeAllowed: false,
      applySupported: false,
      artifacts: [
        {
          kind: "suite-manifest",
          path: ".pi/reports/arena-mutation-openai-spark-smoke.manifest.json",
          sourceField: "suiteManifest",
          requiredBeforePromotion: true,
        },
        {
          kind: "scorecard-template",
          path: ".pi/reports/arena-mutation-openai-spark-smoke.scorecard.json",
          sourceField: "scorecardTemplate",
          requiredBeforePromotion: true,
        },
        {
          kind: "fanin-plan",
          path: ".pi/reports/arena-mutation-openai-spark-smoke.fanin.json",
          sourceField: "fanInPlan",
          requiredBeforePromotion: true,
        },
      ],
    });
    expect(mutationArenaPacket.suiteArtifactPlan.operatorSteps.join("\n")).toContain("do not start workers");
    expect(mutationArenaPacket.suiteArtifactPlan.operatorSteps.join("\n")).toContain("future models prove capabilities independently");
    const artifactPacket = buildAgentRunSdkProviderModelArenaArtifactPacket({
      arenaId: "arena-mutation-openai-spark-smoke",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      envelopes: ["mutation-one-file-doc-marker", "mutation-one-file-test-fixture", "mutation-one-file-code-constant"],
      maxCalls: 3,
      timeoutMs: 45_000,
      maxEstimatedCostUsd: 0.75,
      budgetDecision: "ok",
      budgetEvidence: "manual one-file mutation suite budget evidence",
    });
    expect(artifactPacket).toMatchObject({
      mode: "agent-run-sdk-provider-model-arena-artifact-packet",
      decision: "preview",
      writeAllowed: false,
      dispatchAllowed: false,
      applyRequested: false,
      humanConfirmationPhrase: "persist arena artifacts arena-mutation-openai-spark-smoke",
    });
    expect(artifactPacket.artifactPreviews.map((artifact) => artifact.kind)).toEqual(["suite-manifest", "scorecard-template", "fanin-plan"]);
    expect(artifactPacket.artifactPreviews[0]?.path).toBe(".pi/reports/arena-mutation-openai-spark-smoke.manifest.json");
    expect(artifactPacket.artifactPreviews.every((artifact) => artifact.bytes > 0)).toBe(true);
    expect(artifactPacket.nextActions.join("\n")).toContain("do not start workers");
    const blockedArtifactApply = buildAgentRunSdkProviderModelArenaArtifactPacket({
      arenaId: "arena-mutation-openai-spark-smoke",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      envelopes: ["mutation-one-file-doc-marker"],
      maxCalls: 1,
      timeoutMs: 45_000,
      maxEstimatedCostUsd: 0.25,
      budgetDecision: "ok",
      budgetEvidence: "manual one-file mutation suite budget evidence",
      apply: true,
      operatorConfirmation: "wrong confirmation",
    });
    expect(blockedArtifactApply.decision).toBe("blocked");
    expect(blockedArtifactApply.writeAllowed).toBe(false);
    expect(blockedArtifactApply.blockers).toContain("operator-confirmation-mismatch");
    const confirmedArtifactApply = buildAgentRunSdkProviderModelArenaArtifactPacket({
      arenaId: "arena-mutation-openai-spark-smoke",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      envelopes: ["mutation-one-file-doc-marker"],
      maxCalls: 1,
      timeoutMs: 45_000,
      maxEstimatedCostUsd: 0.25,
      budgetDecision: "ok",
      budgetEvidence: "manual one-file mutation suite budget evidence",
      apply: true,
      operatorConfirmation: "persist arena artifacts arena-mutation-openai-spark-smoke",
    });
    expect(confirmedArtifactApply).toMatchObject({
      decision: "ready-to-apply",
      authorization: "explicit-human",
      writeAllowed: true,
      dispatchAllowed: false,
      paidModelCallsAllowed: false,
    });
    expect(confirmedArtifactApply.summary).toContain("write=yes");
    expect(mutationArenaPacket.nextActions.join("\n")).toContain("serialSuiteDispatchPlan only as a preview");
    expect(mutationArenaPacket.nextActions.join("\n")).toContain("suiteArtifactPlan before persisting");
    expect(mutationArenaPacket.promotionContract.join("\n")).toContain("does not promote multi-file mutation");

    const arenaBlocked = buildAgentRunSdkProviderModelArenaPacket({
      arenaId: "arena-blocked",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      envelopes: ["readonly-one-file", "unknown-envelope"],
      maxCalls: 1,
      timeoutMs: 90_000,
      maxEstimatedCostUsd: 0,
      budgetDecision: "unknown",
    });
    expect(arenaBlocked.decision).toBe("blocked");
    expect(arenaBlocked.blockers).toContain("unknown-envelope");
    expect(arenaBlocked.blockers).toContain("max-estimated-cost-missing");
    expect(arenaBlocked.blockers).toContain("budget-evidence-missing");

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
    const registeredSdkTools = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls
      .map(([tool]) => tool as { name?: string; parameters?: { type?: string; properties?: Record<string, unknown> } })
      .filter((tool) => tool.name?.startsWith("agent_run_sdk_"));
    expect(registeredSdkTools.length).toBeGreaterThan(0);
    for (const tool of registeredSdkTools) {
      expect(tool.parameters?.type, `${tool.name} parameters must be a JSON object schema`).toBe("object");
    }
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

    const batchDispatchToolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_sdk_readonly_batch_dispatch");
    expect(batchDispatchToolCall?.[0]?.parameters).toMatchObject({
      type: "object",
      properties: {
        execute: expect.any(Object),
        operator_confirmation: expect.any(Object),
      },
    });
    const batchDispatchTool = batchDispatchToolCall?.[0] as typeof batchTool;
    const batchDispatchPreview = batchDispatchTool.execute("tc-sdk-batch-dispatch-preview", {
      batch_id: "task-bud-1071-sdk-readonly-batch-dispatch-preview",
      shared_evidence: ["VERIF-TASK-BUD-1071-SDK-CACHE-PARALLEL-CONTRACT-20260512"],
      workers: [
        {
          run_id: "batch-dispatch-surface-worker-a",
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
          run_id: "batch-dispatch-surface-worker-b",
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
    expect(batchDispatchPreview.details?.mode).toBe("agent-run-sdk-readonly-batch-dispatch");
    expect(batchDispatchPreview.details?.processStartAllowed).toBe(false);
    expect(batchDispatchPreview.details?.humanConfirmationPhrase).toBe("approve sdk readonly batch task-bud-1071-sdk-readonly-batch-dispatch-preview");
    expect(batchDispatchPreview.content?.[0]?.text).toContain("decision=preview");
    expect(batchDispatchPreview.content?.[0]?.text).toContain("parallelDispatch=no");

    const batchDispatchMismatch = batchDispatchTool.execute("tc-sdk-batch-dispatch-mismatch", {
      batch_id: "task-bud-1071-sdk-readonly-batch-dispatch-preview",
      shared_evidence: ["VERIF-TASK-BUD-1071-SDK-CACHE-PARALLEL-CONTRACT-20260512"],
      workers: [
        {
          run_id: "batch-dispatch-surface-worker-a",
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
          run_id: "batch-dispatch-surface-worker-b",
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
      execute: true,
      operator_confirmation: "wrong confirmation",
    }, undefined as unknown as AbortSignal, () => {}, { cwd: process.cwd() });
    expect(batchDispatchMismatch.details?.processStartAllowed).toBe(false);
    expect(batchDispatchMismatch.content?.[0]?.text).toContain("operator-confirmation-mismatch");

    const batchStatusToolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_sdk_readonly_batch_status");
    expect(batchStatusToolCall?.[0]?.parameters).toMatchObject({ type: "object" });
    const batchStatusTool = batchStatusToolCall?.[0] as typeof batchTool;
    const batchStatusMissing = batchStatusTool.execute("tc-sdk-batch-status-missing", {
      batch_id: "task-bud-1071-sdk-readonly-batch-dispatch-preview",
      run_ids: ["batch-dispatch-surface-worker-a", "batch-dispatch-surface-worker-b"],
      max_lines: 5,
    }, undefined as unknown as AbortSignal, () => {}, { cwd: process.cwd() });
    expect(batchStatusMissing.details?.mode).toBe("agent-run-sdk-readonly-batch-status");
    expect(batchStatusMissing.details?.processStartAllowed).toBe(false);
    expect(batchStatusMissing.content?.[0]?.text).toContain("missing=2");
    expect(batchStatusMissing.content?.[0]?.text).toContain("fanInReady=no");
    expect(batchStatusMissing.content?.[0]?.text).toContain("dispatch=no");

    const batchStatusBlocked = batchStatusTool.execute("tc-sdk-batch-status-blocked", {
      batch_id: "task-bud-1071-sdk-readonly-batch-dispatch-preview",
    }, undefined as unknown as AbortSignal, () => {}, { cwd: process.cwd() });
    expect(batchStatusBlocked.content?.[0]?.text).toContain("blockers=run-ids-missing");

    const batchFanInToolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_sdk_readonly_batch_fan_in_packet");
    expect(batchFanInToolCall?.[0]?.parameters).toMatchObject({ type: "object" });
    const batchFanInTool = batchFanInToolCall?.[0] as typeof batchTool;
    const batchFanInMissing = batchFanInTool.execute("tc-sdk-batch-fan-in-missing", {
      batch_id: "task-bud-1071-sdk-readonly-batch-dispatch-preview",
      expected_run_ids: ["batch-dispatch-surface-worker-a", "batch-dispatch-surface-worker-b"],
      cache_status_by_run: [
        { run_id: "batch-dispatch-surface-worker-a", cache_status: "hit" },
        { run_id: "batch-dispatch-surface-worker-b", cache_status: "miss" },
      ],
    }, undefined as unknown as AbortSignal, () => {}, { cwd: process.cwd() });
    expect(batchFanInMissing.details?.mode).toBe("agent-run-sdk-readonly-batch-fan-in-packet");
    expect(batchFanInMissing.details?.processStartAllowed).toBe(false);
    expect(batchFanInMissing.content?.[0]?.text).toContain("decision=fail");
    expect(batchFanInMissing.content?.[0]?.text).toContain("worker-process-not-completed:batch-dispatch-surface-worker-a:unknown");
    expect(batchFanInMissing.content?.[0]?.text).toContain("dispatch=no");

    const arenaToolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_sdk_provider_model_arena_packet");
    const arenaTool = arenaToolCall?.[0] as typeof batchTool;
    const arenaSurface = arenaTool.execute("tc-sdk-arena-preview", {
      arena_id: "arena-surface-openai-spark",
      provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
      envelopes: ["readonly-one-file", "mutation-one-file-marker"],
      max_calls: 2,
      timeout_ms: 90_000,
      max_estimated_cost_usd: 0.25,
      budget_decision: "ok",
      budget_evidence: "manual surface test budget evidence",
    }, undefined as unknown as AbortSignal, () => {}, { cwd: process.cwd() });
    expect(arenaSurface.details?.mode).toBe("agent-run-sdk-provider-model-arena-packet");
    expect(arenaSurface.content?.[0]?.text).toContain("paidCalls=no");
    expect(arenaSurface.content?.[0]?.text).toContain("dispatch=no");
    const arenaArtifactToolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_sdk_provider_model_arena_artifact_packet");
    expect(arenaArtifactToolCall?.[0]?.parameters).toMatchObject({
      type: "object",
      properties: {
        arena_id: expect.any(Object),
        apply: expect.any(Object),
        operator_confirmation: expect.any(Object),
      },
    });
    const arenaArtifactTool = arenaArtifactToolCall?.[0] as typeof batchTool;
    const arenaArtifactSurface = arenaArtifactTool.execute("tc-sdk-arena-artifact-preview", {
      arena_id: "arena-surface-openai-spark",
      provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
      envelopes: ["readonly-one-file", "mutation-one-file-marker"],
      max_calls: 2,
      timeout_ms: 90_000,
      max_estimated_cost_usd: 0.25,
      budget_decision: "ok",
      budget_evidence: "manual surface test budget evidence",
    }, undefined as unknown as AbortSignal, () => {}, { cwd: process.cwd() });
    expect(arenaArtifactSurface.details?.mode).toBe("agent-run-sdk-provider-model-arena-artifact-packet");
    expect(arenaArtifactSurface.content?.[0]?.text).toContain("write=no");
    expect(arenaArtifactSurface.content?.[0]?.text).toContain("dispatch=no");
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
