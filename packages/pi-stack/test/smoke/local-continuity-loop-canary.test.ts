import { describe, expect, it } from "vitest";
import { buildLocalContinuityLoopCanaryPacket } from "../../extensions/guardrails-core-exports";
import { registerGuardrailsUnattendedContinuationSurface } from "../../extensions/guardrails-core-unattended-continuation-surface";

type RegisteredTool = {
  name: string;
  parameters?: unknown;
  execute: (_toolCallId: string, params: Record<string, unknown>) => {
    content?: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  };
};

describe("local continuity loop canary packet", () => {
  it("prepares only one dry-run local-safe slice when preflight evidence is green", () => {
    const result = buildLocalContinuityLoopCanaryPacket({
      optIn: true,
      selectedTaskId: "TASK-BUD-1052",
      packetReady: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      rollbackPlanKnown: true,
      budgetKnown: true,
      contextLevel: "ok",
    });

    expect(result).toMatchObject({
      effect: "none",
      mode: "dry-run-canary",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      executionAllowed: false,
      commitAllowed: false,
      checkpointAllowed: false,
      repeatAllowed: false,
      singleSliceOnly: true,
      decision: "prepare-one-slice",
      nextAction: "prepare-slice",
      selectedTaskId: "TASK-BUD-1052",
      cycleComplete: false,
      blockers: [],
    });
    expect(result.summary).toContain("dispatch=no");
    expect(result.summary).toContain("repeat=no");
  });

  it("requires checkpoint after validation and commit before stop", () => {
    const result = buildLocalContinuityLoopCanaryPacket({
      optIn: true,
      selectedTaskId: "TASK-BUD-1052",
      packetReady: true,
      sliceExecuted: true,
      validationPassed: true,
      commitRecorded: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      rollbackPlanKnown: true,
      budgetKnown: true,
      contextLevel: "checkpoint",
    });

    expect(result.decision).toBe("checkpoint-required");
    expect(result.nextAction).toBe("checkpoint");
    expect(result.pendingStages).toEqual(["checkpoint", "recheck-stops"]);
  });

  it("stops after a complete slice and does not authorize repetition", () => {
    const result = buildLocalContinuityLoopCanaryPacket({
      optIn: true,
      selectedTaskId: "TASK-BUD-1052",
      packetReady: true,
      sliceExecuted: true,
      validationPassed: true,
      commitRecorded: true,
      checkpointRecorded: true,
      stopConditionsRechecked: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      rollbackPlanKnown: true,
      budgetKnown: true,
    });

    expect(result.decision).toBe("stop-after-slice");
    expect(result.nextAction).toBe("stop");
    expect(result.cycleComplete).toBe(true);
    expect(result.repeatAllowed).toBe(false);
    expect(result.recommendation).toContain("fresh canary decision");
  });

  it("blocks dirty/protected/compact/repeat requests", () => {
    const result = buildLocalContinuityLoopCanaryPacket({
      optIn: true,
      selectedTaskId: "TASK-BUD-1052",
      gitStateExpected: false,
      protectedScopesClear: false,
      rollbackPlanKnown: true,
      budgetKnown: true,
      contextLevel: "compact",
      repeatRequested: true,
      schedulerRequested: true,
      remoteOrOffloadRequested: true,
      githubActionsRequested: true,
      protectedScopeRequested: true,
    });

    expect(result.decision).toBe("blocked");
    expect(result.nextAction).toBe("ask-operator");
    expect(result.blockers).toEqual(expect.arrayContaining([
      "unexpected-git-state",
      "protected-scope-pending",
      "compact-without-checkpoint",
      "repeat-requested",
      "scheduler-requested",
      "remote-or-offload-requested",
      "github-actions-requested",
      "protected-scope-requested",
    ]));
  });

  it("registers local_continuity_loop_canary_packet as dry-run and report-only", () => {
    const tools: RegisteredTool[] = [];
    registerGuardrailsUnattendedContinuationSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const tool = tools.find((tool) => tool.name === "local_continuity_loop_canary_packet");
    const schemaText = JSON.stringify(tool?.parameters ?? {});
    expect(schemaText).not.toContain("start");
    expect(schemaText).not.toContain("dispatch_allowed");

    const result = tool?.execute("tc-loop-canary", {
      opt_in: true,
      selected_task_id: "TASK-BUD-1052",
      packet_ready: true,
      slice_executed: true,
      validation_passed: true,
      commit_recorded: true,
      checkpoint_recorded: true,
      stop_conditions_rechecked: true,
      git_state_expected: true,
      protected_scopes_clear: true,
      rollback_plan_known: true,
      budget_known: true,
    });

    expect(result?.content?.[0]?.text).toContain("local-continuity-loop-canary: decision=stop-after-slice");
    expect(result?.details).toMatchObject({
      mode: "dry-run-canary",
      authorization: "none",
      dispatchAllowed: false,
      repeatAllowed: false,
      decision: "stop-after-slice",
    });
  });
});
