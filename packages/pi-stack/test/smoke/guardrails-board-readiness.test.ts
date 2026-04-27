import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBoardExecuteTaskIntentText,
  buildBoardReadinessStatusLabel,
  evaluateBoardLongRunReadiness,
} from "../../extensions/guardrails-core";

describe("guardrails-core board readiness", () => {
  function seedTasks(cwd: string, tasks: unknown[]): void {
    mkdirSync(join(cwd, ".project"), { recursive: true });
    writeFileSync(
      join(cwd, ".project", "tasks.json"),
      `${JSON.stringify({ tasks }, null, 2)}\n`,
      "utf8",
    );
  }

  it("marks board ready when there are planned tasks with satisfied dependencies", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-board-ready-"));
    try {
      seedTasks(cwd, [
        { id: "TASK-A", description: "base", status: "completed" },
        { id: "TASK-B", description: "next", status: "planned", depends_on: ["TASK-A"] },
        { id: "TASK-C", description: "parallel", status: "planned" },
      ]);

      const readiness = evaluateBoardLongRunReadiness(cwd, { sampleLimit: 2 });
      expect(readiness.ready).toBe(true);
      expect(readiness.reason).toBe("ready");
      expect(readiness.eligibleTaskIds).toEqual(["TASK-B", "TASK-C"]);
      expect(readiness.nextTaskId).toBe("TASK-B");
      expect(readiness.selectionPolicy).toContain("planned+deps+priority");
      expect(buildBoardReadinessStatusLabel(readiness)).toContain("boardReady=yes");
      expect(buildBoardReadinessStatusLabel(readiness)).toContain("next=TASK-B");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("orders eligible planned tasks by priority token then id", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-board-priority-"));
    try {
      seedTasks(cwd, [
        { id: "TASK-3", description: "[P2] fallback", status: "planned" },
        { id: "TASK-1", description: "[P0] highest", status: "planned" },
        { id: "TASK-2", description: "[P1] medium", status: "planned" },
      ]);

      const readiness = evaluateBoardLongRunReadiness(cwd, { sampleLimit: 3 });
      expect(readiness.ready).toBe(true);
      expect(readiness.eligibleTaskIds).toEqual(["TASK-1", "TASK-2", "TASK-3"]);
      expect(readiness.nextTaskId).toBe("TASK-1");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("supports milestone-scoped readiness selection", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-board-milestone-ready-"));
    try {
      seedTasks(cwd, [
        { id: "TASK-A", description: "base", status: "completed", milestone: "MS-ALPHA" },
        { id: "TASK-B", description: "[P1] alpha", status: "planned", depends_on: ["TASK-A"], milestone: "MS-ALPHA" },
        { id: "TASK-C", description: "[P0] beta", status: "planned", milestone: "MS-BETA" },
      ]);

      const alpha = evaluateBoardLongRunReadiness(cwd, { sampleLimit: 3, milestone: "MS-ALPHA" });
      expect(alpha.ready).toBe(true);
      expect(alpha.eligibleTaskIds).toEqual(["TASK-B"]);
      expect(alpha.nextTaskId).toBe("TASK-B");
      expect(alpha.selectionPolicy).toContain("milestone(MS-ALPHA)");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("returns no-planned-tasks when milestone scope has no planned tasks", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-board-milestone-empty-"));
    try {
      seedTasks(cwd, [
        { id: "TASK-A", description: "alpha done", status: "completed", milestone: "MS-ALPHA" },
        { id: "TASK-B", description: "beta planned", status: "planned", milestone: "MS-BETA" },
      ]);

      const alpha = evaluateBoardLongRunReadiness(cwd, { milestone: "MS-ALPHA" });
      expect(alpha.ready).toBe(false);
      expect(alpha.reason).toBe("no-planned-tasks");
      expect(alpha.selectionPolicy).toContain("milestone(MS-ALPHA)");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("builds canonical board execute intent text", () => {
    const text = buildBoardExecuteTaskIntentText("TASK-BUD-125");
    expect(text).toContain("[intent:board.execute-task]");
    expect(text).toContain("task_id=TASK-BUD-125");
    expect(text).toContain("contract=no-auto-close+verification");
  });

  it("returns no-planned-tasks when board has no planned work", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-board-empty-"));
    try {
      seedTasks(cwd, [
        { id: "TASK-A", description: "done", status: "completed" },
        { id: "TASK-B", description: "blocked", status: "blocked" },
      ]);

      const readiness = evaluateBoardLongRunReadiness(cwd);
      expect(readiness.ready).toBe(false);
      expect(readiness.reason).toBe("no-planned-tasks");
      expect(readiness.recommendation).toContain("add/decompose planned tasks");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("returns no-eligible-planned-tasks when dependencies are unresolved", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-board-blocked-"));
    try {
      seedTasks(cwd, [
        { id: "TASK-A", description: "base", status: "in-progress" },
        { id: "TASK-B", description: "depends", status: "planned", depends_on: ["TASK-A"] },
      ]);

      const readiness = evaluateBoardLongRunReadiness(cwd);
      expect(readiness.ready).toBe(false);
      expect(readiness.reason).toBe("no-eligible-planned-tasks");
      expect(readiness.blockedByDependencies).toBe(1);
      expect(readiness.recommendation).toContain("unblock dependency chain");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
