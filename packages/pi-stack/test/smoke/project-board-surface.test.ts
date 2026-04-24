import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  queryProjectTasks,
  queryProjectVerification,
  updateProjectTaskBoard,
} from "../../extensions/project-board-surface";

describe("project-board-surface", () => {
  function seedWorkspace(): string {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-"));
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
              id: "TASK-B",
              description: "Segundo slice bloqueado",
              status: "blocked",
            },
            {
              id: "TASK-C",
              description: "Terceiro planejado",
              status: "planned",
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
              method: "test",
              timestamp: "2026-04-23T05:00:00Z",
              evidence: "smoke ok",
            },
            {
              id: "VER-2",
              target: "TASK-B",
              status: "partial",
              method: "inspect",
              timestamp: "2026-04-23T05:01:00Z",
              evidence: "pending",
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

  it("queryProjectTasks filtra por status/limit e usa cache incremental", () => {
    const cwd = seedWorkspace();
    try {
      const first = queryProjectTasks(cwd, { status: "in-progress", limit: 5 });
      expect(first.total).toBe(3);
      expect(first.filtered).toBe(1);
      expect(first.rows[0]?.id).toBe("TASK-A");
      expect(first.meta.cacheHit).toBe(false);

      const second = queryProjectTasks(cwd, { status: "in-progress", limit: 5 });
      expect(second.meta.cacheHit).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("queryProjectVerification filtra por target/status e retorna payload curto", () => {
    const cwd = seedWorkspace();
    try {
      const result = queryProjectVerification(cwd, {
        target: "TASK-A",
        status: "passed",
        limit: 10,
      });
      expect(result.total).toBe(2);
      expect(result.filtered).toBe(1);
      expect(result.rows[0]?.id).toBe("VER-1");
      expect(result.rows[0]?.evidence).toContain("smoke");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("updateProjectTaskBoard atualiza status e append de nota", () => {
    const cwd = seedWorkspace();
    try {
      const updated = updateProjectTaskBoard(cwd, "TASK-B", {
        status: "in-progress",
        appendNote: "[2026-04-23T05:02:00Z] retomado via proxy",
      });
      expect(updated.ok).toBe(true);

      const query = queryProjectTasks(cwd, { status: "in-progress", limit: 10 });
      expect(query.filtered).toBe(2);
      expect(query.rows.some((r) => r.id === "TASK-B")).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("updateProjectTaskBoard respeita maxNoteLines ao fazer append", () => {
    const cwd = seedWorkspace();
    try {
      const first = updateProjectTaskBoard(cwd, "TASK-A", {
        appendNote: "linha-2",
        maxNoteLines: 2,
      });
      expect(first.ok).toBe(true);

      const second = updateProjectTaskBoard(cwd, "TASK-A", {
        appendNote: "linha-3",
        maxNoteLines: 2,
      });
      expect(second.ok).toBe(true);

      const query = queryProjectTasks(cwd, { status: "in-progress", limit: 10 });
      expect(query.rows.some((r) => r.id === "TASK-A")).toBe(true);

      const raw = JSON.parse(readFileSync(join(cwd, ".project", "tasks.json"), "utf8")) as {
        tasks?: Array<{ id?: string; notes?: string }>;
      };
      const taskA = Array.isArray(raw.tasks)
        ? raw.tasks.find((t) => t?.id === "TASK-A")
        : undefined;
      expect(taskA?.notes).toBe("linha-2\nlinha-3");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
