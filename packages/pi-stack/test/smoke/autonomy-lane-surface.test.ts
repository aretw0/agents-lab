import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerGuardrailsAutonomyLaneSurface } from "../../extensions/guardrails-core-autonomy-lane-surface";

type RegisteredTool = {
  name: string;
  execute: (toolCallId: string, params: Record<string, unknown>, signal?: unknown, onUpdate?: unknown, ctx?: { cwd: string }) => { details: Record<string, unknown> };
};

describe("autonomy lane surface", () => {
  it("registers side-effect-free planning tool with pi execute signature", () => {
    const tools: RegisteredTool[] = [];

    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const planTool = tools.find((tool) => tool.name === "autonomy_lane_plan");
    expect(planTool?.name).toBe("autonomy_lane_plan");
    const result = planTool?.execute("call-test", {
      context_level: "warn",
      context_percent: 60,
      board_ready: true,
      next_task_id: "TASK-NEXT",
    });

    expect(result?.details.ready).toBe(true);
    expect(result?.details.decision).toBe("bounded");
    expect(result?.details.allowedWork).toBe("bounded-only");
  });

  it("registers read-only next-task selector tool", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-surface-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-CI", description: "[P0] ci", status: "in-progress", files: [".github/workflows/test.yml"] },
        { id: "TASK-LOCAL", description: "[P1] local", status: "planned" },
      ],
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const nextTaskTool = tools.find((tool) => tool.name === "autonomy_lane_next_task");
    const result = nextTaskTool?.execute("call-test", {}, undefined, undefined, { cwd });

    expect(result?.details.ready).toBe(true);
    expect(result?.details.nextTaskId).toBe("TASK-LOCAL");
  });

  it("returns stable recommendationCode when no local-safe eligible task exists", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-surface-protected-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-COLONY-PROMOTION", description: "[P0] revisar colony promotion candidate", status: "planned" },
      ],
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const nextTaskTool = tools.find((tool) => tool.name === "autonomy_lane_next_task");
    const result = nextTaskTool?.execute("call-test", {}, undefined, undefined, { cwd });

    expect(result?.details.ready).toBe(false);
    expect(result?.details.reason).toBe("no-eligible-tasks");
    expect(result?.details.recommendationCode).toBe("local-stop-protected-focus-required");
  });

  it("uses handoff focus by default to avoid drifting to unrelated tasks", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-focus-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-REMOTE", description: "[P0] remote ci", status: "planned" },
        { id: "TASK-FOCUS", description: "[P2] focused local", status: "planned" },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({
      current_tasks: ["TASK-FOCUS"],
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const statusTool = tools.find((tool) => tool.name === "autonomy_lane_status");
    const result = statusTool?.execute("call-test", {}, undefined, undefined, { cwd });

    expect((result?.details.selection as { nextTaskId?: string } | undefined)?.nextTaskId).toBe("TASK-FOCUS");
    expect((result?.details.selection as { focusSource?: string } | undefined)?.focusSource).toBe("handoff");
  });

  it("registers composed status tool with board selection and lane plan", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-status-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-NEXT", description: "[P1] local", status: "planned" },
      ],
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const statusTool = tools.find((tool) => tool.name === "autonomy_lane_status");
    const result = statusTool?.execute("call-test", { context_level: "warn", provider_ready: 1 }, undefined, undefined, { cwd });

    expect(result?.details.ready).toBe(true);
    expect((result?.details.selection as { nextTaskId?: string } | undefined)?.nextTaskId).toBe("TASK-NEXT");
    expect((result?.details.plan as { decision?: string } | undefined)?.decision).toBe("bounded");
    expect(result?.details.recommendationCode).toBe("execute-bounded-slice");
    expect(result?.details.nextAction).toContain("next=TASK-NEXT");
  });

  it("keeps plan non-blocked when board is readable but selection has no eligible local-safe task", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-status-protected-only-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-COLONY-PROMOTION", description: "[P0] revisar colony promotion candidate", status: "planned" },
      ],
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const statusTool = tools.find((tool) => tool.name === "autonomy_lane_status");
    const result = statusTool?.execute("call-test", {}, undefined, undefined, { cwd });
    const plan = (result?.details.plan as { decision?: string; stopReasons?: string[] } | undefined);
    const selection = (result?.details.selection as { reason?: string; recommendationCode?: string } | undefined);

    expect(result?.details.ready).toBe(false);
    expect(plan?.decision).not.toBe("blocked");
    expect(plan?.stopReasons ?? []).not.toContain("board-not-ready");
    expect(selection?.reason).toBe("no-eligible-tasks");
    expect(selection?.recommendationCode).toBe("local-stop-protected-focus-required");
    expect(result?.details.recommendationCode).toBe("local-stop-protected-focus-required");
    expect(result?.details.nextAction).toContain("local stop condition");
  });

  it("emits report-only project_intake_plan for lightweight project", () => {
    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const intakeTool = tools.find((tool) => tool.name === "project_intake_plan");
    const result = intakeTool?.execute("call-test", {
      dominant_artifacts: ["markdown", "obsidian"],
      has_build_files: false,
      repository_scale: "small",
    });

    expect(result?.details.profile).toBe("light-notes");
    expect(result?.details.decision).toBe("ready-for-human-review");
    expect(result?.details.recommendationCode).toBe("intake-plan-first-slice");
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.mutationAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
    expect(result?.details.mode).toBe("report-only");
  });

  it("blocks project_intake_plan when protected scope is requested", () => {
    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const intakeTool = tools.find((tool) => tool.name === "project_intake_plan");
    const result = intakeTool?.execute("call-test", {
      dominant_artifacts: ["java", "typescript"],
      has_build_files: true,
      has_ci: true,
      protected_scope_requested: true,
    });

    expect(result?.details.decision).toBe("blocked");
    expect(result?.details.recommendationCode).toBe("intake-needs-human-focus-protected");
    expect(typeof result?.details.nextAction).toBe("string");
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.mutationAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
  });

  it("emits report-only lane_brainstorm_packet with ranked slices", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "lane-brainstorm-packet-ready-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-LOCAL", description: "[P1] local lane", status: "planned" },
      ],
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const brainstormTool = tools.find((tool) => tool.name === "lane_brainstorm_packet");
    const result = brainstormTool?.execute("call-test", {
      goal: "desinflar superfícies",
      ideas: [
        { id: "idea-a", theme: "dedupe outputs", value: "high", risk: "low", effort: "low" },
        { id: "idea-b", theme: "expand docs", value: "medium", risk: "medium", effort: "high" },
      ],
      max_slices: 2,
    }, undefined, undefined, { cwd });

    expect(result?.details.mode).toBe("report-only");
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.mutationAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
    expect(result?.details.decision).toBe("ready-for-human-review");
    expect(result?.details.recommendationCode).toBe("seed-local-safe-lane");
    expect((result?.details.selectedSlices as unknown[] | undefined)?.length).toBeGreaterThan(0);
  });

  it("clips max_slices and falls back to eligible tasks when ideas are invalid", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "lane-brainstorm-packet-fallback-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: Array.from({ length: 15 }, (_, i) => ({
        id: `TASK-LOCAL-${i + 1}`,
        description: `[P1] local lane ${i + 1}`,
        status: "planned",
      })),
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const brainstormTool = tools.find((tool) => tool.name === "lane_brainstorm_packet");
    const result = brainstormTool?.execute("call-test", {
      goal: "preparar lane",
      ideas: [{ id: "", theme: "" }],
      max_slices: 999,
      sample_limit: 20,
    }, undefined, undefined, { cwd });

    const selected = (result?.details.selectedSlices as Array<{ sourceTaskId?: string }> | undefined) ?? [];
    expect(result?.details.decision).toBe("ready-for-human-review");
    expect(result?.details.recommendationCode).toBe("seed-local-safe-lane");
    expect(selected).toHaveLength(10);
    expect(selected[0]?.sourceTaskId).toBe("TASK-LOCAL-1");
  });

  it("emits blocked lane_brainstorm_packet when only protected lane exists", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "lane-brainstorm-packet-blocked-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-COLONY-PROMOTION", description: "[P0] revisar colony promotion candidate", status: "planned" },
      ],
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const brainstormTool = tools.find((tool) => tool.name === "lane_brainstorm_packet");
    const result = brainstormTool?.execute("call-test", { goal: "lane longa" }, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("blocked");
    expect(result?.details.recommendationCode).toBe("needs-human-focus-protected");
    expect(typeof result?.details.nextAction).toBe("string");
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.mutationAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
  });

  it("emits visible brainstorm seed preview that requires human confirmation", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "lane-brainstorm-seed-preview-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-LOCAL", description: "[P1] local lane", status: "planned" },
      ],
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const seedTool = tools.find((tool) => tool.name === "lane_brainstorm_seed_preview");
    const result = seedTool?.execute("call-test", {
      ideas: [{ id: "idea-a", theme: "dedupe", value: "high", risk: "low", effort: "low" }],
      source: "tangent-approved",
    }, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("needs-human-seeding-decision");
    expect(result?.details.recommendationCode).toBe("brainstorm-seeding-preview");
    expect(String(result?.details.nextAction)).toContain("review proposals");
    expect(result?.details.confirmationRequired).toBe(true);
    expect(result?.details.source).toBe("tangent-approved");
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.mutationAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
  });

  it("keeps brainstorm seed preview blocked for protected-only lane", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "lane-brainstorm-seed-preview-blocked-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-COLONY-PROMOTION", description: "[P0] revisar colony promotion candidate", status: "planned" },
      ],
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const seedTool = tools.find((tool) => tool.name === "lane_brainstorm_seed_preview");
    const result = seedTool?.execute("call-test", {}, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("blocked");
    expect(result?.details.recommendationCode).toBe("brainstorm-seeding-blocked");
    expect(String(result?.details.nextAction).length).toBeGreaterThan(5);
    expect(result?.details.confirmationRequired).toBe(true);
    expect(result?.details.dispatchAllowed).toBe(false);
  });
});
