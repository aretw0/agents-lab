import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { resolveStructuredInterview, type StructuredInterviewAnswer, type StructuredInterviewQuestion } from "./guardrails-core-structured-interview";

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
    description: "Backend-first structured interview/form primitive for sequential human gap filling. Read-only, UI-independent, and never authorizes dispatch.",
    parameters: Type.Object({
      questions: Type.Array(Type.Object({
        id: Type.String({ description: "Stable question id." }),
        prompt: Type.String({ description: "Question prompt for the human/operator." }),
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
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}
