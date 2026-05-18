import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateAgentWorkerLaneReadiness,
  hasAgentWorkerVerificationEvidence,
  resolveAgentWorkerLaneReadiness,
} from "../../extensions/guardrails-core-exports";

describe("agent worker lane readiness", () => {
  it("flags single-worker evidence when the board still needs alignment", () => {
    const readiness = resolveAgentWorkerLaneReadiness({
      docs: {
        singleWorkerMaturity: true,
        agentRunnerMaturity: true,
        agentFirstMode: true,
      },
      tasks: {
        "TASK-BUD-1066": "completed",
        "TASK-BUD-1068": "completed",
        "TASK-BUD-1075": "in-progress",
      },
      verification: {
        task1075OneFileMutationPass: true,
        task1075RungCodified: true,
      },
    });

    expect(readiness.stage).toBe("single-worker-evidence-ready-board-open");
    expect(readiness.singleWorkerAllowed).toBe(true);
    expect(readiness.multiWorkerRehearsalCandidate).toBe(false);
    expect(readiness.colonyPromotionAllowed).toBe(false);
    expect(readiness.dispatchAllowed).toBe(false);
    expect(readiness.nextActions.join("\n")).toContain("TASK-BUD-1075");
  });

  it("keeps colony blocked while allowing next explicit worker rehearsal gates", () => {
    const readiness = resolveAgentWorkerLaneReadiness({
      docs: {
        singleWorkerMaturity: true,
        agentRunnerMaturity: true,
        agentFirstMode: true,
      },
      tasks: {
        "TASK-BUD-1066": "completed",
        "TASK-BUD-1068": "completed",
        "TASK-BUD-1075": "completed",
      },
    });

    expect(readiness.stage).toBe("single-worker-operational");
    expect(readiness.singleWorkerAllowed).toBe(true);
    expect(readiness.multiWorkerRehearsalCandidate).toBe(true);
    expect(readiness.colonyPromotionAllowed).toBe(false);
    expect(readiness.summary).toContain("multiWorkerCandidate=yes");
    expect(readiness.nextActions.join("\n")).toContain("read-only multi-worker rehearsal gate");
  });

  it("fails closed without maturity evidence", () => {
    const readiness = resolveAgentWorkerLaneReadiness({
      docs: {
        singleWorkerMaturity: true,
        agentRunnerMaturity: false,
      },
      tasks: {
        "TASK-BUD-1075": "completed",
      },
    });

    expect(readiness.stage).toBe("needs-evidence");
    expect(readiness.singleWorkerAllowed).toBe(false);
    expect(readiness.multiWorkerRehearsalCandidate).toBe(false);
    expect(readiness.colonyPromotionAllowed).toBe(false);
  });

  it("reads board verification and maturity docs from the repo surface", () => {
    const cwd = mkdtempProject();
    try {
      writeFileSync(
        join(cwd, ".project", "tasks.json"),
        `${JSON.stringify({
          tasks: [
            { id: "TASK-BUD-1066", description: "subprocess", status: "completed" },
            { id: "TASK-BUD-1068", description: "executor", status: "completed" },
            { id: "TASK-BUD-1075", description: "mutation canary", status: "in-progress" },
          ],
        }, null, 2)}\n`,
        "utf8",
      );
      writeFileSync(
        join(cwd, ".project", "verification.json"),
        `${JSON.stringify({
          verifications: [
            { id: "VERIF-TASK-BUD-1075-SDK-ONE-FILE-MUTATION-PASS-20260514", evidence: "passed" },
            { id: "VERIF-TASK-BUD-1075-RUNG", evidence: "SDK-MUTATION-RUNG-CODIFIED" },
          ],
        }, null, 2)}\n`,
        "utf8",
      );
      writeFileSync(
        join(cwd, "docs", "research", "single-worker-board-driven-lane-maturity-2026-05.md"),
        "single-worker-board-driven-lane-maturity-decision\n",
        "utf8",
      );
      writeFileSync(
        join(cwd, "docs", "research", "agent-runner-maturity-checkpoint-2026-05.md"),
        "agent-first-worker-lane\n",
        "utf8",
      );
      writeFileSync(
        join(cwd, "docs", "research", "agent-first-operating-mode-2026-05.md"),
        "single-worker\n",
        "utf8",
      );

      const readiness = evaluateAgentWorkerLaneReadiness(cwd);
      expect(readiness.stage).toBe("single-worker-evidence-ready-board-open");
      expect(readiness.gates.task1075PassEvidence).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("matches verification markers by task id", () => {
    expect(hasAgentWorkerVerificationEvidence([
      { id: "VERIF-TASK-BUD-1075-SDK-ONE-FILE-MUTATION-PASS-20260514" },
    ], "TASK-BUD-1075", "SDK-ONE-FILE-MUTATION-PASS")).toBe(true);
    expect(hasAgentWorkerVerificationEvidence([
      { id: "VERIF-TASK-BUD-1075-OTHER", evidence: "SDK-MUTATION-RUNG-CODIFIED" },
    ], "TASK-BUD-1075", "SDK-MUTATION-RUNG-CODIFIED")).toBe(true);
    expect(hasAgentWorkerVerificationEvidence([
      { id: "VERIF-TASK-BUD-1068-SDK-ONE-FILE-MUTATION-PASS-20260514" },
    ], "TASK-BUD-1075", "SDK-ONE-FILE-MUTATION-PASS")).toBe(false);
  });
});

function mkdtempProject(): string {
  const cwd = join(tmpdir(), `pi-agent-worker-lane-${process.pid}-${Date.now()}`);
  mkdirSync(join(cwd, ".project"), { recursive: true });
  mkdirSync(join(cwd, "docs", "research"), { recursive: true });
  return cwd;
}
