import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerGuardrailsAutonomyLaneSurface } from "../../extensions/guardrails-core-autonomy-lane-surface";
import { buildRunwayReadinessCue } from "../../extensions/guardrails-core-autonomy-lane-runway";

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
    expect(String(result?.content?.[0]?.text ?? "")).toContain("autonomy-lane-plan: ready=yes");
    expect(String(result?.content?.[0]?.text ?? "")).toContain("payload completo disponível em details");
    expect(String(result?.content?.[0]?.text ?? "")).not.toContain('\"decision\"');
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
    expect(String(result?.content?.[0]?.text ?? "")).toContain("autonomy-lane-next-task: ready=yes");
    expect(String(result?.content?.[0]?.text ?? "")).toContain("payload completo disponível em details");
    expect(String(result?.content?.[0]?.text ?? "")).not.toContain('\"nextTaskId\"');
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
    expect(String(result?.content?.[0]?.text ?? "")).toContain("autonomy-protected-scope-report:");
    expect(String(result?.content?.[0]?.text ?? "")).toContain("payload completo disponível em details");
    expect(String(result?.content?.[0]?.text ?? "")).not.toContain('\"rows\"');
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
    expect(String(result?.content?.[0]?.text ?? "")).toContain("autonomy-lane-status:");
    expect(String(result?.content?.[0]?.text ?? "")).toContain("payload completo disponível em details");
    expect(String(result?.content?.[0]?.text ?? "")).not.toContain('\"selection\"');
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

  it("exposes blocked runway readiness cue when background protected-scope gate is requested", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-status-runway-blocked-"));
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
    const result = statusTool?.execute("call-test", {
      context_level: "warn",
      provider_ready: 1,
      background_protected_scope_requested: true,
    }, undefined, undefined, { cwd });

    const runwayCue = (result?.details.runwayReadinessCue as {
      decision?: string;
      recommendationCode?: string;
      nextAction?: string;
      delegation?: { decision?: string };
      background?: { decision?: string };
    } | undefined);

    expect(runwayCue?.decision).toBe("blocked");
    expect(runwayCue?.recommendationCode).toBe("runway-readiness-blocked");
    expect(runwayCue?.delegation?.decision).toBe("local-execute-first");
    expect(runwayCue?.background?.decision).toBe("blocked");
    expect(String(runwayCue?.nextAction ?? "")).toContain("background_process_readiness_packet");
    expect(String((result?.details as { summary?: string } | undefined)?.summary ?? "")).toContain("runway=blocked");
  });

  it("exposes ready-window runway readiness cue when delegation/background signals are strong", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-status-runway-ready-window-"));
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
    const result = statusTool?.execute("call-test", {
      context_level: "warn",
      provider_ready: 1,
      delegation_preload_decision: "use-pack",
      delegation_dirty_signal: "clean",
      delegation_mix_decision: "ready",
      delegation_mix_score: 82,
      delegation_mix_delegation_events: 1,
      delegation_mix_swarm_events: 1,
      delegation_auto_advance_decision: "eligible",
      delegation_telemetry_decision: "ready",
      delegation_telemetry_score: 78,
      delegation_telemetry_blocked_rate_pct: 10,
      background_needs_server: false,
      background_has_process_registry: true,
      background_has_port_lease_lock: true,
      background_has_bounded_log_tail: true,
      background_has_structured_stacktrace_capture: true,
      background_has_healthcheck_probe: true,
      background_has_graceful_stop_then_kill: true,
      background_has_reload_handoff_cleanup: true,
      background_has_plan_surface: true,
      background_has_lifecycle_surface: true,
      background_rehearsal_slices: 2,
      background_stop_source_coverage_pct: 92,
      background_lifecycle_classified: true,
      background_rollback_plan_known: true,
      background_unresolved_blockers: 0,
    }, undefined, undefined, { cwd });

    const runwayCue = (result?.details.runwayReadinessCue as {
      decision?: string;
      recommendationCode?: string;
      delegation?: { decision?: string; nextAction?: string };
      background?: { decision?: string; nextAction?: string };
    } | undefined);

    expect(runwayCue?.decision).toBe("ready-window");
    expect(runwayCue?.recommendationCode).toBe("runway-readiness-ready-window");
    expect(runwayCue?.delegation?.decision).toBe("ready-delegation-rehearsal");
    expect(runwayCue?.background?.decision).toBe("ready-window");
    expect(String((result?.details as { summary?: string } | undefined)?.summary ?? "")).toContain("runway=ready-window");
  });

  it("builds runway readiness from explicit signals without freshness filesystem reads", () => {
    const result = buildRunwayReadinessCue({
      delegation_preload_decision: "use-pack", delegation_dirty_signal: "clean",
      delegation_mix_decision: "ready", delegation_mix_score: 82, delegation_mix_delegation_events: 1,
      delegation_mix_swarm_events: 1, delegation_auto_advance_decision: "eligible",
      delegation_telemetry_decision: "ready", delegation_telemetry_score: 78,
      delegation_telemetry_blocked_rate_pct: 10, background_needs_server: false,
      background_has_process_registry: true, background_has_port_lease_lock: true,
      background_has_bounded_log_tail: true, background_has_structured_stacktrace_capture: true,
      background_has_healthcheck_probe: true, background_has_graceful_stop_then_kill: true,
      background_has_reload_handoff_cleanup: true, background_has_plan_surface: true,
      background_has_lifecycle_surface: true, background_rehearsal_slices: 2,
      background_stop_source_coverage_pct: 92, background_lifecycle_classified: true,
      background_rollback_plan_known: true, background_unresolved_blockers: 0,
    }, { cwd: "\0invalid-cwd" }, { getAllTools: () => [{ name: "background_process_plan" }, { name: "background_process_lifecycle_plan" }] });

    expect(result.decision).toBe("ready-window");
    expect(result.delegation.decision).toBe("ready-delegation-rehearsal");
    expect(result.background.decision).toBe("ready-window");
  });

  it("exposes report-only anti-bloat cue in autonomy lane status", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "autonomy-lane-status-anti-bloat-"));
    mkdirSync(path.join(cwd, ".project"), { recursive: true });
    mkdirSync(path.join(cwd, "packages", "pi-stack", "extensions"), { recursive: true });
    writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        { id: "TASK-NEXT", description: "[P1] local", status: "planned" },
      ],
    }), "utf8");
    writeFileSync(path.join(cwd, "packages", "pi-stack", "extensions", "large.ts"), `${"x\n".repeat(1505)}`, "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const statusTool = tools.find((tool) => tool.name === "autonomy_lane_status");
    const result = statusTool?.execute("call-test", { context_level: "warn", provider_ready: 1 }, undefined, undefined, { cwd });
    const cue = (result?.details.antiBloatCue as {
      decision?: string;
      recommendationCode?: string;
      recommendation?: string;
      nextAction?: string;
      dispatchAllowed?: boolean;
      mutationAllowed?: boolean;
      totals?: { aboveExtract?: number };
      topFiles?: Array<{ path?: string; lines?: number }>;
    } | undefined);

    expect(cue?.decision).toBe("extract");
    expect(cue?.recommendationCode).toBe("anti-bloat-extract");
    expect(cue?.recommendation).toContain("authorized anti-bloat/refactor extraction is not a tangent");
    expect(cue?.nextAction).toContain("keep backlog/policy tangents separate");
    expect(cue?.dispatchAllowed).toBe(false);
    expect(cue?.mutationAllowed).toBe(false);
    expect(cue?.totals?.aboveExtract).toBe(1);
    expect(cue?.topFiles?.[0]?.path).toBe("packages/pi-stack/extensions/large.ts");
    expect(String((result?.details as { summary?: string } | undefined)?.summary ?? "")).toContain("antiBloat=extract");
    expect(String((result?.details as { summary?: string } | undefined)?.summary ?? "")).toContain("lineBudgetAboveExtract=1");
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
    const decisionCue = (result?.details.decisionCue as { operatorDecisionNeeded?: boolean; reasonCode?: string; recommendedAction?: string; nextCandidateTaskId?: string } | undefined);

    expect(seedingGuidance?.decision).toBe("seed-now");
    expect(reminder?.source).toBe("seed-guidance");
    expect(reminder?.summary).toContain("seedWhy=bootstrap-focus-missing");
    expect(reminder?.summary).toContain("seedPriority=continuity-bootstrap");
    expect(decisionCue?.operatorDecisionNeeded).toBe(true);
    expect(decisionCue?.reasonCode).toBe("seed-local-safe-required");
    expect(decisionCue?.recommendedAction).toBe("seed-local-safe");
    expect(decisionCue?.nextCandidateTaskId).toBeUndefined();
    expect(String((result?.details as { summary?: string } | undefined)?.summary ?? "")).toContain("decisionCue=seed-local-safe-required");
    expect(String(result?.details.nextAction ?? "")).toContain("seed 3 local-safe tasks");
    expect(String(result?.details.nextAction ?? "")).toContain("seedWhy=bootstrap-focus-missing");
    expect(String(result?.details.nextAction ?? "")).toContain("seedPriority=continuity-bootstrap");
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
    const seedingGuidance = (result?.details.seedingGuidance as { decision?: string; seedWhy?: string; seedPriority?: string; operatorActionRequired?: boolean } | undefined);
    expect(seedingGuidance?.decision).toBe("blocked");
    expect(seedingGuidance?.seedWhy).toBe("readiness-blocked");
    expect(seedingGuidance?.seedPriority).toBe("blocked-readiness");
    expect(seedingGuidance?.operatorActionRequired).toBe(true);
    const influenceCue = (result?.details.influenceWindowCue as { decision?: string; recommendationCode?: string } | undefined);
    const protectedReadyCue = (result?.details.protectedReadyCue as {
      decision?: string;
      recommendationCode?: string;
      eligibleProtectedCount?: number;
      nextProtectedTaskId?: string;
    } | undefined);
    const decisionCue = (result?.details.decisionCue as {
      operatorDecisionNeeded?: boolean;
      reasonCode?: string;
      recommendedAction?: string;
      nextCandidateTaskId?: string;
    } | undefined);
    expect(influenceCue?.decision).toBe("blocked");
    expect(influenceCue?.recommendationCode).toBe("influence-assimilation-blocked-operational");
    expect(protectedReadyCue?.decision).toBe("hold");
    expect(protectedReadyCue?.recommendationCode).toBe("protected-ready-hold-local-safe-first");
    expect(protectedReadyCue?.eligibleProtectedCount).toBe(0);
    expect(protectedReadyCue?.nextProtectedTaskId).toBeUndefined();
    expect(decisionCue?.operatorDecisionNeeded).toBe(false);
    expect(decisionCue?.reasonCode).toBe("none");
    expect(decisionCue?.recommendedAction).toBe("stabilize-local-safe");
    expect(decisionCue?.nextCandidateTaskId).toBeUndefined();
    expect(String((result?.details as { summary?: string } | undefined)?.summary ?? "")).toContain("seedCount=3");
    expect(String((result?.details as { summary?: string } | undefined)?.summary ?? "")).toContain("seedWhy=readiness-blocked");
    expect(String((result?.details as { summary?: string } | undefined)?.summary ?? "")).toContain("influenceWindow=blocked");
    expect(String((result?.details as { summary?: string } | undefined)?.summary ?? "")).toContain("protectedReady=hold");
    expect(String((result?.details as { summary?: string } | undefined)?.summary ?? "")).toContain("protectedEligible=0");
    expect(String((result?.details as { summary?: string } | undefined)?.summary ?? "")).toContain("decisionCue=none");
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


  it("emits report-only first_hatch_intake_packet before local-safe work", () => {
    const tools: RegisteredTool[] = [];
    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const hatchTool = tools.find((tool) => tool.name === "first_hatch_intake_packet");
    const result = hatchTool?.execute("call-hatch", {
      workspace_name: "agents-lab",
      top_level_entries: ["package.json", ".project", "packages"],
      dominant_artifacts: ["typescript", "markdown"],
      package_managers: ["pnpm"],
      available_tools: [
        { name: "operator_intent_intake_packet", description: "Report-only intake packet; dispatch=no mutation=no worker-dispatch=no" },
        { name: "structured_interview_plan", description: "Read-only plan; never authorizes dispatch" },
        { name: "ant_colony", description: "Launch autonomous long run" },
      ],
      capability_signals: ["provider-ready", "tests-present"],
      has_git: true,
      has_project_board: true,
      has_tests: true,
      sandbox_mode: "workspace-write",
    });

    expect(result?.details.recommendationCode).toBe("first-hatch-ready-local-safe");
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.mutationAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
    expect(result?.details.capabilityInventory.availableTools).toBe(3);
    expect(result?.details.capabilityInventory.requiresOperatorApproval).toBe(1);
    expect(result?.details.capabilityInventory.recommendedToolNames).toEqual(["operator_intent_intake_packet", "structured_interview_plan"]);
    const text = String(result?.content?.[0]?.text ?? "");
    expect(text).toMatch(/first-hatch-intake: decision=ready-for-operator-decision.*next=start-intake-loop.*tools=3.*payload completo disponível em details/s);
    expect(text).not.toContain('"workspace"');
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
    expect(result?.details.decision).toBe("ready-for-operator-decision");
    expect(result?.details.recommendationCode).toBe("intake-plan-first-slice");
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.mutationAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
    expect(result?.details.mode).toBe("report-only");
    const text = String(result?.content?.[0]?.text ?? "");
    expect(text).toMatch(/project-intake: decision=ready-for-operator-decision.*next=first-slice.*payload completo disponível em details/s);
    expect(text).not.toContain('\"profile\"');
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
    expect(result?.details.recommendationCode).toBe("intake-needs-operator-focus-protected");
    expect(typeof result?.details.nextAction).toBe("string");
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.mutationAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
    expect(String(result?.content?.[0]?.text ?? "")).toContain("next=operator-focus");
  });

});
