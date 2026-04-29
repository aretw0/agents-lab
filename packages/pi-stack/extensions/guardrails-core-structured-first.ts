export type StructuredFirstToolType = "edit" | "write";

export interface StructuredFirstMutationInput {
  toolType: StructuredFirstToolType;
  path?: string;
}

export interface StructuredFirstMutationDecision {
  block: boolean;
  reason?: string;
  auditKey?: string;
  path?: string;
  recommendedSurface?: string;
}

const PROJECT_JSON_RE = /^\.project\/[^/]+\.json$/;

function normalizeMutationPath(path: string | undefined): string | undefined {
  const normalized = String(path ?? "").trim().replace(/\\/g, "/");
  if (!normalized) return undefined;
  return normalized.replace(/^\.\//, "");
}

function recommendedStructuredSurface(path: string): string {
  if (path === ".project/tasks.json") {
    return "board_query/board_update";
  }
  if (path === ".project/verification.json") {
    return "board_query plus read-block/write-block or structured_io for verification evidence";
  }
  return "read-block/write-block or structured_io";
}

export function resolveStructuredFirstMutationDecision(
  input: StructuredFirstMutationInput,
): StructuredFirstMutationDecision {
  const path = normalizeMutationPath(input.path);
  if (!path || !PROJECT_JSON_RE.test(path)) {
    return { block: false, path };
  }

  const recommendedSurface = recommendedStructuredSurface(path);
  return {
    block: true,
    path,
    recommendedSurface,
    auditKey: "guardrails-core.structured-first-block",
    reason: `Blocked by guardrails-core (structured-first): ${input.toolType} on ${path} should use ${recommendedSurface} instead of fragile textual mutation.`,
  };
}
