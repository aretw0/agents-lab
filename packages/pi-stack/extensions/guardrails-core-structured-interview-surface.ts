/**
 * @capability-id runtime-guardrails
 * @capability-criticality high
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { resolveStructuredInterview, type StructuredInterviewAnswer, type StructuredInterviewQuestion } from "./guardrails-core-structured-interview";
import { buildControlPlaneProfilePacket } from "./guardrails-core-local-slice-contracts";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

function asQuestions(value: unknown): StructuredInterviewQuestion[] {
  return Array.isArray(value) ? value as StructuredInterviewQuestion[] : [];
}

function asAnswers(value: unknown): StructuredInterviewAnswer[] {
  return Array.isArray(value) ? value as StructuredInterviewAnswer[] : [];
}

export function registerGuardrailsStructuredInterviewSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "structured_interview_plan",
    label: "Structured Interview Plan",
    description: "Backend-first structured interview/form primitive for sequential operator gap filling. Read-only, UI-independent, and never authorizes dispatch.",
    parameters: Type.Object({
      questions: Type.Array(Type.Object({
        id: Type.String({ description: "Stable question id." }),
        prompt: Type.String({ description: "Question prompt for the operator." }),
        kind: Type.Optional(Type.String({ description: "text | single-choice | boolean | number. Default text." })),
        required: Type.Optional(Type.Boolean({ description: "Whether an answer is required. Default true." })),
        options: Type.Optional(Type.Array(Type.String({ description: "Allowed values for single-choice questions." }))),
        defaultValue: Type.Optional(Type.Any({ description: "Optional default answer value." })),
        allowUnknown: Type.Optional(Type.Boolean({ description: "Whether unknown is an accepted answer state." })),
        allowSkip: Type.Optional(Type.Boolean({ description: "Whether skipped is an accepted answer state." })),
      })),
      answers: Type.Optional(Type.Array(Type.Object({
        questionId: Type.String({ description: "Question id being answered." }),
        value: Type.Optional(Type.Any({ description: "Answer value." })),
        state: Type.Optional(Type.String({ description: "answered | unknown | skipped. Default inferred from value." })),
      }))),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = resolveStructuredInterview({
        questions: asQuestions(p.questions),
        answers: asAnswers(p.answers),
      });
      return buildOperatorVisibleToolResponse({
        label: "structured_interview_plan",
        summary: result.evidence,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "control_plane_profile_packet",
    label: "Control Plane Profile Packet",
    description: "Report-only discovery packet for control-plane intent, autonomy, ROI, limits, resources, and stop conditions. Never authorizes dispatch.",
    parameters: Type.Object({
      intent: Type.Optional(Type.String({ description: "Short operator/project intent for the control-plane." })),
      autonomy_request: Type.Optional(Type.String({ description: "single-slice | bounded-batch | worker-assisted | unknown" })),
      available_resources: Type.Optional(Type.Array(Type.String({ description: "Bounded resource/capability signal." }))),
      expected_roi: Type.Optional(Type.String({ description: "Expected benefit of using the control-plane capability." })),
      limits: Type.Optional(Type.Array(Type.String({ description: "Autonomy, cost, time, scope, or safety limit." }))),
      stop_conditions: Type.Optional(Type.Array(Type.String({ description: "Condition that should pause for operator decision." }))),
      operator_focus_known: Type.Optional(Type.Boolean()),
      validation_known: Type.Optional(Type.Boolean()),
      rollback_known: Type.Optional(Type.Boolean()),
      checkpoint_planned: Type.Optional(Type.Boolean()),
      protected_scope_requested: Type.Optional(Type.Boolean()),
      scheduler_requested: Type.Optional(Type.Boolean()),
      remote_or_offload_requested: Type.Optional(Type.Boolean()),
      github_actions_requested: Type.Optional(Type.Boolean()),
      worker_requested: Type.Optional(Type.Boolean()),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const packet = buildControlPlaneProfilePacket({
        intent: typeof p.intent === "string" ? p.intent : undefined,
        autonomyRequest: typeof p.autonomy_request === "string" ? p.autonomy_request : undefined,
        availableResources: Array.isArray(p.available_resources) ? p.available_resources as string[] : undefined,
        expectedRoi: typeof p.expected_roi === "string" ? p.expected_roi : undefined,
        limits: Array.isArray(p.limits) ? p.limits as string[] : undefined,
        stopConditions: Array.isArray(p.stop_conditions) ? p.stop_conditions as string[] : undefined,
        operatorFocusKnown: p.operator_focus_known === true,
        validationKnown: p.validation_known === true,
        rollbackKnown: p.rollback_known === true,
        checkpointPlanned: p.checkpoint_planned === true,
        protectedScopeRequested: p.protected_scope_requested === true,
        schedulerRequested: p.scheduler_requested === true,
        remoteOrOffloadRequested: p.remote_or_offload_requested === true,
        githubActionsRequested: p.github_actions_requested === true,
        workerRequested: p.worker_requested === true,
      });
      return buildOperatorVisibleToolResponse({
        label: "control_plane_profile_packet",
        summary: packet.summary,
        details: packet,
      });
    },
  });
}
