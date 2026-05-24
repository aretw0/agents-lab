import { describe, expect, it } from "vitest";
import { buildControlPlaneProfilePacket, buildOperatorIntentIntakePacket, resolveStructuredInterview } from "../../extensions/guardrails-core-exports";
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

  it("routes incomplete free-form operator intent to a widget-ready interview choice", () => {
    const packet = buildOperatorIntentIntakePacket({
      intent: "organize the next work lane",
    });

    expect(packet).toMatchObject({
      effect: "none",
      mode: "operator-intent-intake",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      mutationAllowed: false,
      workerDispatchAllowed: false,
      decision: "ask-operator",
      recommendedRoute: "structured_interview_plan",
      operatorDecisionNeeded: true,
      controlPlaneAction: "ask-operator",
      confirmationRequired: true,
      interaction: {
        kind: "operator-choice",
        recommendedChoiceId: "answer-next-question",
        allowCustomAnswer: true,
        allowCancel: true,
        uiHints: {
          preferred: "choice-list",
          fallback: "compact-text",
        },
      },
    });
    expect(packet.missingQuestions.length).toBeGreaterThan(0);
    expect(packet.interaction.choices[0]).toMatchObject({
      id: "answer-next-question",
      route: "structured_interview_plan",
    });
    expect(packet.summary).toContain("dispatch=no mutation=no worker-dispatch=no");
    expect(packet.summary).toContain("choice=answer-next-question");
  });

  it("routes absent local-safe material to brainstorm seed preview without dispatch", () => {
    const packet = buildOperatorIntentIntakePacket({
      intent: "find the next local-safe slice",
      autonomyRequest: "bounded-batch",
      availableResources: ["board", "tests"],
      expectedRoi: "reduce ambiguity before implementation",
      limits: ["local-safe only"],
      stopConditions: ["validation fails"],
      operatorFocusKnown: true,
      validationKnown: true,
      rollbackKnown: true,
      checkpointPlanned: true,
      localSafeMaterialReady: false,
    });

    expect(packet).toMatchObject({
      decision: "seed-brainstorm",
      controlPlaneAction: "run-report-only-route",
      confirmationRequired: false,
      operatorDecisionNeeded: false,
      recommendedTools: ["lane_brainstorm_packet", "lane_brainstorm_seed_preview"],
      dispatchAllowed: false,
      mutationAllowed: false,
      workerDispatchAllowed: false,
    });
    expect(packet.interaction.choices[0]).toMatchObject({
      id: "seed-brainstorm",
      route: "lane_brainstorm_packet",
    });
    expect(packet.interaction.recommendedChoiceId).toBe("seed-brainstorm");
  });

  it("prepares a worker packet only as a report-only candidate when readiness is known", () => {
    const packet = buildOperatorIntentIntakePacket({
      intent: "fan out read-only model calibration",
      autonomyRequest: "worker-assisted",
      availableResources: ["codex-spark", "test-harness"],
      expectedRoi: "compare workers before choosing a lane",
      limits: ["read-only", "two workers"],
      stopConditions: ["budget warning", "validation fails"],
      operatorFocusKnown: true,
      validationKnown: true,
      rollbackKnown: true,
      checkpointPlanned: true,
      workerRequested: true,
      runtimeHealthReady: true,
      subagentsReady: true,
      providerReady: true,
    });

    expect(packet).toMatchObject({
      decision: "prepare-worker-packet",
      controlPlaneAction: "run-report-only-route",
      confirmationRequired: false,
      operatorDecisionNeeded: false,
      recommendedTools: ["agent_run_operator_packet", "agent_run_task_packet"],
      dispatchAllowed: false,
      mutationAllowed: false,
      workerDispatchAllowed: false,
    });
    expect(packet.profilePacket.profile).toBe("worker-assisted-candidate");
    expect(packet.interaction.choices[0]).toMatchObject({
      id: "prepare-worker-packet",
      route: "agent_run_operator_packet",
    });
    expect(packet.interaction.recommendedChoiceId).toBe("prepare-worker-packet");
  });

  it("checks worker readiness before preparing a worker packet when readiness is omitted", () => {
    const packet = buildOperatorIntentIntakePacket({
      intent: "fan out read-only model calibration",
      autonomyRequest: "worker-assisted",
      availableResources: ["codex-spark", "test-harness"],
      expectedRoi: "compare workers before choosing a lane",
      limits: ["read-only", "two workers"],
      stopConditions: ["budget warning", "validation fails"],
      operatorFocusKnown: true,
      validationKnown: true,
      rollbackKnown: true,
      checkpointPlanned: true,
      workerRequested: true,
    });

    expect(packet).toMatchObject({
      decision: "check-worker-readiness",
      controlPlaneAction: "run-report-only-route",
      confirmationRequired: false,
      operatorDecisionNeeded: false,
      recommendedTools: ["environment_runtime_health_status", "subagent_readiness_status", "provider_readiness_matrix"],
      dispatchAllowed: false,
      mutationAllowed: false,
      workerDispatchAllowed: false,
    });
    expect(packet.missingCapabilities).toEqual(expect.arrayContaining(["runtime-health", "subagent-readiness", "provider-readiness"]));
    expect(packet.interaction.choices[0]).toMatchObject({
      id: "check-worker-readiness",
      route: "environment_runtime_health_status+subagent_readiness_status+provider_readiness_matrix",
    });
    expect(packet.interaction.recommendedChoiceId).toBe("check-worker-readiness");
  });

  it("checks worker readiness before preparing a worker packet when readiness is negative", () => {
    const packet = buildOperatorIntentIntakePacket({
      intent: "fan out read-only model calibration",
      autonomyRequest: "worker-assisted",
      availableResources: ["codex-spark", "test-harness"],
      expectedRoi: "compare workers before choosing a lane",
      limits: ["read-only", "two workers"],
      stopConditions: ["budget warning", "validation fails"],
      operatorFocusKnown: true,
      validationKnown: true,
      rollbackKnown: true,
      checkpointPlanned: true,
      workerRequested: true,
      runtimeHealthReady: true,
      subagentsReady: false,
      providerReady: true,
    });

    expect(packet.decision).toBe("check-worker-readiness");
    expect(packet.controlPlaneAction).toBe("run-report-only-route");
    expect(packet.confirmationRequired).toBe(false);
    expect(packet.operatorDecisionNeeded).toBe(false);
    expect(packet.recommendedTools).toEqual(["environment_runtime_health_status", "subagent_readiness_status", "provider_readiness_matrix"]);
    expect(packet.missingCapabilities).toContain("subagent-readiness");
    expect(packet.missingCapabilities).not.toContain("runtime-health");
    expect(packet.missingCapabilities).not.toContain("provider-readiness");
  });

  it("surface keeps worker intake in readiness-check mode until readiness is explicit", () => {
    const tools: Array<{ name: string; execute: (id: string, params: Record<string, unknown>) => { content?: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } }> = [];
    registerGuardrailsStructuredInterviewSurface({
      registerTool(tool: unknown) {
        tools.push(tool as (typeof tools)[number]);
      },
    } as never);

    const tool = tools.find((item) => item.name === "operator_intent_intake_packet");
    const result = tool?.execute("tc-intake-readiness", {
      intent: "prepare worker review",
      autonomy_request: "worker-assisted",
      available_resources: ["codex-spark"],
      expected_roi: "parallel read-only exploration",
      limits: ["read-only"],
      stop_conditions: ["budget warning"],
      operator_focus_known: true,
      validation_known: true,
      rollback_known: true,
      checkpoint_planned: true,
      worker_requested: true,
    });

    expect(result?.details.decision).toBe("check-worker-readiness");
    expect(result?.details.controlPlaneAction).toBe("run-report-only-route");
    expect(result?.details.confirmationRequired).toBe(false);
    expect(result?.details.operatorDecisionNeeded).toBe(false);
    expect(result?.details.recommendedTools).toEqual(["environment_runtime_health_status", "subagent_readiness_status", "provider_readiness_matrix"]);
    expect(result?.details.missingCapabilities).toEqual(expect.arrayContaining(["runtime-health"]));
    expect(result?.content?.[0]?.text).toContain("operator-intent-intake: decision=check-worker-readiness");
  });

  it("blocks protected intent before routing to brainstorm or workers", () => {
    const packet = buildOperatorIntentIntakePacket({
      intent: "publish the release",
      autonomyRequest: "worker-assisted",
      protectedScopeRequested: true,
      githubActionsRequested: true,
      brainstormRequested: true,
      workerRequested: true,
    });

    expect(packet).toMatchObject({
      decision: "blocked",
      controlPlaneAction: "stop-and-report",
      confirmationRequired: true,
      operatorDecisionNeeded: true,
      recommendedTools: ["control_plane_profile_packet"],
      blockedRequests: ["protected-scope", "github-actions"],
      dispatchAllowed: false,
      mutationAllowed: false,
      workerDispatchAllowed: false,
    });
    expect(packet.interaction.choices[0]).toMatchObject({
      id: "remove-blocked-request",
      route: "control_plane_profile_packet",
    });
    expect(packet.interaction.recommendedChoiceId).toBe("remove-blocked-request");
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

  it("surface exposes operator_intent_intake_packet with compact text and widget-ready details", () => {
    const tools: Array<{ name: string; execute: (id: string, params: Record<string, unknown>) => { content?: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } }> = [];
    registerGuardrailsStructuredInterviewSurface({
      registerTool(tool: unknown) {
        tools.push(tool as (typeof tools)[number]);
      },
    } as never);

    const tool = tools.find((item) => item.name === "operator_intent_intake_packet");
    const result = tool?.execute("tc-intake", {
      intent: "prepare worker review",
      autonomy_request: "worker-assisted",
      available_resources: ["codex-spark"],
      expected_roi: "parallel read-only exploration",
      limits: ["read-only"],
      stop_conditions: ["budget warning"],
      operator_focus_known: true,
      validation_known: true,
      rollback_known: true,
      checkpoint_planned: true,
      worker_requested: true,
      runtime_health_ready: true,
      subagents_ready: true,
      provider_ready: true,
    });

    expect(result?.details.decision).toBe("prepare-worker-packet");
    expect(result?.details.controlPlaneAction).toBe("run-report-only-route");
    expect(result?.details.confirmationRequired).toBe(false);
    expect(result?.details.operatorDecisionNeeded).toBe(false);
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.workerDispatchAllowed).toBe(false);
    expect(result?.details.interaction).toMatchObject({
      kind: "operator-choice",
      recommendedChoiceId: "prepare-worker-packet",
      allowCustomAnswer: true,
      allowCancel: true,
      uiHints: {
        preferred: "choice-list",
        fallback: "compact-text",
      },
    });
    expect(result?.content?.[0]?.text).toContain("operator-intent-intake: decision=prepare-worker-packet");
    expect(result?.content?.[0]?.text).toContain("choice=prepare-worker-packet");
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
