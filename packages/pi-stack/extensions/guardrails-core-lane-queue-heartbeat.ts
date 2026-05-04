import type {
  BoardAutoAdvanceGateReason,
  LongRunLoopRuntimeMode,
  LongRunLoopRuntimeState,
  RuntimeCodeActivationState,
} from "./guardrails-core-lane-queue";
import type { LoopActivationEvidenceState, LoopEvidenceReadiness } from "./guardrails-core-lane-queue-evidence";

export type LoopHeartbeatRuntimeSnapshot = Pick<LongRunLoopRuntimeState, "mode" | "health" | "stopCondition" | "leaseExpiresAtIso">;

export type LoopEvidenceHeartbeatAuditPayload = {
  atIso: string;
  markersLabel: string;
  runtimeCodeState: RuntimeCodeActivationState;
  boardAutoAdvanceGate: BoardAutoAdvanceGateReason;
  nextTaskId?: string;
  milestone?: string;
};

export type LoopEvidenceHeartbeatRefreshResult = {
  updated: boolean;
  nextLastHeartbeatAt: number;
  auditPayload?: LoopEvidenceHeartbeatAuditPayload & {
    source?: "snapshot-refresh";
  };
};

export function recordLoopReadyEvidence(input: {
  cwd: string;
  markersLabel: string;
  runtimeCodeState: RuntimeCodeActivationState;
  boardAutoAdvanceGate: BoardAutoAdvanceGateReason;
  nextTaskId?: string;
  milestone?: string;
  nowMs?: number;
  readEvidence: (cwd: string) => LoopActivationEvidenceState;
  writeEvidence: (cwd: string, evidence: LoopActivationEvidenceState) => string;
}): { atIso: string } {
  const atIso = new Date(Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now()).toISOString();
  const evidence = input.readEvidence(input.cwd);
  evidence.updatedAtIso = atIso;
  evidence.lastLoopReady = {
    atIso,
    markersLabel: input.markersLabel,
    runtimeCodeState: input.runtimeCodeState,
    boardAutoAdvanceGate: input.boardAutoAdvanceGate,
    nextTaskId: input.nextTaskId,
    milestone: input.milestone,
  };
  input.writeEvidence(input.cwd, evidence);
  return { atIso };
}

export function recordBoardAutoAdvanceEvidence(input: {
  cwd: string;
  taskId: string;
  milestone?: string;
  runtimeCodeState: RuntimeCodeActivationState;
  markersLabel: string;
  emLoop: boolean;
  nowMs?: number;
  readEvidence: (cwd: string) => LoopActivationEvidenceState;
  writeEvidence: (cwd: string, evidence: LoopActivationEvidenceState) => string;
}): { atIso: string } {
  const atIso = new Date(Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now()).toISOString();
  const evidence = input.readEvidence(input.cwd);
  evidence.updatedAtIso = atIso;
  evidence.lastBoardAutoAdvance = {
    atIso,
    taskId: input.taskId,
    milestone: input.milestone,
    runtimeCodeState: input.runtimeCodeState,
    markersLabel: input.markersLabel,
    emLoop: input.emLoop,
  };
  input.writeEvidence(input.cwd, evidence);
  return { atIso };
}

export function refreshLoopEvidenceHeartbeat(input: {
  cwd: string;
  nowMs: number;
  lastHeartbeatAt: number;
  heartbeatIntervalMs?: number;
  markersLabel: string;
  runtimeCodeState: RuntimeCodeActivationState;
  boardAutoAdvanceGate: BoardAutoAdvanceGateReason;
  nextTaskId?: string;
  milestone?: string;
  readEvidence: (cwd: string) => LoopActivationEvidenceState;
  computeReadiness: (evidence: LoopActivationEvidenceState) => LoopEvidenceReadiness;
  writeEvidence: (cwd: string, evidence: LoopActivationEvidenceState) => string;
}): LoopEvidenceHeartbeatRefreshResult {
  const heartbeatIntervalMs = Math.max(1_000, Math.floor(Number(input.heartbeatIntervalMs ?? (5 * 60_000))));
  if (input.nowMs - input.lastHeartbeatAt < heartbeatIntervalMs) {
    return { updated: false, nextLastHeartbeatAt: input.lastHeartbeatAt };
  }
  const evidence = input.readEvidence(input.cwd);
  const readiness = input.computeReadiness(evidence);
  if (!readiness.readyForLoopEvidence || !evidence.lastLoopReady || !evidence.lastBoardAutoAdvance) {
    return { updated: false, nextLastHeartbeatAt: input.lastHeartbeatAt };
  }

  const atIso = new Date(input.nowMs).toISOString();
  evidence.updatedAtIso = atIso;
  evidence.lastLoopReady = {
    atIso,
    markersLabel: input.markersLabel,
    runtimeCodeState: input.runtimeCodeState,
    boardAutoAdvanceGate: input.boardAutoAdvanceGate,
    nextTaskId: input.nextTaskId,
    milestone: input.milestone,
  };
  input.writeEvidence(input.cwd, evidence);
  return {
    updated: true,
    nextLastHeartbeatAt: input.nowMs,
    auditPayload: {
      atIso,
      markersLabel: input.markersLabel,
      runtimeCodeState: input.runtimeCodeState,
      boardAutoAdvanceGate: input.boardAutoAdvanceGate,
      nextTaskId: input.nextTaskId,
      milestone: input.milestone,
    },
  };
}

export function refreshLoopLeaseOnActivity(input: {
  cwd: string;
  nowMs: number;
  lastLeaseRefreshAt: number;
  minIntervalMs?: number;
  mode: LongRunLoopRuntimeMode;
  reason: string;
  setRuntimeMode: (cwd: string, mode: LongRunLoopRuntimeMode, reason: string) => { state: LongRunLoopRuntimeState };
}): {
  updated: boolean;
  nextLastLeaseRefreshAt: number;
  nextState?: LongRunLoopRuntimeState;
} {
  if (input.mode !== "running") {
    return { updated: false, nextLastLeaseRefreshAt: input.lastLeaseRefreshAt };
  }
  const minIntervalMs = Math.max(1_000, Math.floor(Number(input.minIntervalMs ?? 10_000)));
  if (input.nowMs - input.lastLeaseRefreshAt < minIntervalMs) {
    return { updated: false, nextLastLeaseRefreshAt: input.lastLeaseRefreshAt };
  }
  const next = input.setRuntimeMode(input.cwd, input.mode, input.reason);
  return {
    updated: true,
    nextLastLeaseRefreshAt: input.nowMs,
    nextState: next.state,
  };
}

export function refreshLoopEvidenceHeartbeatFromSnapshot(input: {
  cwd: string;
  nowMs: number;
  lastHeartbeatAt: number;
  heartbeatIntervalMs?: number;
  readRuntime: (cwd: string) => LoopHeartbeatRuntimeSnapshot;
  shouldRefreshRuntime: (runtime: LoopHeartbeatRuntimeSnapshot, nowMs: number) => boolean;
  readEvidence: (cwd: string) => LoopActivationEvidenceState;
  computeReadiness: (evidence: LoopActivationEvidenceState) => LoopEvidenceReadiness;
  writeEvidence: (cwd: string, evidence: LoopActivationEvidenceState) => string;
}): LoopEvidenceHeartbeatRefreshResult {
  const heartbeatIntervalMs = Math.max(1_000, Math.floor(Number(input.heartbeatIntervalMs ?? (5 * 60_000))));
  if (input.nowMs - input.lastHeartbeatAt < heartbeatIntervalMs) {
    return { updated: false, nextLastHeartbeatAt: input.lastHeartbeatAt };
  }

  const runtime = input.readRuntime(input.cwd);
  if (!input.shouldRefreshRuntime(runtime, input.nowMs)) {
    return { updated: false, nextLastHeartbeatAt: input.lastHeartbeatAt };
  }

  const evidence = input.readEvidence(input.cwd);
  const readiness = input.computeReadiness(evidence);
  if (!readiness.readyForLoopEvidence || !evidence.lastLoopReady || !evidence.lastBoardAutoAdvance) {
    return { updated: false, nextLastHeartbeatAt: input.lastHeartbeatAt };
  }

  const atIso = new Date(input.nowMs).toISOString();
  evidence.updatedAtIso = atIso;
  evidence.lastLoopReady = { ...evidence.lastLoopReady, atIso };
  input.writeEvidence(input.cwd, evidence);

  return {
    updated: true,
    nextLastHeartbeatAt: input.nowMs,
    auditPayload: {
      atIso,
      markersLabel: evidence.lastLoopReady.markersLabel,
      runtimeCodeState: evidence.lastLoopReady.runtimeCodeState,
      boardAutoAdvanceGate: evidence.lastLoopReady.boardAutoAdvanceGate,
      nextTaskId: evidence.lastLoopReady.nextTaskId,
      milestone: evidence.lastLoopReady.milestone,
      source: "snapshot-refresh",
    },
  };
}
