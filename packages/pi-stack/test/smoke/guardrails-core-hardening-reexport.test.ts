import { describe, expect, it } from "vitest";
import {
  commandSensitiveShellMarkerCheckReason,
  detectShellInlineCommandSensitiveMarkerCheck,
  evaluateGitMaintenanceSignal,
  evaluateTextMarkerCheck,
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
  });
});
