import type { ParsedGuardrailsIntent } from "./guardrails-core-intent-bus";

export type GuardrailsIntentRuntimeDecisionKind =
  | "non-intent"
  | "invalid-envelope"
  | "board-execute-ready"
  | "board-execute-board-not-ready"
  | "board-execute-next-mismatch"
  | "board-execute-next-ready"
  | "board-execute-next-board-not-ready";

export interface GuardrailsIntentRuntimeDecision {
  action: "continue" | "reject";
  kind: GuardrailsIntentRuntimeDecisionKind;
  reason?: ParsedGuardrailsIntent["reason"];
  rawType?: string;
  taskId?: string;
  expectedTaskId?: string;
}

export interface ResolveGuardrailsIntentRuntimeDecisionInput {
  text: string;
  parsed: ParsedGuardrailsIntent;
  boardReady?: boolean;
  nextTaskId?: string;
}

function hasIntentEnvelopeHeader(text: string): boolean {
  return String(text ?? "").trim().toLowerCase().startsWith("[intent:");
}

export function resolveGuardrailsIntentRuntimeDecision(
  input: ResolveGuardrailsIntentRuntimeDecisionInput,
): GuardrailsIntentRuntimeDecision {
  if (!hasIntentEnvelopeHeader(input.text)) {
    return { action: "continue", kind: "non-intent" };
  }

  if (!input.parsed.ok || !input.parsed.intent) {
    return {
      action: "reject",
      kind: "invalid-envelope",
      reason: input.parsed.reason ?? "invalid-header",
      rawType: input.parsed.rawType,
    };
  }

  if (input.parsed.intent.type === "board.execute-task") {
    const taskId = input.parsed.intent.taskId;
    const expectedTaskId = typeof input.nextTaskId === "string" && input.nextTaskId.trim().length > 0
      ? input.nextTaskId.trim()
      : undefined;

    if (!input.boardReady) {
      return {
        action: "continue",
        kind: "board-execute-board-not-ready",
        taskId,
        expectedTaskId,
      };
    }

    if (expectedTaskId && expectedTaskId !== taskId) {
      return {
        action: "continue",
        kind: "board-execute-next-mismatch",
        taskId,
        expectedTaskId,
      };
    }

    return {
      action: "continue",
      kind: "board-execute-ready",
      taskId,
      expectedTaskId,
    };
  }

  if (input.parsed.intent.type === "board.execute-next") {
    const expectedTaskId = typeof input.nextTaskId === "string" && input.nextTaskId.trim().length > 0
      ? input.nextTaskId.trim()
      : undefined;

    if (!input.boardReady || !expectedTaskId) {
      return {
        action: "continue",
        kind: "board-execute-next-board-not-ready",
        expectedTaskId,
      };
    }

    return {
      action: "continue",
      kind: "board-execute-next-ready",
      taskId: expectedTaskId,
      expectedTaskId,
    };
  }

  return {
    action: "reject",
    kind: "invalid-envelope",
    reason: "unsupported-type",
    rawType: input.parsed.intent.type,
  };
}
