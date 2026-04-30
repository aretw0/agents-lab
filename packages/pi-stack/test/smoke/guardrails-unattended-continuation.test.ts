import { describe, expect, it } from "vitest";
import {
  NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS,
  resolveNudgeFreeLoopCanaryGate,
  resolveUnattendedContinuationPlan,
} from "../../extensions/guardrails-core-unattended-continuation";

const completeMeasuredEvidence = [
  { gate: "next-local-safe", ok: true, evidence: "selector=local-safe" },
  { gate: "checkpoint-fresh", ok: true, evidence: "handoff=fresh" },
  { gate: "handoff-budget-ok", ok: true, evidence: "handoff-budget=ok" },
  { gate: "git-state-expected", ok: true, evidence: "git=expected" },
  { gate: "protected-scopes-clear", ok: true, evidence: "protected=clear" },
  { gate: "cooldown-ready", ok: true, evidence: "cooldown=ready" },
  { gate: "validation-known", ok: true, evidence: "validation=known" },
  { gate: "stop-conditions-clear", ok: true, evidence: "stops=clear" },
] as const;

const allMeasuredEvidenceGates = completeMeasuredEvidence.map((entry) => entry.gate);

describe("guardrails unattended continuation", () => {
  it("marks the nudge-free loop canary ready only when measured gates are covered", () => {
    const gate = resolveNudgeFreeLoopCanaryGate({
      optIn: true,
      nextLocalSafe: true,
      checkpointFresh: true,
      handoffBudgetOk: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      cooldownReady: true,
      validationKnown: true,
      stopConditionsClear: true,
      signalSource: "measured",
      measuredEvidence: [...completeMeasuredEvidence],
    });

    expect(gate).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "measured",
      measuredEvidenceCount: 8,
      maxMeasuredEvidenceChars: NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS,
      missingMeasuredEvidenceGates: [],
      invalidMeasuredEvidenceGates: [],
      decision: "ready",
      canContinueWithoutNudge: true,
      reasons: ["all-gates-green"],
      summary: "nudge-free-loop: effect=none decision=ready continue=yes reasons=all-gates-green",
    });
  });

  it("defers the nudge-free loop canary when measured evidence is missing", () => {
    const gate = resolveNudgeFreeLoopCanaryGate({
      optIn: true,
      nextLocalSafe: true,
      checkpointFresh: true,
      handoffBudgetOk: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      cooldownReady: true,
      validationKnown: true,
      stopConditionsClear: true,
      signalSource: "measured",
    });

    expect(gate).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "measured",
      measuredEvidenceCount: 0,
      maxMeasuredEvidenceChars: NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS,
      missingMeasuredEvidenceGates: allMeasuredEvidenceGates,
      invalidMeasuredEvidenceGates: [],
      decision: "defer",
      canContinueWithoutNudge: false,
      reasons: ["measured-evidence-missing"],
      summary: "nudge-free-loop: effect=none decision=defer continue=no reasons=measured-evidence-missing",
    });
  });

  it("defers the nudge-free loop canary when measured evidence is incomplete", () => {
    const gate = resolveNudgeFreeLoopCanaryGate({
      optIn: true,
      nextLocalSafe: true,
      checkpointFresh: true,
      handoffBudgetOk: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      cooldownReady: true,
      validationKnown: true,
      stopConditionsClear: true,
      signalSource: "measured",
      measuredEvidence: [{ gate: "checkpoint-fresh", ok: true, evidence: "handoff=fresh" }],
    });

    expect(gate).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "measured",
      measuredEvidenceCount: 1,
      maxMeasuredEvidenceChars: NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS,
      missingMeasuredEvidenceGates: [
        "next-local-safe",
        "handoff-budget-ok",
        "git-state-expected",
        "protected-scopes-clear",
        "cooldown-ready",
        "validation-known",
        "stop-conditions-clear",
      ],
      invalidMeasuredEvidenceGates: [],
      decision: "defer",
      canContinueWithoutNudge: false,
      reasons: ["measured-evidence-incomplete"],
      summary: "nudge-free-loop: effect=none decision=defer continue=no reasons=measured-evidence-incomplete",
    });
  });

  it("defers the nudge-free loop canary when measured evidence is too large", () => {
    const overlongEvidence = "x".repeat(NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS + 1);
    const gate = resolveNudgeFreeLoopCanaryGate({
      optIn: true,
      nextLocalSafe: true,
      checkpointFresh: true,
      handoffBudgetOk: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      cooldownReady: true,
      validationKnown: true,
      stopConditionsClear: true,
      signalSource: "measured",
      measuredEvidence: [
        { gate: "checkpoint-fresh", ok: true, evidence: overlongEvidence },
        ...completeMeasuredEvidence.filter((entry) => entry.gate !== "checkpoint-fresh"),
      ],
    });

    expect(gate).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "measured",
      measuredEvidenceCount: 7,
      maxMeasuredEvidenceChars: NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS,
      missingMeasuredEvidenceGates: ["checkpoint-fresh"],
      invalidMeasuredEvidenceGates: ["checkpoint-fresh"],
      decision: "defer",
      canContinueWithoutNudge: false,
      reasons: ["measured-evidence-invalid", "measured-evidence-incomplete"],
      summary: "nudge-free-loop: effect=none decision=defer continue=no reasons=measured-evidence-invalid,measured-evidence-incomplete",
    });
  });

  it("defers the nudge-free loop canary without explicit opt-in", () => {
    const gate = resolveNudgeFreeLoopCanaryGate({
      optIn: false,
      nextLocalSafe: true,
      checkpointFresh: true,
      handoffBudgetOk: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      cooldownReady: true,
      validationKnown: true,
      stopConditionsClear: true,
      signalSource: "measured",
      measuredEvidence: [...completeMeasuredEvidence],
    });

    expect(gate).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "measured",
      measuredEvidenceCount: 8,
      maxMeasuredEvidenceChars: NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS,
      missingMeasuredEvidenceGates: [],
      invalidMeasuredEvidenceGates: [],
      decision: "defer",
      canContinueWithoutNudge: false,
      reasons: ["missing-opt-in"],
      summary: "nudge-free-loop: effect=none decision=defer continue=no reasons=missing-opt-in",
    });
  });

  it("defers the nudge-free loop canary when booleans are manually supplied", () => {
    const gate = resolveNudgeFreeLoopCanaryGate({
      optIn: true,
      nextLocalSafe: true,
      checkpointFresh: true,
      handoffBudgetOk: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      cooldownReady: true,
      validationKnown: true,
      stopConditionsClear: true,
    });

    expect(gate).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "manual",
      measuredEvidenceCount: 0,
      maxMeasuredEvidenceChars: NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS,
      missingMeasuredEvidenceGates: allMeasuredEvidenceGates,
      invalidMeasuredEvidenceGates: [],
      decision: "defer",
      canContinueWithoutNudge: false,
      reasons: ["manual-signal-source"],
      summary: "nudge-free-loop: effect=none decision=defer continue=no reasons=manual-signal-source",
    });
  });

  it("blocks the nudge-free loop canary on protected scope, unexpected git state or stop condition", () => {
    const gate = resolveNudgeFreeLoopCanaryGate({
      optIn: true,
      nextLocalSafe: true,
      checkpointFresh: true,
      handoffBudgetOk: true,
      gitStateExpected: false,
      protectedScopesClear: false,
      cooldownReady: true,
      validationKnown: true,
      stopConditionsClear: false,
      signalSource: "measured",
      measuredEvidence: [...completeMeasuredEvidence],
    });

    expect(gate).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "measured",
      measuredEvidenceCount: 8,
      maxMeasuredEvidenceChars: NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS,
      missingMeasuredEvidenceGates: [],
      invalidMeasuredEvidenceGates: [],
      decision: "blocked",
      canContinueWithoutNudge: false,
      reasons: ["unexpected-git-state", "protected-scope-pending", "stop-condition-present"],
      summary: "nudge-free-loop: effect=none decision=blocked continue=no reasons=unexpected-git-state,protected-scope-pending,stop-condition-present",
    });
  });

  it("continues when the next slice is local-safe and progress is saved", () => {
    const plan = resolveUnattendedContinuationPlan({
      nextLocalSafe: true,
      protectedScope: false,
      risk: false,
      ambiguous: false,
      progressSaved: true,
      contextLevel: "checkpoint",
    });

    expect(plan).toMatchObject({
      decision: "continue-local",
      canContinue: true,
      reasons: ["local-safe-next-step", "checkpoint-progress-saved"],
      summary: "unattended-continuation: decision=continue-local continue=yes reasons=local-safe-next-step,checkpoint-progress-saved",
    });
  });

  it("asks for decision when focus is complete but the next step is ambiguous", () => {
    const plan = resolveUnattendedContinuationPlan({
      nextLocalSafe: false,
      protectedScope: false,
      risk: false,
      ambiguous: true,
      progressSaved: true,
      contextLevel: "ok",
    });

    expect(plan).toMatchObject({
      decision: "ask-decision",
      canContinue: false,
      reasons: ["ambiguous-next-step", "no-local-safe-next-step"],
    });
  });

  it("blocks protected scopes and real risk", () => {
    const plan = resolveUnattendedContinuationPlan({
      nextLocalSafe: true,
      protectedScope: true,
      risk: true,
      ambiguous: false,
      progressSaved: true,
      contextLevel: "ok",
    });

    expect(plan).toMatchObject({
      decision: "blocked",
      canContinue: false,
      reasons: ["risk", "protected-scope"],
    });
  });

  it("does not start new work in compact lane", () => {
    const saved = resolveUnattendedContinuationPlan({
      nextLocalSafe: true,
      protectedScope: false,
      risk: false,
      ambiguous: false,
      progressSaved: true,
      contextLevel: "compact",
    });
    const unsaved = resolveUnattendedContinuationPlan({
      nextLocalSafe: true,
      protectedScope: false,
      risk: false,
      ambiguous: false,
      progressSaved: false,
      contextLevel: "compact",
    });

    expect(saved.decision).toBe("pause-for-compact");
    expect(unsaved.decision).toBe("checkpoint");
  });
});
