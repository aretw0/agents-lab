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
  updateProjectTaskDependencies,
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
      expect(created.summary).toBe("board-task-create: ok=yes task=TASK-D status=planned");
      expect(created.task).toMatchObject({ id: "TASK-D", status: "planned", milestone: "MS-LOCAL" });
      expect(created.task?.hasRationale).toBe(true);

      const duplicate = createProjectTaskBoard(cwd, {
        id: "TASK-D",
        description: "duplicada",
      });
      expect(duplicate).toMatchObject({
        ok: false,
        reason: "task-already-exists",
        summary: "board-task-create: ok=no task=TASK-D status=planned reason=task-already-exists",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("captures emergent tangent provenance in task notes", () => {
    const cwd = seedWorkspace();
    try {
      const created = createProjectTaskBoard(cwd, {
        id: "TASK-TANGENT",
        description: "Fatia emergente aprovada",
        provenanceOrigin: "tangent-approved",
        sourceTaskId: "TASK-A",
        sourceReason: "desvio necessário para desbloquear validação",
      });

      expect(created.ok).toBe(true);
      const tasks = JSON.parse(readFileSync(join(cwd, ".project", "tasks.json"), "utf8")) as {
        tasks: Array<{ id: string; notes?: string }>;
      };
      const tangent = tasks.tasks.find((row) => row.id === "TASK-TANGENT");
      expect(tangent?.notes).toContain("[provenance:tangent-approved]");
      expect(tangent?.notes).toContain("source_task=TASK-A");
      expect(tangent?.notes).toContain("desvio necessário para desbloquear validação");
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

  it("blocks creating local-safe task that depends on protected parked dependency", () => {
    const cwd = seedWorkspace();
    try {
      createProjectTaskBoard(cwd, {
        id: "TASK-PROTECTED",
        description: "Pesquisa externa parked",
        milestone: "protected-parked-legacy",
      });

      const blocked = createProjectTaskBoard(cwd, {
        id: "TASK-LOCAL-BLOCKED",
        description: "Task local-safe",
        dependsOn: ["TASK-PROTECTED"],
      });

      expect(blocked).toMatchObject({
        ok: false,
        reason: "local-safe-depends-on-protected",
      });

      const allowedProtected = createProjectTaskBoard(cwd, {
        id: "TASK-PROTECTED-CHILD",
        description: "Task protected child",
        milestone: "protected-parked-legacy",
        dependsOn: ["TASK-PROTECTED"],
      });
      expect(allowedProtected.ok).toBe(true);
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
      expect(ready.readyForOperatorDecision).toBe(true);
      expect(ready.recommendedDecision).toBe("close");
      expect(ready.options).toEqual(["close", "keep-open", "defer"]);
      expect(ready.evidence[0]).toMatchObject({ verificationId: "VER-1", status: "passed" });
      expect(ready.summary).toContain("ask operator");

      const blocked = buildProjectTaskDecisionPacket(cwd, "TASK-B");
      expect(blocked.readyForOperatorDecision).toBe(false);
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

  it("updates task dependencies dry-first and blocks missing/cycles/protected-coupling", () => {
    const cwd = seedWorkspace();
    try {
      createProjectTaskBoard(cwd, {
        id: "TASK-PROTECTED",
        description: "Pesquisa externa parked",
        milestone: "protected-parked-legacy",
      });

      const missingTaskId = updateProjectTaskDependencies(cwd, {
        addDependsOn: ["TASK-A"],
      });
      expect(missingTaskId).toMatchObject({
        ok: false,
        reason: "missing-task-id",
        recommendationCode: "dependency-update-invalid-input",
      });
      expect(missingTaskId.summary).toContain("code=dependency-update-invalid-input");

      const taskNotFound = updateProjectTaskDependencies(cwd, {
        taskId: "TASK-NOT-FOUND",
        addDependsOn: ["TASK-A"],
      });
      expect(taskNotFound).toMatchObject({
        ok: false,
        reason: "task-not-found",
        recommendationCode: "dependency-update-invalid-input",
      });
      expect(taskNotFound.summary).toContain("code=dependency-update-invalid-input");

      const missingInputDependencies = updateProjectTaskDependencies(cwd, {
        taskId: "TASK-C",
        addDependsOn: [],
      });
      expect(missingInputDependencies).toMatchObject({
        ok: false,
        reason: "missing-dependencies",
        recommendationCode: "dependency-update-invalid-input",
      });
      expect(missingInputDependencies.summary).toContain("code=dependency-update-invalid-input");

      const dryRun = updateProjectTaskDependencies(cwd, {
        taskId: "TASK-C",
        addDependsOn: ["TASK-A"],
      });
      expect(dryRun.ok).toBe(true);
      expect(dryRun.applied).toBe(false);
      expect(dryRun.dryRun).toBe(true);
      expect(dryRun.after).toEqual(["TASK-A"]);
      expect(dryRun.recommendationCode).toBe("dependency-update-ready");
      expect(dryRun.summary).toContain("code=dependency-update-ready");

      const applied = updateProjectTaskDependencies(cwd, {
        taskId: "TASK-C",
        addDependsOn: ["TASK-A"],
        dryRun: false,
      });
      expect(applied.ok).toBe(true);
      expect(applied.applied).toBe(true);
      expect(applied.task?.dependsOnCount).toBe(1);

      const missing = updateProjectTaskDependencies(cwd, {
        taskId: "TASK-C",
        addDependsOn: ["TASK-MISSING"],
        dryRun: false,
      });
      expect(missing).toMatchObject({
        ok: false,
        applied: false,
        blockers: ["missing-dependencies"],
        recommendationCode: "dependency-update-blocked-missing",
      });
      expect(missing.summary).toContain("code=dependency-update-blocked-missing");

      const cycle = updateProjectTaskDependencies(cwd, {
        taskId: "TASK-A",
        addDependsOn: ["TASK-C"],
      });
      expect(cycle).toMatchObject({
        ok: false,
        blockers: ["dependency-cycle"],
        recommendationCode: "dependency-update-blocked-cycle",
      });
      expect(cycle.summary).toContain("code=dependency-update-blocked-cycle");

      const protectedBlocked = updateProjectTaskDependencies(cwd, {
        taskId: "TASK-C",
        replaceDependsOn: ["TASK-PROTECTED"],
        dryRun: false,
      });
      expect(protectedBlocked).toMatchObject({
        ok: false,
        applied: false,
        blockers: ["local-safe-depends-on-protected"],
        protectedDependencyIds: ["TASK-PROTECTED"],
        recommendationCode: "dependency-update-blocked-protected-coupling",
      });
      expect(protectedBlocked.summary).toContain("code=dependency-update-blocked-protected-coupling");
      expect(protectedBlocked.summary).toContain("protectedDeps=TASK-PROTECTED");

      const cycleAndMissing = updateProjectTaskDependencies(cwd, {
        taskId: "TASK-A",
        replaceDependsOn: ["TASK-C", "TASK-MISSING"],
      });
      expect(cycleAndMissing.blockers).toEqual(expect.arrayContaining(["dependency-cycle", "missing-dependencies"]));
      expect(cycleAndMissing.recommendationCode).toBe("dependency-update-blocked-cycle");
      expect(cycleAndMissing.summary).toContain("code=dependency-update-blocked-cycle");

      const protectedCycleMissing = updateProjectTaskDependencies(cwd, {
        taskId: "TASK-A",
        replaceDependsOn: ["TASK-PROTECTED", "TASK-C", "TASK-MISSING"],
      });
      expect(protectedCycleMissing.blockers).toEqual(
        expect.arrayContaining(["local-safe-depends-on-protected", "dependency-cycle", "missing-dependencies"]),
      );
      expect(protectedCycleMissing.protectedDependencyIds).toEqual(["TASK-PROTECTED"]);
      expect(protectedCycleMissing.recommendationCode).toBe("dependency-update-blocked-protected-coupling");

      createProjectTaskBoard(cwd, {
        id: "TASK-PROTECTED-CHILD",
        description: "Task protected child",
        milestone: "protected-parked-legacy",
      });
      const protectedAllowed = updateProjectTaskDependencies(cwd, {
        taskId: "TASK-PROTECTED-CHILD",
        replaceDependsOn: ["TASK-PROTECTED"],
        dryRun: false,
      });
      expect(protectedAllowed.ok).toBe(true);
      expect(protectedAllowed.applied).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("quality gate flags macro tasks with implicit dependencies but allows small tasks", () => {
    const cwd = seedWorkspace();
    try {
      createProjectTaskBoard(cwd, {
        id: "TASK-MACRO",
        description: "Calibrar execução ininterrupta multi-modo com gate de governança",
        status: "in-progress",
        files: [
          "packages/pi-stack/extensions/project-board-surface.ts",
          "packages/pi-stack/test/smoke/project-board-surface.test.ts",
          "docs/guides/control-plane-operating-doctrine.md",
          ".github/workflows/ci.yml",
          ".project/tasks.json",
        ],
        acceptanceCriteria: ["Critério amplo", "Dependências explícitas", "Verificações rastreáveis"],
        note: "[rationale:risk-control] macro-task precisa de side quests explícitas",
      });

      const macro = buildProjectTaskQualityGate(cwd, "TASK-MACRO");
      expect(macro.ok).toBe(true);
      expect(macro.macroCandidate).toBe(true);
      expect(macro.closeAllowed).toBe(false);
      expect(macro.decision).toBe("needs-decomposition");
      expect(macro.blockers).toContain("macro-task-missing-dependencies");

      updateProjectTaskDependencies(cwd, {
        taskId: "TASK-MACRO",
        addDependsOn: ["TASK-C"],
        dryRun: false,
      });
      const unresolved = buildProjectTaskQualityGate(cwd, "TASK-MACRO");
      expect(unresolved.closeAllowed).toBe(false);
      expect(unresolved.blockers).toContain("unresolved-dependencies");
      expect(unresolved.unresolvedDependencies).toEqual(["TASK-C"]);

      const small = buildProjectTaskQualityGate(cwd, "TASK-C");
      expect(small.ok).toBe(true);
      expect(small.macroCandidate).toBe(false);
      expect(small.closeAllowed).toBe(true);
      expect(small.warnings).toContain("small-task-no-dependencies-ok");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("builds report-only planning clarity score with decomposition warnings", () => {
    const cwd = seedWorkspace();
    try {
      createProjectTaskBoard(cwd, {
        id: "TASK-MACRO",
        description: "Macro pipeline governança multi-modo long-run",
        status: "planned",
        milestone: "MS-LONG",
        files: [
          "packages/pi-stack/extensions/project-board-surface.ts",
          "packages/pi-stack/test/smoke/project-board-surface.test.ts",
          "docs/guides/control-plane-operating-doctrine.md",
          ".github/workflows/ci.yml",
          ".project/tasks.json",
        ],
        acceptanceCriteria: ["decomposição", "verificação", "evidência"],
      });

      const scoreAll = buildBoardPlanningClarityScore(cwd);
      expect(scoreAll.ok).toBe(true);
      expect(scoreAll.recommendationCode).toBe("planning-clarity-needs-decomposition");
      expect(scoreAll.metrics.macroOpenTasks).toBeGreaterThan(0);
      expect(scoreAll.metrics.macroWithDependencies).toBe(0);

      const scoreMilestone = buildBoardPlanningClarityScore(cwd, { milestone: "MS-LONG" });
      expect(scoreMilestone.ok).toBe(true);
      expect(scoreMilestone.metrics.openTasks).toBe(1);
      expect(scoreMilestone.recommendationCode).toBe("planning-clarity-needs-decomposition");
      expect(scoreMilestone.summary).toContain("board-planning-score:");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("builds dependency health snapshot for healthy, blocked, and milestone-filtered scopes", () => {
    const cwd = seedWorkspace();
    try {
      const healthy = buildBoardDependencyHealthSnapshot(cwd);
      expect(healthy.ok).toBe(true);
      expect(healthy.recommendationCode).toBe("board-dependency-health-strong");
      expect(healthy.metrics.tasksWithBlockers).toBe(0);

      writeFileSync(
        join(cwd, ".project", "tasks.json"),
        `${JSON.stringify(
          {
            tasks: [
              { id: "TASK-LOCAL-A", description: "missing ref", status: "planned", milestone: "MS-A", depends_on: ["TASK-MISSING"] },
              { id: "TASK-LOCAL-B", description: "cycle b", status: "planned", milestone: "MS-A", depends_on: ["TASK-LOCAL-C"] },
              { id: "TASK-LOCAL-C", description: "cycle c", status: "planned", milestone: "MS-A", depends_on: ["TASK-LOCAL-B"] },
              { id: "TASK-PROTECTED", description: "pesquisa externa", status: "planned", milestone: "protected-parked-legacy" },
              { id: "TASK-LOCAL-D", description: "depends protected", status: "planned", milestone: "MS-A", depends_on: ["TASK-PROTECTED"] },
              { id: "TASK-MS-B-OK", description: "scope B sem blocker", status: "planned", milestone: "MS-B", depends_on: ["TASK-LOCAL-B"] },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const blocked = buildBoardDependencyHealthSnapshot(cwd);
      expect(blocked.recommendationCode).toBe("board-dependency-health-protected-coupling");
      expect(blocked.metrics.tasksWithBlockers).toBeGreaterThan(0);
      expect(blocked.metrics.missingReferenceCount).toBeGreaterThan(0);
      expect(blocked.metrics.cycleReferenceCount).toBeGreaterThan(0);
      expect(blocked.metrics.protectedCouplingCount).toBeGreaterThan(0);
      expect(blocked.summary).toContain("code=board-dependency-health-protected-coupling");

      const filtered = buildBoardDependencyHealthSnapshot(cwd, { milestone: "MS-B" });
      expect(filtered.metrics.sampledTasks).toBe(1);
      expect(filtered.metrics.tasksWithBlockers).toBe(0);
      expect(filtered.recommendationCode).toBe("board-dependency-health-strong");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("builds dependency hygiene score for healthy and coupling-critical scopes", () => {
    const cwd = seedWorkspace();
    try {
      const healthy = buildBoardDependencyHygieneScore(cwd);
      expect(healthy.recommendationCode).toBe("board-dependency-hygiene-strong");
      expect(healthy.score).toBeGreaterThanOrEqual(90);

      writeFileSync(
        join(cwd, ".project", "tasks.json"),
        `${JSON.stringify(
          {
            tasks: [
              { id: "TASK-X", description: "missing ref", status: "planned", depends_on: ["TASK-MISSING"] },
              { id: "TASK-Y", description: "cycle y", status: "planned", depends_on: ["TASK-Z"] },
              { id: "TASK-Z", description: "cycle z", status: "planned", depends_on: ["TASK-Y"] },
              { id: "TASK-P", description: "pesquisa externa", status: "planned", milestone: "protected-parked-legacy" },
              { id: "TASK-L", description: "local", status: "planned", depends_on: ["TASK-P"] },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const critical = buildBoardDependencyHygieneScore(cwd);
      expect(critical.recommendationCode).toBe("board-dependency-hygiene-critical-protected-coupling");
      expect(critical.dimensions.coupling).toBeLessThan(80);
      expect(critical.summary).toContain("board-dependency-hygiene-score:");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("registers dependency/quality/clarity/snapshot/hygiene tools", async () => {
    const cwd = seedWorkspace();
    try {
      const pi = makeMockPi();
      projectBoardSurfaceExtension(pi);
      const depTool = getTool(pi, "board_task_dependencies");
      const gateTool = getTool(pi, "board_task_quality_gate");
      const planningTool = getTool(pi, "board_planning_clarity_score");
      const snapshotTool = getTool(pi, "board_dependency_health_snapshot");
      const hygieneTool = getTool(pi, "board_dependency_hygiene_score");

      const depResult = await depTool.execute(
        "tc-deps",
        { task_id: "TASK-C", add_depends_on: ["TASK-A"] },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );
      expect(depResult.details?.applied).toBe(false);
      expect(depResult.details?.recommendationCode).toBe("dependency-update-ready");
      expect(String(depResult.details?.summary)).toContain("dryRun=yes");
      expect(String(depResult.details?.summary)).toContain("code=dependency-update-ready");

      const gateResult = await gateTool.execute(
        "tc-quality",
        { task_id: "TASK-C" },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );
      expect(gateResult.details?.closeAllowed).toBe(true);

      const planningResult = await planningTool.execute(
        "tc-planning",
        {},
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );
      expect(planningResult.details?.ok).toBe(true);
      expect(planningResult.details?.recommendationCode).toBe("planning-clarity-strong");
      expect(String(planningResult.details?.summary)).toContain("board-planning-score:");

      const snapshotResult = await snapshotTool.execute(
        "tc-dependency-health",
        {},
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );
      expect(snapshotResult.details?.ok).toBe(true);
      expect(String(snapshotResult.details?.summary)).toContain("board-dependency-health:");

      const hygieneResult = await hygieneTool.execute(
        "tc-dependency-hygiene",
        {},
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );
      expect(hygieneResult.details?.ok).toBe(true);
      expect(String(hygieneResult.details?.summary)).toContain("board-dependency-hygiene-score:");
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
      expect(appended.summary).toBe("board-verification-append: ok=yes verification=VER-3 target=TASK-C linked=yes");
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
      })).toMatchObject({
        ok: false,
        reason: "missing-verification-evidence",
        summary: "board-verification-append: ok=no verification=VER-X target=TASK-C linked=no reason=missing-verification-evidence",
      });
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
      expect(completed.summary).toBe("board-task-complete: ok=yes task=TASK-C verification=VER-COMPLETE status=completed");
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

  it("completeProjectTaskBoardWithVerification auto-advances handoff focus when successor is unambiguous", () => {
    const cwd = seedFocusAutoAdvanceWorkspace(1);
    try {
      const completed = completeProjectTaskBoardWithVerification(cwd, {
        taskId: "TASK-FOCUS",
        verificationId: "VER-FOCUS-DONE",
        method: "test",
        evidence: "smoke ok [rationale:risk-control]",
      });

      expect(completed.ok).toBe(true);
      expect(completed.focusAutoAdvance).toMatchObject({
        applied: true,
        reason: "applied",
        nextFocusTaskIds: ["TASK-NEXT-1"],
      });

      const handoff = JSON.parse(readFileSync(join(cwd, ".project", "handoff.json"), "utf8")) as { current_tasks?: string[] };
      expect(handoff.current_tasks).toEqual(["TASK-NEXT-1"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("completeProjectTaskBoardWithVerification keeps handoff unchanged when successor is ambiguous", () => {
    const cwd = seedFocusAutoAdvanceWorkspace(2);
    try {
      const completed = completeProjectTaskBoardWithVerification(cwd, {
        taskId: "TASK-FOCUS",
        verificationId: "VER-FOCUS-DONE",
        method: "test",
        evidence: "smoke ok [rationale:risk-control]",
      });

      expect(completed.ok).toBe(true);
      expect(completed.focusAutoAdvance).toMatchObject({
        applied: false,
        reason: "ambiguous-local-safe-successors",
      });

      const handoff = JSON.parse(readFileSync(join(cwd, ".project", "handoff.json"), "utf8")) as { current_tasks?: string[] };
      expect(handoff.current_tasks).toEqual(["TASK-FOCUS"]);
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
      expect(blocked).toMatchObject({
        ok: false,
        reason: "rationale-consistency-required-to-complete-task",
        summary: "board-task-complete: ok=no task=TASK-MISMATCH verification=VER-MISMATCH status=blocked reason=rationale-consistency-required-to-complete-task",
      });
      expect(queryProjectVerification(cwd, { target: "TASK-MISMATCH", limit: 10 }).filtered).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

});
