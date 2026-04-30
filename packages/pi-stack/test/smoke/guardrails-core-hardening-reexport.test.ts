import { describe, expect, it } from "vitest";
import {
  commandSensitiveShellMarkerCheckReason,
  detectShellInlineCommandSensitiveMarkerCheck,
  evaluateGitMaintenanceSignal,
  evaluateTextMarkerCheck,
  resolveLocalMeasuredNudgeFreeLoopCanaryGate,
  resolveMeasuredNudgeFreeLoopCanaryGate,
  resolveRecurringFailureHardening,
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

    expect(resolveLocalMeasuredNudgeFreeLoopCanaryGate({
      optIn: true,
      nowMs: Date.parse("2026-04-30T02:00:00.000Z"),
      candidate: {
        taskId: "TASK-BUD-272",
        scope: "local",
        estimatedFiles: 2,
        reversible: "git",
        validationKind: "focal-test",
        risk: "low",
      },
      handoffTimestampIso: "2026-04-30T01:59:30.000Z",
      maxCheckpointAgeMs: 60_000,
      handoffJsonChars: 1200,
      maxHandoffJsonChars: 2700,
      changedPaths: ["packages/pi-stack/extensions/guardrails-core-exports.ts"],
      expectedPaths: ["packages/pi-stack/extensions/guardrails-core-exports.ts"],
      cooldownMs: 60_000,
      validation: { kind: "focal-test", focalGate: "hardening-reexport" },
      stopConditions: [],
    })).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "measured",
      decision: "ready",
      canContinueWithoutNudge: true,
    });
  });
});
