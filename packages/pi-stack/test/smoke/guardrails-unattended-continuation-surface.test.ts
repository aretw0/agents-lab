import { execFileSync } from "node:child_process";
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

      expect(result?.content?.[0]?.text).toContain("local-continuity-audit: eligible=no collectors=8/8");
      expect(result?.content?.[0]?.text).toContain("reasons=");
      expect(result?.content?.[0]?.text).toContain("authorization=none");
      expect(result?.details).toMatchObject({
        effect: "none",
        mode: "advisory",
        activation: "none",
        authorization: "none",
        localContinuitySummary: expect.stringContaining("local-continuity-audit: eligible=no collectors=8/8"),
        localContinuityReasons: expect.any(Array),
        summary: expect.stringContaining("nudge-free-local-audit-prep: eligible=no collectors=8/8"),
        envelope: {
          effect: "none",
          mode: "advisory",
          activation: "none",
          authorization: "none",
          eligibleForAuditedRuntimeSurface: false,
        },
      });
      expect(result?.details.envelope).toBeTruthy();
      const reasons = result?.details.localContinuityReasons as string[];
      expect(reasons.length).toBeLessThanOrEqual(5);
      expect(reasons).not.toContain("measured-evidence-incomplete");
      expect(reasons).toContain("git-state:invalid");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("treats canonical project bookkeeping as expected audit paths", () => {
    const cwd = mkdtempSync(join(tmpdir(), "local-continuity-bookkeeping-"));
    try {
      execFileSync("git", ["init"], { cwd, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "Test User"], { cwd, stdio: "ignore" });
      mkdirSync(join(cwd, ".project"), { recursive: true });
      mkdirSync(join(cwd, "packages", "pi-stack", "extensions"), { recursive: true });
      writeFileSync(join(cwd, "packages", "pi-stack", "extensions", "foo.ts"), "export const foo = 1;\n");
      writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
        timestamp: "2026-04-30T04:40:00.000Z",
        current_tasks: ["TASK-SURFACE"],
        blockers: [],
      }));
      writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [{
        id: "TASK-SURFACE",
        status: "in-progress",
        description: "Marker based local audit surface smoke",
        files: ["packages/pi-stack/extensions/foo.ts"],
        acceptance_criteria: ["Use marker validation."],
      }] }));
      writeFileSync(join(cwd, ".project", "verification.json"), JSON.stringify({ verification: [] }));
      execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], { cwd, stdio: "ignore" });
      writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [{
        id: "TASK-SURFACE",
        status: "in-progress",
        description: "Marker based local audit surface smoke",
        files: ["packages/pi-stack/extensions/foo.ts"],
        acceptance_criteria: ["Use marker validation."],
        notes: "bookkeeping changed",
      }] }));
      writeFileSync(join(cwd, ".project", "verification.json"), JSON.stringify({ verification: [{ id: "VER-SURFACE" }] }));
      writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
        timestamp: new Date().toISOString(),
        current_tasks: ["TASK-SURFACE"],
        blockers: [],
      }));

      const tools: RegisteredTool[] = [];
      registerGuardrailsUnattendedContinuationSurface({
        registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
      } as never);
      const auditTool = tools.find((tool) => tool.name === "local_continuity_audit");
      const result = auditTool?.execute("call-audit", {}, undefined, undefined, { cwd });
      const collectorResults = result?.details.collectorResults as Array<{ fact: string; status: string; evidence: string }>;
      const gitState = collectorResults.find((entry) => entry.fact === "git-state");

      expect(gitState).toEqual({
        fact: "git-state",
        status: "observed",
        evidence: "git=expected changed=3",
      });
      expect(result?.content?.[0]?.text).toContain("local-continuity-audit:");
      expect(result?.content?.[0]?.text).toContain("authorization=none");
      expect(result?.content?.[0]?.text).not.toContain("git-state:invalid");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("surfaces protected drift paths as read-only audit evidence", () => {
    const cwd = mkdtempSync(join(tmpdir(), "local-continuity-protected-paths-"));
    try {
      execFileSync("git", ["init"], { cwd, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "Test User"], { cwd, stdio: "ignore" });
      mkdirSync(join(cwd, ".project"), { recursive: true });
      mkdirSync(join(cwd, ".pi"), { recursive: true });
      mkdirSync(join(cwd, "packages", "pi-stack", "extensions"), { recursive: true });
      writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ piStack: { baseline: true } }));
      writeFileSync(join(cwd, "packages", "pi-stack", "extensions", "foo.ts"), "export const foo = 1;\n");
      writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({ timestamp: new Date().toISOString(), current_tasks: ["TASK-SURFACE"], blockers: [] }));
      writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [{
        id: "TASK-SURFACE",
        status: "in-progress",
        description: "Protected drift evidence smoke",
        files: ["packages/pi-stack/extensions/foo.ts"],
        acceptance_criteria: ["Smoke principal permanece verde."],
      }] }));
      execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], { cwd, stdio: "ignore" });
      writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ piStack: { baseline: false } }));

      const tools: RegisteredTool[] = [];
      registerGuardrailsUnattendedContinuationSurface({
        registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
      } as never);
      const auditTool = tools.find((tool) => tool.name === "local_continuity_audit");
      const result = auditTool?.execute("call-audit", {}, undefined, undefined, { cwd });

      expect(result?.content?.[0]?.text).toContain("protected=.pi/settings.json");
      expect(result?.details.protectedPaths).toEqual([".pi/settings.json"]);
      expect(result?.details.authorization).toBe("none");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("ignores completed handoff task when deriving local continuity candidate", () => {
    const cwd = mkdtempSync(join(tmpdir(), "local-continuity-stale-task-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
        timestamp: "2026-04-30T04:40:00.000Z",
        current_tasks: ["TASK-DONE"],
        blockers: [],
      }));
      writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [
        {
          id: "TASK-DONE",
          status: "completed",
          description: "Completed stale handoff task",
          files: [".github/workflows/ci.yml"],
          acceptance_criteria: ["Done."],
        },
        {
          id: "TASK-PLANNED",
          status: "planned",
          description: "Marker based local follow-up",
          files: ["packages/pi-stack/extensions/foo.ts"],
          acceptance_criteria: ["Use marker validation."],
        },
      ] }));
      const tools: RegisteredTool[] = [];
      registerGuardrailsUnattendedContinuationSurface({
        registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
      } as never);

      const auditTool = tools.find((tool) => tool.name === "local_continuity_audit");
      const result = auditTool?.execute("call-audit", {}, undefined, undefined, { cwd });
      const collectorResults = result?.details.collectorResults as Array<{ fact: string; status: string; evidence: string }>;
      const candidate = collectorResults.find((entry) => entry.fact === "candidate");

      expect(candidate).toEqual({
        fact: "candidate",
        status: "observed",
        evidence: "next-local-safe=yes task=TASK-PLANNED files=1",
      });
      expect(result?.content?.[0]?.text).toContain("local-continuity-audit:");
      expect(result?.content?.[0]?.text).toContain("authorization=none");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("prefers recent local-safe active task over older protected in-progress task", () => {
    const cwd = mkdtempSync(join(tmpdir(), "local-continuity-active-focus-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
        timestamp: "2026-04-30T04:40:00.000Z",
        blockers: [],
      }));
      writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [
        {
          id: "TASK-BUD-153",
          status: "in-progress",
          description: "Old protected multi-mode calibration",
          files: ["packages/pi-stack/extensions/foo.ts", ".github/workflows/ci.yml"],
          acceptance_criteria: ["Smoke principal permanece verde."],
        },
        {
          id: "TASK-BUD-325",
          status: "in-progress",
          description: "Current local-safe audit alignment smoke",
          files: ["packages/pi-stack/extensions/context-watchdog.ts"],
          acceptance_criteria: ["Smoke principal permanece verde."],
        },
      ] }));
      const tools: RegisteredTool[] = [];
      registerGuardrailsUnattendedContinuationSurface({
        registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
      } as never);

      const auditTool = tools.find((tool) => tool.name === "local_continuity_audit");
      const result = auditTool?.execute("call-audit", {}, undefined, undefined, { cwd });
      const collectorResults = result?.details.collectorResults as Array<{ fact: string; status: string; evidence: string }>;
      const candidate = collectorResults.find((entry) => entry.fact === "candidate");

      expect(candidate).toEqual({
        fact: "candidate",
        status: "observed",
        evidence: "next-local-safe=yes task=TASK-BUD-325 files=1",
      });
      expect(result?.content?.[0]?.text).toContain("local-continuity-audit:");
      expect(result?.content?.[0]?.text).toContain("authorization=none");
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

  it("registers read-only human-confirmed one-slice contract review tool", () => {
    const tools: RegisteredTool[] = [];
    registerGuardrailsUnattendedContinuationSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const reviewTool = tools.find((tool) => tool.name === "one_slice_human_contract_review");
    const ready = reviewTool?.execute("call-ready", {
      packet_decision: "ready-for-human-decision",
      packet_dispatch_allowed: false,
      packet_requires_human_decision: true,
      packet_one_slice_only: true,
      packet_activation: "none",
      packet_authorization: "none",
      human_confirmation: "explicit-task-action",
      single_focus: true,
      local_safe_scope: true,
      declared_files_known: true,
      protected_scopes_clear: true,
      rollback_plan_known: true,
      validation_gate_known: true,
      staging_scope_known: true,
      commit_scope_known: true,
      checkpoint_planned: true,
      stop_contract_known: true,
    });
    const blocked = reviewTool?.execute("call-blocked", {
      packet_decision: "ready-for-human-decision",
      packet_dispatch_allowed: true,
      packet_requires_human_decision: true,
      packet_one_slice_only: true,
      packet_activation: "none",
      packet_authorization: "none",
      human_confirmation: "generic",
      single_focus: true,
      local_safe_scope: true,
      declared_files_known: true,
      protected_scopes_clear: false,
      rollback_plan_known: true,
      validation_gate_known: true,
      staging_scope_known: true,
      commit_scope_known: true,
      checkpoint_planned: true,
      stop_contract_known: true,
      scheduler_requested: true,
      remote_or_offload_requested: true,
      github_actions_requested: true,
    });

    expect(ready?.content?.[0]?.text).toBe("one-slice-human-confirmed-contract: decision=contract-ready-no-executor dispatch=no executor=no reasons=contract-valid,human-confirmation-explicit,executor-not-approved authorization=none");
    expect(ready?.details).toMatchObject({
      effect: "none",
      mode: "contract-review",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      executorApproved: false,
      decision: "contract-ready-no-executor",
    });
    expect(blocked?.content?.[0]?.text).toContain("one-slice-human-confirmed-contract: decision=blocked dispatch=no executor=no");
    expect(blocked?.details.dispatchAllowed).toBe(false);
    expect(blocked?.details.executorApproved).toBe(false);
    expect(blocked?.details.reasons).toEqual(expect.arrayContaining([
      "packet-dispatch-not-false",
      "human-confirmation-generic",
      "protected-scope",
      "scheduler-requested",
      "remote-or-offload-requested",
      "github-actions-requested",
    ]));
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
