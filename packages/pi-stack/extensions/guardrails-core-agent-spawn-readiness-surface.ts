/**
 * @capability-id runtime-guardrails
 * @capability-criticality high
 */
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { asOptionalBoolean, asOptionalStringArray, registerAgentRunBasicTools } from "./guardrails-core-agent-run-basic-surface";
import { buildAgentRunExecutorStrategyPacket } from "./guardrails-core-agent-run-executor-strategy";
import { evaluateAgentWorkerLaneReadiness } from "./guardrails-core-agent-worker-lane";
import { buildAgentRunBatchDryRunPacket } from "./guardrails-core-agent-run-batch-dry-run";
import { registerAgentRunSdkProviderModelArenaTool } from "./guardrails-core-agent-run-sdk-arena-surface";
import { registerAgentRunSdkReadOnlyBatchTools } from "./guardrails-core-agent-run-sdk-batch-surface";
import { registerAgentRunLifecycleTools } from "./guardrails-core-agent-run-lifecycle-surface";
import { buildAgentRunSdkCachePackPacket, buildAgentRunSdkInProcessPacket } from "./guardrails-core-agent-run-sdk-preview";
import { buildAgentInvocationSpecPacket, buildAgentRunOperatorPacket, buildAgentRunStartPacket, buildAgentRunTaskPacket, buildAgentRunTaskStartPacket, buildPromotedWorkerPacket } from "./guardrails-core-agent-run-start";
import { hasStructuredOperatorApproval } from "./guardrails-core-operator-approval";
import { operatorApprovalParameter } from "./guardrails-core-operator-approval-schema";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";
import { readTasksBlockCached } from "./project-board-model";
import { resolveExecutionCwdParam, sameCwd } from "./guardrails-core-execution-context";
import { appendAgentRunLogLine, buildPiSubprocessPreflightLines, createAgentRunChildOutputCapture, formatAgentRunnerArgvForLog, readLogByteCount, readRegistryEntry, resolvePiSubprocessInvocation, startSdkInProcessWorker, writeRegistryEntry } from "./guardrails-core-agent-run-surface-runtime";

export function registerGuardrailsAgentSpawnReadinessSurface(pi: ExtensionAPI): void {
  registerAgentRunBasicTools(pi);

  pi.registerTool({
    name: "agent_run_batch_dry_run",
    label: "Agent Run Batch Dry Run",
    description: "Report-only batch canary for planned local-safe worker runIds. Never starts workers; each planned run must still pass lower agent-run gates.",
    parameters: Type.Object({
      batch_id: Type.Optional(Type.String({ description: "Stable batch id for deriving planned runIds." })),
      authorization: Type.Optional(Type.String({ description: "Must be explicit-local-batch. Generic authorization is blocked." })),
      workers: Type.Optional(Type.Array(Type.Object({
        task_id: Type.Optional(Type.String({ description: "Task id or local slice label for this planned worker." })),
        run_id: Type.Optional(Type.String({ description: "Optional explicit planned run id." })),
        goal: Type.Optional(Type.String({ description: "Worker goal/prompt." })),
        provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference." })),
        cwd: Type.Optional(Type.String({ description: "Worker cwd. Defaults to current cwd when omitted." })),
        declared_files: Type.Optional(Type.Array(Type.String(), { description: "Exact file scope for this worker." })),
        timeout_ms: Type.Optional(Type.Number({ description: "Bounded timeout in milliseconds." })),
        file_contract: Type.Optional(Type.String({ description: "read-only or mutation." })),
        budget_decision: Type.Optional(Type.String({ description: "Provider/model budget decision." })),
        budget_evidence: Type.Optional(Type.String({ description: "Short provider/model budget evidence." })),
        protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks this worker when protected scope is requested." })),
      }), { description: "Planned workers for dry-run preview. Initial batch canary stays report-only and concurrency=1." })),
      requested_run_id: Type.Optional(Type.String({ description: "Optional selected runId to verify it belongs to this batch." })),
      local_safe_scope: Type.Optional(Type.Boolean({ description: "Whether the batch scope is local-safe." })),
      validation_gate_known: Type.Optional(Type.Boolean({ description: "Whether parent-side validation is known." })),
      rollback_plan_known: Type.Optional(Type.Boolean({ description: "Whether rollback is known." })),
      stop_conditions_clear: Type.Optional(Type.Boolean({ description: "Whether stop conditions are clear." })),
      concurrent_worker_limit: Type.Optional(Type.Number({ description: "Must be 1 for the first canary." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks protected scope." })),
      scheduler_requested: Type.Optional(Type.Boolean({ description: "Blocks scheduler requests." })),
      repeat_requested: Type.Optional(Type.Boolean({ description: "Blocks persistent repeat requests." })),
      remote_or_offload_requested: Type.Optional(Type.Boolean({ description: "Blocks remote/offload requests." })),
      github_actions_requested: Type.Optional(Type.Boolean({ description: "Blocks GitHub Actions/protected CI requests." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const workers = Array.isArray(p.workers)
        ? p.workers.map((worker) => {
            const record = (worker ?? {}) as Record<string, unknown>;
            return {
              taskId: typeof record.task_id === "string" ? record.task_id : undefined,
              runId: typeof record.run_id === "string" ? record.run_id : undefined,
              goal: typeof record.goal === "string" ? record.goal : undefined,
              providerModelRef: typeof record.provider_model_ref === "string" ? record.provider_model_ref : undefined,
              cwd: typeof record.cwd === "string" ? record.cwd : ctx?.cwd,
              declaredFiles: asOptionalStringArray(record.declared_files),
              timeoutMs: typeof record.timeout_ms === "number" ? record.timeout_ms : undefined,
              fileContract: typeof record.file_contract === "string" ? record.file_contract : undefined,
              budgetDecision: typeof record.budget_decision === "string" ? record.budget_decision : undefined,
              budgetEvidence: typeof record.budget_evidence === "string" ? record.budget_evidence : undefined,
              protectedScopeRequested: asOptionalBoolean(record.protected_scope_requested),
            };
          })
        : [];
      const result = buildAgentRunBatchDryRunPacket({
        batchId: typeof p.batch_id === "string" ? p.batch_id : undefined,
        authorization: typeof p.authorization === "string" ? p.authorization : undefined,
        workers,
        requestedRunId: typeof p.requested_run_id === "string" ? p.requested_run_id : undefined,
        localSafeScope: asOptionalBoolean(p.local_safe_scope),
        validationGateKnown: asOptionalBoolean(p.validation_gate_known),
        rollbackPlanKnown: asOptionalBoolean(p.rollback_plan_known),
        stopConditionsClear: asOptionalBoolean(p.stop_conditions_clear),
        concurrentWorkerLimit: typeof p.concurrent_worker_limit === "number" ? p.concurrent_worker_limit : undefined,
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
        schedulerRequested: asOptionalBoolean(p.scheduler_requested),
        repeatRequested: asOptionalBoolean(p.repeat_requested),
        remoteOrOffloadRequested: asOptionalBoolean(p.remote_or_offload_requested),
        githubActionsRequested: asOptionalBoolean(p.github_actions_requested),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_run_batch_dry_run",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_start_packet",
    label: "Agent Run Start Packet",
    description: "Report-only provider-native agent-run start packet with exact pi subprocess argv preview. Never dispatches execution and always requires structured operator approval.",
    parameters: Type.Object({
      run_id: Type.Optional(Type.String({ description: "Agent run id for the future worker." })),
      executor_kind: Type.Optional(Type.String({ description: "Executor kind. Initial supported value: pi-print-subprocess." })),
      goal: Type.Optional(Type.String({ description: "Run goal/prompt for the future worker." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference, e.g. provider/model-worker." })),
      cwd: Type.Optional(Type.String({ description: "Explicit worker cwd." })),
      declared_files: Type.Optional(Type.Array(Type.String(), { description: "Exact file scope for the future worker." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Short bounded timeout in milliseconds." })),
      tool_allowlist: Type.Optional(Type.Array(Type.String(), { description: "Read-only tool allowlist for first provider-native canaries." })),
      session_isolation: Type.Optional(Type.String({ description: "Session isolation mode: no-session or run-session-dir." })),
      extension_isolation: Type.Optional(Type.String({ description: "Extension isolation mode: minimal-no-extensions or inherit. Defaults to minimal-no-extensions for nested provider-native workers." })),
      log_path: Type.Optional(Type.String({ description: "Bounded log path for stdout/stderr metadata." })),
      budget_decision: Type.Optional(Type.String({ description: "Provider/model budget decision for this run: ok, warn, blocked, or unknown. Missing/blocked keeps packet blocked." })),
      budget_evidence: Type.Optional(Type.String({ description: "Short provider/model budget evidence, e.g. provider route says ok for this worker lane." })),
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
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference, e.g. provider/model-worker." })),
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
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference, e.g. provider/model-worker." })),
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
    description: "Report-only board-to-agent packetizer. Reads one .project task and derives a typed invocation spec, validation/rollback checklist, scoped budget evidence, and operator approval prompt. Never dispatches execution.",
    parameters: Type.Object({
      task_id: Type.String({ description: "Board task id to packetize." }),
      purpose: Type.Optional(Type.String({ description: "Short purpose slug/label for the run id. Defaults to task-packet." })),
      profile: Type.Optional(Type.String({ description: "Invocation profile: small-mutation, test-fix, read-only-review, or research. Defaults to small-mutation." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference, e.g. provider/model-worker." })),
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
      const cwd = resolveExecutionCwdParam(p.cwd, ctx.cwd);
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
    description: "Report-only bridge from board task packet to registry/start/status/log/abort/outcome previews. Never dispatches execution and always requires structured operator approval before any future start.",
    parameters: Type.Object({
      task_id: Type.String({ description: "Board task id to packetize for a future start." }),
      purpose: Type.Optional(Type.String({ description: "Short purpose slug/label for the run id. Defaults to task-packet." })),
      profile: Type.Optional(Type.String({ description: "Invocation profile: small-mutation, test-fix, read-only-review, or research." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference, e.g. provider/model-worker." })),
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
      const cwd = resolveExecutionCwdParam(p.cwd, ctx.cwd);
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
    name: "agent_run_promoted_worker_packet",
    label: "Promoted Worker Packet",
    description: "Report-only natural-use packet for envelopes already promoted by policy or arena evidence. Requires an explicit provider/model, adds budget posture, economy, registry/start/status/log/abort/outcome previews, and never dispatches execution.",
    parameters: Type.Object({
      task_id: Type.String({ description: "Board task id to packetize for a promoted worker." }),
      envelope: Type.Optional(Type.String({ description: "Arena-promoted envelope, e.g. readonly-one-file, readonly-three-file-inventory, readonly-source-backed-evidence-synthesis, mutation-one-file-marker." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference selected by operator policy." })),
      purpose: Type.Optional(Type.String({ description: "Short purpose slug/label for the run id. Defaults from the envelope." })),
      cwd: Type.Optional(Type.String({ description: "Worker cwd. Defaults to current workspace cwd." })),
      timeout_ms: Type.Optional(Type.Number({ description: "Bounded timeout in milliseconds; defaults to existing task packet defaults." })),
      budget_decision: Type.Optional(Type.String({ description: "Optional provider/model budget decision override. Defaults to warn for manual promoted-lane use." })),
      budget_evidence: Type.Optional(Type.String({ description: "Optional scoped provider/model budget evidence override." })),
      budget_evidence_source: Type.Optional(Type.String({ description: "Budget evidence source. Defaults to manual." })),
      budget_evidence_provider: Type.Optional(Type.String({ description: "Provider/model named by the budget evidence." })),
      budget_evidence_generated_at_iso: Type.Optional(Type.String({ description: "ISO timestamp for structured budget evidence freshness checks." })),
      budget_evidence_max_age_ms: Type.Optional(Type.Number({ description: "Optional max age for structured budget evidence freshness." })),
      token_budget_evidence: Type.Optional(Type.String({ description: "Short quota/economy evidence for the worker prompt." })),
      max_output_lines: Type.Optional(Type.Number({ description: "Bounded worker output line target. Defaults to 20." })),
      extension_isolation: Type.Optional(Type.String({ description: "Extension isolation mode: minimal-no-extensions or inherit." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope is requested." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const taskId = typeof p.task_id === "string" ? p.task_id : "";
      const cwd = resolveExecutionCwdParam(p.cwd, ctx.cwd);
      const { block } = readTasksBlockCached(cwd);
      const task = block.tasks.find((row) => row.id === taskId);
      const basePacket = buildPromotedWorkerPacket({
        taskId,
        task,
        envelope: typeof p.envelope === "string" ? p.envelope : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        purpose: typeof p.purpose === "string" ? p.purpose : undefined,
        cwd,
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        budgetDecision: typeof p.budget_decision === "string" ? p.budget_decision : undefined,
        budgetEvidence: typeof p.budget_evidence === "string" ? p.budget_evidence : undefined,
        budgetEvidenceSource: typeof p.budget_evidence_source === "string" ? p.budget_evidence_source : undefined,
        budgetEvidenceProvider: typeof p.budget_evidence_provider === "string" ? p.budget_evidence_provider : undefined,
        budgetEvidenceGeneratedAtIso: typeof p.budget_evidence_generated_at_iso === "string" ? p.budget_evidence_generated_at_iso : undefined,
        budgetEvidenceMaxAgeMs: typeof p.budget_evidence_max_age_ms === "number" ? p.budget_evidence_max_age_ms : undefined,
        tokenBudgetEvidence: typeof p.token_budget_evidence === "string" ? p.token_budget_evidence : undefined,
        maxOutputLines: typeof p.max_output_lines === "number" ? p.max_output_lines : undefined,
        extensionIsolation: typeof p.extension_isolation === "string" ? p.extension_isolation : undefined,
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
      });
      const existingEntry = readRegistryEntry(ctx.cwd, basePacket.taskStartPacket.taskPacket.invocationSpec.runId);
      const result = buildPromotedWorkerPacket({
        taskId,
        task,
        existingEntry,
        envelope: typeof p.envelope === "string" ? p.envelope : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        purpose: typeof p.purpose === "string" ? p.purpose : undefined,
        cwd,
        timeoutMs: typeof p.timeout_ms === "number" ? p.timeout_ms : undefined,
        budgetDecision: typeof p.budget_decision === "string" ? p.budget_decision : undefined,
        budgetEvidence: typeof p.budget_evidence === "string" ? p.budget_evidence : undefined,
        budgetEvidenceSource: typeof p.budget_evidence_source === "string" ? p.budget_evidence_source : undefined,
        budgetEvidenceProvider: typeof p.budget_evidence_provider === "string" ? p.budget_evidence_provider : undefined,
        budgetEvidenceGeneratedAtIso: typeof p.budget_evidence_generated_at_iso === "string" ? p.budget_evidence_generated_at_iso : undefined,
        budgetEvidenceMaxAgeMs: typeof p.budget_evidence_max_age_ms === "number" ? p.budget_evidence_max_age_ms : undefined,
        tokenBudgetEvidence: typeof p.token_budget_evidence === "string" ? p.token_budget_evidence : undefined,
        maxOutputLines: typeof p.max_output_lines === "number" ? p.max_output_lines : undefined,
        extensionIsolation: typeof p.extension_isolation === "string" ? p.extension_isolation : undefined,
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_run_promoted_worker_packet",
        summary: result.summary,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "agent_run_task_dispatch",
    label: "Agent Run Task Dispatch",
    description: "First-party task-runner gate. Preview by default; execute=true requires structured operator approval and starts only one registered pi subprocess. Never auto-dispatches.",
    parameters: Type.Object({
      task_id: Type.String({ description: "Board task id to packetize and optionally dispatch." }),
      purpose: Type.Optional(Type.String({ description: "Short purpose slug/label for the run id. Defaults to task-packet." })),
      profile: Type.Optional(Type.String({ description: "Invocation profile: small-mutation, test-fix, read-only-review, or research." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference, e.g. provider/model-worker." })),
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
      execute: Type.Optional(Type.Boolean({ description: "When true, dispatch the subprocess only after all gates pass and structured operator approval is present." })),
      operator_approval: operatorApprovalParameter(),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const taskId = typeof p.task_id === "string" ? p.task_id : "";
      const cwd = resolveExecutionCwdParam(p.cwd, ctx.cwd);
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
      const structuredOperatorApproval = hasStructuredOperatorApproval(p.operator_approval);
      const blockers = [...packet.blockers];
      if (packet.decision !== "ready-for-operator-decision") blockers.push("task-start-packet-blocked");
      if (existingEntry?.state === "running") blockers.push("run-already-running");
      if (executeRequested && !sameCwd(cwd, ctx.cwd)) blockers.push("execute-cwd-mismatch");
      if (executeRequested && !structuredOperatorApproval) blockers.push("structured-operator-approval-missing");
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
        for (const line of buildPiSubprocessPreflightLines(ctx.cwd, subprocess)) appendAgentRunLogLine(logPath, line);
        const logStream = createWriteStream(logPath, { flags: "a" });
        const startedAtMs = Date.now();
        const outputCapture = createAgentRunChildOutputCapture(logStream, startedAtMs);
        const child = spawn(subprocess.command, subprocess.args, { cwd: ctx.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
        pid = child.pid;
        child.stdout?.on("data", outputCapture.captureChildOutput("stdout"));
        child.stderr?.on("data", outputCapture.captureChildOutput("stderr"));
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
              writeRegistryEntry(ctx.cwd, {
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

      const decision = dispatchAllowed ? "dispatched" : blockers.length > 0 ? "blocked" : "preview";
      const result = {
        mode: "agent-run-task-dispatch" as const,
        activation: "none" as const,
        authorization: dispatchAllowed ? "explicit-operator" as const : "none" as const,
        dispatchAllowed,
        processStartAllowed: dispatchAllowed,
        processStopAllowed: false,
        requiresOperatorDecision: true,
        singleRunOnly: true,
        decision,
        blockers,
        executeRequested,
        structuredOperatorApproval,
        runId: packet.taskPacket.invocationSpec.runId,
        pid,
        packet,
        preferredDriverStep: packet.headlessDriverPreview,
        preferredDriverStepAvailable: packet.headlessDriverPreview.available,
        registryEntry,
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
      structured_operator_approval_available: Type.Optional(Type.Boolean({ description: "Whether structured operator approval is already available for a separate future dispatch." })),
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
        structuredOperatorApprovalAvailable: asOptionalBoolean(p.structured_operator_approval_available),
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
    name: "agent_run_sdk_cache_pack_packet",
    label: "Agent Run SDK Cache Pack Packet",
    description: "Report-only shared evidence/cache pack packet for SDK workers. Never reads files, dispatches workers, or authorizes execution.",
    parameters: Type.Object({
      pack_id: Type.Optional(Type.String({ description: "Future shared evidence/cache pack id." })),
      entries: Type.Optional(Type.Array(Type.Object({
        id: Type.Optional(Type.String({ description: "Stable entry id." })),
        path: Type.Optional(Type.String({ description: "Optional path represented by this evidence." })),
        summary: Type.Optional(Type.String({ description: "Bounded summary for worker prompt reuse." })),
        freshness: Type.Optional(Type.String({ description: "fresh, stale, or unknown." })),
        evidence: Type.Optional(Type.String({ description: "Freshness evidence such as verification id, git object, mtime/size, or log id." })),
      }), { description: "Bounded cache/evidence entries." })),
      max_entries: Type.Optional(Type.Number({ description: "Maximum entries allowed in this pack, clamped to 1..20." })),
      protected_scope_requested: Type.Optional(Type.Boolean({ description: "Blocks when protected scope is requested." })),
      unexpected_dirty: Type.Optional(Type.Boolean({ description: "Blocks when workspace dirty state is unexpected." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const entriesRaw = Array.isArray(p.entries) ? p.entries : [];
      const entries = entriesRaw.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object").map((entry) => ({
        id: typeof entry.id === "string" ? entry.id : undefined,
        path: typeof entry.path === "string" ? entry.path : undefined,
        summary: typeof entry.summary === "string" ? entry.summary : undefined,
        freshness: typeof entry.freshness === "string" ? entry.freshness : undefined,
        evidence: typeof entry.evidence === "string" ? entry.evidence : undefined,
      }));
      const result = buildAgentRunSdkCachePackPacket({
        packId: typeof p.pack_id === "string" ? p.pack_id : undefined,
        entries,
        maxEntries: typeof p.max_entries === "number" ? p.max_entries : undefined,
        protectedScopeRequested: asOptionalBoolean(p.protected_scope_requested),
        unexpectedDirty: asOptionalBoolean(p.unexpected_dirty),
      });
      return buildOperatorVisibleToolResponse({
        label: "agent_run_sdk_cache_pack_packet",
        summary: result.summary,
        details: result,
      });
    },
  });

  registerAgentRunSdkReadOnlyBatchTools(pi);

  registerAgentRunSdkProviderModelArenaTool(pi);

  pi.registerTool({
    name: "agent_run_sdk_in_process_packet",
    label: "Agent Run SDK In-Process Packet",
    description: "Report-only SDK/in-process worker packet using createAgentSession patterns. Never dispatches execution and requires exact future confirmation.",
    parameters: Type.Object({
      run_id: Type.Optional(Type.String({ description: "Future SDK worker run id." })),
      goal: Type.Optional(Type.String({ description: "Run goal/prompt for the future SDK worker." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference, e.g. provider/model-worker." })),
      cwd: Type.Optional(Type.String({ description: "Worker cwd. Defaults to current cwd." })),
      declared_files: Type.Optional(Type.Array(Type.String(), { description: "Exact declared file scope for parent validation." })),
      shared_evidence: Type.Optional(Type.Array(Type.String(), { description: "Bounded shared evidence/cache hints attached to the worker prompt." })),
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
        cwd: resolveExecutionCwdParam(p.cwd, ctx.cwd),
        declaredFiles: asOptionalStringArray(p.declared_files),
        sharedEvidence: asOptionalStringArray(p.shared_evidence),
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
    description: "First-party SDK/in-process worker gate. Preview by default; execute=true requires exact operator confirmation and starts only one SDK AgentSession worker.",
    parameters: Type.Object({
      run_id: Type.Optional(Type.String({ description: "Future SDK worker run id." })),
      goal: Type.Optional(Type.String({ description: "Run goal/prompt for the SDK worker." })),
      provider_model_ref: Type.Optional(Type.String({ description: "Full provider/model reference." })),
      cwd: Type.Optional(Type.String({ description: "Worker cwd. For execute=true must match current cwd." })),
      declared_files: Type.Optional(Type.Array(Type.String(), { description: "Exact declared file scope for parent validation." })),
      shared_evidence: Type.Optional(Type.Array(Type.String(), { description: "Bounded shared evidence/cache hints attached to the worker prompt." })),
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
      execute: Type.Optional(Type.Boolean({ description: "When true, start exactly one SDK worker after structured operator approval." })),
      operator_approval: operatorApprovalParameter(),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const packet = buildAgentRunSdkInProcessPacket({
        runId: typeof p.run_id === "string" ? p.run_id : undefined,
        goal: typeof p.goal === "string" ? p.goal : undefined,
        providerModelRef: typeof p.provider_model_ref === "string" ? p.provider_model_ref : undefined,
        cwd: resolveExecutionCwdParam(p.cwd, ctx.cwd),
        declaredFiles: asOptionalStringArray(p.declared_files),
        sharedEvidence: asOptionalStringArray(p.shared_evidence),
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
      const structuredOperatorApproval = hasStructuredOperatorApproval(p.operator_approval);
      const existingEntry = packet.runSpec.runId ? readRegistryEntry(ctx.cwd, packet.runSpec.runId) : undefined;
      const workerLaneReadiness = evaluateAgentWorkerLaneReadiness(ctx.cwd);
      const blockers = [...packet.blockers];
      if (packet.decision !== "ready-for-operator-decision") blockers.push("sdk-packet-blocked");
      if (executeRequested && !workerLaneReadiness.singleWorkerAllowed) blockers.push("worker-lane-single-worker-not-ready");
      if (existingEntry?.state === "running") blockers.push("run-already-running");
      if (executeRequested && !sameCwd(packet.runSpec.cwd, ctx.cwd)) blockers.push("execute-cwd-mismatch");
      if (executeRequested && !structuredOperatorApproval) blockers.push("structured-operator-approval-missing");
      const dispatchAllowed = executeRequested && blockers.length === 0;
      const started = dispatchAllowed ? startSdkInProcessWorker(ctx.cwd, packet) : undefined;
      const decision = dispatchAllowed ? "dispatched" : blockers.length > 0 ? "blocked" : "preview";
      const result = {
        mode: "agent-run-sdk-in-process-dispatch" as const,
        activation: "none" as const,
        authorization: dispatchAllowed ? "explicit-operator" as const : "none" as const,
        dispatchAllowed,
        processStartAllowed: dispatchAllowed,
        processStopAllowed: false,
        requiresOperatorDecision: true,
        singleRunOnly: true,
        decision,
        blockers,
        executeRequested,
        structuredOperatorApproval,
        runId: packet.runSpec.runId,
        logPath: started?.logPath,
        packet,
        summary: [
          "agent-run-sdk-in-process-dispatch:",
          `decision=${decision}`,
          `runId=${packet.runSpec.runId || "unknown"}`,
          `execute=${executeRequested ? "yes" : "no"}`,
          `dispatch=${dispatchAllowed ? "yes" : "no"}`,
        started?.logPath ? `logPath=${started.logPath}` : undefined,
          `workerLane=${workerLaneReadiness.stage}`,
          blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
        ].filter(Boolean).join(" "),
      };
      return buildOperatorVisibleToolResponse({
        label: "agent_run_sdk_in_process_dispatch",
        summary: result.summary,
        details: { ...result, workerLaneReadiness },
      });
    },
  });

  registerAgentRunLifecycleTools(pi);

}
