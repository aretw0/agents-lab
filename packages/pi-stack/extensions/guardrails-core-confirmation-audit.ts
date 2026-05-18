import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  recordTrustedOperatorConfirmationUiDecision,
  type OperatorConfirmationActionFingerprint,
} from "./guardrails-core-operator-confirmation";

export function appendAuditEntry(
  ctx: ExtensionContext,
  key: string,
  value: Record<string, unknown>,
): void {
  const maybeAppend = (ctx as unknown as { appendEntry?: (k: string, v: Record<string, unknown>) => void }).appendEntry;
  if (typeof maybeAppend === "function") {
    maybeAppend(key, value);
  }
}

export function appendTrustedUiConfirmationEvidence(
  ctx: ExtensionContext,
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
