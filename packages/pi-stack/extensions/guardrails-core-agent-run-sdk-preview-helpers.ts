import type {
  AgentRunSdkFileContract,
  AgentRunSdkInProcessPacketResult,
  AgentRunSdkSessionMode,
} from "./guardrails-core-agent-run-sdk-preview";

export const SDK_TIMEOUT_MIN_MS = 5_000;
export const SDK_TIMEOUT_MAX_MS = 180_000;
export const SDK_CACHE_PACK_SUMMARY_MAX_CHARS = 600;
export const SDK_CACHE_PACK_EVIDENCE_MAX_CHARS = 300;
export const SDK_SHARED_EVIDENCE_MAX_ITEMS = 20;
export const SDK_SHARED_EVIDENCE_MAX_CHARS = 300;

export function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
}

export function normalizePositiveInt(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

export function normalizeSessionMode(value: unknown): AgentRunSdkSessionMode {
  const text = normalizeText(value);
  if (text === "in-memory" || text === "run-session-dir") return text;
  return "unknown";
}

export function normalizeFileContract(value: unknown): AgentRunSdkFileContract {
  const text = normalizeText(value);
  if (text === "read-only" || text === "mutation") return text;
  return "unknown";
}

function isCodeReviewGoal(goal: string): boolean {
  const lower = goal.toLowerCase();
  return lower.includes("code/test review")
    || lower.includes("code review")
    || lower.includes("recommended patch")
    || lower.includes("parent-side patch");
}

function hasOneFileOrSymbolCue(goal: string): boolean {
  const lower = goal.toLowerCase();
  return lower.includes("one target file")
    || lower.includes("one named symbol")
    || lower.includes("one-symbol")
    || lower.includes("focus only")
    || lower.includes("readynextactions")
    || lower.includes("buildsdkmaturity");
}

export function buildSdkMaturity(input: {
  blocked: boolean;
  goal: string;
  declaredFiles: string[];
  toolAllowlist: string[];
  fileContract: AgentRunSdkFileContract;
}): AgentRunSdkInProcessPacketResult["sdkMaturity"] {
  const scope = input.declaredFiles.length === 0 ? "none" : input.declaredFiles.length <= 2 ? "narrow" : "broad";
  const toolsWithinValidatedEnvelope = input.toolAllowlist.length > 0 && input.toolAllowlist.every((tool) => tool === "read" || tool === "grep");
  const mutationToolsWithinValidatedEnvelope = input.toolAllowlist.length > 0
    && input.toolAllowlist.some((tool) => tool === "write" || tool === "edit")
    && input.toolAllowlist.every((tool) => tool === "read" || tool === "write" || tool === "edit");
  const base = {
    scope,
    maxDeclaredFilesValidated: 2,
    supportedToolsValidated: ["read", "grep"],
  } as const;
  const mutationBase = {
    scope,
    maxDeclaredFilesValidated: 1,
    supportedToolsValidated: ["read", "write", "edit"],
  } as const;
  if (input.blocked) {
    return {
      ...base,
      rung: "blocked",
      validatedEnvelope: false,
      recommendation: "resolve packet blockers before using SDK maturity evidence",
    };
  }
  if (input.fileContract === "mutation") {
    if (input.declaredFiles.length === 1 && mutationToolsWithinValidatedEnvelope) {
      return {
        ...mutationBase,
        rung: "validated-one-file-mutation",
        validatedEnvelope: true,
        recommendation: "ready for structured operator approval under the validated one-file SDK mutation envelope: one declared file, read plus write/edit only, parent-side follow/outcome validation, and no fan-out",
      };
    }
    return {
      ...mutationBase,
      rung: "needs-evidence-mutation",
      validatedEnvelope: false,
      recommendation: "keep multi-file, broad, or tool-expanded mutation SDK workers behind separate validation, rollback, and exact-confirmation evidence",
    };
  }
  if (input.fileContract === "read-only" && scope === "narrow" && toolsWithinValidatedEnvelope) {
    if (input.declaredFiles.length > 1 && isCodeReviewGoal(input.goal) && !hasOneFileOrSymbolCue(input.goal)) {
      return {
        ...base,
        rung: "needs-evidence-code-review",
        validatedEnvelope: false,
        recommendation: "two-file open-ended code/test review is not validated; shrink to one target file or one named symbol before retrying",
      };
    }
    return {
      ...base,
      rung: "validated-narrow-readgrep",
      validatedEnvelope: true,
      recommendation: "ready for structured operator approval under the validated one/two-file read/grep envelope, including real board-question checks, narrow cited synthesis, and one-file/named-symbol code review",
    };
  }
  return {
    ...base,
    rung: "needs-evidence-broad-readonly",
    validatedEnvelope: false,
    recommendation: "shrink to one or two declared files with read/grep, or treat this as a new evidence rung",
  };
}
