import { describe, expect, it } from "vitest";
import { resolveHumanConfirmationAuditPlan } from "../../extensions/guardrails-core-human-confirmation";

describe("human confirmation audit plan", () => {
  it("classifies observed TUI confirmation without monitor-visible evidence as an audit gap", () => {
    const result = resolveHumanConfirmationAuditPlan({
      actionKind: "destructive",
      uiConfirmationObserved: true,
      toolCallEvidence: false,
      customMessageEvidence: false,
      auditEntryEvidence: false,
    });

    expect(result.decision).toBe("audit-gap");
    expect(result.layer).toBe("upstream-pi-tui-to-monitor-gap");
    expect(result.reasons).toEqual([
      "ui-confirmation-not-propagated",
      "fail-closed-without-auditable-evidence",
    ]);
    expect(result.dispatchAllowed).toBe(false);
    expect(result.canOverrideMonitorBlock).toBe(false);
    expect(result.authorization).toBe("none");
  });

  it("blocks spoofable confirmation evidence from authorizing destructive actions", () => {
    const result = resolveHumanConfirmationAuditPlan({
      actionKind: "destructive",
      customMessageEvidence: true,
      trustedOrigin: false,
      confirmationMatchesAction: true,
    });

    expect(result.decision).toBe("blocked");
    expect(result.evidenceOrigins).toEqual(["custom-message"]);
    expect(result.reasons).toContain("confirmation-origin-untrusted");
    expect(result.reasons).toContain("manual-or-spoofable-evidence-cannot-authorize");
    expect(result.dispatchAllowed).toBe(false);
  });

  it("recognizes trusted exact-match confirmation as auditable evidence but not permission", () => {
    const result = resolveHumanConfirmationAuditPlan({
      actionKind: "destructive",
      toolCallEvidence: true,
      auditEntryEvidence: true,
      trustedOrigin: true,
      confirmationMatchesAction: true,
    });

    expect(result.decision).toBe("auditable");
    expect(result.layer).toBe("auditable-path");
    expect(result.evidenceOrigins).toEqual(["tool-call", "audit-entry"]);
    expect(result.reasons).toEqual([
      "trusted-confirmation-evidence-present",
      "confirmation-matches-action",
    ]);
    expect(result.dispatchAllowed).toBe(false);
    expect(result.canOverrideMonitorBlock).toBe(false);
    expect(result.authorization).toBe("none");
  });

  it("does not require confirmation for local-safe actions", () => {
    const result = resolveHumanConfirmationAuditPlan({ actionKind: "local-safe" });

    expect(result.decision).toBe("not-required");
    expect(result.layer).toBe("not-required");
    expect(result.reasons).toEqual(["confirmation-not-required-for-local-safe-action"]);
  });
});
