import { describe, expect, it, vi } from "vitest";
import guardrailsCore, { buildAgentsAsToolsCalibrationScore, buildToolHygieneScorecard, classifyToolHygiene } from "../../extensions/guardrails-core";

describe("tool hygiene scorecard", () => {
  it("classifies protected long-run and scheduler tools as human-approval only", () => {
    expect(classifyToolHygiene({
      name: "ant_colony",
      description: "Launch an autonomous ant colony in the BACKGROUND",
    })).toMatchObject({
      classification: "protected",
      maturity: "requires-human-approval",
    });

    expect(classifyToolHygiene({
      name: "schedule_prompt",
      description: "Create recurring reminders and scheduled prompts",
    })).toMatchObject({
      classification: "protected",
      maturity: "requires-human-approval",
    });
  });

  it("keeps board mutations operational with measured evidence requirement", () => {
    expect(classifyToolHygiene({
      name: "board_task_complete",
      description: "Append verification and complete task",
    })).toMatchObject({
      classification: "operational",
      maturity: "needs-measured-evidence",
    });
  });

  it("recognizes read-only planning primitives as safe for bounded local loops", () => {
    expect(classifyToolHygiene({
      name: "structured_interview_plan",
      description: "Read-only UI-independent primitive; never authorizes dispatch",
    })).toMatchObject({
      classification: "measured",
      maturity: "safe-for-local-loop",
    });
  });

  it("builds a no-dispatch scorecard with risk counts", () => {
    const scorecard = buildToolHygieneScorecard({
      tools: [
        { name: "ant_colony", description: "Launch autonomous long run" },
        { name: "board_task_complete", description: "mutates board evidence" },
        { name: "structured_interview_plan", description: "Read-only plan; never authorizes dispatch" },
      ],
    });

    expect(scorecard).toMatchObject({
      mode: "tool-hygiene-scorecard",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      total: 3,
      summary: {
        protected: 1,
        operational: 1,
        measured: 1,
      },
      riskSummary: {
        requiresHumanApproval: 1,
      },
    });
    expect(scorecard.evidence).toContain("dispatch=no");
  });

  it("builds strong agents-as-tools calibration score for governed bounded stack", () => {
    const score = buildAgentsAsToolsCalibrationScore({
      tools: [
        { name: "claude_code_adapter_status", description: "status budget" },
        { name: "claude_code_execute", description: "execute via subprocess dry_run=true and cwd isolation" },
        { name: "ant_colony", description: "autonomous long-run protected approval" },
        { name: "context_watch_checkpoint", description: "checkpoint evidence" },
        { name: "board_decision_packet", description: "decision packet read-only" },
        { name: "tool_hygiene_scorecard", description: "scorecard read-only" },
        { name: "background_process_lifecycle_plan", description: "read-only lifecycle plan" },
      ],
    });

    expect(score.mode).toBe("agents-as-tools-calibration-score");
    expect(score.dispatchAllowed).toBe(false);
    expect(score.authorization).toBe("none");
    expect(score.score).toBeGreaterThanOrEqual(70);
    expect(score.recommendationCode).toBe("agents-as-tools-calibration-strong");
    expect(score.summary).toContain("agents-as-tools-calibration:");
  });

  it("detects governance gaps in weak agents-as-tools calibration", () => {
    const score = buildAgentsAsToolsCalibrationScore({
      tools: [
        { name: "custom_exec", description: "execute command" },
        { name: "custom_runner", description: "run task" },
      ],
    });

    expect(score.recommendationCode).toBe("agents-as-tools-calibration-needs-governance");
    expect(score.dimensions.governance).toBeLessThan(70);
  });

  it("exposes agents_as_tools_calibration_score as read-only tool", async () => {
    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsCore>[0];

    guardrailsCore(pi);
    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agents_as_tools_calibration_score");
    const tool = toolCall?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => Promise<{ details?: Record<string, unknown> }> | { details?: Record<string, unknown> };
    };

    const result = await tool.execute(
      "tc-agents-score",
      {},
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );

    expect(result.details?.mode).toBe("agents-as-tools-calibration-score");
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.details?.authorization).toBe("none");
  });
});
