import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import guardrailsCore, { buildAgentRunTaskPacket, buildAgentRunTaskStartPacket, buildCodexSparkPromotedWorkerPacket } from "../../extensions/guardrails-core";

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
      budgetEvidence: "model-specific Spark budget usable while aggregate Codex may be pressured",
      budgetEvidenceSource: "manual",
      budgetEvidenceProvider: "openai-codex/gpt-5.3-codex-spark",
      tokenBudgetEvidence: "Spark scoped pool usable; conserve tokens",
    });

    expect(result).toMatchObject({
      mode: "agent-run-task-packet",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      processStartAllowed: false,
      processStopAllowed: false,
      requiresHumanDecision: true,
      singleRunOnly: true,
      decision: "ready-for-human-decision",
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
    expect(result.invocationSpec.budgetEvidence).toContain("Spark budget usable");
    expect(result.invocationSpec.budgetEvidenceProvider).toBe("openai-codex/gpt-5.3-codex-spark");
    expect(result.humanConfirmationPhrase).toBe("execute o worker task-bud-1010-task-packet");
  });

  it("builds a natural-use Codex Spark packet for promoted envelopes", () => {
    const result = buildCodexSparkPromotedWorkerPacket({
      taskId: "TASK-BUD-1086",
      task: {
        id: "TASK-BUD-1086",
        description: "Use Codex Spark naturally for a bounded local-safe worker slice.",
        status: "planned",
        files: ["packages/pi-stack/extensions/guardrails-core-agent-run-start.ts"],
        acceptance_criteria: ["returns promoted worker packet", "keeps exact-confirmed dispatch"],
      },
      cwd: process.cwd(),
      envelope: "readonly-source-backed-evidence-synthesis",
    });

    expect(result).toMatchObject({
      mode: "codex-spark-promoted-worker-packet",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      processStartAllowed: false,
      processStopAllowed: false,
      requiresHumanDecision: true,
      decision: "ready-for-human-decision",
      promotion: "promoted",
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
    expect(result.summary).toContain("dispatch=no");
  });

  it("fails closed for unpromoted Codex Spark envelopes", () => {
    const result = buildCodexSparkPromotedWorkerPacket({
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
    });

    expect(result.decision).toBe("blocked");
    expect(result.promotion).toBe("blocked");
    expect(result.blockers).toContain("codex-spark-envelope-not-promoted");
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
      budgetEvidence: "Spark scoped budget usable",
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
      requiresHumanDecision: true,
      decision: "ready-for-human-decision",
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
    expect(result.statusPreview.processStartAllowed).toBe(false);
    expect(result.logTailPreview.readOnly).toBe(true);
    expect(result.abortPreview.processStopAllowed).toBe(false);
    expect(result.outcomeChecklist.join("\n")).toContain("fail contract on empty output");
    expect(result.summary).toContain("dispatch=no");
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
      budgetEvidence: "Spark scoped budget usable",
      budgetEvidenceSource: "manual",
      budgetEvidenceProvider: "openai-codex/gpt-5.3-codex-spark",
      extensionIsolation: "inherit",
    });

    expect(result.decision).toBe("ready-for-human-decision");
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
    const pi = rawPi as unknown as Parameters<typeof guardrailsCore>[0];
    guardrailsCore(pi);

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
        budget_evidence: "Spark scoped budget usable",
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
    expect(result.details?.decision).toBe("ready-for-human-decision");
    expect(result.content?.[0]?.text).toContain("agent-run-task-packet: decision=ready-for-human-decision");
    expect(result.content?.[0]?.text).toContain("dispatch=no");
  });

  it("exposes agent_run_codex_spark_promoted_worker_packet as a natural-use board surface", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "codex-spark-promoted-worker-"));
    mkdirSync(path.join(tmp, ".project"), { recursive: true });
    writeFileSync(path.join(tmp, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-BUD-1086",
          description: "Promote Codex Spark for bounded local-safe worker use.",
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
    const pi = rawPi as unknown as Parameters<typeof guardrailsCore>[0];
    guardrailsCore(pi);

    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_codex_spark_promoted_worker_packet");
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
      "tc-codex-spark-promoted-worker",
      {
        task_id: "TASK-BUD-1086",
        envelope: "readonly-one-file",
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: tmp },
    );

    expect(result.details?.mode).toBe("codex-spark-promoted-worker-packet");
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.details?.processStartAllowed).toBe(false);
    expect(result.details?.decision).toBe("ready-for-human-decision");
    expect(result.content?.[0]?.text).toContain("codex-spark-promoted-worker-packet: decision=ready-for-human-decision");
    expect(result.content?.[0]?.text).toContain("dispatch=no");
  });

  it("exposes agent_run_task_dispatch_check as report-only confirmation check", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "agent-run-task-dispatch-check-"));
    mkdirSync(path.join(tmp, ".project"), { recursive: true });
    writeFileSync(path.join(tmp, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-BUD-1016",
          description: "Implement report-only dispatch confirmation check.",
          status: "planned",
          files: ["packages/pi-stack/extensions/guardrails-core-agent-spawn-readiness-surface.ts"],
          acceptance_criteria: ["missing mismatch match without dispatch"],
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
    const pi = rawPi as unknown as Parameters<typeof guardrailsCore>[0];
    guardrailsCore(pi);

    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_task_dispatch_check");
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
      task_id: "TASK-BUD-1016",
      provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
      budget_decision: "warn",
      budget_evidence: "Spark scoped budget usable",
      budget_evidence_source: "manual",
      budget_evidence_provider: "openai-codex/gpt-5.3-codex-spark",
    };
    const missing = await tool.execute("tc-dispatch-check-missing", commonParams, undefined as unknown as AbortSignal, () => {}, { cwd: tmp });
    expect(missing.details?.mode).toBe("agent-run-task-dispatch-check");
    expect(missing.details?.confirmation).toBe("missing");
    expect(missing.details?.dispatchAllowed).toBe(false);
    expect(missing.details?.processStartAllowed).toBe(false);
    expect(missing.details?.wouldDispatchAfterExplicitExecute).toBe(false);

    const mismatch = await tool.execute("tc-dispatch-check-mismatch", { ...commonParams, operator_confirmation: "wrong phrase" }, undefined as unknown as AbortSignal, () => {}, { cwd: tmp });
    expect(mismatch.details?.confirmation).toBe("mismatch");
    expect(mismatch.details?.wouldDispatchAfterExplicitExecute).toBe(false);

    const match = await tool.execute(
      "tc-dispatch-check-match",
      { ...commonParams, operator_confirmation: "execute o worker task-bud-1016-task-packet" },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: tmp },
    );
    expect(match.details?.confirmation).toBe("match");
    expect(match.details?.wouldDispatchAfterExplicitExecute).toBe(true);
    expect(match.details?.dispatchAllowed).toBe(false);
    expect(match.content?.[0]?.text).toContain("dispatch=no");
    expect(existsSync(path.join(tmp, ".pi", "reports", "agent-runs.json"))).toBe(false);

    const blocked = await tool.execute(
      "tc-dispatch-check-blocked",
      { ...commonParams, task_id: "TASK-PROTECTED", operator_confirmation: "execute o worker task-protected-task-packet" },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: tmp },
    );
    expect(blocked.details?.decision).toBe("blocked");
    expect((blocked.details?.blockers as string[])).toContain("protected-scope-requested");
    expect(blocked.details?.wouldDispatchAfterExplicitExecute).toBe(false);
  });

  it("exposes agent_run_task_dispatch as preview-only by default and blocks confirmation mismatch", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "agent-run-task-dispatch-"));
    mkdirSync(path.join(tmp, ".project"), { recursive: true });
    writeFileSync(path.join(tmp, ".project", "tasks.json"), JSON.stringify({
      tasks: [
        {
          id: "TASK-BUD-1014",
          description: "Implement exact-confirmation dispatch gate.",
          status: "planned",
          files: ["packages/pi-stack/extensions/guardrails-core-agent-spawn-readiness-surface.ts"],
          acceptance_criteria: ["preview by default", "confirmation mismatch blocks"],
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
    const pi = rawPi as unknown as Parameters<typeof guardrailsCore>[0];
    guardrailsCore(pi);

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
      budget_evidence: "Spark scoped budget usable",
      budget_evidence_source: "manual",
      budget_evidence_provider: "openai-codex/gpt-5.3-codex-spark",
    };
    const preview = await tool.execute("tc-agent-run-task-dispatch-preview", commonParams, undefined as unknown as AbortSignal, () => {}, { cwd: tmp });
    expect(preview.details?.mode).toBe("agent-run-task-dispatch");
    expect(preview.details?.decision).toBe("preview");
    expect(preview.details?.dispatchAllowed).toBe(false);
    expect(preview.details?.processStartAllowed).toBe(false);
    expect(existsSync(path.join(tmp, ".pi", "reports", "agent-runs.json"))).toBe(false);
    expect(preview.content?.[0]?.text).toContain("dispatch=no");

    const mismatch = await tool.execute("tc-agent-run-task-dispatch-mismatch", { ...commonParams, execute: true, operator_confirmation: "wrong phrase" }, undefined as unknown as AbortSignal, () => {}, { cwd: tmp });
    expect(mismatch.details?.decision).toBe("blocked");
    expect(mismatch.details?.dispatchAllowed).toBe(false);
    expect((mismatch.details?.blockers as string[])).toContain("operator-confirmation-mismatch");
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
    const pi = rawPi as unknown as Parameters<typeof guardrailsCore>[0];
    guardrailsCore(pi);

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
        budget_evidence: "Spark scoped budget usable",
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
    expect(result.details?.decision).toBe("ready-for-human-decision");
    expect(result.content?.[0]?.text).toContain("agent-run-task-start-packet: decision=ready-for-human-decision");
    expect(result.content?.[0]?.text).toContain("dispatch=no");
  });
});
