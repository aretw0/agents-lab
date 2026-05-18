import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import guardrailsAgentRun from "../../extensions/guardrails-agent-run";

describe("agent run dispatch readiness gates", () => {
  it("blocks SDK single-worker dispatch when worker lane evidence is absent", () => {
    const cwd = mkdtempProject("pi-agent-single-dispatch-");
    try {
      const pi = registerAgentRun();
      const tool = findTool(pi, "agent_run_sdk_in_process_dispatch");
      const result = tool.execute("tc-sdk-single-dispatch", {
        run_id: "sdk-single-readiness-gated",
        goal: "Read one file and stop.",
        provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
        declared_files: ["README.md"],
        timeout_ms: 45_000,
        tool_allowlist: ["read", "grep"],
        validation_gate_known: true,
        rollback_plan_known: true,
        budget_decision: "ok",
        abort_known: true,
        event_stream_known: true,
        final_output_contract_known: true,
        execute: true,
        operator_approval: structuredApproval(),
      }, undefined, () => {}, { cwd });

      expect(result.details?.processStartAllowed).toBe(false);
      expect(result.details?.blockers).toContain("worker-lane-single-worker-not-ready");
      expect(result.details?.blockers).not.toContain("structured-operator-approval-missing");
      expect(result.details?.workerLaneReadiness).toMatchObject({
        stage: "needs-evidence",
        singleWorkerAllowed: false,
        dispatchAllowed: false,
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("blocks read-only batch dispatch until multi-worker rehearsal is explicitly ready", () => {
    const cwd = mkdtempProject("pi-agent-batch-dispatch-");
    try {
      seedBoardOpenSingleWorkerEvidence(cwd);
      const pi = registerAgentRun();
      const tool = findTool(pi, "agent_run_sdk_readonly_batch_dispatch");
      const result = tool.execute("tc-sdk-batch-dispatch", {
        batch_id: "sdk-batch-readiness-gated",
        workers: [
          readyWorker("sdk-batch-readiness-a", "README.md"),
          readyWorker("sdk-batch-readiness-b", "package.json"),
        ],
        execute: true,
        operator_approval: structuredApproval(),
      }, undefined, () => {}, { cwd });

      expect(result.details?.processStartAllowed).toBe(false);
      expect(result.details?.blockers).toContain("worker-lane-multi-worker-not-ready");
      expect(result.details?.blockers).not.toContain("structured-operator-approval-missing");
      expect(result.details?.workerLaneReadiness).toMatchObject({
        stage: "single-worker-evidence-ready-board-open",
        singleWorkerAllowed: true,
        multiWorkerRehearsalCandidate: false,
        dispatchAllowed: false,
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("blocks SDK dispatch when structured operator approval is missing", () => {
    const cwd = mkdtempProject("pi-agent-missing-approval-");
    try {
      seedCompletedSingleWorkerEvidence(cwd);
      const pi = registerAgentRun();
      const tool = findTool(pi, "agent_run_sdk_in_process_dispatch");
      const result = tool.execute("tc-sdk-missing-approval", {
        run_id: "sdk-missing-approval",
        goal: "Read one file and stop.",
        provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
        declared_files: ["README.md"],
        timeout_ms: 45_000,
        tool_allowlist: ["read", "grep"],
        validation_gate_known: true,
        rollback_plan_known: true,
        budget_decision: "ok",
        abort_known: true,
        event_stream_known: true,
        final_output_contract_known: true,
        execute: true,
      }, undefined, () => {}, { cwd });

      expect(result.details?.processStartAllowed).toBe(false);
      expect(result.details?.blockers).toContain("structured-operator-approval-missing");
      expect(result.details?.structuredOperatorApproval).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

function registerAgentRun() {
  const pi = {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    getAllTools: vi.fn(),
  };
  guardrailsAgentRun(pi as never);
  return pi;
}

function findTool(pi: ReturnType<typeof registerAgentRun>, name: string) {
  const call = pi.registerTool.mock.calls.find(([tool]) => tool?.name === name);
  expect(call, `expected ${name} to be registered`).toBeTruthy();
  return call?.[0] as {
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: unknown,
      onUpdate: () => void,
      ctx: { cwd: string },
    ) => { details?: Record<string, unknown>; content?: Array<{ text?: string }> };
  };
}

function mkdtempProject(prefix: string): string {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(cwd, ".project"), { recursive: true });
  mkdirSync(join(cwd, "docs", "research"), { recursive: true });
  return cwd;
}

function seedBoardOpenSingleWorkerEvidence(cwd: string): void {
  writeFileSync(
    join(cwd, ".project", "tasks.json"),
    `${JSON.stringify({
      tasks: [
        { id: "TASK-BUD-1066", description: "subprocess", status: "completed" },
        { id: "TASK-BUD-1068", description: "executor", status: "completed" },
        { id: "TASK-BUD-1075", description: "mutation canary", status: "in-progress" },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(cwd, ".project", "verification.json"),
    `${JSON.stringify({
      verifications: [
        { id: "VERIF-TASK-BUD-1075-SDK-ONE-FILE-MUTATION-PASS-20260514" },
        { id: "VERIF-TASK-BUD-1075-RUNG", evidence: "SDK-MUTATION-RUNG-CODIFIED" },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(cwd, "docs", "research", "single-worker-board-driven-lane-maturity-2026-05.md"),
    "single-worker-board-driven-lane-maturity-decision\n",
    "utf8",
  );
  writeFileSync(
    join(cwd, "docs", "research", "agent-runner-maturity-checkpoint-2026-05.md"),
    "agent-first-worker-lane\n",
    "utf8",
  );
  writeFileSync(
    join(cwd, "docs", "research", "agent-first-operating-mode-2026-05.md"),
    "single-worker\n",
    "utf8",
  );
}

function seedCompletedSingleWorkerEvidence(cwd: string): void {
  seedBoardOpenSingleWorkerEvidence(cwd);
  writeFileSync(
    join(cwd, ".project", "tasks.json"),
    `${JSON.stringify({
      tasks: [
        { id: "TASK-BUD-1066", description: "subprocess", status: "completed" },
        { id: "TASK-BUD-1068", description: "executor", status: "completed" },
        { id: "TASK-BUD-1075", description: "mutation canary", status: "completed" },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
}

function structuredApproval(): Record<string, unknown> {
  return {
    packet_mode: "operator-approval-packet",
    approved: true,
    approval_state: "approved",
  };
}

function readyWorker(runId: string, file: string): Record<string, unknown> {
  return {
    run_id: runId,
    goal: "Read one file and stop.",
    provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
    declared_files: [file],
    timeout_ms: 45_000,
    tool_allowlist: ["read", "grep"],
    validation_gate_known: true,
    rollback_plan_known: true,
    budget_decision: "ok",
    abort_known: true,
    event_stream_known: true,
    final_output_contract_known: true,
  };
}
