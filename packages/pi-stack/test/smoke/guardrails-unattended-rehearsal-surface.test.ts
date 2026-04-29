import { describe, expect, it } from "vitest";
import { registerGuardrailsUnattendedRehearsalSurface } from "../../extensions/guardrails-core-unattended-rehearsal-surface";

type RegisteredTool = {
  name: string;
  execute: (toolCallId: string, params: Record<string, unknown>) => { details: Record<string, unknown> };
};

describe("guardrails unattended rehearsal surface", () => {
  it("registers read-only unattended rehearsal gate tool", () => {
    const tools: RegisteredTool[] = [];
    registerGuardrailsUnattendedRehearsalSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const gateTool = tools.find((tool) => tool.name === "unattended_rehearsal_gate");
    const result = gateTool?.execute("call-test", {
      completed_local_slices: 3,
      focus_preserved: true,
      focal_smoke_green: true,
      small_commits: true,
      handoff_fresh: true,
      protected_scope_auto_selections: 0,
      unresolved_blockers: 0,
    });

    expect(result?.details.ready).toBe(true);
    expect(result?.details.decision).toBe("ready-for-canary");
    expect(result?.details.summary).toBe("unattended-rehearsal: decision=ready-for-canary ready=yes score=6/6 blockers=none");
  });
});
