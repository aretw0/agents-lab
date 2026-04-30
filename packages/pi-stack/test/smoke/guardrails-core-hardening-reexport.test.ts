import { describe, expect, it } from "vitest";
import {
  buildLocalMeasuredNudgeFreeLoopAuditEnvelope,
  buildLocalMeasuredNudgeFreeLoopCanaryPacket,
  commandSensitiveShellMarkerCheckReason,
  detectShellInlineCommandSensitiveMarkerCheck,
  evaluateGitMaintenanceSignal,
  evaluateTextMarkerCheck,
  resolveCheckpointFreshCollectorResult,
  resolveCooldownReadyCollectorResult,
  resolveGitStateExpectedCollectorResult,
  resolveHandoffBudgetCollectorResult,
  resolveLocalMeasuredNudgeFreeLoopCanaryGate,
  resolveLocalNudgeFreeLoopMeasuredSignals,
  resolveMeasuredFactCollectorAssessment,
  resolveMeasuredFactSourceAssessment,
  resolveMeasuredNudgeFreeLoopCanaryGate,
  resolveMeasuredPacketTrust,
  resolveNextLocalSafeCollectorResult,
  resolveProtectedScopesCollectorResult,
  resolveStopConditionsClearCollectorResult,
  resolveRecurringFailureHardening,
  resolveValidationKnownCollectorResult,
  resolveValidationMethodPlan,
} from "../../extensions/guardrails-core";

describe("guardrails-core hardening re-exports", () => {
  it("exposes operational hardening helpers through guardrails-core", () => {
    expect(evaluateTextMarkerCheck({
      text: "Manutenção Git",
      markers: ["manutencao git"],
      normalizeAccents: true,
      caseSensitive: false,
    }).summary).toBe("marker-check: ok=yes matched=1/1 missing=none commandSensitive=none");

    expect(detectShellInlineCommandSensitiveMarkerCheck("cmd.exe /c node -e \"const markers=['line\nline'];\"")).toBe(true);
    expect(detectShellInlineCommandSensitiveMarkerCheck("cmd.exe /c node -e \"console.log('line\nline');\"")).toBe(false);
    expect(commandSensitiveShellMarkerCheckReason()).toContain("Use safe_marker_check");

    expect(evaluateGitMaintenanceSignal({
      looseObjectCount: 6089,
      looseSizeMiB: 10.14,
      garbageCount: 0,
      gcLogPresent: true,
    })).toMatchObject({
      severity: "warning",
      action: "monitor",
      cleanupAllowedAutomatically: false,
    });

    expect(resolveRecurringFailureHardening({
      occurrenceCount: 2,
      hasDocumentedRule: true,
      hasPrimitive: false,
      hasRegressionTest: false,
    })).toMatchObject({
      decision: "create-primitive",
      hardIntentRequired: true,
    });

    expect(resolveValidationMethodPlan({
      kind: "marker-check",
      shellInlineRequested: true,
      commandSensitiveMarkers: true,
      safeMarkerToolAvailable: true,
    })).toMatchObject({
      decision: "use-safe-marker-check",
      canValidate: true,
    });

    expect(resolveMeasuredNudgeFreeLoopCanaryGate({
      optIn: true,
      signals: {
        "next-local-safe": { ok: true, evidence: "selector=local-safe" },
        "checkpoint-fresh": { ok: true, evidence: "handoff=fresh" },
        "handoff-budget-ok": { ok: true, evidence: "handoff-budget=ok" },
        "git-state-expected": { ok: true, evidence: "git=expected" },
        "protected-scopes-clear": { ok: true, evidence: "protected=clear" },
        "cooldown-ready": { ok: true, evidence: "cooldown=ready" },
        "validation-known": { ok: true, evidence: "validation=known" },
        "stop-conditions-clear": { ok: true, evidence: "stops=clear" },
      },
    })).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      decision: "ready",
      canContinueWithoutNudge: true,
    });

    const localFacts = {
      optIn: true,
      nowMs: Date.parse("2026-04-30T02:00:00.000Z"),
      candidate: {
        taskId: "TASK-BUD-275",
        scope: "local" as const,
        estimatedFiles: 2,
        reversible: "git" as const,
        validationKind: "focal-test" as const,
        risk: "low" as const,
      },
      handoffTimestampIso: "2026-04-30T01:59:30.000Z",
      maxCheckpointAgeMs: 60_000,
      handoffJsonChars: 1200,
      maxHandoffJsonChars: 2700,
      changedPaths: ["packages/pi-stack/extensions/guardrails-core-exports.ts"],
      expectedPaths: ["packages/pi-stack/extensions/guardrails-core-exports.ts"],
      cooldownMs: 60_000,
      validation: { kind: "focal-test" as const, focalGate: "hardening-reexport" },
      stopConditions: [],
    };

    expect(resolveLocalMeasuredNudgeFreeLoopCanaryGate(localFacts)).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "measured",
      decision: "ready",
      canContinueWithoutNudge: true,
    });

    expect(resolveLocalNudgeFreeLoopMeasuredSignals(localFacts)["git-state-expected"])
      .toEqual({ ok: true, evidence: "git=expected changed=1" });

    const packet = buildLocalMeasuredNudgeFreeLoopCanaryPacket(localFacts);
    expect(packet).toMatchObject({
      summary: "nudge-free-loop-packet: decision=ready continue=yes evidence=8/8",
      gate: {
        effect: "none",
        mode: "advisory",
        activation: "none",
        signalSource: "measured",
        decision: "ready",
        canContinueWithoutNudge: true,
      },
    });

    expect(resolveMeasuredPacketTrust({ packet, factSource: "caller-supplied" })).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      authorization: "none",
      factSource: "caller-supplied",
      eligibleForAuditedRuntimeSurface: false,
      reasons: ["untrusted-fact-source"],
    });

    expect(resolveMeasuredFactSourceAssessment({
      facts: [
        { fact: "candidate", source: "local-observed", evidence: "candidate=board-task" },
        { fact: "checkpoint", source: "caller-supplied", evidence: "checkpoint=fresh" },
      ],
    })).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      authorization: "none",
      factSource: "mixed",
      eligibleForMeasuredPacket: false,
      reasons: ["missing-local-facts", "untrusted-fact-source"],
    });

    expect(resolveMeasuredFactCollectorAssessment({
      results: [
        { fact: "candidate", status: "observed", evidence: "candidate=board-task" },
        { fact: "checkpoint", status: "missing", evidence: "" },
        { fact: "handoff-budget", status: "untrusted", evidence: "handoff-budget=ok", source: "caller-supplied" },
        { fact: "git-state", status: "invalid", evidence: "git=expected" },
      ],
    })).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      authorization: "none",
      factSource: "mixed",
      eligibleForMeasuredPacket: false,
      collectorMissingFacts: ["checkpoint"],
      collectorUntrustedFacts: ["handoff-budget"],
      collectorInvalidFacts: ["git-state"],
      reasons: expect.arrayContaining([
        "missing-local-facts",
        "untrusted-fact-source",
        "fact-evidence-invalid",
        "collector-missing",
        "collector-untrusted",
        "collector-invalid",
      ]),
    });

    expect(buildLocalMeasuredNudgeFreeLoopAuditEnvelope({
      packetInput: localFacts,
      collectorResults: [
        { fact: "candidate", status: "observed", evidence: "candidate=board-task" },
        { fact: "checkpoint", status: "observed", evidence: "checkpoint=fresh" },
        { fact: "handoff-budget", status: "observed", evidence: "handoff-budget=ok" },
        { fact: "git-state", status: "observed", evidence: "git=expected" },
        { fact: "protected-scopes", status: "observed", evidence: "protected=clear" },
        { fact: "cooldown", status: "observed", evidence: "cooldown=ready" },
        { fact: "validation", status: "observed", evidence: "validation=known" },
        { fact: "stop-conditions", status: "untrusted", evidence: "stops=clear", source: "caller-supplied" },
      ],
    })).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      authorization: "none",
      eligibleForAuditedRuntimeSurface: false,
      reasons: ["collectors-not-eligible", "trust-not-eligible"],
      summary: "nudge-free-audit-envelope: eligible=no packet=ready collectors=no trust=no authorization=none",
    });

    expect(resolveHandoffBudgetCollectorResult({
      readStatus: "observed",
      handoffJson: "x".repeat(2701),
      maxJsonChars: 2700,
    })).toEqual({
      fact: "handoff-budget",
      status: "invalid",
      evidence: "handoff-budget=over chars=2701 max=2700",
    });
    expect(resolveHandoffBudgetCollectorResult({
      readStatus: "missing",
      maxJsonChars: 2700,
    })).toEqual({
      fact: "handoff-budget",
      status: "missing",
      evidence: "handoff-budget=missing",
    });
    expect(resolveCheckpointFreshCollectorResult({
      readStatus: "observed",
      handoffTimestampIso: "2026-04-30T03:59:30.000Z",
      nowMs: Date.parse("2026-04-30T04:00:00.000Z"),
      maxAgeMs: 60_000,
    })).toEqual({
      fact: "checkpoint",
      status: "observed",
      evidence: "checkpoint=fresh ageSec=30 maxSec=60",
    });
    expect(resolveCheckpointFreshCollectorResult({
      readStatus: "error",
      nowMs: Date.parse("2026-04-30T04:00:00.000Z"),
      maxAgeMs: 60_000,
    })).toEqual({
      fact: "checkpoint",
      status: "invalid",
      evidence: "checkpoint=read-error",
    });
    expect(resolveGitStateExpectedCollectorResult({
      readStatus: "observed",
      changedPaths: ["packages/pi-stack/extensions/foo.ts", ".pi/settings.json"],
      expectedPaths: ["packages/pi-stack/extensions/foo.ts"],
    })).toEqual({
      fact: "git-state",
      status: "invalid",
      evidence: "git=unexpected count=1 first=.pi/settings.json",
    });
    expect(resolveGitStateExpectedCollectorResult({
      readStatus: "observed",
      changedPaths: [],
      expectedPaths: ["packages/pi-stack/extensions/foo.ts"],
    })).toEqual({
      fact: "git-state",
      status: "observed",
      evidence: "git=clean changed=0",
    });
    expect(resolveProtectedScopesCollectorResult({
      readStatus: "observed",
      paths: ["packages/pi-stack/extensions/foo.ts", ".github/workflows/ci.yml"],
    })).toEqual({
      fact: "protected-scopes",
      status: "invalid",
      evidence: "protected=pending count=1 first=.github/workflows/ci.yml",
    });
    expect(resolveProtectedScopesCollectorResult({
      readStatus: "observed",
      paths: ["packages/pi-stack/extensions/foo.ts"],
    })).toEqual({
      fact: "protected-scopes",
      status: "observed",
      evidence: "protected=clear paths=1",
    });
    expect(resolveValidationKnownCollectorResult({
      readStatus: "observed",
      kind: "focal-test",
      focalGate: "npm-run-smoke",
    })).toEqual({
      fact: "validation",
      status: "observed",
      evidence: "validation=focal-test gate=npm-run-smoke",
    });
    expect(resolveValidationKnownCollectorResult({
      readStatus: "observed",
      kind: "unknown",
    })).toEqual({
      fact: "validation",
      status: "invalid",
      evidence: "validation=unknown",
    });
    expect(resolveStopConditionsClearCollectorResult({
      readStatus: "observed",
      conditions: [{ kind: "blocker", present: false, evidence: "blocker=none" }],
    })).toEqual({
      fact: "stop-conditions",
      status: "observed",
      evidence: "stops=clear checked=1",
    });
    expect(resolveStopConditionsClearCollectorResult({
      readStatus: "observed",
      conditions: [{ kind: "blocker", present: true, evidence: "blocker=yes" }],
    })).toEqual({
      fact: "stop-conditions",
      status: "invalid",
      evidence: "stops=present count=1 first=blocker",
    });
    expect(resolveCooldownReadyCollectorResult({
      readStatus: "observed",
      lastRunAtIso: "2026-04-30T04:28:30.000Z",
      nowMs: Date.parse("2026-04-30T04:30:00.000Z"),
      cooldownMs: 60_000,
    })).toEqual({
      fact: "cooldown",
      status: "observed",
      evidence: "cooldown=ready elapsedSec=90 maxSec=60",
    });
    expect(resolveCooldownReadyCollectorResult({
      readStatus: "observed",
      lastRunAtIso: "2026-04-30T04:29:30.000Z",
      nowMs: Date.parse("2026-04-30T04:30:00.000Z"),
      cooldownMs: 60_000,
    })).toEqual({
      fact: "cooldown",
      status: "invalid",
      evidence: "cooldown=wait remainingSec=30 elapsedSec=30",
    });
    expect(resolveNextLocalSafeCollectorResult({
      readStatus: "observed",
      candidate: {
        taskId: "TASK-BUD-294",
        scope: "local",
        estimatedFiles: 2,
        reversible: "git",
        validationKind: "marker-check",
        risk: "low",
      },
    })).toEqual({
      fact: "candidate",
      status: "observed",
      evidence: "next-local-safe=yes task=TASK-BUD-294 files=2",
    });
    expect(resolveNextLocalSafeCollectorResult({
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
    })).toEqual({
      fact: "candidate",
      status: "invalid",
      evidence: "next-local-safe=no reasons=protected-paths-1",
    });
  });
});
