import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import projectBoardSurfaceExtension, {
  queryProjectTasks,
  queryProjectVerification,
  updateProjectTaskBoard,
} from "../../extensions/project-board-surface";

describe("project-board-surface", () => {
  function makeMockPi() {
    return {
      registerTool: vi.fn(),
    } as unknown as Parameters<typeof projectBoardSurfaceExtension>[0];
  }

  function getTool(pi: ReturnType<typeof makeMockPi>, name: string) {
    const call = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(
      ([tool]) => tool?.name === name,
    );
    if (!call) throw new Error(`tool not found: ${name}`);
    return call[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: any,
      ) => Promise<{ details?: Record<string, unknown> }> | { details?: Record<string, unknown> };
    };
  }

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

  it("updateProjectTaskBoard registra rationale canônico em nota", () => {
    const cwd = seedWorkspace();
    try {
      const updated = updateProjectTaskBoard(cwd, "TASK-A", {
        rationaleKind: "refactor",
        rationaleText: "desacoplar helper para reduzir risco de regressão",
      });
      expect(updated.ok).toBe(true);

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

  it("queryProjectTasks filtra itens sensíveis sem rationale quando needsRationale=true", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-rationale-tasks-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({
        tasks: [
          {
            id: "TASK-R1",
            description: "Refactor do roteador de shell",
            status: "in-progress",
            verification: "VER-R1",
            files: ["packages/pi-stack/extensions/guardrails-core-shell-routing.ts"],
          },
          {
            id: "TASK-R2",
            description: "Refactor do parser",
            status: "in-progress",
            notes: "[rationale:refactor] reduzir acoplamento",
          },
          {
            id: "TASK-R3",
            description: "Atualizar teste legado",
            status: "in-progress",
            verification: "VER-R3",
          },
          {
            id: "TASK-R4",
            description: "Atualizar docs",
            status: "in-progress",
          },
        ],
      }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({
        verifications: [
          { id: "VER-R1", target: "TASK-R1", status: "partial", method: "inspect", evidence: "refactor aplicado" },
          { id: "VER-R3", target: "TASK-R3", status: "partial", method: "test", evidence: "rationale: estabilizar suite flaky" },
        ],
      }, null, 2)}\n`, "utf8");

      const result = queryProjectTasks(cwd, { needsRationale: true, limit: 10 });
      expect(result.filtered).toBe(1);
      expect(result.rows[0]?.id).toBe("TASK-R1");
      expect(result.rows[0]?.rationaleRequired).toBe(true);
      expect(result.rows[0]?.hasRationale).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("queryProjectVerification filtra evidências sensíveis sem rationale", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-rationale-ver-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({ tasks: [] }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({
        verifications: [
          { id: "VER-X1", target: "TASK-X1", status: "partial", method: "inspect", evidence: "refactor aplicado sem detalhe" },
          { id: "VER-X2", target: "TASK-X2", status: "partial", method: "test", evidence: "[rationale:test-change] reduzir flakiness no smoke" },
          { id: "VER-X3", target: "TASK-X3", status: "partial", method: "inspect", evidence: "docs atualizados" },
        ],
      }, null, 2)}\n`, "utf8");

      const result = queryProjectVerification(cwd, { needsRationale: true, limit: 10 });
      expect(result.filtered).toBe(1);
      expect(result.rows[0]?.id).toBe("VER-X1");
      expect(result.rows[0]?.hasRationale).toBe(false);
      expect(result.rows[0]?.rationaleRequired).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("board_query tool uses params and ctx.cwd (no implicit process cwd)", async () => {
    const cwd = seedWorkspace();
    try {
      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const queryTool = getTool(pi, "board_query");

      const result = await queryTool.execute(
        "tc-board-query",
        { entity: "tasks", status: "in-progress", limit: 5 },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect((result.details as any)?.rows?.[0]?.id).toBe("TASK-A");
      expect((result.details as any)?.meta?.path).toContain("tasks.json");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("board_update tool uses params and ctx.cwd", async () => {
    const cwd = seedWorkspace();
    try {
      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const updateTool = getTool(pi, "board_update");

      const result = await updateTool.execute(
        "tc-board-update",
        {
          task_id: "TASK-B",
          status: "in-progress",
          rationale_kind: "refactor",
          rationale_text: "garantir motivo comunicável no ticket",
        },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect((result.details as any)?.ok).toBe(true);
      const check = queryProjectTasks(cwd, { status: "in-progress", limit: 10 });
      expect(check.rows.some((row) => row.id === "TASK-B")).toBe(true);

      const raw = JSON.parse(readFileSync(join(cwd, ".project", "tasks.json"), "utf8")) as {
        tasks?: Array<{ id?: string; notes?: string }>;
      };
      const taskB = Array.isArray(raw.tasks)
        ? raw.tasks.find((t) => t?.id === "TASK-B")
        : undefined;
      expect(taskB?.notes).toContain("[rationale:refactor] garantir motivo comunicável no ticket");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("board_query supports needs_rationale filter for tasks", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-rationale-query-tool-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({
        tasks: [
          { id: "TASK-Q1", description: "Refactor crítico", status: "in-progress" },
          { id: "TASK-Q2", description: "Refactor com motivo", status: "in-progress", notes: "[rationale:refactor] reduzir risco" },
        ],
      }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({ verifications: [] }, null, 2)}\n`, "utf8");

      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const queryTool = getTool(pi, "board_query");

      const result = await queryTool.execute(
        "tc-board-query-rationale",
        { entity: "tasks", needs_rationale: true, limit: 10 },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect((result.details as any)?.filtered).toBe(1);
      expect((result.details as any)?.rows?.[0]?.id).toBe("TASK-Q1");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("board_query returns explicit error when entity is missing", async () => {
    const cwd = seedWorkspace();
    try {
      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const queryTool = getTool(pi, "board_query");

      const result = await queryTool.execute(
        "tc-board-query-missing",
        {},
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect((result.details as any)?.ok).toBe(false);
      expect((result.details as any)?.reason).toBe("missing-or-invalid-entity");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("registers typed board tool schemas for rationale-aware params", () => {
    const pi = makeMockPi();
    projectBoardSurfaceExtension(pi);

    const queryToolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(
      ([tool]) => tool?.name === "board_query",
    );
    const queryTool = queryToolCall?.[0] as any;
    expect(queryTool?.parameters?.properties?.limit?.type).toBe("integer");
    expect(queryTool?.parameters?.properties?.needs_rationale?.type).toBe("boolean");

    const updateToolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(
      ([tool]) => tool?.name === "board_update",
    );
    const updateTool = updateToolCall?.[0] as any;
    expect(updateTool?.parameters?.properties?.task_id?.minLength).toBe(1);
    expect(updateTool?.parameters?.properties?.max_note_lines?.type).toBe("integer");
    expect(updateTool?.parameters?.properties?.rationale_kind).toBeDefined();
    expect(updateTool?.parameters?.properties?.rationale_text?.type).toBe("string");
  });

  it("board_update returns explicit error for partial rationale payload", async () => {
    const cwd = seedWorkspace();
    try {
      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const updateTool = getTool(pi, "board_update");

      const result = await updateTool.execute(
        "tc-board-update-rationale-partial",
        { task_id: "TASK-A", rationale_kind: "refactor" },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect((result.details as any)?.ok).toBe(false);
      expect((result.details as any)?.reason).toBe("missing-rationale-text");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("board_update returns explicit error when task_id is missing", async () => {
    const cwd = seedWorkspace();
    try {
      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const updateTool = getTool(pi, "board_update");

      const result = await updateTool.execute(
        "tc-board-update-missing-id",
        { status: "in-progress" },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect((result.details as any)?.ok).toBe(false);
      expect((result.details as any)?.reason).toBe("missing-task-id");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
