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
  completeProjectTaskBoardWithVerification,
  createProjectTaskBoard,
  queryProjectTasks,
  queryProjectVerification,
  updateProjectTaskBoard,
  updateProjectTaskDependencies,
} from "../../extensions/project-board-surface";


describe("project-board rationale filters", () => {
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
      expect(result.rationaleSummary?.required).toBe(1);
      expect(result.rationaleSummary?.missingRationale).toBe(1);
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
      expect(k1?.rationaleSource).toBe("task-note");
      expect(k2?.rationaleKind).toBe("test-change");
      expect(k2?.rationaleSource).toBe("verification-evidence");
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

  it("queryProjectTasks supports rationaleConsistency filter", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-rationale-consistency-tasks-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({
        tasks: [
          { id: "TASK-C1", description: "Refactor A", status: "in-progress", verification: "VER-C1", notes: "[rationale:refactor] motivo" },
          { id: "TASK-C2", description: "Refactor B", status: "in-progress", verification: "VER-C2", notes: "[rationale:refactor] motivo" },
          { id: "TASK-C3", description: "Refactor C", status: "in-progress", notes: "[rationale:refactor] motivo" },
          { id: "TASK-C4", description: "Docs", status: "in-progress" },
        ],
      }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({
        verifications: [
          { id: "VER-C1", target: "TASK-C1", status: "partial", method: "inspect", evidence: "[rationale:refactor] ok" },
          { id: "VER-C2", target: "TASK-C2", status: "partial", method: "inspect", evidence: "[rationale:test-change] divergiu" },
        ],
      }, null, 2)}\n`, "utf8");

      const mismatch = queryProjectTasks(cwd, { rationaleConsistency: "mismatch", limit: 10 });
      expect(mismatch.filtered).toBe(1);
      expect(mismatch.rows[0]?.id).toBe("TASK-C2");

      const consistent = queryProjectTasks(cwd, { rationaleConsistency: "consistent", limit: 10 });
      expect(consistent.filtered).toBe(1);
      expect(consistent.rows[0]?.id).toBe("TASK-C1");

      const single = queryProjectTasks(cwd, { rationaleConsistency: "single-source", limit: 10 });
      expect(single.filtered).toBe(1);
      expect(single.rows[0]?.id).toBe("TASK-C3");

      const none = queryProjectTasks(cwd, { rationaleConsistency: "none", limit: 10 });
      expect(none.filtered).toBe(1);
      expect(none.rows[0]?.id).toBe("TASK-C4");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("queryProjectTasks supports milestone filter", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-milestone-tasks-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({
        tasks: [
          { id: "TASK-M1", description: "Main quest", status: "in-progress", milestone: "MS-ALPHA" },
          { id: "TASK-M2", description: "Side quest", status: "in-progress", milestone: "MS-BETA" },
          { id: "TASK-M3", description: "No milestone", status: "in-progress" },
        ],
      }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({ verifications: [] }, null, 2)}\n`, "utf8");

      const alpha = queryProjectTasks(cwd, { milestone: "MS-ALPHA", limit: 10 });
      expect(alpha.filtered).toBe(1);
      expect(alpha.rows[0]?.id).toBe("TASK-M1");
      expect(alpha.rows[0]?.milestone).toBe("MS-ALPHA");
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
      expect(result.rationaleSummary?.required).toBe(1);
      expect(result.rationaleSummary?.missingRationale).toBe(1);
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
      expect(verS2?.rationaleSource).toBe("verification-evidence");

      const nonSensitive = queryProjectVerification(cwd, { rationaleRequired: false, limit: 10 });
      expect(nonSensitive.filtered).toBe(2);
      expect(nonSensitive.rows.some((row) => row.id === "VER-S3")).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("queryProjectVerification supports rationaleConsistency filter", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-rationale-consistency-verification-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({
        tasks: [
          { id: "TASK-V1", description: "Refactor", status: "in-progress", notes: "[rationale:refactor] ok" },
          { id: "TASK-V2", description: "Refactor", status: "in-progress", notes: "[rationale:refactor] mismatch" },
          { id: "TASK-V3", description: "Refactor", status: "in-progress", notes: "[rationale:refactor] single" },
        ],
      }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({
        verifications: [
          { id: "VER-V1", target: "TASK-V1", status: "partial", method: "inspect", evidence: "[rationale:refactor] ok" },
          { id: "VER-V2", target: "TASK-V2", status: "partial", method: "inspect", evidence: "[rationale:test-change] mismatch" },
          { id: "VER-V3", target: "TASK-V3", status: "partial", method: "inspect", evidence: "sem rationale" },
        ],
      }, null, 2)}\n`, "utf8");

      const mismatch = queryProjectVerification(cwd, { rationaleConsistency: "mismatch", limit: 10 });
      expect(mismatch.filtered).toBe(1);
      expect(mismatch.rows[0]?.id).toBe("VER-V2");

      const consistent = queryProjectVerification(cwd, { rationaleConsistency: "consistent", limit: 10 });
      expect(consistent.filtered).toBe(1);
      expect(consistent.rows[0]?.id).toBe("VER-V1");

      const single = queryProjectVerification(cwd, { rationaleConsistency: "single-source", limit: 10 });
      expect(single.filtered).toBe(1);
      expect(single.rows[0]?.id).toBe("VER-V3");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("queryProjectVerification supports milestone filter", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-milestone-verification-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({
        tasks: [
          { id: "TASK-MV1", description: "Main quest", status: "in-progress", milestone: "MS-NATIVE" },
          { id: "TASK-MV2", description: "Side quest", status: "in-progress", milestone: "MS-REMOTE" },
        ],
      }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({
        verifications: [
          { id: "VER-MV1", target: "TASK-MV1", status: "partial", method: "inspect", evidence: "ok" },
          { id: "VER-MV2", target: "TASK-MV2", status: "partial", method: "inspect", evidence: "ok" },
        ],
      }, null, 2)}\n`, "utf8");

      const nativeOnly = queryProjectVerification(cwd, { milestone: "MS-NATIVE", limit: 10 });
      expect(nativeOnly.filtered).toBe(1);
      expect(nativeOnly.rows[0]?.id).toBe("VER-MV1");
      expect(nativeOnly.rows[0]?.milestone).toBe("MS-NATIVE");
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

  it("updateProjectTaskBoard can enforce rationale on completion", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-rationale-complete-enforce-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({
        tasks: [
          { id: "TASK-EC1", description: "Refactor crítico", status: "in-progress" },
        ],
      }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({ verifications: [] }, null, 2)}\n`, "utf8");

      const blocked = updateProjectTaskBoard(cwd, "TASK-EC1", {
        status: "completed",
        requireRationaleOnComplete: true,
      });
      expect(blocked.ok).toBe(false);
      expect(blocked.reason).toBe("rationale-required-to-complete-sensitive-task");

      const ok = updateProjectTaskBoard(cwd, "TASK-EC1", {
        status: "completed",
        requireRationaleOnComplete: true,
        rationaleKind: "refactor",
        rationaleText: "explicar motivo antes do fechamento",
      });
      expect(ok.ok).toBe(true);
      expect(ok.task?.status).toBe("completed");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("updateProjectTaskBoard can enforce rationale consistency", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-rationale-consistency-enforce-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({
        tasks: [
          { id: "TASK-CC1", description: "Refactor", status: "in-progress", verification: "VER-CC1", notes: "[rationale:refactor] motivo" },
        ],
      }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({
        verifications: [
          { id: "VER-CC1", target: "TASK-CC1", status: "partial", method: "inspect", evidence: "[rationale:test-change] divergente" },
        ],
      }, null, 2)}\n`, "utf8");

      const blocked = updateProjectTaskBoard(cwd, "TASK-CC1", {
        status: "completed",
        requireRationaleConsistency: true,
      });
      expect(blocked.ok).toBe(false);
      expect(blocked.reason).toBe("rationale-consistency-mismatch");

      const synced = updateProjectTaskBoard(cwd, "TASK-CC1", {
        status: "completed",
        rationaleKind: "refactor",
        rationaleText: "alinhar rationale entre task e verificação",
        syncRationaleToVerification: true,
        requireRationaleConsistency: true,
      });
      expect(synced.ok).toBe(true);
      expect(synced.task?.rationaleConsistency).toBe("consistent");
      expect(synced.verificationSync?.status).toBe("updated");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("updateProjectTaskBoard can enforce rationale consistency on completion", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-project-board-rationale-consistency-complete-enforce-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), `${JSON.stringify({
        tasks: [
          { id: "TASK-CEC1", description: "Refactor", status: "in-progress", verification: "VER-CEC1", notes: "[rationale:refactor] motivo" },
        ],
      }, null, 2)}\n`, "utf8");
      writeFileSync(join(cwd, ".project", "verification.json"), `${JSON.stringify({
        verifications: [
          { id: "VER-CEC1", target: "TASK-CEC1", status: "partial", method: "inspect", evidence: "[rationale:test-change] divergente" },
        ],
      }, null, 2)}\n`, "utf8");

      const blocked = updateProjectTaskBoard(cwd, "TASK-CEC1", {
        status: "completed",
        requireRationaleConsistencyOnComplete: true,
      });
      expect(blocked.ok).toBe(false);
      expect(blocked.reason).toBe("rationale-consistency-required-to-complete-task");

      const ok = updateProjectTaskBoard(cwd, "TASK-CEC1", {
        status: "completed",
        requireRationaleConsistencyOnComplete: true,
        rationaleKind: "refactor",
        rationaleText: "alinhar rationale entre task e verificação",
        syncRationaleToVerification: true,
      });
      expect(ok.ok).toBe(true);
      expect(ok.task?.rationaleConsistency).toBe("consistent");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("updateProjectTaskBoard keeps single rationale note when same payload repeats", () => {
    const cwd = seedWorkspace();
    try {
      const first = updateProjectTaskBoard(cwd, "TASK-A", {
        rationaleKind: "refactor",
        rationaleText: "motivo repetido",
      });
      expect(first.ok).toBe(true);

      const second = updateProjectTaskBoard(cwd, "TASK-A", {
        rationaleKind: "refactor",
        rationaleText: "motivo repetido",
      });
      expect(second.ok).toBe(true);

      const raw = JSON.parse(readFileSync(join(cwd, ".project", "tasks.json"), "utf8")) as {
        tasks?: Array<{ id?: string; notes?: string }>;
      };
      const taskA = Array.isArray(raw.tasks)
        ? raw.tasks.find((row) => row.id === "TASK-A")
        : undefined;
      const occurrences = (taskA?.notes?.match(/\[rationale:refactor\] motivo repetido/g) ?? []).length;
      expect(occurrences).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
