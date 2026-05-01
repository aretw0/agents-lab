export type HumanConfirmationActionKind = "local-safe" | "destructive" | "protected";
export type HumanConfirmationAuditDecision = "not-required" | "auditable" | "audit-gap" | "blocked";
export type HumanConfirmationEvidenceOrigin = "tool-call" | "custom-message" | "audit-entry";
export type TrustedHumanConfirmationOrigin = "runtime-ui-confirm" | "operator-contract-review";
export type HumanConfirmationEvidenceDecision = "match" | "missing" | "expired" | "consumed" | "mismatch" | "untrusted";

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

export type HumanConfirmationActionFingerprint = {
  actionKind: Exclude<HumanConfirmationActionKind, "local-safe">;
  toolName: string;
  path?: string;
  scope?: string;
  payloadHash?: string;
};

export type TrustedHumanConfirmationEvidence = HumanConfirmationActionFingerprint & {
  id: string;
  origin: TrustedHumanConfirmationOrigin;
  trusted: true;
  createdAtIso: string;
  expiresAtIso: string;
  consumedAtIso?: string;
};

export type PendingHumanConfirmedAction = HumanConfirmationActionFingerprint & {
  nowIso: string;
};

export type HumanConfirmationEvidenceMatch = {
  decision: HumanConfirmationEvidenceDecision;
  authorization: "none";
  dispatchAllowed: false;
  canOverrideMonitorBlock: false;
  usableAsAuditEvidence: boolean;
  consumeAllowed: boolean;
  reasons: string[];
  evidenceId?: string;
  summary: string;
};

export type TrustedHumanConfirmationAuditEnvelope = {
  customType: "human-confirmation-evidence";
  content: string;
  display: false;
  details: {
    evidenceId: string;
    decision: HumanConfirmationEvidenceDecision;
    origin: TrustedHumanConfirmationOrigin;
    actionKind: Exclude<HumanConfirmationActionKind, "local-safe">;
    toolName: string;
    path?: string;
    scope?: string;
    payloadHash?: string;
    createdAtIso: string;
    expiresAtIso: string;
    consumedAtIso?: string;
    reasons: string[];
    dispatchAllowed: false;
    canOverrideMonitorBlock: false;
    authorization: "none";
  };
};

export type TrustedHumanConfirmationUiDecisionInput = HumanConfirmationActionFingerprint & {
  confirmed: boolean;
  nowIso: string;
  ttlMs?: number;
  origin?: TrustedHumanConfirmationOrigin;
  evidenceId?: string;
};

export type TrustedHumanConfirmationUiDecisionResult = {
  decision: "declined" | "recorded" | "invalid";
  authorization: "none";
  dispatchAllowed: false;
  canOverrideMonitorBlock: false;
  reasons: string[];
  evidence?: TrustedHumanConfirmationEvidence;
  envelope?: TrustedHumanConfirmationAuditEnvelope;
  summary: string;
};

export type TrustedHumanConfirmationEnvelopeConsumption = {
  decision: "consumed" | "rejected";
  authorization: "none";
  dispatchAllowed: false;
  canOverrideMonitorBlock: false;
  reasons: string[];
  match: HumanConfirmationEvidenceMatch;
  evidence?: TrustedHumanConfirmationEvidence;
  envelope?: TrustedHumanConfirmationAuditEnvelope;
  summary: string;
};

export type HumanConfirmationRuntimeConsumptionDecision = "ready-for-guard-consumption" | "needs-runtime-bridge" | "needs-upstream-signal" | "blocked";

export type HumanConfirmationRuntimeConsumptionPlanInput = {
  guardOwnsConfirmationDialog?: boolean;
  structuredEnvelopeDetailsAvailable?: boolean;
  auditEntryReadableByConsumer?: boolean;
  customMessagesTextOnly?: boolean;
  upstreamToolCallHasConfirmationSignal?: boolean;
  destructiveOrProtectedAction?: boolean;
};

export type HumanConfirmationRuntimeConsumptionPlan = {
  decision: HumanConfirmationRuntimeConsumptionDecision;
  authorization: "none";
  dispatchAllowed: false;
  canOverrideMonitorBlock: false;
  textOnlyEvidenceAccepted: false;
  reasons: string[];
  nextActions: string[];
  summary: string;
};

export type HumanConfirmationSignalSourceDecision = "use-guard-owned-audit-entry" | "propose-upstream-tool-call-signal" | "build-wrapper-signal" | "blocked";

export type HumanConfirmationSignalSourcePlanInput = {
  guardOwnsConfirmationDialog?: boolean;
  toolCallEventHasConfirmationSignal?: boolean;
  extensionContextCanSendStructuredMessage?: boolean;
  auditEntryAppendAvailable?: boolean;
  customMessagesPreserveDetails?: boolean;
  upstreamMutationAllowed?: boolean;
};

export type HumanConfirmationSignalSourcePlan = {
  decision: HumanConfirmationSignalSourceDecision;
  authorization: "none";
  dispatchAllowed: false;
  implementationAllowed: false;
  canOverrideMonitorBlock: false;
  reasons: string[];
  recommendedPath: string;
  nextActions: string[];
  summary: string;
};

export type HumanConfirmationImplementationChannel = "guard-owned-report-only" | "wrapper-design" | "upstream-pr-design" | "blocked";

export type HumanConfirmationImplementationChannelInput = {
  preferredChannel?: "guard-owned" | "wrapper" | "upstream-pr";
  guardCanOwnDialog?: boolean;
  wrapperCanPreserveStructuredDetails?: boolean;
  upstreamChangeAccepted?: boolean;
  directNodeModulesPatchRequested?: boolean;
  destructiveRuntimeEnableRequested?: boolean;
};

export type HumanConfirmationImplementationChannelPlan = {
  channel: HumanConfirmationImplementationChannel;
  authorization: "none";
  dispatchAllowed: false;
  implementationAllowed: false;
  runtimeDestructiveDialogEnabled: false;
  directNodeModulesPatchAllowed: false;
  reasons: string[];
  nextActions: string[];
  summary: string;
};

const DEFAULT_CONFIRMATION_TTL_MS = 30_000;

export function resolveHumanConfirmationImplementationChannelPlan(
  input: HumanConfirmationImplementationChannelInput,
): HumanConfirmationImplementationChannelPlan {
  const reasons: string[] = [];

  if (input.directNodeModulesPatchRequested) reasons.push("direct-node-modules-patch-prohibited");
  if (input.destructiveRuntimeEnableRequested) reasons.push("destructive-runtime-enable-requires-separate-authorization");
  if (reasons.length > 0) {
    return {
      channel: "blocked",
      authorization: "none",
      dispatchAllowed: false,
      implementationAllowed: false,
      runtimeDestructiveDialogEnabled: false,
      directNodeModulesPatchAllowed: false,
      reasons,
      nextActions: ["remove-prohibited-request", "continue-with-design-or-report-only-channel"],
      summary: `human-confirmation-implementation-channel: channel=blocked dispatch=no implementation=no destructiveDialog=no nodeModulesPatch=no reasons=${reasons.join("|")} authorization=none`,
    };
  }

  if (input.preferredChannel === "guard-owned" || input.guardCanOwnDialog) {
    reasons.push("guard-owned-channel-selected");
    reasons.push("start-report-only-before-operational-dialog");
    return {
      channel: "guard-owned-report-only",
      authorization: "none",
      dispatchAllowed: false,
      implementationAllowed: false,
      runtimeDestructiveDialogEnabled: false,
      directNodeModulesPatchAllowed: false,
      reasons,
      nextActions: ["record-evidence-from-guard-owned-confirm-only", "keep-operational-destructive-dialog-disabled", "validate-envelope-consumption-before-enable"],
      summary: `human-confirmation-implementation-channel: channel=guard-owned-report-only dispatch=no implementation=no destructiveDialog=no nodeModulesPatch=no reasons=${reasons.join("|")} authorization=none`,
    };
  }

  if (input.preferredChannel === "wrapper" || input.wrapperCanPreserveStructuredDetails) {
    reasons.push("wrapper-channel-selected");
    reasons.push("structured-details-required");
    return {
      channel: "wrapper-design",
      authorization: "none",
      dispatchAllowed: false,
      implementationAllowed: false,
      runtimeDestructiveDialogEnabled: false,
      directNodeModulesPatchAllowed: false,
      reasons,
      nextActions: ["design-wrapper-structured-envelope", "prove-consumer-receives-details", "keep-fail-closed"],
      summary: `human-confirmation-implementation-channel: channel=wrapper-design dispatch=no implementation=no destructiveDialog=no nodeModulesPatch=no reasons=${reasons.join("|")} authorization=none`,
    };
  }

  if (input.preferredChannel === "upstream-pr" || input.upstreamChangeAccepted) {
    reasons.push("upstream-pr-channel-selected");
    reasons.push("no-local-node-modules-patch");
    return {
      channel: "upstream-pr-design",
      authorization: "none",
      dispatchAllowed: false,
      implementationAllowed: false,
      runtimeDestructiveDialogEnabled: false,
      directNodeModulesPatchAllowed: false,
      reasons,
      nextActions: ["draft-upstream-interface", "preserve-local-fail-closed-until-release"],
      summary: `human-confirmation-implementation-channel: channel=upstream-pr-design dispatch=no implementation=no destructiveDialog=no nodeModulesPatch=no reasons=${reasons.join("|")} authorization=none`,
    };
  }

  reasons.push("no-safe-channel-selected");
  return {
    channel: "blocked",
    authorization: "none",
    dispatchAllowed: false,
    implementationAllowed: false,
    runtimeDestructiveDialogEnabled: false,
    directNodeModulesPatchAllowed: false,
    reasons,
    nextActions: ["choose-guard-owned-wrapper-or-upstream-pr-channel"],
    summary: "human-confirmation-implementation-channel: channel=blocked dispatch=no implementation=no destructiveDialog=no nodeModulesPatch=no reasons=no-safe-channel-selected authorization=none",
  };
}

export function resolveHumanConfirmationSignalSourcePlan(
  input: HumanConfirmationSignalSourcePlanInput,
): HumanConfirmationSignalSourcePlan {
  const reasons: string[] = [];

  if (input.guardOwnsConfirmationDialog && input.auditEntryAppendAvailable) {
    reasons.push("guard-owns-dialog");
    reasons.push("audit-entry-append-available");
    return {
      decision: "use-guard-owned-audit-entry",
      authorization: "none",
      dispatchAllowed: false,
      implementationAllowed: false,
      canOverrideMonitorBlock: false,
      reasons,
      recommendedPath: "record trusted evidence from the guard-owned dialog via audit entry; consume only structured envelope details",
      nextActions: ["wire-guard-owned-dialog-to-recordTrustedHumanConfirmationUiDecision", "consume-structured-envelope-details-only"],
      summary: `human-confirmation-signal-source: decision=use-guard-owned-audit-entry dispatch=no implementation=no override=no reasons=${reasons.join("|")} authorization=none`,
    };
  }

  if (input.toolCallEventHasConfirmationSignal) {
    reasons.push("tool-call-confirmation-signal-available");
    return {
      decision: "build-wrapper-signal",
      authorization: "none",
      dispatchAllowed: false,
      implementationAllowed: false,
      canOverrideMonitorBlock: false,
      reasons,
      recommendedPath: "wrap the exposed confirmation signal into human-confirmation-evidence details before monitor/guard consumption",
      nextActions: ["map-upstream-signal-to-exact-action-fingerprint", "consume-envelope-with-ttl-single-use"],
      summary: `human-confirmation-signal-source: decision=build-wrapper-signal dispatch=no implementation=no override=no reasons=${reasons.join("|")} authorization=none`,
    };
  }

  if (input.extensionContextCanSendStructuredMessage && input.customMessagesPreserveDetails) {
    reasons.push("structured-custom-message-available");
    return {
      decision: "build-wrapper-signal",
      authorization: "none",
      dispatchAllowed: false,
      implementationAllowed: false,
      canOverrideMonitorBlock: false,
      reasons,
      recommendedPath: "emit hidden structured human-confirmation-evidence custom messages and consume details, not content text",
      nextActions: ["emit-display-false-structured-envelope", "verify-consumer-receives-details"],
      summary: `human-confirmation-signal-source: decision=build-wrapper-signal dispatch=no implementation=no override=no reasons=${reasons.join("|")} authorization=none`,
    };
  }

  if (input.upstreamMutationAllowed) {
    reasons.push("upstream-change-required");
    return {
      decision: "propose-upstream-tool-call-signal",
      authorization: "none",
      dispatchAllowed: false,
      implementationAllowed: false,
      canOverrideMonitorBlock: false,
      reasons,
      recommendedPath: "propose an upstream ToolCallEvent confirmation field or structured pre-tool confirmation event; do not patch node_modules directly",
      nextActions: ["draft-upstream-pr-or-wrapper-design", "keep-local-fail-closed-until-signal-exists"],
      summary: `human-confirmation-signal-source: decision=propose-upstream-tool-call-signal dispatch=no implementation=no override=no reasons=${reasons.join("|")} authorization=none`,
    };
  }

  reasons.push("no-trusted-structured-signal-source");
  if (input.customMessagesPreserveDetails === false) reasons.push("custom-messages-details-not-preserved");
  if (input.toolCallEventHasConfirmationSignal === false) reasons.push("tool-call-confirmation-signal-missing");
  return {
    decision: "blocked",
    authorization: "none",
    dispatchAllowed: false,
    implementationAllowed: false,
    canOverrideMonitorBlock: false,
    reasons,
    recommendedPath: "keep fail-closed; do not consume text-only confirmation evidence",
    nextActions: ["use-guard-owned-dialog-or-upstream-wrapper-before-consuming-confirmation"],
    summary: `human-confirmation-signal-source: decision=blocked dispatch=no implementation=no override=no reasons=${reasons.join("|")} authorization=none`,
  };
}

export function resolveHumanConfirmationRuntimeConsumptionPlan(
  input: HumanConfirmationRuntimeConsumptionPlanInput,
): HumanConfirmationRuntimeConsumptionPlan {
  const reasons: string[] = [];
  const nextActions: string[] = [];
  const protectedAction = input.destructiveOrProtectedAction !== false;

  if (!protectedAction) {
    reasons.push("confirmation-not-required-for-local-safe-action");
    return {
      decision: "blocked",
      authorization: "none",
      dispatchAllowed: false,
      canOverrideMonitorBlock: false,
      textOnlyEvidenceAccepted: false,
      reasons,
      nextActions: ["do-not-use-confirmation-evidence-for-local-safe-action"],
      summary: "human-confirmation-runtime-consumption: decision=blocked dispatch=no override=no textOnly=no reasons=confirmation-not-required-for-local-safe-action authorization=none",
    };
  }

  if (input.customMessagesTextOnly && !input.structuredEnvelopeDetailsAvailable) {
    reasons.push("custom-messages-text-only-spoofable");
    nextActions.push("provide-structured-envelope-details-to-consumer");
  }

  if (input.guardOwnsConfirmationDialog && input.structuredEnvelopeDetailsAvailable) {
    reasons.push("guard-owned-confirmation-structured-evidence");
    return {
      decision: "ready-for-guard-consumption",
      authorization: "none",
      dispatchAllowed: false,
      canOverrideMonitorBlock: false,
      textOnlyEvidenceAccepted: false,
      reasons,
      nextActions: ["consume-envelope-with-exact-match-ttl-single-use"],
      summary: `human-confirmation-runtime-consumption: decision=ready-for-guard-consumption dispatch=no override=no textOnly=no reasons=${reasons.join("|")} authorization=none`,
    };
  }

  if (input.auditEntryReadableByConsumer && input.structuredEnvelopeDetailsAvailable) {
    reasons.push("structured-audit-entry-readable-by-consumer");
    return {
      decision: "ready-for-guard-consumption",
      authorization: "none",
      dispatchAllowed: false,
      canOverrideMonitorBlock: false,
      textOnlyEvidenceAccepted: false,
      reasons,
      nextActions: ["consume-envelope-with-exact-match-ttl-single-use"],
      summary: `human-confirmation-runtime-consumption: decision=ready-for-guard-consumption dispatch=no override=no textOnly=no reasons=${reasons.join("|")} authorization=none`,
    };
  }

  if (!input.upstreamToolCallHasConfirmationSignal && !input.guardOwnsConfirmationDialog) {
    reasons.push("upstream-confirmation-signal-not-exposed");
    nextActions.push("add-upstream-or-wrapper-confirmation-signal");
    return {
      decision: "needs-upstream-signal",
      authorization: "none",
      dispatchAllowed: false,
      canOverrideMonitorBlock: false,
      textOnlyEvidenceAccepted: false,
      reasons,
      nextActions,
      summary: `human-confirmation-runtime-consumption: decision=needs-upstream-signal dispatch=no override=no textOnly=no reasons=${reasons.join("|")} authorization=none`,
    };
  }

  reasons.push("structured-envelope-details-not-available-to-consumer");
  nextActions.push("wire-runtime-bridge-for-structured-envelope-details");
  return {
    decision: "needs-runtime-bridge",
    authorization: "none",
    dispatchAllowed: false,
    canOverrideMonitorBlock: false,
    textOnlyEvidenceAccepted: false,
    reasons,
    nextActions,
    summary: `human-confirmation-runtime-consumption: decision=needs-runtime-bridge dispatch=no override=no textOnly=no reasons=${reasons.join("|")} authorization=none`,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isKnownTrustedOrigin(value: unknown): value is TrustedHumanConfirmationOrigin {
  return value === "runtime-ui-confirm" || value === "operator-contract-review";
}

function isProtectedActionKind(value: unknown): value is Exclude<HumanConfirmationActionKind, "local-safe"> {
  return value === "destructive" || value === "protected";
}

function truncateValue(value: string | undefined, max = 160): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function normalizeComparable(value: string | undefined): string {
  return typeof value === "string" ? value.replace(/\\/g, "/").trim() : "";
}

function sameOptionalField(a: string | undefined, b: string | undefined): boolean {
  return normalizeComparable(a) === normalizeComparable(b);
}

function addMsIso(nowIso: string, ttlMs: number): string | undefined {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now) || !Number.isFinite(ttlMs) || ttlMs <= 0) return undefined;
  return new Date(now + ttlMs).toISOString();
}

function stableEvidenceId(input: TrustedHumanConfirmationUiDecisionInput): string {
  const raw = [
    input.origin ?? "runtime-ui-confirm",
    input.actionKind,
    normalizeComparable(input.toolName),
    normalizeComparable(input.path),
    normalizeComparable(input.scope),
    normalizeComparable(input.payloadHash),
    input.nowIso,
  ].join("|");
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return `confirm-${Math.abs(hash).toString(36)}`;
}

function isExpired(expiresAtIso: string, nowIso: string): boolean {
  const expires = Date.parse(expiresAtIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(expires) || !Number.isFinite(now)) return true;
  return now > expires;
}

function collectOrigins(input: HumanConfirmationAuditInput): HumanConfirmationEvidenceOrigin[] {
  const origins: HumanConfirmationEvidenceOrigin[] = [];
  if (input.toolCallEvidence) origins.push("tool-call");
  if (input.customMessageEvidence) origins.push("custom-message");
  if (input.auditEntryEvidence) origins.push("audit-entry");
  return origins;
}

export function resolveHumanConfirmationEvidenceMatch(
  evidence: TrustedHumanConfirmationEvidence | undefined,
  pending: PendingHumanConfirmedAction,
): HumanConfirmationEvidenceMatch {
  const reasons: string[] = [];

  if (!evidence) {
    reasons.push("confirmation-evidence-missing");
    return {
      decision: "missing",
      authorization: "none",
      dispatchAllowed: false,
      canOverrideMonitorBlock: false,
      usableAsAuditEvidence: false,
      consumeAllowed: false,
      reasons,
      summary: "human-confirmation-evidence: decision=missing dispatch=no override=no reasons=confirmation-evidence-missing authorization=none",
    };
  }

  if (evidence.trusted !== true || !["runtime-ui-confirm", "operator-contract-review"].includes(evidence.origin)) {
    reasons.push("confirmation-origin-untrusted");
    return {
      decision: "untrusted",
      authorization: "none",
      dispatchAllowed: false,
      canOverrideMonitorBlock: false,
      usableAsAuditEvidence: false,
      consumeAllowed: false,
      reasons,
      evidenceId: evidence.id,
      summary: `human-confirmation-evidence: decision=untrusted dispatch=no override=no reasons=${reasons.join("|")} authorization=none`,
    };
  }

  if (evidence.consumedAtIso) {
    reasons.push("confirmation-already-consumed");
    return {
      decision: "consumed",
      authorization: "none",
      dispatchAllowed: false,
      canOverrideMonitorBlock: false,
      usableAsAuditEvidence: false,
      consumeAllowed: false,
      reasons,
      evidenceId: evidence.id,
      summary: `human-confirmation-evidence: decision=consumed dispatch=no override=no reasons=${reasons.join("|")} authorization=none`,
    };
  }

  if (isExpired(evidence.expiresAtIso, pending.nowIso)) {
    reasons.push("confirmation-expired");
    return {
      decision: "expired",
      authorization: "none",
      dispatchAllowed: false,
      canOverrideMonitorBlock: false,
      usableAsAuditEvidence: false,
      consumeAllowed: false,
      reasons,
      evidenceId: evidence.id,
      summary: `human-confirmation-evidence: decision=expired dispatch=no override=no reasons=${reasons.join("|")} authorization=none`,
    };
  }

  const mismatchReasons: string[] = [];
  if (evidence.actionKind !== pending.actionKind) mismatchReasons.push("action-kind-mismatch");
  if (normalizeComparable(evidence.toolName) !== normalizeComparable(pending.toolName)) mismatchReasons.push("tool-name-mismatch");
  if (!sameOptionalField(evidence.path, pending.path)) mismatchReasons.push("path-mismatch");
  if (!sameOptionalField(evidence.scope, pending.scope)) mismatchReasons.push("scope-mismatch");
  if (!sameOptionalField(evidence.payloadHash, pending.payloadHash)) mismatchReasons.push("payload-hash-mismatch");

  if (mismatchReasons.length > 0) {
    return {
      decision: "mismatch",
      authorization: "none",
      dispatchAllowed: false,
      canOverrideMonitorBlock: false,
      usableAsAuditEvidence: false,
      consumeAllowed: false,
      reasons: mismatchReasons,
      evidenceId: evidence.id,
      summary: `human-confirmation-evidence: decision=mismatch dispatch=no override=no reasons=${mismatchReasons.join("|")} authorization=none`,
    };
  }

  reasons.push("trusted-confirmation-evidence-present");
  reasons.push("confirmation-exact-match");
  reasons.push("confirmation-single-use-ready");
  return {
    decision: "match",
    authorization: "none",
    dispatchAllowed: false,
    canOverrideMonitorBlock: false,
    usableAsAuditEvidence: true,
    consumeAllowed: true,
    reasons,
    evidenceId: evidence.id,
    summary: `human-confirmation-evidence: decision=match dispatch=no override=no reasons=${reasons.join("|")} authorization=none`,
  };
}

export function buildTrustedHumanConfirmationAuditEnvelope(
  evidence: TrustedHumanConfirmationEvidence,
  match: HumanConfirmationEvidenceMatch,
): TrustedHumanConfirmationAuditEnvelope {
  const path = truncateValue(evidence.path);
  const scope = truncateValue(evidence.scope);
  const payloadHash = truncateValue(evidence.payloadHash, 96);
  const contentParts = [
    "human-confirmation-evidence:",
    `decision=${match.decision}`,
    `id=${evidence.id}`,
    `tool=${evidence.toolName}`,
    path ? `path=${path}` : undefined,
    scope ? `scope=${scope}` : undefined,
    `dispatch=no`,
    `override=no`,
    `authorization=none`,
  ].filter((part): part is string => Boolean(part));

  return {
    customType: "human-confirmation-evidence",
    content: contentParts.join(" "),
    display: false,
    details: {
      evidenceId: evidence.id,
      decision: match.decision,
      origin: evidence.origin,
      actionKind: evidence.actionKind,
      toolName: evidence.toolName,
      path,
      scope,
      payloadHash,
      createdAtIso: evidence.createdAtIso,
      expiresAtIso: evidence.expiresAtIso,
      consumedAtIso: evidence.consumedAtIso,
      reasons: match.reasons.slice(0, 8),
      dispatchAllowed: false,
      canOverrideMonitorBlock: false,
      authorization: "none",
    },
  };
}

export function recordTrustedHumanConfirmationUiDecision(
  input: TrustedHumanConfirmationUiDecisionInput,
): TrustedHumanConfirmationUiDecisionResult {
  if (!input.confirmed) {
    return {
      decision: "declined",
      authorization: "none",
      dispatchAllowed: false,
      canOverrideMonitorBlock: false,
      reasons: ["ui-confirmation-declined"],
      summary: "human-confirmation-ui: decision=declined dispatch=no override=no reasons=ui-confirmation-declined authorization=none",
    };
  }

  const ttlMs = input.ttlMs ?? DEFAULT_CONFIRMATION_TTL_MS;
  const expiresAtIso = addMsIso(input.nowIso, ttlMs);
  if (!expiresAtIso) {
    return {
      decision: "invalid",
      authorization: "none",
      dispatchAllowed: false,
      canOverrideMonitorBlock: false,
      reasons: ["invalid-confirmation-ttl-or-timestamp"],
      summary: "human-confirmation-ui: decision=invalid dispatch=no override=no reasons=invalid-confirmation-ttl-or-timestamp authorization=none",
    };
  }

  const evidence: TrustedHumanConfirmationEvidence = {
    id: input.evidenceId ?? stableEvidenceId(input),
    origin: input.origin ?? "runtime-ui-confirm",
    trusted: true,
    actionKind: input.actionKind,
    toolName: input.toolName,
    path: input.path,
    scope: input.scope,
    payloadHash: input.payloadHash,
    createdAtIso: input.nowIso,
    expiresAtIso,
  };
  const pending: PendingHumanConfirmedAction = { ...input, nowIso: input.nowIso };
  const match = resolveHumanConfirmationEvidenceMatch(evidence, pending);
  const envelope = buildTrustedHumanConfirmationAuditEnvelope(evidence, match);
  return {
    decision: "recorded",
    authorization: "none",
    dispatchAllowed: false,
    canOverrideMonitorBlock: false,
    reasons: ["trusted-ui-confirmation-recorded", "single-use-evidence-created"],
    evidence,
    envelope,
    summary: `human-confirmation-ui: decision=recorded dispatch=no override=no reasons=trusted-ui-confirmation-recorded|single-use-evidence-created authorization=none`,
  };
}

export function extractTrustedHumanConfirmationEvidenceFromEnvelope(
  envelope: unknown,
): TrustedHumanConfirmationEvidence | undefined {
  const root = asRecord(envelope);
  if (!root) return undefined;
  if (root.customType !== "human-confirmation-evidence") return undefined;
  if (root.display !== false) return undefined;
  const details = asRecord(root.details);
  if (!details) return undefined;
  if (details.dispatchAllowed !== false || details.canOverrideMonitorBlock !== false || details.authorization !== "none") return undefined;
  if (!isKnownTrustedOrigin(details.origin)) return undefined;
  if (!isProtectedActionKind(details.actionKind)) return undefined;
  const id = asString(details.evidenceId);
  const toolName = asString(details.toolName);
  const createdAtIso = asString(details.createdAtIso);
  const expiresAtIso = asString(details.expiresAtIso);
  if (!id || !toolName || !createdAtIso || !expiresAtIso) return undefined;
  return {
    id,
    origin: details.origin,
    trusted: true,
    actionKind: details.actionKind,
    toolName,
    path: asString(details.path),
    scope: asString(details.scope),
    payloadHash: asString(details.payloadHash),
    createdAtIso,
    expiresAtIso,
    consumedAtIso: asString(details.consumedAtIso),
  };
}

export function consumeTrustedHumanConfirmationAuditEnvelope(
  envelope: unknown,
  pending: PendingHumanConfirmedAction,
): TrustedHumanConfirmationEnvelopeConsumption {
  const evidence = extractTrustedHumanConfirmationEvidenceFromEnvelope(envelope);
  if (!evidence) {
    const match = resolveHumanConfirmationEvidenceMatch(undefined, pending);
    return {
      decision: "rejected",
      authorization: "none",
      dispatchAllowed: false,
      canOverrideMonitorBlock: false,
      reasons: ["confirmation-envelope-invalid-or-untrusted"],
      match,
      summary: "human-confirmation-envelope-consume: decision=rejected dispatch=no override=no reasons=confirmation-envelope-invalid-or-untrusted authorization=none",
    };
  }

  const consumed = consumeTrustedHumanConfirmationEvidence(evidence, pending);
  if (!consumed.ok) {
    return {
      decision: "rejected",
      authorization: "none",
      dispatchAllowed: false,
      canOverrideMonitorBlock: false,
      reasons: consumed.match.reasons,
      match: consumed.match,
      evidence,
      summary: `human-confirmation-envelope-consume: decision=rejected dispatch=no override=no reasons=${consumed.match.reasons.join("|")} authorization=none`,
    };
  }

  const consumedEnvelope = buildTrustedHumanConfirmationAuditEnvelope(consumed.evidence, consumed.match);
  return {
    decision: "consumed",
    authorization: "none",
    dispatchAllowed: false,
    canOverrideMonitorBlock: false,
    reasons: ["trusted-envelope-consumed", "confirmation-single-use"],
    match: consumed.match,
    evidence: consumed.evidence,
    envelope: consumedEnvelope,
    summary: "human-confirmation-envelope-consume: decision=consumed dispatch=no override=no reasons=trusted-envelope-consumed|confirmation-single-use authorization=none",
  };
}

export function consumeTrustedHumanConfirmationEvidence(
  evidence: TrustedHumanConfirmationEvidence,
  pending: PendingHumanConfirmedAction,
): { ok: true; evidence: TrustedHumanConfirmationEvidence; match: HumanConfirmationEvidenceMatch } | { ok: false; evidence: TrustedHumanConfirmationEvidence; match: HumanConfirmationEvidenceMatch } {
  const match = resolveHumanConfirmationEvidenceMatch(evidence, pending);
  if (!match.consumeAllowed) return { ok: false, evidence, match };
  return {
    ok: true,
    evidence: {
      ...evidence,
      consumedAtIso: pending.nowIso,
    },
    match,
  };
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
