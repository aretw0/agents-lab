import { Type, type TSchema } from "@sinclair/typebox";

type SchemaProps = Record<string, TSchema>;

export function buildAutonomyTaskSelectionParameters(options: {
  includeProtectedScopes?: boolean;
  includeMissingRationale?: boolean;
  sampleLimitDescription?: string;
  extra?: SchemaProps;
} = {}) {
  const props: SchemaProps = {
    milestone: Type.Optional(Type.String({ description: "Optional milestone filter." })),
  };
  if (options.includeProtectedScopes !== false) {
    props.include_protected_scopes = Type.Optional(Type.Boolean({ description: "Opt in to CI/settings/publish/.obsidian scopes. Default false." }));
  }
  if (options.includeMissingRationale !== false) {
    props.include_missing_rationale = Type.Optional(Type.Boolean({ description: "Opt in to rationale-sensitive tasks that still lack rationale evidence. Default false." }));
  }
  props.focus_task_ids = Type.Optional(Type.Array(Type.String(), { description: "Optional focus task ids; when omitted, fresh handoff current_tasks are used by default." }));
  props.use_handoff_focus = Type.Optional(Type.Boolean({ description: "Use .project/handoff.json current_tasks as focus when focus_task_ids is omitted. Default true." }));
  props.sample_limit = Type.Optional(Type.Number({ description: options.sampleLimitDescription ?? "Max eligible ids to return (1..20)." }));
  return Type.Object({ ...props, ...(options.extra ?? {}) });
}

export function buildAutonomyMaterialParameters(options: {
  includeProtectedScopes?: boolean;
  maxSeedSlices?: boolean;
  influenceMaturity?: boolean;
} = {}) {
  const extra: SchemaProps = {
    min_ready_slices: Type.Optional(Type.Number({ description: options.influenceMaturity
      ? "Minimum validated local-safe stock before considering external influence assimilation (default 3)."
      : "Minimum local-safe validated slices to continue AFK run (default 3)." })),
    target_slices: Type.Optional(Type.Number({ description: options.influenceMaturity
      ? "Target validated local-safe stock to preserve after assimilation decision (default 7)."
      : "Target local-safe validated slices to keep stocked (default 7)." })),
  };
  if (options.maxSeedSlices === true) {
    extra.max_seed_slices = Type.Optional(Type.Number({ description: "Maximum suggested slices for one explicit seeding decision (1..10, default 3)." }));
  }
  if (options.influenceMaturity === true) {
    extra.min_validation_coverage_pct = Type.Optional(Type.Number({ description: "Minimum local-safe validation maturity percentage before assimilation window opens (default 80)." }));
  }
  return buildAutonomyTaskSelectionParameters({
    includeProtectedScopes: options.includeProtectedScopes,
    extra,
  });
}

export function buildLaneBrainstormParameters(options: { includeSource?: boolean } = {}) {
  const props: SchemaProps = {
    goal: Type.Optional(Type.String({ description: "Short lane objective." })),
    ideas: Type.Optional(Type.Array(Type.Object({
      id: Type.String(),
      theme: Type.String(),
      value: Type.Optional(Type.String()),
      risk: Type.Optional(Type.String()),
      effort: Type.Optional(Type.String()),
    }))),
    max_ideas: Type.Optional(Type.Number({ description: "Max ranked ideas (1..50)." })),
    max_slices: Type.Optional(Type.Number({ description: "Max suggested slices (1..10)." })),
    milestone: Type.Optional(Type.String({ description: "Optional milestone filter." })),
    include_protected_scopes: Type.Optional(Type.Boolean({ description: "Opt in protected scopes." })),
    include_missing_rationale: Type.Optional(Type.Boolean({ description: "Opt in missing rationale tasks." })),
    focus_task_ids: Type.Optional(Type.Array(Type.String())),
    use_handoff_focus: Type.Optional(Type.Boolean()),
    sample_limit: Type.Optional(Type.Number()),
  };
  if (options.includeSource === true) {
    props.source = Type.Optional(Type.String({ description: "brainstorm | human | tangent-approved" }));
  }
  return Type.Object(props);
}
