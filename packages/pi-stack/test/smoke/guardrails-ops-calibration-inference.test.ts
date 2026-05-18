import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { registerGuardrailsOpsCalibrationSurface } from "../../extensions/guardrails-core-ops-calibration-surface";

describe("ops calibration inferred surfaces", () => {
  it("registers delegation_rehearsal_start_packet as read-only start/abort packet", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-delegation-rehearsal-start-packet-"));
    try {
      const tools: any[] = [
        { name: "delegation_lane_capability_snapshot", description: "read-only capability" },
        { name: "delegation_mix_score", description: "read-only mix score" },
        { name: "auto_advance_hard_intent_telemetry", description: "read-only telemetry" },
      ];

      const pi = {
        registerTool: vi.fn((tool) => tools.push(tool)),
        getAllTools: vi.fn(() => tools),
      } as unknown as Parameters<typeof registerGuardrailsOpsCalibrationSurface>[0];

      registerGuardrailsOpsCalibrationSurface(pi);
      const tool = tools.find((row) => row?.name === "delegation_rehearsal_start_packet");

      const result = await tool.execute(
        "tc-delegate-start",
        {
          capability_decision: "ready",
          mix_decision: "ready",
          mix_score: 80,
          mix_delegation_events: 2,
          auto_advance_decision: "eligible",
          telemetry_decision: "ready",
          telemetry_score: 70,
          telemetry_blocked_rate_pct: 20,
          declared_files_known: true,
          validation_gate_known: true,
          rollback_plan_known: true,
        },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect(result.details.mode).toBe("delegation-rehearsal-start-packet");
      expect(result.details.dispatchAllowed).toBe(false);
      expect(result.details.authorization).toBe("none");
      expect(result.details.mutationAllowed).toBe(false);
      expect(result.details.decision).toBe("ready-for-operator-decision");
      expect(String(result.details.summary)).toContain("delegation-rehearsal-start-packet:");
      expect(String(result.details.summary)).toContain("contract=files=ok,validation=ok,rollback=ok");
      expect(result.details.operatorPauseBrief.whyPaused).toContain("explicit operator");
      expect(result.details.operatorPauseBrief.recommendation).toBe("start");
      expect(result.details.operatorPauseBrief.options.map((row: any) => row.option)).toEqual(["start", "defer", "abort"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("uses inferred background capability signals and honors explicit overrides", async () => {
    const tools: any[] = [
      { name: "background_process_plan", description: "read-only plan" },
      { name: "background_process_lifecycle_plan", description: "read-only lifecycle" },
      { name: "bg_status", description: "status/log/stop" },
      { name: "context_watch_checkpoint", description: "checkpoint" },
      { name: "claude_code_adapter_status", description: "budget guard" },
      { name: "claude_code_execute", description: "dry_run=true cwd isolation" },
      { name: "tool_hygiene_scorecard", description: "read-only scorecard" },
      { name: "board_decision_packet", description: "decision packet" },
      { name: "ant_colony", description: "long run protected" },
    ];

    const pi = {
      registerTool: vi.fn((tool) => tools.push(tool)),
      getAllTools: vi.fn(() => tools),
    } as unknown as Parameters<typeof registerGuardrailsOpsCalibrationSurface>[0];

    registerGuardrailsOpsCalibrationSurface(pi);
    const tool = tools.find((row) => row?.name === "ops_calibration_decision_packet");

    const inferred = await tool.execute(
      "tc-ops-calibration-inferred",
      { live_reload_completed: true },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );
    expect(inferred.details.background.score).toBeGreaterThan(20);
    expect(inferred.details.background.dimensions.capabilities).toBeGreaterThan(0);

    const overridden = await tool.execute(
      "tc-ops-calibration-override",
      {
        has_process_registry: false,
        has_port_lease_lock: false,
        has_bounded_log_tail: false,
        has_graceful_stop_then_kill: false,
        has_structured_stacktrace_capture: false,
        has_reload_handoff_cleanup: false,
        live_reload_completed: true,
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );
    expect(overridden.details.background.score).toBe(20);
    expect(overridden.details.background.dimensions.capabilities).toBe(0);
  });
});
