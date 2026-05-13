import { describe, expect, it } from "vitest";
import {
  buildLocalMeasuredNudgeFreeLoopAuditEnvelope,
  buildLocalMeasuredNudgeFreeLoopAuditEnvelopeFromCollectedFacts,
  buildLocalMeasuredNudgeFreeLoopCanaryPacket,
  buildLocalSliceCanaryDispatchDecisionPacket,
  NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS,
  resolveCheckpointFreshCollectorResult,
  resolveCheckpointFreshMeasuredSignal,
  resolveCooldownReadyCollectorResult,
  resolveCooldownReadyMeasuredSignal,
  resolveGitStateExpectedCollectorResult,
  resolveGitStateExpectedMeasuredSignal,
  resolveHandoffBudgetCollectorResult,
  resolveHandoffBudgetMeasuredSignal,
  resolveLocalMeasuredNudgeFreeLoopCanaryGate,
  resolveMeasuredFactCollectorAssessment,
  resolveMeasuredFactSourceAssessment,
  resolveMeasuredNudgeFreeLoopCanaryGate,
  resolveMeasuredPacketTrust,
  resolveNextLocalSafeCollectorResult,
  resolveNextLocalSafeMeasuredSignal,
  resolveNudgeFreeLoopCanaryGate,
  resolveSelfReloadAutoresumeCanaryPlan,
  resolveLocalSliceBacklogGate,
  resolveLocalSliceCanaryPlan,
  resolveProtectedScopesCollectorResult,
  resolveProtectedScopesMeasuredSignal,
  resolveStopConditionsClearCollectorResult,
  resolveStopConditionsClearMeasuredSignal,
  resolveUnattendedContinuationPlan,
  resolveValidationKnownCollectorResult,
  resolveValidationKnownMeasuredSignal,
  reviewLocalSliceHumanConfirmedContract,
} from "../../extensions/guardrails-core-unattended-continuation";

const completeMeasuredEvidence = [
  { gate: "next-local-safe", ok: true, evidence: "selector=local-safe" },
  { gate: "checkpoint-fresh", ok: true, evidence: "handoff=fresh" },
  { gate: "handoff-budget-ok", ok: true, evidence: "handoff-budget=ok" },
  { gate: "git-state-expected", ok: true, evidence: "git=expected" },
  { gate: "protected-scopes-clear", ok: true, evidence: "protected=clear" },
  { gate: "cooldown-ready", ok: true, evidence: "cooldown=ready" },
  { gate: "validation-known", ok: true, evidence: "validation=known" },
  { gate: "stop-conditions-clear", ok: true, evidence: "stops=clear" },
] as const;

const allMeasuredEvidenceGates = completeMeasuredEvidence.map((entry) => entry.gate);
const completeMeasuredSignals = Object.fromEntries(
  completeMeasuredEvidence.map((entry) => [entry.gate, { ok: entry.ok, evidence: entry.evidence }]),
) as any;

function greenInput() {
  return {
    readinessReady: true,
    authorization: "none" as const,
    checkpointFresh: true,
    handoffBudgetOk: true,
    gitStateExpected: true,
    protectedScopesClear: true,
    validationKnown: true,
    stopConditionsClear: true,
    risk: false,
    ambiguous: false,
  };
}

describe("guardrails unattended continuation", () => {
  it("plans self-reload/autoresume as read-only human decision evidence", () => {
    const ready = resolveSelfReloadAutoresumeCanaryPlan({
      optIn: true,
      reloadRequired: true,
      checkpointFresh: true,
      handoffBudgetOk: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      cooldownReady: true,
      autoResumePreviewReady: true,
      pendingMessagesClear: true,
      recentSteerClear: true,
      laneQueueClear: true,
      stopConditionsClear: true,
      contextLevel: "ok",
    });
    expect(ready.decision).toBe("ready-for-human-decision");
    expect(ready.reloadAllowed).toBe(false);
    expect(ready.autoResumeDispatchAllowed).toBe(false);
    expect(ready.dispatchAllowed).toBe(false);
    expect(ready.authorization).toBe("none");
    expect(ready.summary).toContain("reload=no autoResume=no dispatch=no");

    const blocked = resolveSelfReloadAutoresumeCanaryPlan({
      optIn: true,
      reloadRequired: true,
      checkpointFresh: false,
      handoffBudgetOk: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      cooldownReady: true,
      autoResumePreviewReady: true,
      pendingMessagesClear: false,
      recentSteerClear: true,
      laneQueueClear: true,
      stopConditionsClear: true,
      contextLevel: "compact",
    });
    expect(blocked.decision).toBe("blocked");
    expect(blocked.reasons).toContain("checkpoint-not-fresh");
    expect(blocked.reasons).toContain("pending-messages");
    expect(blocked.reasons).toContain("compact-without-fresh-checkpoint");
    expect(blocked.reloadAllowed).toBe(false);

    const notNeeded = resolveSelfReloadAutoresumeCanaryPlan({
      optIn: true,
      reloadRequired: false,
      checkpointFresh: true,
      handoffBudgetOk: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      cooldownReady: true,
      autoResumePreviewReady: true,
      pendingMessagesClear: true,
      recentSteerClear: true,
      laneQueueClear: true,
      stopConditionsClear: true,
      contextLevel: "ok",
    });
    expect(notNeeded.decision).toBe("not-needed");
    expect(notNeeded.requiresHumanDecision).toBe(false);
  });

  it("builds a no-execution decision packet for local-slice dispatch", () => {
    const readyPlan = resolveLocalSliceCanaryPlan(greenInput());
    const baseInput = {
      plan: readyPlan,
      rollbackPlanKnown: true,
      validationGateKnown: true,
      stagingScopeKnown: true,
      commitScopeKnown: true,
      checkpointPlanned: true,
      stopContractKnown: true,
    };
    const readyPacket = buildLocalSliceCanaryDispatchDecisionPacket(baseInput);
    const blockedByPreview = buildLocalSliceCanaryDispatchDecisionPacket({
      ...baseInput,
      plan: resolveLocalSliceCanaryPlan({ ...greenInput(), protectedScopesClear: false }),
    });
    const blockedByContract = buildLocalSliceCanaryDispatchDecisionPacket({
      ...baseInput,
      rollbackPlanKnown: false,
    });
    const executeIntent = buildLocalSliceCanaryDispatchDecisionPacket({
      ...baseInput,
      operatorIntent: "execute-local-slice",
    });

    expect(readyPacket).toMatchObject({
      effect: "none",
      mode: "decision-packet",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      requiresHumanDecision: true,
      singleSliceOnly: true,
      decision: "ready-for-human-decision",
      summary: "local-slice-dispatch-decision-packet: decision=ready-for-human-decision dispatch=no reasons=preview-ready,contracts-present,human-decision-required authorization=none",
    });
    expect(blockedByPreview).toMatchObject({
      decision: "blocked",
      dispatchAllowed: false,
      reasons: ["preview-not-ready"],
    });
    expect(blockedByContract.reasons).toContain("rollback-plan-missing");
    expect(blockedByContract.dispatchAllowed).toBe(false);
    expect(executeIntent.reasons).toContain("execute-intent-recorded-not-authorization");
    expect(executeIntent.dispatchAllowed).toBe(false);
  });

  it("gates local-slice executor backlog without authorizing implementation", () => {
    const readyInput = {
      projectStrategyResolved: true,
      operatorPacketGreenValidated: true,
      operatorPacketFailClosedValidated: true,
      operatorPacketMissingFilesValidated: true,
      explicitHumanContractDefined: true,
      declaredFilesKnown: true,
      rollbackPlanKnown: true,
      validationGateKnown: true,
      stagingScopeKnown: true,
      commitScopeKnown: true,
      timeBudgetKnown: true,
      costBudgetKnown: true,
      cancellationKnown: true,
      checkpointPlanned: true,
      stopContractKnown: true,
      separateTaskRequired: true,
      startsDisabledOrDryRun: true,
    };
    const ready = resolveLocalSliceBacklogGate(readyInput);
    const blocked = resolveLocalSliceBacklogGate({
      ...readyInput,
      projectStrategyResolved: false,
      operatorPacketMissingFilesValidated: false,
      explicitHumanContractDefined: false,
      timeBudgetKnown: false,
      repeatRequested: true,
      schedulerRequested: true,
      selfReloadRequested: true,
      remoteOrOffloadRequested: true,
      githubActionsRequested: true,
      protectedScopeRequested: true,
      destructiveMaintenanceRequested: true,
    });

    expect(ready).toMatchObject({
      effect: "none",
      mode: "backlog-gate",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      executorApproved: false,
      implementationAllowed: false,
      singleSliceOnly: true,
      decision: "ready-for-separate-task",
      reasons: ["criteria-present", "separate-task-required", "implementation-still-not-authorized"],
      summary: "local-slice-backlog-gate: decision=ready-for-separate-task implementation=no dispatch=no executor=no reasons=criteria-present,separate-task-required,implementation-still-not-authorized authorization=none",
    });
    expect(blocked).toMatchObject({
      decision: "blocked",
      dispatchAllowed: false,
      executorApproved: false,
      implementationAllowed: false,
    });
    expect(blocked.summary).toContain("blockedRequests=repeat|scheduler|self-reload|remote-or-offload|github-actions|protected-scope|destructive-maintenance");
    expect(blocked.reasons).toEqual(expect.arrayContaining([
      "project-strategy-missing",
      "operator-packet-missing-files-missing",
      "explicit-human-contract-missing",
      "time-budget-missing",
      "repeat-requested",
      "scheduler-requested",
      "remote-or-offload-requested",
      "destructive-maintenance-requested",
    ]));
  });

  it("reviews a human-confirmed local-slice contract without approving an executor", () => {
    const readyPlan = resolveLocalSliceCanaryPlan(greenInput());
    const readyPacket = buildLocalSliceCanaryDispatchDecisionPacket({
      plan: readyPlan,
      rollbackPlanKnown: true,
      validationGateKnown: true,
      stagingScopeKnown: true,
      commitScopeKnown: true,
      checkpointPlanned: true,
      stopContractKnown: true,
    });
    const readyReview = reviewLocalSliceHumanConfirmedContract({
      decisionPacket: readyPacket,
      humanConfirmation: "explicit-task-action",
      singleFocus: true,
      localSafeScope: true,
      declaredFilesKnown: true,
      protectedScopesClear: true,
      rollbackPlanKnown: true,
      validationGateKnown: true,
      stagingScopeKnown: true,
      commitScopeKnown: true,
      checkpointPlanned: true,
      stopContractKnown: true,
    });
    const genericConfirmation = reviewLocalSliceHumanConfirmedContract({
      decisionPacket: readyPacket,
      humanConfirmation: "generic",
      singleFocus: true,
      localSafeScope: true,
      declaredFilesKnown: true,
      protectedScopesClear: true,
      rollbackPlanKnown: true,
      validationGateKnown: true,
      stagingScopeKnown: true,
      commitScopeKnown: true,
      checkpointPlanned: true,
      stopContractKnown: true,
    });
    const protectedRepeat = reviewLocalSliceHumanConfirmedContract({
      decisionPacket: readyPacket,
      humanConfirmation: "explicit-task-action",
      singleFocus: true,
      localSafeScope: true,
      declaredFilesKnown: true,
      protectedScopesClear: false,
      rollbackPlanKnown: true,
      validationGateKnown: true,
      stagingScopeKnown: true,
      commitScopeKnown: true,
      checkpointPlanned: true,
      stopContractKnown: true,
      repeatRequested: true,
      schedulerRequested: true,
      selfReloadRequested: true,
      remoteOrOffloadRequested: true,
      githubActionsRequested: true,
      protectedScopeRequested: true,
    });

    expect(readyReview).toMatchObject({
      effect: "none",
      mode: "contract-review",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      executorApproved: false,
      singleSliceOnly: true,
      decision: "contract-ready-no-executor",
      reasons: ["contract-valid", "human-confirmation-explicit", "executor-not-approved"],
      summary: "local-slice-human-confirmed-contract: decision=contract-ready-no-executor dispatch=no executor=no reasons=contract-valid,human-confirmation-explicit,executor-not-approved authorization=none",
    });
    expect(readyReview.summary).not.toContain("blockedRequests=");
    expect(genericConfirmation).toMatchObject({
      decision: "blocked",
      dispatchAllowed: false,
      executorApproved: false,
      reasons: ["human-confirmation-generic"],
    });
    expect(protectedRepeat.dispatchAllowed).toBe(false);
    expect(protectedRepeat.executorApproved).toBe(false);
    expect(protectedRepeat.summary).toContain("blockedRequests=repeat|scheduler|self-reload|remote-or-offload|github-actions|protected-scope");
    expect(protectedRepeat.reasons).toEqual(expect.arrayContaining([
      "protected-scope",
      "repeat-requested",
      "scheduler-requested",
      "self-reload-requested",
      "remote-or-offload-requested",
      "github-actions-requested",
      "protected-scope-requested",
    ]));
  });

  it("plans local-slice local canary without activation or repetition", () => {
    const green = resolveLocalSliceCanaryPlan({
      readinessReady: true,
      authorization: "none",
      checkpointFresh: true,
      handoffBudgetOk: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      validationKnown: true,
      stopConditionsClear: true,
      risk: false,
      ambiguous: false,
    });
    const protectedBlocked = resolveLocalSliceCanaryPlan({
      ...greenInput(),
      protectedScopesClear: false,
    });
    const repeatBlocked = resolveLocalSliceCanaryPlan({
      ...greenInput(),
      repeatRequested: true,
    });
    const stopped = resolveLocalSliceCanaryPlan({
      ...greenInput(),
      sliceAlreadyCompleted: true,
    });

    expect(green).toMatchObject({
      effect: "none",
      activation: "none",
      authorization: "none",
      singleSliceOnly: true,
      decision: "prepare-local-slice",
      canPrepareSlice: true,
      mustStopAfterSlice: true,
      summary: "local-slice-canary: decision=prepare-local-slice prepare=yes stop=yes reasons=readiness-green,single-slice-only authorization=none",
    });
    expect(protectedBlocked).toMatchObject({
      decision: "blocked",
      canPrepareSlice: false,
      mustStopAfterSlice: true,
      reasons: ["protected-scope"],
    });
    expect(repeatBlocked.reasons).toContain("repeat-requested");
    expect(repeatBlocked.summary).toContain("decision=blocked");
    expect(stopped).toMatchObject({
      decision: "stop-after-slice",
      canPrepareSlice: false,
      mustStopAfterSlice: true,
      reasons: ["slice-complete", "single-slice-limit"],
    });
  });

  it("prepares a local measured audit envelope from collected facts", () => {
    const nowMs = Date.parse("2026-04-30T04:40:00.000Z");
    const baseInput = {
      optIn: true,
      nowMs,
      candidate: {
        readStatus: "observed" as const,
        candidate: {
          taskId: "TASK-BUD-295",
          scope: "local" as const,
          estimatedFiles: 2,
          reversible: "git" as const,
          validationKind: "marker-check" as const,
          risk: "low" as const,
        },
      },
      checkpoint: {
        readStatus: "observed" as const,
        handoffTimestampIso: "2026-04-30T04:39:30.000Z",
        maxAgeMs: 60_000,
      },
      handoffBudget: {
        readStatus: "observed" as const,
        handoffJson: "x".repeat(1200),
        maxJsonChars: 2700,
      },
      gitState: {
        readStatus: "observed" as const,
        changedPaths: ["packages/pi-stack/extensions/foo.ts"],
        expectedPaths: ["packages/pi-stack/extensions/foo.ts"],
      },
      protectedScopes: {
        readStatus: "observed" as const,
        paths: ["packages/pi-stack/extensions/foo.ts"],
      },
      cooldown: {
        readStatus: "observed" as const,
        lastRunAtIso: "2026-04-30T04:38:30.000Z",
        cooldownMs: 60_000,
      },
      validation: {
        readStatus: "observed" as const,
        kind: "marker-check" as const,
      },
      stopConditions: {
        readStatus: "observed" as const,
        conditions: [{ kind: "blocker" as const, present: false, evidence: "blocker=none" }],
      },
    };
    const eligible = buildLocalMeasuredNudgeFreeLoopAuditEnvelopeFromCollectedFacts(baseInput);
    const blocked = buildLocalMeasuredNudgeFreeLoopAuditEnvelopeFromCollectedFacts({
      ...baseInput,
      candidate: {
        readStatus: "observed" as const,
        candidate: {
          taskId: "TASK-RISK",
          scope: "local" as const,
          estimatedFiles: 2,
          reversible: "git" as const,
          validationKind: "unknown" as const,
          risk: "low" as const,
          protectedPaths: [".github/workflows/ci.yml"],
        },
      },
      gitState: {
        readStatus: "observed" as const,
        changedPaths: ["packages/pi-stack/extensions/foo.ts", ".pi/settings.json"],
        expectedPaths: ["packages/pi-stack/extensions/foo.ts"],
      },
      protectedScopes: {
        readStatus: "observed" as const,
        paths: ["packages/pi-stack/extensions/foo.ts", ".github/workflows/ci.yml"],
      },
      validation: {
        readStatus: "observed" as const,
        kind: "unknown" as const,
      },
    });

    expect(eligible).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      authorization: "none",
      summary: "nudge-free-local-audit-prep: eligible=yes collectors=8/8 packet=ready authorization=none",
      envelope: {
        eligibleForAuditedRuntimeSurface: true,
        summary: "nudge-free-audit-envelope: eligible=yes packet=ready collectors=yes trust=yes authorization=none",
      },
    });
    expect(eligible.collectorResults.map((result) => result.status)).toEqual([
      "observed",
      "observed",
      "observed",
      "observed",
      "observed",
      "observed",
      "observed",
      "observed",
    ]);
    expect(blocked).toMatchObject({
      authorization: "none",
      summary: "nudge-free-local-audit-prep: eligible=no collectors=8/8 packet=blocked authorization=none",
      envelope: {
        eligibleForAuditedRuntimeSurface: false,
        reasons: ["collectors-not-eligible", "packet-not-ready", "trust-not-eligible"],
      },
    });
    expect(blocked.collectorResults.filter((result) => result.status === "invalid").map((result) => result.fact))
      .toEqual(["candidate", "git-state", "protected-scopes", "validation"]);
  });

  it("derives candidate collector results from local read outcomes", () => {
    const localSafe = resolveNextLocalSafeCollectorResult({
      readStatus: "observed",
      candidate: {
        taskId: "TASK-BUD-294",
        scope: "local",
        estimatedFiles: 2,
        reversible: "git",
        validationKind: "marker-check",
        risk: "low",
      },
    });
    const missingTask = resolveNextLocalSafeCollectorResult({
      readStatus: "observed",
      candidate: {
        scope: "local",
        estimatedFiles: 2,
        reversible: "git",
        validationKind: "marker-check",
        risk: "low",
      },
    });
    const protectedScope = resolveNextLocalSafeCollectorResult({
      readStatus: "observed",
      candidate: {
        taskId: "TASK-PROTECTED",
        scope: "protected",
        estimatedFiles: 2,
        reversible: "git",
        validationKind: "marker-check",
        risk: "low",
      },
    });
    const protectedPath = resolveNextLocalSafeCollectorResult({
      readStatus: "observed",
      candidate: {
        taskId: "TASK-PATH",
        scope: "local",
        estimatedFiles: 2,
        reversible: "git",
        validationKind: "marker-check",
        risk: "low",
        protectedPaths: [".github/workflows/ci.yml"],
      },
    });
    const missing = resolveNextLocalSafeCollectorResult({ readStatus: "missing" });
    const readError = resolveNextLocalSafeCollectorResult({ readStatus: "error" });
    const missingCandidate = resolveNextLocalSafeCollectorResult({ readStatus: "observed" });

    expect(localSafe).toEqual({ fact: "candidate", status: "observed", evidence: "next-local-safe=yes task=TASK-BUD-294 files=2" });
    expect(missingTask).toEqual({ fact: "candidate", status: "invalid", evidence: "next-local-safe=no reasons=missing-task" });
    expect(protectedScope).toEqual({ fact: "candidate", status: "invalid", evidence: "next-local-safe=no reasons=scope-protected" });
    expect(protectedPath).toEqual({ fact: "candidate", status: "invalid", evidence: "next-local-safe=no reasons=protected-paths-1" });
    expect(missing).toEqual({ fact: "candidate", status: "missing", evidence: "candidate=missing" });
    expect(readError).toEqual({ fact: "candidate", status: "invalid", evidence: "candidate=read-error" });
    expect(missingCandidate).toEqual({ fact: "candidate", status: "invalid", evidence: "candidate=missing-candidate" });
  });

  it("derives cooldown collector results from local read outcomes", () => {
    const nowMs = Date.parse("2026-04-30T04:30:00.000Z");
    const previousNone = resolveCooldownReadyCollectorResult({
      readStatus: "observed",
      nowMs,
      cooldownMs: 60_000,
    });
    const elapsedReady = resolveCooldownReadyCollectorResult({
      readStatus: "observed",
      lastRunAtIso: "2026-04-30T04:28:30.000Z",
      nowMs,
      cooldownMs: 60_000,
    });
    const wait = resolveCooldownReadyCollectorResult({
      readStatus: "observed",
      lastRunAtIso: "2026-04-30T04:29:30.000Z",
      nowMs,
      cooldownMs: 60_000,
    });
    const missing = resolveCooldownReadyCollectorResult({
      readStatus: "missing",
      nowMs,
      cooldownMs: 60_000,
    });
    const readError = resolveCooldownReadyCollectorResult({
      readStatus: "error",
      nowMs,
      cooldownMs: 60_000,
    });
    const invalidTimestamp = resolveCooldownReadyCollectorResult({
      readStatus: "observed",
      lastRunAtIso: "not-a-date",
      nowMs,
      cooldownMs: 60_000,
    });
    const futureTimestamp = resolveCooldownReadyCollectorResult({
      readStatus: "observed",
      lastRunAtIso: "2026-04-30T04:30:30.000Z",
      nowMs,
      cooldownMs: 60_000,
    });
    const invalidCooldown = resolveCooldownReadyCollectorResult({
      readStatus: "observed",
      nowMs,
      cooldownMs: -1,
    });

    expect(previousNone).toEqual({ fact: "cooldown", status: "observed", evidence: "cooldown=ready previous=none maxSec=60" });
    expect(elapsedReady).toEqual({ fact: "cooldown", status: "observed", evidence: "cooldown=ready elapsedSec=90 maxSec=60" });
    expect(wait).toEqual({ fact: "cooldown", status: "invalid", evidence: "cooldown=wait remainingSec=30 elapsedSec=30" });
    expect(missing).toEqual({ fact: "cooldown", status: "missing", evidence: "cooldown=missing" });
    expect(readError).toEqual({ fact: "cooldown", status: "invalid", evidence: "cooldown=read-error" });
    expect(invalidTimestamp).toEqual({ fact: "cooldown", status: "invalid", evidence: "cooldown=invalid-ts" });
    expect(futureTimestamp).toEqual({ fact: "cooldown", status: "invalid", evidence: "cooldown=future-ts" });
    expect(invalidCooldown).toEqual({ fact: "cooldown", status: "invalid", evidence: "cooldown=invalid-max" });
  });

  it("derives stop-conditions collector results from local read outcomes", () => {
    const clear = resolveStopConditionsClearCollectorResult({
      readStatus: "observed",
      conditions: [
        { kind: "risk", present: false, evidence: "risk=none" },
        { kind: "blocker", present: false, evidence: "blocker=none" },
      ],
    });
    const present = resolveStopConditionsClearCollectorResult({
      readStatus: "observed",
      conditions: [
        { kind: "risk", present: true, evidence: "risk=high" },
        { kind: "protected-scope", present: true, evidence: "protected=.github" },
      ],
    });
    const missing = resolveStopConditionsClearCollectorResult({
      readStatus: "missing",
    });
    const readError = resolveStopConditionsClearCollectorResult({
      readStatus: "error",
    });
    const missingConditions = resolveStopConditionsClearCollectorResult({
      readStatus: "observed",
    });

    expect(clear).toEqual({ fact: "stop-conditions", status: "observed", evidence: "stops=clear checked=2" });
    expect(present).toEqual({ fact: "stop-conditions", status: "invalid", evidence: "stops=present count=2 first=risk|protected-scope" });
    expect(missing).toEqual({ fact: "stop-conditions", status: "missing", evidence: "stops=missing" });
    expect(readError).toEqual({ fact: "stop-conditions", status: "invalid", evidence: "stops=read-error" });
    expect(missingConditions).toEqual({ fact: "stop-conditions", status: "invalid", evidence: "stops=missing-conditions" });
  });

  it("derives validation collector results from local read outcomes", () => {
    const markerCheck = resolveValidationKnownCollectorResult({
      readStatus: "observed",
      kind: "marker-check",
    });
    const structuredRead = resolveValidationKnownCollectorResult({
      readStatus: "observed",
      kind: "structured-read",
    });
    const focalTest = resolveValidationKnownCollectorResult({
      readStatus: "observed",
      kind: "focal-test",
      focalGate: "npm-run-smoke",
    });
    const missingFocalGate = resolveValidationKnownCollectorResult({
      readStatus: "observed",
      kind: "focal-test",
    });
    const unknown = resolveValidationKnownCollectorResult({
      readStatus: "observed",
      kind: "unknown",
    });
    const missing = resolveValidationKnownCollectorResult({
      readStatus: "missing",
    });
    const readError = resolveValidationKnownCollectorResult({
      readStatus: "error",
    });
    const missingKind = resolveValidationKnownCollectorResult({
      readStatus: "observed",
    });

    expect(markerCheck).toEqual({ fact: "validation", status: "observed", evidence: "validation=marker-check" });
    expect(structuredRead).toEqual({ fact: "validation", status: "observed", evidence: "validation=structured-read" });
    expect(focalTest).toEqual({ fact: "validation", status: "observed", evidence: "validation=focal-test gate=npm-run-smoke" });
    expect(missingFocalGate).toEqual({ fact: "validation", status: "invalid", evidence: "validation=focal-test gate=missing" });
    expect(unknown).toEqual({ fact: "validation", status: "invalid", evidence: "validation=unknown" });
    expect(missing).toEqual({ fact: "validation", status: "missing", evidence: "validation=missing" });
    expect(readError).toEqual({ fact: "validation", status: "invalid", evidence: "validation=read-error" });
    expect(missingKind).toEqual({ fact: "validation", status: "invalid", evidence: "validation=missing-kind" });
  });

  it("derives protected-scopes collector results from local read outcomes", () => {
    const clear = resolveProtectedScopesCollectorResult({
      readStatus: "observed",
      paths: ["packages/pi-stack/extensions/foo.ts", "packages/pi-stack/test/foo.test.ts"],
    });
    const pending = resolveProtectedScopesCollectorResult({
      readStatus: "observed",
      paths: ["packages/pi-stack/extensions/foo.ts", ".github/workflows/ci.yml", ".pi/settings.json"],
    });
    const missing = resolveProtectedScopesCollectorResult({
      readStatus: "missing",
    });
    const readError = resolveProtectedScopesCollectorResult({
      readStatus: "error",
    });
    const missingPaths = resolveProtectedScopesCollectorResult({
      readStatus: "observed",
    });

    expect(clear).toEqual({ fact: "protected-scopes", status: "observed", evidence: "protected=clear paths=2" });
    expect(pending).toEqual({ fact: "protected-scopes", status: "invalid", evidence: "protected=pending count=2 first=.github/workflows/ci.yml|.pi/settings.json" });
    expect(missing).toEqual({ fact: "protected-scopes", status: "missing", evidence: "protected=missing" });
    expect(readError).toEqual({ fact: "protected-scopes", status: "invalid", evidence: "protected=read-error" });
    expect(missingPaths).toEqual({ fact: "protected-scopes", status: "invalid", evidence: "protected=missing-paths" });
  });

  it("derives git-state collector results from local read outcomes", () => {
    const clean = resolveGitStateExpectedCollectorResult({
      readStatus: "observed",
      changedPaths: [],
      expectedPaths: ["packages/pi-stack/extensions/foo.ts"],
    });
    const expected = resolveGitStateExpectedCollectorResult({
      readStatus: "observed",
      changedPaths: ["packages/pi-stack/extensions/foo.ts", "packages/pi-stack/test/foo.test.ts"],
      expectedPaths: ["packages/pi-stack/extensions/foo.ts", "packages/pi-stack/test/foo.test.ts"],
    });
    const unexpected = resolveGitStateExpectedCollectorResult({
      readStatus: "observed",
      changedPaths: ["packages/pi-stack/extensions/foo.ts", ".pi/settings.json"],
      expectedPaths: ["packages/pi-stack/extensions/foo.ts"],
    });
    const missing = resolveGitStateExpectedCollectorResult({
      readStatus: "missing",
      expectedPaths: ["packages/pi-stack/extensions/foo.ts"],
    });
    const readError = resolveGitStateExpectedCollectorResult({
      readStatus: "error",
      expectedPaths: ["packages/pi-stack/extensions/foo.ts"],
    });
    const missingChanges = resolveGitStateExpectedCollectorResult({
      readStatus: "observed",
      expectedPaths: ["packages/pi-stack/extensions/foo.ts"],
    });

    expect(clean).toEqual({ fact: "git-state", status: "observed", evidence: "git=clean changed=0" });
    expect(expected).toEqual({ fact: "git-state", status: "observed", evidence: "git=expected changed=2" });
    expect(unexpected).toEqual({ fact: "git-state", status: "invalid", evidence: "git=unexpected count=1 first=.pi/settings.json" });
    expect(missing).toEqual({ fact: "git-state", status: "missing", evidence: "git=missing" });
    expect(readError).toEqual({ fact: "git-state", status: "invalid", evidence: "git=read-error" });
    expect(missingChanges).toEqual({ fact: "git-state", status: "invalid", evidence: "git=missing-changes" });
  });

  it("derives checkpoint collector results from local read outcomes", () => {
    const nowMs = Date.parse("2026-04-30T04:00:00.000Z");
    const fresh = resolveCheckpointFreshCollectorResult({
      readStatus: "observed",
      handoffTimestampIso: "2026-04-30T03:59:30.000Z",
      nowMs,
      maxAgeMs: 60_000,
    });
    const stale = resolveCheckpointFreshCollectorResult({
      readStatus: "observed",
      handoffTimestampIso: "2026-04-30T03:58:00.000Z",
      nowMs,
      maxAgeMs: 60_000,
    });
    const missingRead = resolveCheckpointFreshCollectorResult({
      readStatus: "missing",
      nowMs,
      maxAgeMs: 60_000,
    });
    const readError = resolveCheckpointFreshCollectorResult({
      readStatus: "error",
      nowMs,
      maxAgeMs: 60_000,
    });
    const missingTimestamp = resolveCheckpointFreshCollectorResult({
      readStatus: "observed",
      nowMs,
      maxAgeMs: 60_000,
    });
    const invalidTimestamp = resolveCheckpointFreshCollectorResult({
      readStatus: "observed",
      handoffTimestampIso: "not-a-date",
      nowMs,
      maxAgeMs: 60_000,
    });
    const futureTimestamp = resolveCheckpointFreshCollectorResult({
      readStatus: "observed",
      handoffTimestampIso: "2026-04-30T04:00:30.000Z",
      nowMs,
      maxAgeMs: 60_000,
    });

    expect(fresh).toEqual({ fact: "checkpoint", status: "observed", evidence: "checkpoint=fresh ageSec=30 maxSec=60" });
    expect(stale).toEqual({ fact: "checkpoint", status: "invalid", evidence: "checkpoint=stale ageSec=120 maxSec=60" });
    expect(missingRead).toEqual({ fact: "checkpoint", status: "missing", evidence: "checkpoint=missing" });
    expect(readError).toEqual({ fact: "checkpoint", status: "invalid", evidence: "checkpoint=read-error" });
    expect(missingTimestamp).toEqual({ fact: "checkpoint", status: "invalid", evidence: "checkpoint=missing" });
    expect(invalidTimestamp).toEqual({ fact: "checkpoint", status: "invalid", evidence: "checkpoint=invalid-ts" });
    expect(futureTimestamp).toEqual({ fact: "checkpoint", status: "invalid", evidence: "checkpoint=future-ts" });
  });

  it("derives handoff-budget collector results from local read outcomes", () => {
    const observed = resolveHandoffBudgetCollectorResult({
      readStatus: "observed",
      handoffJson: "x".repeat(1200),
      maxJsonChars: 2700,
    });
    const over = resolveHandoffBudgetCollectorResult({
      readStatus: "observed",
      handoffJson: "x".repeat(2701),
      maxJsonChars: 2700,
    });
    const missing = resolveHandoffBudgetCollectorResult({
      readStatus: "missing",
      maxJsonChars: 2700,
    });
    const readError = resolveHandoffBudgetCollectorResult({
      readStatus: "error",
      maxJsonChars: 2700,
    });
    const invalidMax = resolveHandoffBudgetCollectorResult({
      readStatus: "observed",
      handoffJson: "{}",
      maxJsonChars: 0,
    });

    expect(observed).toEqual({ fact: "handoff-budget", status: "observed", evidence: "handoff-budget=ok chars=1200 max=2700" });
    expect(over).toEqual({ fact: "handoff-budget", status: "invalid", evidence: "handoff-budget=over chars=2701 max=2700" });
    expect(missing).toEqual({ fact: "handoff-budget", status: "missing", evidence: "handoff-budget=missing" });
    expect(readError).toEqual({ fact: "handoff-budget", status: "invalid", evidence: "handoff-budget=read-error" });
    expect(invalidMax).toEqual({ fact: "handoff-budget", status: "invalid", evidence: "handoff-budget=invalid-max" });
  });

  it("classifies local collector results before measured packet use", () => {
    const observedResults = [
      { fact: "candidate", status: "observed", evidence: "candidate=board-task" },
      { fact: "checkpoint", status: "observed", evidence: "checkpoint=fresh" },
      { fact: "handoff-budget", status: "observed", evidence: "handoff-budget=ok" },
      { fact: "git-state", status: "observed", evidence: "git=expected" },
      { fact: "protected-scopes", status: "observed", evidence: "protected=clear" },
      { fact: "cooldown", status: "observed", evidence: "cooldown=ready" },
      { fact: "validation", status: "observed", evidence: "validation=known" },
      { fact: "stop-conditions", status: "observed", evidence: "stops=clear" },
    ] as const;
    const allObserved = resolveMeasuredFactCollectorAssessment({ results: [...observedResults] });
    const unsafe = resolveMeasuredFactCollectorAssessment({
      results: [
        ...observedResults.slice(0, 5),
        { fact: "cooldown", status: "missing", evidence: "" },
        { fact: "validation", status: "untrusted", evidence: "validation=known", source: "caller-supplied" },
        { fact: "stop-conditions", status: "invalid", evidence: "stops=clear" },
      ],
    });
    const overlong = resolveMeasuredFactCollectorAssessment({
      results: [
        ...observedResults.slice(0, 7),
        { fact: "stop-conditions", status: "observed", evidence: "x".repeat(NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS + 1) },
      ],
    });

    expect(allObserved).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      authorization: "none",
      factSource: "local-observed",
      localObservedCount: 8,
      eligibleForMeasuredPacket: true,
      collectorMissingFacts: [],
      collectorUntrustedFacts: [],
      collectorInvalidFacts: [],
      reasons: ["all-collectors-local-observed"],
      summary: "nudge-free-fact-collectors: eligible=yes source=local-observed local=8/8 reasons=all-collectors-local-observed",
    });
    expect(unsafe).toMatchObject({
      authorization: "none",
      factSource: "mixed",
      eligibleForMeasuredPacket: false,
      collectorMissingFacts: ["cooldown"],
      collectorUntrustedFacts: ["validation"],
      collectorInvalidFacts: ["stop-conditions"],
      reasons: expect.arrayContaining([
        "missing-local-facts",
        "untrusted-fact-source",
        "fact-evidence-invalid",
        "collector-missing",
        "collector-untrusted",
        "collector-invalid",
      ]),
    });
    expect(overlong).toMatchObject({
      authorization: "none",
      eligibleForMeasuredPacket: false,
      invalidEvidenceFacts: ["stop-conditions"],
      reasons: ["fact-evidence-invalid"],
    });
  });

  it("builds a local measured audit envelope from collectors, packet, and trust", () => {
    const nowMs = Date.parse("2026-04-30T02:00:00.000Z");
    const packetInput = {
      optIn: true,
      nowMs,
      candidate: {
        taskId: "TASK-BUD-283",
        scope: "local" as const,
        estimatedFiles: 1,
        reversible: "git" as const,
        validationKind: "marker-check" as const,
        risk: "none" as const,
      },
      handoffTimestampIso: "2026-04-30T01:59:30.000Z",
      maxCheckpointAgeMs: 60_000,
      handoffJsonChars: 1200,
      maxHandoffJsonChars: 2700,
      changedPaths: ["packages/pi-stack/extensions/foo.ts"],
      expectedPaths: ["packages/pi-stack/extensions/foo.ts"],
      cooldownMs: 60_000,
      validation: { kind: "marker-check" as const },
      stopConditions: [],
    };
    const collectorResults = [
      { fact: "candidate", status: "observed", evidence: "candidate=board-task" },
      { fact: "checkpoint", status: "observed", evidence: "checkpoint=fresh" },
      { fact: "handoff-budget", status: "observed", evidence: "handoff-budget=ok" },
      { fact: "git-state", status: "observed", evidence: "git=expected" },
      { fact: "protected-scopes", status: "observed", evidence: "protected=clear" },
      { fact: "cooldown", status: "observed", evidence: "cooldown=ready" },
      { fact: "validation", status: "observed", evidence: "validation=known" },
      { fact: "stop-conditions", status: "observed", evidence: "stops=clear" },
    ] as const;
    const eligible = buildLocalMeasuredNudgeFreeLoopAuditEnvelope({
      packetInput,
      collectorResults: [...collectorResults],
    });
    const untrusted = buildLocalMeasuredNudgeFreeLoopAuditEnvelope({
      packetInput,
      collectorResults: [
        ...collectorResults.slice(0, 7),
        { fact: "stop-conditions", status: "untrusted", evidence: "stops=clear", source: "caller-supplied" },
      ],
    });
    const blocked = buildLocalMeasuredNudgeFreeLoopAuditEnvelope({
      packetInput: {
        ...packetInput,
        candidate: {
          taskId: "TASK-RISK",
          scope: "local" as const,
          estimatedFiles: 1,
          reversible: "git" as const,
          validationKind: "marker-check" as const,
          risk: "none" as const,
          protectedPaths: [".github/workflows/ci.yml"],
        },
        changedPaths: [".github/workflows/ci.yml"],
        expectedPaths: ["packages/pi-stack/extensions/foo.ts"],
        stopConditions: [{ kind: "protected-scope" as const, present: true, evidence: "protected=.github" }],
      },
      collectorResults: [...collectorResults],
    });

    expect(eligible).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      authorization: "none",
      eligibleForAuditedRuntimeSurface: true,
      reasons: ["audit-envelope-eligible"],
      summary: "nudge-free-audit-envelope: eligible=yes packet=ready collectors=yes trust=yes authorization=none",
    });
    expect(untrusted).toMatchObject({
      authorization: "none",
      eligibleForAuditedRuntimeSurface: false,
      reasons: ["collectors-not-eligible", "trust-not-eligible"],
      summary: "nudge-free-audit-envelope: eligible=no packet=ready collectors=no trust=no authorization=none",
    });
    expect(blocked).toMatchObject({
      authorization: "none",
      eligibleForAuditedRuntimeSurface: false,
      reasons: ["packet-not-ready", "trust-not-eligible"],
      summary: "nudge-free-audit-envelope: eligible=no packet=blocked collectors=yes trust=no authorization=none",
    });
  });

  it("continues when the next slice is local-safe and progress is saved", () => {
    const plan = resolveUnattendedContinuationPlan({
      nextLocalSafe: true,
      protectedScope: false,
      risk: false,
      ambiguous: false,
      progressSaved: true,
      contextLevel: "checkpoint",
    });

    expect(plan).toMatchObject({
      decision: "continue-local",
      canContinue: true,
      reasons: ["local-safe-next-step", "checkpoint-progress-saved"],
      summary: "unattended-continuation: decision=continue-local continue=yes reasons=local-safe-next-step,checkpoint-progress-saved",
    });
  });

  it("asks for decision when focus is complete but the next step is ambiguous", () => {
    const plan = resolveUnattendedContinuationPlan({
      nextLocalSafe: false,
      protectedScope: false,
      risk: false,
      ambiguous: true,
      progressSaved: true,
      contextLevel: "ok",
    });

    expect(plan).toMatchObject({
      decision: "ask-decision",
      canContinue: false,
      reasons: ["ambiguous-next-step", "no-local-safe-next-step"],
    });
  });

  it("blocks protected scopes and real risk", () => {
    const plan = resolveUnattendedContinuationPlan({
      nextLocalSafe: true,
      protectedScope: true,
      risk: true,
      ambiguous: false,
      progressSaved: true,
      contextLevel: "ok",
    });

    expect(plan).toMatchObject({
      decision: "blocked",
      canContinue: false,
      reasons: ["risk", "protected-scope"],
    });
  });

  it("does not start new work in compact lane", () => {
    const saved = resolveUnattendedContinuationPlan({
      nextLocalSafe: true,
      protectedScope: false,
      risk: false,
      ambiguous: false,
      progressSaved: true,
      contextLevel: "compact",
    });
    const unsaved = resolveUnattendedContinuationPlan({
      nextLocalSafe: true,
      protectedScope: false,
      risk: false,
      ambiguous: false,
      progressSaved: false,
      contextLevel: "compact",
    });

    expect(saved.decision).toBe("pause-for-compact");
    expect(unsaved.decision).toBe("checkpoint");
  });
});
