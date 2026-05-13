import { AuthStorage, createAgentSession, DefaultResourceLoader, getAgentDir, ModelRegistry, SessionManager, SettingsManager } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type AgentRunSdkInProcessPacketResult } from "./guardrails-core-agent-run-sdk-preview";
import { type AgentRunRegistryEntry, type AgentRunState } from "./guardrails-core-agent-run-runtime";
import { buildDeclaredFileScopedSdkWorkerTools } from "./guardrails-core-tool-policy";

function registryPath(cwd: string): string {
  return path.join(cwd, ".pi", "reports", "agent-runs.json");
}

function readRegistryRows(cwd: string): AgentRunRegistryEntry[] {
  const filePath = registryPath(cwd);
  if (!existsSync(filePath)) return [];
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { runs?: AgentRunRegistryEntry[] } | AgentRunRegistryEntry[];
  return Array.isArray(parsed) ? parsed : Array.isArray(parsed.runs) ? parsed.runs : [];
}

export function readRegistryEntry(cwd: string, runId: string): AgentRunRegistryEntry | undefined {
  return readRegistryRows(cwd).find((row) => row?.runId === runId);
}

export function writeRegistryEntry(cwd: string, entry: AgentRunRegistryEntry): void {
  const filePath = registryPath(cwd);
  const rows = readRegistryRows(cwd).filter((row) => row?.runId !== entry.runId);
  rows.push(entry);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify({ runs: rows }, null, 2), "utf8");
}

export function readLogTail(logPath: string, maxLines: number): string[] {
  if (!logPath || !existsSync(logPath)) return [];
  const text = readFileSync(logPath, "utf8");
  return text.split(/\r?\n/).slice(-Math.max(1, Math.min(500, Math.floor(maxLines))));
}

export function readLogByteCount(logPath: string | undefined): number {
  if (!logPath || !existsSync(logPath)) return 0;
  return statSync(logPath).size;
}

export function isTerminalAgentRunState(state: AgentRunState): boolean {
  return state === "completed" || state === "failed" || state === "timed-out" || state === "aborted";
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolvePiSubprocessInvocation(preview: { command: string; args: string[] }): { command: string; args: string[]; source: "current-node-entrypoint" | "preview-command" } {
  const currentEntrypoint = typeof process.argv[1] === "string" && process.argv[1].trim() ? process.argv[1] : "";
  if (currentEntrypoint && preview.command === "pi") {
    return { command: process.execPath, args: [currentEntrypoint, ...preview.args], source: "current-node-entrypoint" };
  }
  return { command: preview.command, args: preview.args, source: "preview-command" };
}

export function buildPiSubprocessPreflightLines(cwd: string, subprocess: { command: string; args: string[]; source: string }): string[] {
  const entrypoint = subprocess.source === "current-node-entrypoint" ? subprocess.args[0] : undefined;
  const commandLooksPath = path.isAbsolute(subprocess.command) || /[\\/]/.test(subprocess.command);
  return [
    `[agent-runner] preflight platform=${process.platform} node=${process.version} cwdExists=${existsSync(cwd) ? "yes" : "no"}`,
    `[agent-runner] preflight commandExists=${commandLooksPath ? existsSync(subprocess.command) ? "yes" : "no" : "path-lookup"} command=${subprocess.command}`,
    entrypoint ? `[agent-runner] preflight entrypointExists=${existsSync(entrypoint) ? "yes" : "no"} entrypoint=${entrypoint}` : "[agent-runner] preflight entrypointExists=not-applicable",
  ];
}

export function appendAgentRunLogLine(logPath: string, line: string): void {
  mkdirSync(path.dirname(logPath), { recursive: true });
  writeFileSync(logPath, `${line}\n`, { flag: "a", encoding: "utf8" });
}

export function formatAgentRunnerArgvForLog(args: string[], maxChars = 2000): string {
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

const SDK_ASSISTANT_OUTPUT_LOG_MAX_BYTES = 48_000;

interface SdkAssistantOutputCapture {
  capturedBytes: number;
  truncated: boolean;
  seenOutput: Set<string>;
  streamedText: string;
}

function truncateUtf8Text(text: string, maxBytes: number): { text: string; bytes: number; truncated: boolean } {
  const totalBytes = Buffer.byteLength(text);
  if (totalBytes <= maxBytes) return { text, bytes: totalBytes, truncated: false };
  let bytes = 0;
  let clipped = "";
  for (const char of text) {
    const charBytes = Buffer.byteLength(char);
    if (bytes + charBytes > maxBytes) break;
    clipped += char;
    bytes += charBytes;
  }
  return { text: clipped, bytes, truncated: true };
}

function isDuplicateAssistantOutput(normalized: string, seenOutput: Set<string>): boolean {
  if (seenOutput.has(normalized)) return true;
  for (const seen of seenOutput) {
    if (seen.length >= 80 && normalized.includes(seen)) return true;
  }
  return false;
}

function appendAssistantOutput(logPath: string, text: string, capture: SdkAssistantOutputCapture): number {
  const normalized = text.trim();
  if (!normalized || isDuplicateAssistantOutput(normalized, capture.seenOutput)) return 0;
  capture.seenOutput.add(normalized);

  const remainingBytes = Math.max(0, SDK_ASSISTANT_OUTPUT_LOG_MAX_BYTES - capture.capturedBytes);
  if (remainingBytes <= 0) {
    if (!capture.truncated) appendAgentRunLogLine(logPath, `[sdk-runner] assistant-output-truncated maxBytes=${SDK_ASSISTANT_OUTPUT_LOG_MAX_BYTES}`);
    capture.truncated = true;
    return 0;
  }

  const clipped = truncateUtf8Text(normalized, remainingBytes);
  if (clipped.text) appendAgentRunLogLine(logPath, clipped.text);
  capture.capturedBytes += clipped.bytes;
  if (clipped.truncated && !capture.truncated) {
    appendAgentRunLogLine(logPath, `[sdk-runner] assistant-output-truncated maxBytes=${SDK_ASSISTANT_OUTPUT_LOG_MAX_BYTES}`);
    capture.truncated = true;
  }
  return clipped.bytes;
}

function formatSdkDeclaredFilesForPrompt(declaredFiles: string[]): string {
  return declaredFiles.map((file) => `- ${file}`).join("\n");
}

function buildSdkScopedWorkerPrompt(goal: string, declaredFiles: string[]): string {
  return [
    "Declared files (only these exact paths are allowed unless a declared entry is a directory):",
    formatSdkDeclaredFilesForPrompt(declaredFiles),
    "",
    "Tool cadence: inspect each declared file at most twice unless the result is clearly incomplete; then produce the final answer instead of continuing to search.",
    "If evidence is missing, report the missing evidence explicitly and stop.",
    "",
    goal,
  ].join("\n");
}

function computeSdkLoopGuardLimits(toolAllowlist: string[], declaredFiles: string[]): { maxToolCalls: number; maxTurns: number } {
  const toolBudget = Math.max(1, toolAllowlist.length);
  const fileBudget = Math.max(1, declaredFiles.length);
  return {
    maxToolCalls: Math.max(8, Math.min(24, toolBudget * 4 + fileBudget * 3)),
    maxTurns: Math.max(4, Math.min(8, 3 + fileBudget)),
  };
}

export function startSdkInProcessWorker(ctxCwd: string, packet: AgentRunSdkInProcessPacketResult): { logPath: string } {
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
    const { maxToolCalls, maxTurns } = computeSdkLoopGuardLimits(packet.runSpec.toolAllowlist, packet.runSpec.declaredFiles);
    let outputBytes = 0;
    let timedOut = false;
    let loopAbortReason = "";
    let agentEnded = false;
    let toolCallCount = 0;
    let turnCount = 0;
    const outputCapture: SdkAssistantOutputCapture = { capturedBytes: 0, truncated: false, seenOutput: new Set<string>(), streamedText: "" };
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
          "Prefer no more than two tool calls per declared file; summarize partial evidence instead of looping.",
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
            outputCapture.streamedText += assistantMessageEvent.delta;
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
          appendAgentRunLogLine(logPath, `[sdk-runner] event=turn_end count=${turnCount}`);
          if (turnCount > maxTurns && !loopAbortReason) {
            loopAbortReason = `sdk-runner-turn-loop turns=${turnCount} maxTurns=${maxTurns}`;
            appendAgentRunLogLine(logPath, `[sdk-runner] loop-guard ${loopAbortReason}; aborting session`);
            void session?.abort();
          }
        } else if (row.type === "agent_end") {
          agentEnded = true;
          outputBytes += appendAssistantOutput(logPath, outputCapture.streamedText, outputCapture);
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
        outputBytes += appendAssistantOutput(logPath, outputCapture.streamedText, outputCapture);
        unsubscribe();
        session.dispose();
      }
      if (loopAbortReason) {
        const readOnlyFinalOutputAfterTurnLoop = packet.runSpec.fileContract === "read-only" && loopAbortReason.startsWith("sdk-runner-turn-loop") && agentEnded && outputBytes > 0;
        if (readOnlyFinalOutputAfterTurnLoop) {
          finish({ state: "completed", errorCode: "sdk-runner-loop-guard-with-output", errorMessage: loopAbortReason, outputBytes });
          appendAgentRunLogLine(logPath, `[sdk-runner] close state=completed reason=loop-guard-with-output outputBytes=${outputBytes}`);
          return;
        }
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
