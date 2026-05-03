import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildDelegateOrExecuteDecisionPacket,
  buildOpsCalibrationDecisionPacket,
  buildSimpleDelegateRehearsalDecisionPacket,
  buildSimpleDelegateRehearsalStartPacket,
} from "../../extensions/guardrails-core-ops-calibration";
import { registerGuardrailsOpsCalibrationSurface } from "../../extensions/guardrails-core-ops-calibration-surface";

describe("ops calibration decision packet", () => {
  it("recommends simple-delegate when capability/mix signals are strong", () => {
    const packet = buildDelegateOrExecuteDecisionPacket({
      capabilityDecision: "ready",
      capabilityRecommendationCode: "delegation-capability-ready",
      capabilityBlockers: [],
      capabilityEvidenceGaps: [],
      mixDecision: "ready",
      mixScore: 82,
      mixRecommendationCode: "delegation-mix-ready-diverse",
      mixSimpleDelegateEvents: 3,
      mixSwarmEvents: 2,
    });

    expect(packet.recommendedOption).toBe("simple-delegate");
    expect(packet.recommendationCode).toBe("delegate-execute-simple-delegate");
    expect(packet.dispatchAllowed).toBe(false);
    expect(packet.authorization).toBe("none");
    expect(packet.mutationAllowed).toBe(false);
  });

  it("fails closed to defer when capability/mix signals are missing", () => {
    const packet = buildDelegateOrExecuteDecisionPacket({});
    expect(packet.recommendedOption).toBe("defer");
    expect(packet.recommendationCode).toBe("delegate-execute-defer-missing-signals");
    expect(packet.blockers).toContain("missing-capability-or-mix-signal");
  });

  it("builds simple-delegate rehearsal packet as ready when composed signals are strong", () => {
    const packet = buildSimpleDelegateRehearsalDecisionPacket({
      capabilityDecision: "ready",
      capabilityRecommendationCode: "delegation-capability-ready",
      capabilityBlockers: [],
      mixDecision: "ready",
      mixScore: 84,
      mixSimpleDelegateEvents: 3,
      autoAdvanceDecision: "eligible",
      telemetryDecision: "ready",
      telemetryScore: 78,
      telemetryBlockedRatePct: 20,
    });

    expect(packet.mode).toBe("simple-delegate-rehearsal-readiness-packet");
    expect(packet.decision).toBe("ready");
    expect(packet.recommendationCode).toBe("simple-delegate-rehearsal-ready");
    expect(packet.dispatchAllowed).toBe(false);
    expect(packet.authorization).toBe("none");
    expect(packet.mutationAllowed).toBe(false);
  });

  it("fails closed when auto-advance decision is blocked", () => {
    const packet = buildSimpleDelegateRehearsalDecisionPacket({
      capabilityDecision: "ready",
      mixDecision: "ready",
      mixScore: 82,
      mixSimpleDelegateEvents: 2,
      autoAdvanceDecision: "blocked",
      autoAdvanceBlockedReasons: ["reload-required-or-dirty", "validation-gate-unknown"],
      telemetryDecision: "ready",
      telemetryScore: 70,
      telemetryBlockedRatePct: 10,
    });

    expect(packet.decision).toBe("blocked");
    expect(packet.recommendationCode).toBe("simple-delegate-rehearsal-blocked-auto-advance");
    expect(packet.blockers).toContain("auto-advance-blocked");
    expect(packet.blockers).toContain("reload-required-or-dirty");
  });

  it("builds start packet as ready-for-human-decision when rehearsal and gates are green", () => {
    const packet = buildSimpleDelegateRehearsalStartPacket({
      rehearsalDecision: "ready",
      rehearsalRecommendationCode: "simple-delegate-rehearsal-ready",
      rehearsalBlockers: [],
      protectedScopeRequested: false,
      declaredFilesKnown: true,
      validationGateKnown: true,
      rollbackPlanKnown: true,
    });

    expect(packet.mode).toBe("simple-delegate-rehearsal-start-packet");
    expect(packet.decision).toBe("ready-for-human-decision");
    expect(packet.recommendationCode).toBe("simple-delegate-start-ready-for-human-decision");
    expect(packet.dispatchAllowed).toBe(false);
    expect(packet.authorization).toBe("none");
    expect(packet.options).toEqual(["start", "abort", "defer"]);
    expect(packet.summary).toContain("contract=files=ok,validation=ok,rollback=ok");
  });

  it("blocks start packet when rehearsal decision is not ready", () => {
    const packet = buildSimpleDelegateRehearsalStartPacket({
      rehearsalDecision: "needs-evidence",
      rehearsalRecommendationCode: "simple-delegate-rehearsal-needs-evidence-mix",
      rehearsalBlockers: ["mix-needs-evidence"],
      protectedScopeRequested: false,
      declaredFilesKnown: true,
      validationGateKnown: true,
      rollbackPlanKnown: true,
    });

    expect(packet.decision).toBe("blocked");
    expect(packet.recommendationCode).toBe("simple-delegate-start-blocked-rehearsal-not-ready");
    expect(packet.blockers).toContain("rehearsal-not-ready");
    expect(packet.blockers).toContain("mix-needs-evidence");
  });

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
      backgroundRehearsal: {
        mode: "background-process-rehearsal",
        activation: "none",
        authorization: "none",
        dispatchAllowed: false,
        decision: "ready",
        ready: true,
        blockers: [],
        missingEvidence: [],
        recommendation: "ok",
        criteria: {
          readinessScore: 92,
          readinessThreshold: 80,
          readinessRecommendationCode: "background-process-readiness-strong",
          lifecycleClassified: true,
          stopSourceCoveragePct: 100,
          stopSourceCoverageThreshold: 80,
          rollbackPlanKnown: true,
          rehearsalSlices: 3,
          requiredRehearsalSlices: 1,
          unresolvedBlockers: 0,
          destructiveRestartRequested: false,
          protectedScopeRequested: false,
        },
        summary: "bg-rehearsal",
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
      backgroundRehearsal: {
        mode: "background-process-rehearsal",
        activation: "none",
        authorization: "none",
        dispatchAllowed: false,
        decision: "ready",
        ready: true,
        blockers: [],
        missingEvidence: [],
        recommendation: "ok",
        criteria: {
          readinessScore: 100,
          readinessThreshold: 80,
          readinessRecommendationCode: "background-process-readiness-strong",
          lifecycleClassified: true,
          stopSourceCoveragePct: 100,
          stopSourceCoverageThreshold: 80,
          rollbackPlanKnown: true,
          rehearsalSlices: 3,
          requiredRehearsalSlices: 1,
          unresolvedBlockers: 0,
          destructiveRestartRequested: false,
          protectedScopeRequested: false,
        },
        summary: "bg-rehearsal",
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

  it("keeps report-only when background rehearsal signal is not ready", () => {
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
      backgroundRehearsal: {
        mode: "background-process-rehearsal",
        activation: "none",
        authorization: "none",
        dispatchAllowed: false,
        decision: "needs-evidence",
        ready: false,
        blockers: [],
        missingEvidence: ["stop-source-coverage-below-threshold"],
        recommendation: "collect more evidence",
        criteria: {
          readinessScore: 92,
          readinessThreshold: 80,
          readinessRecommendationCode: "background-process-readiness-strong",
          lifecycleClassified: true,
          stopSourceCoveragePct: 20,
          stopSourceCoverageThreshold: 80,
          rollbackPlanKnown: true,
          rehearsalSlices: 1,
          requiredRehearsalSlices: 1,
          unresolvedBlockers: 0,
          destructiveRestartRequested: false,
          protectedScopeRequested: false,
        },
        summary: "bg-rehearsal",
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
      liveReloadCompleted: true,
    });

    expect(packet.decision).toBe("keep-report-only");
    expect(packet.recommendationCode).toBe("ops-calibration-keep-report-only-background-rehearsal");
    expect(packet.blockers).toContain("background-rehearsal-not-ready");
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

  it("registers delegate_or_execute_decision_packet as read-only packet tool", async () => {
    const tools: any[] = [
      { name: "delegation_lane_capability_snapshot", description: "read-only capability" },
      { name: "delegation_mix_score", description: "read-only mix score" },
    ];

    const pi = {
      registerTool: vi.fn((tool) => tools.push(tool)),
      getAllTools: vi.fn(() => tools),
    } as unknown as Parameters<typeof registerGuardrailsOpsCalibrationSurface>[0];

    registerGuardrailsOpsCalibrationSurface(pi);
    const tool = tools.find((row) => row?.name === "delegate_or_execute_decision_packet");

    const result = await tool.execute(
      "tc-delegate-or-execute",
      {
        capability_decision: "ready",
        capability_recommendation_code: "delegation-capability-ready",
        mix_decision: "ready",
        mix_score: 81,
        mix_simple_delegate_events: 2,
        mix_swarm_events: 1,
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );

    expect(result.details.mode).toBe("delegate-or-execute-decision-packet");
    expect(result.details.dispatchAllowed).toBe(false);
    expect(result.details.authorization).toBe("none");
    expect(result.details.mutationAllowed).toBe(false);
    expect(result.details.recommendedOption).toBe("simple-delegate");
    expect(String(result.details.summary)).toContain("delegate-or-execute-packet:");
  });

  it("registers simple_delegate_rehearsal_packet as read-only packet tool", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-simple-delegate-rehearsal-packet-"));
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
      const tool = tools.find((row) => row?.name === "simple_delegate_rehearsal_packet");

      const result = await tool.execute(
        "tc-simple-delegate-rehearsal",
        {
          capability_decision: "ready",
          mix_decision: "ready",
          mix_score: 80,
          mix_simple_delegate_events: 2,
          auto_advance_decision: "eligible",
          telemetry_decision: "ready",
          telemetry_score: 70,
          telemetry_blocked_rate_pct: 20,
        },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect(result.details.mode).toBe("simple-delegate-rehearsal-readiness-packet");
      expect(result.details.dispatchAllowed).toBe(false);
      expect(result.details.authorization).toBe("none");
      expect(result.details.mutationAllowed).toBe(false);
      expect(String(result.details.summary)).toContain("simple-delegate-rehearsal-packet:");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("falls back to live board auto-advance snapshot when telemetry lacks eligible events", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-simple-delegate-live-auto-advance-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({
        tasks: [
          { id: "TASK-FOCUS", description: "[P1] foco encerrado", status: "completed" },
          {
            id: "TASK-NEXT",
            description: "[P1] follow-up local-safe",
            status: "planned",
            acceptance_criteria: ["run smoke test for next slice"],
            files: ["packages/pi-stack/test/smoke/guardrails-ops-calibration.test.ts"],
            notes: "[rationale:risk-control] next local-safe slice with explicit validation gate",
          },
        ],
      }, null, 2));
      writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
        timestamp: new Date().toISOString(),
        current_tasks: ["TASK-FOCUS"],
      }, null, 2));

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
      const tool = tools.find((row) => row?.name === "simple_delegate_rehearsal_packet");
      const result = await tool.execute(
        "tc-simple-delegate-live-auto-advance",
        {
          capability_decision: "ready",
          mix_decision: "ready",
          mix_score: 80,
          mix_simple_delegate_events: 2,
          telemetry_decision: "ready",
          telemetry_score: 70,
          telemetry_blocked_rate_pct: 20,
        },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect(result.details.decision).toBe("ready");
      expect(result.details.recommendationCode).toBe("simple-delegate-rehearsal-ready");
      expect(result.details.autoAdvanceResolutionSource).toBe("live-board-fallback");
      expect(result.details.autoAdvanceLiveSnapshot.decision).toBe("eligible");
      expect(result.details.autoAdvanceLiveSnapshot.nextTaskId).toBe("TASK-NEXT");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("infers capability defaults from workspace preload pack when params are omitted", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-simple-delegate-infer-capability-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({ timestamp: new Date().toISOString(), context: "seed" }, null, 2));
      writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [] }, null, 2));
      writeFileSync(join(cwd, ".project", "verification.json"), JSON.stringify({ verification: [] }, null, 2));

      const canonicalFiles = [
        ".project/handoff.json",
        ".project/tasks.json",
        ".project/verification.json",
      ].map((rel) => {
        const st = statSync(join(cwd, rel));
        return { path: rel, exists: true, mtimeMs: Math.floor(st.mtimeMs) };
      });
      const fingerprint = createHash("sha1")
        .update(canonicalFiles.map((entry) => `${entry.path}:1:${entry.mtimeMs}`).join("|"))
        .digest("hex");

      mkdirSync(join(cwd, ".sandbox", "pi-agent", "preload"), { recursive: true });
      writeFileSync(
        join(cwd, ".sandbox", "pi-agent", "preload", "context-preload-pack.json"),
        JSON.stringify({
          generatedAtIso: new Date().toISOString(),
          canonicalState: { fingerprint },
          preloadPack: {
            controlPlaneCore: [".project/tasks.json"],
            agentWorkerLean: [".project/tasks.json"],
            swarmScoutMin: [".project/tasks.json"],
          },
        }, null, 2),
      );

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
      const tool = tools.find((row) => row?.name === "simple_delegate_rehearsal_packet");
      const result = await tool.execute(
        "tc-simple-delegate-infer-capability",
        {
          dirty_signal: "clean",
          mix_decision: "ready",
          mix_score: 80,
          mix_simple_delegate_events: 2,
          auto_advance_decision: "eligible",
          telemetry_decision: "ready",
          telemetry_score: 70,
          telemetry_blocked_rate_pct: 20,
        },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect(result.details.inferredCapabilityDefaults.preloadDecision).toBe("use-pack");
      expect(result.details.capability.signals.preloadDecision).toBe("use-pack");
      expect(result.details.capability.decision).toBe("ready");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("registers simple_delegate_rehearsal_start_packet as read-only start/abort packet", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-simple-delegate-start-packet-"));
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
      const tool = tools.find((row) => row?.name === "simple_delegate_rehearsal_start_packet");

      const result = await tool.execute(
        "tc-simple-delegate-start",
        {
          capability_decision: "ready",
          mix_decision: "ready",
          mix_score: 80,
          mix_simple_delegate_events: 2,
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

      expect(result.details.mode).toBe("simple-delegate-rehearsal-start-packet");
      expect(result.details.dispatchAllowed).toBe(false);
      expect(result.details.authorization).toBe("none");
      expect(result.details.mutationAllowed).toBe(false);
      expect(result.details.decision).toBe("ready-for-human-decision");
      expect(String(result.details.summary)).toContain("simple-delegate-start-packet:");
      expect(String(result.details.summary)).toContain("contract=files=ok,validation=ok,rollback=ok");
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
