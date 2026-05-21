import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import guardrailsAgentRun from "../../extensions/guardrails-agent-run";
import {
  buildAgentRunExecutorStrategyPacket,
  buildAgentRunStartupDiagnosticPacket,
  buildDeclaredFileScopedSdkWorkerTools,
  classifyAgentRunFailure,
  evaluateDeclaredPathPolicy,
} from "../../extensions/guardrails-core-exports";

describe("agent run executor diagnostics", () => {
  it("keeps actionable diagnostics for silent agent-runner failures", () => {
    const text = [
      "packages/pi-stack/extensions/guardrails-core-agent-spawn-readiness-surface.ts",
      "packages/pi-stack/extensions/guardrails-core-agent-run-surface-runtime.ts",
    ].map((file) => readFileSync(file, "utf8")).join("\n");
    expect(text).toContain("formatAgentRunnerArgvForLog");
    expect(text).toContain("childOutputBytes");
    expect(text).toContain("stdoutBytes");
    expect(text).toContain("stderrBytes");
    expect(text).toContain("firstOutputElapsedMs");
    expect(text).toContain("silent-runner-failure");
    expect(text).toContain("cwd=${ctx.cwd}");
  });

  it("selects subprocess or sdk executor strategy without dispatch", async () => {
    const sdkCandidate = buildAgentRunExecutorStrategyPacket({
      failureClass: "silent-runner-failure",
      subprocessDiagnosticsAvailable: true,
      sdkRuntimeAvailable: true,
      budgetDecision: "ok",
    });
    expect(sdkCandidate).toMatchObject({
      mode: "agent-run-executor-strategy-packet",
      dispatchAllowed: false,
      processStartAllowed: false,
      decision: "sdk-in-process-candidate",
      preferredExecutor: "pi-sdk-in-process",
      nextProbeExecutor: "pi-sdk-in-process",
      supportedExecutors: ["pi-print-subprocess", "pi-sdk-in-process"],
      executorPosture: {
        subprocessRetained: true,
        sdkIsReplacement: false,
        subprocessBlindRetryAllowed: false,
        subprocessMaturityProbe: "devcontainer-or-linux-canary",
      },
    });
    expect(sdkCandidate.executorContracts.map((contract) => contract.executor)).toEqual(["pi-print-subprocess", "pi-sdk-in-process"]);
    expect(sdkCandidate.trustLadder.map((step) => step.oodaStage)).toEqual(["observe", "orient", "decide", "act"]);
    expect(sdkCandidate.trustLadder.find((step) => step.oodaStage === "act")?.boundary).toContain("alternate provider/model canaries remain separate explicit decisions");
    expect(sdkCandidate.summary).toContain("subprocessRetained=yes");
    expect(sdkCandidate.summary).toContain("sdkReplacement=no");
    expect(sdkCandidate.summary).toContain("trustLadder=ooda");
    expect(sdkCandidate.summary).toContain("providerSequencing=configured-first");
    expect(sdkCandidate.nextActions.join(" ")).toContain("current configured/recommended provider/model");
    expect(sdkCandidate.nextActions.join(" ")).toContain("alternate provider/model canaries");
    expect(sdkCandidate.selectionRationale.join(" ")).toContain("SDK/in-process is the next diagnostic candidate");

    const timeoutSdkCandidate = buildAgentRunExecutorStrategyPacket({
      failureClass: "runner-timeout",
      subprocessDiagnosticsAvailable: true,
      sdkRuntimeAvailable: true,
      budgetDecision: "ok",
    });
    expect(timeoutSdkCandidate.decision).toBe("sdk-in-process-candidate");
    expect(timeoutSdkCandidate.executorPosture.subprocessBlindRetryAllowed).toBe(false);
    expect(timeoutSdkCandidate.summary).toContain("failureClass=runner-timeout");

    const devcontainerSubprocessProbe = buildAgentRunExecutorStrategyPacket({
      failureClass: "silent-runner-failure",
      subprocessDiagnosticsAvailable: true,
      sdkRuntimeAvailable: true,
      budgetDecision: "ok",
      runtimeMode: "devcontainer",
      devcontainerAvailable: true,
      requiresProcessIsolation: true,
    });
    expect(devcontainerSubprocessProbe).toMatchObject({
      decision: "subprocess-first",
      preferredExecutor: "pi-print-subprocess",
      nextProbeExecutor: "pi-print-subprocess",
      selectionSignals: {
        runtimeMode: "devcontainer",
        devcontainerAvailable: true,
        requiresProcessIsolation: true,
      },
    });
    expect(devcontainerSubprocessProbe.selectionRationale.join(" ")).toContain("devcontainer/Linux evidence");

    const directEventSdk = buildAgentRunExecutorStrategyPacket({
      failureClass: "unknown",
      subprocessDiagnosticsAvailable: true,
      sdkRuntimeAvailable: true,
      budgetDecision: "ok",
      requiresDirectEventStream: true,
    });
    expect(directEventSdk.decision).toBe("sdk-in-process-candidate");
    expect(directEventSdk.summary).toContain("requiresDirectEventStream=yes");

    const blocked = buildAgentRunExecutorStrategyPacket({
      failureClass: "silent-runner-failure",
      subprocessDiagnosticsAvailable: true,
      sdkRuntimeAvailable: true,
      budgetDecision: "blocked",
    });
    expect(blocked.decision).toBe("blocked");
    expect(blocked.blockers).toContain("budget-blocked");

    const dirtyBlocked = buildAgentRunExecutorStrategyPacket({
      failureClass: "unknown",
      subprocessDiagnosticsAvailable: true,
      sdkRuntimeAvailable: true,
      budgetDecision: "ok",
      unexpectedDirty: true,
    });
    expect(dirtyBlocked.decision).toBe("blocked");
    expect(dirtyBlocked.blockers).toContain("unexpected-dirty-state");
    expect(dirtyBlocked.summary).toContain("unexpectedDirty=yes");

    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof guardrailsAgentRun>[0];
    guardrailsAgentRun(pi);
    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agent_run_executor_strategy_packet");
    const tool = toolCall?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
    };
    const result = tool.execute("tc-executor-strategy", {
      failure_class: "silent-runner-failure",
      subprocess_diagnostics_available: true,
      sdk_runtime_available: true,
      budget_decision: "ok",
      runtime_mode: "windows",
      requires_direct_event_stream: true,
    }, undefined as unknown as AbortSignal, () => {}, { cwd: process.cwd() });
    expect(result.details?.mode).toBe("agent-run-executor-strategy-packet");
    expect(result.details?.processStartAllowed).toBe(false);
    expect(result.content?.[0]?.text).toContain("preferred=pi-sdk-in-process");
    expect(result.content?.[0]?.text).toContain("subprocessRetained=yes");
    expect(result.content?.[0]?.text).toContain("runtime=windows");
  });

  it("keeps SDK worker dispatch isolated from extension monitors and bounded loops", () => {
    const source = readFileSync("packages/pi-stack/extensions/guardrails-core-agent-run-surface-runtime.ts", "utf8");
    expect(source).toContain("DefaultResourceLoader");
    expect(source).toContain("SettingsManager.inMemory");
    expect(source).toContain("noExtensions: true");
    expect(source).toContain("noSkills: true");
    expect(source).toContain("noPromptTemplates: true");
    expect(source).toContain("noContextFiles: true");
    expect(source).toContain("resourceLoader=minimal-noExtensions-noSkills-noPrompts-noContext");
    expect(source).toContain("loopGuards maxToolCalls");
    expect(source).toContain("toolPolicy=");
    expect(source).toContain("buildSdkScopedWorkerPrompt");
    expect(source).toContain("Declared files (only these exact paths are allowed");
    expect(source).toContain("When calling a path-scoped tool, pass one of those exact paths");
    expect(source).toContain("sdk-runner-loop-guard");
    expect(source).toContain("loop-guard-with-output");
    expect(source).toContain("readOnlyFinalOutputAfterTurnLoop");
    expect(source).toContain("sdk-runner-empty-output");
    expect(source).toContain("sdk-runner-tool-policy-unsupported");
    expect(source).toContain("SDK_ASSISTANT_OUTPUT_LOG_MAX_BYTES");
    expect(source).toContain("assistant-output-truncated");
    expect(source).toContain("outputCapture.streamedText += assistantMessageEvent.delta");
    expect(source).toContain("appendAssistantOutput(logPath, outputCapture.streamedText, outputCapture)");
    expect(source).not.toContain("extractAssistantTextFromUnknownMessage(row.message) || outputCapture.streamedText");
    expect(source).not.toContain("stateMessages.map(extractAssistantTextFromUnknownMessage)");
    expect(source).not.toContain("appendAgentRunLogLine(logPath, assistantMessageEvent.delta)");
    expect(source).toContain("expandPromptTemplates: false");
  });

  it("enforces declared file scope through reusable SDK tool policy wrappers", () => {
    const cwd = process.cwd();
    const allowed = evaluateDeclaredPathPolicy({ path: "packages/pi-stack/README.md" }, {
      cwd,
      declaredFiles: ["packages/pi-stack/README.md"],
      pathFields: ["path"],
      requiredPathFields: ["path"],
    });
    expect(allowed.ok).toBe(true);

    const outside = evaluateDeclaredPathPolicy({ path: ".project/tasks.json" }, {
      cwd,
      declaredFiles: ["packages/pi-stack/README.md"],
      pathFields: ["path"],
      requiredPathFields: ["path"],
    });
    expect(outside).toMatchObject({ ok: false, reason: "path-outside-declared-files", field: "path" });

    const missing = evaluateDeclaredPathPolicy({ pattern: "silent-runner" }, {
      cwd,
      declaredFiles: ["packages/pi-stack/README.md"],
      pathFields: ["path"],
      requiredPathFields: ["path"],
      forbiddenFields: ["glob"],
    });
    expect(missing).toMatchObject({ ok: false, reason: "required-path-field-missing", field: "path" });

    const globBlocked = evaluateDeclaredPathPolicy({ pattern: "silent-runner", path: "packages/pi-stack/README.md", glob: "**/*" }, {
      cwd,
      declaredFiles: ["packages/pi-stack/README.md"],
      pathFields: ["path"],
      requiredPathFields: ["path"],
      forbiddenFields: ["glob"],
    });
    expect(globBlocked).toMatchObject({ ok: false, reason: "forbidden-path-field", field: "glob" });

    const plan = buildDeclaredFileScopedSdkWorkerTools({
      cwd,
      declaredFiles: ["packages/pi-stack/README.md"],
      toolAllowlist: ["read", "grep", "write", "edit", "find"],
      toolFactory: {
        read: () => ({ name: "read", description: "read", execute: vi.fn() }),
        grep: () => ({ name: "grep", description: "grep", execute: vi.fn() }),
        write: () => ({ name: "write", description: "write", execute: vi.fn() }),
        edit: () => ({ name: "edit", description: "edit", execute: vi.fn() }),
      },
    });
    expect(plan.customTools.map((tool) => tool.name)).toEqual(["read", "grep", "write", "edit"]);
    expect(plan.unsupportedTools).toEqual(["find"]);
    expect(plan.policySummary.join("\n")).toContain("read:path=>declared-files");
    expect(plan.policySummary.join("\n")).toContain("grep:path=>declared-files;glob=blocked");
    expect(plan.policySummary.join("\n")).toContain("write:path=>declared-files");
    expect(plan.policySummary.join("\n")).toContain("edit:path=>declared-files");
  });

  it("classifies runner failures before another worker retry", () => {
    const silentLog = [
      "[agent-runner] starting command=node source=current-node-entrypoint cwd=C:/repo",
      "[agent-runner] argv=[\"cli.js\",\"--no-session\",\"--model\",\"openai-codex/gpt-5.3-codex-spark\",\"--tools\",\"read,grep,find,ls,edit,write\",\"--print\",\"@packages/pi-stack/extensions/context-watchdog-continuation-surface.ts\",\"do work\"]",
      "[agent-runner] failure code=silent-runner-failure message=subprocess exited non-zero without stdout/stderr; inspect argv/cwd/source and provider/toolkit setup",
      "[agent-runner] close exitCode=1 childOutputBytes=0",
    ].join("\n");
    const result = classifyAgentRunFailure({
      runId: "task-bud-1063-spark-model-scope-budget-post-reload",
      entry: {
        runId: "task-bud-1063-spark-model-scope-budget-post-reload",
        state: "failed",
        providerModelRef: "openai-codex/gpt-5.3-codex-spark",
        errorCode: "silent-runner-failure",
        exitCode: 1,
      },
      logText: silentLog,
    });

    expect(result.failureClass).toBe("silent-runner-failure");
    expect(result.preflightDecision).toBe("needs-evidence");
    expect(result.retryAllowed).toBe(false);
    expect(result.ruledOut).toContain("static-cli-argv-shape");
    expect(result.ruledOut).toContain("static-tool-allowlist");
    expect(result.ruledOut).toContain("minimal-no-extensions-isolation");
    expect(result.argvDiagnostics.extensionIsolation).toBe("inherit");
    expect(result.argvDiagnostics.cliMode).toBe("print");
    expect(result.nextProbeProfiles).toContain("json-mode-structured-probe");
    expect(result.nextProbeProfiles).toContain("package-root-cli-resolution-probe");
    expect(result.nextProbeProfiles).toContain("stream-byte-split-probe");
    expect(result.nextProbeProfiles).toContain("stderr-preservation-probe");
    expect(result.nextActions.join("\n")).toContain("known-good local runner examples");

    const startupProbe = buildAgentRunStartupDiagnosticPacket({
      runId: "silent",
      logText: silentLog,
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      budgetDecision: "ok",
      liveReloadCompleted: true,
    });
    expect(startupProbe).toMatchObject({
      mode: "agent-run-startup-diagnostic-packet",
      dispatchAllowed: false,
      processStartAllowed: false,
      canaryAllowed: false,
      decision: "structured-probe-first",
      recommendationCode: "agent-run-startup-structured-probe-first",
      failureClass: "silent-runner-failure",
    });
    expect(startupProbe.probeProfiles).toContain("stderr-preservation-probe");
    expect(startupProbe.evidenceChecklist).toContain("stdout-and-stderr-byte-counts-captured");
    expect(startupProbe.evidenceChecklist).toContain("stdout-stderr-byte-split-captured");

    const invalidTools = classifyAgentRunFailure({
      runId: "bad-tools",
      logText: "[agent-runner] argv=[\"cli.js\",\"--no-session\",\"--model\",\"p/m\",\"--tools\",\"read,rm\",\"--print\",\"prompt\"]\n[agent-runner] close exitCode=1 childOutputBytes=10",
    });
    expect(invalidTools.failureClass).toBe("tool-allowlist-invalid");
    expect(invalidTools.preflightDecision).toBe("blocked");

    const sdkNestedLogLoop = classifyAgentRunFailure({
      runId: "sdk-loop-with-nested-log",
      logText: [
        "[sdk-runner] toolPolicy=read:path=>declared-files,grep:path=>declared-files;glob=blocked",
        "[sdk-runner] close state=failed reason=tool-policy-unsupported tools=find,ls",
        "worker copied an older log above as evidence",
        "[sdk-runner] event=agent_end",
        "[sdk-runner] close state=failed reason=loop-guard outputBytes=48000",
      ].join("\n"),
    });
    expect(sdkNestedLogLoop.failureClass).toBe("worker-contract-failed");
    expect(sdkNestedLogLoop.blockers).toContain("sdk-runner-loop-guard");
    expect(sdkNestedLogLoop.evidence).toContain("sdkCloseReason=loop-guard");

    const promptOnlyProviderMarker = classifyAgentRunFailure({
      runId: "prompt-only-provider-marker",
      logText: [
        "[agent-runner] argv=[\"cli.js\",\"--no-session\",\"--model\",\"p/m\",\"--tools\",\"read\",\"--print\",\"Acceptance criterion: classify provider-unavailable separately\"]",
        "[agent-runner] failure code=silent-runner-failure message=subprocess exited non-zero without stdout/stderr",
        "[agent-runner] close exitCode=1 childOutputBytes=0 stdoutBytes=0 stderrBytes=0",
      ].join("\n"),
    });
    expect(promptOnlyProviderMarker.failureClass).toBe("silent-runner-failure");

    const timeoutResult = classifyAgentRunFailure({
      runId: "task-bud-1066-subprocess-preflight-canary",
      entry: { runId: "task-bud-1066-subprocess-preflight-canary", state: "timed-out", exitCode: 124, errorCode: "runner-timeout" },
      logText: [
        "[agent-runner] argv=[\"cli.js\",\"--no-session\",\"--model\",\"openai-codex/gpt-5.3-codex-spark\",\"--tools\",\"read,grep,find,ls\",\"--print\",\"@docs/research/agent-runner-maturity-checkpoint-2026-05.md\",\"diagnose\"]",
        "[agent-runner] failure code=silent-runner-failure message=subprocess exited non-zero without stdout/stderr",
        "[agent-runner] failure code=runner-timeout message=subprocess exceeded timeoutMs=60000 elapsedMs=60025",
        "[agent-runner] close exitCode=124 signal=SIGTERM timedOut=yes elapsedMs=60031 childOutputBytes=0 stdoutBytes=0 stderrBytes=0",
      ].join("\n"),
    });
    expect(timeoutResult.failureClass).toBe("runner-timeout");
    expect(timeoutResult.recommendationCode).toBe("agent-runner-classification-runner-timeout");
    expect(timeoutResult.preflightDecision).toBe("needs-evidence");
    expect(timeoutResult.retryAllowed).toBe(false);
    expect(timeoutResult.evidence).toContain("timeoutMs=60000");
    expect(timeoutResult.evidence).toContain("elapsedMs=60025");
    expect(timeoutResult.evidence).toContain("signal=SIGTERM");
    expect(timeoutResult.evidence).toContain("timedOut=yes");
    expect(timeoutResult.nextProbeProfiles).toContain("timeout-budget-probe");
    expect(timeoutResult.nextProbeProfiles).toContain("startup-hang-probe");
    expect(timeoutResult.nextActions.join("\n")).toContain("startup/handshake hang");

    const timeoutStartupProbe = buildAgentRunStartupDiagnosticPacket({
      runId: "task-bud-1066-subprocess-preflight-canary",
      logText: `${timeoutResult.evidence.join("\n")}\n[agent-runner] failure code=runner-timeout\n[agent-runner] close exitCode=124 timedOut=yes childOutputBytes=0 stdoutBytes=0 stderrBytes=0`,
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      budgetDecision: "ok",
      liveReloadCompleted: true,
    });
    expect(timeoutStartupProbe.decision).toBe("structured-probe-first");
    expect(timeoutStartupProbe.failureClass).toBe("runner-timeout");
    expect(timeoutStartupProbe.canaryAllowed).toBe(false);
    expect(timeoutStartupProbe.probeProfiles).toContain("timeout-budget-probe");
    expect(timeoutStartupProbe.evidenceChecklist).toContain("timeout-ms-captured");
    expect(timeoutStartupProbe.evidenceChecklist).toContain("elapsed-ms-captured");
    expect(timeoutStartupProbe.evidenceChecklist).toContain("termination-signal-captured");
    expect(timeoutStartupProbe.evidenceChecklist).toContain("timed-out-flag-captured");
    expect(timeoutStartupProbe.startupProbePlan.map((step) => step.id)).toEqual([
      "timeout-budget-probe",
      "startup-hang-probe",
      "json-mode-structured-probe",
      "stderr-preservation-probe",
    ]);
    expect(timeoutStartupProbe.startupProbePlan.every((step) => step.modelCallAllowed === false && step.dispatchAllowed === false)).toBe(true);
    expect(timeoutStartupProbe.startupProbePlan.find((step) => step.id === "timeout-budget-probe")?.evidence).toContain("elapsedMs");

    const providerUnavailable = classifyAgentRunFailure({
      runId: "quota",
      logText: "[agent-runner] close exitCode=1 childOutputBytes=40\nProvider error: 429 insufficient_quota",
    });
    expect(providerUnavailable.failureClass).toBe("provider-unavailable");

    const contractFailed = classifyAgentRunFailure({
      runId: "task-bud-1027-small-mutation-doc-canary",
      entry: { runId: "task-bud-1027-small-mutation-doc-canary", state: "completed", exitCode: 0, outputBytes: 474 },
      logText: "[agent-runner] close exitCode=0",
      touchedFiles: [],
      markerFailures: ["marker missing after worker self-reported PASS"],
    });
    expect(contractFailed.failureClass).toBe("worker-contract-failed");
    expect(contractFailed.retryAllowed).toBe(false);
  });
});
