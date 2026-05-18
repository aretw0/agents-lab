import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  queryProjectTasks,
  updateProjectTaskBoard,
} from "../../extensions/project-board-surface";

describe("project-board update surface", () => {
  function seedWorkspace(): string {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-update-"));
    mkdirSync(join(cwd, ".project"), { recursive: true });
    writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({
      tasks: [
        { id: "TASK-A", description: "Primeiro slice", status: "in-progress", verification: "VER-1", notes: "nota-a" },
        { id: "TASK-B", description: "Segundo slice bloqueado", status: "blocked" },
        { id: "TASK-C", description: "Terceiro planejado", status: "planned" },
      ],
    }, null, 2)}\n`, "utf8");
    writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({
      verifications: [
        { id: "VER-1", target: "TASK-A", status: "passed", evidence: "ok" },
      ],
    }, null, 2)}\n`, "utf8");
    return cwd;
  }

  it("updateProjectTaskBoard atualiza status e append de nota", () => {
    const cwd = seedWorkspace();
    try {
      const updated = updateProjectTaskBoard(cwd, "TASK-B", {
        status: "in-progress",
        appendNote: "[2026-04-23T05:02:00Z] retomado via proxy",
      });
      expect(updated.ok).toBe(true);
      expect(updated.summary).toBe("board-update: ok=yes task=TASK-B status=in-progress");

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

  it("updateProjectTaskBoard can set and clear milestone label", () => {
    const cwd = seedWorkspace();
    try {
      const setMilestone = updateProjectTaskBoard(cwd, "TASK-A", {
        milestone: "MS-NATIVE-ALPHA",
      });
      expect(setMilestone.ok).toBe(true);
      expect(setMilestone.task?.milestone).toBe("MS-NATIVE-ALPHA");

      const clearMilestone = updateProjectTaskBoard(cwd, "TASK-A", {
        milestone: "",
      });
      expect(clearMilestone.ok).toBe(true);
      expect(clearMilestone.task?.milestone).toBeUndefined();

      const raw = JSON.parse(readFileSync(join(cwd, ".project", "tasks.json"), "utf8")) as {
        tasks?: Array<{ id?: string; milestone?: string }>;
      };
      const taskA = Array.isArray(raw.tasks)
        ? raw.tasks.find((t) => t?.id === "TASK-A")
        : undefined;
      expect(taskA?.milestone).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("updateProjectTaskBoard registra rationale canônico em nota", () => {
    const cwd = seedWorkspace();
    try {
      const updated = updateProjectTaskBoard(cwd, "TASK-A", {
        rationaleKind: "refactor",
        rationaleText: "desacoplar helper para reduzir risco de regressão",
      });
      expect(updated.ok).toBe(true);
      expect(updated.task?.rationaleSource).toBe("task-note");
      expect(updated.verificationSync?.status).toBe("skipped");

      const raw = JSON.parse(readFileSync(join(cwd, ".project", "tasks.json"), "utf8")) as {
        tasks?: Array<{ id?: string; notes?: string }>;
      };
      const taskA = Array.isArray(raw.tasks)
        ? raw.tasks.find((t) => t?.id === "TASK-A")
        : undefined;
      expect(taskA?.notes).toContain("[rationale:refactor] desacoplar helper para reduzir risco de regressão");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("updateProjectTaskBoard sincroniza rationale com evidência de verificação vinculada", () => {
    const cwd = seedWorkspace();
    try {
      const updated = updateProjectTaskBoard(cwd, "TASK-A", {
        rationaleKind: "risk-control",
        rationaleText: "explicar mitigação para alteração de teste",
        syncRationaleToVerification: true,
      });
      expect(updated.ok).toBe(true);
      expect(updated.verificationSync?.status).toBe("updated");
      expect(updated.verificationSync?.verificationId).toBe("VER-1");

      const raw = JSON.parse(readFileSync(join(cwd, ".project", "verification.json"), "utf8")) as {
        verifications?: Array<{ id?: string; evidence?: string }>;
      };
      const ver1 = Array.isArray(raw.verifications)
        ? raw.verifications.find((row) => row?.id === "VER-1")
        : undefined;
      expect(ver1?.evidence).toContain("[rationale:risk-control] explicar mitigação para alteração de teste");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("updateProjectTaskBoard retorna not-found quando task.verification não existe", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-sync-not-found-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({
        tasks: [
          { id: "TASK-NF1", description: "Refactor", status: "in-progress", verification: "VER-NF1" },
        ],
      }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({ verifications: [] }, null, 2)}\n`, "utf8");

      const updated = updateProjectTaskBoard(cwd, "TASK-NF1", {
        rationaleKind: "refactor",
        rationaleText: "registrar motivo",
        syncRationaleToVerification: true,
      });
      expect(updated.ok).toBe(true);
      expect(updated.verificationSync?.status).toBe("not-found");
      expect(updated.verificationSync?.verificationId).toBe("VER-NF1");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("updateProjectTaskBoard não duplica rationale ao sincronizar novamente", () => {
    const cwd = seedWorkspace();
    try {
      const first = updateProjectTaskBoard(cwd, "TASK-A", {
        rationaleKind: "refactor",
        rationaleText: "motivo estável",
        syncRationaleToVerification: true,
      });
      expect(first.ok).toBe(true);
      expect(first.verificationSync?.status).toBe("updated");

      const second = updateProjectTaskBoard(cwd, "TASK-A", {
        rationaleKind: "refactor",
        rationaleText: "motivo estável",
        syncRationaleToVerification: true,
      });
      expect(second.ok).toBe(true);
      expect(second.verificationSync?.status).toBe("already-present");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("updateProjectTaskBoard exige payload de rationale para sync com verificação", () => {
    const cwd = seedWorkspace();
    try {
      const blocked = updateProjectTaskBoard(cwd, "TASK-A", {
        syncRationaleToVerification: true,
      });
      expect(blocked.ok).toBe(false);
      expect(blocked.reason).toBe("sync-requires-rationale-payload");
      expect(blocked.summary).toBe("board-update: ok=no task=TASK-A status=unchanged reason=sync-requires-rationale-payload");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("updateProjectTaskBoard rejeita rationale parcial", () => {
    const cwd = seedWorkspace();
    try {
      const missingText = updateProjectTaskBoard(cwd, "TASK-A", {
        rationaleKind: "refactor",
      });
      expect(missingText.ok).toBe(false);
      expect(missingText.reason).toBe("missing-rationale-text");

      const missingKind = updateProjectTaskBoard(cwd, "TASK-A", {
        rationaleText: "ajuste de segurança",
      });
      expect(missingKind.ok).toBe(false);
      expect(missingKind.reason).toBe("missing-rationale-kind");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
