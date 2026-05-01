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
  });
});
