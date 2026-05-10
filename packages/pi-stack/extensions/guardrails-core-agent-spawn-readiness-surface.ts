import { AuthStorage, createAgentSession, DefaultResourceLoader, getAgentDir, ModelRegistry, SessionManager, SettingsManager, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { evaluateAgentSpawnReadiness } from "./guardrails-core-agent-spawn-readiness";
import { buildAgentRunPlan } from "./guardrails-core-agent-run-plan";
import { buildAgentRunStartupDiagnosticPacket, classifyAgentRunFailure } from "./guardrails-core-agent-run-diagnostics";
import { buildAgentRunExecutorStrategyPacket } from "./guardrails-core-agent-run-executor-strategy";
import { buildAgentRunSdkInProcessPacket, type AgentRunSdkInProcessPacketResult } from "./guardrails-core-agent-run-sdk-preview";
import { buildAgentRunAbortPlan, buildAgentRunOutcomePacket, buildAgentRunRegistryUpsertPacket, buildAgentRunStatus, type AgentRunMarkerResult, type AgentRunRegistryEntry, type AgentRunState } from "./guardrails-core-agent-run-runtime";
import { buildAgentInvocationSpecPacket, buildAgentRunOperatorPacket, buildAgentRunStartPacket, buildAgentRunTaskPacket, buildAgentRunTaskStartPacket } from "./guardrails-core-agent-run-start";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";
import { readTasksBlockCached } from "./project-board-model";
import { buildDeclaredFileScopedSdkWorkerTools } from "./guardrails-core-tool-policy";

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function asMarkerResults(value: unknown): AgentRunMarkerResult[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is AgentRunMarkerResult => !!entry && typeof entry === "object").map((entry) => {
    const row = entry as Record<string, unknown>;
    return {
      ...(typeof row.label === "string" ? { label: row.label } : {}),
      ...(typeof row.ok === "boolean" ? { ok: row.ok } : {}),
    };
  });
}

function registryPath(cwd: string): string {
  return path.join(cwd, ".pi", "reports", "agent-runs.json");
}

function readRegistryRows(cwd: string): AgentRunRegistryEntry[] {
  const filePath = registryPath(cwd);
  if (!existsSync(filePath)) return [];
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { runs?: AgentRunRegistryEntry[] } | AgentRunRegistryEntry[];
  return Array.isArray(parsed) ? parsed : Array.isArray(parsed.runs) ? parsed.runs : [];
}

function readRegistryEntry(cwd: string, runId: string): AgentRunRegistryEntry | undefined {
  return readRegistryRows(cwd).find((row) => row?.runId === runId);
}

function writeRegistryEntry(cwd: string, entry: AgentRunRegistryEntry): void {
  const filePath = registryPath(cwd);
  const rows = readRegistryRows(cwd).filter((row) => row?.runId !== entry.runId);
  rows.push(entry);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify({ runs: rows }, null, 2), "utf8");
}

function readLogTail(logPath: string, maxLines: number): string[] {
  if (!logPath || !existsSync(logPath)) return [];
  const text = readFileSync(logPath, "utf8");
  return text.split(/\r?\n/).slice(-Math.max(1, Math.min(500, Math.floor(maxLines))));
}

function readLogByteCount(logPath: string | undefined): number {
  if (!logPath || !existsSync(logPath)) return 0;
  return statSync(logPath).size;
}

function isTerminalAgentRunState(state: AgentRunState): boolean {
  return state === "completed" || state === "failed" || state === "timed-out" || state === "aborted";
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolvePiSubprocessInvocation(preview: { command: string; args: string[] }): { command: string; args: string[]; source: "current-node-entrypoint" | "preview-command" } {
  const currentEntrypoint = typeof process.argv[1] === "string" && process.argv[1].trim() ? process.argv[1] : "";
  if (currentEntrypoint && preview.command === "pi") {
    return { command: process.execPath, args: [currentEntrypoint, ...preview.args], source: "current-node-entrypoint" };
  }
  return { command: preview.command, args: preview.args, source: "preview-command" };
}

function appendAgentRunLogLine(logPath: string, line: string): void {
  mkdirSync(path.dirname(logPath), { recursive: true });
  writeFileSync(logPath, `${line}\n`, { flag: "a", encoding: "utf8" });
}

function formatAgentRunnerArgvForLog(args: string[], maxChars = 2000): string {
  const rendered = JSON.stringify(args);
  return rendered.length <= maxChars ? rendered : `${rendered.slice(0, maxChars)}...[truncated:${rendered.length - maxChars}]`;
}

function resolveSdkModelRef(providerModelRef: string): { provider: string; modelId: string } | undefined {
  const slashIndex = providerModelRef.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= providerModelRef.length - 1) return undefined;
  return { provider: providerModelRef.slice(0, slashIndex), modelId: providerModelRef.slice(slashIndex + 1) };
}

function extractAssistantTextFromUnknownMessage(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  const content = row.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    const item = part as Record<string, unknown>;
    return typeof item.text === "string" ? item.text : "";
  }).join("");
}

function appendAssistantOutput(logPath: string, text: string, seenOutput: Set<string>): number {
  const normalized = text.trim();
  if (!normalized || seenOutput.has(normalized)) return 0;
  seenOutput.add(normalized);
  appendAgentRunLogLine(logPath, normalized);
  return Buffer.byteLength(normalized);
}

function formatSdkDeclaredFilesForPrompt(declaredFiles: string[]): string {
  return declaredFiles.map((file) => `- ${file}`).join("\n");
}

function buildSdkScopedWorkerPrompt(goal: string, declaredFiles: string[]): string {
  return [
    "Declared files (only these exact paths are allowed unless a declared entry is a directory):",
    formatSdkDeclaredFilesForPrompt(declaredFiles),
    "",
    goal,
  ].join("\n");
}

function startSdkInProcessWorker(ctxCwd: string, packet: AgentRunSdkInProcessPacketResult): { logPath: string } {
  const runId = packet.runSpec.runId;
  const logPath = path.join(ctxCwd, ".pi", "reports", `${runId}.sdk.log`);
  const startedAtIso = new Date().toISOString();
  const initialEntry: AgentRunRegistryEntry = {
    runId,
    state: "running",
    providerModelRef: packet.runSpec.providerModelRef,
    cwd: packet.runSpec.cwd,
    declaredFiles: packet.runSpec.declaredFiles,
    logPath,
    timeoutMs: packet.runSpec.timeoutMs,
    startedAtIso,
    lastEventAtIso: startedAtIso,
  };
  writeRegistryEntry(ctxCwd, initialEntry);
  appendAgentRunLogLine(logPath, `[sdk-runner] starting runId=${runId} cwd=${packet.runSpec.cwd} model=${packet.runSpec.providerModelRef} session=${packet.runSpec.sessionMode}`);
  appendAgentRunLogLine(logPath, `[sdk-runner] tools=${packet.runSpec.toolAllowlist.join(",")}`);

  void (async () => {
    const maxToolCalls = Math.max(1, Math.min(12, packet.runSpec.toolAllowlist.length * 3));
    const maxTurns = 4;
    let outputBytes = 0;
    let timedOut = false;
    let loopAbortReason = "";
    let toolCallCount = 0;
    let turnCount = 0;
    const seenOutput = new Set<string>();
    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    const finish = (entry: Partial<AgentRunRegistryEntry>) => {
      writeRegistryEntry(ctxCwd, {
        ...initialEntry,
        ...entry,
        outputBytes: entry.outputBytes ?? outputBytes,
        lastEventAtIso: new Date().toISOString(),
      });
    };

    try {
      const resolved = resolveSdkModelRef(packet.runSpec.providerModelRef);
      if (!resolved) throw new Error("provider-model-ref-invalid");
      const authStorage = AuthStorage.create();
      const modelRegistry = ModelRegistry.create(authStorage);
      const model = modelRegistry.find(resolved.provider, resolved.modelId);
      if (!model) throw new Error(`model-not-found:${packet.runSpec.providerModelRef}`);
      const sessionManager = packet.runSpec.sessionMode === "run-session-dir" ? SessionManager.create(packet.runSpec.cwd) : SessionManager.inMemory(packet.runSpec.cwd);
      const settingsManager = SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0, timeoutMs: packet.runSpec.timeoutMs } },
        defaultThinkingLevel: "off",
      });
      const resourceLoader = new DefaultResourceLoader({
        cwd: packet.runSpec.cwd,
        agentDir: getAgentDir(),
        settingsManager,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPromptOverride: () => [
          "You are a bounded SDK worker canary.",
          "Return a concise final answer and stop.",
          "Do not call tools repeatedly; inspect only what is necessary.",
          "Declared files are the only allowed filesystem scope:",
          formatSdkDeclaredFilesForPrompt(packet.runSpec.declaredFiles),
          "When calling a path-scoped tool, pass one of those exact paths unless a declared entry is a directory.",
        ].join("\n"),
      });
      await resourceLoader.reload();
      appendAgentRunLogLine(logPath, "[sdk-runner] resourceLoader=minimal-noExtensions-noSkills-noPrompts-noContext");
      appendAgentRunLogLine(logPath, `[sdk-runner] loopGuards maxToolCalls=${maxToolCalls} maxTurns=${maxTurns}`);
      const toolPolicy = buildDeclaredFileScopedSdkWorkerTools({
        cwd: packet.runSpec.cwd,
        declaredFiles: packet.runSpec.declaredFiles,
        toolAllowlist: packet.runSpec.toolAllowlist,
      });
      appendAgentRunLogLine(logPath, `[sdk-runner] toolPolicy=${toolPolicy.policySummary.join(",") || "none"}`);
      if (toolPolicy.unsupportedTools.length > 0) {
        const message = `unsupported SDK worker tools without policy metadata: ${toolPolicy.unsupportedTools.join(",")}`;
        finish({ state: "failed", errorCode: "sdk-runner-tool-policy-unsupported", errorMessage: message, outputBytes });
        appendAgentRunLogLine(logPath, `[sdk-runner] close state=failed reason=tool-policy-unsupported tools=${toolPolicy.unsupportedTools.join(",")}`);
        return;
      }
      const created = await createAgentSession({
        cwd: packet.runSpec.cwd,
        model,
        authStorage,
        modelRegistry,
        resourceLoader,
        sessionManager,
        settingsManager,
        tools: packet.runSpec.toolAllowlist,
        customTools: toolPolicy.customTools,
      });
      session = created.session;
      const unsubscribe = session.subscribe((event: unknown) => {
        const row = event as Record<string, unknown>;
        if (row.type === "message_update") {
          const assistantMessageEvent = row.assistantMessageEvent as Record<string, unknown> | undefined;
          if (assistantMessageEvent?.type === "text_delta" && typeof assistantMessageEvent.delta === "string") {
            outputBytes += Buffer.byteLength(assistantMessageEvent.delta);
            appendAgentRunLogLine(logPath, assistantMessageEvent.delta);
          }
        } else if (row.type === "tool_execution_end") {
          toolCallCount += 1;
          appendAgentRunLogLine(logPath, `[sdk-runner] tool_execution_end count=${toolCallCount} isError=${String(row.isError ?? "unknown")}`);
          if (toolCallCount > maxToolCalls && !loopAbortReason) {
            loopAbortReason = `sdk-runner-tool-loop toolCalls=${toolCallCount} maxToolCalls=${maxToolCalls}`;
            appendAgentRunLogLine(logPath, `[sdk-runner] loop-guard ${loopAbortReason}; aborting session`);
            void session?.abort();
          }
        } else if (row.type === "turn_end") {
          turnCount += 1;
          const text = extractAssistantTextFromUnknownMessage(row.message);
          outputBytes += appendAssistantOutput(logPath, text, seenOutput);
          appendAgentRunLogLine(logPath, `[sdk-runner] event=turn_end count=${turnCount}`);
          if (turnCount > maxTurns && !loopAbortReason) {
            loopAbortReason = `sdk-runner-turn-loop turns=${turnCount} maxTurns=${maxTurns}`;
            appendAgentRunLogLine(logPath, `[sdk-runner] loop-guard ${loopAbortReason}; aborting session`);
            void session?.abort();
          }
        } else if (row.type === "agent_end") {
          const messages = Array.isArray(row.messages) ? row.messages : [];
          const text = messages.map(extractAssistantTextFromUnknownMessage).join("\n").trim();
          outputBytes += appendAssistantOutput(logPath, text, seenOutput);
          appendAgentRunLogLine(logPath, "[sdk-runner] event=agent_end");
        }
      });
      const timeout = setTimeout(() => {
        timedOut = true;
        appendAgentRunLogLine(logPath, `[sdk-runner] timeout timeoutMs=${packet.runSpec.timeoutMs}; aborting session`);
        void session?.abort();
      }, packet.runSpec.timeoutMs);
      try {
        await session.prompt(buildSdkScopedWorkerPrompt(packet.runSpec.goal, packet.runSpec.declaredFiles), { expandPromptTemplates: false, source: "extension" });
      } finally {
        clearTimeout(timeout);
        const stateMessages = (session as unknown as { agent?: { state?: { messages?: unknown[] } }; messages?: unknown[] }).agent?.state?.messages
          ?? (session as unknown as { messages?: unknown[] }).messages
          ?? [];
        const fallbackText = stateMessages.map(extractAssistantTextFromUnknownMessage).join("\n").trim();
        outputBytes += appendAssistantOutput(logPath, fallbackText, seenOutput);
        unsubscribe();
        session.dispose();
      }
      if (loopAbortReason) {
        finish({ state: "failed", errorCode: "sdk-runner-loop-guard", errorMessage: loopAbortReason, outputBytes });
        appendAgentRunLogLine(logPath, `[sdk-runner] close state=failed reason=loop-guard outputBytes=${outputBytes}`);
        return;
      }
      if (timedOut) {
        finish({ state: "timed-out", errorCode: "sdk-runner-timeout", errorMessage: "SDK worker timed out and abort was requested", outputBytes });
        appendAgentRunLogLine(logPath, `[sdk-runner] close state=timed-out outputBytes=${outputBytes}`);
        return;
      }
      if (outputBytes <= 0) {
        finish({ state: "failed", errorCode: "sdk-runner-empty-output", errorMessage: "SDK worker completed without assistant text output", outputBytes });
        appendAgentRunLogLine(logPath, "[sdk-runner] close state=failed reason=empty-output outputBytes=0");
        return;
      }
      finish({ state: "completed", outputBytes });
      appendAgentRunLogLine(logPath, `[sdk-runner] close state=completed outputBytes=${outputBytes}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try { await session?.abort(); } catch { /* best-effort abort */ }
      try { session?.dispose(); } catch { /* best-effort dispose */ }
      finish({ state: "failed", errorCode: "sdk-runner-failed", errorMessage: message, outputBytes });
      appendAgentRunLogLine(logPath, `[sdk-runner] failure code=sdk-runner-failed message=${message}`);
      appendAgentRunLogLine(logPath, `[sdk-runner] close state=failed outputBytes=${outputBytes}`);
    }
  })();

  return { logPath };
}

export function registerGuardrailsAgentSpawnReadinessSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "agent_spawn_readiness_gate",
    label: "Agent Spawn Readiness Gate",
    description: "Report-only agent spawn readiness gate (single worker, timeout, cwd, budget, rollback, bounded scope). Never dispatches execution.",
    parameters: Type.Object({
      max_agents_requested: Type.Optional(Type.Number({ description: "Requested number of agents for this spawn attempt (must be 1 for agent-run lane)." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Explicit timeout in milliseconds (bounded)." })),
      cwd_isolation_known: Type.Optional(Type.Boolean({ description: "Whether cwd isolation is explicitly known." })),
      budget_known: Type.Optional(Type.Boolean({ description: "Whether bounded budget is explicitly known." })),
      rollback_plan_known: Type.Optional(Type.Boolean({ description: "Whether rollback plan is explicitly known." })),
      bounded_scope_known: Type.Optional(Type.Boolean({ description: "Whether bounded scope is explicitly known." })),
      live_reload_completed: Type.Optional(Type.Boolean({ description: "Whether live reload was completed before runtime invocation." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = evaluateAgentSpawnReadiness({
        maxAgentsRequested: typeof p.max_agents_requested === "number" ? p.max_agents_requested : undefined,
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        cwdIsolationKnown: asOptionalBoolean(p.cwd_isolation_known),
        budgetKnown: asOptionalBoolean(p.budget_known),
        rollbackPlanKnown: asOptionalBoolean(p.rollback_plan_known),
        boundedScopeKnown: asOptionalBoolean(p.bounded_scope_known),
        liveReloadCompleted: asOptionalBoolean(p.live_reload_completed),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_spawn_readiness_gate",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_plan",
    label: "Agent Run Plan",
    description: "Report-only agent run packet with provider/model, declared files, timeout, validation, rollback, budget, abort, and log-tail gates. Never dispatches execution.",
    parameters: Type.Object({
      goal: Type.Optional(Type.String({ description: "Run goal for the future worker." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference, e.g. openai-codex/gpt-5.3-codex-spark." })),
      cwd: Type.Optional(Type.String({ description: "Explicit worker cwd." })),
      declared_files: Type.Optional(Type.Array(Type.String(), { description: "Exact file scope for the future worker." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Short bounded timeout in milliseconds." })),
      validation_gate_known: Type.Optional(Type.Boolean({ description: "Whether parent-side validation is known before dispatch." })),
      rollback_plan_known: Type.Optional(Type.Boolean({ description: "Whether rollback is explicit and non-destructive." })),
      budget_known: Type.Optional(Type.Boolean({ description: "Whether provider/cost budget is bounded." })),
      abort_known: Type.Optional(Type.Boolean({ description: "Whether safe abort is available without killing the parent session." })),
      log_tail_known: Type.Optional(Type.Boolean({ description: "Whether bounded log/status visibility is available." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when settings/routing/CI/publish/credentials/remote/protected scope is requested." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = buildAgentRunPlan({
        goal: typeof p.goal === "string" ? p.goal : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        cwd: typeof p.cwd === "string" ? p.cwd : ctx?.cwd,
        declaredFiles: asOptionalStringArray(p.declared_files),
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        validationGateKnown: asOptionalBoolean(p.validation_gate_known),
        rollbackPlanKnown: asOptionalBoolean(p.rollback_plan_known),
        budgetKnown: asOptionalBoolean(p.budget_known),
        abortKnown: asOptionalBoolean(p.abort_known),
        logTailKnown: asOptionalBoolean(p.log_tail_known),
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_run_plan",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_start_packet",
    label: "Agent Run Start Packet",
    description: "Report-only provider-native agent-run start packet with exact pi subprocess argv preview. Never dispatches execution and always requires explicit human confirmation.",
    parameters: Type.Object({
      run_id: Type.Optional(Type.String({ description: "Agent run id for the future worker." })),
      executor_kind: Type.Optional(Type.String({ description: "Executor kind. Initial supported value: pi-print-subprocess." })),
      goal: Type.Optional(Type.String({ description: "Run goal/prompt for the future worker." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference, e.g. dashscope/qwen3-coder-plus." })),
      cwd: Type.Optional(Type.String({ description: "Explicit worker cwd." })),
      declared_files: Type.Optional(Type.Array(Type.String(), { description: "Exact file scope for the future worker." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Short bounded timeout in milliseconds." })),
      tool_allowlist: Type.Optional(Type.Array(Type.String(), { description: "Read-only tool allowlist for first provider-native canaries." })),
      session_isolation: Type.Optional(Type.String({ description: "Session isolation mode: no-session or run-session-dir." })),
      extension_isolation: Type.Optional(Type.String({ description: "Extension isolation mode: minimal-no-extensions or inherit. Defaults to minimal-no-extensions for nested provider-native workers." })),
      log_path: Type.Optional(Type.String({ description: "Bounded log path for stdout/stderr metadata." })),
      budget_decision: Type.Optional(Type.String({ description: "Provider/model budget decision for this run: ok, warn, blocked, or unknown. Missing/blocked keeps packet blocked." })),
      budget_evidence: Type.Optional(Type.String({ description: "Short provider/model budget evidence, e.g. dashscope ok or openai-codex spark pool evidence." })),
      budget_evidence_source: Type.Optional(Type.String({ description: "Budget evidence source: route-advisory, provider-budget-snapshot, manual, or unknown." })),
      budget_evidence_provider: Type.Optional(Type.String({ description: "Provider named by the budget evidence, used to detect route/start mismatches." })),
      budget_evidence_generated_at_iso: Type.Optional(Type.String({ description: "ISO timestamp for structured budget evidence freshness checks." })),
      budget_evidence_max_age_ms: Type.Optional(Type.Number({ description: "Optional max age for structured budget evidence freshness." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope is requested." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = buildAgentRunStartPacket({
        runId: typeof p.run_id === "string" ? p.run_id : undefined,
        executorKind: typeof p.executor_kind === "string" ? p.executor_kind : undefined,
        goal: typeof p.goal === "string" ? p.goal : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        cwd: typeof p.cwd === "string" ? p.cwd : ctx?.cwd,
        declaredFiles: asOptionalStringArray(p.declared_files),
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        toolAllowlist: asOptionalStringArray(p.tool_allowlist),
        sessionIsolation: typeof p.session_isolation === "string" ? p.session_isolation : undefined,
        extensionIsolation: typeof p.extension_isolation === "string" ? p.extension_isolation : undefined,
        logPath: typeof p.log_path === "string" ? p.log_path : undefined,
        budgetDecision: typeof p.budget_decision === "string" ? p.budget_decision : undefined,
        budgetEvidence: typeof p.budget_evidence === "string" ? p.budget_evidence : undefined,
        budgetEvidenceSource: typeof p.budget_evidence_source === "string" ? p.budget_evidence_source : undefined,
        budgetEvidenceProvider: typeof p.budget_evidence_provider === "string" ? p.budget_evidence_provider : undefined,
        budgetEvidenceGeneratedAtIso: typeof p.budget_evidence_generated_at_iso === "string" ? p.budget_evidence_generated_at_iso : undefined,
        budgetEvidenceMaxAgeMs: typeof p.budget_evidence_max_age_ms === "number" ? p.budget_evidence_max_age_ms : undefined,
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_run_start_packet",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_operator_packet",
    label: "Agent Run Operator Packet",
    description: "Report-only ergonomic provider-native agent-run packet with safe defaults, attached declared files, structured budget evidence, validation checklist, and exact argv preview. Never dispatches execution.",
    parameters: Type.Object({
      task_id: Type.Optional(Type.String({ description: "Focus task id for deriving a stable run id." })),
      run_id: Type.Optional(Type.String({ description: "Optional explicit run id; defaults from task_id + purpose." })),
      purpose: Type.Optional(Type.String({ description: "Short purpose slug/label for the run id." })),
      goal: Type.Optional(Type.String({ description: "Run goal/prompt for the worker." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference, e.g. dashscope/qwen3-coder-plus." })),
      cwd: Type.Optional(Type.String({ description: "Worker cwd. Defaults to current cwd." })),
      declared_files: Type.Optional(Type.Array(Type.String(), { description: "Exact file scope; these files are attached in the command preview." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Bounded timeout in milliseconds; defaults to 90000." })),
      file_contract: Type.Optional(Type.String({ description: "read-only or mutation. Defaults to read-only." })),
      budget_decision: Type.Optional(Type.String({ description: "Provider/model budget decision: ok, warn, blocked, or unknown." })),
      budget_evidence: Type.Optional(Type.String({ description: "Budget evidence text from route/provider-budget snapshot." })),
      budget_evidence_source: Type.Optional(Type.String({ description: "Budget evidence source: route-advisory, provider-budget-snapshot, manual, or unknown." })),
      budget_evidence_provider: Type.Optional(Type.String({ description: "Provider named by the budget evidence." })),
      budget_evidence_generated_at_iso: Type.Optional(Type.String({ description: "ISO timestamp for structured budget evidence freshness checks." })),
      budget_evidence_max_age_ms: Type.Optional(Type.Number({ description: "Optional max age for structured budget evidence freshness." })),
      economy_mode: Type.Optional(Type.String({ description: "Worker token/context economy mode: standard, conserve, or critical. Defaults to conserve." })),
      token_budget_evidence: Type.Optional(Type.String({ description: "Short provider/model quota evidence to embed in the worker economy contract." })),
      max_output_lines: Type.Optional(Type.Number({ description: "Bounded worker output line target for economy contract." })),
      extension_isolation: Type.Optional(Type.String({ description: "Extension isolation mode: minimal-no-extensions or inherit. Defaults to minimal-no-extensions unless a custom provider requires inherited extensions." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope is requested." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = buildAgentRunOperatorPacket({
        taskId: typeof p.task_id === "string" ? p.task_id : undefined,
        runId: typeof p.run_id === "string" ? p.run_id : undefined,
        purpose: typeof p.purpose === "string" ? p.purpose : undefined,
        goal: typeof p.goal === "string" ? p.goal : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        cwd: typeof p.cwd === "string" ? p.cwd : ctx?.cwd,
        declaredFiles: asOptionalStringArray(p.declared_files),
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        fileContract: typeof p.file_contract === "string" ? p.file_contract : undefined,
        budgetDecision: typeof p.budget_decision === "string" ? p.budget_decision : undefined,
        budgetEvidence: typeof p.budget_evidence === "string" ? p.budget_evidence : undefined,
        budgetEvidenceSource: typeof p.budget_evidence_source === "string" ? p.budget_evidence_source : undefined,
        budgetEvidenceProvider: typeof p.budget_evidence_provider === "string" ? p.budget_evidence_provider : undefined,
        budgetEvidenceGeneratedAtIso: typeof p.budget_evidence_generated_at_iso === "string" ? p.budget_evidence_generated_at_iso : undefined,
        budgetEvidenceMaxAgeMs: typeof p.budget_evidence_max_age_ms === "number" ? p.budget_evidence_max_age_ms : undefined,
        economyMode: typeof p.economy_mode === "string" ? p.economy_mode : undefined,
        tokenBudgetEvidence: typeof p.token_budget_evidence === "string" ? p.token_budget_evidence : undefined,
        maxOutputLines: typeof p.max_output_lines === "number" ? p.max_output_lines : undefined,
        extensionIsolation: typeof p.extension_isolation === "string" ? p.extension_isolation : undefined,
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_run_operator_packet",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_invocation_spec_packet",
    label: "Agent Invocation Spec Packet",
    description: "Report-only typed AgentInvocationSpec packet for provider-native workers. Generates a bounded execution preview without dispatching or hand-assembling argv.",
    parameters: Type.Object({
      task_id: Type.Optional(Type.String({ description: "Focus task id for deriving a stable run id." })),
      run_id: Type.Optional(Type.String({ description: "Optional explicit run id; defaults from task_id + purpose." })),
      purpose: Type.Optional(Type.String({ description: "Short purpose slug/label for the run id." })),
      profile: Type.Optional(Type.String({ description: "Invocation profile: read-only-review, small-mutation, test-fix, or research." })),
      goal: Type.Optional(Type.String({ description: "Run goal/prompt for the worker." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference, e.g. dashscope/qwen3-coder-plus." })),
      cwd: Type.Optional(Type.String({ description: "Worker cwd. Defaults to current cwd." })),
      declared_files: Type.Optional(Type.Array(Type.String(), { description: "Exact file scope; these files are attached in the execution preview." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Bounded timeout in milliseconds; defaults to 90000." })),
      file_contract: Type.Optional(Type.String({ description: "read-only or mutation. Defaults from profile." })),
      validation: Type.Optional(Type.Array(Type.String(), { description: "Parent-side validation gates; required for mutation profiles." })),
      rollback: Type.Optional(Type.Array(Type.String(), { description: "Non-destructive rollback cues; required for mutation profiles." })),
      output_schema: Type.Optional(Type.String({ description: "Optional output schema/contract label; otherwise non-empty text is required." })),
      budget_decision: Type.Optional(Type.String({ description: "Provider/model budget decision: ok, warn, blocked, or unknown." })),
      budget_evidence: Type.Optional(Type.String({ description: "Budget evidence text from route/provider-budget snapshot." })),
      budget_evidence_source: Type.Optional(Type.String({ description: "Budget evidence source: route-advisory, provider-budget-snapshot, manual, or unknown." })),
      budget_evidence_provider: Type.Optional(Type.String({ description: "Provider named by the budget evidence." })),
      budget_evidence_generated_at_iso: Type.Optional(Type.String({ description: "ISO timestamp for structured budget evidence freshness checks." })),
      budget_evidence_max_age_ms: Type.Optional(Type.Number({ description: "Optional max age for structured budget evidence freshness." })),
      economy_mode: Type.Optional(Type.String({ description: "Worker token/context economy mode: standard, conserve, or critical. Defaults to conserve." })),
      token_budget_evidence: Type.Optional(Type.String({ description: "Short provider/model quota evidence to embed in the worker economy contract." })),
      max_output_lines: Type.Optional(Type.Number({ description: "Bounded worker output line target for economy contract." })),
      extension_isolation: Type.Optional(Type.String({ description: "Extension isolation mode: minimal-no-extensions or inherit. Defaults to minimal-no-extensions unless a custom provider requires inherited extensions." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope is requested." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = buildAgentInvocationSpecPacket({
        taskId: typeof p.task_id === "string" ? p.task_id : undefined,
        runId: typeof p.run_id === "string" ? p.run_id : undefined,
        purpose: typeof p.purpose === "string" ? p.purpose : undefined,
        profile: typeof p.profile === "string" ? p.profile : undefined,
        goal: typeof p.goal === "string" ? p.goal : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        cwd: typeof p.cwd === "string" ? p.cwd : ctx?.cwd,
        declaredFiles: asOptionalStringArray(p.declared_files),
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        fileContract: typeof p.file_contract === "string" ? p.file_contract : undefined,
        validation: asOptionalStringArray(p.validation),
        rollback: asOptionalStringArray(p.rollback),
        outputSchema: typeof p.output_schema === "string" ? p.output_schema : undefined,
        budgetDecision: typeof p.budget_decision === "string" ? p.budget_decision : undefined,
        budgetEvidence: typeof p.budget_evidence === "string" ? p.budget_evidence : undefined,
        budgetEvidenceSource: typeof p.budget_evidence_source === "string" ? p.budget_evidence_source : undefined,
        budgetEvidenceProvider: typeof p.budget_evidence_provider === "string" ? p.budget_evidence_provider : undefined,
        budgetEvidenceGeneratedAtIso: typeof p.budget_evidence_generated_at_iso === "string" ? p.budget_evidence_generated_at_iso : undefined,
        budgetEvidenceMaxAgeMs: typeof p.budget_evidence_max_age_ms === "number" ? p.budget_evidence_max_age_ms : undefined,
        economyMode: typeof p.economy_mode === "string" ? p.economy_mode : undefined,
        tokenBudgetEvidence: typeof p.token_budget_evidence === "string" ? p.token_budget_evidence : undefined,
        maxOutputLines: typeof p.max_output_lines === "number" ? p.max_output_lines : undefined,
        extensionIsolation: typeof p.extension_isolation === "string" ? p.extension_isolation : undefined,
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_invocation_spec_packet",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_task_packet",
    label: "Agent Run Task Packet",
    description: "Report-only board-to-agent packetizer. Reads one .project task and derives a typed invocation spec, validation/rollback checklist, scoped budget evidence, and exact confirmation phrase. Never dispatches execution.",
    parameters: Type.Object({
      task_id: Type.String({ description: "Board task id to packetize." }),
      purpose: Type.Optional(Type.String({ description: "Short purpose slug/label for the run id. Defaults to task-packet." })),
      profile: Type.Optional(Type.String({ description: "Invocation profile: small-mutation, test-fix, read-only-review, or research. Defaults to small-mutation." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference, e.g. openai-codex/gpt-5.3-codex-spark." })),
      cwd: Type.Optional(Type.String({ description: "Worker cwd. Defaults to current cwd." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Bounded timeout in milliseconds; defaults to 90000." })),
      budget_decision: Type.Optional(Type.String({ description: "Provider/model budget decision: ok, warn, blocked, or unknown." })),
      budget_evidence: Type.Optional(Type.String({ description: "Scoped provider/model budget evidence, preferably model-specific." })),
      budget_evidence_source: Type.Optional(Type.String({ description: "Budget evidence source: route-advisory, provider-budget-snapshot, manual, or unknown." })),
      budget_evidence_provider: Type.Optional(Type.String({ description: "Provider named by evidence; for manual model-specific evidence may include provider/model scope." })),
      budget_evidence_generated_at_iso: Type.Optional(Type.String({ description: "ISO timestamp for structured budget evidence freshness checks." })),
      budget_evidence_max_age_ms: Type.Optional(Type.Number({ description: "Optional max age for structured budget evidence freshness." })),
      economy_mode: Type.Optional(Type.String({ description: "Worker token/context economy mode: standard, conserve, or critical. Defaults to critical." })),
      token_budget_evidence: Type.Optional(Type.String({ description: "Short provider/model quota evidence to embed in the worker economy contract." })),
      max_output_lines: Type.Optional(Type.Number({ description: "Bounded worker output line target for economy contract. Defaults to 20." })),
      extension_isolation: Type.Optional(Type.String({ description: "Extension isolation mode: minimal-no-extensions or inherit. Defaults to minimal-no-extensions unless a custom provider requires inherited extensions." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope is requested." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const taskId = typeof p.task_id === "string" ? p.task_id : "";
      const cwd = typeof p.cwd === "string" ? p.cwd : ctx.cwd;
      const { block } = readTasksBlockCached(cwd);
      const task = block.tasks.find((row) => row.id === taskId);
      const result = buildAgentRunTaskPacket({
        taskId,
        task,
        purpose: typeof p.purpose === "string" ? p.purpose : undefined,
        profile: typeof p.profile === "string" ? p.profile : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        cwd,
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        budgetDecision: typeof p.budget_decision === "string" ? p.budget_decision : undefined,
        budgetEvidence: typeof p.budget_evidence === "string" ? p.budget_evidence : undefined,
        budgetEvidenceSource: typeof p.budget_evidence_source === "string" ? p.budget_evidence_source : undefined,
        budgetEvidenceProvider: typeof p.budget_evidence_provider === "string" ? p.budget_evidence_provider : undefined,
        budgetEvidenceGeneratedAtIso: typeof p.budget_evidence_generated_at_iso === "string" ? p.budget_evidence_generated_at_iso : undefined,
        budgetEvidenceMaxAgeMs: typeof p.budget_evidence_max_age_ms === "number" ? p.budget_evidence_max_age_ms : undefined,
        economyMode: typeof p.economy_mode === "string" ? p.economy_mode : undefined,
        tokenBudgetEvidence: typeof p.token_budget_evidence === "string" ? p.token_budget_evidence : undefined,
        maxOutputLines: typeof p.max_output_lines === "number" ? p.max_output_lines : undefined,
        extensionIsolation: typeof p.extension_isolation === "string" ? p.extension_isolation : undefined,
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_run_task_packet",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_task_start_packet",
    label: "Agent Run Task Start Packet",
    description: "Report-only bridge from board task packet to registry/start/status/log/abort/outcome previews. Never dispatches execution and always requires explicit human confirmation before any future start.",
    parameters: Type.Object({
      task_id: Type.String({ description: "Board task id to packetize for a future start." }),
      purpose: Type.Optional(Type.String({ description: "Short purpose slug/label for the run id. Defaults to task-packet." })),
      profile: Type.Optional(Type.String({ description: "Invocation profile: small-mutation, test-fix, read-only-review, or research." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference, e.g. openai-codex/gpt-5.3-codex-spark." })),
      cwd: Type.Optional(Type.String({ description: "Worker cwd. Defaults to current cwd." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Bounded timeout in milliseconds; defaults to 90000." })),
      budget_decision: Type.Optional(Type.String({ description: "Provider/model budget decision: ok, warn, blocked, or unknown." })),
      budget_evidence: Type.Optional(Type.String({ description: "Scoped provider/model budget evidence, preferably model-specific." })),
      budget_evidence_source: Type.Optional(Type.String({ description: "Budget evidence source: route-advisory, provider-budget-snapshot, manual, or unknown." })),
      budget_evidence_provider: Type.Optional(Type.String({ description: "Provider named by evidence; for manual model-specific evidence may include provider/model scope." })),
      budget_evidence_generated_at_iso: Type.Optional(Type.String({ description: "ISO timestamp for structured budget evidence freshness checks." })),
      budget_evidence_max_age_ms: Type.Optional(Type.Number({ description: "Optional max age for structured budget evidence freshness." })),
      economy_mode: Type.Optional(Type.String({ description: "Worker token/context economy mode: standard, conserve, or critical. Defaults to critical." })),
      token_budget_evidence: Type.Optional(Type.String({ description: "Short provider/model quota evidence to embed in the worker economy contract." })),
      max_output_lines: Type.Optional(Type.Number({ description: "Bounded worker output line target for economy contract. Defaults to 20." })),
      extension_isolation: Type.Optional(Type.String({ description: "Extension isolation mode: minimal-no-extensions or inherit. Defaults to minimal-no-extensions unless a custom provider requires inherited extensions." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope is requested." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const taskId = typeof p.task_id === "string" ? p.task_id : "";
      const cwd = typeof p.cwd === "string" ? p.cwd : ctx.cwd;
      const { block } = readTasksBlockCached(cwd);
      const task = block.tasks.find((row) => row.id === taskId);
      const existingEntry = readRegistryEntry(ctx.cwd, taskId);
      const result = buildAgentRunTaskStartPacket({
        taskId,
        task,
        existingEntry,
        purpose: typeof p.purpose === "string" ? p.purpose : undefined,
        profile: typeof p.profile === "string" ? p.profile : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        cwd,
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        budgetDecision: typeof p.budget_decision === "string" ? p.budget_decision : undefined,
        budgetEvidence: typeof p.budget_evidence === "string" ? p.budget_evidence : undefined,
        budgetEvidenceSource: typeof p.budget_evidence_source === "string" ? p.budget_evidence_source : undefined,
        budgetEvidenceProvider: typeof p.budget_evidence_provider === "string" ? p.budget_evidence_provider : undefined,
        budgetEvidenceGeneratedAtIso: typeof p.budget_evidence_generated_at_iso === "string" ? p.budget_evidence_generated_at_iso : undefined,
        budgetEvidenceMaxAgeMs: typeof p.budget_evidence_max_age_ms === "number" ? p.budget_evidence_max_age_ms : undefined,
        economyMode: typeof p.economy_mode === "string" ? p.economy_mode : undefined,
        tokenBudgetEvidence: typeof p.token_budget_evidence === "string" ? p.token_budget_evidence : undefined,
        maxOutputLines: typeof p.max_output_lines === "number" ? p.max_output_lines : undefined,
        extensionIsolation: typeof p.extension_isolation === "string" ? p.extension_isolation : undefined,
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_run_task_start_packet",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_task_dispatch_check",
    label: "Agent Run Task Dispatch Check",
    description: "Report-only confirmation check for a board task dispatch packet. Never starts a process; use before any separate execute=true dispatch call.",
    parameters: Type.Object({
      task_id: Type.String({ description: "Board task id to packetize and check." }),
      purpose: Type.Optional(Type.String({ description: "Short purpose slug/label for the run id. Defaults to task-packet." })),
      profile: Type.Optional(Type.String({ description: "Invocation profile: small-mutation, test-fix, read-only-review, or research." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference, e.g. openai-codex/gpt-5.3-codex-spark." })),
      cwd: Type.Optional(Type.String({ description: "Worker cwd. Defaults to current workspace cwd." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Bounded timeout in milliseconds; defaults to 90000." })),
      budget_decision: Type.Optional(Type.String({ description: "Provider/model budget decision: ok, warn, blocked, or unknown." })),
      budget_evidence: Type.Optional(Type.String({ description: "Scoped provider/model budget evidence, preferably model-specific." })),
      budget_evidence_source: Type.Optional(Type.String({ description: "Budget evidence source: route-advisory, provider-budget-snapshot, manual, or unknown." })),
      budget_evidence_provider: Type.Optional(Type.String({ description: "Provider named by evidence; for manual model-specific evidence may include provider/model scope." })),
      budget_evidence_generated_at_iso: Type.Optional(Type.String({ description: "ISO timestamp for structured budget evidence freshness checks." })),
      budget_evidence_max_age_ms: Type.Optional(Type.Number({ description: "Optional max age for structured budget evidence freshness." })),
      economy_mode: Type.Optional(Type.String({ description: "Worker token/context economy mode: standard, conserve, or critical. Defaults to critical." })),
      token_budget_evidence: Type.Optional(Type.String({ description: "Short provider/model quota evidence to embed in the worker economy contract." })),
      max_output_lines: Type.Optional(Type.Number({ description: "Bounded worker output line target for economy contract. Defaults to 20." })),
      extension_isolation: Type.Optional(Type.String({ description: "Extension isolation mode: minimal-no-extensions or inherit. Defaults to minimal-no-extensions unless a custom provider requires inherited extensions." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope is requested." })),
      operator_confirmation: Type.Optional(Type.String({ description: "Optional phrase to compare with the packet humanConfirmationPhrase. No execution is authorized by a match." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const taskId = typeof p.task_id === "string" ? p.task_id : "";
      const cwd = typeof p.cwd === "string" ? p.cwd : ctx.cwd;
      const { block } = readTasksBlockCached(cwd);
      const task = block.tasks.find((row) => row.id === taskId);
      const basePacket = buildAgentRunTaskStartPacket({
        taskId,
        task,
        purpose: typeof p.purpose === "string" ? p.purpose : undefined,
        profile: typeof p.profile === "string" ? p.profile : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        cwd,
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        budgetDecision: typeof p.budget_decision === "string" ? p.budget_decision : undefined,
        budgetEvidence: typeof p.budget_evidence === "string" ? p.budget_evidence : undefined,
        budgetEvidenceSource: typeof p.budget_evidence_source === "string" ? p.budget_evidence_source : undefined,
        budgetEvidenceProvider: typeof p.budget_evidence_provider === "string" ? p.budget_evidence_provider : undefined,
        budgetEvidenceGeneratedAtIso: typeof p.budget_evidence_generated_at_iso === "string" ? p.budget_evidence_generated_at_iso : undefined,
        budgetEvidenceMaxAgeMs: typeof p.budget_evidence_max_age_ms === "number" ? p.budget_evidence_max_age_ms : undefined,
        economyMode: typeof p.economy_mode === "string" ? p.economy_mode : undefined,
        tokenBudgetEvidence: typeof p.token_budget_evidence === "string" ? p.token_budget_evidence : undefined,
        maxOutputLines: typeof p.max_output_lines === "number" ? p.max_output_lines : undefined,
        extensionIsolation: typeof p.extension_isolation === "string" ? p.extension_isolation : undefined,
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
      });
      const existingEntry = readRegistryEntry(ctx.cwd, basePacket.taskPacket.invocationSpec.runId);
      const packet = buildAgentRunTaskStartPacket({
        taskId,
        task,
        existingEntry,
        purpose: typeof p.purpose === "string" ? p.purpose : undefined,
        profile: typeof p.profile === "string" ? p.profile : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        cwd,
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        budgetDecision: typeof p.budget_decision === "string" ? p.budget_decision : undefined,
        budgetEvidence: typeof p.budget_evidence === "string" ? p.budget_evidence : undefined,
        budgetEvidenceSource: typeof p.budget_evidence_source === "string" ? p.budget_evidence_source : undefined,
        budgetEvidenceProvider: typeof p.budget_evidence_provider === "string" ? p.budget_evidence_provider : undefined,
        budgetEvidenceGeneratedAtIso: typeof p.budget_evidence_generated_at_iso === "string" ? p.budget_evidence_generated_at_iso : undefined,
        budgetEvidenceMaxAgeMs: typeof p.budget_evidence_max_age_ms === "number" ? p.budget_evidence_max_age_ms : undefined,
        economyMode: typeof p.economy_mode === "string" ? p.economy_mode : undefined,
        tokenBudgetEvidence: typeof p.token_budget_evidence === "string" ? p.token_budget_evidence : undefined,
        maxOutputLines: typeof p.max_output_lines === "number" ? p.max_output_lines : undefined,
        extensionIsolation: typeof p.extension_isolation === "string" ? p.extension_isolation : undefined,
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
      });
      const operatorConfirmation = typeof p.operator_confirmation === "string" ? p.operator_confirmation : "";
      const confirmation = !operatorConfirmation ? "missing" : operatorConfirmation === packet.humanConfirmationPhrase ? "match" : "mismatch";
      const blockers = [...packet.blockers];
      if (packet.decision !== "ready-for-human-decision") blockers.push("task-start-packet-blocked");
      if (existingEntry?.state === "running") blockers.push("run-already-running");
      const wouldDispatchAfterExplicitExecute = blockers.length === 0 && confirmation === "match";
      const result = {
        mode: "agent-run-task-dispatch-check" as const,
        activation: "none" as const,
        authorization: "none" as const,
        dispatchAllowed: false,
        processStartAllowed: false,
        processStopAllowed: false,
        requiresHumanDecision: true,
        singleRunOnly: true,
        decision: blockers.length > 0 ? "blocked" as const : "checked" as const,
        blockers,
        runId: packet.taskPacket.invocationSpec.runId,
        confirmation,
        wouldDispatchAfterExplicitExecute,
        packet,
        humanConfirmationPhrase: packet.humanConfirmationPhrase,
        summary: [
          "agent-run-task-dispatch-check:",
          `decision=${blockers.length > 0 ? "blocked" : "checked"}`,
          `runId=${packet.taskPacket.invocationSpec.runId || "unknown"}`,
          `confirmation=${confirmation}`,
          `wouldDispatchAfterExplicitExecute=${wouldDispatchAfterExplicitExecute ? "yes" : "no"}`,
          "dispatch=no",
          blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
        ].filter(Boolean).join(" "),
      };
      return buildOperatorVisibleToolResponse({
        label: "agent_run_task_dispatch_check",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_task_dispatch",
    label: "Agent Run Task Dispatch",
    description: "First-party task-runner gate. Preview by default; execute=true requires exact human confirmation phrase and starts only one registered pi subprocess. Never auto-dispatches.",
    parameters: Type.Object({
      task_id: Type.String({ description: "Board task id to packetize and optionally dispatch." }),
      purpose: Type.Optional(Type.String({ description: "Short purpose slug/label for the run id. Defaults to task-packet." })),
      profile: Type.Optional(Type.String({ description: "Invocation profile: small-mutation, test-fix, read-only-review, or research." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference, e.g. openai-codex/gpt-5.3-codex-spark." })),
      cwd: Type.Optional(Type.String({ description: "Worker cwd. For execute=true must match the current workspace cwd." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Bounded timeout in milliseconds; defaults to 90000." })),
      budget_decision: Type.Optional(Type.String({ description: "Provider/model budget decision: ok, warn, blocked, or unknown." })),
      budget_evidence: Type.Optional(Type.String({ description: "Scoped provider/model budget evidence, preferably model-specific." })),
      budget_evidence_source: Type.Optional(Type.String({ description: "Budget evidence source: route-advisory, provider-budget-snapshot, manual, or unknown." })),
      budget_evidence_provider: Type.Optional(Type.String({ description: "Provider named by evidence; for manual model-specific evidence may include provider/model scope." })),
      budget_evidence_generated_at_iso: Type.Optional(Type.String({ description: "ISO timestamp for structured budget evidence freshness checks." })),
      budget_evidence_max_age_ms: Type.Optional(Type.Number({ description: "Optional max age for structured budget evidence freshness." })),
      economy_mode: Type.Optional(Type.String({ description: "Worker token/context economy mode: standard, conserve, or critical. Defaults to critical." })),
      token_budget_evidence: Type.Optional(Type.String({ description: "Short provider/model quota evidence to embed in the worker economy contract." })),
      max_output_lines: Type.Optional(Type.Number({ description: "Bounded worker output line target for economy contract. Defaults to 20." })),
      extension_isolation: Type.Optional(Type.String({ description: "Extension isolation mode: minimal-no-extensions or inherit. Defaults to minimal-no-extensions unless a custom provider requires inherited extensions." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope is requested." })),
      execute: Type.Optional(Type.Boolean({ description: "When true, dispatch the subprocess only after all gates pass and operator_confirmation matches exactly." })),
      operator_confirmation: Type.Optional(Type.String({ description: "Must exactly equal the packet humanConfirmationPhrase for execute=true." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const taskId = typeof p.task_id === "string" ? p.task_id : "";
      const cwd = typeof p.cwd === "string" ? p.cwd : ctx.cwd;
      const { block } = readTasksBlockCached(cwd);
      const task = block.tasks.find((row) => row.id === taskId);
      const basePacket = buildAgentRunTaskStartPacket({
        taskId,
        task,
        purpose: typeof p.purpose === "string" ? p.purpose : undefined,
        profile: typeof p.profile === "string" ? p.profile : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        cwd,
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        budgetDecision: typeof p.budget_decision === "string" ? p.budget_decision : undefined,
        budgetEvidence: typeof p.budget_evidence === "string" ? p.budget_evidence : undefined,
        budgetEvidenceSource: typeof p.budget_evidence_source === "string" ? p.budget_evidence_source : undefined,
        budgetEvidenceProvider: typeof p.budget_evidence_provider === "string" ? p.budget_evidence_provider : undefined,
        budgetEvidenceGeneratedAtIso: typeof p.budget_evidence_generated_at_iso === "string" ? p.budget_evidence_generated_at_iso : undefined,
        budgetEvidenceMaxAgeMs: typeof p.budget_evidence_max_age_ms === "number" ? p.budget_evidence_max_age_ms : undefined,
        economyMode: typeof p.economy_mode === "string" ? p.economy_mode : undefined,
        tokenBudgetEvidence: typeof p.token_budget_evidence === "string" ? p.token_budget_evidence : undefined,
        maxOutputLines: typeof p.max_output_lines === "number" ? p.max_output_lines : undefined,
        extensionIsolation: typeof p.extension_isolation === "string" ? p.extension_isolation : undefined,
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
      });
      const existingEntry = readRegistryEntry(ctx.cwd, basePacket.taskPacket.invocationSpec.runId);
      const packet = buildAgentRunTaskStartPacket({
        taskId,
        task,
        existingEntry,
        purpose: typeof p.purpose === "string" ? p.purpose : undefined,
        profile: typeof p.profile === "string" ? p.profile : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        cwd,
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        budgetDecision: typeof p.budget_decision === "string" ? p.budget_decision : undefined,
        budgetEvidence: typeof p.budget_evidence === "string" ? p.budget_evidence : undefined,
        budgetEvidenceSource: typeof p.budget_evidence_source === "string" ? p.budget_evidence_source : undefined,
        budgetEvidenceProvider: typeof p.budget_evidence_provider === "string" ? p.budget_evidence_provider : undefined,
        budgetEvidenceGeneratedAtIso: typeof p.budget_evidence_generated_at_iso === "string" ? p.budget_evidence_generated_at_iso : undefined,
        budgetEvidenceMaxAgeMs: typeof p.budget_evidence_max_age_ms === "number" ? p.budget_evidence_max_age_ms : undefined,
        economyMode: typeof p.economy_mode === "string" ? p.economy_mode : undefined,
        tokenBudgetEvidence: typeof p.token_budget_evidence === "string" ? p.token_budget_evidence : undefined,
        maxOutputLines: typeof p.max_output_lines === "number" ? p.max_output_lines : undefined,
        extensionIsolation: typeof p.extension_isolation === "string" ? p.extension_isolation : undefined,
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
      });
      const executeRequested = p.execute === true;
      const operatorConfirmation = typeof p.operator_confirmation === "string" ? p.operator_confirmation : "";
      const blockers = [...packet.blockers];
      if (packet.decision !== "ready-for-human-decision") blockers.push("task-start-packet-blocked");
      if (existingEntry?.state === "running") blockers.push("run-already-running");
      if (executeRequested && cwd !== ctx.cwd) blockers.push("execute-cwd-mismatch");
      if (executeRequested && operatorConfirmation !== packet.humanConfirmationPhrase) blockers.push("operator-confirmation-mismatch");
      const dispatchAllowed = executeRequested && blockers.length === 0;
      let pid: number | undefined;
      let registryEntry = packet.registryPreview.entry;

      if (dispatchAllowed) {
        const logPath = path.isAbsolute(packet.taskPacket.invocationSpec.logPath)
          ? packet.taskPacket.invocationSpec.logPath
          : path.join(ctx.cwd, packet.taskPacket.invocationSpec.logPath);
        mkdirSync(path.dirname(logPath), { recursive: true });
        const subprocess = resolvePiSubprocessInvocation(packet.startPreview);
        appendAgentRunLogLine(logPath, `[agent-runner] starting command=${subprocess.command} source=${subprocess.source} cwd=${ctx.cwd}`);
        appendAgentRunLogLine(logPath, `[agent-runner] argv=${formatAgentRunnerArgvForLog(subprocess.args)}`);
        const logStream = createWriteStream(logPath, { flags: "a" });
        const child = spawn(subprocess.command, subprocess.args, { cwd: ctx.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
        pid = child.pid;
        let childOutputBytes = 0;
        let childStdoutBytes = 0;
        let childStderrBytes = 0;
        const captureChildOutput = (streamName: "stdout" | "stderr") => (chunk: Buffer | string) => {
          const byteLength = Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(chunk);
          childOutputBytes += byteLength;
          if (streamName === "stdout") childStdoutBytes += byteLength;
          if (streamName === "stderr") childStderrBytes += byteLength;
          logStream.write(chunk);
        };
        child.stdout?.on("data", captureChildOutput("stdout"));
        child.stderr?.on("data", captureChildOutput("stderr"));
        registryEntry = {
          ...packet.registryPreview.entry,
          ...(pid ? { pid } : {}),
          state: "running",
          startedAtIso: new Date().toISOString(),
          lastEventAtIso: new Date().toISOString(),
        };
        writeRegistryEntry(ctx.cwd, registryEntry);
        const timeoutMs = packet.taskPacket.invocationSpec.timeoutMs;
        let settled = false;
        const timeout = setTimeout(() => {
          if (!child.killed) child.kill("SIGTERM");
        }, timeoutMs);
        child.on("error", (error: NodeJS.ErrnoException) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          const code = error.code || "unknown";
          const message = error.message || String(error);
          logStream.write(`[agent-runner] spawn error code=${code} message=${message}\n`, () => {
            logStream.end(() => {
              writeRegistryEntry(ctx.cwd, {
                ...registryEntry,
                state: "failed",
                errorCode: code,
                errorMessage: message,
                outputBytes: readLogByteCount(logPath),
                lastEventAtIso: new Date().toISOString(),
              });
            });
          });
        });
        child.on("close", (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          const exitCode = typeof code === "number" ? code : 1;
          const silentFailure = exitCode !== 0 && childOutputBytes === 0;
          const silentFailureLine = silentFailure
            ? "[agent-runner] failure code=silent-runner-failure message=subprocess exited non-zero without stdout/stderr; inspect argv/cwd/source and provider/toolkit setup\n"
            : "";
          logStream.write(`${silentFailureLine}[agent-runner] close exitCode=${exitCode} childOutputBytes=${childOutputBytes} stdoutBytes=${childStdoutBytes} stderrBytes=${childStderrBytes}\n`, () => {
            logStream.end(() => {
              writeRegistryEntry(ctx.cwd, {
                ...registryEntry,
                state: exitCode === 0 ? "completed" : "failed",
                exitCode,
                ...(silentFailure ? {
                  errorCode: "silent-runner-failure",
                  errorMessage: "subprocess exited non-zero without stdout/stderr; inspect argv/cwd/source and provider/toolkit setup",
                } : {}),
                outputBytes: readLogByteCount(logPath),
                lastEventAtIso: new Date().toISOString(),
              });
            });
          });
        });
      }

      const decision = dispatchAllowed ? "dispatched" : blockers.length > 0 ? "blocked" : "preview";
      const result = {
        mode: "agent-run-task-dispatch" as const,
        activation: "none" as const,
        authorization: dispatchAllowed ? "explicit-human" as const : "none" as const,
        dispatchAllowed,
        processStartAllowed: dispatchAllowed,
        processStopAllowed: false,
        requiresHumanDecision: true,
        singleRunOnly: true,
        decision,
        blockers,
        executeRequested,
        runId: packet.taskPacket.invocationSpec.runId,
        pid,
        packet,
        registryEntry,
        humanConfirmationPhrase: packet.humanConfirmationPhrase,
        summary: [
          "agent-run-task-dispatch:",
          `decision=${decision}`,
          `runId=${packet.taskPacket.invocationSpec.runId || "unknown"}`,
          `execute=${executeRequested ? "yes" : "no"}`,
          `dispatch=${dispatchAllowed ? "yes" : "no"}`,
          pid ? `pid=${pid}` : undefined,
          blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
        ].filter(Boolean).join(" "),
      };
      return buildOperatorVisibleToolResponse({
        label: "agent_run_task_dispatch",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_executor_strategy_packet",
    label: "Agent Run Executor Strategy Packet",
    description: "Report-only packet for choosing subprocess vs SDK/in-process worker executor strategy. Never dispatches execution.",
    parameters: Type.Object({
      failure_class: Type.Optional(Type.String({ description: "Observed failure class, e.g. silent-runner-failure." })),
      subprocess_diagnostics_available: Type.Optional(Type.Boolean({ description: "Whether subprocess diagnostics already include argv/source/exit/stdout/stderr evidence." })),
      sdk_runtime_available: Type.Optional(Type.Boolean({ description: "Whether SDK/in-process runtime path is available for a future canary design." })),
      budget_decision: Type.Optional(Type.String({ description: "Provider/model budget decision: ok, warn, blocked, or unknown." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope is requested." })),
      exact_confirmation_available: Type.Optional(Type.Boolean({ description: "Whether exact runId confirmation is already available for a separate future dispatch." })),
      runtime_mode: Type.Optional(Type.String({ description: "Runtime mode evidence: windows, linux, devcontainer, or unknown." })),
      devcontainer_available: Type.Optional(Type.Boolean({ description: "Whether a devcontainer/Linux subprocess maturity probe is available." })),
      requires_process_isolation: Type.Optional(Type.Boolean({ description: "Prefer subprocess when process isolation dominates and the subprocess path is not silently failing." })),
      requires_direct_event_stream: Type.Optional(Type.Boolean({ description: "Prefer SDK/in-process when direct AgentSession event visibility dominates." })),
      mutation_requested: Type.Optional(Type.Boolean({ description: "Mutation workloads generally prefer stronger process isolation unless direct events dominate." })),
      unexpected_dirty: Type.Optional(Type.Boolean({ description: "Blocks executor selection when workspace dirty state is unexpected." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = buildAgentRunExecutorStrategyPacket({
        failureClass: typeof p.failure_class === "string" ? p.failure_class : undefined,
        subprocessDiagnosticsAvailable: asOptionalBoolean(p.subprocess_diagnostics_available),
        sdkRuntimeAvailable: asOptionalBoolean(p.sdk_runtime_available),
        budgetDecision: typeof p.budget_decision === "string" ? p.budget_decision : undefined,
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
        exactConfirmationAvailable: asOptionalBoolean(p.exact_confirmation_available),
        runtimeMode: typeof p.runtime_mode === "string" ? p.runtime_mode : undefined,
        devcontainerAvailable: asOptionalBoolean(p.devcontainer_available),
        requiresProcessIsolation: asOptionalBoolean(p.requires_process_isolation),
        requiresDirectEventStream: asOptionalBoolean(p.requires_direct_event_stream),
        mutationRequested: asOptionalBoolean(p.mutation_requested),
        unexpectedDirty: asOptionalBoolean(p.unexpected_dirty),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_run_executor_strategy_packet",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_sdk_in_process_packet",
    label: "Agent Run SDK In-Process Packet",
    description: "Report-only SDK/in-process worker packet using createAgentSession patterns. Never dispatches execution and requires exact future confirmation.",
    parameters: Type.Object({
      run_id: Type.Optional(Type.String({ description: "Future SDK worker run id." })),
      goal: Type.Optional(Type.String({ description: "Run goal/prompt for the future SDK worker." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference, e.g. openai-codex/gpt-5.3-codex-spark." })),
      cwd: Type.Optional(Type.String({ description: "Worker cwd. Defaults to current cwd." })),
      declared_files: Type.Optional(Type.Array(Type.String(), { description: "Exact declared file scope for parent validation." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Bounded timeout in milliseconds." })),
      tool_allowlist: Type.Optional(Type.Array(Type.String(), { description: "SDK tool allowlist, usually read, grep, find, ls for diagnostic canaries." })),
      session_mode: Type.Optional(Type.String({ description: "SDK session mode: in-memory or run-session-dir." })),
      file_contract: Type.Optional(Type.String({ description: "read-only or mutation." })),
      validation_gate_known: Type.Optional(Type.Boolean({ description: "Whether parent-side validation is known before any dispatch." })),
      rollback_plan_known: Type.Optional(Type.Boolean({ description: "Whether non-destructive rollback is known." })),
      budget_decision: Type.Optional(Type.String({ description: "Provider/model budget decision: ok, warn, blocked, or unknown." })),
      budget_evidence: Type.Optional(Type.String({ description: "Scoped provider/model budget evidence." })),
      budget_evidence_source: Type.Optional(Type.String({ description: "Budget evidence source: route-advisory, provider-budget-snapshot, manual, or unknown." })),
      budget_evidence_provider: Type.Optional(Type.String({ description: "Provider named by evidence; may include provider/model scope." })),
      budget_evidence_generated_at_iso: Type.Optional(Type.String({ description: "ISO timestamp for structured budget evidence freshness checks." })),
      budget_evidence_max_age_ms: Type.Optional(Type.Number({ description: "Optional max age for structured budget evidence freshness." })),
      abort_known: Type.Optional(Type.Boolean({ description: "Whether safe SDK abort is known." })),
      event_stream_known: Type.Optional(Type.Boolean({ description: "Whether SDK event stream capture is known." })),
      final_output_contract_known: Type.Optional(Type.Boolean({ description: "Whether final output bytes/contract is known." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope is requested." })),
      unexpected_dirty: Type.Optional(Type.Boolean({ description: "Blocks when workspace dirty state is unexpected." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = buildAgentRunSdkInProcessPacket({
        runId: typeof p.run_id === "string" ? p.run_id : undefined,
        goal: typeof p.goal === "string" ? p.goal : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        cwd: typeof p.cwd === "string" ? p.cwd : ctx?.cwd,
        declaredFiles: asOptionalStringArray(p.declared_files),
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        toolAllowlist: asOptionalStringArray(p.tool_allowlist),
        sessionMode: typeof p.session_mode === "string" ? p.session_mode : undefined,
        fileContract: typeof p.file_contract === "string" ? p.file_contract : undefined,
        validationGateKnown: asOptionalBoolean(p.validation_gate_known),
        rollbackPlanKnown: asOptionalBoolean(p.rollback_plan_known),
        budgetDecision: typeof p.budget_decision === "string" ? p.budget_decision : undefined,
        budgetEvidence: typeof p.budget_evidence === "string" ? p.budget_evidence : undefined,
        budgetEvidenceSource: typeof p.budget_evidence_source === "string" ? p.budget_evidence_source : undefined,
        budgetEvidenceProvider: typeof p.budget_evidence_provider === "string" ? p.budget_evidence_provider : undefined,
        budgetEvidenceGeneratedAtIso: typeof p.budget_evidence_generated_at_iso === "string" ? p.budget_evidence_generated_at_iso : undefined,
        budgetEvidenceMaxAgeMs: typeof p.budget_evidence_max_age_ms === "number" ? p.budget_evidence_max_age_ms : undefined,
        abortKnown: asOptionalBoolean(p.abort_known),
        eventStreamKnown: asOptionalBoolean(p.event_stream_known),
        finalOutputContractKnown: asOptionalBoolean(p.final_output_contract_known),
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
        unexpectedDirty: asOptionalBoolean(p.unexpected_dirty),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_run_sdk_in_process_packet",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_sdk_in_process_dispatch",
    label: "Agent Run SDK In-Process Dispatch",
    description: "First-party SDK/in-process worker gate. Preview by default; execute=true requires exact human confirmation and starts only one SDK AgentSession worker.",
    parameters: Type.Object({
      run_id: Type.Optional(Type.String({ description: "Future SDK worker run id." })),
      goal: Type.Optional(Type.String({ description: "Run goal/prompt for the SDK worker." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference." })),
      cwd: Type.Optional(Type.String({ description: "Worker cwd. For execute=true must match current cwd." })),
      declared_files: Type.Optional(Type.Array(Type.String(), { description: "Exact declared file scope for parent validation." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Bounded timeout in milliseconds." })),
      tool_allowlist: Type.Optional(Type.Array(Type.String(), { description: "SDK tool allowlist." })),
      session_mode: Type.Optional(Type.String({ description: "SDK session mode: in-memory or run-session-dir." })),
      file_contract: Type.Optional(Type.String({ description: "read-only or mutation." })),
      validation_gate_known: Type.Optional(Type.Boolean({ description: "Whether parent-side validation is known before any dispatch." })),
      rollback_plan_known: Type.Optional(Type.Boolean({ description: "Whether non-destructive rollback is known." })),
      budget_decision: Type.Optional(Type.String({ description: "Provider/model budget decision: ok, warn, blocked, or unknown." })),
      budget_evidence: Type.Optional(Type.String({ description: "Scoped provider/model budget evidence." })),
      budget_evidence_source: Type.Optional(Type.String({ description: "Budget evidence source." })),
      budget_evidence_provider: Type.Optional(Type.String({ description: "Provider named by evidence; may include provider/model scope." })),
      budget_evidence_generated_at_iso: Type.Optional(Type.String({ description: "ISO timestamp for structured budget evidence freshness checks." })),
      budget_evidence_max_age_ms: Type.Optional(Type.Number({ description: "Optional max age for structured budget evidence freshness." })),
      abort_known: Type.Optional(Type.Boolean({ description: "Whether safe SDK abort is known." })),
      event_stream_known: Type.Optional(Type.Boolean({ description: "Whether SDK event stream capture is known." })),
      final_output_contract_known: Type.Optional(Type.Boolean({ description: "Whether final output bytes/contract is known." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope is requested." })),
      unexpected_dirty: Type.Optional(Type.Boolean({ description: "Blocks when workspace dirty state is unexpected." })),
      execute: Type.Optional(Type.Boolean({ description: "When true, start exactly one SDK worker after exact confirmation." })),
      operator_confirmation: Type.Optional(Type.String({ description: "Must exactly equal the packet humanConfirmationPhrase for execute=true." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const packet = buildAgentRunSdkInProcessPacket({
        runId: typeof p.run_id === "string" ? p.run_id : undefined,
        goal: typeof p.goal === "string" ? p.goal : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        cwd: typeof p.cwd === "string" ? p.cwd : ctx?.cwd,
        declaredFiles: asOptionalStringArray(p.declared_files),
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        toolAllowlist: asOptionalStringArray(p.tool_allowlist),
        sessionMode: typeof p.session_mode === "string" ? p.session_mode : undefined,
        fileContract: typeof p.file_contract === "string" ? p.file_contract : undefined,
        validationGateKnown: asOptionalBoolean(p.validation_gate_known),
        rollbackPlanKnown: asOptionalBoolean(p.rollback_plan_known),
        budgetDecision: typeof p.budget_decision === "string" ? p.budget_decision : undefined,
        budgetEvidence: typeof p.budget_evidence === "string" ? p.budget_evidence : undefined,
        budgetEvidenceSource: typeof p.budget_evidence_source === "string" ? p.budget_evidence_source : undefined,
        budgetEvidenceProvider: typeof p.budget_evidence_provider === "string" ? p.budget_evidence_provider : undefined,
        budgetEvidenceGeneratedAtIso: typeof p.budget_evidence_generated_at_iso === "string" ? p.budget_evidence_generated_at_iso : undefined,
        budgetEvidenceMaxAgeMs: typeof p.budget_evidence_max_age_ms === "number" ? p.budget_evidence_max_age_ms : undefined,
        abortKnown: asOptionalBoolean(p.abort_known),
        eventStreamKnown: asOptionalBoolean(p.event_stream_known),
        finalOutputContractKnown: asOptionalBoolean(p.final_output_contract_known),
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
        unexpectedDirty: asOptionalBoolean(p.unexpected_dirty),
      });
      const executeRequested = p.execute === true;
      const operatorConfirmation = typeof p.operator_confirmation === "string" ? p.operator_confirmation : "";
      const existingEntry = packet.runSpec.runId ? readRegistryEntry(ctx.cwd, packet.runSpec.runId) : undefined;
      const blockers = [...packet.blockers];
      if (packet.decision !== "ready-for-human-decision") blockers.push("sdk-packet-blocked");
      if (existingEntry?.state === "running") blockers.push("run-already-running");
      if (executeRequested && packet.runSpec.cwd !== ctx.cwd) blockers.push("execute-cwd-mismatch");
      if (executeRequested && operatorConfirmation !== packet.humanConfirmationPhrase) blockers.push("operator-confirmation-mismatch");
      const dispatchAllowed = executeRequested && blockers.length === 0;
      const started = dispatchAllowed ? startSdkInProcessWorker(ctx.cwd, packet) : undefined;
      const decision = dispatchAllowed ? "dispatched" : blockers.length > 0 ? "blocked" : "preview";
      const result = {
        mode: "agent-run-sdk-in-process-dispatch" as const,
        activation: "none" as const,
        authorization: dispatchAllowed ? "explicit-human" as const : "none" as const,
        dispatchAllowed,
        processStartAllowed: dispatchAllowed,
        processStopAllowed: false,
        requiresHumanDecision: true,
        singleRunOnly: true,
        decision,
        blockers,
        executeRequested,
        runId: packet.runSpec.runId,
        logPath: started?.logPath,
        packet,
        humanConfirmationPhrase: packet.humanConfirmationPhrase,
        summary: [
          "agent-run-sdk-in-process-dispatch:",
          `decision=${decision}`,
          `runId=${packet.runSpec.runId || "unknown"}`,
          `execute=${executeRequested ? "yes" : "no"}`,
          `dispatch=${dispatchAllowed ? "yes" : "no"}`,
          started?.logPath ? `logPath=${started.logPath}` : undefined,
          blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
        ].filter(Boolean).join(" "),
      };
      return buildOperatorVisibleToolResponse({
        label: "agent_run_sdk_in_process_dispatch",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_registry_upsert",
    label: "Agent Run Registry Upsert",
    description: "Dry-first local registry upsert for agent runs under .pi/reports. apply=true writes only registry state; it never starts, stops, or dispatches execution.",
    parameters: Type.Object({
      run_id: Type.String({ description: "Agent run id." }),
      state: Type.Optional(Type.String({ description: "Run state: planned, running, completed, failed, timed-out, aborted, or unknown." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Provider/model reference used by the run." })),
      cwd: Type.Optional(Type.String({ description: "Run cwd. Defaults to current tool cwd." })),
      declared_files: Type.Optional(Type.Array(Type.String(), { description: "Declared file scope for the run." })),
      log_path: Type.Optional(Type.String({ description: "Optional bounded log path." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Optional bounded timeout in milliseconds." })),
      dry_run: Type.Optional(Type.Boolean({ description: "Preview only by default; set false to apply registry upsert." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const runId = typeof p.run_id === "string" ? p.run_id : "";
      const cwd = typeof p.cwd === "string" ? p.cwd : ctx.cwd;
      const entry = readRegistryEntry(ctx.cwd, runId);
      const result = buildAgentRunRegistryUpsertPacket({
        runId,
        existingEntry: entry,
        state: typeof p.state === "string" ? p.state as AgentRunState : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        cwd,
        declaredFiles: asOptionalStringArray(p.declared_files),
        logPath: typeof p.log_path === "string" ? p.log_path : undefined,
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        dryRun: p.dry_run !== false,
      });
      if (result.writeAllowed) writeRegistryEntry(ctx.cwd, result.entry);
      return buildOperatorVisibleToolResponse({
        label: "agent_run_registry_upsert",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_status",
    label: "Agent Run Status",
    description: "Read-only status lookup for a registered agent run. Never starts, stops, or dispatches execution.",
    parameters: Type.Object({
      run_id: Type.String({ description: "Agent run id." }),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const runId = typeof p.run_id === "string" ? p.run_id : "";
      const entry = readRegistryEntry(ctx.cwd, runId);
      const result = buildAgentRunStatus(runId, entry);
      return buildOperatorVisibleToolResponse({
        label: "agent_run_status",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_failure_classification",
    label: "Agent Run Failure Classification",
    description: "Read-only classifier for registered agent-run failures. Distinguishes spawn, argv, tool-allowlist, extension-load, provider, model-call, silent-runner, and contract failures before retry decisions. Never dispatches execution.",
    parameters: Type.Object({
      run_id: Type.String({ description: "Agent run id to classify." }),
      log_path: Type.Optional(Type.String({ description: "Optional bounded log path override. Defaults to the registered run log." })),
      touched_files: Type.Optional(Type.Array(Type.String(), { description: "Optional parent-observed touched files for contract-failure classification." })),
      marker_failures: Type.Optional(Type.Array(Type.String(), { description: "Optional failed parent-side markers/check labels." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const runId = typeof p.run_id === "string" ? p.run_id : "";
      const entry = readRegistryEntry(ctx.cwd, runId);
      const rawLogPath = typeof p.log_path === "string" ? p.log_path : entry?.logPath;
      const logPath = rawLogPath ? path.isAbsolute(rawLogPath) ? rawLogPath : path.join(ctx.cwd, rawLogPath) : undefined;
      const logText = logPath && existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
      const result = classifyAgentRunFailure({
        runId,
        entry,
        logText,
        touchedFiles: asOptionalStringArray(p.touched_files),
        markerFailures: asOptionalStringArray(p.marker_failures),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_run_failure_classification",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_startup_diagnostic_packet",
    label: "Agent Run Startup Diagnostic Packet",
    description: "Report-only startup/provider diagnostic packet for agent runs before retry/canary decisions. Never dispatches execution.",
    parameters: Type.Object({
      run_id: Type.String({ description: "Agent run id to diagnose." }),
      log_path: Type.Optional(Type.String({ description: "Optional bounded log path override. Defaults to the registered run log." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Provider/model ref for the intended future canary." })),
      budget_decision: Type.Optional(Type.String({ description: "Provider/model budget decision: ok, warn, blocked, or unknown." })),
      live_reload_completed: Type.Optional(Type.Boolean({ description: "Whether runtime reload was completed after diagnostic tool changes." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope is requested." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const runId = typeof p.run_id === "string" ? p.run_id : "";
      const entry = readRegistryEntry(ctx.cwd, runId);
      const rawLogPath = typeof p.log_path === "string" ? p.log_path : entry?.logPath;
      const logPath = rawLogPath ? path.isAbsolute(rawLogPath) ? rawLogPath : path.join(ctx.cwd, rawLogPath) : undefined;
      const logText = logPath && existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
      const result = buildAgentRunStartupDiagnosticPacket({
        runId,
        entry,
        logText,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        budgetDecision: typeof p.budget_decision === "string" ? p.budget_decision : undefined,
        liveReloadCompleted: asOptionalBoolean(p.live_reload_completed),
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_run_startup_diagnostic_packet",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_log_tail",
    label: "Agent Run Log Tail",
    description: "Read-only bounded log tail for a registered agent run. Never starts, stops, or dispatches execution.",
    parameters: Type.Object({
      run_id: Type.String({ description: "Agent run id." }),
      max_lines: Type.Optional(Type.Number({ description: "Maximum tail lines, clamped to 1..500." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const runId = typeof p.run_id === "string" ? p.run_id : "";
      const entry = readRegistryEntry(ctx.cwd, runId);
      const maxLines = typeof p.max_lines === "number" ? p.max_lines : 80;
      const lines = entry?.logPath ? readLogTail(entry.logPath, maxLines) : [];
      const result = {
        mode: "agent-run-log-tail" as const,
        activation: "none" as const,
        authorization: "none" as const,
        dispatchAllowed: false,
        processStartAllowed: false,
        processStopAllowed: false,
        runId,
        found: !!entry,
        logPath: entry?.logPath,
        maxLines: Math.max(1, Math.min(500, Math.floor(maxLines))),
        lines,
        summary: `agent-run-log-tail: runId=${runId || "unknown"} found=${entry ? "yes" : "no"} lines=${lines.length} dispatch=no authorization=none`,
      };
      return buildOperatorVisibleToolResponse({
        label: "agent_run_log_tail",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_follow",
    label: "Agent Run Follow",
    description: "Read-only bounded follow/finalizer for a registered agent run. Waits only up to a short timeout, returns final status/log/output bytes, and never starts, stops, or dispatches execution.",
    parameters: Type.Object({
      run_id: Type.String({ description: "Agent run id to follow." }),
      max_wait_ms: Type.Optional(Type.Number({ description: "Maximum bounded wait in milliseconds. Clamped to 0..30000; default 5000." })),
      poll_interval_ms: Type.Optional(Type.Number({ description: "Polling interval in milliseconds. Clamped to 100..5000; default 500." })),
      max_lines: Type.Optional(Type.Number({ description: "Maximum log tail lines, clamped to 1..500; default 80." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const runId = typeof p.run_id === "string" ? p.run_id : "";
      const maxWaitMs = Math.max(0, Math.min(30_000, Math.floor(typeof p.max_wait_ms === "number" ? p.max_wait_ms : 5_000)));
      const pollIntervalMs = Math.max(100, Math.min(5_000, Math.floor(typeof p.poll_interval_ms === "number" ? p.poll_interval_ms : 500)));
      const maxLines = Math.max(1, Math.min(500, Math.floor(typeof p.max_lines === "number" ? p.max_lines : 80)));
      const deadline = Date.now() + maxWaitMs;
      let entry = readRegistryEntry(ctx.cwd, runId);
      let status = buildAgentRunStatus(runId, entry);
      while (status.found && !isTerminalAgentRunState(status.state) && !status.stale && Date.now() < deadline) {
        await sleepMs(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
        entry = readRegistryEntry(ctx.cwd, runId);
        status = buildAgentRunStatus(runId, entry);
      }
      const terminal = status.found && isTerminalAgentRunState(status.state);
      const decision = !status.found ? "missing-run" : terminal ? "terminal" : status.stale ? "running-stale" : "timeout";
      const logPath = entry?.logPath;
      const lines = logPath ? readLogTail(logPath, maxLines) : [];
      const outputBytes = readLogByteCount(logPath);
      const result = {
        mode: "agent-run-follow" as const,
        activation: "none" as const,
        authorization: "none" as const,
        dispatchAllowed: false,
        processStartAllowed: false,
        processStopAllowed: false,
        runId,
        decision,
        terminal,
        status,
        outputBytes,
        logPath,
        maxWaitMs,
        pollIntervalMs,
        maxLines,
        lines,
        recommendation: terminal ? "build-outcome-packet" : decision === "timeout" ? "poll-again-or-wait" : "ask-human",
        summary: [
          "agent-run-follow:",
          `decision=${decision}`,
          `runId=${runId || "unknown"}`,
          `state=${status.state}`,
          `terminal=${terminal ? "yes" : "no"}`,
          `outputBytes=${outputBytes}`,
          `lines=${lines.length}`,
          "dispatch=no",
          "authorization=none",
        ].join(" "),
      };
      return buildOperatorVisibleToolResponse({
        label: "agent_run_follow",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_outcome_packet",
    label: "Agent Run Outcome Packet",
    description: "Report-only outcome packet for agent runs. Separates processState from contractDecision using declared files, touched files, marker results, and rollback cues. Never dispatches execution.",
    parameters: Type.Object({
      run_id: Type.String({ description: "Agent run id." }),
      touched_files: Type.Optional(Type.Array(Type.String(), { description: "Files observed as touched after the run, usually from git status/diff." })),
      marker_results: Type.Optional(Type.Array(Type.Object({
        label: Type.Optional(Type.String({ description: "Marker/check label." })),
        ok: Type.Optional(Type.Boolean({ description: "Whether the marker/check passed." })),
      }), { description: "Optional parent-side validation marker/check results." })),
      output_bytes: Type.Optional(Type.Number({ description: "Worker stdout/output byte count. Zero is a contract failure even when process exit succeeds." })),
      file_contract: Type.Optional(Type.String({ description: "Expected file contract: mutation (default) or read-only. Read-only can pass with no file changes when markers/output pass." })),
      mutation_target_files: Type.Optional(Type.Array(Type.String(), { description: "For mutation runs with read-only packet/input attachments, files expected to be mutated. Touched files must be within this set." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const runId = typeof p.run_id === "string" ? p.run_id : "";
      const entry = readRegistryEntry(ctx.cwd, runId);
      const result = buildAgentRunOutcomePacket({
        runId,
        entry,
        touchedFiles: asOptionalStringArray(p.touched_files),
        markerResults: asMarkerResults(p.marker_results),
        outputBytes: typeof p.output_bytes === "number" ? p.output_bytes : undefined,
        fileContract: typeof p.file_contract === "string" ? p.file_contract : undefined,
        mutationTargetFiles: asOptionalStringArray(p.mutation_target_files),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_run_outcome_packet",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_abort",
    label: "Agent Run Abort",
    description: "Dry-first abort plan for a registered agent run. execute=true requires operator_confirmed=true and only targets the registered worker pid.",
    parameters: Type.Object({
      run_id: Type.String({ description: "Agent run id." }),
      execute: Type.Optional(Type.Boolean({ description: "When true, send SIGTERM to the registered worker pid after gates pass." })),
      operator_confirmed: Type.Optional(Type.Boolean({ description: "Explicit human confirmation for execute=true." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const runId = typeof p.run_id === "string" ? p.run_id : "";
      const entry = readRegistryEntry(ctx.cwd, runId);
      const plan = buildAgentRunAbortPlan({
        runId,
        entry,
        execute: asOptionalBoolean(p.execute),
        operatorConfirmed: asOptionalBoolean(p.operator_confirmed),
        cwdExpected: ctx.cwd,
      });
      if (plan.processStopAllowed && plan.pid) {
        process.kill(plan.pid, "SIGTERM");
      }
      return buildOperatorVisibleToolResponse({
        label: "agent_run_abort",
        summary: plan.summary,
        details: plan,
      });
    },
  });
}
