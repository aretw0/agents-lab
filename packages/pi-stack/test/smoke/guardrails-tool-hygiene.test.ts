import { describe, expect, it } from "vitest";
import { buildToolHygieneScorecard, classifyToolHygiene } from "../../extensions/guardrails-core";

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
});
