import { describe, expect, it } from "vitest";
import {
  buildTrustedHumanConfirmationAuditEnvelope,
  consumeTrustedHumanConfirmationEvidence,
  resolveHumanConfirmationAuditPlan,
  resolveHumanConfirmationEvidenceMatch,
  type PendingHumanConfirmedAction,
  type TrustedHumanConfirmationEvidence,
} from "../../extensions/guardrails-core-human-confirmation";

const pendingDelete: PendingHumanConfirmedAction = {
  actionKind: "destructive",
  toolName: "bash",
  path: "tmp/demo.txt",
  scope: "workspace",
  payloadHash: "sha256:delete-demo",
  nowIso: "2026-04-30T22:00:00.000Z",
};

const trustedEvidence: TrustedHumanConfirmationEvidence = {
  id: "confirm-1",
  origin: "runtime-ui-confirm",
  trusted: true,
  actionKind: "destructive",
  toolName: "bash",
  path: "tmp/demo.txt",
  scope: "workspace",
  payloadHash: "sha256:delete-demo",
  createdAtIso: "2026-04-30T21:59:50.000Z",
  expiresAtIso: "2026-04-30T22:00:20.000Z",
};

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

  it("matches trusted exact action evidence without granting dispatch", () => {
    const result = resolveHumanConfirmationEvidenceMatch(trustedEvidence, pendingDelete);

    expect(result.decision).toBe("match");
    expect(result.usableAsAuditEvidence).toBe(true);
    expect(result.consumeAllowed).toBe(true);
    expect(result.dispatchAllowed).toBe(false);
    expect(result.canOverrideMonitorBlock).toBe(false);
    expect(result.authorization).toBe("none");
  });

  it("rejects stale, consumed, and mismatched evidence", () => {
    expect(resolveHumanConfirmationEvidenceMatch({
      ...trustedEvidence,
      expiresAtIso: "2026-04-30T21:59:59.000Z",
    }, pendingDelete).decision).toBe("expired");

    expect(resolveHumanConfirmationEvidenceMatch({
      ...trustedEvidence,
      consumedAtIso: "2026-04-30T22:00:01.000Z",
    }, pendingDelete).decision).toBe("consumed");

    const mismatch = resolveHumanConfirmationEvidenceMatch({
      ...trustedEvidence,
      path: "tmp/other.txt",
    }, pendingDelete);
    expect(mismatch.decision).toBe("mismatch");
    expect(mismatch.reasons).toContain("path-mismatch");
  });

  it("consumes trusted confirmation evidence as a single-use copy", () => {
    const consumed = consumeTrustedHumanConfirmationEvidence(trustedEvidence, pendingDelete);

    expect(consumed.ok).toBe(true);
    expect(consumed.evidence.consumedAtIso).toBe(pendingDelete.nowIso);
    expect(resolveHumanConfirmationEvidenceMatch(consumed.evidence, pendingDelete).decision).toBe("consumed");
  });

  it("builds a bounded audit/custom-message envelope for future monitor consumption", () => {
    const match = resolveHumanConfirmationEvidenceMatch(trustedEvidence, pendingDelete);
    const envelope = buildTrustedHumanConfirmationAuditEnvelope(trustedEvidence, match);

    expect(envelope.customType).toBe("human-confirmation-evidence");
    expect(envelope.display).toBe(false);
    expect(envelope.content).toContain("decision=match");
    expect(envelope.content).toContain("dispatch=no");
    expect(envelope.content).toContain("override=no");
    expect(envelope.details).toMatchObject({
      evidenceId: "confirm-1",
      decision: "match",
      origin: "runtime-ui-confirm",
      toolName: "bash",
      dispatchAllowed: false,
      canOverrideMonitorBlock: false,
      authorization: "none",
    });
  });
});
