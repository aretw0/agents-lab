import { describe, expect, it } from "vitest";
import { buildControlPlaneProfilePacket, buildOperatorIntentIntakePacket, inferRuntimeHealthIntent, resolveStructuredInterview } from "../../extensions/guardrails-core-exports";
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
      nextAction: "answer-next-question",
      nextQuestionId: "validation",
      nextQuestion: {
        id: "validation",
        prompt: "Qual validação?",
        kind: "single-choice",
        options: ["test", "inspection"],
      },
    });
    expect(result.evidence).toContain("dispatch=no");
    expect(result.evidence).toContain("nextAction=answer-next-question");
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
    expect(result.nextAction).toBe("continue-with-complete-interview");
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
      nextAction: "fix-invalid-answers",
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
      nextAction: "present-bounded-batch-decision",
    });
    expect(ready.recommendedNextAction).toBe(ready.recommendation);
    expect(ready.summary).toContain("next=present-bounded-batch-decision");
    expect(ready.summary).toContain("blocked=none");
    expect(blocked).toMatchObject({
      decision: "blocked",
      profile: "blocked-protected-scope",
      nextAction: "resolve-blocked-intent",
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
      nextAction: "answer-next-question",
      recommendationCode: "operator-intent-ask-operator",
      confirmationRequired: true,
      reportOnlyRouteAuthorized: false,
      operatorPromptRequired: true,
      executionPlan: {
        kind: "operator-prompt",
        authorized: false,
        executeWithoutTextualConfirmation: false,
        finalResponseContract: "ask-one-compact-question",
      },
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
    expect(packet.summary).toContain("code=operator-intent-ask-operator");
    expect(packet.summary).toContain("next=answer-next-question");
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
      nextAction: "run-brainstorm-seed-preview",
      recommendationCode: "operator-intent-seed-brainstorm",
      confirmationRequired: false,
      operatorDecisionNeeded: false,
      reportOnlyRouteAuthorized: true,
      operatorPromptRequired: false,
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

  it("routes explicit runtime health intent to read-only checks without asking more questions", () => {
    const packet = buildOperatorIntentIntakePacket({
      intent: "validate runtime health before work",
      runtimeHealthRequested: true,
    });

    expect(packet).toMatchObject({
      decision: "check-runtime-health",
      controlPlaneAction: "run-report-only-route",
      nextAction: "run-runtime-health-checks",
      recommendationCode: "operator-intent-check-runtime-health",
      confirmationRequired: false,
      operatorDecisionNeeded: false,
      reportOnlyRouteAuthorized: true,
      operatorPromptRequired: false,
      recommendedTools: ["environment_runtime_health_status", "environment_dev_pressure_status", "safe_boot_runtime_artifact_audit"],
      executionPlan: {
        kind: "report-only-route",
        authorized: true,
        executeWithoutTextualConfirmation: true,
        finalResponseContract: "compact-decision-summary",
      },
      dispatchAllowed: false,
      mutationAllowed: false,
      workerDispatchAllowed: false,
    });
    expect(packet.executionPlan.steps.map((step) => step.tool)).toEqual([
      "environment_runtime_health_status",
      "environment_dev_pressure_status",
      "safe_boot_runtime_artifact_audit",
    ]);
    expect(packet.executionPlan.forbiddenActions).toEqual(["mutation", "dispatch", "worker-dispatch", "protected-scope"]);
    expect(packet.missingQuestions.length).toBeGreaterThan(0);
    expect(packet.interaction.choices[0]).toMatchObject({
      id: "check-runtime-health",
      route: "environment_runtime_health_status+environment_dev_pressure_status+safe_boot_runtime_artifact_audit",
    });
    expect(packet.interaction.recommendedChoiceId).toBe("check-runtime-health");
    expect(packet.summary).toContain("operatorDecision=no");
    expect(packet.summary).toContain("reportOnlyAuthorized=yes");
  });

  it("infers runtime health route from operator text without requiring an exact flag", () => {
    expect(inferRuntimeHealthIntent("Quero validar a saúde do runtime antes de trabalhar.")).toBe(true);
    expect(inferRuntimeHealthIntent("Rode /watchdog:status e /watchdog:overlay.")).toBe(true);
    expect(inferRuntimeHealthIntent("organize the next implementation slice")).toBe(false);

    const packet = buildOperatorIntentIntakePacket({
      intent: "Não peça confirmação. Quero validar a saúde do runtime e revisar watchdog antes de trabalhar.",
    });

    expect(packet.decision).toBe("check-runtime-health");
    expect(packet.controlPlaneAction).toBe("run-report-only-route");
    expect(packet.confirmationRequired).toBe(false);
    expect(packet.reportOnlyRouteAuthorized).toBe(true);
    expect(packet.recommendedTools).toEqual([
      "environment_runtime_health_status",
      "environment_dev_pressure_status",
      "safe_boot_runtime_artifact_audit",
    ]);
    expect(packet.executionPlan.executeWithoutTextualConfirmation).toBe(true);
  });

  it("prepares a worker packet only as a report-only candidate when readiness is known", () => {
    const packet = buildOperatorIntentIntakePacket({
      intent: "fan out read-only model calibration",
      autonomyRequest: "worker-assisted",
      availableResources: ["separate-worker-quota", "test-harness"],
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
      nextAction: "prepare-worker-packet",
      recommendationCode: "operator-intent-prepare-worker-packet",
      confirmationRequired: false,
      operatorDecisionNeeded: false,
      reportOnlyRouteAuthorized: true,
      operatorPromptRequired: false,
      recommendedTools: ["agent_run_operator_packet", "agent_run_task_packet"],
      executionPlan: {
        kind: "report-only-route",
        authorized: true,
        executeWithoutTextualConfirmation: true,
        finalResponseContract: "compact-decision-summary",
      },
      dispatchAllowed: false,
      mutationAllowed: false,
      workerDispatchAllowed: false,
    });
    expect(packet.executionPlan.steps.map((step) => step.tool)).toEqual(["agent_run_operator_packet", "agent_run_task_packet"]);
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
      availableResources: ["separate-worker-quota", "test-harness"],
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
      nextAction: "run-worker-readiness-checks",
      recommendationCode: "operator-intent-check-worker-readiness",
      confirmationRequired: false,
      operatorDecisionNeeded: false,
      reportOnlyRouteAuthorized: true,
      operatorPromptRequired: false,
      recommendedTools: ["environment_runtime_health_status", "subagent_readiness_status", "provider_readiness_matrix"],
      executionPlan: {
        kind: "report-only-route",
        authorized: true,
        executeWithoutTextualConfirmation: true,
      },
      dispatchAllowed: false,
      mutationAllowed: false,
      workerDispatchAllowed: false,
    });
    expect(packet.executionPlan.steps.map((step) => step.tool)).toEqual([
      "environment_runtime_health_status",
      "subagent_readiness_status",
      "provider_readiness_matrix",
    ]);
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
      availableResources: ["separate-worker-quota", "test-harness"],
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
    expect(packet.recommendationCode).toBe("operator-intent-check-worker-readiness");
    expect(packet.controlPlaneAction).toBe("run-report-only-route");
    expect(packet.nextAction).toBe("run-worker-readiness-checks");
    expect(packet.confirmationRequired).toBe(false);
    expect(packet.operatorDecisionNeeded).toBe(false);
    expect(packet.reportOnlyRouteAuthorized).toBe(true);
    expect(packet.operatorPromptRequired).toBe(false);
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
      available_resources: ["separate-worker-quota"],
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
    expect(result?.details.recommendationCode).toBe("operator-intent-check-worker-readiness");
    expect(result?.details.controlPlaneAction).toBe("run-report-only-route");
    expect(result?.details.nextAction).toBe("run-worker-readiness-checks");
    expect(result?.details.confirmationRequired).toBe(false);
    expect(result?.details.operatorDecisionNeeded).toBe(false);
    expect(result?.details.reportOnlyRouteAuthorized).toBe(true);
    expect(result?.details.operatorPromptRequired).toBe(false);
    expect(result?.details.recommendedTools).toEqual(["environment_runtime_health_status", "subagent_readiness_status", "provider_readiness_matrix"]);
    expect(result?.details.missingCapabilities).toEqual(expect.arrayContaining(["runtime-health"]));
    expect(result?.content?.[0]?.text).toContain("operator-intent-intake: decision=check-worker-readiness");
  });

  it("surface routes explicit runtime health requests without confirmation", () => {
    const tools: Array<{ name: string; execute: (id: string, params: Record<string, unknown>) => { content?: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } }> = [];
    registerGuardrailsStructuredInterviewSurface({
      registerTool(tool: unknown) {
        tools.push(tool as (typeof tools)[number]);
      },
    } as never);

    const tool = tools.find((item) => item.name === "operator_intent_intake_packet");
    const result = tool?.execute("tc-runtime-health-intake", {
      intent: "validar saúde do runtime antes de trabalhar",
      runtime_health_requested: true,
    });

    expect(result?.details.decision).toBe("check-runtime-health");
    expect(result?.details.recommendationCode).toBe("operator-intent-check-runtime-health");
    expect(result?.details.controlPlaneAction).toBe("run-report-only-route");
    expect(result?.details.nextAction).toBe("run-runtime-health-checks");
    expect(result?.details.confirmationRequired).toBe(false);
    expect(result?.details.operatorDecisionNeeded).toBe(false);
    expect(result?.details.reportOnlyRouteAuthorized).toBe(true);
    expect(result?.details.operatorPromptRequired).toBe(false);
    expect(result?.details.recommendedTools).toEqual(["environment_runtime_health_status", "environment_dev_pressure_status", "safe_boot_runtime_artifact_audit"]);
    expect(result?.content?.[0]?.text).toContain("operator-intent-intake: decision=check-runtime-health");
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
      nextAction: "resolve-blocked-intent",
      recommendationCode: "operator-intent-blocked",
      confirmationRequired: true,
      operatorDecisionNeeded: true,
      reportOnlyRouteAuthorized: false,
      operatorPromptRequired: true,
      recommendedTools: ["control_plane_profile_packet"],
      executionPlan: {
        kind: "stop",
        authorized: false,
        executeWithoutTextualConfirmation: false,
        finalResponseContract: "blocked-intent-summary",
      },
      blockedRequests: ["protected-scope", "github-actions"],
      dispatchAllowed: false,
      mutationAllowed: false,
      workerDispatchAllowed: false,
    });
    expect(packet.executionPlan.steps).toEqual([]);
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
    expect(result?.details.nextAction).toBe("present-bounded-batch-decision");
    expect(result?.details.availableCapabilities).toEqual(["first-hatch", "tool-hygiene"]);
    expect(result?.content?.[0]?.text).toContain("control-plane-profile-packet: decision=ready-for-operator-decision");
    expect(result?.content?.[0]?.text).toContain("next=present-bounded-batch-decision");
    expect(result?.content?.[0]?.text).toContain("payload completo disponível em details");
    expect(result?.content?.[0]?.text).not.toContain("\"intent\"");
  });

  it("surface exposes operator_intent_intake_packet with compact text and widget-ready details", () => {
    const tools: Array<{ name: string; description?: string; execute: (id: string, params: Record<string, unknown>) => { content?: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } }> = [];
    registerGuardrailsStructuredInterviewSurface({
      registerTool(tool: unknown) {
        tools.push(tool as (typeof tools)[number]);
      },
    } as never);

    const tool = tools.find((item) => item.name === "operator_intent_intake_packet");
    expect(tool?.description).toContain("details.reportOnlyRouteAuthorized=true");
    expect(tool?.description).toContain("without textual confirmation");
    expect(tool?.description).toContain("never authorizes mutation, dispatch, or workers");
    const result = tool?.execute("tc-intake", {
      intent: "prepare worker review",
      autonomy_request: "worker-assisted",
      available_resources: ["separate-worker-quota"],
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
    expect(result?.details.recommendationCode).toBe("operator-intent-prepare-worker-packet");
    expect(result?.details.controlPlaneAction).toBe("run-report-only-route");
    expect(result?.details.nextAction).toBe("prepare-worker-packet");
    expect(result?.details.confirmationRequired).toBe(false);
    expect(result?.details.operatorDecisionNeeded).toBe(false);
    expect(result?.details.reportOnlyRouteAuthorized).toBe(true);
    expect(result?.details.operatorPromptRequired).toBe(false);
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.workerDispatchAllowed).toBe(false);
    expect(result?.details.executionPlan).toMatchObject({
      kind: "report-only-route",
      authorized: true,
      executeWithoutTextualConfirmation: true,
      finalResponseContract: "compact-decision-summary",
    });
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
    expect(result?.content?.[0]?.text).toContain("code=operator-intent-prepare-worker-packet");
    expect(result?.content?.[0]?.text).toContain("next=prepare-worker-packet");
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
    expect(result?.details.nextAction).toBe("answer-next-question");
    expect(result?.details.nextQuestion).toMatchObject({ id: "validation", kind: "single-choice" });
    expect(result?.content?.[0]?.text).toContain("structured-interview: decision=needs-operator-answer");
    expect(result?.content?.[0]?.text).toContain("nextAction=answer-next-question");
    expect(result?.content?.[0]?.text).toContain("payload completo disponível em details");
    expect(result?.content?.[0]?.text).not.toContain('\"decision\"');
  });
});
