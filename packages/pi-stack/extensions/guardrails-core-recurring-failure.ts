export type RecurringFailureHardeningDecision =
  | "observe"
  | "document-rule"
  | "create-primitive"
  | "add-runtime-guard"
  | "block-old-path";

export interface RecurringFailureHardeningInput {
  occurrenceCount: number;
  hasDocumentedRule?: boolean;
  hasPrimitive?: boolean;
  hasRegressionTest?: boolean;
  hasRuntimeGuard?: boolean;
  oldPathStillAvailable?: boolean;
}

export interface RecurringFailureHardeningPlan {
  decision: RecurringFailureHardeningDecision;
  hardIntentRequired: boolean;
  reasons: string[];
  nextActions: string[];
  summary: string;
}

function countOccurrences(value: unknown): number {
  const raw = Number(value);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

export function resolveRecurringFailureHardening(input: RecurringFailureHardeningInput): RecurringFailureHardeningPlan {
  const occurrenceCount = countOccurrences(input.occurrenceCount);
  const hasDocumentedRule = input.hasDocumentedRule === true;
  const hasPrimitive = input.hasPrimitive === true;
  const hasRegressionTest = input.hasRegressionTest === true;
  const hasRuntimeGuard = input.hasRuntimeGuard === true;
  const oldPathStillAvailable = input.oldPathStillAvailable !== false;
  const reasons: string[] = [];
  const nextActions: string[] = [];

  if (occurrenceCount <= 0) {
    return {
      decision: "observe",
      hardIntentRequired: false,
      reasons: ["no-occurrence"],
      nextActions: ["record-only-if-useful"],
      summary: "recurring-failure: decision=observe hardIntent=no occurrences=0 reasons=no-occurrence",
    };
  }

  if (occurrenceCount === 1 && !hasDocumentedRule) {
    return {
      decision: "document-rule",
      hardIntentRequired: false,
      reasons: ["first-occurrence", "rule-missing"],
      nextActions: ["document-short-rule", "add-board-note"],
      summary: "recurring-failure: decision=document-rule hardIntent=no occurrences=1 reasons=first-occurrence,rule-missing",
    };
  }

  if (occurrenceCount >= 2 && (!hasPrimitive || !hasRegressionTest)) {
    if (!hasPrimitive) reasons.push("primitive-missing");
    if (!hasRegressionTest) reasons.push("regression-test-missing");
    nextActions.push("create-pure-primitive", "add-regression-test");
    if (!hasDocumentedRule) nextActions.push("document-rule");
    return {
      decision: "create-primitive",
      hardIntentRequired: true,
      reasons,
      nextActions,
      summary: `recurring-failure: decision=create-primitive hardIntent=yes occurrences=${occurrenceCount} reasons=${reasons.join(",")}`,
    };
  }

  if (occurrenceCount >= 2 && !hasRuntimeGuard) {
    return {
      decision: "add-runtime-guard",
      hardIntentRequired: true,
      reasons: ["runtime-guard-missing"],
      nextActions: ["expose-readonly-tool-or-monitor", "record-compact-summary"],
      summary: `recurring-failure: decision=add-runtime-guard hardIntent=yes occurrences=${occurrenceCount} reasons=runtime-guard-missing`,
    };
  }

  if (occurrenceCount >= 3 && oldPathStillAvailable) {
    return {
      decision: "block-old-path",
      hardIntentRequired: true,
      reasons: ["old-path-still-available", "third-occurrence"],
      nextActions: ["route-to-guarded-path", "warn-or-block-legacy-path"],
      summary: `recurring-failure: decision=block-old-path hardIntent=yes occurrences=${occurrenceCount} reasons=old-path-still-available,third-occurrence`,
    };
  }

  return {
    decision: "observe",
    hardIntentRequired: false,
    reasons: ["mitigated"],
    nextActions: ["keep-using-guarded-path"],
    summary: `recurring-failure: decision=observe hardIntent=no occurrences=${occurrenceCount} reasons=mitigated`,
  };
}
