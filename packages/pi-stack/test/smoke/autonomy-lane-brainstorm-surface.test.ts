import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerGuardrailsLaneBrainstormSurface } from "../../extensions/guardrails-core-lane-brainstorm-surface";

type RegisteredTool = {
  name: string;
  execute: (toolCallId: string, params: Record<string, unknown>, signal?: unknown, onUpdate?: unknown, ctx?: { cwd: string }) => { details: Record<string, unknown>; content?: Array<{ text?: string }> };
};

function registerTools(): RegisteredTool[] {
  const tools: RegisteredTool[] = [];
  registerGuardrailsLaneBrainstormSurface({
    registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
  } as never);
  return tools;
}

describe("autonomy lane brainstorm surface", () => {
  it("emits report-only lane_brainstorm_packet with ranked slices", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "lane-brainstorm-packet-ready-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-LOCAL", description: "[P1] local lane", status: "planned" },
      ],
    }), "utf8");

    const brainstormTool = registerTools().find((tool) => tool.name === "lane_brainstorm_packet");
    const result = brainstormTool?.execute("call-test", {
      goal: "desinflar superficies",
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
    expect(result?.details.decision).toBe("ready-for-operator-decision");
    expect(result?.details.recommendationCode).toBe("seed-local-safe-lane");
    expect((result?.details.selectedSlices as unknown[] | undefined)?.length).toBeGreaterThan(0);
    expect(String(result?.content?.[0]?.text ?? "")).toContain("lane-brainstorm: decision=ready-for-operator-decision");
    expect(String(result?.content?.[0]?.text ?? "")).toContain("next=seed-preview");
    expect(String(result?.content?.[0]?.text ?? "")).toContain("payload completo");
    expect(String(result?.content?.[0]?.text ?? "")).not.toContain('\"selectedSlices\"');
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

    const brainstormTool = registerTools().find((tool) => tool.name === "lane_brainstorm_packet");
    const result = brainstormTool?.execute("call-test", {
      goal: "preparar lane",
      ideas: [{ id: "", theme: "" }],
      max_slices: 999,
      sample_limit: 20,
    }, undefined, undefined, { cwd });

    const selected = (result?.details.selectedSlices as Array<{ sourceTaskId?: string }> | undefined) ?? [];
    expect(result?.details.decision).toBe("ready-for-operator-decision");
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

    const brainstormTool = registerTools().find((tool) => tool.name === "lane_brainstorm_packet");
    const result = brainstormTool?.execute("call-test", { goal: "lane longa" }, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("blocked");
    expect(result?.details.recommendationCode).toBe("needs-operator-focus-protected");
    expect(typeof result?.details.nextAction).toBe("string");
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.mutationAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
    expect(String(result?.content?.[0]?.text ?? "")).toContain("lane-brainstorm: decision=blocked");
    expect(String(result?.content?.[0]?.text ?? "")).toContain("next=resolve-blockers");
    expect(String(result?.content?.[0]?.text ?? "")).toContain("payload completo");
  });

  it("emits bootstrap seed proposals when the board has no local-safe eligible task", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "lane-brainstorm-packet-bootstrap-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-DONE", description: "[P1] already done", status: "completed" },
      ],
    }), "utf8");

    const brainstormTool = registerTools().find((tool) => tool.name === "lane_brainstorm_packet");
    const result = brainstormTool?.execute("call-test", { goal: "encontrar próxima fatia local-safe" }, undefined, undefined, { cwd });

    const selected = (result?.details.selectedSlices as Array<{ sourceIdeaId?: string }> | undefined) ?? [];
    expect(result?.details.decision).toBe("ready-for-operator-decision");
    expect(result?.details.recommendationCode).toBe("seed-local-safe-lane");
    expect(selected.map((slice) => slice.sourceIdeaId)).toEqual([
      "bootstrap-board-hygiene",
      "bootstrap-runtime-readiness",
      "bootstrap-doc-contract",
    ]);
    expect(String(result?.content?.[0]?.text ?? "")).toContain("lane-brainstorm: decision=ready-for-operator-decision");
    expect(String(result?.content?.[0]?.text ?? "")).toContain("slices=3");
  });

  it("emits visible brainstorm seed preview that requires operator confirmation", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "lane-brainstorm-seed-preview-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-LOCAL", description: "[P1] local lane", status: "planned" },
      ],
    }), "utf8");

    const seedTool = registerTools().find((tool) => tool.name === "lane_brainstorm_seed_preview");
    const result = seedTool?.execute("call-test", {
      ideas: [{ id: "idea-a", theme: "dedupe", value: "high", risk: "low", effort: "low" }],
      source: "tangent-approved",
    }, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("needs-operator-seeding-decision");
    expect(result?.details.recommendationCode).toBe("brainstorm-seeding-preview");
    expect(String(result?.details.nextAction)).toContain("choose proposals");
    expect(result?.details.confirmationRequired).toBe(true);
    expect(result?.details.source).toBe("tangent-approved");
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.mutationAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
    expect(String(result?.content?.[0]?.text ?? "")).toContain("lane-brainstorm-seed-preview: decision=needs-operator-seeding-decision");
    expect(String(result?.content?.[0]?.text ?? "")).toContain("next=operator-seeding-decision");
    expect(String(result?.content?.[0]?.text ?? "")).toContain("payload completo");
    expect(String(result?.content?.[0]?.text ?? "")).not.toContain('\"proposals\"');
  });

  it("keeps brainstorm seed preview blocked for protected-only lane", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "lane-brainstorm-seed-preview-blocked-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-COLONY-PROMOTION", description: "[P0] revisar colony promotion candidate", status: "planned" },
      ],
    }), "utf8");

    const seedTool = registerTools().find((tool) => tool.name === "lane_brainstorm_seed_preview");
    const result = seedTool?.execute("call-test", {}, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("blocked");
    expect(result?.details.recommendationCode).toBe("brainstorm-seeding-blocked");
    expect(String(result?.details.nextAction).length).toBeGreaterThan(5);
    expect(result?.details.confirmationRequired).toBe(true);
    expect(result?.details.dispatchAllowed).toBe(false);
  });

  it("previews seed materialization without mutating the board", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "lane-brainstorm-seed-decision-preview-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [] }), "utf8");

    const seedDecisionTool = registerTools().find((tool) => tool.name === "lane_brainstorm_seed_decision");
    const result = seedDecisionTool?.execute("call-test", {
      ideas: [{ id: "idea-a", theme: "seed deterministic local-safe slice", value: "high", risk: "low", effort: "low" }],
      task_ids: ["TASK-SEED-1"],
    }, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("needs-operator-seeding-decision");
    expect(result?.details.mutationAllowed).toBe(false);
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.plannedTasks).toHaveLength(1);
    expect(result?.details.plannedTasks[0]).toMatchObject({
      id: "TASK-SEED-1",
      status: "planned",
      priority: "p1",
    });
    const tasks = JSON.parse(readFileSync(path.join(cwd, ".project", "tasks.json"), "utf8"));
    expect(tasks.tasks).toEqual([]);
  });

  it("blocks seed materialization apply without structured approval", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "lane-brainstorm-seed-decision-blocked-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [] }), "utf8");

    const seedDecisionTool = registerTools().find((tool) => tool.name === "lane_brainstorm_seed_decision");
    const result = seedDecisionTool?.execute("call-test", {
      ideas: [{ id: "idea-a", theme: "seed deterministic local-safe slice", value: "high", risk: "low", effort: "low" }],
      task_ids: ["TASK-SEED-1"],
      apply: true,
    }, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("blocked");
    expect(result?.details.blockers).toContain("structured-operator-approval-required");
    expect(result?.details.mutationAllowed).toBe(false);
    const tasks = JSON.parse(readFileSync(path.join(cwd, ".project", "tasks.json"), "utf8"));
    expect(tasks.tasks).toEqual([]);
  });

  it("applies selected seed proposals with structured approval and explicit ids", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "lane-brainstorm-seed-decision-apply-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [] }), "utf8");

    const seedDecisionTool = registerTools().find((tool) => tool.name === "lane_brainstorm_seed_decision");
    const result = seedDecisionTool?.execute("call-test", {
      ideas: [{ id: "idea-a", theme: "seed deterministic local-safe slice", value: "high", risk: "low", effort: "low" }],
      task_ids: ["TASK-SEED-1"],
      apply: true,
      operator_approval: { packet_mode: "operator-approval-packet", approved: true, approval_state: "approved" },
      source: "operator",
    }, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("applied");
    expect(result?.details.mutationAllowed).toBe(true);
    expect(result?.details.dispatchAllowed).toBe(false);
    const tasks = JSON.parse(readFileSync(path.join(cwd, ".project", "tasks.json"), "utf8"));
    expect(tasks.tasks).toHaveLength(1);
    expect(tasks.tasks[0]).toMatchObject({
      id: "TASK-SEED-1",
      description: "seed deterministic local-safe slice",
      status: "planned",
      priority: "p1",
    });
    expect(String(tasks.tasks[0].notes)).toContain("[provenance:operator]");
  });
});
