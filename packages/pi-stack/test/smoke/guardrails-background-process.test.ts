import { describe, expect, it, vi } from "vitest";
import guardrailsCore, { resolveBackgroundProcessControlPlan, resolveBackgroundProcessLifecycleEvent } from "../../extensions/guardrails-core";

describe("background process control plan", () => {
  function makeMockPi() {
    return {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    } as unknown as Parameters<typeof guardrailsCore>[0];
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
      label: "undefined",
    });
    expect(late.state).toBe("late-after-stop");
    expect(late.displayLabel).toBe("background-process");
    expect(late.warnings).toContain("fallback-display-label");
    expect(late.warnings).toContain("done-after-stop-request");
    expect(late.evidence).not.toContain("label=undefined");

    const unknown = resolveBackgroundProcessLifecycleEvent({
      eventKind: "done",
      pid: 456,
      exitCode: 0,
      knownProcess: false,
    });
    expect(unknown.state).toBe("unknown-origin");
    expect(unknown.staleOrLate).toBe(true);
  });

  it("exposes lifecycle classifier as a read-only tool", async () => {
    const pi = makeMockPi();
    guardrailsCore(pi);
    const tool = getTool(pi, "background_process_lifecycle_plan");
    const result = await tool.execute(
      "tc-bg-lifecycle",
      {
        event_kind: "done",
        pid: 789,
        exit_code: 1,
        known_process: true,
        stop_requested: true,
        label: "undefined",
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );
    expect(result.details?.state).toBe("late-after-stop");
    expect(result.details?.displayLabel).toBe("background-process");
    expect(String(result.content?.[0]?.text)).toContain("dispatch=no");
  });
});
