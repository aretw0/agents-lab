import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { evaluateAgentSpawnReadiness } from "./guardrails-core-agent-spawn-readiness";
import { buildAgentRunPlan } from "./guardrails-core-agent-run-plan";
import { buildAgentRunAbortPlan, buildAgentRunOutcomePacket, buildAgentRunRegistryUpsertPacket, buildAgentRunStatus, type AgentRunMarkerResult, type AgentRunRegistryEntry, type AgentRunState } from "./guardrails-core-agent-run-runtime";
import { buildAgentInvocationSpecPacket, buildAgentRunOperatorPacket, buildAgentRunStartPacket, buildAgentRunTaskPacket, buildAgentRunTaskStartPacket } from "./guardrails-core-agent-run-start";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";
import { readTasksBlockCached } from "./project-board-model";

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
        const logStream = createWriteStream(logPath, { flags: "a" });
        const child = spawn(packet.startPreview.command, packet.startPreview.args, { cwd: ctx.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
        pid = child.pid;
        child.stdout?.pipe(logStream, { end: false });
        child.stderr?.pipe(logStream, { end: false });
        registryEntry = {
          ...packet.registryPreview.entry,
          pid,
          state: "running",
          startedAtIso: new Date().toISOString(),
          lastEventAtIso: new Date().toISOString(),
        };
        writeRegistryEntry(ctx.cwd, registryEntry);
        const timeoutMs = packet.taskPacket.invocationSpec.timeoutMs;
        const timeout = setTimeout(() => {
          if (!child.killed) child.kill("SIGTERM");
        }, timeoutMs);
        child.on("close", (code) => {
          clearTimeout(timeout);
          logStream.end();
          writeRegistryEntry(ctx.cwd, {
            ...registryEntry,
            state: code === 0 ? "completed" : "failed",
            lastEventAtIso: new Date().toISOString(),
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
