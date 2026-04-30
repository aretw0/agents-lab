export type HumanConfirmationActionKind = "local-safe" | "destructive" | "protected";
export type HumanConfirmationAuditDecision = "not-required" | "auditable" | "audit-gap" | "blocked";
export type HumanConfirmationEvidenceOrigin = "tool-call" | "custom-message" | "audit-entry";

export type HumanConfirmationAuditInput = {
  actionKind: HumanConfirmationActionKind;
  uiConfirmationObserved?: boolean;
  toolCallEvidence?: boolean;
  customMessageEvidence?: boolean;
  auditEntryEvidence?: boolean;
  trustedOrigin?: boolean;
  confirmationMatchesAction?: boolean;
};

export type HumanConfirmationAuditPlan = {
  decision: HumanConfirmationAuditDecision;
  authorization: "none";
  dispatchAllowed: false;
  canOverrideMonitorBlock: false;
  reasons: string[];
  evidenceOrigins: HumanConfirmationEvidenceOrigin[];
  layer: "not-required" | "auditable-path" | "upstream-pi-tui-to-monitor-gap" | "local-monitor-policy";
  recommendation: string;
  summary: string;
};

function collectOrigins(input: HumanConfirmationAuditInput): HumanConfirmationEvidenceOrigin[] {
  const origins: HumanConfirmationEvidenceOrigin[] = [];
  if (input.toolCallEvidence) origins.push("tool-call");
  if (input.customMessageEvidence) origins.push("custom-message");
  if (input.auditEntryEvidence) origins.push("audit-entry");
  return origins;
}

export function resolveHumanConfirmationAuditPlan(input: HumanConfirmationAuditInput): HumanConfirmationAuditPlan {
  const evidenceOrigins = collectOrigins(input);
  const reasons: string[] = [];
  const protectedOrDestructive = input.actionKind === "destructive" || input.actionKind === "protected";

  if (!protectedOrDestructive) {
    reasons.push("confirmation-not-required-for-local-safe-action");
    return {
      decision: "not-required",
      authorization: "none",
      dispatchAllowed: false,
      canOverrideMonitorBlock: false,
      reasons,
      evidenceOrigins,
      layer: "not-required",
      recommendation: "Continue normal local-safe flow; do not treat this as authorization for protected/destructive actions.",
      summary: "human-confirmation-audit: decision=not-required dispatch=no override=no reasons=confirmation-not-required-for-local-safe-action authorization=none",
    };
  }

  if (evidenceOrigins.length === 0) {
    reasons.push(input.uiConfirmationObserved ? "ui-confirmation-not-propagated" : "confirmation-evidence-missing");
    reasons.push("fail-closed-without-auditable-evidence");
    return {
      decision: "audit-gap",
      authorization: "none",
      dispatchAllowed: false,
      canOverrideMonitorBlock: false,
      reasons,
      evidenceOrigins,
      layer: input.uiConfirmationObserved ? "upstream-pi-tui-to-monitor-gap" : "local-monitor-policy",
      recommendation: input.uiConfirmationObserved
        ? "Treat as a propagation/audit gap: preserve the block, record the TUI-confirmation mismatch, and add a trusted confirmation evidence path before relaxing monitors."
        : "Keep fail-closed behavior and request explicit auditable confirmation before protected/destructive execution.",
      summary: `human-confirmation-audit: decision=audit-gap dispatch=no override=no reasons=${reasons.join("|")} authorization=none`,
    };
  }

  if (input.trustedOrigin !== true) {
    reasons.push("confirmation-origin-untrusted");
    reasons.push("manual-or-spoofable-evidence-cannot-authorize");
    return {
      decision: "blocked",
      authorization: "none",
      dispatchAllowed: false,
      canOverrideMonitorBlock: false,
      reasons,
      evidenceOrigins,
      layer: "local-monitor-policy",
      recommendation: "Do not execute or override monitor blocks from spoofable confirmation evidence; require trusted runtime-originated audit evidence.",
      summary: `human-confirmation-audit: decision=blocked dispatch=no override=no reasons=${reasons.join("|")} authorization=none`,
    };
  }

  if (input.confirmationMatchesAction !== true) {
    reasons.push("confirmation-action-mismatch");
    reasons.push("fail-closed-without-exact-action-match");
    return {
      decision: "blocked",
      authorization: "none",
      dispatchAllowed: false,
      canOverrideMonitorBlock: false,
      reasons,
      evidenceOrigins,
      layer: "local-monitor-policy",
      recommendation: "Do not execute; confirmation evidence must name the same action/path/scope as the pending protected or destructive call.",
      summary: `human-confirmation-audit: decision=blocked dispatch=no override=no reasons=${reasons.join("|")} authorization=none`,
    };
  }

  reasons.push("trusted-confirmation-evidence-present");
  reasons.push("confirmation-matches-action");
  return {
    decision: "auditable",
    authorization: "none",
    dispatchAllowed: false,
    canOverrideMonitorBlock: false,
    reasons,
    evidenceOrigins,
    layer: "auditable-path",
    recommendation: "Confirmation is auditable evidence for a future guard/monitor decision, but this read-only plan does not authorize dispatch by itself.",
    summary: `human-confirmation-audit: decision=auditable dispatch=no override=no reasons=${reasons.join("|")} authorization=none`,
  };
}
