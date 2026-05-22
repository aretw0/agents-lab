import { describe, expect, it } from "vitest";
import { buildControlPlaneProfilePacket, resolveStructuredInterview } from "../../extensions/guardrails-core-exports";
import { registerGuardrailsStructuredInterviewSurface } from "../../extensions/guardrails-core-structured-interview-surface";

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
      decision: "needs-operator-answer",
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

  it("builds a report-only control-plane profile packet", () => {
    const ready = buildControlPlaneProfilePacket({
      intent: "harden release governance",
      autonomyRequest: "bounded-batch",
      availableResources: ["first-hatch", "tool-hygiene", "first-hatch"],
      expectedRoi: "reduce operator prompts while keeping gates explicit",
      limits: ["local-safe only", "max 3 slices"],
      stopConditions: ["validation fails", "protected scope appears"],
      operatorFocusKnown: true,
      validationKnown: true,
      rollbackKnown: true,
      checkpointPlanned: true,
    });
    const blocked = buildControlPlaneProfilePacket({
      intent: "publish release",
      autonomyRequest: "worker-assisted",
      protectedScopeRequested: true,
      githubActionsRequested: true,
    });

    expect(ready).toMatchObject({
      effect: "none",
      mode: "report-only",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      mutationAllowed: false,
      decision: "ready-for-operator-decision",
      profile: "bounded-batch-candidate",
      autonomy: "bounded-batch-candidate",
      missingQuestions: [],
      missingCapabilities: [],
      resources: ["first-hatch", "tool-hygiene"],
      availableCapabilities: ["first-hatch", "tool-hygiene"],
      operatorDecisionNeeded: true,
    });
    expect(ready.recommendedNextAction).toBe(ready.recommendation);
    expect(ready.summary).toContain("blocked=none");
    expect(blocked).toMatchObject({
      decision: "blocked",
      profile: "blocked-protected-scope",
      dispatchAllowed: false,
      mutationAllowed: false,
      blockedRequests: ["protected-scope", "github-actions"],
    });
    expect(blocked.summary).toContain("blocked=protected-scope|github-actions");
  });

  it("surface exposes control_plane_profile_packet as operator-visible report-only tool", () => {
    const tools: Array<{ name: string; execute: (id: string, params: Record<string, unknown>) => { content?: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } }> = [];
    registerGuardrailsStructuredInterviewSurface({
      registerTool(tool: unknown) {
        tools.push(tool as (typeof tools)[number]);
      },
    } as never);

    const tool = tools.find((item) => item.name === "control_plane_profile_packet");
    const result = tool?.execute("tc-profile", {
      intent: "prepare local-safe batch",
      autonomy_request: "bounded-batch",
      available_resources: ["first-hatch", "tool-hygiene"],
      expected_roi: "less operator ambiguity",
      limits: ["local-safe"],
      stop_conditions: ["validation fails"],
      operator_focus_known: true,
      validation_known: true,
      rollback_known: true,
      checkpoint_planned: true,
    });

    expect(result?.details.decision).toBe("ready-for-operator-decision");
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.mutationAllowed).toBe(false);
    expect(result?.details.operatorDecisionNeeded).toBe(true);
    expect(result?.details.availableCapabilities).toEqual(["first-hatch", "tool-hygiene"]);
    expect(result?.content?.[0]?.text).toContain("control-plane-profile-packet: decision=ready-for-operator-decision");
    expect(result?.content?.[0]?.text).toContain("payload completo disponível em details");
    expect(result?.content?.[0]?.text).not.toContain("\"intent\"");
  });

  it("surface retorna resumo operator-visible e preserva details", () => {
    const tools: Array<{ name: string; execute: (id: string, params: Record<string, unknown>) => { content?: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } }> = [];
    registerGuardrailsStructuredInterviewSurface({
      registerTool(tool: unknown) {
        tools.push(tool as (typeof tools)[number]);
      },
    } as never);

    const tool = tools.find((item) => item.name === "structured_interview_plan");
    const result = tool?.execute("tc-interview", {
      questions: [
        { id: "task", prompt: "Qual task?", kind: "text" },
        { id: "validation", prompt: "Qual validação?", kind: "single-choice", options: ["test", "inspection"] },
      ],
      answers: [{ questionId: "task", value: "TASK-BUD-856" }],
    });

    expect(result?.details.decision).toBe("needs-operator-answer");
    expect(result?.content?.[0]?.text).toContain("structured-interview: decision=needs-operator-answer");
    expect(result?.content?.[0]?.text).toContain("payload completo disponível em details");
    expect(result?.content?.[0]?.text).not.toContain('\"decision\"');
  });
});
