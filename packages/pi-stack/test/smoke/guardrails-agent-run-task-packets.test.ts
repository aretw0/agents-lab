import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import guardrailsAgentRun from "../../extensions/guardrails-agent-run";
import { buildAgentRunOperatorPacket, buildAgentRunTaskPacket, buildAgentRunTaskStartPacket, buildPromotedWorkerPacket } from "../../extensions/guardrails-core-exports";

describe("agent run task packet surfaces", () => {
  it("derives a report-only agent invocation spec from a board task", () => {
    const result = buildAgentRunTaskPacket({
      taskId: "TASK-BUD-1010",
      task: {
        id: "TASK-BUD-1010",
        description: "Implement report-only board-to-agent packetizer.",
        status: "planned",
        files: [
          "packages/pi-stack/extensions/guardrails-core-agent-run-start.ts",
          "packages/pi-stack/extensions/guardrails-core-agent-spawn-readiness-surface.ts",
        ],
        acceptance_criteria: [
          "returns typed invocation spec",
          "keeps dispatchAllowed=false",
        ],
      },
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      budgetDecision: "warn",
      budgetEvidence: "model-specific budget usable while aggregate provider may be pressured",
      budgetEvidenceSource: "manual",
      budgetEvidenceProvider: "openai-codex/gpt-5.3-codex-spark",
      tokenBudgetEvidence: "model-scoped pool usable; conserve tokens",
    });

    expect(result).toMatchObject({
      mode: "agent-run-task-packet",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      processStartAllowed: false,
      processStopAllowed: false,
      requiresOperatorDecision: true,
      singleRunOnly: true,
      decision: "ready-for-operator-decision",
      nextActionCode: "present-task-packet-for-approval",
      blockers: [],
    });
    expect(result.invocationSpec.runId).toBe("task-bud-1010-task-packet");
    expect(result.invocationSpec.fileContract).toBe("mutation");
    expect(result.invocationSpec.profile).toBe("small-mutation");
    expect(result.invocationSpec.declaredFiles).toEqual([
      "packages/pi-stack/extensions/guardrails-core-agent-run-start.ts",
      "packages/pi-stack/extensions/guardrails-core-agent-spawn-readiness-surface.ts",
    ]);
    expect(result.invocationSpec.validation.join("\n")).toContain("acceptance criterion: returns typed invocation spec");
    expect(result.rollback.join("\n")).toContain("git restore packages/pi-stack/extensions/guardrails-core-agent-run-start.ts");
    expect(result.invocationSpec.economyMode).toBe("critical");
    expect(result.invocationSpec.maxOutputLines).toBe(20);
    expect(result.invocationSpec.budgetEvidence).toContain("model-specific budget usable");
    expect(result.invocationSpec.budgetEvidenceProvider).toBe("openai-codex/gpt-5.3-codex-spark");
    expect(result.invocationSpecPacket.nextActionCode).toBe("present-invocation-spec-for-approval");
    expect(result.invocationSpecPacket.operatorPacket.nextActionCode).toBe("present-operator-approval");
    expect(result.operatorApprovalPrompt).toBe("approve worker task-bud-1010-task-packet");
    expect(result.summary).toContain("nextActionCode=present-task-packet-for-approval");
  });

  it("exposes stable operator packet next action codes", () => {
    const ready = buildAgentRunOperatorPacket({
      taskId: "TASK-CODE-1",
      goal: "Review the declared file only.",
      providerModelRef: "dashscope/qwen3.6-flash",
      cwd: process.cwd(),
      declaredFiles: ["packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
      budgetDecision: "ok",
      budgetEvidence: "dashscope ready",
    });
    expect(ready.nextActionCode).toBe("present-operator-approval");
    expect(ready.nextAction).toContain("approve worker");

    const blocked = buildAgentRunOperatorPacket({
      taskId: "TASK-CODE-2",
      goal: "Review the declared file only.",
      cwd: process.cwd(),
      declaredFiles: ["packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
      budgetDecision: "ok",
      budgetEvidence: "dashscope ready",
    });
    expect(blocked.nextActionCode).toBe("resolve-blockers");
    expect(blocked.blockers).toContain("provider-model-ref-missing");
  });

  it("builds a natural-use promoted worker packet for promoted envelopes", () => {
    const result = buildPromotedWorkerPacket({
      taskId: "TASK-BUD-1086",
      task: {
        id: "TASK-BUD-1086",
        description: "Use an operator-selected provider naturally for a bounded local-safe worker slice.",
        status: "planned",
        files: ["packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
        acceptance_criteria: ["returns promoted worker packet", "keeps structured operator approval"],
      },
      cwd: process.cwd(),
      envelope: "readonly-source-backed-evidence-synthesis",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
    });

    expect(result).toMatchObject({
      mode: "promoted-worker-packet",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      processStartAllowed: false,
      processStopAllowed: false,
      requiresOperatorDecision: true,
      decision: "ready-for-operator-decision",
      promotion: "promoted",
      nextActionCode: "use-promoted-worker-packet",
      blockers: [],
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      envelope: "readonly-source-backed-evidence-synthesis",
    });
    expect(result.taskStartPacket.taskPacket.invocationSpec.providerModelRef).toBe("openai-codex/gpt-5.3-codex-spark");
    expect(result.taskStartPacket.taskPacket.invocationSpec.profile).toBe("read-only-review");
    expect(result.taskStartPacket.taskPacket.invocationSpec.budgetDecision).toBe("warn");
    expect(result.taskStartPacket.taskPacket.invocationSpec.economyMode).toBe("critical");
    expect(result.promotedEnvelopes).toContain("mutation-one-file-marker");
    expect(result.stillBlocked.join("\n")).toContain("protected-scope mutation");
    expect(result.taskStartPacket.nextActionCode).toBe("present-task-start-previews-for-approval");
    expect(result.summary).toContain("dispatch=no");
    expect(result.summary).toContain("nextActionCode=use-promoted-worker-packet");
  });

  it("fails closed for unpromoted worker envelopes", () => {
    const result = buildPromotedWorkerPacket({
      taskId: "TASK-BUD-1086",
      task: {
        id: "TASK-BUD-1086",
        description: "Try an unpromoted worker shape.",
        status: "planned",
        files: ["packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
        acceptance_criteria: ["blocks unknown envelope"],
      },
      cwd: process.cwd(),
      envelope: "swarm-mutation-many-files",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
    });

    expect(result.decision).toBe("blocked");
    expect(result.promotion).toBe("blocked");
    expect(result.nextActionCode).toBe("resolve-promoted-worker-blockers");
    expect(result.blockers).toContain("promoted-worker-envelope-not-promoted");
    expect(result.processStartAllowed).toBe(false);
  });

  it("fails closed for unsafe or incomplete board-to-agent packets", () => {
    const readyTask = {
      id: "TASK-BUD-1010",
      description: "Implement report-only board-to-agent packetizer.",
      status: "planned",
      files: ["packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
      acceptance_criteria: ["returns typed invocation spec"],
    };

    const missingTask = buildAgentRunTaskPacket({
      taskId: "TASK-MISSING",
      providerModelRef: "dashscope/qwen3-coder-plus",
      cwd: process.cwd(),
      budgetDecision: "ok",
      budgetEvidence: "dashscope ok",
    });
    expect(missingTask.decision).toBe("blocked");
    expect(missingTask.nextActionCode).toBe("resolve-task-packet-blockers");
    expect(missingTask.blockers).toContain("task-not-found");

    const missingFiles = buildAgentRunTaskPacket({
      taskId: "TASK-NO-FILES",
      task: { ...readyTask, id: "TASK-NO-FILES", files: [] },
      providerModelRef: "dashscope/qwen3-coder-plus",
      cwd: process.cwd(),
      budgetDecision: "ok",
      budgetEvidence: "dashscope ok",
    });
    expect(missingFiles.decision).toBe("blocked");
    expect(missingFiles.blockers).toContain("task-files-missing");

    const protectedScope = buildAgentRunTaskPacket({
      taskId: "TASK-PROTECTED",
      task: { ...readyTask, id: "TASK-PROTECTED", files: [".github/workflows/ci.yml"] },
      providerModelRef: "dashscope/qwen3-coder-plus",
      cwd: process.cwd(),
      budgetDecision: "ok",
      budgetEvidence: "dashscope ok",
    });
    expect(protectedScope.decision).toBe("blocked");
    expect(protectedScope.blockers).toContain("protected-scope-requested");

    const completed = buildAgentRunTaskPacket({
      taskId: "TASK-DONE",
      task: { ...readyTask, id: "TASK-DONE", status: "completed" },
      providerModelRef: "dashscope/qwen3-coder-plus",
      cwd: process.cwd(),
      budgetDecision: "ok",
      budgetEvidence: "dashscope ok",
    });
    expect(completed.decision).toBe("blocked");
    expect(completed.blockers).toContain("task-already-completed");

    const rawBoardScope = buildAgentRunTaskPacket({
      taskId: "TASK-RAW-BOARD",
      task: { ...readyTask, id: "TASK-RAW-BOARD", files: [".project/tasks.json"] },
      providerModelRef: "dashscope/qwen3-coder-plus",
      cwd: process.cwd(),
      budgetDecision: "ok",
      budgetEvidence: "dashscope ok",
    });
    expect(rawBoardScope.decision).toBe("blocked");
    expect(rawBoardScope.blockers).toContain("raw-board-state-file-declared-use-derived-board-packet");
    expect(rawBoardScope.task.rawBoardScopeDetected).toBe(true);
  });

  it("composes task packets with registry/start/status/log/abort/outcome previews", () => {
    const result = buildAgentRunTaskStartPacket({
      taskId: "TASK-BUD-1012",
      task: {
        id: "TASK-BUD-1012",
        description: "Implement report-only task start packet bridge.",
        status: "planned",
        files: ["packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
        acceptance_criteria: ["includes registry preview", "keeps processStartAllowed=false"],
      },
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      budgetDecision: "warn",
      budgetEvidence: "scoped model budget usable",
      budgetEvidenceSource: "manual",
      budgetEvidenceProvider: "openai-codex/gpt-5.3-codex-spark",
    });

    expect(result).toMatchObject({
      mode: "agent-run-task-start-packet",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      processStartAllowed: false,
      processStopAllowed: false,
      requiresOperatorDecision: true,
      decision: "ready-for-operator-decision",
      nextActionCode: "present-task-start-previews-for-approval",
      blockers: [],
    });
    expect(result.taskPacket.mode).toBe("agent-run-task-packet");
    expect(result.registryPreview).toMatchObject({
      mode: "agent-run-registry-upsert",
      decision: "dry-run",
      writeAllowed: false,
      dispatchAllowed: false,
    });
    expect(result.startPreview.command).toBe("pi");
    expect(result.headlessDriverPreview).toMatchObject({
      mode: "agent-run-driver-step-preview",
      decision: "blocked",
      available: false,
      dispatchAllowed: false,
      processStartAllowed: false,
      tool: "agent_run_driver_step_dispatch",
      blockers: ["headless-driver-preview-read-only-only"],
    });
    expect(result.statusPreview.processStartAllowed).toBe(false);
    expect(result.logTailPreview.readOnly).toBe(true);
    expect(result.abortPreview.processStopAllowed).toBe(false);
    expect(result.outcomeChecklist.join("\n")).toContain("fail contract on empty output");
    expect(result.summary).toContain("dispatch=no");
  });

  it("adds a ready headless driver preview for read-only task workers", () => {
    const result = buildAgentRunTaskStartPacket({
      taskId: "TASK-READONLY",
      task: {
        id: "TASK-READONLY",
        description: "Review a declared file without mutations.",
        status: "planned",
        files: ["README.md"],
        acceptance_criteria: ["return review evidence"],
      },
      profile: "read-only-review",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      budgetDecision: "warn",
      budgetEvidence: "scoped model budget usable",
      budgetEvidenceSource: "manual",
      budgetEvidenceProvider: "openai-codex/gpt-5.3-codex-spark",
    });

    expect(result.decision).toBe("ready-for-operator-decision");
    expect(result.headlessDriverPreview).toMatchObject({
      mode: "agent-run-driver-step-preview",
      decision: "ready-for-operator-decision",
      available: true,
      dispatchAllowed: false,
      processStartAllowed: false,
      tool: "agent_run_driver_step_dispatch",
      blockers: [],
    });
    expect(result.headlessDriverPreview.payload).toMatchObject({
      execute: false,
      follow: false,
      build_outcome: false,
      run_spec: {
        run_id: "task-readonly-task-packet",
        provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
        cwd: process.cwd(),
        declared_files: ["README.md"],
        file_contract: "read-only",
        execution_preview: result.startPreview,
      },
    });
    expect(result.headlessDriverPreview.executionPayloadTemplate).toMatchObject({
      execute: true,
      follow: true,
      build_outcome: true,
      run_spec: {
        run_id: "task-readonly-task-packet",
        file_contract: "read-only",
        execution_preview: result.startPreview,
      },
    });
    expect(result.headlessDriverPreview.operatorApprovalRequired).toBe(true);
  });

  it("propagates inherited extension isolation for custom-provider task workers", () => {
    const result = buildAgentRunTaskStartPacket({
      taskId: "TASK-BUD-1065",
      task: {
        id: "TASK-BUD-1065",
        description: "Allow custom provider workers to inherit extensions.",
        status: "planned",
        files: ["packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
        acceptance_criteria: ["argv can omit no-extensions for inherit isolation"],
      },
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      budgetDecision: "ok",
      budgetEvidence: "scoped model budget usable",
      budgetEvidenceSource: "manual",
      budgetEvidenceProvider: "openai-codex/gpt-5.3-codex-spark",
      extensionIsolation: "inherit",
    });

    expect(result.decision).toBe("ready-for-operator-decision");
    expect(result.taskPacket.invocationSpec.extensionIsolation).toBe("inherit");
    expect(result.startPreview.args).not.toContain("--no-extensions");
    expect(result.startPreview.args).not.toContain("--no-skills");
    expect(result.summary).toContain("dispatch=no");
  });

  it("blocks task start packets when the underlying task packet is blocked", () => {
    const result = buildAgentRunTaskStartPacket({
      taskId: "TASK-PROTECTED",
      task: {
        id: "TASK-PROTECTED",
        description: "Change CI settings.",
        status: "planned",
        files: [".github/workflows/ci.yml"],
        acceptance_criteria: ["updates protected workflow"],
      },
      providerModelRef: "dashscope/qwen3-coder-plus",
      cwd: process.cwd(),
      budgetDecision: "ok",
      budgetEvidence: "dashscope ok",
    });

    expect(result.decision).toBe("blocked");
    expect(result.processStartAllowed).toBe(false);
    expect(result.blockers).toContain("protected-scope-requested");
    expect(result.blockers).toContain("task-packet-blocked");
    expect(result.headlessDriverPreview).toMatchObject({
      decision: "blocked",
      available: false,
      blockers: expect.arrayContaining(["headless-driver-preview-task-packet-blocked"]),
    });
  });

  it("exposes agent_run_task_packet as a report-only board surface", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "agent-run-task-packet-"));
    mkdirSync(path.join(tmp, ".project"), { recursive: true });
    writeFileSync(path.join(tmp, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-BUD-1010",
          description: "Implement report-only board-to-agent packetizer.",
          status: "planned",
          files: ["packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
          acceptance_criteria: ["returns typed invocation spec"],
        },
      ],
    }, null, 2), "utf8");

    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsAgentRun>[0];
    guardrailsAgentRun(pi);

    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_task_packet");
    const tool = toolCall?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => Promise<{ content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }> | { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
    };

    const result = await tool.execute(
      "tc-agent-run-task-packet",
      {
        task_id: "TASK-BUD-1010",
        provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
        budget_decision: "warn",
        budget_evidence: "scoped model budget usable",
        budget_evidence_source: "manual",
        budget_evidence_provider: "openai-codex/gpt-5.3-codex-spark",
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: tmp },
    );

    expect(result.details?.mode).toBe("agent-run-task-packet");
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.details?.processStartAllowed).toBe(false);
    expect(result.details?.decision).toBe("ready-for-operator-decision");
    expect(result.content?.[0]?.text).toContain("agent-run-task-packet: decision=ready-for-operator-decision");
    expect(result.content?.[0]?.text).toContain("dispatch=no");
  });

  it("exposes agent_run_promoted_worker_packet as a natural-use board surface", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "promoted-worker-"));
    mkdirSync(path.join(tmp, ".project"), { recursive: true });
    writeFileSync(path.join(tmp, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-BUD-1086",
          description: "Promote an operator-selected provider for bounded local-safe worker use.",
          status: "planned",
          files: ["packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
          acceptance_criteria: ["returns promoted packet"],
        },
      ],
    }, null, 2), "utf8");

    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsAgentRun>[0];
    guardrailsAgentRun(pi);

    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_promoted_worker_packet");
    expect(toolCall?.[0]?.parameters?.type).toBe("object");
    const tool = toolCall?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => Promise<{ content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }> | { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
    };

    const result = await tool.execute(
      "tc-promoted-worker",
      {
        task_id: "TASK-BUD-1086",
        envelope: "readonly-one-file",
        provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: tmp },
    );

    expect(result.details?.mode).toBe("promoted-worker-packet");
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.details?.processStartAllowed).toBe(false);
    expect(result.details?.decision).toBe("ready-for-operator-decision");
    expect(result.content?.[0]?.text).toContain("promoted-worker-packet: decision=ready-for-operator-decision");
    expect(result.content?.[0]?.text).toContain("dispatch=no");
  });

  it("exposes agent_run_task_dispatch as preview-only by default and requires structured approval", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "agent-run-task-dispatch-"));
    mkdirSync(path.join(tmp, ".project"), { recursive: true });
    writeFileSync(path.join(tmp, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-BUD-1014",
          description: "Implement structured-approval dispatch gate.",
          status: "planned",
          files: ["packages/pi-stack/extensions/guardrails-core-agent-spawn-readiness-surface.ts"],
          acceptance_criteria: ["preview by default", "missing structured approval blocks"],
        },
        {
          id: "TASK-PROTECTED",
          description: "Change CI settings.",
          status: "planned",
          files: [".github/workflows/ci.yml"],
          acceptance_criteria: ["updates protected workflow"],
        },
      ],
    }, null, 2), "utf8");

    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsAgentRun>[0];
    guardrailsAgentRun(pi);

    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_task_dispatch");
    const tool = toolCall?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => Promise<{ content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }> | { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
    };

    const commonParams = {
      task_id: "TASK-BUD-1014",
      provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
      budget_decision: "warn",
      budget_evidence: "scoped model budget usable",
      budget_evidence_source: "manual",
      budget_evidence_provider: "openai-codex/gpt-5.3-codex-spark",
    };
    const preview = await tool.execute("tc-agent-run-task-dispatch-preview", commonParams, undefined as unknown as AbortSignal, () => {}, { cwd: tmp });
    expect(preview.details?.mode).toBe("agent-run-task-dispatch");
    expect(preview.details?.decision).toBe("preview");
    expect(preview.details?.dispatchAllowed).toBe(false);
    expect(preview.details?.processStartAllowed).toBe(false);
    expect(preview.details?.preferredDriverStep).toMatchObject({
      mode: "agent-run-driver-step-preview",
      available: false,
      dispatchAllowed: false,
      processStartAllowed: false,
      tool: "agent_run_driver_step_dispatch",
    });
    expect(preview.details?.preferredDriverStepAvailable).toBe(false);
    expect(preview.details?.nextActionCode).toBe("present-operator-approval");
    expect(existsSync(path.join(tmp, ".pi", "reports", "agent-runs.json"))).toBe(false);
    expect(preview.content?.[0]?.text).toContain("dispatch=no");

    const missingApproval = await tool.execute("tc-agent-run-task-dispatch-missing-approval", { ...commonParams, execute: true }, undefined as unknown as AbortSignal, () => {}, { cwd: tmp });
    expect(missingApproval.details?.decision).toBe("blocked");
    expect(missingApproval.details?.dispatchAllowed).toBe(false);
    expect((missingApproval.details?.blockers as string[])).toContain("structured-operator-approval-missing");
    expect(missingApproval.details?.nextActionCode).toBe("resolve-task-dispatch-blockers");
    expect(missingApproval.details?.structuredOperatorApproval).toBe(false);
    expect(existsSync(path.join(tmp, ".pi", "reports", "agent-runs.json"))).toBe(false);

    const protectedScope = await tool.execute(
      "tc-agent-run-task-dispatch-protected",
      { ...commonParams, task_id: "TASK-PROTECTED" },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: tmp },
    );
    expect(protectedScope.details?.decision).toBe("blocked");
    expect(protectedScope.details?.dispatchAllowed).toBe(false);
    expect((protectedScope.details?.blockers as string[])).toContain("protected-scope-requested");
  });

  it("routes read-only task dispatch execution to the preferred driver step", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "agent-run-task-dispatch-driver-route-"));
    mkdirSync(path.join(tmp, ".project"), { recursive: true });
    writeFileSync(path.join(tmp, "README.md"), "# Test fixture\n", "utf8");
    writeFileSync(path.join(tmp, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-READONLY",
          description: "Review README without mutations.",
          status: "planned",
          files: ["README.md"],
          acceptance_criteria: ["returns read-only evidence"],
        },
      ],
    }, null, 2), "utf8");

    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsAgentRun>[0];
    guardrailsAgentRun(pi);

    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_task_dispatch");
    const tool = toolCall?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => Promise<{ content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }> | { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
    };

    const result = await tool.execute(
      "tc-agent-run-task-dispatch-driver-route",
      {
        task_id: "TASK-READONLY",
        profile: "read-only-review",
        provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
        budget_decision: "warn",
        budget_evidence: "scoped model budget usable",
        budget_evidence_source: "manual",
        budget_evidence_provider: "openai-codex/gpt-5.3-codex-spark",
        execute: true,
        operator_approval: {
          packet_mode: "operator-approval-packet",
          approved: true,
          approval_state: "approved",
        },
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: tmp },
    );

    expect(result.details?.decision).toBe("blocked");
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.details?.processStartAllowed).toBe(false);
    expect(result.details?.preferredDriverStepAvailable).toBe(true);
    expect(result.details?.nextActionCode).toBe("use-preferred-driver-step");
    expect(result.details?.nextAction).toBe("call agent_run_driver_step_dispatch with preferredDriverStep.payload");
    expect((result.details?.blockers as string[])).toContain("prefer-agent-run-driver-step-dispatch");
    expect(result.details?.preferredDriverStep).toMatchObject({
      tool: "agent_run_driver_step_dispatch",
      available: true,
      operatorApprovalRequired: true,
      payload: {
        run_spec: {
          run_id: "task-readonly-task-packet",
          file_contract: "read-only",
          declared_files: ["README.md"],
        },
      },
      executionPayloadTemplate: {
        execute: true,
        follow: true,
        build_outcome: true,
        run_spec: {
          run_id: "task-readonly-task-packet",
          file_contract: "read-only",
          declared_files: ["README.md"],
        },
      },
    });
    expect(existsSync(path.join(tmp, ".pi", "reports", "agent-runs.json"))).toBe(false);
  });

  it("hardens agent_run_task_dispatch against subprocess spawn errors", () => {
    const source = [
      "packages/pi-stack/extensions/guardrails-core-agent-spawn-readiness-surface.ts",
      "packages/pi-stack/extensions/guardrails-core-agent-run-surface-runtime.ts",
    ].map((file) => readFileSync(path.join(process.cwd(), file), "utf8")).join("\n");
    expect(source).toContain("resolvePiSubprocessInvocation(packet.startPreview)");
    expect(source).toContain("spawn(subprocess.command, subprocess.args");
    expect(source).toContain("child.on(\"error\", (error: NodeJS.ErrnoException)");
    expect(source).toContain("spawn error code=${code}");
    expect(source).toContain("buildPiSubprocessPreflightLines");
    expect(source).toContain("preflight platform=${process.platform}");
    expect(source).toContain("preflight commandExists=");
    expect(source).toContain("preflight entrypointExists=");
    expect(source).toContain("failure code=runner-timeout");
    expect(source).toContain("first-byte stream=${streamName}");
    expect(source).toContain("firstOutputElapsedMs=${outputCapture.firstOutputElapsedMs()");
    expect(source).toContain("elapsedMs=${Date.now() - startedAtMs}");
    expect(source).toContain("signal=${signal || \"none\"} timedOut=");
    expect(source).toContain("[agent-runner] close exitCode=${exitCode}");
    expect(source).toContain("outputBytes: readLogByteCount(logPath)");
    expect(source).toContain("errorCode: code");
    expect(source).toContain("state: \"failed\"");
    expect(source).not.toContain("spawn(packet.startPreview.command, packet.startPreview.args");
  });

  it("exposes agent_run_task_start_packet as a report-only bridge surface", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "agent-run-task-start-packet-"));
    mkdirSync(path.join(tmp, ".project"), { recursive: true });
    writeFileSync(path.join(tmp, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-BUD-1012",
          description: "Implement report-only task start packet bridge.",
          status: "planned",
          files: ["packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
          acceptance_criteria: ["includes registry preview"],
        },
      ],
    }, null, 2), "utf8");

    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsAgentRun>[0];
    guardrailsAgentRun(pi);

    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_task_start_packet");
    const tool = toolCall?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => Promise<{ content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }> | { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
    };

    const result = await tool.execute(
      "tc-agent-run-task-start-packet",
      {
        task_id: "TASK-BUD-1012",
        provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
        budget_decision: "warn",
        budget_evidence: "scoped model budget usable",
        budget_evidence_source: "manual",
        budget_evidence_provider: "openai-codex/gpt-5.3-codex-spark",
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: tmp },
    );

    expect(result.details?.mode).toBe("agent-run-task-start-packet");
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.details?.processStartAllowed).toBe(false);
    expect(result.details?.decision).toBe("ready-for-operator-decision");
    expect(result.content?.[0]?.text).toContain("agent-run-task-start-packet: decision=ready-for-operator-decision");
    expect(result.content?.[0]?.text).toContain("dispatch=no");
  });

  it("exposes a ready headless driver preview through agent_run_task_start_packet for read-only tasks", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "agent-run-task-start-headless-"));
    mkdirSync(path.join(tmp, ".project"), { recursive: true });
    writeFileSync(path.join(tmp, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-READONLY",
          description: "Review README without mutations.",
          status: "planned",
          files: ["README.md"],
          acceptance_criteria: ["returns read-only evidence"],
        },
      ],
    }, null, 2), "utf8");

    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsAgentRun>[0];
    guardrailsAgentRun(pi);

    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_task_start_packet");
    const tool = toolCall?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => Promise<{ content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }> | { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
    };

    const result = await tool.execute(
      "tc-agent-run-task-start-headless",
      {
        task_id: "TASK-READONLY",
        profile: "read-only-review",
        provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
        budget_decision: "warn",
        budget_evidence: "scoped model budget usable",
        budget_evidence_source: "manual",
        budget_evidence_provider: "openai-codex/gpt-5.3-codex-spark",
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: tmp },
    );

    expect(result.details?.mode).toBe("agent-run-task-start-packet");
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.details?.processStartAllowed).toBe(false);
    expect(result.details?.headlessDriverPreview).toMatchObject({
      mode: "agent-run-driver-step-preview",
      decision: "ready-for-operator-decision",
      available: true,
      operatorApprovalRequired: true,
      dispatchAllowed: false,
      processStartAllowed: false,
      tool: "agent_run_driver_step_dispatch",
      payload: {
        execute: false,
        follow: false,
        build_outcome: false,
        run_spec: {
          run_id: "task-readonly-task-packet",
          provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
          cwd: tmp,
          declared_files: ["README.md"],
          file_contract: "read-only",
        },
      },
      executionPayloadTemplate: {
        execute: true,
        follow: true,
        build_outcome: true,
        run_spec: {
          run_id: "task-readonly-task-packet",
          file_contract: "read-only",
          declared_files: ["README.md"],
        },
      },
      blockers: [],
    });

    const driverToolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_driver_step_dispatch");
    const driverTool = driverToolCall?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => Promise<{ content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }> | { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
    };
    const preview = result.details?.headlessDriverPreview as { payload?: Record<string, unknown> } | undefined;
    const driverResult = await driverTool.execute(
      "tc-agent-run-driver-step-from-task-start-preview",
      preview?.payload ?? {},
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: tmp },
    );

    expect(driverResult.details?.mode).toBe("agent-run-driver-step-packet");
    expect(driverResult.details?.decision).toBe("ready-for-operator-decision");
    expect(driverResult.details?.dispatchAllowed).toBe(false);
    expect(driverResult.details?.processStartAllowed).toBe(false);
    expect(driverResult.details?.runSpec).toMatchObject({
      runId: "task-readonly-task-packet",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: tmp,
      declaredFiles: ["README.md"],
    });
  });
});
