import { describe, expect, it, vi } from "vitest";
import guardrailsCore, { buildBackgroundProcessReadinessScore, resolveBackgroundProcessControlPlan, resolveBackgroundProcessLifecycleEvent } from "../../extensions/guardrails-core";

describe("background process control plan", () => {
  function makeMockPi(seedTools: Array<{ name: string; description?: string }> = []) {
    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => [
      ...seedTools,
      ...(rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool),
    ]);
    return rawPi as unknown as Parameters<typeof guardrailsCore>[0];
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
      ) => Promise<{ details?: Record<string, unknown>; content?: Array<{ text?: string }> }> | { details?: Record<string, unknown>; content?: Array<{ text?: string }> };
    };
  }

  it("requires a port lease before server process design proceeds", () => {
    const result = resolveBackgroundProcessControlPlan({ kind: "frontend", needsServer: true });

    expect(result).toMatchObject({
      mode: "background-process-control-plan",
      decision: "needs-port-lease",
      recommendedMode: "shared-service",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      processStartAllowed: false,
      processStopAllowed: false,
      mutationAllowed: false,
      portPolicy: {
        requiresLease: true,
        collisionPolicy: "fail-closed",
      },
    });
    expect(result.blockers).toContain("port-lease-required");
  });

  it("plans shared service reuse with bounded logs and no dispatch", () => {
    const result = resolveBackgroundProcessControlPlan({
      kind: "backend",
      requestedMode: "shared-service",
      requestedPort: 3000,
      existingServiceReusable: true,
      healthcheckKnown: true,
      logTailMaxLines: 5000,
    });

    expect(result.decision).toBe("ready-for-design");
    expect(result.recommendedMode).toBe("shared-service");
    expect(result.logPolicy).toMatchObject({
      tailMaxLines: 1000,
      captureStdout: true,
      captureStderr: true,
      captureStacktrace: true,
      dumpFullLogsAllowed: false,
    });
    expect(result.requiredCapabilities).toContain("port-lease-lock");
    expect(result.evidence).toContain("dispatch=no");
  });

  it("requires human decision for ambiguous parallel server modes", () => {
    const result = resolveBackgroundProcessControlPlan({
      kind: "test-server",
      requestedMode: "auto",
      requestedPort: 4173,
      parallelAgents: 2,
      healthcheckKnown: true,
    });

    expect(result.decision).toBe("needs-human-decision");
    expect(result.recommendedMode).toBe("manual-decision");
    expect(result.blockers).toContain("parallel-agent-server-mode-decision-required");
  });

  it("blocks destructive restarts in the planning primitive", () => {
    const result = resolveBackgroundProcessControlPlan({
      requestedPort: 8080,
      destructiveRestart: true,
    });

    expect(result.decision).toBe("blocked");
    expect(result.blockers).toContain("destructive-restart-requires-human-approval");
    expect(result.processStopAllowed).toBe(false);
  });

  it("computes readiness score with deterministic recommendation", () => {
    const strong = buildBackgroundProcessReadinessScore({
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
    });
    expect(strong).toMatchObject({
      recommendationCode: "background-process-readiness-strong",
      dispatchAllowed: false,
      authorization: "none",
      score: 100,
    });

    const weak = buildBackgroundProcessReadinessScore({
      hasPlanSurface: true,
      hasLifecycleSurface: true,
      rehearsalSlices: 0,
      stopSourceCoveragePct: 0,
    });
    expect(weak.recommendationCode).toBe("background-process-readiness-needs-capabilities");
    expect(weak.dimensions.capabilities).toBe(0);
  });

  it("classifies lifecycle events with safe labels and no dispatch", () => {
    expect(resolveBackgroundProcessLifecycleEvent({
      eventKind: "registered",
      pid: 123,
      knownProcess: true,
      label: "dev-server",
    })).toMatchObject({
      mode: "background-process-lifecycle-event",
      state: "running",
      displayLabel: "dev-server",
      dispatchAllowed: false,
      processStartAllowed: false,
      processStopAllowed: false,
      authorization: "none",
    });

    const late = resolveBackgroundProcessLifecycleEvent({
      eventKind: "done",
      pid: 123,
      exitCode: 1,
      knownProcess: true,
      stopRequested: true,
      stopSource: "human",
      label: "undefined",
    });
    expect(late.state).toBe("late-after-stop");
    expect(late.stopSource).toBe("human");
    expect(late.displayLabel).toBe("background-process");
    expect(late.viewTitle).toBe("background-process");
    expect(late.warnings).toContain("fallback-display-label");
    expect(late.warnings).toContain("fallback-view-title");
    expect(late.warnings).toContain("done-after-stop-request");
    expect(late.evidence).toContain("stopSource=human");
    expect(late.evidence).not.toContain("label=undefined");
    expect(late.evidence).not.toContain("viewTitle=undefined");

    const agentStop = resolveBackgroundProcessLifecycleEvent({
      eventKind: "stop-requested",
      pid: 123,
      knownProcess: true,
      stopRequested: true,
      stopSource: "agent",
      label: "local-drill",
      viewTitle: "local-drill",
    });
    expect(agentStop.state).toBe("stopped");
    expect(agentStop.stopSource).toBe("agent");
    expect(agentStop.evidence).toContain("stopSource=agent");

    const harnessNotification = resolveBackgroundProcessLifecycleEvent({
      eventKind: "done",
      pid: 32696,
      exitCode: 0,
      knownProcess: true,
      stopRequested: false,
      label: "BG_PROCESS_DONE",
      viewTitle: "undefined",
    });
    expect(harnessNotification.state).toBe("finished");
    expect(harnessNotification.displayLabel).toBe("BG_PROCESS_DONE");
    expect(harnessNotification.viewTitle).toBe("background-process");
    expect(harnessNotification.warnings).toContain("fallback-view-title");
    expect(harnessNotification.evidence).toContain("viewTitle=background-process");

    const unknown = resolveBackgroundProcessLifecycleEvent({
      eventKind: "done",
      pid: 456,
      exitCode: 0,
      knownProcess: false,
    });
    expect(unknown.state).toBe("unknown-origin");
    expect(unknown.staleOrLate).toBe(true);
  });

  it("infers readiness capability signals from available tooling and allows explicit override", async () => {
    const pi = makeMockPi([{ name: "bg_status", description: "background process status/log/stop" }]);
    guardrailsCore(pi);
    const readinessTool = getTool(pi, "background_process_readiness_score");

    const inferred = await readinessTool.execute(
      "tc-bg-readiness-inferred",
      {},
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );
    expect(inferred.details?.checks?.hasProcessRegistry).toBe(true);
    expect(inferred.details?.checks?.hasBoundedLogTail).toBe(true);
    expect(inferred.details?.checks?.hasGracefulStopThenKill).toBe(true);
    expect(inferred.details?.checks?.hasStructuredStacktraceCapture).toBe(true);

    const override = await readinessTool.execute(
      "tc-bg-readiness-override",
      {
        has_process_registry: false,
        has_bounded_log_tail: false,
        has_graceful_stop_then_kill: false,
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );
    expect(override.details?.checks?.hasProcessRegistry).toBe(false);
    expect(override.details?.checks?.hasBoundedLogTail).toBe(false);
    expect(override.details?.checks?.hasGracefulStopThenKill).toBe(false);
  });

  it("background_process_readiness_packet exposes unified blocked/ready-window guidance", async () => {
    const pi = makeMockPi([{ name: "bg_status", description: "background process status/log/stop" }]);
    guardrailsCore(pi);
    const packetTool = getTool(pi, "background_process_readiness_packet");

    const blocked = await packetTool.execute(
      "tc-bg-readiness-packet-blocked",
      {
        kind: "backend",
        requested_mode: "shared-service",
        needs_server: true,
        requested_port: 3000,
        destructive_restart: true,
        lifecycle_classified: false,
        rollback_plan_known: false,
        rehearsal_slices: 0,
        stop_source_coverage_pct: 0,
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );

    expect(blocked.details?.mode).toBe("background-process-readiness-packet");
    expect(blocked.details?.decision).toBe("blocked");
    expect(blocked.details?.recommendationCode).toBe("background-process-readiness-packet-blocked");
    expect(String(blocked.details?.summary)).toContain("background-process-readiness-packet:");
    expect(String(blocked.details?.summary)).toContain("authorization=none");
    expect(blocked.details?.unlockChecklist?.decision).toBe("needs-action");
    expect((blocked.details?.unlockChecklist?.topBlockers as string[])?.length).toBeGreaterThan(0);

    const needsEvidence = await packetTool.execute(
      "tc-bg-readiness-packet-needs-evidence",
      {
        kind: "backend",
        requested_mode: "shared-service",
        needs_server: true,
        requested_port: 3000,
        existing_service_reusable: true,
        healthcheck_known: true,
        has_process_registry: true,
        has_port_lease_lock: true,
        has_bounded_log_tail: true,
        has_structured_stacktrace_capture: true,
        has_healthcheck_probe: true,
        has_graceful_stop_then_kill: true,
        has_reload_handoff_cleanup: true,
        lifecycle_classified: false,
        rollback_plan_known: true,
        rehearsal_slices: 0,
        stop_source_coverage_pct: 10,
        unresolved_blockers: 0,
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );

    expect(needsEvidence.details?.decision).toBe("needs-evidence");
    expect(needsEvidence.details?.recommendationCode).toBe("background-process-readiness-packet-needs-evidence");
    expect(needsEvidence.details?.unlockChecklist?.decision).toBe("needs-action");
    expect(String(needsEvidence.details?.unlockChecklist?.summary)).toContain("next=");

    const ready = await packetTool.execute(
      "tc-bg-readiness-packet-ready",
      {
        kind: "backend",
        requested_mode: "shared-service",
        needs_server: true,
        requested_port: 3000,
        existing_service_reusable: true,
        healthcheck_known: true,
        has_process_registry: true,
        has_port_lease_lock: true,
        has_bounded_log_tail: true,
        has_structured_stacktrace_capture: true,
        has_healthcheck_probe: true,
        has_graceful_stop_then_kill: true,
        has_reload_handoff_cleanup: true,
        lifecycle_classified: true,
        rollback_plan_known: true,
        rehearsal_slices: 2,
        stop_source_coverage_pct: 90,
        unresolved_blockers: 0,
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );

    expect(ready.details?.decision).toBe("ready-window");
    expect(ready.details?.recommendationCode).toBe("background-process-readiness-packet-ready");
    expect(String(ready.details?.nextAction)).toContain("rehearsal slice");
    expect(ready.details?.unlockChecklist?.decision).toBe("ready");
    expect(String(ready.details?.unlockChecklist?.summary)).toContain("topBlockers=none");
  });

  it("exposes readiness/rehearsal/lifecycle classifiers as read-only tools", async () => {
    const pi = makeMockPi();
    guardrailsCore(pi);
    const readinessTool = getTool(pi, "background_process_readiness_score");
    const rehearsalTool = getTool(pi, "background_process_rehearsal_gate");
    const tool = getTool(pi, "background_process_lifecycle_plan");

    const readiness = await readinessTool.execute(
      "tc-bg-readiness",
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
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );
    expect(readiness.details?.recommendationCode).toBe("background-process-readiness-strong");
    expect(String(readiness.details?.summary)).toContain("background-process-readiness:");

    const rehearsal = await rehearsalTool.execute(
      "tc-bg-rehearsal",
      {
        readiness_score: 85,
        readiness_recommendation_code: "background-process-readiness-strong",
        lifecycle_classified: true,
        stop_source_coverage_pct: 90,
        rollback_plan_known: true,
        rehearsal_slices: 1,
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );
    expect(rehearsal.details?.decision).toBe("ready");
    expect(rehearsal.details?.dispatchAllowed).toBe(false);

    const result = await tool.execute(
      "tc-bg-lifecycle",
      {
        event_kind: "done",
        pid: 789,
        exit_code: 1,
        known_process: true,
        stop_requested: true,
        stop_source: "human",
        label: "undefined",
        view_title: "undefined",
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );
    expect(result.details?.state).toBe("late-after-stop");
    expect(result.details?.stopSource).toBe("human");
    expect(result.details?.displayLabel).toBe("background-process");
    expect(result.details?.viewTitle).toBe("background-process");
    expect(String(result.content?.[0]?.text)).toContain("stopSource=human");
    expect(String(result.content?.[0]?.text)).toContain("viewTitle=background-process");
    expect(String(result.content?.[0]?.text)).toContain("dispatch=no");
  });
});
