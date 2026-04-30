import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  resolveNudgeFreeLoopCanaryGate,
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
        content: [{ type: "text", text: result.summary }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "nudge_free_loop_canary",
    label: "Nudge-Free Loop Canary",
    description: "Evaluate whether a local unattended loop can continue without a manual nudge. Read-only and side-effect-free.",
    parameters: Type.Object({
      opt_in: Type.Boolean({ description: "Explicit opt-in for the nudge-free loop canary." }),
      next_local_safe: Type.Boolean({ description: "Whether the next slice is local-first, small, reversible, and has a known focal gate." }),
      checkpoint_fresh: Type.Boolean({ description: "Whether handoff/checkpoint evidence is fresh enough for resume." }),
      handoff_budget_ok: Type.Boolean({ description: "Whether the handoff checkpoint is within the bounded budget." }),
      git_state_expected: Type.Boolean({ description: "Whether the git state matches the expected local-safe scope." }),
      protected_scopes_clear: Type.Boolean({ description: "Whether protected scopes are absent from the next slice." }),
      cooldown_ready: Type.Boolean({ description: "Whether the loop cooldown allows another autonomous slice." }),
      validation_known: Type.Boolean({ description: "Whether the next slice has a known bounded validation gate." }),
      stop_conditions_clear: Type.Boolean({ description: "Whether no real stop condition is present." }),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = resolveNudgeFreeLoopCanaryGate({
        optIn: asBool(p.opt_in, false),
        nextLocalSafe: asBool(p.next_local_safe, false),
        checkpointFresh: asBool(p.checkpoint_fresh, false),
        handoffBudgetOk: asBool(p.handoff_budget_ok, false),
        gitStateExpected: asBool(p.git_state_expected, false),
        protectedScopesClear: asBool(p.protected_scopes_clear, false),
        cooldownReady: asBool(p.cooldown_ready, false),
        validationKnown: asBool(p.validation_known, false),
        stopConditionsClear: asBool(p.stop_conditions_clear, false),
      });
      return {
        content: [{ type: "text", text: result.summary }],
        details: result,
      };
    },
  });
}
