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

  it("queryProjectTasks expõe rationaleKind derivado de nota ou verificação", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-rationale-kind-tasks-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({
        tasks: [
          { id: "TASK-K1", description: "Refactor do módulo", status: "in-progress", notes: "[rationale:refactor] separar responsabilidades" },
          { id: "TASK-K2", description: "Ajuste de teste legado", status: "in-progress", verification: "VER-K2" },
        ],
      }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({
        verifications: [
          { id: "VER-K2", target: "TASK-K2", status: "partial", method: "test", evidence: "[rationale:test-change] estabilizar suite" },
        ],
      }, null, 2)}\n`, "utf8");

      const result = queryProjectTasks(cwd, { status: "in-progress", limit: 10 });
      const k1 = result.rows.find((row) => row.id === "TASK-K1");
      const k2 = result.rows.find((row) => row.id === "TASK-K2");
      expect(k1?.rationaleKind).toBe("refactor");
      expect(k2?.rationaleKind).toBe("test-change");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("queryProjectTasks supports rationaleRequired filter", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-rationale-required-tasks-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({
        tasks: [
          { id: "TASK-S1", description: "Refactor do parser", status: "in-progress" },
          { id: "TASK-S2", description: "Atualizar docs", status: "in-progress" },
        ],
      }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({ verifications: [] }, null, 2)}\n`, "utf8");

      const sensitive = queryProjectTasks(cwd, { rationaleRequired: true, limit: 10 });
      expect(sensitive.filtered).toBe(1);
      expect(sensitive.rows[0]?.id).toBe("TASK-S1");

      const nonSensitive = queryProjectTasks(cwd, { rationaleRequired: false, limit: 10 });
      expect(nonSensitive.filtered).toBe(1);
      expect(nonSensitive.rows[0]?.id).toBe("TASK-S2");
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

  it("queryProjectVerification supports rationaleRequired filter and rationaleKind", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-rationale-required-ver-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({ tasks: [] }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({
        verifications: [
          { id: "VER-S1", target: "TASK-S1", status: "partial", method: "inspect", evidence: "refactor aplicado" },
          { id: "VER-S2", target: "TASK-S2", status: "partial", method: "inspect", evidence: "[rationale:risk-control] mitigar regressão" },
          { id: "VER-S3", target: "TASK-S3", status: "partial", method: "inspect", evidence: "docs atualizados" },
        ],
      }, null, 2)}\n`, "utf8");

      const sensitive = queryProjectVerification(cwd, { rationaleRequired: true, limit: 10 });
      expect(sensitive.filtered).toBe(1);
      expect(sensitive.rows[0]?.id).toBe("VER-S1");

      const allRows = queryProjectVerification(cwd, { limit: 10 });
      const verS2 = allRows.rows.find((row) => row.id === "VER-S2");
      expect(verS2?.rationaleKind).toBe("risk-control");

      const nonSensitive = queryProjectVerification(cwd, { rationaleRequired: false, limit: 10 });
      expect(nonSensitive.filtered).toBe(2);
      expect(nonSensitive.rows.some((row) => row.id === "VER-S3")).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("updateProjectTaskBoard can enforce rationale for sensitive tasks", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-rationale-enforce-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({
        tasks: [
          { id: "TASK-E1", description: "Refactor crítico", status: "in-progress" },
        ],
      }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({ verifications: [] }, null, 2)}\n`, "utf8");

      const blocked = updateProjectTaskBoard(cwd, "TASK-E1", {
        status: "completed",
        requireRationaleForSensitive: true,
      });
      expect(blocked.ok).toBe(false);
      expect(blocked.reason).toBe("rationale-required-for-sensitive-task");

      const rawAfterBlocked = JSON.parse(readFileSync(join(cwd, ".project", "tasks.json"), "utf8")) as {
        tasks?: Array<{ id?: string; status?: string }>;
      };
      const stillInProgress = Array.isArray(rawAfterBlocked.tasks)
        ? rawAfterBlocked.tasks.find((row) => row.id === "TASK-E1")
        : undefined;
      expect(stillInProgress?.status).toBe("in-progress");

      const ok = updateProjectTaskBoard(cwd, "TASK-E1", {
        status: "completed",
        requireRationaleForSensitive: true,
        rationaleKind: "refactor",
        rationaleText: "mudança estrutural com risco controlado",
      });
      expect(ok.ok).toBe(true);
      expect(ok.task?.hasRationale).toBe(true);
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

  it("board_query supports rationale_required filter for verification", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-rationale-required-query-tool-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({ tasks: [] }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({
        verifications: [
          { id: "VER-Q1", target: "TASK-Q1", status: "partial", method: "inspect", evidence: "refactor sem rationale" },
          { id: "VER-Q2", target: "TASK-Q2", status: "partial", method: "inspect", evidence: "docs" },
        ],
      }, null, 2)}\n`, "utf8");

      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const queryTool = getTool(pi, "board_query");

      const result = await queryTool.execute(
        "tc-board-query-rationale-required",
        { entity: "verification", rationale_required: true, limit: 10 },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect((result.details as any)?.filtered).toBe(1);
      expect((result.details as any)?.rows?.[0]?.id).toBe("VER-Q1");
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
    expect(queryTool?.parameters?.properties?.rationale_required?.type).toBe("boolean");

    const updateToolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(
      ([tool]) => tool?.name === "board_update",
    );
    const updateTool = updateToolCall?.[0] as any;
    expect(updateTool?.parameters?.properties?.task_id?.minLength).toBe(1);
    expect(updateTool?.parameters?.properties?.max_note_lines?.type).toBe("integer");
    expect(updateTool?.parameters?.properties?.rationale_kind).toBeDefined();
    expect(updateTool?.parameters?.properties?.rationale_text?.type).toBe("string");
    expect(updateTool?.parameters?.properties?.require_rationale_for_sensitive?.type).toBe("boolean");
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

  it("board_update can enforce rationale for sensitive tasks", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-rationale-enforce-tool-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({
        tasks: [{ id: "TASK-T1", description: "Refactor do orchestrator", status: "in-progress" }],
      }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({ verifications: [] }, null, 2)}\n`, "utf8");

      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const updateTool = getTool(pi, "board_update");

      const blocked = await updateTool.execute(
        "tc-board-update-enforce-blocked",
        { task_id: "TASK-T1", status: "completed", require_rationale_for_sensitive: true },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );
      expect((blocked.details as any)?.ok).toBe(false);
      expect((blocked.details as any)?.reason).toBe("rationale-required-for-sensitive-task");

      const ok = await updateTool.execute(
        "tc-board-update-enforce-ok",
        {
          task_id: "TASK-T1",
          status: "completed",
          require_rationale_for_sensitive: true,
          rationale_kind: "refactor",
          rationale_text: "justificativa comunicável da mudança",
        },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );
      expect((ok.details as any)?.ok).toBe(true);
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
