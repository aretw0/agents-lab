import { describe, expect, it } from "vitest";
import { resolveStructuredInterview } from "../../extensions/guardrails-core";

describe("structured interview primitive", () => {
  it("asks for the first missing required answer without authorizing dispatch", () => {
    const result = resolveStructuredInterview({
      questions: [
        { id: "task", prompt: "Qual task?", kind: "text" },
        { id: "validation", prompt: "Qual validação?", kind: "single-choice", options: ["test", "inspection"] },
      ],
      answers: [{ questionId: "task", value: "TASK-BUD-374" }],
    });

    expect(result).toMatchObject({
      mode: "structured-interview",
      backendFirst: true,
      uiCoupling: "none",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      decision: "needs-human-answer",
      nextQuestionId: "validation",
    });
    expect(result.evidence).toContain("dispatch=no");
  });

  it("accepts defaults, unknown, and skip only when the schema allows them", () => {
    const result = resolveStructuredInterview({
      questions: [
        { id: "scope", prompt: "Escopo?", kind: "single-choice", options: ["local", "protected"], defaultValue: "local" },
        { id: "rollback", prompt: "Rollback?", kind: "text", allowUnknown: true },
        { id: "notes", prompt: "Notas?", kind: "text", required: false },
      ],
      answers: [{ questionId: "rollback", state: "unknown" }],
    });

    expect(result.decision).toBe("complete");
    expect(result.accepted.map((answer) => [answer.questionId, answer.state, answer.source])).toEqual([
      ["scope", "answered", "default"],
      ["rollback", "unknown", "answer"],
      ["notes", "skipped", "optional"],
    ]);
  });

  it("fails closed on invalid choice values and unauthorized skip", () => {
    const result = resolveStructuredInterview({
      questions: [
        { id: "scope", prompt: "Escopo?", kind: "single-choice", options: ["local", "protected"] },
        { id: "validation", prompt: "Validação?", kind: "text" },
      ],
      answers: [
        { questionId: "scope", value: "remote" },
        { questionId: "validation", state: "skipped" },
      ],
    });

    expect(result).toMatchObject({
      decision: "invalid",
      dispatchAllowed: false,
      authorization: "none",
    });
    expect(result.invalid.map((entry) => entry.reason)).toEqual([
      "single-choice-value-not-in-options",
      "skip-not-allowed",
    ]);
  });
});
