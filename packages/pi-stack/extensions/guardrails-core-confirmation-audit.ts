import {
  recordTrustedOperatorConfirmationUiDecision,
  type OperatorConfirmationActionFingerprint,
} from "./guardrails-core-operator-confirmation";

export type GuardrailsCoreAuditSink = {
  appendEntry?: (key: string, value: Record<string, unknown>) => void;
};

export function appendAuditEntry(
  ctx: GuardrailsCoreAuditSink,
  key: string,
  value: Record<string, unknown>,
): void {
  const maybeAppend = ctx.appendEntry;
  if (typeof maybeAppend === "function") {
    maybeAppend(key, value);
  }
}

export function appendTrustedUiConfirmationEvidence(
  ctx: GuardrailsCoreAuditSink,
  fingerprint: OperatorConfirmationActionFingerprint,
  confirmed: boolean,
): void {
  const result = recordTrustedOperatorConfirmationUiDecision({
    ...fingerprint,
    confirmed,
    nowIso: new Date().toISOString(),
  });
  appendAuditEntry(ctx, "guardrails-core.operator-confirmation-ui-decision", {
    atIso: new Date().toISOString(),
    decision: result.decision,
    reasons: result.reasons,
    dispatchAllowed: result.dispatchAllowed,
    canOverrideMonitorBlock: result.canOverrideMonitorBlock,
    authorization: result.authorization,
    evidence: result.envelope?.details,
  });
}
