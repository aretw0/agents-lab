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
export type NudgeFreeLoopValidationKind = "marker-check" | "focal-test" | "structured-read" | "unknown";
export type NudgeFreeLoopStopConditionKind =
  | "risk"
  | "protected-scope"
  | "ambiguous"
  | "test-failure"
  | "compact-unsaved"
  | "reload-required"
  | "handoff-invalid"
  | "blocker";
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

export interface NudgeFreeLoopStopConditionSignal {
  kind: NudgeFreeLoopStopConditionKind;
  present: boolean;
  evidence: string;
}

export interface NudgeFreeLoopLocalCandidate {
  taskId?: string;
  scope: "local" | "protected" | "remote" | "unknown";
  estimatedFiles: number;
  reversible: "git" | "none" | "unknown";
  validationKind: NudgeFreeLoopValidationKind;
  requiresProductDecision?: boolean;
  risk: "none" | "low" | "medium" | "high";
  protectedPaths?: string[];
}

export type NudgeFreeLoopMeasuredSignals = Record<NudgeFreeLoopMeasuredGate, NudgeFreeLoopMeasuredSignal>;

export interface NudgeFreeLoopMeasuredCanaryInput {
  optIn: boolean;
  signals: NudgeFreeLoopMeasuredSignals;
}

export interface NudgeFreeLoopLocalMeasuredCanaryInput {
  optIn: boolean;
  nowMs: number;
  candidate: NudgeFreeLoopLocalCandidate;
  handoffTimestampIso?: string;
  maxCheckpointAgeMs: number;
  handoffJsonChars: number;
  maxHandoffJsonChars: number;
  changedPaths: string[];
  expectedPaths: string[];
  protectedScopePaths?: string[];
  lastRunAtIso?: string;
  cooldownMs: number;
  validation: {
    kind: NudgeFreeLoopValidationKind;
    focalGate?: string;
  };
  stopConditions: NudgeFreeLoopStopConditionSignal[];
}

export interface NudgeFreeLoopLocalMeasuredCanaryPacket {
  gate: NudgeFreeLoopCanaryGate;
  signals: NudgeFreeLoopMeasuredSignals;
  evidence: NudgeFreeLoopMeasuredEvidenceEntry[];
  summary: string;
}

export type NudgeFreeLoopPacketFactSource = "local-observed" | "caller-supplied" | "mixed" | "unknown";
export type NudgeFreeLoopLocalFactKey =
  | "candidate"
  | "checkpoint"
  | "handoff-budget"
  | "git-state"
  | "protected-scopes"
  | "cooldown"
  | "validation"
  | "stop-conditions";

export interface NudgeFreeLoopLocalFactOrigin {
  fact: NudgeFreeLoopLocalFactKey;
  source: NudgeFreeLoopPacketFactSource;
  evidence: string;
}

export type NudgeFreeLoopLocalFactCollectorStatus = "observed" | "missing" | "untrusted" | "invalid";
export type NudgeFreeLoopLocalReadStatus = "observed" | "missing" | "error";

export interface NudgeFreeLoopLocalFactCollectorResult {
  fact: NudgeFreeLoopLocalFactKey;
  status: NudgeFreeLoopLocalFactCollectorStatus;
  evidence: string;
  source?: NudgeFreeLoopPacketFactSource;
}

export interface NudgeFreeLoopFactSourceAssessment {
  effect: "none";
  mode: "advisory";
  activation: "none";
  authorization: "none";
  factSource: NudgeFreeLoopPacketFactSource;
  localObservedCount: number;
  missingLocalFacts: NudgeFreeLoopLocalFactKey[];
  untrustedLocalFacts: NudgeFreeLoopLocalFactKey[];
  invalidEvidenceFacts: NudgeFreeLoopLocalFactKey[];
  eligibleForMeasuredPacket: boolean;
  reasons: string[];
  summary: string;
}

export interface NudgeFreeLoopFactCollectorAssessment extends NudgeFreeLoopFactSourceAssessment {
  collectorMissingFacts: NudgeFreeLoopLocalFactKey[];
  collectorUntrustedFacts: NudgeFreeLoopLocalFactKey[];
  collectorInvalidFacts: NudgeFreeLoopLocalFactKey[];
}

export interface NudgeFreeLoopLocalMeasuredAuditEnvelope {
  effect: "none";
  mode: "advisory";
  activation: "none";
  authorization: "none";
  eligibleForAuditedRuntimeSurface: boolean;
  collectorAssessment: NudgeFreeLoopFactCollectorAssessment;
  packet: NudgeFreeLoopLocalMeasuredCanaryPacket;
  trust: NudgeFreeLoopMeasuredPacketTrust;
  reasons: string[];
  summary: string;
}

export interface NudgeFreeLoopLocalCollectedFactsInput {
  optIn: boolean;
  nowMs: number;
  candidate: {
    readStatus: NudgeFreeLoopLocalReadStatus;
    candidate?: NudgeFreeLoopLocalCandidate;
  };
  checkpoint: {
    readStatus: NudgeFreeLoopLocalReadStatus;
    handoffTimestampIso?: string;
    maxAgeMs: number;
  };
  handoffBudget: {
    readStatus: NudgeFreeLoopLocalReadStatus;
    handoffJson?: string;
    maxJsonChars: number;
  };
  gitState: {
    readStatus: NudgeFreeLoopLocalReadStatus;
    changedPaths?: string[];
    expectedPaths: string[];
  };
  protectedScopes: {
    readStatus: NudgeFreeLoopLocalReadStatus;
    paths?: string[];
  };
  cooldown: {
    readStatus: NudgeFreeLoopLocalReadStatus;
    lastRunAtIso?: string;
    cooldownMs: number;
  };
  validation: {
    readStatus: NudgeFreeLoopLocalReadStatus;
    kind?: NudgeFreeLoopValidationKind;
    focalGate?: string;
  };
  stopConditions: {
    readStatus: NudgeFreeLoopLocalReadStatus;
    conditions?: NudgeFreeLoopStopConditionSignal[];
  };
}

export interface NudgeFreeLoopPreparedLocalMeasuredAuditEnvelope {
  effect: "none";
  mode: "advisory";
  activation: "none";
  authorization: "none";
  collectorResults: NudgeFreeLoopLocalFactCollectorResult[];
  packetInput: NudgeFreeLoopLocalMeasuredCanaryInput;
  envelope: NudgeFreeLoopLocalMeasuredAuditEnvelope;
  summary: string;
}

export interface NudgeFreeLoopMeasuredPacketTrust {
  effect: "none";
  mode: "advisory";
  activation: "none";
  authorization: "none";
  factSource: NudgeFreeLoopPacketFactSource;
  eligibleForAuditedRuntimeSurface: boolean;
  reasons: string[];
  summary: string;
}

export type NudgeFreeLoopCanaryDecision = "ready" | "defer" | "blocked";
export type SelfReloadAutoresumeCanaryDecision = "ready-for-human-decision" | "not-needed" | "blocked";

export interface SelfReloadAutoresumeCanaryInput {
  optIn: boolean;
  reloadRequired: boolean;
  checkpointFresh: boolean;
  handoffBudgetOk: boolean;
  gitStateExpected: boolean;
  protectedScopesClear: boolean;
  cooldownReady: boolean;
  autoResumePreviewReady: boolean;
  pendingMessagesClear: boolean;
  recentSteerClear: boolean;
  laneQueueClear: boolean;
  stopConditionsClear: boolean;
  contextLevel: UnattendedContinuationContextLevel;
  schedulerRequested?: boolean;
  remoteOrOffloadRequested?: boolean;
  githubActionsRequested?: boolean;
  protectedScopeRequested?: boolean;
  destructiveMaintenanceRequested?: boolean;
}

export interface SelfReloadAutoresumeCanaryPlan {
  effect: "none";
  mode: "advisory";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  reloadAllowed: false;
  autoResumeDispatchAllowed: false;
  requiresHumanDecision: boolean;
  decision: SelfReloadAutoresumeCanaryDecision;
  reasons: string[];
  summary: string;
  recommendation: string;
}

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
