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

function normalizeContextLevel(value: unknown): UnattendedContinuationContextLevel {
  return value === "warn" || value === "checkpoint" || value === "compact" || value === "ok" ? value : "ok";
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
