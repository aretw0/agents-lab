import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerGuardrailsAutonomyLaneSurface } from "../../extensions/guardrails-core-autonomy-lane-surface";

type RegisteredTool = {
  name: string;
  execute: (toolCallId: string, params: Record<string, unknown>, signal?: unknown, onUpdate?: unknown, ctx?: { cwd: string }) => { details: Record<string, unknown>; content?: Array<{ text?: string }> };
};

function initCleanGitRepo(cwd: string): void {
  writeFileSync(path.join(cwd, ".gitkeep"), "seed\n", "utf8");
  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Pi Smoke"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "pi-smoke@example.com"], { cwd, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "seed"], { cwd, stdio: "ignore" });
}


describe("autonomy lane material packets", () => {
  it("emits continue material-readiness packet when AFK stock is healthy", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-material-readiness-ok-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-FOCUS",
          description: "[P1] focused local slice",
          status: "in-progress",
          acceptance_criteria: ["run smoke test"],
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
          notes: "[rationale:risk-control] foco afk",
        },
        {
          id: "TASK-NEXT-1",
          description: "[P2] local slice 1",
          status: "planned",
          acceptance_criteria: ["run test"],
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
          notes: "[rationale:risk-control] keep afk stock",
        },
        {
          id: "TASK-NEXT-2",
          description: "[P2] local slice 2",
          status: "planned",
          acceptance_criteria: ["run test"],
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
          notes: "[rationale:risk-control] keep afk stock",
        },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({ current_tasks: ["TASK-FOCUS"] }), "utf8");
    initCleanGitRepo(cwd);

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const packetTool = tools.find((tool) => tool.name === "autonomy_lane_material_readiness_packet");
    const result = packetTool?.execute("call-test", { min_ready_slices: 3 }, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("continue");
    expect(result?.details.recommendationCode).toBe("afk-material-readiness-continue-stock-healthy");
    expect(result?.details.material.stockGap).toBe(4);
    expect(result?.details.material.recommendedSeedCount).toBe(4);
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
  });

  it("emits ready autonomy-lane-batch-preview packet with local-safe slices", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-batch-preview-ready-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-A",
          description: "[P1] local-safe slice A",
          status: "planned",
          acceptance_criteria: ["run smoke test A"],
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
        },
        {
          id: "TASK-B",
          description: "[P1] local-safe slice B",
          status: "planned",
          acceptance_criteria: ["run vitest smoke B"],
          files: ["packages/pi-stack/extensions/guardrails-core-autonomy-lane-surface.ts"],
        },
        {
          id: "TASK-C",
          description: "[P2] local-safe slice C",
          status: "planned",
          acceptance_criteria: ["inspection + marker-check"],
          files: ["docs/guides/control-plane-operating-doctrine.md"],
        },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({ current_tasks: ["TASK-A"] }), "utf8");
    initCleanGitRepo(cwd);

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const packetTool = tools.find((tool) => tool.name === "autonomy_lane_batch_preview");
    const result = packetTool?.execute("call-test", { slice_count: 7 }, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("ready");
    expect(result?.details.recommendationCode).toBe("autonomy-lane-batch-preview-ready");
    expect(result?.details.requestedSliceCount).toBe(7);
    expect(result?.details.availableSliceCount).toBe(3);
    const slices = (result?.details.slices as Array<Record<string, unknown>> | undefined) ?? [];
    expect(slices).toHaveLength(3);
    for (const slice of slices) {
      expect(typeof slice.taskId).toBe("string");
      expect(typeof slice.validationGate).toBe("string");
      expect(String(slice.validationGate).length).toBeGreaterThan(0);
      expect(typeof slice.rollback).toBe("string");
      expect(String(slice.rollback)).toContain("git restore");
    }
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
  });

  it("emits seed-backlog autonomy-lane-batch-preview packet when fewer than three slices are available", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-batch-preview-seed-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-A",
          description: "[P1] local-safe slice A",
          status: "planned",
          acceptance_criteria: ["run smoke test A"],
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
        },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({ current_tasks: ["TASK-A"] }), "utf8");
    initCleanGitRepo(cwd);

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const packetTool = tools.find((tool) => tool.name === "autonomy_lane_batch_preview");
    const result = packetTool?.execute("call-test", {}, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("seed-backlog");
    expect(result?.details.recommendationCode).toBe("autonomy-lane-batch-preview-seed-backlog");
    expect(result?.details.availableSliceCount).toBe(1);
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
  });

  it("emits blocked autonomy-lane-batch-preview packet when workspace is dirty", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-batch-preview-blocked-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-A",
          description: "[P1] local-safe slice A",
          status: "planned",
          acceptance_criteria: ["run smoke test A"],
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
        },
        {
          id: "TASK-B",
          description: "[P1] local-safe slice B",
          status: "planned",
          acceptance_criteria: ["run smoke test B"],
          files: ["packages/pi-stack/extensions/guardrails-core-autonomy-lane-surface.ts"],
        },
        {
          id: "TASK-C",
          description: "[P1] local-safe slice C",
          status: "planned",
          acceptance_criteria: ["run smoke test C"],
          files: ["docs/guides/control-plane-operating-doctrine.md"],
        },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({ current_tasks: ["TASK-A"] }), "utf8");
    initCleanGitRepo(cwd);
    writeFileSync(path.join(cwd, "dirty.txt"), "dirty\n", "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const packetTool = tools.find((tool) => tool.name === "autonomy_lane_batch_preview");
    const result = packetTool?.execute("call-test", {}, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("blocked");
    expect(result?.details.recommendationCode).toBe("autonomy-lane-batch-preview-blocked-reload-or-dirty");
    expect((result?.details.blockedReasons as string[])).toContain("reload-required-or-dirty");
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
  });

  it("emits seed-backlog material-readiness packet when AFK stock is low", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-material-readiness-seed-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-FOCUS",
          description: "[P1] focused local slice",
          status: "in-progress",
          acceptance_criteria: ["run smoke test"],
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
          notes: "[rationale:risk-control] foco afk",
        },
        {
          id: "TASK-NEXT-1",
          description: "[P2] local slice 1",
          status: "planned",
          acceptance_criteria: ["run test"],
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
          notes: "[rationale:risk-control] keep afk stock",
        },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({ current_tasks: ["TASK-FOCUS"] }), "utf8");
    initCleanGitRepo(cwd);

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const packetTool = tools.find((tool) => tool.name === "autonomy_lane_material_readiness_packet");
    const result = packetTool?.execute("call-test", { min_ready_slices: 3 }, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("seed-backlog");
    expect(result?.details.recommendationCode).toBe("afk-material-readiness-seed-backlog-low-stock");
    expect(result?.details.material.stockGap).toBe(5);
    expect(result?.details.material.recommendedSeedCount).toBe(5);
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
  });

  it("emits seed-now material-seed packet when AFK stock is low", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-material-seed-now-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-FOCUS",
          description: "[P1] focused local slice",
          status: "in-progress",
          acceptance_criteria: ["run smoke test"],
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
          notes: "[rationale:risk-control] foco afk",
        },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({ current_tasks: ["TASK-FOCUS"] }), "utf8");
    initCleanGitRepo(cwd);

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const packetTool = tools.find((tool) => tool.name === "autonomy_lane_material_seed_packet");
    const result = packetTool?.execute("call-test", { min_ready_slices: 3, max_seed_slices: 2 }, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("seed-now");
    expect(result?.details.recommendationCode).toBe("afk-material-seed-now-low-stock");
    expect((result?.details.reseedJustification as { reasonCode?: string; required?: boolean } | undefined)?.reasonCode).toBe("stock-below-target");
    expect((result?.details.reseedJustification as { reasonCode?: string; required?: boolean } | undefined)?.required).toBe(true);
    expect((result?.details.reseedPriority as { code?: string } | undefined)?.code).toBe("stock-health");
    expect(String(result?.details.summary ?? "")).toContain("seedWhy=stock-below-target");
    expect(String(result?.details.summary ?? "")).toContain("seedPriority=stock-health");
    expect(result?.details.humanActionRequired).toBe(true);
    expect((result?.details.seedTemplates as Array<unknown>) ?? []).toHaveLength(0);
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
  });

  it("emits bootstrap seed-now material-seed packet when focus is missing", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-material-seed-bootstrap-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-NEXT-1",
          description: "[P2] local slice 1",
          status: "planned",
          acceptance_criteria: ["run test"],
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
          notes: "[rationale:risk-control] keep afk stock",
        },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({ current_tasks: [] }), "utf8");
    initCleanGitRepo(cwd);

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const packetTool = tools.find((tool) => tool.name === "autonomy_lane_material_seed_packet");
    const result = packetTool?.execute("call-test", { min_ready_slices: 3 }, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("seed-now");
    expect(result?.details.recommendationCode).toBe("afk-material-seed-now-bootstrap");
    expect((result?.details.reseedJustification as { reasonCode?: string; required?: boolean } | undefined)?.reasonCode).toBe("bootstrap-focus-missing");
    expect((result?.details.reseedJustification as { reasonCode?: string; required?: boolean } | undefined)?.required).toBe(true);
    expect((result?.details.reseedPriority as { code?: string } | undefined)?.code).toBe("continuity-bootstrap");
    expect(result?.details.humanActionRequired).toBe(true);
    expect((result?.details.blockedReasons as string[])).toContain("focus-missing");
    expect(Array.isArray(result?.details.seedTemplates)).toBe(true);
    expect((result?.details.seedTemplates as Array<unknown>).length).toBeGreaterThan(0);
    expect((result?.details.seedTemplates as Array<unknown>).length).toBeLessThanOrEqual(3);
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
  });

  it("keeps material-seed blocked when readiness includes operational blockers", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-material-seed-operational-block-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-FOCUS",
          description: "[P1] focused local slice",
          status: "in-progress",
          acceptance_criteria: ["run smoke test"],
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
          notes: "[rationale:risk-control] foco afk",
        },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({ current_tasks: ["TASK-FOCUS"] }), "utf8");
    initCleanGitRepo(cwd);
    writeFileSync(path.join(cwd, "dirty.txt"), "dirty\n", "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const packetTool = tools.find((tool) => tool.name === "autonomy_lane_material_seed_packet");
    const result = packetTool?.execute("call-test", { min_ready_slices: 3 }, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("blocked");
    expect(result?.details.recommendationCode).toBe("afk-material-seed-blocked-readiness");
    expect((result?.details.reseedJustification as { reasonCode?: string; required?: boolean } | undefined)?.reasonCode).toBe("readiness-blocked");
    expect((result?.details.reseedJustification as { reasonCode?: string; required?: boolean } | undefined)?.required).toBe(false);
    expect((result?.details.reseedPriority as { code?: string } | undefined)?.code).toBe("blocked-readiness");
    expect((result?.details.blockedReasons as string[])).toContain("reload-required-or-dirty");
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
  });

  it("emits defer influence-assimilation packet when validation maturity is below threshold", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-influence-assimilation-defer-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-FOCUS",
          description: "[P1] focused local slice",
          status: "in-progress",
          acceptance_criteria: ["run smoke test"],
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
          notes: "[rationale:risk-control] keep local-safe flow",
        },
        {
          id: "TASK-LOCAL-1",
          description: "[P2] local maintenance doc update",
          status: "planned",
          files: ["docs/guides/control-plane-operating-doctrine.md"],
          notes: "[rationale:risk-control] keep local-safe flow",
        },
        {
          id: "TASK-LOCAL-2",
          description: "[P2] local review notes",
          status: "planned",
          files: ["docs/guides/control-plane-operating-doctrine.md"],
          notes: "[rationale:risk-control] keep local-safe flow",
        },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({ current_tasks: ["TASK-FOCUS"] }), "utf8");
    initCleanGitRepo(cwd);

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const packetTool = tools.find((tool) => tool.name === "autonomy_lane_influence_assimilation_packet");
    const result = packetTool?.execute("call-test", {
      min_ready_slices: 1,
      min_validation_coverage_pct: 80,
    }, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("defer");
    expect(result?.details.window).toBe("hold");
    expect(result?.details.recommendationCode).toBe("influence-assimilation-defer-local-safe-stock");
    expect((result?.details.blockedReasons as string[])).toContain("validation-coverage-low");
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
  });

  it("emits ready-window influence-assimilation packet when local-safe stock is healthy", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-influence-assimilation-ready-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-FOCUS",
          description: "[P1] focused local slice",
          status: "in-progress",
          acceptance_criteria: ["run smoke test"],
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
          notes: "[rationale:risk-control] keep local-safe flow",
        },
        {
          id: "TASK-LOCAL-1",
          description: "[P2] local slice 1",
          status: "planned",
          acceptance_criteria: ["run smoke test"],
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
          notes: "[rationale:risk-control] keep local-safe flow",
        },
        {
          id: "TASK-LOCAL-2",
          description: "[P2] local slice 2",
          status: "planned",
          acceptance_criteria: ["run smoke test"],
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
          notes: "[rationale:risk-control] keep local-safe flow",
        },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({ current_tasks: ["TASK-FOCUS"] }), "utf8");
    initCleanGitRepo(cwd);

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const packetTool = tools.find((tool) => tool.name === "autonomy_lane_influence_assimilation_packet");
    const result = packetTool?.execute("call-test", {
      min_ready_slices: 3,
      min_validation_coverage_pct: 80,
    }, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("ready-window");
    expect(result?.details.window).toBe("open");
    expect(result?.details.recommendationCode).toBe("influence-assimilation-ready-window-open");
    expect(result?.details.recommendation).toBe("open-protected-focus");
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
  });

  it("exposes ready-window influence cue on autonomy_lane_status when local-safe stock is healthy", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-status-influence-ready-window-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-FOCUS",
          description: "[P1] focused local slice",
          status: "in-progress",
          acceptance_criteria: ["run smoke test"],
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
          notes: "[rationale:risk-control] keep local-safe flow",
        },
        {
          id: "TASK-LOCAL-1",
          description: "[P2] local slice 1",
          status: "planned",
          acceptance_criteria: ["run smoke test"],
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
          notes: "[rationale:risk-control] keep local-safe flow",
        },
        {
          id: "TASK-LOCAL-2",
          description: "[P2] local slice 2",
          status: "planned",
          acceptance_criteria: ["run smoke test"],
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
          notes: "[rationale:risk-control] keep local-safe flow",
        },
        {
          id: "TASK-PROTECTED-1",
          description: "Pesquisa externa: analisar https://example.com/reference",
          status: "planned",
          notes: "[rationale:risk-control] protected candidate",
        },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({ current_tasks: ["TASK-FOCUS"] }), "utf8");
    initCleanGitRepo(cwd);

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const statusTool = tools.find((tool) => tool.name === "autonomy_lane_status");
    const result = statusTool?.execute("call-test", {}, undefined, undefined, { cwd });

    const influenceCue = (result?.details.influenceWindowCue as { decision?: string; window?: string; recommendationCode?: string } | undefined);
    const protectedReadyCue = (result?.details.protectedReadyCue as { decision?: string; eligibleProtectedCount?: number; nextProtectedTaskId?: string } | undefined);
    const decisionCue = (result?.details.decisionCue as { humanDecisionNeeded?: boolean; reasonCode?: string; recommendedAction?: string; nextCandidateTaskId?: string } | undefined);
    expect(influenceCue?.decision).toBe("ready-window");
    expect(influenceCue?.window).toBe("open");
    expect(influenceCue?.recommendationCode).toBe("influence-assimilation-ready-window-open");
    expect(protectedReadyCue?.decision).toBe("ready");
    expect(protectedReadyCue?.eligibleProtectedCount).toBe(1);
    expect(protectedReadyCue?.nextProtectedTaskId).toBe("TASK-PROTECTED-1");
    expect(decisionCue?.humanDecisionNeeded).toBe(true);
    expect(decisionCue?.reasonCode).toBe("protected-focus-ready");
    expect(decisionCue?.recommendedAction).toBe("open-protected-focus");
    expect(decisionCue?.nextCandidateTaskId).toBe("TASK-PROTECTED-1");
    expect(String((result?.details as { summary?: string } | undefined)?.summary ?? "")).toContain("influenceWindow=ready-window");
    expect(String((result?.details as { summary?: string } | undefined)?.summary ?? "")).toContain("protectedReady=ready");
    expect(String((result?.details as { summary?: string } | undefined)?.summary ?? "")).toContain("protectedEligible=1");
    expect(String((result?.details as { summary?: string } | undefined)?.summary ?? "")).toContain("decisionCue=protected-focus-ready");
  });
});
