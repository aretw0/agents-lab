export type OperatorApprovalIntentKind =
  | "local-safe"
  | "worker-single-run"
  | "worker-suite"
  | "protected"
  | "destructive";

export type OperatorApprovalInteraction =
  | "none"
  | "yes-no"
  | "choice"
  | "suite-approval"
  | "exact-text-fallback";

export type OperatorApprovalDecision =
  | "not-required"
  | "ready-for-structured-approval"
  | "needs-exact-text-fallback"
  | "blocked";

export type OperatorApprovalPacketInput = {
  intentKind: OperatorApprovalIntentKind;
  recommendedAction?: string;
  options?: string[];
  suiteId?: string;
  providerModelRef?: string;
  maxCalls?: number;
  maxCostUsd?: number;
  parallelism?: number;
  exactConfirmationPhrase?: string;
  structuredConfirmationAvailable?: boolean;
  protectedScopeRequested?: boolean;
  destructiveActionRequested?: boolean;
};

export type OperatorApprovalPacket = {
  mode: "operator-approval-packet";
  decision: OperatorApprovalDecision;
  interaction: OperatorApprovalInteraction;
  authorization: "none";
  dispatchAllowed: false;
  acceptsShortAnswer: boolean;
  requiresStructuredSignal: boolean;
  exactTextFallbackRequired: boolean;
  exactConfirmationPhrase?: string;
  prompt: string;
  recommendedAction?: string;
  allowedResponses: string[];
  blockers: string[];
  auditContract: {
    ttlSingleUse: boolean;
    fingerprintRequired: boolean;
    textOnlyCannotAuthorize: boolean;
  };
  summary: string;
};

function normalizePositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeApprovalText(value: unknown, max = 180): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function normalizeApprovalOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeApprovalText(entry, 80))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 5);
}

function buildSuiteApprovalPrompt(input: OperatorApprovalPacketInput): string {
  const suiteId = normalizeApprovalText(input.suiteId, 80) ?? "suite";
  const provider = normalizeApprovalText(input.providerModelRef, 100) ?? "provider/model unknown";
  const maxCalls = normalizePositiveNumber(input.maxCalls);
  const maxCost = normalizePositiveNumber(input.maxCostUsd);
  const parallelism = normalizePositiveNumber(input.parallelism);
  return [
    `Approve worker suite '${suiteId}'?`,
    `model=${provider}`,
    maxCalls ? `maxCalls=${maxCalls}` : undefined,
    maxCost ? `maxCostUsd=${maxCost}` : undefined,
    parallelism ? `parallelism=${parallelism}` : undefined,
  ].filter(Boolean).join(" ");
}

const AUDIT_CONTRACT = {
  ttlSingleUse: true,
  fingerprintRequired: true,
  textOnlyCannotAuthorize: true,
};

export function buildOperatorApprovalPacket(input: OperatorApprovalPacketInput): OperatorApprovalPacket {
  const structuredConfirmationAvailable = input.structuredConfirmationAvailable === true;
  const exactPhrase = normalizeApprovalText(input.exactConfirmationPhrase, 220);
  const recommendedAction = normalizeApprovalText(input.recommendedAction, 180);
  const options = normalizeApprovalOptions(input.options);
  const blockers: string[] = [];

  if (input.protectedScopeRequested && input.intentKind !== "protected") blockers.push("protected-scope-requires-protected-intent");
  if (input.destructiveActionRequested && input.intentKind !== "destructive") blockers.push("destructive-action-requires-destructive-intent");

  if (blockers.length > 0) {
    return {
      mode: "operator-approval-packet",
      decision: "blocked",
      interaction: "exact-text-fallback",
      authorization: "none",
      dispatchAllowed: false,
      acceptsShortAnswer: false,
      requiresStructuredSignal: true,
      exactTextFallbackRequired: true,
      exactConfirmationPhrase: exactPhrase,
      prompt: "Approval blocked until intent kind matches the requested risk.",
      recommendedAction,
      allowedResponses: exactPhrase ? [exactPhrase] : [],
      blockers,
      auditContract: AUDIT_CONTRACT,
      summary: `operator-approval-packet: decision=blocked interaction=exact-text-fallback shortAnswer=no structured=yes exactFallback=yes blockers=${blockers.join("|")} dispatch=no authorization=none`,
    };
  }

  if (input.intentKind === "local-safe") {
    return {
      mode: "operator-approval-packet",
      decision: "not-required",
      interaction: "none",
      authorization: "none",
      dispatchAllowed: false,
      acceptsShortAnswer: true,
      requiresStructuredSignal: false,
      exactTextFallbackRequired: false,
      prompt: recommendedAction ? `Proceed with local-safe work: ${recommendedAction}` : "Proceed with local-safe work.",
      recommendedAction,
      allowedResponses: ["prossiga", "continue", "sim"],
      blockers: [],
      auditContract: AUDIT_CONTRACT,
      summary: "operator-approval-packet: decision=not-required interaction=none shortAnswer=yes structured=no exactFallback=no dispatch=no authorization=none",
    };
  }

  if (input.intentKind === "worker-suite") {
    const prompt = buildSuiteApprovalPrompt(input);
    if (structuredConfirmationAvailable) {
      return {
        mode: "operator-approval-packet",
        decision: "ready-for-structured-approval",
        interaction: "suite-approval",
        authorization: "none",
        dispatchAllowed: false,
        acceptsShortAnswer: true,
        requiresStructuredSignal: true,
        exactTextFallbackRequired: false,
        prompt,
        recommendedAction,
        allowedResponses: ["approve", "decline"],
        blockers: [],
        auditContract: AUDIT_CONTRACT,
        summary: "operator-approval-packet: decision=ready-for-structured-approval interaction=suite-approval shortAnswer=yes structured=yes exactFallback=no dispatch=no authorization=none",
      };
    }
    return exactTextFallback(prompt, recommendedAction, exactPhrase);
  }

  if (input.intentKind === "worker-single-run") {
    const prompt = recommendedAction ? `Execute one worker run? ${recommendedAction}` : "Execute one worker run?";
    if (structuredConfirmationAvailable) {
      const interaction = options.length > 1 ? "choice" : "yes-no";
      return {
        mode: "operator-approval-packet",
        decision: "ready-for-structured-approval",
        interaction,
        authorization: "none",
        dispatchAllowed: false,
        acceptsShortAnswer: true,
        requiresStructuredSignal: true,
        exactTextFallbackRequired: false,
        prompt,
        recommendedAction,
        allowedResponses: options.length > 1 ? options : ["sim", "nao"],
        blockers: [],
        auditContract: AUDIT_CONTRACT,
        summary: `operator-approval-packet: decision=ready-for-structured-approval interaction=${interaction} shortAnswer=yes structured=yes exactFallback=no dispatch=no authorization=none`,
      };
    }
    return exactTextFallback(prompt, recommendedAction, exactPhrase);
  }

  const prompt = input.intentKind === "destructive" ? "Confirm destructive action?" : "Confirm protected action?";
  if (structuredConfirmationAvailable) {
    return {
      mode: "operator-approval-packet",
      decision: "ready-for-structured-approval",
      interaction: "yes-no",
      authorization: "none",
      dispatchAllowed: false,
      acceptsShortAnswer: true,
      requiresStructuredSignal: true,
      exactTextFallbackRequired: false,
      prompt,
      recommendedAction,
      allowedResponses: ["confirm", "decline"],
      blockers: [],
      auditContract: AUDIT_CONTRACT,
      summary: "operator-approval-packet: decision=ready-for-structured-approval interaction=yes-no shortAnswer=yes structured=yes exactFallback=no dispatch=no authorization=none",
    };
  }
  return exactTextFallback(prompt, recommendedAction, exactPhrase);
}

function exactTextFallback(
  prompt: string,
  recommendedAction: string | undefined,
  exactPhrase: string | undefined,
): OperatorApprovalPacket {
  return {
    mode: "operator-approval-packet",
    decision: "needs-exact-text-fallback",
    interaction: "exact-text-fallback",
    authorization: "none",
    dispatchAllowed: false,
    acceptsShortAnswer: false,
    requiresStructuredSignal: true,
    exactTextFallbackRequired: true,
    exactConfirmationPhrase: exactPhrase,
    prompt,
    recommendedAction,
    allowedResponses: exactPhrase ? [exactPhrase] : [],
    blockers: exactPhrase ? [] : ["exact-confirmation-phrase-missing"],
    auditContract: AUDIT_CONTRACT,
    summary: `operator-approval-packet: decision=needs-exact-text-fallback interaction=exact-text-fallback shortAnswer=no structured=yes exactFallback=yes${exactPhrase ? "" : " blockers=exact-confirmation-phrase-missing"} dispatch=no authorization=none`,
  };
}
