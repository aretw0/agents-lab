import { describe, expect, it } from "vitest";
import { registerGuardrailsAutonomyLaneSurface } from "../../extensions/guardrails-core-autonomy-lane-surface";

describe("autonomy lane surface", () => {
  it("registers side-effect-free planning tool with pi execute signature", () => {
    let registeredTool: {
      name: string;
      execute: (toolCallId: string, params: Record<string, unknown>) => { details: { decision: string; allowedWork: string; ready: boolean } };
    } | undefined;

    registerGuardrailsAutonomyLaneSurface({
      registerTool(tool: unknown) { registeredTool = tool as typeof registeredTool; },
    } as never);

    expect(registeredTool?.name).toBe("autonomy_lane_plan");
    const result = registeredTool?.execute("call-test", {
      context_level: "warn",
      context_percent: 60,
      board_ready: true,
      next_task_id: "TASK-NEXT",
    });

    expect(result?.details.ready).toBe(true);
    expect(result?.details.decision).toBe("bounded");
    expect(result?.details.allowedWork).toBe("bounded-only");
  });
});
