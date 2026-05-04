import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  isLongRunLoopLeaseExpired,
  type BoardAutoAdvanceGateReason,
  type LongRunLoopRuntimeState,
  type RuntimeCodeActivationState,
} from "./guardrails-core-lane-queue";

export interface LoopActivationEvidenceState {
  version: 1;
  updatedAtIso: string;
  lastLoopReady?: {
    atIso: string;
    markersLabel: string;
    runtimeCodeState: RuntimeCodeActivationState;
    boardAutoAdvanceGate: BoardAutoAdvanceGateReason;
    nextTaskId?: string;
    milestone?: string;
  };
  lastBoardAutoAdvance?: {
    atIso: string;
    taskId: string;
    milestone?: string;
    runtimeCodeState: RuntimeCodeActivationState;
    markersLabel: string;
    emLoop: boolean;
  };
}

export interface LoopEvidenceReadiness {
  readyForLoopEvidence: boolean;
  readyForTaskBud125: boolean;
  criteria: string[];
}

export function computeLoopEvidenceReadiness(
  evidence: LoopActivationEvidenceState,
): LoopEvidenceReadiness {
  const loopReady = evidence.lastLoopReady;
  const boardAuto = evidence.lastBoardAutoAdvance;
  const boardRuntimeActive = Boolean(boardAuto && boardAuto.runtimeCodeState === "active");
  const boardEmLoop = Boolean(boardAuto && boardAuto.emLoop);
  const loopRuntimeActive = Boolean(loopReady && loopReady.runtimeCodeState === "active");
  const criteria = [
    `boardAuto.runtime=active:${boardAuto ? (boardRuntimeActive ? "yes" : "no") : "n/a"}`,
    `boardAuto.emLoop=yes:${boardAuto ? (boardEmLoop ? "yes" : "no") : "n/a"}`,
    `loopReady.runtime=active:${loopReady ? (loopRuntimeActive ? "yes" : "no") : "n/a"}`,
  ];
  const readyForLoopEvidence = boardRuntimeActive && boardEmLoop && loopRuntimeActive;
  return { readyForLoopEvidence, readyForTaskBud125: readyForLoopEvidence, criteria };
}

export function shouldRefreshLoopEvidenceFromRuntimeSnapshot(
  runtime: Pick<LongRunLoopRuntimeState, "mode" | "health" | "stopCondition" | "leaseExpiresAtIso">,
  nowMs = Date.now(),
): boolean {
  if (runtime.mode !== "running" || runtime.health !== "healthy" || runtime.stopCondition !== "none") {
    return false;
  }
  return !isLongRunLoopLeaseExpired(runtime, nowMs);
}

function loopActivationEvidencePath(cwd: string): string {
  return join(cwd, ".pi", "guardrails-loop-evidence.json");
}

export function readLoopActivationEvidence(cwd: string): LoopActivationEvidenceState {
  const p = loopActivationEvidencePath(cwd);
  if (!existsSync(p)) {
    return {
      version: 1,
      updatedAtIso: new Date(0).toISOString(),
    };
  }
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<LoopActivationEvidenceState>;
    return {
      version: 1,
      updatedAtIso: typeof raw.updatedAtIso === "string" ? raw.updatedAtIso : new Date(0).toISOString(),
      lastLoopReady: raw.lastLoopReady,
      lastBoardAutoAdvance: raw.lastBoardAutoAdvance,
    };
  } catch {
    return {
      version: 1,
      updatedAtIso: new Date(0).toISOString(),
    };
  }
}

export function writeLoopActivationEvidence(cwd: string, state: LoopActivationEvidenceState): string {
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  const p = loopActivationEvidencePath(cwd);
  writeFileSync(p, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return p;
}
