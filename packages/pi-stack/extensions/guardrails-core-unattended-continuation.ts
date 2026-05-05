import type { UnattendedContinuationContextLevel, UnattendedContinuationDecision, UnattendedContinuationInput, UnattendedContinuationPlan, NudgeFreeLoopCanarySignalSource, NudgeFreeLoopValidationKind, NudgeFreeLoopStopConditionKind, NudgeFreeLoopMeasuredGate, NudgeFreeLoopMeasuredEvidenceEntry, NudgeFreeLoopCanaryInput, NudgeFreeLoopMeasuredSignal, NudgeFreeLoopStopConditionSignal, NudgeFreeLoopLocalCandidate, NudgeFreeLoopMeasuredSignals, NudgeFreeLoopMeasuredCanaryInput, NudgeFreeLoopLocalMeasuredCanaryInput, NudgeFreeLoopLocalMeasuredCanaryPacket, NudgeFreeLoopPacketFactSource, NudgeFreeLoopLocalFactKey, NudgeFreeLoopLocalFactOrigin, NudgeFreeLoopLocalFactCollectorStatus, NudgeFreeLoopLocalReadStatus, NudgeFreeLoopLocalFactCollectorResult, NudgeFreeLoopFactSourceAssessment, NudgeFreeLoopFactCollectorAssessment, NudgeFreeLoopLocalMeasuredAuditEnvelope, NudgeFreeLoopLocalCollectedFactsInput, NudgeFreeLoopPreparedLocalMeasuredAuditEnvelope, NudgeFreeLoopMeasuredPacketTrust, NudgeFreeLoopCanaryDecision, SelfReloadAutoresumeCanaryDecision, SelfReloadAutoresumeCanaryInput, SelfReloadAutoresumeCanaryPlan, NudgeFreeLoopCanaryGate } from "./guardrails-core-unattended-continuation-types";
export type * from "./guardrails-core-unattended-continuation-types";

export {
  buildOneSliceLocalCanaryDispatchDecisionPacket,
  resolveOneSliceExecutorBacklogGate,
  resolveOneSliceLocalCanaryPlan,
  reviewOneSliceLocalHumanConfirmedContract,
} from "./guardrails-core-one-slice-contracts";

export type {
  OneSliceExecutorBacklogGate,
  OneSliceExecutorBacklogGateDecision,
  OneSliceExecutorBacklogGateInput,
  OneSliceLocalCanaryDecision,
  OneSliceLocalCanaryDispatchDecisionPacket,
  OneSliceLocalCanaryDispatchPacketDecision,
  OneSliceLocalCanaryDispatchPacketInput,
  OneSliceLocalCanaryInput,
  OneSliceLocalCanaryOperatorIntent,
  OneSliceLocalCanaryPlan,
  OneSliceLocalHumanConfirmationKind,
  OneSliceLocalHumanConfirmedContractDecision,
  OneSliceLocalHumanConfirmedContractInput,
  OneSliceLocalHumanConfirmedContractReview,
} from "./guardrails-core-one-slice-contracts";

function normalizeContextLevel(value: unknown): UnattendedContinuationContextLevel {
  return value === "warn" || value === "checkpoint" || value === "compact" || value === "ok" ? value : "ok";
}

export const NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS = 120;

export function resolveNextLocalSafeMeasuredSignal(candidate: NudgeFreeLoopLocalCandidate): NudgeFreeLoopMeasuredSignal {
  const reasons: string[] = [];
  if (!candidate.taskId?.trim()) reasons.push("missing-task");
  if (candidate.scope !== "local") reasons.push(`scope-${candidate.scope}`);
  if (!Number.isFinite(candidate.estimatedFiles) || candidate.estimatedFiles < 0) reasons.push("files-invalid");
  else if (candidate.estimatedFiles > 3) reasons.push("files-large");
  if (candidate.reversible !== "git") reasons.push(`reversible-${candidate.reversible}`);
  if (candidate.validationKind === "unknown") reasons.push("validation-unknown");
  if (candidate.requiresProductDecision) reasons.push("product-decision");
  if (candidate.risk !== "none" && candidate.risk !== "low") reasons.push(`risk-${candidate.risk}`);
  const protectedPathCount = (candidate.protectedPaths ?? []).filter(isProtectedMeasuredPath).length;
  if (protectedPathCount > 0) reasons.push(`protected-paths-${protectedPathCount}`);

  if (reasons.length > 0) {
    return { ok: false, evidence: `next-local-safe=no reasons=${reasons.slice(0, 3).join("|")}` };
  }
  return { ok: true, evidence: `next-local-safe=yes task=${candidate.taskId?.trim()} files=${candidate.estimatedFiles}` };
}

export function resolveCheckpointFreshMeasuredSignal(input: {
  handoffTimestampIso?: string;
  nowMs: number;
  maxAgeMs: number;
}): NudgeFreeLoopMeasuredSignal {
  if (!input.handoffTimestampIso?.trim()) {
    return { ok: false, evidence: "checkpoint=missing" };
  }
  const timestampMs = Date.parse(input.handoffTimestampIso);
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, evidence: "checkpoint=invalid-ts" };
  }
  const ageMs = input.nowMs - timestampMs;
  if (ageMs < 0) {
    return { ok: false, evidence: "checkpoint=future-ts" };
  }
  const ageSec = Math.floor(ageMs / 1000);
  const maxAgeSec = Math.floor(input.maxAgeMs / 1000);
  if (ageMs > input.maxAgeMs) {
    return { ok: false, evidence: `checkpoint=stale ageSec=${ageSec} maxSec=${maxAgeSec}` };
  }
  return { ok: true, evidence: `checkpoint=fresh ageSec=${ageSec} maxSec=${maxAgeSec}` };
}

export function resolveHandoffBudgetMeasuredSignal(input: {
  jsonChars: number;
  maxJsonChars: number;
}): NudgeFreeLoopMeasuredSignal {
  if (!Number.isFinite(input.jsonChars) || input.jsonChars < 0) {
    return { ok: false, evidence: "handoff-budget=invalid-jsonChars" };
  }
  if (!Number.isFinite(input.maxJsonChars) || input.maxJsonChars <= 0) {
    return { ok: false, evidence: "handoff-budget=invalid-max" };
  }
  if (input.jsonChars > input.maxJsonChars) {
    return { ok: false, evidence: `handoff-budget=over chars=${Math.floor(input.jsonChars)} max=${Math.floor(input.maxJsonChars)}` };
  }
  return { ok: true, evidence: `handoff-budget=ok chars=${Math.floor(input.jsonChars)} max=${Math.floor(input.maxJsonChars)}` };
}

function normalizeMeasuredPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function compactMeasuredPath(path: string): string {
  const normalized = normalizeMeasuredPath(path);
  return normalized.length > 28 ? `${normalized.slice(0, 25)}...` : normalized;
}

function isProtectedMeasuredPath(path: string): boolean {
  const normalized = normalizeMeasuredPath(path);
  return normalized === ".pi/settings.json"
    || normalized.startsWith(".obsidian/")
    || normalized === ".obsidian"
    || normalized.startsWith(".github/");
}

export function resolveProtectedScopesMeasuredSignal(input: {
  paths: string[];
}): NudgeFreeLoopMeasuredSignal {
  const protectedPaths = input.paths.filter(isProtectedMeasuredPath);
  if (protectedPaths.length === 0) {
    return { ok: true, evidence: `protected=clear paths=${input.paths.length}` };
  }
  const first = protectedPaths.slice(0, 2).map(compactMeasuredPath).join("|");
  return { ok: false, evidence: `protected=pending count=${protectedPaths.length} first=${first}` };
}

export function resolveGitStateExpectedMeasuredSignal(input: {
  changedPaths: string[];
  expectedPaths: string[];
}): NudgeFreeLoopMeasuredSignal {
  const changed = input.changedPaths.map(normalizeMeasuredPath).filter(Boolean);
  if (changed.length === 0) {
    return { ok: true, evidence: "git=clean changed=0" };
  }
  const expected = new Set(input.expectedPaths.map(normalizeMeasuredPath).filter(Boolean));
  const unexpected = changed.filter((path) => !expected.has(path));
  if (unexpected.length === 0) {
    return { ok: true, evidence: `git=expected changed=${changed.length}` };
  }
  const first = unexpected.slice(0, 2).map(compactMeasuredPath).join("|");
  return { ok: false, evidence: `git=unexpected count=${unexpected.length} first=${first}` };
}

export function resolveCooldownReadyMeasuredSignal(input: {
  lastRunAtIso?: string;
  nowMs: number;
  cooldownMs: number;
}): NudgeFreeLoopMeasuredSignal {
  if (!Number.isFinite(input.cooldownMs) || input.cooldownMs < 0) {
    return { ok: false, evidence: "cooldown=invalid-max" };
  }
  const cooldownSec = Math.floor(input.cooldownMs / 1000);
  if (!input.lastRunAtIso?.trim()) {
    return { ok: true, evidence: `cooldown=ready previous=none maxSec=${cooldownSec}` };
  }
  const lastRunMs = Date.parse(input.lastRunAtIso);
  if (!Number.isFinite(lastRunMs)) {
    return { ok: false, evidence: "cooldown=invalid-ts" };
  }
  const elapsedMs = input.nowMs - lastRunMs;
  if (elapsedMs < 0) {
    return { ok: false, evidence: "cooldown=future-ts" };
  }
  const elapsedSec = Math.floor(elapsedMs / 1000);
  if (elapsedMs < input.cooldownMs) {
    const remainingSec = Math.ceil((input.cooldownMs - elapsedMs) / 1000);
    return { ok: false, evidence: `cooldown=wait remainingSec=${remainingSec} elapsedSec=${elapsedSec}` };
  }
  return { ok: true, evidence: `cooldown=ready elapsedSec=${elapsedSec} maxSec=${cooldownSec}` };
}

export function resolveValidationKnownMeasuredSignal(input: {
  kind: NudgeFreeLoopValidationKind;
  focalGate?: string;
}): NudgeFreeLoopMeasuredSignal {
  if (input.kind === "unknown") {
    return { ok: false, evidence: "validation=unknown" };
  }
  if (input.kind === "focal-test") {
    const gate = input.focalGate?.trim();
    if (!gate) {
      return { ok: false, evidence: "validation=focal-test gate=missing" };
    }
    return { ok: true, evidence: `validation=focal-test gate=${gate.length > 32 ? `${gate.slice(0, 29)}...` : gate}` };
  }
  return { ok: true, evidence: `validation=${input.kind}` };
}

export function resolveStopConditionsClearMeasuredSignal(input: {
  conditions: NudgeFreeLoopStopConditionSignal[];
}): NudgeFreeLoopMeasuredSignal {
  const present = input.conditions.filter((condition) => condition.present);
  if (present.length === 0) {
    return { ok: true, evidence: `stops=clear checked=${input.conditions.length}` };
  }
  const first = present.slice(0, 2).map((condition) => condition.kind).join("|");
  return { ok: false, evidence: `stops=present count=${present.length} first=${first}` };
}

export function resolveNextLocalSafeCollectorResult(input: {
  readStatus: NudgeFreeLoopLocalReadStatus;
  candidate?: NudgeFreeLoopLocalCandidate;
}): NudgeFreeLoopLocalFactCollectorResult {
  if (input.readStatus === "missing") {
    return { fact: "candidate", status: "missing", evidence: "candidate=missing" };
  }
  if (input.readStatus === "error") {
    return { fact: "candidate", status: "invalid", evidence: "candidate=read-error" };
  }
  if (!input.candidate) {
    return { fact: "candidate", status: "invalid", evidence: "candidate=missing-candidate" };
  }
  const signal = resolveNextLocalSafeMeasuredSignal(input.candidate);
  return {
    fact: "candidate",
    status: signal.ok ? "observed" : "invalid",
    evidence: signal.evidence,
  };
}

export function resolveHandoffBudgetCollectorResult(input: {
  readStatus: NudgeFreeLoopLocalReadStatus;
  handoffJson?: string;
  maxJsonChars: number;
}): NudgeFreeLoopLocalFactCollectorResult {
  if (input.readStatus === "missing") {
    return { fact: "handoff-budget", status: "missing", evidence: "handoff-budget=missing" };
  }
  if (input.readStatus === "error") {
    return { fact: "handoff-budget", status: "invalid", evidence: "handoff-budget=read-error" };
  }
  if (typeof input.handoffJson !== "string") {
    return { fact: "handoff-budget", status: "invalid", evidence: "handoff-budget=missing-json" };
  }
  const signal = resolveHandoffBudgetMeasuredSignal({
    jsonChars: input.handoffJson.length,
    maxJsonChars: input.maxJsonChars,
  });
  return {
    fact: "handoff-budget",
    status: signal.ok ? "observed" : "invalid",
    evidence: signal.evidence,
  };
}

export function resolveCheckpointFreshCollectorResult(input: {
  readStatus: NudgeFreeLoopLocalReadStatus;
  handoffTimestampIso?: string;
  nowMs: number;
  maxAgeMs: number;
}): NudgeFreeLoopLocalFactCollectorResult {
  if (input.readStatus === "missing") {
    return { fact: "checkpoint", status: "missing", evidence: "checkpoint=missing" };
  }
  if (input.readStatus === "error") {
    return { fact: "checkpoint", status: "invalid", evidence: "checkpoint=read-error" };
  }
  const signal = resolveCheckpointFreshMeasuredSignal({
    handoffTimestampIso: input.handoffTimestampIso,
    nowMs: input.nowMs,
    maxAgeMs: input.maxAgeMs,
  });
  return {
    fact: "checkpoint",
    status: signal.ok ? "observed" : "invalid",
    evidence: signal.evidence,
  };
}

export function resolveGitStateExpectedCollectorResult(input: {
  readStatus: NudgeFreeLoopLocalReadStatus;
  changedPaths?: string[];
  expectedPaths: string[];
}): NudgeFreeLoopLocalFactCollectorResult {
  if (input.readStatus === "missing") {
    return { fact: "git-state", status: "missing", evidence: "git=missing" };
  }
  if (input.readStatus === "error") {
    return { fact: "git-state", status: "invalid", evidence: "git=read-error" };
  }
  if (!Array.isArray(input.changedPaths)) {
    return { fact: "git-state", status: "invalid", evidence: "git=missing-changes" };
  }
  const signal = resolveGitStateExpectedMeasuredSignal({
    changedPaths: input.changedPaths,
    expectedPaths: input.expectedPaths,
  });
  return {
    fact: "git-state",
    status: signal.ok ? "observed" : "invalid",
    evidence: signal.evidence,
  };
}

export function resolveProtectedScopesCollectorResult(input: {
  readStatus: NudgeFreeLoopLocalReadStatus;
  paths?: string[];
}): NudgeFreeLoopLocalFactCollectorResult {
  if (input.readStatus === "missing") {
    return { fact: "protected-scopes", status: "missing", evidence: "protected=missing" };
  }
  if (input.readStatus === "error") {
    return { fact: "protected-scopes", status: "invalid", evidence: "protected=read-error" };
  }
  if (!Array.isArray(input.paths)) {
    return { fact: "protected-scopes", status: "invalid", evidence: "protected=missing-paths" };
  }
  const signal = resolveProtectedScopesMeasuredSignal({ paths: input.paths });
  return {
    fact: "protected-scopes",
    status: signal.ok ? "observed" : "invalid",
    evidence: signal.evidence,
  };
}

export function resolveValidationKnownCollectorResult(input: {
  readStatus: NudgeFreeLoopLocalReadStatus;
  kind?: NudgeFreeLoopValidationKind;
  focalGate?: string;
}): NudgeFreeLoopLocalFactCollectorResult {
  if (input.readStatus === "missing") {
    return { fact: "validation", status: "missing", evidence: "validation=missing" };
  }
  if (input.readStatus === "error") {
    return { fact: "validation", status: "invalid", evidence: "validation=read-error" };
  }
  if (!input.kind) {
    return { fact: "validation", status: "invalid", evidence: "validation=missing-kind" };
  }
  const signal = resolveValidationKnownMeasuredSignal({ kind: input.kind, focalGate: input.focalGate });
  return {
    fact: "validation",
    status: signal.ok ? "observed" : "invalid",
    evidence: signal.evidence,
  };
}

export function resolveCooldownReadyCollectorResult(input: {
  readStatus: NudgeFreeLoopLocalReadStatus;
  lastRunAtIso?: string;
  nowMs: number;
  cooldownMs: number;
}): NudgeFreeLoopLocalFactCollectorResult {
  if (input.readStatus === "missing") {
    return { fact: "cooldown", status: "missing", evidence: "cooldown=missing" };
  }
  if (input.readStatus === "error") {
    return { fact: "cooldown", status: "invalid", evidence: "cooldown=read-error" };
  }
  const signal = resolveCooldownReadyMeasuredSignal({
    lastRunAtIso: input.lastRunAtIso,
    nowMs: input.nowMs,
    cooldownMs: input.cooldownMs,
  });
  return {
    fact: "cooldown",
    status: signal.ok ? "observed" : "invalid",
    evidence: signal.evidence,
  };
}

export function resolveStopConditionsClearCollectorResult(input: {
  readStatus: NudgeFreeLoopLocalReadStatus;
  conditions?: NudgeFreeLoopStopConditionSignal[];
}): NudgeFreeLoopLocalFactCollectorResult {
  if (input.readStatus === "missing") {
    return { fact: "stop-conditions", status: "missing", evidence: "stops=missing" };
  }
  if (input.readStatus === "error") {
    return { fact: "stop-conditions", status: "invalid", evidence: "stops=read-error" };
  }
  if (!Array.isArray(input.conditions)) {
    return { fact: "stop-conditions", status: "invalid", evidence: "stops=missing-conditions" };
  }
  const signal = resolveStopConditionsClearMeasuredSignal({ conditions: input.conditions });
  return {
    fact: "stop-conditions",
    status: signal.ok ? "observed" : "invalid",
    evidence: signal.evidence,
  };
}

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

const REQUIRED_NUDGE_FREE_LOCAL_FACTS: NudgeFreeLoopLocalFactKey[] = [
  "candidate",
  "checkpoint",
  "handoff-budget",
  "git-state",
  "protected-scopes",
  "cooldown",
  "validation",
  "stop-conditions",
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

export function resolveLocalNudgeFreeLoopMeasuredSignals(input: NudgeFreeLoopLocalMeasuredCanaryInput): NudgeFreeLoopMeasuredSignals {
  const protectedScopePaths = input.protectedScopePaths ?? [
    ...new Set([
      ...input.changedPaths,
      ...(input.candidate.protectedPaths ?? []),
    ].map(normalizeMeasuredPath).filter(Boolean)),
  ];
  return {
    "next-local-safe": resolveNextLocalSafeMeasuredSignal(input.candidate),
    "checkpoint-fresh": resolveCheckpointFreshMeasuredSignal({
      handoffTimestampIso: input.handoffTimestampIso,
      nowMs: input.nowMs,
      maxAgeMs: input.maxCheckpointAgeMs,
    }),
    "handoff-budget-ok": resolveHandoffBudgetMeasuredSignal({
      jsonChars: input.handoffJsonChars,
      maxJsonChars: input.maxHandoffJsonChars,
    }),
    "git-state-expected": resolveGitStateExpectedMeasuredSignal({
      changedPaths: input.changedPaths,
      expectedPaths: input.expectedPaths,
    }),
    "protected-scopes-clear": resolveProtectedScopesMeasuredSignal({ paths: protectedScopePaths }),
    "cooldown-ready": resolveCooldownReadyMeasuredSignal({
      lastRunAtIso: input.lastRunAtIso,
      nowMs: input.nowMs,
      cooldownMs: input.cooldownMs,
    }),
    "validation-known": resolveValidationKnownMeasuredSignal(input.validation),
    "stop-conditions-clear": resolveStopConditionsClearMeasuredSignal({ conditions: input.stopConditions }),
  };
}

export function buildLocalMeasuredNudgeFreeLoopCanaryPacket(input: NudgeFreeLoopLocalMeasuredCanaryInput): NudgeFreeLoopLocalMeasuredCanaryPacket {
  const signals = resolveLocalNudgeFreeLoopMeasuredSignals(input);
  const gate = resolveMeasuredNudgeFreeLoopCanaryGate({ optIn: input.optIn, signals });
  const evidence = REQUIRED_NUDGE_FREE_MEASURED_GATES.map((gateName) => ({
    gate: gateName,
    ok: signals[gateName].ok,
    evidence: signals[gateName].evidence,
  }));
  return {
    gate,
    signals,
    evidence,
    summary: `nudge-free-loop-packet: decision=${gate.decision} continue=${gate.canContinueWithoutNudge ? "yes" : "no"} evidence=${gate.measuredEvidenceCount}/${REQUIRED_NUDGE_FREE_MEASURED_GATES.length}`,
  };
}

export function resolveLocalMeasuredNudgeFreeLoopCanaryGate(input: NudgeFreeLoopLocalMeasuredCanaryInput): NudgeFreeLoopCanaryGate {
  return buildLocalMeasuredNudgeFreeLoopCanaryPacket(input).gate;
}

export function resolveMeasuredFactSourceAssessment(input: {
  facts: NudgeFreeLoopLocalFactOrigin[];
}): NudgeFreeLoopFactSourceAssessment {
  const byFact = new Map<NudgeFreeLoopLocalFactKey, NudgeFreeLoopLocalFactOrigin>();
  for (const fact of input.facts) {
    if (!byFact.has(fact.fact)) byFact.set(fact.fact, fact);
  }
  const missingLocalFacts = REQUIRED_NUDGE_FREE_LOCAL_FACTS.filter((fact) => !byFact.has(fact));
  const untrustedLocalFacts = REQUIRED_NUDGE_FREE_LOCAL_FACTS.filter((fact) => {
    const origin = byFact.get(fact);
    return Boolean(origin && origin.source !== "local-observed");
  });
  const invalidEvidenceFacts = REQUIRED_NUDGE_FREE_LOCAL_FACTS.filter((fact) => {
    const origin = byFact.get(fact);
    if (!origin) return false;
    const evidence = origin.evidence.trim();
    return evidence.length === 0 || evidence.length > NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS;
  });
  const localObservedCount = REQUIRED_NUDGE_FREE_LOCAL_FACTS.filter((fact) => byFact.get(fact)?.source === "local-observed").length;
  const hasAnyFact = input.facts.length > 0;
  const factSource: NudgeFreeLoopPacketFactSource = missingLocalFacts.length === 0 && untrustedLocalFacts.length === 0 && invalidEvidenceFacts.length === 0
    ? "local-observed"
    : !hasAnyFact
      ? "unknown"
      : localObservedCount > 0
        ? "mixed"
        : input.facts.some((fact) => fact.source === "caller-supplied")
          ? "caller-supplied"
          : "unknown";
  const reasons: string[] = [];
  if (missingLocalFacts.length > 0) reasons.push("missing-local-facts");
  if (untrustedLocalFacts.length > 0) reasons.push("untrusted-fact-source");
  if (invalidEvidenceFacts.length > 0) reasons.push("fact-evidence-invalid");
  const eligible = factSource === "local-observed" && reasons.length === 0;
  return {
    effect: "none",
    mode: "advisory",
    activation: "none",
    authorization: "none",
    factSource,
    localObservedCount,
    missingLocalFacts,
    untrustedLocalFacts,
    invalidEvidenceFacts,
    eligibleForMeasuredPacket: eligible,
    reasons: eligible ? ["all-facts-local-observed"] : reasons,
    summary: `nudge-free-fact-source: eligible=${eligible ? "yes" : "no"} source=${factSource} local=${localObservedCount}/${REQUIRED_NUDGE_FREE_LOCAL_FACTS.length} reasons=${eligible ? "all-facts-local-observed" : reasons.join("|")}`,
  };
}

export function resolveMeasuredFactCollectorAssessment(input: {
  results: NudgeFreeLoopLocalFactCollectorResult[];
}): NudgeFreeLoopFactCollectorAssessment {
  const collectorMissingFacts = input.results.filter((result) => result.status === "missing").map((result) => result.fact);
  const collectorUntrustedFacts = input.results.filter((result) => result.status === "untrusted").map((result) => result.fact);
  const collectorInvalidFacts = input.results.filter((result) => result.status === "invalid").map((result) => result.fact);
  const facts = input.results
    .filter((result) => result.status !== "missing")
    .map((result) => ({
      fact: result.fact,
      source: result.status === "observed" || result.status === "invalid"
        ? "local-observed" as const
        : result.source ?? "caller-supplied" as const,
      evidence: result.status === "invalid" && result.evidence.trim().length > 0
        ? ""
        : result.evidence,
    }));
  const assessment = resolveMeasuredFactSourceAssessment({ facts });
  const reasons = new Set(assessment.reasons);
  if (collectorMissingFacts.length > 0) reasons.add("collector-missing");
  if (collectorUntrustedFacts.length > 0) reasons.add("collector-untrusted");
  if (collectorInvalidFacts.length > 0) reasons.add("collector-invalid");
  const eligible = assessment.eligibleForMeasuredPacket
    && collectorMissingFacts.length === 0
    && collectorUntrustedFacts.length === 0
    && collectorInvalidFacts.length === 0;
  return {
    ...assessment,
    eligibleForMeasuredPacket: eligible,
    collectorMissingFacts,
    collectorUntrustedFacts,
    collectorInvalidFacts,
    reasons: eligible ? ["all-collectors-local-observed"] : [...reasons],
    summary: `nudge-free-fact-collectors: eligible=${eligible ? "yes" : "no"} source=${assessment.factSource} local=${assessment.localObservedCount}/${REQUIRED_NUDGE_FREE_LOCAL_FACTS.length} reasons=${eligible ? "all-collectors-local-observed" : [...reasons].join("|")}`,
  };
}

export function buildLocalMeasuredNudgeFreeLoopAuditEnvelope(input: {
  packetInput: NudgeFreeLoopLocalMeasuredCanaryInput;
  collectorResults: NudgeFreeLoopLocalFactCollectorResult[];
}): NudgeFreeLoopLocalMeasuredAuditEnvelope {
  const collectorAssessment = resolveMeasuredFactCollectorAssessment({ results: input.collectorResults });
  const packet = buildLocalMeasuredNudgeFreeLoopCanaryPacket(input.packetInput);
  const trust = resolveMeasuredPacketTrust({ packet, factSource: collectorAssessment.factSource });
  const reasons = new Set<string>();
  if (!collectorAssessment.eligibleForMeasuredPacket) reasons.add("collectors-not-eligible");
  if (packet.gate.decision !== "ready") reasons.add("packet-not-ready");
  if (!trust.eligibleForAuditedRuntimeSurface) reasons.add("trust-not-eligible");
  const eligible = reasons.size === 0;
  return {
    effect: "none",
    mode: "advisory",
    activation: "none",
    authorization: "none",
    eligibleForAuditedRuntimeSurface: eligible,
    collectorAssessment,
    packet,
    trust,
    reasons: eligible ? ["audit-envelope-eligible"] : [...reasons],
    summary: `nudge-free-audit-envelope: eligible=${eligible ? "yes" : "no"} packet=${packet.gate.decision} collectors=${collectorAssessment.eligibleForMeasuredPacket ? "yes" : "no"} trust=${trust.eligibleForAuditedRuntimeSurface ? "yes" : "no"} authorization=none`,
  };
}

function fallbackNudgeFreeLoopCandidate(): NudgeFreeLoopLocalCandidate {
  return {
    scope: "unknown",
    estimatedFiles: Number.NaN,
    reversible: "unknown",
    validationKind: "unknown",
    risk: "high",
  };
}

export function buildLocalMeasuredNudgeFreeLoopAuditEnvelopeFromCollectedFacts(
  input: NudgeFreeLoopLocalCollectedFactsInput,
): NudgeFreeLoopPreparedLocalMeasuredAuditEnvelope {
  const candidate = input.candidate.candidate ?? fallbackNudgeFreeLoopCandidate();
  const changedPaths = input.gitState.changedPaths ?? [];
  const expectedPaths = input.gitState.expectedPaths;
  const protectedScopePaths = input.protectedScopes.paths ?? [
    ...new Set([
      ...changedPaths,
      ...(candidate.protectedPaths ?? []),
    ].map(normalizeMeasuredPath).filter(Boolean)),
  ];
  const validation = {
    kind: input.validation.kind ?? "unknown" as const,
    focalGate: input.validation.focalGate,
  };
  const stopConditions = input.stopConditions.conditions ?? [];
  const collectorResults = [
    resolveNextLocalSafeCollectorResult(input.candidate),
    resolveCheckpointFreshCollectorResult({
      readStatus: input.checkpoint.readStatus,
      handoffTimestampIso: input.checkpoint.handoffTimestampIso,
      nowMs: input.nowMs,
      maxAgeMs: input.checkpoint.maxAgeMs,
    }),
    resolveHandoffBudgetCollectorResult(input.handoffBudget),
    resolveGitStateExpectedCollectorResult(input.gitState),
    resolveProtectedScopesCollectorResult(input.protectedScopes),
    resolveCooldownReadyCollectorResult({
      readStatus: input.cooldown.readStatus,
      lastRunAtIso: input.cooldown.lastRunAtIso,
      nowMs: input.nowMs,
      cooldownMs: input.cooldown.cooldownMs,
    }),
    resolveValidationKnownCollectorResult(input.validation),
    resolveStopConditionsClearCollectorResult(input.stopConditions),
  ];
  const packetInput: NudgeFreeLoopLocalMeasuredCanaryInput = {
    optIn: input.optIn,
    nowMs: input.nowMs,
    candidate,
    handoffTimestampIso: input.checkpoint.handoffTimestampIso,
    maxCheckpointAgeMs: input.checkpoint.maxAgeMs,
    handoffJsonChars: typeof input.handoffBudget.handoffJson === "string" ? input.handoffBudget.handoffJson.length : -1,
    maxHandoffJsonChars: input.handoffBudget.maxJsonChars,
    changedPaths,
    expectedPaths,
    protectedScopePaths,
    lastRunAtIso: input.cooldown.lastRunAtIso,
    cooldownMs: input.cooldown.cooldownMs,
    validation,
    stopConditions,
  };
  const envelope = buildLocalMeasuredNudgeFreeLoopAuditEnvelope({ packetInput, collectorResults });
  return {
    effect: "none",
    mode: "advisory",
    activation: "none",
    authorization: "none",
    collectorResults,
    packetInput,
    envelope,
    summary: `nudge-free-local-audit-prep: eligible=${envelope.eligibleForAuditedRuntimeSurface ? "yes" : "no"} collectors=${collectorResults.length}/${REQUIRED_NUDGE_FREE_LOCAL_FACTS.length} packet=${envelope.packet.gate.decision} authorization=none`,
  };
}

export function resolveMeasuredPacketTrust(input: {
  packet: NudgeFreeLoopLocalMeasuredCanaryPacket;
  factSource: NudgeFreeLoopPacketFactSource;
}): NudgeFreeLoopMeasuredPacketTrust {
  const reasons: string[] = [];
  if (input.factSource !== "local-observed") reasons.push("untrusted-fact-source");
  if (input.packet.gate.decision !== "ready") reasons.push("gate-not-ready");
  if (input.packet.gate.signalSource !== "measured") reasons.push("signal-source-not-measured");
  if (input.packet.gate.measuredEvidenceCount !== REQUIRED_NUDGE_FREE_MEASURED_GATES.length) reasons.push("evidence-incomplete");
  if (input.packet.gate.invalidMeasuredEvidenceGates.length > 0) reasons.push("evidence-invalid");
  if (input.packet.evidence.some((entry) => entry.evidence.length > NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS)) reasons.push("evidence-too-large");

  const eligible = reasons.length === 0;
  return {
    effect: "none",
    mode: "advisory",
    activation: "none",
    authorization: "none",
    factSource: input.factSource,
    eligibleForAuditedRuntimeSurface: eligible,
    reasons: eligible ? ["local-observed-ready-packet"] : reasons,
    summary: `nudge-free-packet-trust: eligible=${eligible ? "yes" : "no"} source=${input.factSource} reasons=${eligible ? "local-observed-ready-packet" : reasons.join("|")}`,
  };
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

export function resolveSelfReloadAutoresumeCanaryPlan(input: SelfReloadAutoresumeCanaryInput): SelfReloadAutoresumeCanaryPlan {
  const reasons: string[] = [];
  const blockedRequests: string[] = [];

  if (!input.optIn) reasons.push("missing-opt-in");
  if (!input.reloadRequired) reasons.push("reload-not-required");
  if (!input.checkpointFresh) reasons.push("checkpoint-not-fresh");
  if (!input.handoffBudgetOk) reasons.push("handoff-budget-not-ok");
  if (!input.gitStateExpected) reasons.push("unexpected-git-state");
  if (!input.protectedScopesClear) reasons.push("protected-scope-pending");
  if (!input.cooldownReady) reasons.push("cooldown-not-ready");
  if (!input.autoResumePreviewReady) reasons.push("auto-resume-preview-not-ready");
  if (!input.pendingMessagesClear) reasons.push("pending-messages");
  if (!input.recentSteerClear) reasons.push("recent-steer");
  if (!input.laneQueueClear) reasons.push("lane-queue-pending");
  if (!input.stopConditionsClear) reasons.push("stop-condition-present");
  if (input.contextLevel === "compact" && !input.checkpointFresh) reasons.push("compact-without-fresh-checkpoint");
  if (input.schedulerRequested) {
    reasons.push("scheduler-requested");
    blockedRequests.push("scheduler");
  }
  if (input.remoteOrOffloadRequested) {
    reasons.push("remote-or-offload-requested");
    blockedRequests.push("remote-or-offload");
  }
  if (input.githubActionsRequested) {
    reasons.push("github-actions-requested");
    blockedRequests.push("github-actions");
  }
  if (input.protectedScopeRequested) {
    reasons.push("protected-scope-requested");
    blockedRequests.push("protected-scope");
  }
  if (input.destructiveMaintenanceRequested) {
    reasons.push("destructive-maintenance-requested");
    blockedRequests.push("destructive-maintenance");
  }

  const hardBlock = reasons.some((reason) => [
    "unexpected-git-state",
    "protected-scope-pending",
    "pending-messages",
    "recent-steer",
    "lane-queue-pending",
    "stop-condition-present",
    "compact-without-fresh-checkpoint",
    "scheduler-requested",
    "remote-or-offload-requested",
    "github-actions-requested",
    "protected-scope-requested",
    "destructive-maintenance-requested",
  ].includes(reason));

  if (!input.reloadRequired && reasons.length === 1 && reasons[0] === "reload-not-required") {
    return {
      effect: "none",
      mode: "advisory",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      reloadAllowed: false,
      autoResumeDispatchAllowed: false,
      requiresHumanDecision: false,
      decision: "not-needed",
      reasons,
      summary: "self-reload-autoresume-canary: decision=not-needed reload=no autoResume=no dispatch=no reasons=reload-not-required authorization=none",
      recommendation: "Do not reload; continue from the current live runtime.",
    };
  }

  if (hardBlock || reasons.length > 0) {
    const blockedRequestsSummary = blockedRequests.length > 0 ? ` blockedRequests=${blockedRequests.join("|")}` : "";
    return {
      effect: "none",
      mode: "advisory",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      reloadAllowed: false,
      autoResumeDispatchAllowed: false,
      requiresHumanDecision: true,
      decision: "blocked",
      reasons,
      summary: `self-reload-autoresume-canary: decision=blocked reload=no autoResume=no dispatch=no reasons=${reasons.slice(0, 5).join(",")}${blockedRequestsSummary} authorization=none`,
      recommendation: "Do not self-reload; preserve progress and ask the operator after the missing gates are resolved.",
    };
  }

  return {
    effect: "none",
    mode: "advisory",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    reloadAllowed: false,
    autoResumeDispatchAllowed: false,
    requiresHumanDecision: true,
    decision: "ready-for-human-decision",
    reasons: ["all-gates-green", "human-decision-required", "execution-not-implemented"],
    summary: "self-reload-autoresume-canary: decision=ready-for-human-decision reload=no autoResume=no dispatch=no reasons=all-gates-green,human-decision-required,execution-not-implemented authorization=none",
    recommendation: "Present this evidence to the operator; runtime self-reload execution remains a separate protected implementation task.",
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
