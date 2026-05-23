import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import projectBoardSurfaceExtension, {
  appendProjectVerificationBoard,
  buildProjectTaskDecisionPacket,
  buildProjectTaskQualityGate,
  buildBoardPlanningClarityScore,
  buildBoardDependencyHealthSnapshot,
  buildBoardDependencyHygieneScore,
  buildBoardPressureReductionPlan,
  buildProjectVerificationBackfillPlan,
  completeProjectTaskBoardWithVerification,
  createProjectTaskBoard,
  queryProjectTasks,
  queryProjectVerification,
  updateProjectTaskBoard,
  updateProjectTaskDependencies,
} from "../../extensions/project-board-surface";


describe("project-board tool surfaces", () => {
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
              extra: { keep: true },
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

  function seedFocusAutoAdvanceWorkspace(successorCount: number): string {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-focus-auto-"));
    mkdirSync(join(cwd, ".project"), { recursive: true });

    const successors = Array.from({ length: successorCount }, (_, index) => ({
      id: `TASK-NEXT-${index + 1}`,
      description: `Próximo slice ${index + 1}`,
      status: "planned",
      milestone: "MS-LOCAL-AUTO",
    }));

    writeFileSync(
      join(cwd, ".project", "tasks.json"),
      `${JSON.stringify(
        {
          tasks: [
            {
              id: "TASK-FOCUS",
              description: "Task atual",
              status: "in-progress",
              milestone: "MS-LOCAL-AUTO",
              notes: "[rationale:risk-control] foco local-safe",
            },
            ...successors,
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    writeFileSync(
      join(cwd, ".project", "verification.json"),
      `${JSON.stringify({ verifications: [] }, null, 2)}\n`,
      "utf8",
    );

    writeFileSync(
      join(cwd, ".project", "handoff.json"),
      `${JSON.stringify({ current_tasks: ["TASK-FOCUS"] }, null, 2)}\n`,
      "utf8",
    );

    return cwd;
  }

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
      expect(String((result as any)?.content?.[0]?.text ?? "")).toContain("board-query: entity=tasks");
      expect(String((result as any)?.content?.[0]?.text ?? "")).toContain("payload completo disponível em details");
      expect(String((result as any)?.content?.[0]?.text ?? "")).not.toContain('\"rows\"');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("board_decision_packet tool emits compact operator decision options", async () => {
    const cwd = seedWorkspace();
    try {
      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const packetTool = getTool(pi, "board_decision_packet");

      const result = await packetTool.execute(
        "tc-board-decision-packet",
        { task_id: "TASK-A" },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect((result.details as any)?.noAutoClose).toBe(true);
      expect((result.details as any)?.readyForOperatorDecision).toBe(true);
      expect((result.details as any)?.options).toEqual(["close", "keep-open", "defer"]);
      expect((result.details as any)?.evidence?.[0]?.verificationId).toBe("VER-1");
      expect(String((result as any)?.content?.[0]?.text ?? "")).toContain("decision-packet:");
      expect(String((result as any)?.content?.[0]?.text ?? "")).toContain("payload completo disponível em details");
      expect(String((result as any)?.content?.[0]?.text ?? "")).not.toContain('\"noAutoClose\"');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("board_task_create tool creates bounded tasks", async () => {
    const cwd = seedWorkspace();
    try {
      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const createTool = getTool(pi, "board_task_create");

      const result = await createTool.execute(
        "tc-board-task-create",
        {
          id: "TASK-TOOL",
          description: "Tool-created task",
          status: "in-progress",
          priority: "p1",
          depends_on: ["TASK-A"],
          files: ["docs/tool.md"],
          acceptance_criteria: ["created through tool"],
          note: "[rationale:risk-control] avoid ad hoc task JSON mutation",
          provenance_origin: "tangent-approved",
          source_task_id: "TASK-A",
          source_reason: "emergent fix approved during execution",
        },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect((result.details as any)?.ok).toBe(true);
      expect((result.details as any)?.summary).toBe("board-task-create: ok=yes task=TASK-TOOL status=in-progress");
      expect((result as any)?.content?.[0]?.text).toBe("board-task-create: ok=yes task=TASK-TOOL status=in-progress");
      expect((result.details as any)?.task).toMatchObject({ id: "TASK-TOOL", status: "in-progress" });
      const tasks = JSON.parse(readFileSync(join(cwd, ".project", "tasks.json"), "utf8")) as { tasks: Array<{ id: string; notes?: string }> };
      const created = tasks.tasks.find((row) => row.id === "TASK-TOOL");
      expect(created?.notes).toContain("[provenance:tangent-approved]");
      expect(created?.notes).toContain("source_task=TASK-A");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("board_verification_append tool appends and links verification", async () => {
    const cwd = seedWorkspace();
    try {
      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const appendTool = getTool(pi, "board_verification_append");

      const result = await appendTool.execute(
        "tc-board-verification-append",
        {
          id: "VER-TOOL",
          target: "TASK-C",
          target_type: "task",
          status: "passed",
          method: "test",
          evidence: "tool gate ok",
          timestamp: "2026-04-23T05:04:00Z",
          link_task: true,
        },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect((result.details as any)?.ok).toBe(true);
      expect((result.details as any)?.summary).toBe("board-verification-append: ok=yes verification=VER-TOOL target=TASK-C linked=yes");
      expect((result.details as any)?.verification?.id).toBe("VER-TOOL");
      expect((result.details as any)?.verification?.evidence).toBeUndefined();
      expect((result as any)?.content?.[0]?.text).toBe("board-verification-append: ok=yes verification=VER-TOOL target=TASK-C linked=yes");
      expect((result.details as any)?.task?.verification).toBe("VER-TOOL");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("board_pressure_reduction_plan previews hot board reduction without writing", async () => {
    const cwd = seedWorkspace();
    try {
      const beforeTasks = readFileSync(join(cwd, ".project", "tasks.json"), "utf8");
      const beforeVerification = readFileSync(join(cwd, ".project", "verification.json"), "utf8");
      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const planTool = getTool(pi, "board_pressure_reduction_plan");

      const result = await planTool.execute(
        "tc-board-pressure-plan",
        { board_warn_mb: 0 },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect((result.details as any)?.mode).toBe("board-pressure-reduction-plan");
      expect((result.details as any)?.dryRun).toBe(true);
      expect((result.details as any)?.mutates).toBe(false);
      expect((result.details as any)?.status).toBe("pressure");
      expect((result.details as any)?.openTaskCount).toBe(3);
      expect((result.details as any)?.recommendedOrder).toContain("split-verification-ledger");
      expect(String((result as any)?.content?.[0]?.text ?? "")).toContain("board-pressure-plan:");
      expect(readFileSync(join(cwd, ".project", "tasks.json"), "utf8")).toBe(beforeTasks);
      expect(readFileSync(join(cwd, ".project", "verification.json"), "utf8")).toBe(beforeVerification);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("board_task_complete tool appends verification and completes task", async () => {
    const cwd = seedWorkspace();
    try {
      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const completeTool = getTool(pi, "board_task_complete");

      const result = await completeTool.execute(
        "tc-board-task-complete",
        {
          task_id: "TASK-C",
          verification_id: "VER-TOOL-COMPLETE",
          method: "test",
          evidence: "tool completion ok [rationale:risk-control] bounded close",
          append_note: "completed through tool",
        },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect((result.details as any)?.ok).toBe(true);
      expect((result.details as any)?.summary).toBe("board-task-complete: ok=yes task=TASK-C verification=VER-TOOL-COMPLETE status=completed");
      expect((result.details as any)?.verification?.id).toBe("VER-TOOL-COMPLETE");
      expect((result.details as any)?.verification?.evidence).toBeUndefined();
      expect((result.details as any)?.verificationAppend).toBeUndefined();
      expect((result.details as any)?.update).toBeUndefined();
      expect((result as any)?.content?.[0]?.text).toBe("board-task-complete: ok=yes task=TASK-C verification=VER-TOOL-COMPLETE status=completed");
      expect((result.details as any)?.task).toMatchObject({ id: "TASK-C", status: "completed" });
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
      expect((result.details as any)?.summary).toBe("board-update: ok=yes task=TASK-B status=in-progress");
      expect((result as any)?.content?.[0]?.text).toBe("board-update: ok=yes task=TASK-B status=in-progress");
      expect((result.details as any)?.verificationSync?.status).toBe("skipped");
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

  it("board_update tool can set and clear milestone", async () => {
    const cwd = seedWorkspace();
    try {
      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const updateTool = getTool(pi, "board_update");

      const setResult = await updateTool.execute(
        "tc-board-update-milestone-set",
        { task_id: "TASK-A", milestone: "MS-LOCAL-BOSS" },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );
      expect((setResult.details as any)?.ok).toBe(true);
      expect((setResult.details as any)?.task?.milestone).toBe("MS-LOCAL-BOSS");

      const clearResult = await updateTool.execute(
        "tc-board-update-milestone-clear",
        { task_id: "TASK-A", milestone: "" },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );
      expect((clearResult.details as any)?.ok).toBe(true);
      expect((clearResult.details as any)?.task?.milestone).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("board_update tool can sync rationale to linked verification", async () => {
    const cwd = seedWorkspace();
    try {
      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const updateTool = getTool(pi, "board_update");

      const result = await updateTool.execute(
        "tc-board-update-sync-verification",
        {
          task_id: "TASK-A",
          rationale_kind: "test-change",
          rationale_text: "explicar mudança sensível no teste",
          sync_rationale_to_verification: true,
        },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect((result.details as any)?.ok).toBe(true);
      expect((result.details as any)?.verificationSync?.status).toBe("updated");
      expect((result.details as any)?.verificationSync?.verificationId).toBe("VER-1");

      const raw = JSON.parse(readFileSync(join(cwd, ".project", "verification.json"), "utf8")) as {
        verifications?: Array<{ id?: string; evidence?: string }>;
      };
      const ver1 = Array.isArray(raw.verifications)
        ? raw.verifications.find((row) => row?.id === "VER-1")
        : undefined;
      expect(ver1?.evidence).toContain("[rationale:test-change] explicar mudança sensível no teste");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("board_update reports missing task verification when sync is requested", async () => {
    const cwd = seedWorkspace();
    try {
      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const updateTool = getTool(pi, "board_update");

      const result = await updateTool.execute(
        "tc-board-update-sync-missing-verification",
        {
          task_id: "TASK-B",
          rationale_kind: "refactor",
          rationale_text: "registrar motivo comunicável",
          sync_rationale_to_verification: true,
        },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect((result.details as any)?.ok).toBe(true);
      expect((result.details as any)?.verificationSync?.status).toBe("missing-task-verification");
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

  it("board_query supports milestone filter for tasks", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-milestone-query-tool-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({
        tasks: [
          { id: "TASK-QM1", description: "Main quest", status: "in-progress", milestone: "MS-LOCAL" },
          { id: "TASK-QM2", description: "Side quest", status: "in-progress", milestone: "MS-REMOTE" },
        ],
      }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({ verifications: [] }, null, 2)}\n`, "utf8");

      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const queryTool = getTool(pi, "board_query");

      const result = await queryTool.execute(
        "tc-board-query-milestone",
        { entity: "tasks", milestone: "MS-LOCAL", limit: 10 },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect((result.details as any)?.filtered).toBe(1);
      expect((result.details as any)?.rows?.[0]?.id).toBe("TASK-QM1");
      expect((result.details as any)?.rows?.[0]?.milestone).toBe("MS-LOCAL");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("board_query supports rationale_consistency filter", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-rationale-consistency-query-tool-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({
        tasks: [
          { id: "TASK-QC1", description: "Refactor", status: "in-progress", verification: "VER-QC1", notes: "[rationale:refactor] ok" },
        ],
      }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({
        verifications: [
          { id: "VER-QC1", target: "TASK-QC1", status: "partial", method: "inspect", evidence: "[rationale:test-change] mismatch" },
        ],
      }, null, 2)}\n`, "utf8");

      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const queryTool = getTool(pi, "board_query");

      const result = await queryTool.execute(
        "tc-board-query-rationale-consistency",
        { entity: "tasks", rationale_consistency: "mismatch", limit: 10 },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect((result.details as any)?.filtered).toBe(1);
      expect((result.details as any)?.rows?.[0]?.id).toBe("TASK-QC1");
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
      expect(String((result as any)?.content?.[0]?.text ?? "")).toContain("board-query: ok=no reason=missing-or-invalid-entity");
      expect(String((result as any)?.content?.[0]?.text ?? "")).toContain("payload completo disponível em details");
      expect(String((result as any)?.content?.[0]?.text ?? "")).not.toContain('\"allowed\"');
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
    expect(queryTool?.parameters?.properties?.milestone?.type).toBe("string");
    expect(queryTool?.parameters?.properties?.needs_rationale?.type).toBe("boolean");
    expect(queryTool?.parameters?.properties?.rationale_required?.type).toBe("boolean");
    expect(queryTool?.parameters?.properties?.rationale_consistency).toBeDefined();

    const updateToolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(
      ([tool]) => tool?.name === "board_update",
    );
    const updateTool = updateToolCall?.[0] as any;
    expect(updateTool?.parameters?.properties?.task_id?.minLength).toBe(1);
    expect(updateTool?.parameters?.properties?.max_note_lines?.type).toBe("integer");
    expect(updateTool?.parameters?.properties?.milestone?.type).toBe("string");
    expect(updateTool?.parameters?.properties?.rationale_kind).toBeDefined();
    expect(updateTool?.parameters?.properties?.rationale_text?.type).toBe("string");
    expect(updateTool?.parameters?.properties?.require_rationale_for_sensitive?.type).toBe("boolean");
    expect(updateTool?.parameters?.properties?.require_rationale_consistency?.type).toBe("boolean");
    expect(updateTool?.parameters?.properties?.require_rationale_on_complete?.type).toBe("boolean");
    expect(updateTool?.parameters?.properties?.require_rationale_consistency_on_complete?.type).toBe("boolean");
    expect(updateTool?.parameters?.properties?.sync_rationale_to_verification?.type).toBe("boolean");
  });

  it("board_update returns explicit error when sync is requested without rationale payload", async () => {
    const cwd = seedWorkspace();
    try {
      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const updateTool = getTool(pi, "board_update");

      const result = await updateTool.execute(
        "tc-board-update-sync-no-rationale",
        { task_id: "TASK-A", sync_rationale_to_verification: true },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect((result.details as any)?.ok).toBe(false);
      expect((result.details as any)?.reason).toBe("sync-requires-rationale-payload");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
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
      expect((blocked.details as any)?.reason).toBe("rationale-required-to-complete-sensitive-task");

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

  it("board_update enforces rationale on complete by default", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-rationale-complete-tool-default-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({
        tasks: [{ id: "TASK-TCOMP1", description: "Refactor do orchestrator", status: "in-progress" }],
      }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({ verifications: [] }, null, 2)}\n`, "utf8");

      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const updateTool = getTool(pi, "board_update");

      const blocked = await updateTool.execute(
        "tc-board-update-complete-default-blocked",
        { task_id: "TASK-TCOMP1", status: "completed" },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );
      expect((blocked.details as any)?.ok).toBe(false);
      expect((blocked.details as any)?.reason).toBe("rationale-required-to-complete-sensitive-task");

      const optOut = await updateTool.execute(
        "tc-board-update-complete-default-optout",
        { task_id: "TASK-TCOMP1", status: "completed", require_rationale_on_complete: false },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );
      expect((optOut.details as any)?.ok).toBe(true);
      expect((optOut.details as any)?.task?.status).toBe("completed");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("board_update can enforce rationale consistency mismatch", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-rationale-consistency-enforce-tool-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({
        tasks: [
          { id: "TASK-TC1", description: "Refactor", status: "in-progress", verification: "VER-TC1", notes: "[rationale:refactor] nota" },
        ],
      }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({
        verifications: [
          { id: "VER-TC1", target: "TASK-TC1", status: "partial", method: "inspect", evidence: "[rationale:test-change] divergente" },
        ],
      }, null, 2)}\n`, "utf8");

      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const updateTool = getTool(pi, "board_update");

      const blocked = await updateTool.execute(
        "tc-board-update-consistency-blocked",
        { task_id: "TASK-TC1", status: "completed", require_rationale_consistency: true },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );
      expect((blocked.details as any)?.ok).toBe(false);
      expect((blocked.details as any)?.reason).toBe("rationale-consistency-required-to-complete-task");

      const optOut = await updateTool.execute(
        "tc-board-update-consistency-optout",
        { task_id: "TASK-TC1", status: "completed", require_rationale_consistency_on_complete: false },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );
      expect((optOut.details as any)?.ok).toBe(true);
      expect((optOut.details as any)?.task?.rationaleConsistency).toBe("mismatch");

      const resolved = await updateTool.execute(
        "tc-board-update-consistency-resolved",
        {
          task_id: "TASK-TC1",
          status: "completed",
          require_rationale_consistency: true,
          rationale_kind: "refactor",
          rationale_text: "alinhar rationale",
          sync_rationale_to_verification: true,
        },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );
      expect((resolved.details as any)?.ok).toBe(true);
      expect((resolved.details as any)?.task?.rationaleConsistency).toBe("consistent");
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

  it("board_verification_backfill_plan is dry-first and can apply legacy verification refs", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-backfill-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(
        join(cwd, ".project", "tasks.json"),
        `${JSON.stringify({
          tasks: [
            { id: "TASK-DONE", description: "legacy done", status: "completed" },
            { id: "TASK-OK", description: "done with verification", status: "completed", verification: "VER-OK" },
          ],
        }, null, 2)}\n`,
        "utf8",
      );
      writeFileSync(
        join(cwd, ".project", "verification.json"),
        `${JSON.stringify({
          verifications: [
            { id: "VER-OK", target: "TASK-OK", target_type: "task", status: "passed", method: "test", evidence: "ok", timestamp: "2026-05-01T00:00:00.000Z" },
          ],
        }, null, 2)}\n`,
        "utf8",
      );

      const dry = buildProjectVerificationBackfillPlan(cwd, { dryRun: true, nowIso: "2026-05-01T00:00:00.000Z" });
      expect(dry.pendingWithoutVerification).toBe(1);
      expect(dry.patchedTasks).toBe(0);

      const applied = buildProjectVerificationBackfillPlan(cwd, { dryRun: false, nowIso: "2026-05-01T00:00:00.000Z" });
      expect(applied.patchedTasks).toBe(1);
      expect(applied.addedVerifications).toBe(1);

      const tasks = JSON.parse(readFileSync(join(cwd, ".project", "tasks.json"), "utf8"));
      const verifications = JSON.parse(readFileSync(join(cwd, ".project", "verification.json"), "utf8"));
      expect(tasks.tasks.find((task: any) => task.id === "TASK-DONE")?.verification).toBe("VER-LEGACY-TASK-DONE");
      expect(verifications.verifications.some((verification: any) => verification.id === "VER-LEGACY-TASK-DONE")).toBe(true);

      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const tool = getTool(pi, "board_verification_backfill_plan");
      const result = await tool.execute(
        "tc-backfill",
        { dry_run: true },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect(String((result as any).content?.[0]?.text ?? "")).toContain("project-verification-backfill:");
      expect((result.details as any)?.apply).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
