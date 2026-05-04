import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerGuardrailsAutonomyLaneSurface } from "../../extensions/guardrails-core-autonomy-lane-surface";

type RegisteredTool = {
  name: string;
  execute: (toolCallId: string, params: Record<string, unknown>, signal?: unknown, onUpdate?: unknown, ctx?: { cwd: string }) => { details: Record<string, unknown> };
};

function initCleanGitRepo(cwd: string): void {
  writeFileSync(path.join(cwd, ".gitkeep"), "seed\n", "utf8");
  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Pi Smoke"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "pi-smoke@example.com"], { cwd, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "seed"], { cwd, stdio: "ignore" });
}

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

  it("registers delegation capability snapshot tool with read-only contract", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-delegation-snapshot-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({ current_tasks: ["TASK-LOCAL"] }), "utf8");
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [{ id: "TASK-LOCAL", status: "planned" }] }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const snapshotTool = tools.find((tool) => tool.name === "delegation_lane_capability_snapshot");
    const result = snapshotTool?.execute("call-test", {
      monitor_classify_failures: 0,
      subagents_ready: true,
    }, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("needs-evidence");
    expect(result?.details.recommendationCode).toBe("delegation-capability-needs-evidence-preload");
    expect((result?.details.signals as { preloadDecision?: string; dirtySignal?: string } | undefined)?.preloadDecision).toBe("fallback-canonical");
    expect((result?.details.signals as { preloadDecision?: string; dirtySignal?: string } | undefined)?.dirtySignal).toBe("unknown");
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
    expect(result?.details.mode).toBe("report-only");
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

  it("includes chaining summary in next-task payload for continuous execution loops", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-next-task-chaining-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-LOCAL", description: "[P1] local", status: "planned" },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({
      timestamp: new Date().toISOString(),
      current_tasks: ["TASK-LOCAL"],
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const nextTaskTool = tools.find((tool) => tool.name === "autonomy_lane_next_task");
    const result = nextTaskTool?.execute("call-test", {}, undefined, undefined, { cwd });
    const chaining = (result?.details.chaining as { decision?: string; recommendationCode?: string } | undefined);

    expect(result?.details.ready).toBe(true);
    expect(result?.details.nextTaskId).toBe("TASK-LOCAL");
    expect(chaining?.decision).toBe("active");
    expect(chaining?.recommendationCode).toBe("autonomy-chaining-active");
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

  it("emits report-only protected scope reasons with evidence", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-protected-report-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-EXT", description: "[P1] avaliar influência externa https://example.com", status: "planned" },
        { id: "TASK-LOCAL", description: "[P2] pesquisa local-safe: mapear critérios", status: "planned" },
      ],
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const reportTool = tools.find((tool) => tool.name === "autonomy_lane_protected_scope_report");
    const result = reportTool?.execute("call-test", { limit: 10 }, undefined, undefined, { cwd });

    expect(result?.details.summary).toContain("autonomy-protected-scope-report:");
    expect(result?.details.totals?.protected).toBe(1);
    const rows = (result?.details.rows as Array<Record<string, unknown>> | undefined) ?? [];
    const external = rows.find((row) => row.id === "TASK-EXT");
    const local = rows.find((row) => row.id === "TASK-LOCAL");
    expect(external?.protectedScope).toBe(true);
    expect((external?.primaryReasonCode as string | undefined)).toBe("protected-external-url");
    expect(local?.protectedScope).toBe(false);
    expect((local?.primaryReasonCode as string | undefined)).toBe("local-safe");
  });

  it("emits protected-focus decision packet with no-dispatch invariants", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-protected-packet-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-EXT", description: "[P1] avaliar influência externa https://example.com", status: "planned" },
      ],
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const packetTool = tools.find((tool) => tool.name === "autonomy_lane_protected_focus_packet");
    const result = packetTool?.execute("call-test", { task_id: "TASK-EXT" }, undefined, undefined, { cwd });

    expect(result?.details.summary).toContain("autonomy-protected-focus-packet:");
    expect(result?.details.decision).toBe("blocked");
    expect(result?.details.recommendedOption).toBe("defer");
    expect((result?.details.decisionPreview as { recommendedOption?: string } | undefined)?.recommendedOption).toBe("defer");
    expect((result?.details.decisionPreview as { options?: Array<{ option: string; suitability: string }> } | undefined)?.options?.map((option) => `${option.option}:${option.suitability}`)).toEqual([
      "promote:blocked",
      "skip:viable",
      "defer:recommended",
    ]);
    expect(result?.details.summary).toContain("preview=promote:blocked,skip:viable,defer:recommended");
    expect(result?.details.mutationAllowed).toBe(false);
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
    expect(result?.details.mode).toBe("report-only");
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

  it("auto-advances from completed handoff focus when hard-intent guards are green", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-auto-advance-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-FOCUS", description: "[P1] completed", status: "completed" },
        {
          id: "TASK-NEXT",
          description: "[P2] local-safe follow-up",
          status: "planned",
          acceptance_criteria: ["run smoke test for next slice"],
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
          notes: "[rationale:risk-control] validação explícita para auto-advance hard-intent",
        },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({ current_tasks: ["TASK-FOCUS"] }), "utf8");
    initCleanGitRepo(cwd);

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const nextTaskTool = tools.find((tool) => tool.name === "autonomy_lane_next_task");
    const result = nextTaskTool?.execute("call-test", {}, undefined, undefined, { cwd });

    expect(result?.details.ready).toBe(true);
    expect(result?.details.reason).toBe("ready");
    expect(result?.details.nextTaskId).toBe("TASK-NEXT");
    expect((result?.details.selectionPolicy as string | undefined)).toContain("auto-advance-hard-intent");
    expect((result?.details.recommendation as string | undefined)).toContain("auto-advance hard-intent");
  });

  it("fails closed when completed focus has successor without validation gate", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-auto-advance-blocked-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-FOCUS", description: "[P1] completed", status: "completed" },
        {
          id: "TASK-NEXT",
          description: "[P2] local-safe sem gate",
          status: "planned",
          files: ["docs/guides/control-plane-operating-doctrine.md"],
          notes: "[rationale:risk-control] task local-safe sem gate ainda deve bloquear auto-advance",
        },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({ current_tasks: ["TASK-FOCUS"] }), "utf8");
    initCleanGitRepo(cwd);

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const nextTaskTool = tools.find((tool) => tool.name === "autonomy_lane_next_task");
    const result = nextTaskTool?.execute("call-test", {}, undefined, undefined, { cwd });

    expect(result?.details.ready).toBe(false);
    expect(result?.details.reason).toBe("focus-complete");
    expect((result?.details.selectionPolicy as string | undefined)).toContain("auto-advance-hard-intent-blocked");
    expect((result?.details.recommendation as string | undefined)).toContain("validation-gate-unknown");
  });

  it("emits eligible auto-advance snapshot when hard-intent guards are green", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-auto-advance-snapshot-ok-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-FOCUS", description: "[P1] completed", status: "completed" },
        {
          id: "TASK-NEXT",
          description: "[P2] local-safe follow-up",
          status: "planned",
          acceptance_criteria: ["run smoke test for next slice"],
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
          notes: "[rationale:risk-control] validação explícita para auto-advance hard-intent",
        },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({ current_tasks: ["TASK-FOCUS"] }), "utf8");
    initCleanGitRepo(cwd);

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const snapshotTool = tools.find((tool) => tool.name === "autonomy_lane_auto_advance_snapshot");
    const result = snapshotTool?.execute("call-test", {}, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("eligible");
    expect(result?.details.recommendationCode).toBe("auto-advance-snapshot-eligible");
    expect(result?.details.nextTaskId).toBe("TASK-NEXT");
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
  });

  it("emits blocked auto-advance snapshot with fail-closed reasons", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-auto-advance-snapshot-blocked-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-FOCUS", description: "[P1] completed", status: "completed" },
        {
          id: "TASK-NEXT",
          description: "[P2] local-safe sem gate",
          status: "planned",
          files: ["docs/guides/control-plane-operating-doctrine.md"],
          notes: "[rationale:risk-control] task local-safe sem gate deve bloquear auto-advance",
        },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({ current_tasks: ["TASK-FOCUS"] }), "utf8");
    initCleanGitRepo(cwd);

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const snapshotTool = tools.find((tool) => tool.name === "autonomy_lane_auto_advance_snapshot");
    const result = snapshotTool?.execute("call-test", {}, undefined, undefined, { cwd });

    expect(result?.details.decision).toBe("blocked");
    expect(result?.details.recommendationCode).toBe("auto-advance-snapshot-blocked-fail-closed");
    expect((result?.details.blockedReasons as string[] | undefined) ?? []).toContain("validation-gate-unknown");
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
  });

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
    expect(result?.details.nextTaskMnemonic).toBe("TASK-NEXT:local");
    expect((result?.details.readyQueue as { taskIds?: string[] } | undefined)?.taskIds).toEqual(["TASK-NEXT"]);
    expect((result?.details.plan as { decision?: string } | undefined)?.decision).toBe("bounded");
    expect(result?.details.recommendationCode).toBe("execute-bounded-slice");
    expect((result?.details.operatorPauseBrief as { recommendation?: string } | undefined)?.recommendation).toBe("continue");
    expect((result?.details.iterationReminder as { summary?: string } | undefined)?.summary).toBe("none");
    expect(result?.details.nextAction).toContain("next=TASK-NEXT");
  });

  it("includes iterationReminder from handoff next_actions when available", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-status-reminder-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-NEXT", description: "[P1] local", status: "planned", notes: "[rationale:risk-control] keep flow" },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({
      current_tasks: ["TASK-NEXT"],
      next_actions: [
        "finalizar slice atual e validar smoke focal",
        "atualizar handoff curto antes de novo ciclo",
      ],
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const statusTool = tools.find((tool) => tool.name === "autonomy_lane_status");
    const result = statusTool?.execute("call-test", { context_level: "warn", provider_ready: 1 }, undefined, undefined, { cwd });
    const reminder = (result?.details.iterationReminder as { source?: string; items?: string[]; summary?: string } | undefined);

    expect(reminder?.source).toBe("handoff-next-actions");
    expect(reminder?.items?.length).toBe(2);
    expect(reminder?.summary).toContain("finalizar slice atual");
  });

  it("prioritizes seed-guidance reminder when no eligible task and seed-now is available", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-status-reminder-seed-guidance-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-COLONY-PROMOTION", description: "[P0] revisar colony promotion candidate", status: "planned" },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({
      timestamp: new Date().toISOString(),
      current_tasks: [],
      next_actions: ["Rodar /reload para atualizar runtime"],
    }), "utf8");
    initCleanGitRepo(cwd);

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const statusTool = tools.find((tool) => tool.name === "autonomy_lane_status");
    const result = statusTool?.execute("call-test", { context_level: "ok", provider_ready: 1 }, undefined, undefined, { cwd });
    const reminder = (result?.details.iterationReminder as { source?: string; items?: string[]; summary?: string } | undefined);
    const seedingGuidance = (result?.details.seedingGuidance as { decision?: string; seedWhy?: string; seedPriority?: string } | undefined);

    expect(seedingGuidance?.decision).toBe("seed-now");
    expect(reminder?.source).toBe("seed-guidance");
    expect(reminder?.summary).toContain("seedWhy=bootstrap-focus-missing");
    expect(reminder?.summary).toContain("seedPriority=continuity-bootstrap");
  });

  it("filters completed reload reminder from handoff next_actions when fresh", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-status-reminder-filter-reload-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-NEXT", description: "[P1] local", status: "planned", notes: "[rationale:risk-control] keep flow" },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({
      timestamp: new Date().toISOString(),
      current_tasks: ["TASK-NEXT"],
      next_actions: [
        "Rodar /reload para atualizar runtime",
        "executar smoke focal",
      ],
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const statusTool = tools.find((tool) => tool.name === "autonomy_lane_status");
    const result = statusTool?.execute("call-test", { context_level: "warn", provider_ready: 1 }, undefined, undefined, { cwd });
    const reminder = (result?.details.iterationReminder as { source?: string; items?: string[]; summary?: string } | undefined);

    expect(reminder?.source).toBe("handoff-next-actions");
    expect(reminder?.items).toEqual(["executar smoke focal"]);
    expect(reminder?.summary).toContain("executar smoke focal");
    expect(reminder?.summary).not.toContain("/reload");
  });

  it("falls back to current_tasks when next_actions only contains completed reload reminder", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-status-reminder-filter-reload-fallback-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-NEXT", description: "[P1] local", status: "planned", notes: "[rationale:risk-control] keep flow" },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({
      timestamp: new Date().toISOString(),
      current_tasks: ["TASK-NEXT"],
      next_actions: [
        "Rodar /reload para atualizar runtime",
      ],
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const statusTool = tools.find((tool) => tool.name === "autonomy_lane_status");
    const result = statusTool?.execute("call-test", { context_level: "warn", provider_ready: 1 }, undefined, undefined, { cwd });
    const reminder = (result?.details.iterationReminder as { source?: string; items?: string[]; summary?: string } | undefined);

    expect(reminder?.source).toBe("handoff-current-tasks");
    expect(reminder?.items).toEqual(["focus TASK-NEXT"]);
  });

  it("prioritizes refresh reminder when handoff freshness is stale", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-status-reminder-stale-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-NEXT", description: "[P1] local", status: "planned", notes: "[rationale:risk-control] keep flow" },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({
      timestamp: "2020-01-01T00:00:00.000Z",
      current_tasks: ["TASK-NEXT"],
      next_actions: ["ação que ficaria obsoleta sem refresh"],
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const statusTool = tools.find((tool) => tool.name === "autonomy_lane_status");
    const result = statusTool?.execute("call-test", { context_level: "warn", provider_ready: 1 }, undefined, undefined, { cwd });
    const reminder = (result?.details.iterationReminder as { source?: string; items?: string[]; summary?: string } | undefined);

    expect(reminder?.source).toBe("handoff-stale");
    expect(reminder?.summary).toContain("refresh-handoff");
    expect(reminder?.items?.[0]).toContain("refresh-handoff");
  });

  it("marks chaining active when selection is ready and handoff freshness is green", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-status-chaining-active-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-NEXT", description: "[P1] local", status: "planned" },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({
      timestamp: new Date().toISOString(),
      current_tasks: ["TASK-NEXT"],
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const statusTool = tools.find((tool) => tool.name === "autonomy_lane_status");
    const result = statusTool?.execute("call-test", { context_level: "warn", provider_ready: 1 }, undefined, undefined, { cwd });

    const chaining = (result?.details.chaining as { decision?: string; active?: boolean; blockedReasons?: string[] } | undefined);
    expect(chaining?.decision).toBe("active");
    expect(chaining?.active).toBe(true);
    expect(chaining?.blockedReasons ?? []).toEqual([]);
    expect(String(result?.details.nextAction)).toContain("continue chained local-safe slices");
  });

  it("marks chaining blocked when handoff freshness is stale", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-status-chaining-stale-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-NEXT", description: "[P1] local", status: "planned" },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({
      timestamp: "2020-01-01T00:00:00.000Z",
      current_tasks: ["TASK-NEXT"],
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const statusTool = tools.find((tool) => tool.name === "autonomy_lane_status");
    const result = statusTool?.execute("call-test", { context_level: "ok", provider_ready: 1 }, undefined, undefined, { cwd });

    const chaining = (result?.details.chaining as { decision?: string; blockedReasons?: string[]; recommendationCode?: string } | undefined);
    expect(chaining?.decision).toBe("blocked");
    expect(chaining?.recommendationCode).toBe("autonomy-chaining-blocked-handoff-freshness");
    expect(chaining?.blockedReasons ?? []).toContain("handoff-stale");
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
    const pauseBrief = (result?.details.operatorPauseBrief as {
      recommendation?: string;
      options?: Array<{ option?: string }>;
      seedingCue?: { seedCount?: number; seedWhy?: string; seedPriority?: string };
    } | undefined);
    expect(pauseBrief?.recommendation).toBe("seed-local-safe");
    expect((pauseBrief?.options ?? []).map((row) => row.option)).toContain("choose-protected-focus");
    expect(pauseBrief?.seedingCue?.seedCount).toBe(3);
    expect(pauseBrief?.seedingCue?.seedWhy).toBe("readiness-blocked");
    expect(pauseBrief?.seedingCue?.seedPriority).toBe("blocked-readiness");
    const seedingGuidance = (result?.details.seedingGuidance as { decision?: string; seedWhy?: string; seedPriority?: string; humanActionRequired?: boolean } | undefined);
    expect(seedingGuidance?.decision).toBe("blocked");
    expect(seedingGuidance?.seedWhy).toBe("readiness-blocked");
    expect(seedingGuidance?.seedPriority).toBe("blocked-readiness");
    expect(seedingGuidance?.humanActionRequired).toBe(true);
    expect(String((result?.details as { summary?: string } | undefined)?.summary ?? "")).toContain("seedCount=3");
    expect(String((result?.details as { summary?: string } | undefined)?.summary ?? "")).toContain("seedWhy=readiness-blocked");
    expect(result?.details.nextAction).toContain("local stop condition");
  });

  it("prioritizes refresh-handoff in pause brief when no eligible task and handoff is stale", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-status-protected-only-stale-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-COLONY-PROMOTION", description: "[P0] revisar colony promotion candidate", status: "planned" },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({
      timestamp: "2020-01-01T00:00:00.000Z",
      current_tasks: ["TASK-COLONY-PROMOTION"],
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const statusTool = tools.find((tool) => tool.name === "autonomy_lane_status");
    const result = statusTool?.execute("call-test", {}, undefined, undefined, { cwd });
    const pauseBrief = (result?.details.operatorPauseBrief as { recommendation?: string; options?: Array<{ option?: string }> } | undefined);

    expect((result?.details.chaining as { blockedReasons?: string[] } | undefined)?.blockedReasons).toContain("handoff-stale");
    expect(pauseBrief?.recommendation).toBe("refresh-handoff");
    expect((pauseBrief?.options ?? []).map((row) => row.option)).toContain("seed-local-safe");
  });

  it("keeps seedingGuidance undefined when local-safe queue is already ready", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-status-local-seed-ready-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-LOCAL-A",
          description: "[P1] local smoke guard",
          status: "planned",
          notes: "[rationale:risk-control] keep local-safe stock",
          files: ["packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts"],
        },
        {
          id: "TASK-LOCAL-B",
          description: "[P2] local summary clarity",
          status: "planned",
          notes: "[rationale:risk-control] keep local-safe stock",
          files: ["packages/pi-stack/extensions/guardrails-core-autonomy-lane-surface.ts"],
        },
      ],
    }), "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const statusTool = tools.find((tool) => tool.name === "autonomy_lane_status");
    const result = statusTool?.execute("call-test", {}, undefined, undefined, { cwd });

    expect(result?.details.ready).toBe(true);
    expect((result?.details.selection as { nextTaskId?: string } | undefined)?.nextTaskId).toBe("TASK-LOCAL-A");
    expect((result?.details.readyQueue as { taskIds?: string[] } | undefined)?.taskIds).toEqual(["TASK-LOCAL-A", "TASK-LOCAL-B"]);
    expect((result?.details.seedingGuidance as unknown) ?? undefined).toBeUndefined();
    expect(((result?.details.operatorPauseBrief as { seedingCue?: unknown } | undefined)?.seedingCue) ?? undefined).toBeUndefined();
    expect(String((result?.details as { summary?: string } | undefined)?.summary ?? "")).toContain("code=execute-bounded-slice");
    expect(String((result?.details as { summary?: string } | undefined)?.summary ?? "")).toContain("next=TASK-LOCAL-A");
    expect(String((result?.details as { summary?: string } | undefined)?.summary ?? "")).not.toContain("seedCount=");
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
