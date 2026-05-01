import { describe, expect, it, vi } from "vitest";
import { buildOpsCalibrationDecisionPacket } from "../../extensions/guardrails-core-ops-calibration";
import { registerGuardrailsOpsCalibrationSurface } from "../../extensions/guardrails-core-ops-calibration-surface";

describe("ops calibration decision packet", () => {
  it("returns ready-for-bounded-rehearsal when both calibrations are strong and reload completed", () => {
    const packet = buildOpsCalibrationDecisionPacket({
      background: {
        mode: "background-process-readiness-score",
        activation: "none",
        authorization: "none",
        dispatchAllowed: false,
        score: 92,
        recommendationCode: "background-process-readiness-strong",
        recommendation: "ok",
        dimensions: { capabilities: 90, surfaceWiring: 100, operationalEvidence: 88 },
        checks: {
          hasProcessRegistry: true,
          hasPortLeaseLock: true,
          hasBoundedLogTail: true,
          hasStructuredStacktraceCapture: true,
          hasHealthcheckProbe: true,
          hasGracefulStopThenKill: true,
          hasReloadHandoffCleanup: true,
          hasPlanSurface: true,
          hasLifecycleSurface: true,
          rehearsalSlices: 3,
          stopSourceCoveragePct: 100,
        },
        summary: "bg",
      },
      agents: {
        mode: "agents-as-tools-calibration-score",
        activation: "none",
        authorization: "none",
        dispatchAllowed: false,
        score: 90,
        recommendationCode: "agents-as-tools-calibration-strong",
        recommendation: "ok",
        dimensions: { governance: 90, boundedness: 88, observability: 91 },
        metrics: {
          totalTools: 10,
          executorCandidates: 3,
          protectedExecutors: 3,
          longRunCapableTools: 3,
          manualOverrideLikeTools: 0,
        },
        policySignals: {
          hasBudgetGuard: true,
          hasCheckpointDiscipline: true,
          hasDryRunExecutorPath: true,
          hasCwdIsolationPath: true,
          hasDecisionPackets: true,
          hasToolHygieneSurface: true,
        },
        summary: "agents",
      },
      minScoreForRehearsal: 80,
      liveReloadCompleted: true,
    });

    expect(packet).toMatchObject({
      mode: "ops-calibration-decision-packet",
      decision: "ready-for-bounded-rehearsal",
      recommendationCode: "ops-calibration-ready-bounded-rehearsal",
      dispatchAllowed: false,
      authorization: "none",
      blockers: [],
    });
  });

  it("keeps report-only when reload is pending", () => {
    const packet = buildOpsCalibrationDecisionPacket({
      background: {
        mode: "background-process-readiness-score",
        activation: "none",
        authorization: "none",
        dispatchAllowed: false,
        score: 100,
        recommendationCode: "background-process-readiness-strong",
        recommendation: "ok",
        dimensions: { capabilities: 100, surfaceWiring: 100, operationalEvidence: 100 },
        checks: {
          hasProcessRegistry: true,
          hasPortLeaseLock: true,
          hasBoundedLogTail: true,
          hasStructuredStacktraceCapture: true,
          hasHealthcheckProbe: true,
          hasGracefulStopThenKill: true,
          hasReloadHandoffCleanup: true,
          hasPlanSurface: true,
          hasLifecycleSurface: true,
          rehearsalSlices: 3,
          stopSourceCoveragePct: 100,
        },
        summary: "bg",
      },
      agents: {
        mode: "agents-as-tools-calibration-score",
        activation: "none",
        authorization: "none",
        dispatchAllowed: false,
        score: 100,
        recommendationCode: "agents-as-tools-calibration-strong",
        recommendation: "ok",
        dimensions: { governance: 100, boundedness: 100, observability: 100 },
        metrics: {
          totalTools: 3,
          executorCandidates: 1,
          protectedExecutors: 1,
          longRunCapableTools: 1,
          manualOverrideLikeTools: 0,
        },
        policySignals: {
          hasBudgetGuard: true,
          hasCheckpointDiscipline: true,
          hasDryRunExecutorPath: true,
          hasCwdIsolationPath: true,
          hasDecisionPackets: true,
          hasToolHygieneSurface: true,
        },
        summary: "agents",
      },
      liveReloadCompleted: false,
    });

    expect(packet.decision).toBe("keep-report-only");
    expect(packet.recommendationCode).toBe("ops-calibration-keep-report-only-reload");
    expect(packet.blockers).toContain("reload-required-for-live-invocation");
  });

  it("registers ops_calibration_decision_packet as read-only tool", async () => {
    const tools: any[] = [
      { name: "background_process_plan", description: "read-only plan" },
      { name: "background_process_lifecycle_plan", description: "read-only lifecycle" },
      { name: "claude_code_adapter_status", description: "budget guard status" },
      { name: "claude_code_execute", description: "dry_run=true with cwd isolation" },
      { name: "context_watch_checkpoint", description: "checkpoint" },
      { name: "board_decision_packet", description: "decision packet" },
      { name: "tool_hygiene_scorecard", description: "read-only scorecard" },
      { name: "ant_colony", description: "long run protected" },
    ];

    const pi = {
      registerTool: vi.fn((tool) => tools.push(tool)),
      getAllTools: vi.fn(() => tools),
    } as unknown as Parameters<typeof registerGuardrailsOpsCalibrationSurface>[0];

    registerGuardrailsOpsCalibrationSurface(pi);
    const tool = tools.find((row) => row?.name === "ops_calibration_decision_packet");

    const result = await tool.execute(
      "tc-ops-calibration",
      {
        has_process_registry: true,
        has_port_lease_lock: true,
        has_bounded_log_tail: true,
        has_structured_stacktrace_capture: true,
        has_healthcheck_probe: true,
        has_graceful_stop_then_kill: true,
        has_reload_handoff_cleanup: true,
        rehearsal_slices: 3,
        stop_source_coverage_pct: 100,
        live_reload_completed: true,
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );

    expect(result.details.mode).toBe("ops-calibration-decision-packet");
    expect(result.details.dispatchAllowed).toBe(false);
    expect(result.details.authorization).toBe("none");
    expect(String(result.details.summary)).toContain("ops-calibration-packet:");
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
