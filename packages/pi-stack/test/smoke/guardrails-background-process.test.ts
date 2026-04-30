import { describe, expect, it } from "vitest";
import { resolveBackgroundProcessControlPlan } from "../../extensions/guardrails-core";

describe("background process control plan", () => {
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
});
