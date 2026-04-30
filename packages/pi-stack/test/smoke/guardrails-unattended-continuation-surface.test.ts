import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerGuardrailsUnattendedContinuationSurface } from "../../extensions/guardrails-core-unattended-continuation-surface";

type RegisteredTool = {
  name: string;
  parameters?: unknown;
  execute: (toolCallId: string, params: Record<string, unknown>, signal?: unknown, onUpdate?: unknown, context?: { cwd?: string }) => {
    content?: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  };
};

describe("guardrails unattended continuation surface", () => {
  it("registers read-only local continuity audit tool that fails closed from local facts", () => {
    const cwd = mkdtempSync(join(tmpdir(), "local-continuity-audit-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
        timestamp: "2026-04-30T04:40:00.000Z",
        current_tasks: ["TASK-SURFACE"],
        blockers: [],
      }));
      writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [{
        id: "TASK-SURFACE",
        status: "in-progress",
        description: "Local audit surface smoke",
        files: ["packages/pi-stack/extensions/foo.ts"],
        acceptance_criteria: ["Smoke principal permanece verde."],
      }] }));
      const tools: RegisteredTool[] = [];
      registerGuardrailsUnattendedContinuationSurface({
        registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
      } as never);

      const auditTool = tools.find((tool) => tool.name === "local_continuity_audit");
      const schemaText = JSON.stringify(auditTool?.parameters ?? {});
      expect(schemaText).not.toContain("signal_source");
      expect(schemaText).not.toContain("signalSource");
      expect(schemaText).not.toContain("measuredEvidence");
      const result = auditTool?.execute("call-audit", {}, undefined, undefined, { cwd });

      expect(result?.content?.[0]?.text).toContain("nudge-free-local-audit-prep: eligible=no collectors=8/8");
      expect(result?.content?.[0]?.text).toContain("authorization=none");
      expect(result?.details).toMatchObject({
        effect: "none",
        mode: "advisory",
        activation: "none",
        authorization: "none",
        envelope: {
          effect: "none",
          mode: "advisory",
          activation: "none",
          authorization: "none",
          eligibleForAuditedRuntimeSurface: false,
        },
      });
      expect(result?.details.envelope).toBeTruthy();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("registers read-only continuation plan tool", () => {
    const tools: RegisteredTool[] = [];
    registerGuardrailsUnattendedContinuationSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const planTool = tools.find((tool) => tool.name === "unattended_continuation_plan");
    const result = planTool?.execute("call-test", {
      next_local_safe: true,
      protected_scope: false,
      risk: false,
      ambiguous: false,
      progress_saved: true,
      context_level: "checkpoint",
    });

    expect(result?.content?.[0]?.text).toBe("unattended-continuation: decision=continue-local continue=yes reasons=local-safe-next-step,checkpoint-progress-saved");
    expect(result?.details.canContinue).toBe(true);
    expect(result?.details.decision).toBe("continue-local");
    expect(result?.details.summary).toBe("unattended-continuation: decision=continue-local continue=yes reasons=local-safe-next-step,checkpoint-progress-saved");
  });

  it("registers compact read-only nudge-free loop canary tool", () => {
    const tools: RegisteredTool[] = [];
    registerGuardrailsUnattendedContinuationSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const canaryTool = tools.find((tool) => tool.name === "nudge_free_loop_canary");
    const schemaText = JSON.stringify(canaryTool?.parameters ?? {});
    expect(schemaText).not.toContain("signal_source");
    expect(schemaText).not.toContain("signalSource");
    const manual = canaryTool?.execute("call-manual", {
      opt_in: true,
      next_local_safe: true,
      checkpoint_fresh: true,
      handoff_budget_ok: true,
      git_state_expected: true,
      protected_scopes_clear: true,
      cooldown_ready: true,
      validation_known: true,
      stop_conditions_clear: true,
    });
    const blocked = canaryTool?.execute("call-blocked", {
      opt_in: true,
      next_local_safe: true,
      checkpoint_fresh: true,
      handoff_budget_ok: true,
      git_state_expected: false,
      protected_scopes_clear: false,
      cooldown_ready: true,
      validation_known: true,
      stop_conditions_clear: false,
    });

    expect(manual?.content?.[0]?.text).toBe("nudge-free-loop: effect=none decision=defer continue=no reasons=manual-signal-source");
    expect(manual?.details).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "manual",
      canContinueWithoutNudge: false,
    });
    expect(blocked?.content?.[0]?.text).toBe("nudge-free-loop: effect=none decision=blocked continue=no reasons=manual-signal-source,unexpected-git-state,protected-scope-pending,stop-condition-present");
    expect(blocked?.details).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "manual",
      canContinueWithoutNudge: false,
    });
  });
});
