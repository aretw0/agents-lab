import type { LongRunLoopRuntimeState } from "./guardrails-core-lane-queue";
import type { LoopActivationEvidenceState, LoopEvidenceReadiness } from "./guardrails-core-lane-queue-evidence";

export type LoopHeartbeatRuntimeSnapshot = Pick<LongRunLoopRuntimeState, "mode" | "health" | "stopCondition" | "leaseExpiresAtIso">;

export type LoopEvidenceHeartbeatRefreshResult = {
  updated: boolean;
  nextLastHeartbeatAt: number;
  auditPayload?: {
    atIso: string;
    markersLabel: string;
    runtimeCodeState: string;
    boardAutoAdvanceGate: string;
    nextTaskId?: string;
    milestone?: string;
    source: "snapshot-refresh";
  };
};

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
