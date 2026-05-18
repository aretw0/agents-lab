import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { asBooleanWithDefault, asNumberWithDefault } from "./guardrails-core-param-normalizers";
import { evaluateUnattendedRehearsalGate, summarizeUnattendedRehearsalGate } from "./guardrails-core-unattended-rehearsal";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

export function registerGuardrailsUnattendedRehearsalSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "unattended_rehearsal_gate",
    label: "Unattended Rehearsal Gate",
    description: "Evaluate local-first unattended-loop maturity before remote/offload canaries. Read-only and side-effect-free.",
    parameters: Type.Object({
      completed_local_slices: Type.Number({ description: "Completed clean local slices in the rehearsal." }),
      focus_preserved: Type.Boolean({ description: "Whether focus stayed aligned across slices." }),
      focal_smoke_green: Type.Boolean({ description: "Whether focal smoke/tests were green." }),
      small_commits: Type.Boolean({ description: "Whether commits stayed small and intentional." }),
      handoff_fresh: Type.Boolean({ description: "Whether handoff/checkpoint evidence is fresh." }),
      protected_scope_auto_selections: Type.Optional(Type.Number({ description: "Count of automatic protected-scope selections." })),
      unresolved_blockers: Type.Optional(Type.Number({ description: "Count of unresolved blockers." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const gate = evaluateUnattendedRehearsalGate({
        completedLocalSlices: asNumberWithDefault(p.completed_local_slices, 0),
        focusPreserved: asBooleanWithDefault(p.focus_preserved, false),
        focalSmokeGreen: asBooleanWithDefault(p.focal_smoke_green, false),
        smallCommits: asBooleanWithDefault(p.small_commits, false),
        handoffFresh: asBooleanWithDefault(p.handoff_fresh, false),
        protectedScopeAutoSelections: asNumberWithDefault(p.protected_scope_auto_selections, 0),
        unresolvedBlockers: asNumberWithDefault(p.unresolved_blockers, 0),
      });
      const result = { ...gate, summary: summarizeUnattendedRehearsalGate(gate) };
      return buildOperatorVisibleToolResponse({
        label: "unattended_rehearsal_gate",
        summary: result.summary,
        details: result,
      });
    },
  });
}
