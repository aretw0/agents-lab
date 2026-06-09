import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { asOptionalBoolean, asOptionalStringArray } from "./guardrails-core-agent-run-basic-surface";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";
import { buildColonySerialFanInPacket, type ColonySerialFanInInput } from "./guardrails-core-colony-fanin-packet";
import { hasStructuredOperatorApproval } from "./guardrails-core-operator-approval";
import { operatorApprovalParameter } from "./guardrails-core-operator-approval-schema";
import { sameCwd } from "./guardrails-core-execution-context";
import {
  appendAgentRunLogLine,
  buildPiSubprocessPreflightLines,
  createAgentRunChildOutputCapture,
  formatAgentRunnerArgvForLog,
  readLogByteCount,
  readRegistryEntry,
  resolvePiSubprocessInvocation,
  writeRegistryEntry,
} from "./guardrails-core-agent-run-surface-runtime";
import {
  buildColonyPlanPacket,
  buildColonySerialDriverDispatchPacket,
  buildColonySerialDriverPacket,
  buildColonyWorkerStartPacket,
  type ColonyPlanInput,
  type ColonySerialDriverDispatchInput,
  type ColonySerialDriverInput,
  type ColonyWorkerStartPacketInput,
} from "./guardrails-core-colony-plan";

function parseWorkerInputs(raw: unknown): NonNullable<ColonyPlanInput["workers"]> {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((worker): worker is Record<string, unknown> => worker != null && typeof worker === "object")
    .map((record): NonNullable<ColonyPlanInput["workers"]>[number] => ({
      id: typeof record.packet_id === "string" ? record.packet_id : undefined,
      objective: typeof record.objective === "string" ? record.objective : undefined,
      declaredFiles: asOptionalStringArray(record.declared_files),
      allowedTools: asOptionalStringArray(record.allowed_tools),
      allowedCapabilities: asOptionalStringArray(record.allowed_capabilities),
      providerModelRef: typeof record.provider_model_ref === "string" ? record.provider_model_ref : undefined,
      budgetEvidencePolicy: typeof record.budget_evidence_policy === "string" ? record.budget_evidence_policy : undefined,
      budgetEvidence: typeof record.budget_evidence === "string" ? record.budget_evidence : undefined,
      stopConditions: asOptionalStringArray(record.stop_conditions),
      expectedArtifact: typeof record.expected_artifact === "string" ? record.expected_artifact : undefined,
    }));
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveHandoffCwd(cwd: string, currentCwd: string): string {
  return cwd === "." || cwd === "" ? currentCwd : cwd;
}

function parseExecutionManifest(raw: unknown): NonNullable<ColonySerialDriverInput["executionManifest"]> {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
    .map((record): NonNullable<ColonySerialDriverInput["executionManifest"]>[number] => ({
      index: asOptionalNumber(record.index),
      workerPacketId: typeof record.worker_packet_id === "string" ? record.worker_packet_id : undefined,
      requiredOutcomeId: typeof record.required_outcome_id === "string" ? record.required_outcome_id : undefined,
      expectedArtifact: typeof record.expected_artifact === "string" ? record.expected_artifact : undefined,
    }));
}

function parseFanInWorkerInputs(raw: unknown): NonNullable<ColonySerialFanInInput["workers"]> {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((worker): worker is Record<string, unknown> => worker != null && typeof worker === "object")
    .map((record): NonNullable<ColonySerialFanInInput["workers"]>[number] => ({
      workerPacketId: typeof record.worker_packet_id === "string" ? record.worker_packet_id : undefined,
      requiredOutcomeId: typeof record.required_outcome_id === "string" ? record.required_outcome_id : undefined,
      expectedArtifact: typeof record.expected_artifact === "string" ? record.expected_artifact : undefined,
      artifactPresent: asOptionalBoolean(record.artifact_present),
      artifactBytes: asOptionalNumber(record.artifact_bytes),
      artifactStatus: typeof record.artifact_status === "string" ? record.artifact_status : undefined,
      processState: typeof record.process_state === "string" ? record.process_state : undefined,
      contractDecision: typeof record.contract_decision === "string" ? record.contract_decision : undefined,
      fileContract: typeof record.file_contract === "string" ? record.file_contract : undefined,
      declaredFiles: asOptionalStringArray(record.declared_files),
      touchedFiles: asOptionalStringArray(record.touched_files),
      blockers: asOptionalStringArray(record.blockers),
      markerFailures: asOptionalStringArray(record.marker_failures),
      outputBytes: asOptionalNumber(record.output_bytes),
      cacheStatus: typeof record.cache_status === "string" ? record.cache_status : undefined,
      antColonyLaunched: asOptionalBoolean(record.ant_colony_launched),
    }));
}

export function registerColonyPlanPacketSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "colony_plan_packet",
    label: "Colony Plan Packet",
    description:
      "Report-only colony local-safe plan packetizer. Decomposes one objective into 2–5 worker packets and a fail-closed fan-in contract. The packet never dispatches execution.",
    parameters: Type.Object({
      plan_id: Type.Optional(Type.String({ description: "Stable plan id used to derive outcome ids." })),
      objective: Type.Optional(Type.String({ description: "Top-level objective for the colony plan." })),
      workers: Type.Optional(Type.Array(Type.Object({
        packet_id: Type.Optional(Type.String({ description: "Stable worker packet id." })),
        objective: Type.Optional(Type.String({ description: "Worker objective/prompt." })),
        declared_files: Type.Optional(Type.Array(Type.String(), { description: "Exact declared files scoped to this worker." })),
        allowed_tools: Type.Optional(Type.Array(Type.String(), { description: "Allowed tool names for this worker packet." })),
        allowed_capabilities: Type.Optional(Type.Array(Type.String(), { description: "Allowed capability labels for this worker packet." })),
        provider_model_ref: Type.Optional(Type.String({ description: "Optional provider/model for this worker." })),
        budget_evidence_policy: Type.Optional(Type.String({ description: "Budget decision hint: ok/warn/blocked/unknown." })),
        budget_evidence: Type.Optional(Type.String({ description: "Budget evidence text." })),
        stop_conditions: Type.Optional(Type.Array(Type.String(), { description: "Explicit stop conditions for this worker." })),
        expected_artifact: Type.Optional(Type.String({ description: "Expected artifact produced by this worker packet." })),
      }), { description: "2 to 5 bounded worker packet definitions." })),
      validation_known: Type.Optional(Type.Boolean({ description: "Whether validation is known." })),
      rollback_plan_known: Type.Optional(Type.Boolean({ description: "Whether rollback is known." })),
      stop_conditions_clear: Type.Optional(Type.Boolean({ description: "Whether stop conditions are explicit and clear before fan-in." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Optional fallback provider/model applied to workers without explicit provider/model." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Block when protected scope is requested." })),
      scheduler_requested: Type.Optional(Type.Boolean({ description: "Block scheduler/daemon execution requests." })),
      repeat_requested: Type.Optional(Type.Boolean({ description: "Block repeat request because it changes lane continuity assumptions." })),
      remote_or_offload_requested: Type.Optional(Type.Boolean({ description: "Block remote/offload requests." })),
      github_actions_requested: Type.Optional(Type.Boolean({ description: "Block GitHub Actions/protected CI requests." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const input: ColonyPlanInput = {
        planId: typeof p.plan_id === "string" ? p.plan_id : undefined,
        objective: typeof p.objective === "string" ? p.objective : undefined,
        workers: parseWorkerInputs(p.workers),
        validationKnown: asOptionalBoolean(p.validation_known),
        rollbackPlanKnown: asOptionalBoolean(p.rollback_plan_known),
        stopConditionsClear: asOptionalBoolean(p.stop_conditions_clear),
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
        schedulerRequested: asOptionalBoolean(p.scheduler_requested),
        repeatRequested: asOptionalBoolean(p.repeat_requested),
        remoteOrOffloadRequested: asOptionalBoolean(p.remote_or_offload_requested),
        githubActionsRequested: asOptionalBoolean(p.github_actions_requested),
      };

      const result = buildColonyPlanPacket(input);
      return buildOperatorVisibleToolResponse({
        label: "colony_plan_packet",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "colony_serial_driver_packet",
    label: "Colony Serial Driver Packet",
    description:
      "Report-only headless serial-lane driver packet. Selects the next worker from executionManifest and never dispatches execution.",
    parameters: Type.Object({
      plan_id: Type.Optional(Type.String({ description: "Parent serial colony plan id." })),
      execution_manifest: Type.Optional(Type.Array(Type.Object({
        index: Type.Optional(Type.Number({ description: "1-based serial worker order." })),
        worker_packet_id: Type.Optional(Type.String({ description: "Worker packet id." })),
        required_outcome_id: Type.Optional(Type.String({ description: "Canonical outcome id for the worker." })),
        expected_artifact: Type.Optional(Type.String({ description: "Expected evidence artifact path." })),
      }), { description: "Ordered executionManifest emitted by colony_plan_packet." })),
      completed_outcomes: Type.Optional(Type.Array(Type.String(), { description: "Required outcome ids already completed and accepted by parent." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const input: ColonySerialDriverInput = {
        planId: typeof p.plan_id === "string" ? p.plan_id : undefined,
        executionManifest: parseExecutionManifest(p.execution_manifest),
        completedOutcomes: asOptionalStringArray(p.completed_outcomes),
      };

      const result = buildColonySerialDriverPacket(input);
      return buildOperatorVisibleToolResponse({
        label: "colony_serial_driver_packet",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "colony_serial_driver_dispatch",
    label: "Colony Serial Driver Dispatch",
    description:
      "Serial driver dispatch wrapper. Preview by default; execute=true requires structured operator approval and starts exactly one worker subprocess.",
    parameters: Type.Object({
      plan_id: Type.Optional(Type.String({ description: "Parent serial colony plan id." })),
      execution_manifest: Type.Optional(Type.Array(Type.Object({
        index: Type.Optional(Type.Number({ description: "1-based serial worker order." })),
        worker_packet_id: Type.Optional(Type.String({ description: "Worker packet id." })),
        required_outcome_id: Type.Optional(Type.String({ description: "Canonical outcome id for the worker." })),
        expected_artifact: Type.Optional(Type.String({ description: "Expected evidence artifact path." })),
      }), { description: "Ordered executionManifest emitted by colony_plan_packet." })),
      completed_outcomes: Type.Optional(Type.Array(Type.String(), { description: "Required outcome ids already completed and accepted by parent." })),
      execute: Type.Optional(Type.Boolean({ description: "When true, start exactly one worker subprocess after structured operator approval." })),
      operator_approval: operatorApprovalParameter("Structured operator approval envelope for execute=true."),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const input: ColonySerialDriverDispatchInput = {
        planId: typeof p.plan_id === "string" ? p.plan_id : undefined,
        executionManifest: parseExecutionManifest(p.execution_manifest),
        completedOutcomes: asOptionalStringArray(p.completed_outcomes),
        execute: asOptionalBoolean(p.execute),
        operatorApproval: p.operator_approval,
      };

      const result = buildColonySerialDriverDispatchPacket(input);
      const currentCwd = ctx?.cwd ?? process.cwd();
      const executeRequested = p.execute === true;
      const structuredOperatorApproval = hasStructuredOperatorApproval(p.operator_approval);
      const handoff = result.nextWorkerHandoff;
      const blockers = [...result.blockers];
      const runId = handoff?.registryRequiredFields.runId ?? "";
      const handoffCwd = resolveHandoffCwd(handoff?.registryRequiredFields.cwd ?? "", currentCwd);
      const existingEntry = runId ? readRegistryEntry(currentCwd, runId) : undefined;
      if (executeRequested && result.decision !== "ready-for-operator-decision") blockers.push("serial-driver-dispatch-packet-blocked");
      if (executeRequested && !handoff) blockers.push("serial-driver-handoff-missing");
      if (executeRequested && !structuredOperatorApproval && !blockers.includes("structured-operator-approval-missing")) {
        blockers.push("structured-operator-approval-missing");
      }
      if (executeRequested && existingEntry?.state === "running") blockers.push("run-already-running");
      if (executeRequested && !sameCwd(handoffCwd, currentCwd)) blockers.push("execute-cwd-mismatch");

      const dispatchAllowed = executeRequested && blockers.length === 0 && Boolean(handoff);
      let pid: number | undefined;
      let registryEntry = handoff
        ? {
            runId: handoff.registryRequiredFields.runId,
            state: "planned" as const,
            providerModelRef: handoff.registryRequiredFields.providerModelRef,
            cwd: currentCwd,
            declaredFiles: handoff.registryRequiredFields.declaredFiles,
            logPath: handoff.registryRequiredFields.logPath,
            timeoutMs: handoff.registryRequiredFields.timeoutMs,
            createdAtIso: new Date().toISOString(),
            lastEventAtIso: new Date().toISOString(),
          }
        : undefined;

      if (dispatchAllowed && handoff && registryEntry) {
        const invocationSpec = handoff.nextWorkerStartPacket.agentInvocationSpecPacket.invocationSpec;
        const logPath = path.isAbsolute(invocationSpec.logPath) ? invocationSpec.logPath : path.join(currentCwd, invocationSpec.logPath);
        mkdirSync(path.dirname(logPath), { recursive: true });
        writeRegistryEntry(currentCwd, registryEntry);
        const subprocess = resolvePiSubprocessInvocation(invocationSpec.executionPreview);
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
        const timeoutMs = invocationSpec.timeoutMs;
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
          const childOutputBytes = outputCapture.outputBytes();
          const zeroOutput = childOutputBytes === 0;
          const silentFailure = !timedOut && exitCode !== 0 && zeroOutput;
          const silentFailureLine = silentFailure
            ? "[agent-runner] failure code=silent-runner-failure message=subprocess exited non-zero without stdout/stderr; preflight lines above record platform/node/cwd/command/entrypoint; next probe should validate provider bootstrap and CLI argument parsing\n"
            : "";
          const elapsedMs = Date.now() - startedAtMs;
          const timeoutLine = timedOut ? `[agent-runner] failure code=runner-timeout message=subprocess exceeded timeoutMs=${timeoutMs} elapsedMs=${elapsedMs} outputBytes=${childOutputBytes} firstOutputElapsedMs=${outputCapture.firstOutputElapsedMs() ?? "none"}; preflight reached command/entrypoint, so next probe should isolate provider/model-call/bootstrap hang\n` : "";
          logStream.write(`${silentFailureLine}${timeoutLine}[agent-runner] close exitCode=${exitCode} signal=${signal || "none"} timedOut=${timedOut ? "yes" : "no"} elapsedMs=${elapsedMs} childOutputBytes=${childOutputBytes} stdoutBytes=${outputCapture.stdoutBytes()} stderrBytes=${outputCapture.stderrBytes()} firstOutputElapsedMs=${outputCapture.firstOutputElapsedMs() ?? "none"}\n`, () => {
            logStream.end(() => {
              writeRegistryEntry(currentCwd, {
                ...registryEntry,
                state: exitCode === 0 ? "completed" : timedOut ? "timed-out" : "failed",
                exitCode,
                ...(silentFailure ? {
                  errorCode: "silent-runner-failure",
                  errorMessage: "subprocess exited non-zero without stdout/stderr; preflight evidence recorded in log",
                } : timedOut ? {
                  errorCode: zeroOutput ? "runner-timeout-zero-output" : "runner-timeout",
                  errorMessage: `subprocess exceeded timeoutMs=${timeoutMs}; ${zeroOutput ? "no stdout/stderr after valid command preflight" : "partial output captured"}`,
                } : {}),
                outputBytes: readLogByteCount(logPath),
                lastEventAtIso: new Date().toISOString(),
              });
            });
          });
        });
      }

      if (executeRequested) {
        const executionResult = {
          ...result,
          mode: "colony-serial-driver-dispatch-execution" as const,
          authorization: dispatchAllowed ? "explicit-operator" as const : result.authorization,
          dispatchAllowed,
          processStartAllowed: dispatchAllowed,
          processStopAllowed: false,
          singleRunOnly: true,
          decision: dispatchAllowed ? "dispatched" as const : blockers.length > 0 ? "blocked" as const : result.decision,
          blockers,
          executeRequested,
          structuredOperatorApproval,
          runId,
          pid,
          registryEntry,
          summary: [
            "colony-serial-driver-dispatch-execution:",
            `decision=${dispatchAllowed ? "dispatched" : blockers.length > 0 ? "blocked" : result.decision}`,
            `runId=${runId || "unknown"}`,
            `execute=${executeRequested ? "yes" : "no"}`,
            `dispatch=${dispatchAllowed ? "yes" : "no"}`,
            pid ? `pid=${pid}` : undefined,
            blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
          ].filter(Boolean).join(" "),
        };
        return buildOperatorVisibleToolResponse({
          label: "colony_serial_driver_dispatch",
          summary: executionResult.summary,
          details: executionResult,
        });
      }

      return buildOperatorVisibleToolResponse({
        label: "colony_serial_driver_dispatch",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "colony_worker_start_packet",
    label: "Colony Worker Start Packet",
    description:
      "Report-only bridge from one colony worker packet to a serial agent invocation spec. It never dispatches and requires explicit operator approval before any future worker start.",
    parameters: Type.Object({
      plan_id: Type.Optional(Type.String({ description: "Parent colony plan id." })),
      worker_packet_id: Type.Optional(Type.String({ description: "Selected worker packet id." })),
      objective: Type.Optional(Type.String({ description: "Worker objective/prompt." })),
      declared_files: Type.Optional(Type.Array(Type.String(), { description: "Exact declared files scoped to this worker." })),
      allowed_tools: Type.Optional(Type.Array(Type.String(), { description: "Allowed tool names inherited from the worker packet." })),
      allowed_capabilities: Type.Optional(Type.Array(Type.String(), { description: "Allowed capability labels inherited from the worker packet." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Optional provider/model for this worker." })),
      budget_evidence_policy: Type.Optional(Type.String({ description: "Budget decision hint: ok/warn/blocked/unknown." })),
      budget_evidence: Type.Optional(Type.String({ description: "Budget evidence text." })),
      stop_conditions: Type.Optional(Type.Array(Type.String(), { description: "Explicit stop conditions for this worker." })),
      expected_artifact: Type.Optional(Type.String({ description: "Expected artifact produced by this worker packet." })),
      cwd: Type.Optional(Type.String({ description: "Worker cwd. Defaults downstream when omitted." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Bounded timeout in milliseconds." })),
      mutation_requested: Type.Optional(Type.Boolean({ description: "When true, bridge to a mutation profile; otherwise read-only review." })),
      validation: Type.Optional(Type.Array(Type.String(), { description: "Additional parent-side validation gates." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const input: ColonyWorkerStartPacketInput = {
        planId: typeof p.plan_id === "string" ? p.plan_id : undefined,
        workerPacketId: typeof p.worker_packet_id === "string" ? p.worker_packet_id : undefined,
        objective: typeof p.objective === "string" ? p.objective : undefined,
        declaredFiles: asOptionalStringArray(p.declared_files),
        allowedTools: asOptionalStringArray(p.allowed_tools),
        allowedCapabilities: asOptionalStringArray(p.allowed_capabilities),
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        budgetEvidencePolicy: typeof p.budget_evidence_policy === "string" ? p.budget_evidence_policy : undefined,
        budgetEvidence: typeof p.budget_evidence === "string" ? p.budget_evidence : undefined,
        stopConditions: asOptionalStringArray(p.stop_conditions),
        expectedArtifact: typeof p.expected_artifact === "string" ? p.expected_artifact : undefined,
        cwd: typeof p.cwd === "string" ? p.cwd : undefined,
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        mutationRequested: asOptionalBoolean(p.mutation_requested),
        validation: asOptionalStringArray(p.validation),
      };

      const result = buildColonyWorkerStartPacket(input);
      return buildOperatorVisibleToolResponse({
        label: "colony_worker_start_packet",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "colony_serial_fanin_packet",
    label: "Colony Serial Fan-in Packet",
    description:
      "Report-only fail-closed fan-in for serial colony worker outcomes. It distinguishes read-only declared files from expected artifact evidence and never dispatches execution.",
    parameters: Type.Object({
      plan_id: Type.Optional(Type.String({ description: "Stable plan id used by outcome ids." })),
      batch_id: Type.Optional(Type.String({ description: "Optional fan-in batch id." })),
      required_outcome_ids: Type.Optional(Type.Array(Type.String(), { description: "Required canonical outcome ids." })),
      workers: Type.Optional(Type.Array(Type.Object({
        worker_packet_id: Type.Optional(Type.String({ description: "Worker packet id." })),
        required_outcome_id: Type.Optional(Type.String({ description: "Canonical outcome id: outcome:<planId>:<workerPacketId>." })),
        expected_artifact: Type.Optional(Type.String({ description: "Expected evidence artifact path." })),
        artifact_present: Type.Optional(Type.Boolean({ description: "Whether expected artifact exists." })),
        artifact_bytes: Type.Optional(Type.Number({ description: "Expected artifact byte count." })),
        artifact_status: Type.Optional(Type.String({ description: "Artifact status, usually PASS/FAIL." })),
        process_state: Type.Optional(Type.String({ description: "Worker process state." })),
        contract_decision: Type.Optional(Type.String({ description: "Outcome contract decision." })),
        file_contract: Type.Optional(Type.String({ description: "Worker file contract, e.g. read-only." })),
        declared_files: Type.Optional(Type.Array(Type.String(), { description: "Read-only declared files for the worker." })),
        touched_files: Type.Optional(Type.Array(Type.String(), { description: "Files touched according to parent evidence." })),
        blockers: Type.Optional(Type.Array(Type.String(), { description: "Worker blockers." })),
        marker_failures: Type.Optional(Type.Array(Type.String(), { description: "Marker failures." })),
        output_bytes: Type.Optional(Type.Number({ description: "Worker output byte count." })),
        cache_status: Type.Optional(Type.String({ description: "Legacy cache status: hit/miss/unknown." })),
        ant_colony_launched: Type.Optional(Type.Boolean({ description: "Whether ant_colony launch was detected." })),
      }), { description: "Serial worker outcome evidence rows." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const input: ColonySerialFanInInput = {
        planId: typeof p.plan_id === "string" ? p.plan_id : undefined,
        batchId: typeof p.batch_id === "string" ? p.batch_id : undefined,
        requiredOutcomeIds: asOptionalStringArray(p.required_outcome_ids),
        workers: parseFanInWorkerInputs(p.workers),
      };

      const result = buildColonySerialFanInPacket(input);
      return buildOperatorVisibleToolResponse({
        label: "colony_serial_fanin_packet",
        summary: result.summary,
        details: result,
      });
    },
  });
}
