import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  recordTrustedHumanConfirmationUiDecision,
  type HumanConfirmationActionFingerprint,
} from "./guardrails-core-human-confirmation";

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
  fingerprint: HumanConfirmationActionFingerprint,
  confirmed: boolean,
): void {
  const result = recordTrustedHumanConfirmationUiDecision({
    ...fingerprint,
    confirmed,
    nowIso: new Date().toISOString(),
  });
  appendAuditEntry(ctx, "guardrails-core.human-confirmation-ui-decision", {
    atIso: new Date().toISOString(),
    decision: result.decision,
    reasons: result.reasons,
    dispatchAllowed: result.dispatchAllowed,
    canOverrideMonitorBlock: result.canOverrideMonitorBlock,
    authorization: result.authorization,
    evidence: result.envelope?.details,
  });
}
