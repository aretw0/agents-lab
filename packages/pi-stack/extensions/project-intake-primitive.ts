import {
  GUARDRAILS_AUTHORIZATION_NONE,
  type GuardrailsAuthorizationNone,
} from "./guardrails-core-authorization";
import {
  classifyToolHygiene,
  type ToolHygieneInputTool,
  type ToolHygieneMaturity,
} from "./guardrails-core-tool-hygiene";

export type ProjectIntakeProfile = "light-notes" | "app-medium" | "monorepo-heavy";

export const INTAKE_PLAN_FIRST_SLICE_CODE = "intake-plan-first-slice";
export const INTAKE_NEEDS_OPERATOR_FOCUS_PROTECTED_CODE = "intake-needs-operator-focus-protected";
export type ProjectIntakeNextActionCode = "choose-local-safe-first-slice" | "request-protected-scope-focus";

export interface ProjectIntakeInput {
  dominantArtifacts?: string[];
  hasBuildFiles?: boolean;
  hasTests?: boolean;
  hasCi?: boolean;
  repositoryScale?: "small" | "medium" | "large" | string;
  protectedScopeRequested?: boolean;
}

export interface ProjectIntakePlan {
  decision: "ready-for-operator-decision" | "blocked";
  profile: ProjectIntakeProfile;
  recommendationCode: typeof INTAKE_PLAN_FIRST_SLICE_CODE | typeof INTAKE_NEEDS_OPERATOR_FOCUS_PROTECTED_CODE;
  nextActionCode: ProjectIntakeNextActionCode;
  nextAction: string;
  firstSlice: {
    title: string;
    validation: string;
    rollback: string;
  };
  rationale: string;
  dispatchAllowed: false;
  mutationAllowed: false;
  authorization: GuardrailsAuthorizationNone;
  mode: "report-only";
}

function normalizeArtifacts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function resolveProfile(input: ProjectIntakeInput): ProjectIntakeProfile {
  const artifacts = normalizeArtifacts(input.dominantArtifacts);
  const scale = input.repositoryScale === "large" || input.repositoryScale === "medium" || input.repositoryScale === "small"
    ? input.repositoryScale
    : "medium";

  const notesLike = artifacts.includes("markdown") || artifacts.includes("text") || artifacts.includes("obsidian");
  const heavyLang = artifacts.includes("java") || artifacts.includes("kotlin") || artifacts.includes("go");

  if (notesLike && input.hasBuildFiles !== true) return "light-notes";
  if (scale === "large" || heavyLang || (input.hasCi === true && input.hasBuildFiles === true)) return "monorepo-heavy";
  return "app-medium";
}

export const FIRST_HATCH_READY_CODE = "first-hatch-ready-local-safe";
export const FIRST_HATCH_EMPTY_WORKSPACE_CODE = "first-hatch-empty-workspace-interview";
export const FIRST_HATCH_SANDBOX_BLOCKED_CODE = "first-hatch-sandbox-blocked";
export const FIRST_HATCH_PROTECTED_SCOPE_CODE = "first-hatch-protected-scope";
export type FirstHatchNextActionCode =
  | "choose-local-safe-first-slice"
  | "ask-workspace-intent-questions"
  | "stay-read-only-or-adjust-sandbox"
  | "request-protected-scope-focus";

export interface FirstHatchIntakeInput {
  workspaceName?: string;
  topLevelEntries?: string[];
  dominantArtifacts?: string[];
  packageManagers?: string[];
  availableTools?: ToolHygieneInputTool[];
  capabilitySignals?: string[];
  hasGit?: boolean;
  hasProjectBoard?: boolean;
  hasTests?: boolean;
  hasCi?: boolean;
  sandboxMode?: "workspace-write" | "read-only" | "restricted" | "unknown" | string;
  sandboxWriteBlocked?: boolean;
  protectedScopeRequested?: boolean;
}

export interface FirstHatchIntakePacket {
  decision: "ready-for-operator-decision" | "blocked";
  recommendationCode:
    | typeof FIRST_HATCH_READY_CODE
    | typeof FIRST_HATCH_EMPTY_WORKSPACE_CODE
    | typeof FIRST_HATCH_SANDBOX_BLOCKED_CODE
    | typeof FIRST_HATCH_PROTECTED_SCOPE_CODE;
  workspace: {
    name: string;
    empty: boolean;
    hasGit: boolean;
    hasProjectBoard: boolean;
    artifactKinds: string[];
    packageManagers: string[];
  };
  sandbox: {
    mode: string;
    writeBlocked: boolean;
    localSafeMutationPossible: boolean;
  };
  capabilityInventory: {
    availableTools: number;
    safeForLocalLoop: number;
    needsMeasuredEvidence: number;
    requiresOperatorApproval: number;
    hideBeforeLongLoop: number;
    capabilitySignals: string[];
    recommendedToolNames: string[];
    gaps: string[];
  };
  missingQuestions: string[];
  nextActionCode: FirstHatchNextActionCode;
  nextAction: string;
  dispatchAllowed: false;
  mutationAllowed: false;
  authorization: GuardrailsAuthorizationNone;
  mode: "report-only";
}

function boundedList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized.slice(0, 48));
    if (out.length >= maxItems) break;
  }
  return out;
}

function boundedTools(value: unknown, maxItems: number): ToolHygieneInputTool[] {
  if (!Array.isArray(value)) return [];
  const out: ToolHygieneInputTool[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string") continue;
    const name = record.name.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: name.slice(0, 80),
      description: typeof record.description === "string" ? record.description.slice(0, 240) : undefined,
    });
    if (out.length >= maxItems) break;
  }
  return out;
}

function buildCapabilityInventory(input: {
  tools: ToolHygieneInputTool[];
  capabilitySignals: string[];
  hasTests: boolean;
  hasCi: boolean;
  writeBlocked: boolean;
  protectedScopeRequested: boolean;
}): FirstHatchIntakePacket["capabilityInventory"] {
  const rows = input.tools.map(classifyToolHygiene);
  const countByMaturity = (maturity: ToolHygieneMaturity) => rows.filter((row) => row.maturity === maturity).length;
  const recommendedToolNames = rows
    .filter((row) => row.maturity === "safe-for-local-loop")
    .map((row) => row.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 5);
  const gaps: string[] = [];

  if (rows.length === 0) gaps.push("available-tools-not-reported");
  if (recommendedToolNames.length === 0) gaps.push("no-safe-local-loop-tool-reported");
  if (!input.hasTests) gaps.push("focal-validation-tool-unknown");
  if (!input.hasCi) gaps.push("ci-signal-unknown");
  if (input.writeBlocked) gaps.push("sandbox-write-blocked");
  if (input.protectedScopeRequested) gaps.push("protected-scope-needs-explicit-authorization");

  return {
    availableTools: rows.length,
    safeForLocalLoop: countByMaturity("safe-for-local-loop"),
    needsMeasuredEvidence: countByMaturity("needs-measured-evidence"),
    requiresOperatorApproval: countByMaturity("requires-operator-approval"),
    hideBeforeLongLoop: countByMaturity("hide-before-long-loop"),
    capabilitySignals: input.capabilitySignals,
    recommendedToolNames,
    gaps: gaps.slice(0, 6),
  };
}

export function buildFirstHatchIntakePacket(raw: FirstHatchIntakeInput): FirstHatchIntakePacket {
  const input = raw ?? {};
  const topLevelEntries = boundedList(input.topLevelEntries, 12);
  const artifactKinds = boundedList(input.dominantArtifacts, 8);
  const packageManagers = boundedList(input.packageManagers, 4);
  const availableTools = boundedTools(input.availableTools, 40);
  const capabilitySignals = boundedList(input.capabilitySignals, 12);
  const workspaceName = typeof input.workspaceName === "string" && input.workspaceName.trim()
    ? input.workspaceName.trim().slice(0, 64)
    : "workspace";
  const sandboxMode = typeof input.sandboxMode === "string" && input.sandboxMode.trim()
    ? input.sandboxMode.trim().slice(0, 48)
    : "unknown";
  const empty = topLevelEntries.length === 0 && artifactKinds.length === 0 && input.hasGit !== true;
  const writeBlocked = input.sandboxWriteBlocked === true || sandboxMode === "read-only" || sandboxMode === "restricted";
  const capabilityInventory = buildCapabilityInventory({
    tools: availableTools,
    capabilitySignals,
    hasTests: input.hasTests === true,
    hasCi: input.hasCi === true,
    writeBlocked,
    protectedScopeRequested: input.protectedScopeRequested === true,
  });

  let recommendationCode: FirstHatchIntakePacket["recommendationCode"] = FIRST_HATCH_READY_CODE;
  let decision: FirstHatchIntakePacket["decision"] = "ready-for-operator-decision";
  let nextActionCode: FirstHatchNextActionCode = "choose-local-safe-first-slice";
  let nextAction = "choose one local-safe first slice with focal validation and rollback clarity.";
  const missingQuestions: string[] = [];

  if (input.protectedScopeRequested === true) {
    decision = "blocked";
    recommendationCode = FIRST_HATCH_PROTECTED_SCOPE_CODE;
    nextActionCode = "request-protected-scope-focus";
    nextAction = "ask explicit operator focus before touching protected scope.";
    missingQuestions.push("Which protected scope is authorized, and what exact action is allowed?");
  } else if (writeBlocked) {
    decision = "blocked";
    recommendationCode = FIRST_HATCH_SANDBOX_BLOCKED_CODE;
    nextActionCode = "stay-read-only-or-adjust-sandbox";
    nextAction = "keep discovery read-only or ask operator to adjust sandbox before mutation.";
    missingQuestions.push("Should this session stay read-only, or may the sandbox be adjusted for local-safe edits?");
  } else if (empty) {
    recommendationCode = FIRST_HATCH_EMPTY_WORKSPACE_CODE;
    nextActionCode = "ask-workspace-intent-questions";
    nextAction = "ask two short workspace-intent questions before creating files.";
    missingQuestions.push("What should this workspace become?", "What is the first useful artifact to create?");
  }

  if (!input.hasTests && decision !== "blocked") missingQuestions.push("What focal validation should prove the first slice?");
  if (!input.hasProjectBoard && decision !== "blocked") missingQuestions.push("Should a lightweight board/checklist be created or should work stay ad hoc?");

  return {
    decision,
    recommendationCode,
    workspace: {
      name: workspaceName,
      empty,
      hasGit: input.hasGit === true,
      hasProjectBoard: input.hasProjectBoard === true,
      artifactKinds,
      packageManagers,
    },
    sandbox: {
      mode: sandboxMode,
      writeBlocked,
      localSafeMutationPossible: !writeBlocked && decision !== "blocked",
    },
    capabilityInventory,
    missingQuestions: missingQuestions.slice(0, 3),
    nextActionCode,
    nextAction,
    dispatchAllowed: false,
    mutationAllowed: false,
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    mode: "report-only",
  };
}

export function evaluateProjectIntakePlan(raw: ProjectIntakeInput): ProjectIntakePlan {
  const input = raw ?? {};
  const profile = resolveProfile(input);

  if (input.protectedScopeRequested === true) {
    return {
      decision: "blocked",
      profile,
      recommendationCode: INTAKE_NEEDS_OPERATOR_FOCUS_PROTECTED_CODE,
      nextActionCode: "request-protected-scope-focus",
      nextAction: "protected scope requested; keep intake report-only and ask explicit operator focus before escalation.",
      firstSlice: {
        title: "collect minimal local project facts",
        validation: "read-only intake summary is recorded",
        rollback: "none (report-only)",
      },
      rationale: "protected scope cannot be auto-selected during intake.",
      dispatchAllowed: false,
      mutationAllowed: false,
      authorization: GUARDRAILS_AUTHORIZATION_NONE,
      mode: "report-only",
    };
  }

  const firstSliceByProfile: Record<ProjectIntakeProfile, { title: string; validation: string }> = {
    "light-notes": {
      title: "map top folders and define one low-friction improvement",
      validation: "one bounded local check (marker or read) passes",
    },
    "app-medium": {
      title: "identify focal test command and constrain first file scope",
      validation: "focal smoke/test command is known and runnable",
    },
    "monorepo-heavy": {
      title: "isolate one module/package and select a single reversible micro-slice",
      validation: "module-local gate is defined before edits",
    },
  };

  return {
    decision: "ready-for-operator-decision",
    profile,
    recommendationCode: INTAKE_PLAN_FIRST_SLICE_CODE,
    nextActionCode: "choose-local-safe-first-slice",
    nextAction: "choose first local-safe slice from this profile, then execute with focal validation and rollback clarity.",
    firstSlice: {
      title: firstSliceByProfile[profile].title,
      validation: firstSliceByProfile[profile].validation,
      rollback: "git revert commit",
    },
    rationale: "intake stays deterministic and report-only to preserve control and low token cost.",
    dispatchAllowed: false,
    mutationAllowed: false,
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    mode: "report-only",
  };
}
