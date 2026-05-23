import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyBoardPressureReduction } from "../../extensions/project-board-surface";

function readJsonl(filePath: string): any[] {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("project-board pressure reduction", () => {
  function seedCompletedWorkspace(): string {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-pressure-"));
    mkdirSync(join(cwd, ".project"), { recursive: true });
    writeFileSync(
      join(cwd, ".project", "tasks.json"),
      `${JSON.stringify(
        {
          tasks: [
            {
              id: "TASK-A",
              description: "Primeiro slice",
              status: "in-progress",
              verification: "VER-1",
              notes: "nota-a",
            },
            {
              id: "TASK-DONE",
              description: "Slice concluido",
              status: "completed",
              verification: "VER-DONE",
              notes: "historico longo",
              extra: { preserve: true },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    writeFileSync(
      join(cwd, ".project", "verification.json"),
      `${JSON.stringify(
        {
          verifications: [
            {
              id: "VER-1",
              target: "TASK-A",
              status: "passed",
              evidence: "hot task evidence",
            },
            {
              id: "VER-DONE",
              target: "TASK-DONE",
              status: "passed",
              evidence: "archived task evidence",
              extra: { preserve: true },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    return cwd;
  }

  it("archives completed history with explicit authorization", () => {
    const cwd = seedCompletedWorkspace();
    try {
      const blocked = applyBoardPressureReduction(cwd, { dryRun: false });
      expect(blocked.status).toBe("blocked");
      expect(blocked.mutates).toBe(false);

      const applied = applyBoardPressureReduction(cwd, {
        dryRun: false,
        authorization: "explicit-operator",
        boardWarnMb: 0,
      });

      expect(applied.status).toBe("pressure");
      expect(applied.mutates).toBe(true);
      expect(applied.archivedTaskCount).toBe(1);
      expect(applied.archivedVerificationCount).toBe(1);
      expect(applied.archivedTaskShards).toEqual([".project/archive/completed-tasks-0001.jsonl"]);
      expect(applied.archivedVerificationShards).toEqual([".project/archive/verification-ledger-0001.jsonl"]);
      expect(applied.retainedTaskCount).toBe(1);
      expect(applied.retainedVerificationCount).toBe(1);

      const hotBoard = JSON.parse(readFileSync(join(cwd, ".project", "tasks.json"), "utf8"));
      const hotVerification = JSON.parse(readFileSync(join(cwd, ".project", "verification.json"), "utf8"));
      const archivedTasks = readJsonl(join(cwd, ".project", "archive", "completed-tasks-0001.jsonl"));
      const archivedVerification = readJsonl(join(cwd, ".project", "archive", "verification-ledger-0001.jsonl"));
      expect(hotBoard.tasks.map((task: any) => task.id)).toEqual(["TASK-A"]);
      expect(hotVerification.verifications.map((row: any) => row.id)).toEqual(["VER-1"]);
      expect(archivedTasks.map((task: any) => task.id)).toEqual(["TASK-DONE"]);
      expect(archivedVerification.map((row: any) => row.id)).toEqual(["VER-DONE"]);

      const second = applyBoardPressureReduction(cwd, {
        dryRun: false,
        authorization: "explicit-operator",
        boardWarnMb: 0,
      });
      expect(second.archivedTaskCount).toBe(0);
      const archivedAgain = readJsonl(join(cwd, ".project", "archive", "completed-tasks-0001.jsonl"));
      expect(archivedAgain).toHaveLength(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
