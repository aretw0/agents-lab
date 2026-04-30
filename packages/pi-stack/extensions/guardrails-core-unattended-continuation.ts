export type UnattendedContinuationContextLevel = "ok" | "warn" | "checkpoint" | "compact";
export type UnattendedContinuationDecision = "continue-local" | "checkpoint" | "pause-for-compact" | "ask-decision" | "blocked";

export interface UnattendedContinuationInput {
  nextLocalSafe: boolean;
  protectedScope: boolean;
  risk: boolean;
  ambiguous: boolean;
  progressSaved: boolean;
  contextLevel: UnattendedContinuationContextLevel;
}

export interface UnattendedContinuationPlan {
  decision: UnattendedContinuationDecision;
  canContinue: boolean;
  reasons: string[];
  summary: string;
  recommendation: string;
}

export type NudgeFreeLoopCanarySignalSource = "manual" | "measured";
export type NudgeFreeLoopMeasuredGate =
  | "next-local-safe"
  | "checkpoint-fresh"
  | "handoff-budget-ok"
  | "git-state-expected"
  | "protected-scopes-clear"
  | "cooldown-ready"
  | "validation-known"
  | "stop-conditions-clear";

export interface NudgeFreeLoopMeasuredEvidenceEntry {
  gate: NudgeFreeLoopMeasuredGate;
  ok: boolean;
  evidence: string;
}

export interface NudgeFreeLoopCanaryInput {
  optIn: boolean;
  nextLocalSafe: boolean;
  checkpointFresh: boolean;
  handoffBudgetOk: boolean;
  gitStateExpected: boolean;
  protectedScopesClear: boolean;
  cooldownReady: boolean;
  validationKnown: boolean;
  stopConditionsClear: boolean;
  signalSource?: NudgeFreeLoopCanarySignalSource;
  measuredEvidence?: NudgeFreeLoopMeasuredEvidenceEntry[];
}

export interface NudgeFreeLoopMeasuredSignal {
  ok: boolean;
  evidence: string;
}

export type NudgeFreeLoopMeasuredSignals = Record<NudgeFreeLoopMeasuredGate, NudgeFreeLoopMeasuredSignal>;

export interface NudgeFreeLoopMeasuredCanaryInput {
  optIn: boolean;
  signals: NudgeFreeLoopMeasuredSignals;
}

export type NudgeFreeLoopCanaryDecision = "ready" | "defer" | "blocked";

export interface NudgeFreeLoopCanaryGate {
  effect: "none";
  mode: "advisory";
  activation: "none";
  signalSource: NudgeFreeLoopCanarySignalSource;
  measuredEvidenceCount: number;
  maxMeasuredEvidenceChars: number;
  missingMeasuredEvidenceGates: NudgeFreeLoopMeasuredGate[];
  invalidMeasuredEvidenceGates: NudgeFreeLoopMeasuredGate[];
  decision: NudgeFreeLoopCanaryDecision;
  canContinueWithoutNudge: boolean;
  reasons: string[];
  summary: string;
  recommendation: string;
}

function normalizeContextLevel(value: unknown): UnattendedContinuationContextLevel {
  return value === "warn" || value === "checkpoint" || value === "compact" || value === "ok" ? value : "ok";
}

export const NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS = 120;

const REQUIRED_NUDGE_FREE_MEASURED_GATES: NudgeFreeLoopMeasuredGate[] = [
  "next-local-safe",
  "checkpoint-fresh",
  "handoff-budget-ok",
  "git-state-expected",
  "protected-scopes-clear",
  "cooldown-ready",
  "validation-known",
  "stop-conditions-clear",
];

function evaluateMeasuredEvidenceCoverage(entries: NudgeFreeLoopMeasuredEvidenceEntry[] | undefined): {
  measuredEvidenceCount: number;
  missingMeasuredEvidenceGates: NudgeFreeLoopMeasuredGate[];
  invalidMeasuredEvidenceGates: NudgeFreeLoopMeasuredGate[];
} {
  const covered = new Set<NudgeFreeLoopMeasuredGate>();
  const invalid = new Set<NudgeFreeLoopMeasuredGate>();
  for (const entry of entries ?? []) {
    const evidence = entry.evidence.trim();
    if (!entry.ok || evidence.length === 0) continue;
    if (evidence.length > NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS) {
      invalid.add(entry.gate);
      continue;
    }
    covered.add(entry.gate);
  }
  return {
    measuredEvidenceCount: covered.size,
    missingMeasuredEvidenceGates: REQUIRED_NUDGE_FREE_MEASURED_GATES.filter((gate) => !covered.has(gate)),
    invalidMeasuredEvidenceGates: [...invalid],
  };
}

export function resolveMeasuredNudgeFreeLoopCanaryGate(input: NudgeFreeLoopMeasuredCanaryInput): NudgeFreeLoopCanaryGate {
  const signal = (gate: NudgeFreeLoopMeasuredGate): NudgeFreeLoopMeasuredSignal => input.signals[gate] ?? { ok: false, evidence: "" };
  return resolveNudgeFreeLoopCanaryGate({
    optIn: input.optIn,
    nextLocalSafe: signal("next-local-safe").ok,
    checkpointFresh: signal("checkpoint-fresh").ok,
    handoffBudgetOk: signal("handoff-budget-ok").ok,
    gitStateExpected: signal("git-state-expected").ok,
    protectedScopesClear: signal("protected-scopes-clear").ok,
    cooldownReady: signal("cooldown-ready").ok,
    validationKnown: signal("validation-known").ok,
    stopConditionsClear: signal("stop-conditions-clear").ok,
    signalSource: "measured",
    measuredEvidence: REQUIRED_NUDGE_FREE_MEASURED_GATES.map((gate) => ({
      gate,
      ok: signal(gate).ok,
      evidence: signal(gate).evidence,
    })),
  });
}

export function resolveNudgeFreeLoopCanaryGate(input: NudgeFreeLoopCanaryInput): NudgeFreeLoopCanaryGate {
  const reasons: string[] = [];
  const signalSource: NudgeFreeLoopCanarySignalSource = input.signalSource === "measured" ? "measured" : "manual";
  const { measuredEvidenceCount, missingMeasuredEvidenceGates, invalidMeasuredEvidenceGates } = evaluateMeasuredEvidenceCoverage(input.measuredEvidence);
  if (signalSource !== "measured") reasons.push("manual-signal-source");
  if (signalSource === "measured" && invalidMeasuredEvidenceGates.length > 0) reasons.push("measured-evidence-invalid");
  if (signalSource === "measured" && measuredEvidenceCount === 0) reasons.push("measured-evidence-missing");
  if (signalSource === "measured" && measuredEvidenceCount > 0 && missingMeasuredEvidenceGates.length > 0) reasons.push("measured-evidence-incomplete");
  if (!input.optIn) reasons.push("missing-opt-in");
  if (!input.nextLocalSafe) reasons.push("no-local-safe-next-step");
  if (!input.checkpointFresh) reasons.push("checkpoint-not-fresh");
  if (!input.handoffBudgetOk) reasons.push("handoff-budget-not-ok");
  if (!input.gitStateExpected) reasons.push("unexpected-git-state");
  if (!input.protectedScopesClear) reasons.push("protected-scope-pending");
  if (!input.cooldownReady) reasons.push("cooldown-not-ready");
  if (!input.validationKnown) reasons.push("validation-unknown");
  if (!input.stopConditionsClear) reasons.push("stop-condition-present");

  const blocked = reasons.some((reason) => (
    reason === "unexpected-git-state" || reason === "protected-scope-pending" || reason === "stop-condition-present"
  ));
  if (blocked) {
    return {
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource,
      measuredEvidenceCount,
      maxMeasuredEvidenceChars: NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS,
      missingMeasuredEvidenceGates,
      invalidMeasuredEvidenceGates,
      decision: "blocked",
      canContinueWithoutNudge: false,
      reasons,
      summary: `nudge-free-loop: effect=none decision=blocked continue=no reasons=${reasons.join(",")}`,
      recommendation: "Stop the idle loop and ask the operator before continuing.",
    };
  }

  if (reasons.length > 0) {
    return {
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource,
      measuredEvidenceCount,
      maxMeasuredEvidenceChars: NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS,
      missingMeasuredEvidenceGates,
      invalidMeasuredEvidenceGates,
      decision: "defer",
      canContinueWithoutNudge: false,
      reasons,
      summary: `nudge-free-loop: effect=none decision=defer continue=no reasons=${reasons.join(",")}`,
      recommendation: "Do not continue without a nudge; satisfy the missing local gates first.",
    };
  }

  return {
    effect: "none",
    mode: "advisory",
    activation: "none",
    signalSource,
    measuredEvidenceCount,
    maxMeasuredEvidenceChars: NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS,
    missingMeasuredEvidenceGates,
    invalidMeasuredEvidenceGates,
    decision: "ready",
    canContinueWithoutNudge: true,
    reasons: ["all-gates-green"],
    summary: "nudge-free-loop: effect=none decision=ready continue=yes reasons=all-gates-green",
    recommendation: "A canary idle loop may continue the next small local-safe slice.",
  };
}

export function resolveUnattendedContinuationPlan(input: UnattendedContinuationInput): UnattendedContinuationPlan {
  const contextLevel = normalizeContextLevel(input.contextLevel);
  const reasons: string[] = [];

  if (input.risk) reasons.push("risk");
  if (input.protectedScope) reasons.push("protected-scope");
  if (reasons.length > 0) {
    return {
      decision: "blocked",
      canContinue: false,
      reasons,
      summary: `unattended-continuation: decision=blocked continue=no reasons=${reasons.join(",")}`,
      recommendation: "Stop and ask for operator intent before continuing.",
    };
  }

  if (contextLevel === "compact") {
    const decision: UnattendedContinuationDecision = input.progressSaved ? "pause-for-compact" : "checkpoint";
    const compactReasons = input.progressSaved ? ["compact"] : ["compact", "progress-not-saved"];
    return {
      decision,
      canContinue: false,
      reasons: compactReasons,
      summary: `unattended-continuation: decision=${decision} continue=no reasons=${compactReasons.join(",")}`,
      recommendation: input.progressSaved
        ? "Do not start new work; let compact/auto-resume continue from saved handoff."
        : "Write a compact handoff checkpoint before allowing compact.",
    };
  }

  if (input.ambiguous) reasons.push("ambiguous-next-step");
  if (!input.nextLocalSafe) reasons.push("no-local-safe-next-step");
  if (reasons.length > 0) {
    return {
      decision: "ask-decision",
      canContinue: false,
      reasons,
      summary: `unattended-continuation: decision=ask-decision continue=no reasons=${reasons.join(",")}`,
      recommendation: "Ask for the next focus instead of drifting into lateral or protected work.",
    };
  }

  if (contextLevel === "checkpoint" && !input.progressSaved) {
    return {
      decision: "checkpoint",
      canContinue: false,
      reasons: ["checkpoint", "progress-not-saved"],
      summary: "unattended-continuation: decision=checkpoint continue=no reasons=checkpoint,progress-not-saved",
      recommendation: "Refresh handoff before the next bounded local slice.",
    };
  }

  const reasonsOk = contextLevel === "checkpoint" ? ["local-safe-next-step", "checkpoint-progress-saved"] : ["local-safe-next-step"];
  return {
    decision: "continue-local",
    canContinue: true,
    reasons: reasonsOk,
    summary: `unattended-continuation: decision=continue-local continue=yes reasons=${reasonsOk.join(",")}`,
    recommendation: "Continue with the next small local-first slice; validate, commit, and record compact evidence.",
  };
}
