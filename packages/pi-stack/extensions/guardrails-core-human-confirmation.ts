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

const DEFAULT_CONFIRMATION_TTL_MS = 30_000;

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
