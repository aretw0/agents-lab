export type StructuredInterviewQuestionKind = "text" | "single-choice" | "boolean" | "number";
export type StructuredInterviewAnswerState = "answered" | "unknown" | "skipped";
export type StructuredInterviewDecision = "complete" | "needs-human-answer" | "invalid";

export interface StructuredInterviewQuestion {
  id: string;
  prompt: string;
  kind?: StructuredInterviewQuestionKind;
  required?: boolean;
  options?: string[];
  defaultValue?: unknown;
  allowUnknown?: boolean;
  allowSkip?: boolean;
}

export interface StructuredInterviewAnswer {
  questionId: string;
  value?: unknown;
  state?: StructuredInterviewAnswerState;
}

export interface StructuredInterviewResult {
  mode: "structured-interview";
  backendFirst: true;
  uiCoupling: "none";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  decision: StructuredInterviewDecision;
  nextQuestionId?: string;
  reasons: string[];
  accepted: Array<{ questionId: string; state: StructuredInterviewAnswerState; value?: unknown; source: "answer" | "default" | "optional" }>;
  invalid: Array<{ questionId: string; reason: string }>;
  missing: string[];
  evidence: string;
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKind(value: unknown): StructuredInterviewQuestionKind {
  return value === "single-choice" || value === "boolean" || value === "number" || value === "text" ? value : "text";
}

function hasOwnValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function validateAnswerValue(question: StructuredInterviewQuestion, value: unknown): string | undefined {
  const kind = normalizeKind(question.kind);
  if (kind === "single-choice") {
    const options = Array.isArray(question.options) ? question.options.map(String) : [];
    if (options.length === 0) return "single-choice-options-missing";
    if (typeof value !== "string" || !options.includes(value)) return "single-choice-value-not-in-options";
  }
  if (kind === "boolean" && typeof value !== "boolean") return "boolean-value-required";
  if (kind === "number" && (typeof value !== "number" || Number.isNaN(value))) return "number-value-required";
  if (kind === "text" && typeof value !== "string") return "text-value-required";
  return undefined;
}

function buildEvidence(result: Omit<StructuredInterviewResult, "evidence">): string {
  const parts = [
    `structured-interview: decision=${result.decision}`,
    `backendFirst=${result.backendFirst ? "yes" : "no"}`,
    `ui=${result.uiCoupling}`,
    `dispatch=${result.dispatchAllowed ? "yes" : "no"}`,
    `accepted=${result.accepted.length}`,
    `missing=${result.missing.length}`,
    `invalid=${result.invalid.length}`,
  ];
  if (result.nextQuestionId) parts.push(`next=${result.nextQuestionId}`);
  if (result.reasons.length > 0) parts.push(`reasons=${result.reasons.join("|")}`);
  return parts.join(" ");
}

export function resolveStructuredInterview(input: {
  questions: StructuredInterviewQuestion[];
  answers?: StructuredInterviewAnswer[];
}): StructuredInterviewResult {
  const answersById = new Map<string, StructuredInterviewAnswer>();
  for (const answer of input.answers ?? []) {
    const questionId = normalizeId(answer.questionId);
    if (questionId) answersById.set(questionId, answer);
  }

  const accepted: StructuredInterviewResult["accepted"] = [];
  const invalid: StructuredInterviewResult["invalid"] = [];
  const missing: string[] = [];
  const reasons: string[] = [];
  const seenQuestionIds = new Set<string>();

  for (const rawQuestion of input.questions ?? []) {
    const questionId = normalizeId(rawQuestion.id);
    const prompt = typeof rawQuestion.prompt === "string" ? rawQuestion.prompt.trim() : "";
    if (!questionId) {
      invalid.push({ questionId: "(missing-id)", reason: "question-id-missing" });
      continue;
    }
    if (seenQuestionIds.has(questionId)) {
      invalid.push({ questionId, reason: "duplicate-question-id" });
      continue;
    }
    seenQuestionIds.add(questionId);
    if (!prompt) invalid.push({ questionId, reason: "prompt-missing" });

    const question: StructuredInterviewQuestion = { ...rawQuestion, id: questionId, prompt };
    const answer = answersById.get(questionId);
    const state = answer?.state ?? (hasOwnValue(answer?.value) ? "answered" : undefined);

    if (state === "unknown") {
      if (question.allowUnknown === true) {
        accepted.push({ questionId, state: "unknown", source: "answer" });
      } else {
        invalid.push({ questionId, reason: "unknown-not-allowed" });
      }
      continue;
    }

    if (state === "skipped") {
      if (question.allowSkip === true || question.required === false) {
        accepted.push({ questionId, state: "skipped", source: "answer" });
      } else {
        invalid.push({ questionId, reason: "skip-not-allowed" });
      }
      continue;
    }

    if (state === "answered" && hasOwnValue(answer?.value)) {
      const validationError = validateAnswerValue(question, answer?.value);
      if (validationError) {
        invalid.push({ questionId, reason: validationError });
      } else {
        accepted.push({ questionId, state: "answered", value: answer?.value, source: "answer" });
      }
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(question, "defaultValue")) {
      const validationError = validateAnswerValue(question, question.defaultValue);
      if (validationError) {
        invalid.push({ questionId, reason: `default-${validationError}` });
      } else {
        accepted.push({ questionId, state: "answered", value: question.defaultValue, source: "default" });
      }
      continue;
    }

    if (question.required === false || question.allowSkip === true) {
      accepted.push({ questionId, state: "skipped", source: "optional" });
      continue;
    }

    missing.push(questionId);
  }

  if (!Array.isArray(input.questions) || input.questions.length === 0) reasons.push("questions-missing");
  if (invalid.length > 0) reasons.push("invalid-answers");
  if (missing.length > 0) reasons.push("missing-required-answer");

  const decision: StructuredInterviewDecision = invalid.length > 0 || reasons.includes("questions-missing")
    ? "invalid"
    : missing.length > 0
      ? "needs-human-answer"
      : "complete";

  const base: Omit<StructuredInterviewResult, "evidence"> = {
    mode: "structured-interview",
    backendFirst: true,
    uiCoupling: "none",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    decision,
    nextQuestionId: decision === "needs-human-answer" ? missing[0] : undefined,
    reasons,
    accepted,
    invalid,
    missing,
  };

  return { ...base, evidence: buildEvidence(base) };
}
