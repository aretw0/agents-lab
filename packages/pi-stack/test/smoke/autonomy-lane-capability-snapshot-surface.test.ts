import { describe, expect, it } from "vitest";
import { registerGuardrailsAutonomyLaneSurface } from "../../extensions/guardrails-core-autonomy-lane-surface";

type RegisteredTool = {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: unknown,
    onUpdate?: unknown,
    ctx?: { cwd: string },
  ) => { details: Record<string, unknown>; content?: Array<{ text?: string }> };
};

function registerTools(): RegisteredTool[] {
  const tools: RegisteredTool[] = [];
  registerGuardrailsAutonomyLaneSurface({
    registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
  } as never);
  return tools;
}

describe("autonomy delegation capability snapshot surface", () => {
  it("uses explicit freshness signals without probing filesystem state", () => {
    const tool = registerTools().find((registered) => registered.name === "delegation_lane_capability_snapshot");

    const result = tool?.execute("call-test", {
      preload_decision: "use-pack",
      dirty_signal: "clean",
      monitor_classify_failures: 0,
      subagents_ready: true,
    }, undefined, undefined, { cwd: "\0invalid-cwd" });

    expect(result?.details.decision).toBe("ready");
    expect(result?.details.recommendationCode).toBe("delegation-capability-ready");
    expect(result?.details.authorization).toBe("none");
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.signals).toEqual(expect.objectContaining({
      preloadDecision: "use-pack",
      dirtySignal: "clean",
    }));
  });
});
