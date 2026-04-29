import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import projectBoardSurfaceExtension, {
  appendProjectVerificationBoard,
  buildProjectTaskDecisionPacket,
  completeProjectTaskBoardWithVerification,
  createProjectTaskBoard,
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

  it("queryProjectTasks filtra por status/limit e usa cache incremental", () => {
    const cwd = seedWorkspace();
    try {
      const first = queryProjectTasks(cwd, { status: "in-progress", limit: 5 });
      expect(first.total).toBe(3);
      expect(first.filtered).toBe(1);
      expect(first.rows[0]?.id).toBe("TASK-A");
      expect(first.rows[0]?.rationaleSource).toBe("none");
      expect(first.rows[0]?.rationaleConsistency).toBe("none");
      expect(first.rationaleSummary?.required).toBe(0);
      expect(first.rationaleConsistencySummary?.none).toBe(1);
      expect(first.meta.cacheHit).toBe(false);

      const second = queryProjectTasks(cwd, { status: "in-progress", limit: 5 });
      expect(second.meta.cacheHit).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("createProjectTaskBoard creates bounded tasks and rejects duplicates", () => {
    const cwd = seedWorkspace();
    try {
      const created = createProjectTaskBoard(cwd, {
        id: "TASK-D",
        description: "Quarto slice",
        status: "planned",
        priority: "p1",
        dependsOn: ["TASK-A"],
        files: ["docs/example.md"],
        acceptanceCriteria: ["Gate focal verde"],
        milestone: "MS-LOCAL",
        note: "[rationale:risk-control] criar task via superfície bounded",
      });
      expect(created.ok).toBe(true);
      expect(created.task).toMatchObject({ id: "TASK-D", status: "planned", milestone: "MS-LOCAL" });
      expect(created.task?.hasRationale).toBe(true);

      const duplicate = createProjectTaskBoard(cwd, {
        id: "TASK-D",
        description: "duplicada",
      });
      expect(duplicate).toMatchObject({ ok: false, reason: "task-already-exists" });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("createProjectTaskBoard validates required fields and status", () => {
    const cwd = seedWorkspace();
    try {
      expect(createProjectTaskBoard(cwd, {
        id: "TASK-X",
        description: "",
      })).toMatchObject({ ok: false, reason: "missing-task-description" });
      expect(createProjectTaskBoard(cwd, {
        id: "TASK-X",
        description: "bad status",
        status: "cancelled" as never,
      })).toMatchObject({ ok: false, reason: "invalid-task-status" });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("buildProjectTaskDecisionPacket summarizes no-auto-close evidence without closing", () => {
    const cwd = seedWorkspace();
    try {
      const ready = buildProjectTaskDecisionPacket(cwd, "TASK-A");
      expect(ready.ok).toBe(true);
      expect(ready.noAutoClose).toBe(true);
      expect(ready.readyForHumanDecision).toBe(true);
      expect(ready.recommendedDecision).toBe("close");
      expect(ready.options).toEqual(["close", "keep-open", "defer"]);
      expect(ready.evidence[0]).toMatchObject({ verificationId: "VER-1", status: "passed" });
      expect(ready.summary).toContain("ask human");

      const blocked = buildProjectTaskDecisionPacket(cwd, "TASK-B");
      expect(blocked.readyForHumanDecision).toBe(false);
      expect(blocked.recommendedDecision).toBe("defer");
      expect(blocked.blockers).toContain("no-passed-verification");

      expect(buildProjectTaskDecisionPacket(cwd, "TASK-MISSING")).toMatchObject({
        ok: false,
        reason: "task-not-found",
        noAutoClose: true,
      });
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
      expect(result.rows[0]?.rationaleSource).toBe("none");
      expect(result.rows[0]?.rationaleConsistency).toBe("none");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("appendProjectVerificationBoard appends verification and can link target task", () => {
    const cwd = seedWorkspace();
    try {
      const appended = appendProjectVerificationBoard(cwd, {
        id: "VER-3",
        target: "TASK-C",
        targetType: "task",
        status: "passed",
        method: "test",
        evidence: "focal gate ok",
        timestamp: "2026-04-23T05:03:00Z",
        linkTask: true,
      });
      expect(appended.ok).toBe(true);
      expect(appended.verification).toMatchObject({ id: "VER-3", target: "TASK-C", status: "passed" });
      expect(appended.task?.verification).toBe("VER-3");

      const verification = queryProjectVerification(cwd, { target: "TASK-C", status: "passed", limit: 10 });
      expect(verification.rows[0]?.id).toBe("VER-3");
      const raw = JSON.parse(readFileSync(join(cwd, ".project", "verification.json"), "utf8")) as {
        verifications?: Array<{ id?: string; extra?: { keep?: boolean } }>;
      };
      expect(raw.verifications?.find((row) => row.id === "VER-1")?.extra?.keep).toBe(true);

      const duplicate = appendProjectVerificationBoard(cwd, {
        id: "VER-3",
        target: "TASK-C",
        status: "passed",
        method: "test",
        evidence: "duplicate",
      });
      expect(duplicate).toMatchObject({ ok: false, reason: "verification-already-exists" });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("appendProjectVerificationBoard validates minimal bounded fields", () => {
    const cwd = seedWorkspace();
    try {
      expect(appendProjectVerificationBoard(cwd, {
        id: "VER-X",
        target: "TASK-C",
        status: "passed",
        method: "test",
        evidence: "",
      })).toMatchObject({ ok: false, reason: "missing-verification-evidence" });
      expect(appendProjectVerificationBoard(cwd, {
        id: "VER-X",
        target: "TASK-C",
        status: "failed" as never,
        method: "test",
        evidence: "failure recorded",
        linkTask: true,
      }).ok).toBe(true);
      expect(appendProjectVerificationBoard(cwd, {
        id: "VER-Y",
        target: "TASK-MISSING",
        status: "passed",
        method: "test",
        evidence: "cannot link missing task",
        linkTask: true,
      })).toMatchObject({ ok: false, reason: "task-target-not-found" });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("completeProjectTaskBoardWithVerification appends, links, and completes", () => {
    const cwd = seedWorkspace();
    try {
      const completed = completeProjectTaskBoardWithVerification(cwd, {
        taskId: "TASK-C",
        verificationId: "VER-COMPLETE",
        method: "test",
        evidence: "completion gate passed [rationale:risk-control] bounded close",
        appendNote: "completed through bounded helper",
      });
      expect(completed.ok).toBe(true);
      expect(completed.verification).toMatchObject({ id: "VER-COMPLETE", status: "passed" });
      expect(completed.task).toMatchObject({ id: "TASK-C", status: "completed", verification: "VER-COMPLETE" });

      const duplicate = completeProjectTaskBoardWithVerification(cwd, {
        taskId: "TASK-C",
        verificationId: "VER-COMPLETE",
        method: "test",
        evidence: "duplicate [rationale:risk-control]",
      });
      expect(duplicate).toMatchObject({ ok: false, reason: "verification-already-exists" });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("completeProjectTaskBoardWithVerification blocks sensitive completion without rationale before append", () => {
    const cwd = seedWorkspace();
    try {
      const created = createProjectTaskBoard(cwd, {
        id: "TASK-REF",
        description: "Refactor sensitive path",
        status: "in-progress",
      });
      expect(created.ok).toBe(true);

      const blocked = completeProjectTaskBoardWithVerification(cwd, {
        taskId: "TASK-REF",
        verificationId: "VER-REF",
        method: "test",
        evidence: "tests passed",
      });
      expect(blocked).toMatchObject({ ok: false, reason: "rationale-required-to-complete-sensitive-task" });
      expect(queryProjectVerification(cwd, { target: "TASK-REF", limit: 10 }).filtered).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("completeProjectTaskBoardWithVerification blocks rationale mismatch before append", () => {
    const cwd = seedWorkspace();
    try {
      const created = createProjectTaskBoard(cwd, {
        id: "TASK-MISMATCH",
        description: "Refactor with rationale mismatch",
        status: "in-progress",
        note: "[rationale:refactor] planned cleanup",
      });
      expect(created.ok).toBe(true);

      const blocked = completeProjectTaskBoardWithVerification(cwd, {
        taskId: "TASK-MISMATCH",
        verificationId: "VER-MISMATCH",
        method: "test",
        evidence: "tests passed [rationale:test-change] divergent reason",
      });
      expect(blocked).toMatchObject({ ok: false, reason: "rationale-consistency-required-to-complete-task" });
      expect(queryProjectVerification(cwd, { target: "TASK-MISMATCH", limit: 10 }).filtered).toBe(0);
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

  it("board_decision_packet tool emits compact human decision options", async () => {
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
      expect((result.details as any)?.readyForHumanDecision).toBe(true);
      expect((result.details as any)?.options).toEqual(["close", "keep-open", "defer"]);
      expect((result.details as any)?.evidence?.[0]?.verificationId).toBe("VER-1");
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
        },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect((result.details as any)?.ok).toBe(true);
      expect((result.details as any)?.task).toMatchObject({ id: "TASK-TOOL", status: "in-progress" });
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
      expect((result.details as any)?.verification?.id).toBe("VER-TOOL");
      expect((result.details as any)?.task?.verification).toBe("VER-TOOL");
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
      expect((result.details as any)?.verification?.id).toBe("VER-TOOL-COMPLETE");
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
});
