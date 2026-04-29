import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  resolveUnattendedContinuationPlan,
  type UnattendedContinuationContextLevel,
} from "./guardrails-core-unattended-continuation";

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeContextLevel(value: unknown): UnattendedContinuationContextLevel {
  return value === "warn" || value === "checkpoint" || value === "compact" || value === "ok" ? value : "ok";
}

export function registerGuardrailsUnattendedContinuationSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "unattended_continuation_plan",
    label: "Unattended Continuation Plan",
    description: "Decide whether an unattended loop should continue a local-safe slice, checkpoint, pause, ask, or block. Read-only and side-effect-free.",
    parameters: Type.Object({
      next_local_safe: Type.Boolean({ description: "Whether the next step is local-first, small, reversible, and has a known focal gate." }),
      protected_scope: Type.Boolean({ description: "Whether the next step touches protected scopes such as CI, remote execution, publish, settings, .obsidian, external research, or destructive maintenance." }),
      risk: Type.Boolean({ description: "Whether the next step has data-loss, security, cost, or irreversible risk." }),
      ambiguous: Type.Boolean({ description: "Whether the next step requires a real operator/product decision." }),
      progress_saved: Type.Boolean({ description: "Whether handoff/checkpoint evidence is already fresh enough for resume." }),
      context_level: Type.Optional(Type.String({ description: "ok | warn | checkpoint | compact" })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = resolveUnattendedContinuationPlan({
        nextLocalSafe: asBool(p.next_local_safe, false),
        protectedScope: asBool(p.protected_scope, false),
        risk: asBool(p.risk, false),
        ambiguous: asBool(p.ambiguous, false),
        progressSaved: asBool(p.progress_saved, false),
        contextLevel: normalizeContextLevel(p.context_level),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}
