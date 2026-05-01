export type ProjectIntakeProfile = "light-notes" | "app-medium" | "monorepo-heavy";

export const INTAKE_PLAN_FIRST_SLICE_CODE = "intake-plan-first-slice";
export const INTAKE_NEEDS_HUMAN_FOCUS_PROTECTED_CODE = "intake-needs-human-focus-protected";

export interface ProjectIntakeInput {
  dominantArtifacts?: string[];
  hasBuildFiles?: boolean;
  hasTests?: boolean;
  hasCi?: boolean;
  repositoryScale?: "small" | "medium" | "large" | string;
  protectedScopeRequested?: boolean;
}

export interface ProjectIntakePlan {
  decision: "ready-for-human-review" | "blocked";
  profile: ProjectIntakeProfile;
  recommendationCode: typeof INTAKE_PLAN_FIRST_SLICE_CODE | typeof INTAKE_NEEDS_HUMAN_FOCUS_PROTECTED_CODE;
  nextAction: string;
  firstSlice: {
    title: string;
    validation: string;
    rollback: string;
  };
  rationale: string;
  dispatchAllowed: false;
  mutationAllowed: false;
  authorization: "none";
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

export function evaluateProjectIntakePlan(raw: ProjectIntakeInput): ProjectIntakePlan {
  const input = raw ?? {};
  const profile = resolveProfile(input);

  if (input.protectedScopeRequested === true) {
    return {
      decision: "blocked",
      profile,
      recommendationCode: INTAKE_NEEDS_HUMAN_FOCUS_PROTECTED_CODE,
      nextAction: "protected scope requested; keep intake report-only and ask explicit human focus before escalation.",
      firstSlice: {
        title: "collect minimal local project facts",
        validation: "read-only intake summary is recorded",
        rollback: "none (report-only)",
      },
      rationale: "protected scope cannot be auto-selected during intake.",
      dispatchAllowed: false,
      mutationAllowed: false,
      authorization: "none",
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
    decision: "ready-for-human-review",
    profile,
    recommendationCode: INTAKE_PLAN_FIRST_SLICE_CODE,
    nextAction: "review profile, confirm first local-safe slice, then execute with focal validation and rollback clarity.",
    firstSlice: {
      title: firstSliceByProfile[profile].title,
      validation: firstSliceByProfile[profile].validation,
      rollback: "git revert commit",
    },
    rationale: "intake stays deterministic and report-only to preserve control and low token cost.",
    dispatchAllowed: false,
    mutationAllowed: false,
    authorization: "none",
    mode: "report-only",
  };
}
