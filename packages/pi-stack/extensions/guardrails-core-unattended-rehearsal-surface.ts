import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { evaluateUnattendedRehearsalGate } from "./guardrails-core-unattended-rehearsal";

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const raw = Number(value);
  return Number.isFinite(raw) ? raw : fallback;
}

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
      const result = evaluateUnattendedRehearsalGate({
        completedLocalSlices: asNumber(p.completed_local_slices, 0),
        focusPreserved: asBool(p.focus_preserved, false),
        focalSmokeGreen: asBool(p.focal_smoke_green, false),
        smallCommits: asBool(p.small_commits, false),
        handoffFresh: asBool(p.handoff_fresh, false),
        protectedScopeAutoSelections: asNumber(p.protected_scope_auto_selections, 0),
        unresolvedBlockers: asNumber(p.unresolved_blockers, 0),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}
