import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  readTasksBlockCached,
  readVerificationBlockCached,
  type TaskRecord,
  type VerificationRecord,
} from "./project-board-model";

export type AgentWorkerLaneStage =
  | "single-worker-operational"
  | "single-worker-evidence-ready-board-open"
  | "needs-evidence";

export interface AgentWorkerLaneReadinessInput {
  docs?: {
    singleWorkerMaturity?: boolean;
    agentRunnerMaturity?: boolean;
    agentFirstMode?: boolean;
  };
  tasks?: Record<string, string | undefined>;
  verification?: {
    task1075OneFileMutationPass?: boolean;
    task1075RungCodified?: boolean;
  };
}

export interface AgentWorkerLaneReadiness {
  mode: "agent-worker-lane-readiness";
  stage: AgentWorkerLaneStage;
  recommendationCode:
    | "agent-worker-lane-use-single-worker"
    | "agent-worker-lane-use-single-worker-hold-subprocess"
    | "agent-worker-lane-align-board-before-expansion"
    | "agent-worker-lane-needs-evidence";
  recommendation: string;
  singleWorkerAllowed: boolean;
  multiWorkerRehearsalCandidate: boolean;
  colonyPromotionAllowed: false;
  dispatchAllowed: false;
  gates: {
    singleWorkerMaturityDecision: boolean;
    agentRunnerMaturityCheckpoint: boolean;
    agentFirstMode: boolean;
    task1066: string;
    task1068: string;
    task1075: string;
    task1075PassEvidence: boolean;
    boardAligned: boolean;
    subprocessBlocked: boolean;
  };
  nextActions: string[];
  summary: string;
}

function statusByTaskId(tasks: TaskRecord[], taskId: string): string {
  const row = tasks.find((task) => task.id === taskId);
  return String(row?.status ?? "unknown");
}

export function hasAgentWorkerVerificationEvidence(
  rows: VerificationRecord[],
  taskId: string,
  marker: string,
): boolean {
  return rows.some((row) => {
    const id = String(row.id ?? "");
    const target = String(row.target ?? "");
    const evidence = String(row.evidence ?? "");
    const matchesTask = id.includes(taskId) || target === taskId;
    return matchesTask && (id.includes(marker) || evidence.includes(marker));
  });
}

function fileContains(cwd: string, relPath: string, marker: string): boolean {
  const filePath = path.join(cwd, relPath);
  if (!existsSync(filePath)) return false;
  try {
    return readFileSync(filePath, "utf8").includes(marker);
  } catch {
    return false;
  }
}

export function resolveAgentWorkerLaneReadiness(
  input: AgentWorkerLaneReadinessInput = {},
): AgentWorkerLaneReadiness {
  const maturityDecision = input.docs?.singleWorkerMaturity === true;
  const runnerCheckpoint = input.docs?.agentRunnerMaturity === true;
  const firstWorkerMode = input.docs?.agentFirstMode === true;
  const task1066 = String(input.tasks?.["TASK-BUD-1066"] ?? "unknown");
  const task1068 = String(input.tasks?.["TASK-BUD-1068"] ?? "unknown");
  const task1075 = String(input.tasks?.["TASK-BUD-1075"] ?? "unknown");
  const task1075PassEvidence = input.verification?.task1075OneFileMutationPass === true
    && input.verification?.task1075RungCodified === true;
  const hasSingleWorkerEvidence = maturityDecision
    && runnerCheckpoint
    && (task1075 === "completed" || task1075PassEvidence);
  const boardAligned = task1075 === "completed";
  const subprocessBlocked = task1066 !== "completed";

  const gates = {
    singleWorkerMaturityDecision: maturityDecision,
    agentRunnerMaturityCheckpoint: runnerCheckpoint,
    agentFirstMode: firstWorkerMode,
    task1066,
    task1068,
    task1075,
    task1075PassEvidence,
    boardAligned,
    subprocessBlocked,
  };

  if (hasSingleWorkerEvidence && !boardAligned) {
    return {
      mode: "agent-worker-lane-readiness",
      stage: "single-worker-evidence-ready-board-open",
      recommendationCode: "agent-worker-lane-align-board-before-expansion",
      recommendation: "single-worker evidence exists; align TASK-BUD-1075 board status before expanding worker autonomy.",
      singleWorkerAllowed: true,
      multiWorkerRehearsalCandidate: false,
      colonyPromotionAllowed: false,
      dispatchAllowed: false,
      gates,
      nextActions: [
        "use bounded single-worker lane only for explicitly scoped work",
        "align TASK-BUD-1075 through board verification before multi-worker rehearsal",
        "keep colony promotion blocked",
      ],
      summary: "agent-worker-lane: stage=single-worker-evidence-ready-board-open singleWorker=yes multiWorkerCandidate=no colony=no dispatch=no",
    };
  }

  if (hasSingleWorkerEvidence) {
    const multiWorkerRehearsalCandidate = !subprocessBlocked;
    return {
      mode: "agent-worker-lane-readiness",
      stage: "single-worker-operational",
      recommendationCode: subprocessBlocked
        ? "agent-worker-lane-use-single-worker-hold-subprocess"
        : "agent-worker-lane-use-single-worker",
      recommendation: subprocessBlocked
        ? "use bounded single-worker SDK lane for local-safe work; keep subprocess and colony promotion gated."
        : "use bounded single-worker lane for local-safe work; consider the next explicit multi-worker rehearsal gate.",
      singleWorkerAllowed: true,
      multiWorkerRehearsalCandidate,
      colonyPromotionAllowed: false,
      dispatchAllowed: false,
      gates,
      nextActions: multiWorkerRehearsalCandidate
        ? [
            "continue normal bounded single-worker use",
            "design the next explicit read-only multi-worker rehearsal gate",
            "keep colony promotion blocked until fan-in and abort evidence exist",
          ]
        : [
            "continue normal bounded single-worker use",
            "resolve subprocess evidence before multi-worker rehearsal",
            "keep colony promotion blocked",
          ],
      summary: `agent-worker-lane: stage=single-worker-operational singleWorker=yes multiWorkerCandidate=${multiWorkerRehearsalCandidate ? "yes" : "no"} colony=no dispatch=no`,
    };
  }

  return {
    mode: "agent-worker-lane-readiness",
    stage: "needs-evidence",
    recommendationCode: "agent-worker-lane-needs-evidence",
    recommendation: "complete bounded single-worker evidence before expanding worker autonomy.",
    singleWorkerAllowed: false,
    multiWorkerRehearsalCandidate: false,
    colonyPromotionAllowed: false,
    dispatchAllowed: false,
    gates,
    nextActions: [
      "complete bounded single-worker evidence",
      "keep worker surfaces report-only until evidence is present",
      "keep colony promotion blocked",
    ],
    summary: "agent-worker-lane: stage=needs-evidence singleWorker=no multiWorkerCandidate=no colony=no dispatch=no",
  };
}

export function evaluateAgentWorkerLaneReadiness(cwd: string): AgentWorkerLaneReadiness {
  const tasks = readTasksBlockCached(cwd).block.tasks;
  const verifications = readVerificationBlockCached(cwd).block.verifications;

  return resolveAgentWorkerLaneReadiness({
    docs: {
      singleWorkerMaturity: fileContains(
        cwd,
        path.join("docs", "research", "single-worker-board-driven-lane-maturity-2026-05.md"),
        "single-worker-board-driven-lane-maturity-decision",
      ),
      agentRunnerMaturity: fileContains(
        cwd,
        path.join("docs", "research", "agent-runner-maturity-checkpoint-2026-05.md"),
        "agent-first-worker-lane",
      ),
      agentFirstMode: fileContains(
        cwd,
        path.join("docs", "research", "agent-first-operating-mode-2026-05.md"),
        "single-worker",
      ),
    },
    tasks: {
      "TASK-BUD-1066": statusByTaskId(tasks, "TASK-BUD-1066"),
      "TASK-BUD-1068": statusByTaskId(tasks, "TASK-BUD-1068"),
      "TASK-BUD-1075": statusByTaskId(tasks, "TASK-BUD-1075"),
    },
    verification: {
      task1075OneFileMutationPass: hasAgentWorkerVerificationEvidence(
        verifications,
        "TASK-BUD-1075",
        "SDK-ONE-FILE-MUTATION-PASS",
      ),
      task1075RungCodified: hasAgentWorkerVerificationEvidence(
        verifications,
        "TASK-BUD-1075",
        "SDK-MUTATION-RUNG-CODIFIED",
      ),
    },
  });
}
