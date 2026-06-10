import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { GUARDRAILS_AUTHORIZATION_NONE } from "./guardrails-core-authorization";
import { buildAgentRunOutcomePacket, buildAgentRunStatus, type AgentRunFileContract, type AgentRunMarkerResult, type AgentRunState } from "./guardrails-core-agent-run-runtime";
import {
  appendAgentRunLogLine,
  buildPiSubprocessPreflightLines,
  createAgentRunChildOutputCapture,
  formatAgentRunnerArgvForLog,
  isTerminalAgentRunState,
  readLogByteCount,
  readLogTail,
  readRegistryEntry,
  resolvePiSubprocessInvocation,
  sleepMs,
  writeRegistryEntry,
} from "./guardrails-core-agent-run-surface-runtime";
import { asOptionalStringArray } from "./guardrails-core-param-normalizers";
import { sameCwd } from "./guardrails-core-execution-context";
import { hasStructuredOperatorApproval } from "./guardrails-core-operator-approval";
import { operatorApprovalParameter } from "./guardrails-core-operator-approval-schema";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

type DriverStepRunSpec = {
  runId: string;
  providerModelRef: string;
  cwd: string;
  declaredFiles: string[];
  logPath: string;
  timeoutMs: number;
  fileContract: AgentRunFileContract;
  executionPreview: {
    command: string;
    args: string[];
  };
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimeoutMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 90_000;
}

function parseExecutionPreview(raw: unknown): DriverStepRunSpec["executionPreview"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { command: "", args: [] };
  const row = raw as Record<string, unknown>;
  return {
    command: normalizeText(row.command),
    args: asOptionalStringArray(row.args),
  };
}

function parseFileContract(value: unknown): AgentRunFileContract {
  return value === "mutation" ? "mutation" : "read-only";
}

function parseMarkerResults(raw: unknown): AgentRunMarkerResult[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row))
    .map((row) => ({
      label: normalizeText(row.label),
      ...(row.ok === true || row.ok === false ? { ok: row.ok } : {}),
    }));
}

function parseRunSpec(raw: unknown): DriverStepRunSpec {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return {
    runId: normalizeText(row.run_id),
    providerModelRef: normalizeText(row.provider_model_ref),
    cwd: normalizeText(row.cwd) || ".",
    declaredFiles: asOptionalStringArray(row.declared_files),
    logPath: normalizeText(row.log_path),
    timeoutMs: normalizeTimeoutMs(row.timeout_ms),
    fileContract: parseFileContract(row.file_contract),
    executionPreview: parseExecutionPreview(row.execution_preview),
  };
}

function resolveRunCwd(cwd: string, currentCwd: string): string {
  return cwd === "." || cwd === "" ? currentCwd : cwd;
}

async function followAgentRun(cwd: string, runId: string, maxWaitMs: number, pollIntervalMs: number, maxLines: number) {
  const deadline = Date.now() + maxWaitMs;
  let entry = readRegistryEntry(cwd, runId);
  let status = buildAgentRunStatus(runId, entry);
  while (status.found && !isTerminalAgentRunState(status.state as AgentRunState) && !status.stale && Date.now() < deadline) {
    await sleepMs(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    entry = readRegistryEntry(cwd, runId);
    status = buildAgentRunStatus(runId, entry);
  }
  const terminal = status.found && isTerminalAgentRunState(status.state as AgentRunState);
  const decision = !status.found ? "missing-run" : terminal ? "terminal" : status.stale ? "running-stale" : "timeout";
  const logPath = entry?.logPath
    ? path.isAbsolute(entry.logPath) ? entry.logPath : path.join(cwd, entry.logPath)
    : undefined;
  const lines = logPath ? readLogTail(logPath, maxLines) : [];
  const outputBytes = readLogByteCount(logPath);
  return { entry, status, terminal, decision, logPath, lines, outputBytes };
}

function outcomePacket(input: {
  runId: string;
  outputBytes: number;
  fileContract: AgentRunFileContract;
  touchedFiles?: string[];
  markerResults?: AgentRunMarkerResult[];
  mutationTargetFiles?: string[];
}) {
  return {
    tool: "agent_run_outcome_packet",
    params: {
      run_id: input.runId,
      output_bytes: input.outputBytes,
      file_contract: input.fileContract,
      ...(input.touchedFiles && input.touchedFiles.length > 0 ? { touched_files: input.touchedFiles } : {}),
      ...(input.markerResults && input.markerResults.length > 0 ? { marker_results: input.markerResults } : {}),
      ...(input.mutationTargetFiles && input.mutationTargetFiles.length > 0 ? { mutation_target_files: input.mutationTargetFiles } : {}),
    },
  };
}

export function registerAgentRunDriverStepSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "agent_run_driver_step_dispatch",
    label: "Agent Run Driver Step Dispatch",
    description:
      "Agnostic one-run driver step. Preview by default; execute=true requires structured operator approval, starts at most one subprocess, can follow boundedly, and never performs fan-in.",
    parameters: Type.Object({
      run_spec: Type.Optional(Type.Object({
        run_id: Type.Optional(Type.String({ description: "Stable agent run id." })),
        provider_model_ref: Type.Optional(Type.String({ description: "Provider/model ref for the worker." })),
        cwd: Type.Optional(Type.String({ description: "Run cwd. Must match current tool cwd for execute=true." })),
        declared_files: Type.Optional(Type.Array(Type.String(), { description: "Declared file scope for the run." })),
        log_path: Type.Optional(Type.String({ description: "Run log path." })),
        timeout_ms: Type.Optional(Type.Number({ description: "Bounded timeout in milliseconds." })),
        file_contract: Type.Optional(Type.String({ description: "File contract for outcome materialization: read-only or mutation. Defaults to read-only." })),
        execution_preview: Type.Optional(Type.Object({
          command: Type.Optional(Type.String({ description: "Command to execute." })),
          args: Type.Optional(Type.Array(Type.String(), { description: "Command argv." })),
        }, { description: "Typed command preview." })),
      }, { description: "Generic run spec or handoff payload." })),
      execute: Type.Optional(Type.Boolean({ description: "When true, start exactly one subprocess after structured operator approval." })),
      operator_approval: operatorApprovalParameter("Structured operator approval envelope for execute=true."),
      follow: Type.Optional(Type.Boolean({ description: "When true, perform bounded read-only follow after lookup or dispatch." })),
      build_outcome: Type.Optional(Type.Boolean({ description: "When true with follow terminal, materialize an embedded agent-run outcome packet." })),
      touched_files: Type.Optional(Type.Array(Type.String(), { description: "Optional parent-observed touched files to pass into the embedded/next outcome packet." })),
      marker_results: Type.Optional(Type.Array(Type.Object({
        label: Type.Optional(Type.String({ description: "Marker/check label." })),
        ok: Type.Optional(Type.Boolean({ description: "Whether the marker/check passed." })),
      }), { description: "Optional parent-side marker/check results for the embedded/next outcome packet." })),
      mutation_target_files: Type.Optional(Type.Array(Type.String(), { description: "Optional expected mutation target files for mutation contract outcome materialization." })),
      follow_max_wait_ms: Type.Optional(Type.Number({ description: "Maximum bounded follow wait in milliseconds. Clamped to 0..30000; default 5000." })),
      follow_poll_interval_ms: Type.Optional(Type.Number({ description: "Follow polling interval in milliseconds. Clamped to 100..5000; default 500." })),
      follow_max_lines: Type.Optional(Type.Number({ description: "Maximum log tail lines, clamped to 1..500; default 80." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const currentCwd = ctx?.cwd ?? process.cwd();
      const runSpec = parseRunSpec(p.run_spec);
      const executeRequested = p.execute === true;
      const followRequested = p.follow === true;
      const buildOutcomeRequested = p.build_outcome === true;
      const touchedFiles = asOptionalStringArray(p.touched_files);
      const markerResults = parseMarkerResults(p.marker_results);
      const mutationTargetFiles = asOptionalStringArray(p.mutation_target_files);
      const structuredOperatorApproval = hasStructuredOperatorApproval(p.operator_approval);
      const runCwd = resolveRunCwd(runSpec.cwd, currentCwd);
      const existingEntry = runSpec.runId ? readRegistryEntry(currentCwd, runSpec.runId) : undefined;
      const blockers: string[] = [];

      if (!runSpec.runId) blockers.push("run-id-missing");
      if (runSpec.declaredFiles.length === 0) blockers.push("declared-files-missing");
      if (!runSpec.logPath) blockers.push("log-path-missing");
      if (!runSpec.executionPreview.command) blockers.push("execution-preview-command-missing");
      if (executeRequested && !structuredOperatorApproval) blockers.push("structured-operator-approval-missing");
      if (executeRequested && existingEntry?.state === "running") blockers.push("run-already-running");
      if (executeRequested && !sameCwd(runCwd, currentCwd)) blockers.push("execute-cwd-mismatch");

      const dispatchAllowed = executeRequested && blockers.length === 0;
      let pid: number | undefined;
      let registryEntry = runSpec.runId
        ? {
            runId: runSpec.runId,
            state: "planned" as const,
            providerModelRef: runSpec.providerModelRef,
            cwd: currentCwd,
            declaredFiles: runSpec.declaredFiles,
            logPath: runSpec.logPath,
            timeoutMs: runSpec.timeoutMs,
            createdAtIso: new Date().toISOString(),
            lastEventAtIso: new Date().toISOString(),
          }
        : undefined;

      if (dispatchAllowed && registryEntry) {
        const logPath = path.isAbsolute(runSpec.logPath) ? runSpec.logPath : path.join(currentCwd, runSpec.logPath);
        mkdirSync(path.dirname(logPath), { recursive: true });
        writeRegistryEntry(currentCwd, registryEntry);
        const subprocess = resolvePiSubprocessInvocation(runSpec.executionPreview);
        appendAgentRunLogLine(logPath, `[agent-runner] starting command=${subprocess.command} source=${subprocess.source} cwd=${currentCwd}`);
        appendAgentRunLogLine(logPath, `[agent-runner] argv=${formatAgentRunnerArgvForLog(subprocess.args)}`);
        for (const line of buildPiSubprocessPreflightLines(currentCwd, subprocess)) appendAgentRunLogLine(logPath, line);
        const logStream = createWriteStream(logPath, { flags: "a" });
        const startedAtMs = Date.now();
        const outputCapture = createAgentRunChildOutputCapture(logStream, startedAtMs);
        const child = spawn(subprocess.command, subprocess.args, { cwd: currentCwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
        pid = child.pid;
        child.stdout?.on("data", outputCapture.captureChildOutput("stdout"));
        child.stderr?.on("data", outputCapture.captureChildOutput("stderr"));
        registryEntry = {
          ...registryEntry,
          ...(pid ? { pid } : {}),
          state: "running",
          startedAtIso: new Date().toISOString(),
          lastEventAtIso: new Date().toISOString(),
        };
        writeRegistryEntry(currentCwd, registryEntry);
        const timeoutMs = runSpec.timeoutMs;
        let settled = false;
        let timedOut = false;
        const timeout = setTimeout(() => {
          timedOut = true;
          logStream.write(`[agent-runner] timeout ms=${timeoutMs} elapsedMs=${Date.now() - startedAtMs}; sending SIGTERM\n`);
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
              writeRegistryEntry(currentCwd, {
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
        child.on("close", (code, signal) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          const exitCode = typeof code === "number" ? code : timedOut ? 124 : 1;
          const elapsedMs = Date.now() - startedAtMs;
          const childOutputBytes = outputCapture.outputBytes();
          logStream.write(`[agent-runner] close exitCode=${exitCode} signal=${signal || "none"} timedOut=${timedOut ? "yes" : "no"} elapsedMs=${elapsedMs} childOutputBytes=${childOutputBytes} stdoutBytes=${outputCapture.stdoutBytes()} stderrBytes=${outputCapture.stderrBytes()} firstOutputElapsedMs=${outputCapture.firstOutputElapsedMs() ?? "none"}\n`, () => {
            logStream.end(() => {
              writeRegistryEntry(currentCwd, {
                ...registryEntry,
                state: exitCode === 0 ? "completed" : timedOut ? "timed-out" : "failed",
                exitCode,
                outputBytes: readLogByteCount(logPath),
                lastEventAtIso: new Date().toISOString(),
              });
            });
          });
        });
      }

      const maxWaitMs = Math.max(0, Math.min(30_000, Math.floor(typeof p.follow_max_wait_ms === "number" ? p.follow_max_wait_ms : 5_000)));
      const pollIntervalMs = Math.max(100, Math.min(5_000, Math.floor(typeof p.follow_poll_interval_ms === "number" ? p.follow_poll_interval_ms : 500)));
      const maxLines = Math.max(1, Math.min(500, Math.floor(typeof p.follow_max_lines === "number" ? p.follow_max_lines : 80)));
      const follow = followRequested && runSpec.runId
        ? await followAgentRun(currentCwd, runSpec.runId, maxWaitMs, pollIntervalMs, maxLines)
        : undefined;
      const terminal = follow?.terminal === true;
      const agentRunOutcomePacket = terminal && buildOutcomeRequested
        ? buildAgentRunOutcomePacket({
            runId: runSpec.runId,
            entry: follow.entry,
            touchedFiles,
            markerResults,
            outputBytes: follow.outputBytes,
            fileContract: runSpec.fileContract,
            mutationTargetFiles,
          })
        : undefined;
      const mode = executeRequested ? "agent-run-driver-step-dispatch" as const : "agent-run-driver-step-packet" as const;
      const decision = dispatchAllowed ? "dispatched" : blockers.length > 0 ? "blocked" : "ready-for-operator-decision";
      const result = {
        mode,
        activation: "none" as const,
        authorization: dispatchAllowed ? "explicit-operator" as const : GUARDRAILS_AUTHORIZATION_NONE,
        dispatchAllowed,
        processStartAllowed: dispatchAllowed,
        processStopAllowed: false,
        singleRunOnly: true,
        decision,
        blockers,
        runSpec,
        executeRequested,
        structuredOperatorApproval,
        followRequested,
        buildOutcomeRequested,
        pid,
        registryEntry,
        follow,
        nextAgentRunOutcomePacket: terminal ? outcomePacket({
          runId: runSpec.runId,
          outputBytes: follow.outputBytes,
          fileContract: runSpec.fileContract,
          touchedFiles,
          markerResults,
          mutationTargetFiles,
        }) : undefined,
        agentRunOutcomePacket,
        nextActionCode: terminal ? "build-agent-run-outcome-packet" : dispatchAllowed ? "poll-agent-run-follow" : blockers.length > 0 ? "resolve-driver-step-blockers" : "present-operator-approval",
        summary: [
          "agent-run-driver-step:",
          `mode=${mode}`,
          `decision=${decision}`,
          `runId=${runSpec.runId || "unknown"}`,
          `execute=${executeRequested ? "yes" : "no"}`,
          `dispatch=${dispatchAllowed ? "yes" : "no"}`,
          follow ? `follow=${follow.decision}` : undefined,
          terminal ? "next=outcome" : undefined,
          pid ? `pid=${pid}` : undefined,
          blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
        ].filter(Boolean).join(" "),
      };
      return buildOperatorVisibleToolResponse({
        label: "agent_run_driver_step_dispatch",
        summary: result.summary,
        details: result,
      });
    },
  });
}
