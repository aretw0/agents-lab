/**
 * colony-pilot — Session visibility + colony runtime orchestration primitive.
 * @capability-id colony-runtime-governance
 * @capability-criticality medium
 *
 * Goals:
 * - Give one first-party command surface to orchestrate colony pilot runs
 * - Make "web server running" and "background colony running" states visible
 * - Keep behavior generic (not tightly coupled to one package internals)
 *
 * Current bridge strategy:
 * - Delegates execution to existing slash commands (/monitors, /remote, /colony)
 * - Tracks state heuristically from emitted messages and tool outputs
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  analyzeQuota,
  parseProviderBudgets,
  safeNum,
  type ProviderBudgetMap,
  type ProviderBudgetStatus,
} from "./quota-visibility";

type MonitorMode = "on" | "off" | "unknown";

type ColonyPhase =
  | "launched"
  | "task_done"
  | "completed"
  | "failed"
  | "aborted"
  | "budget_exceeded"
  | "scouting"
  | "running"
  | "unknown";

interface ColonyState {
  id: string;
  phase: ColonyPhase;
  updatedAt: number;
}

export interface PilotState {
  monitorMode: MonitorMode;
  remoteActive: boolean;
  remoteUrl?: string;
  remoteClients?: number;
  colonies: Map<string, ColonyState>;
  lastSessionFile?: string;
}

const COLONY_SIGNAL_RE = /\[COLONY_SIGNAL:([A-Z_]+)\]\s*\[([^\]]+)\]/i;
const REMOTE_URL_RE = /(https?:\/\/[^\s]+\?t=[^\s]+)/i;
const REMOTE_CLIENTS_RE = /Remote active\s*·\s*(\d+) client/i;
const MONITOR_MODE_ON_RE = /\/monitors\s+on\b/i;
const MONITOR_MODE_OFF_RE = /\/monitors\s+off\b/i;
const TERMINAL_COLONY_PHASES = new Set<ColonyPhase>(["completed", "failed", "aborted", "budget_exceeded"]);

export function createPilotState(): PilotState {
  return {
    monitorMode: "unknown",
    remoteActive: false,
    colonies: new Map(),
  };
}

export function parseColonySignal(text: string): { phase: ColonyPhase; id: string } | undefined {
  const m = text.match(COLONY_SIGNAL_RE);
  if (!m) return undefined;

  const raw = m[1].toLowerCase();
  const id = m[2].trim();

  const phase: ColonyPhase =
    raw === "launched"
      ? "launched"
      : raw === "task_done"
        ? "task_done"
        : raw === "completed" || raw === "complete"
          ? "completed"
          : raw === "failed"
            ? "failed"
            : raw === "aborted"
              ? "aborted"
              : raw === "budget_exceeded"
                ? "budget_exceeded"
                : raw === "scouting"
                  ? "scouting"
                  : raw === "running"
                    ? "running"
                    : "unknown";

  return { phase, id };
}

export function parseRemoteAccessUrl(text: string): string | undefined {
  const m = text.match(REMOTE_URL_RE);
  return m?.[1];
}

export function requiresApplyToBranch(goal: string): boolean {
  const g = goal.toLowerCase();
  return /\b(materializ|materializ[ae]r|promov|promotion|apply|aplicar|main|branch principal|merge)\b/.test(g);
}

export function parseMonitorModeFromText(text: string): MonitorMode | undefined {
  const on = MONITOR_MODE_ON_RE.test(text);
  const off = MONITOR_MODE_OFF_RE.test(text);
  if (on && !off) return "on";
  if (off && !on) return "off";
  return undefined;
}

export function normalizeColonySignalId(id: string): string | undefined {
  const primary = id.split("|")[0]?.trim();
  if (!primary) return undefined;
  if (primary.includes("${") || primary.includes("}")) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(primary)) return undefined;
  return primary;
}

export function buildColonyRunSequence(goal: string): string[] {
  return ["/monitors off", "/remote", `/colony ${goal}`];
}

export function buildColonyStopSequence(options?: { restoreMonitors?: boolean }): string[] {
  const out = ["/colony-stop all", "/remote stop"];
  if (options?.restoreMonitors) out.push("/monitors on");
  return out;
}

export interface PilotCapabilities {
  monitors: boolean;
  remote: boolean;
  sessionWeb: boolean;
  colony: boolean;
  colonyStop: boolean;
}

export function toBaseCommandName(name: string): string {
  return name.split(":")[0] ?? name;
}

export function detectPilotCapabilities(commandNames: string[]): PilotCapabilities {
  const base = new Set(commandNames.map((n) => toBaseCommandName(n)));
  return {
    monitors: base.has("monitors"),
    remote: base.has("remote"),
    sessionWeb: base.has("session-web"),
    colony: base.has("colony"),
    colonyStop: base.has("colony-stop"),
  };
}

export type ModelAuthStatus =
  | "ok"
  | "missing-auth"
  | "missing-model"
  | "invalid-model"
  | "not-set"
  | "unavailable";

export interface ColonyModelReadiness {
  currentModelRef?: string;
  currentModelStatus: ModelAuthStatus;
  defaultProvider?: string;
  defaultModel?: string;
  defaultModelRef?: string;
  defaultModelStatus: ModelAuthStatus;
  antColonyDefaultModelRef?: string;
}

function settingsCandidates(cwd: string): string[] {
  return [
    path.join(cwd, ".pi", "settings.json"),
    path.join(homedir(), ".pi", "agent", "settings.json"),
  ];
}

function readTopLevelStringSetting(cwd: string, key: string): string | undefined {
  for (const candidate of settingsCandidates(cwd)) {
    if (!existsSync(candidate)) continue;

    try {
      const json = JSON.parse(readFileSync(candidate, "utf8"));
      const value = json?.[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    } catch {
      // ignore malformed settings
    }
  }

  return undefined;
}

export function parseProviderModelRef(modelRef: string): { provider: string; model: string } | undefined {
  const idx = modelRef.indexOf("/");
  if (idx <= 0 || idx >= modelRef.length - 1) return undefined;
  return {
    provider: modelRef.slice(0, idx),
    model: modelRef.slice(idx + 1),
  };
}

export function resolveModelAuthStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modelRegistry: any,
  modelRef?: string
): ModelAuthStatus {
  if (!modelRef) return "not-set";

  const parsed = parseProviderModelRef(modelRef);
  if (!parsed) return "invalid-model";

  if (!modelRegistry || typeof modelRegistry.find !== "function") {
    return "unavailable";
  }

  const model = modelRegistry.find(parsed.provider, parsed.model);
  if (!model) return "missing-model";

  if (typeof modelRegistry.hasConfiguredAuth === "function") {
    const hasAuth = modelRegistry.hasConfiguredAuth(model);
    if (!hasAuth) return "missing-auth";
  }

  return "ok";
}

export function resolveColonyModelReadiness(
  cwd: string,
  currentModelRef: string | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modelRegistry: any
): ColonyModelReadiness {
  const defaultProvider = readTopLevelStringSetting(cwd, "defaultProvider");
  const defaultModel = readTopLevelStringSetting(cwd, "defaultModel");

  const currentModelStatus = resolveModelAuthStatus(modelRegistry, currentModelRef);

  let defaultModelRef: string | undefined;
  if (defaultModel) {
    defaultModelRef = defaultModel.includes("/")
      ? defaultModel
      : (defaultProvider ? `${defaultProvider}/${defaultModel}` : undefined);
  }

  const defaultModelStatus = defaultModelRef
    ? resolveModelAuthStatus(modelRegistry, defaultModelRef)
    : (defaultModel ? "invalid-model" : "not-set");

  return {
    currentModelRef,
    currentModelStatus,
    defaultProvider,
    defaultModel,
    defaultModelRef,
    defaultModelStatus,
    antColonyDefaultModelRef: currentModelRef,
  };
}

function formatModelReadiness(readiness: ColonyModelReadiness): string[] {
  return [
    "provider/model:",
    `  ant_colony default model: ${readiness.antColonyDefaultModelRef ?? "(none)"}`,
    `  current model status: ${readiness.currentModelStatus}`,
    `  defaultProvider: ${readiness.defaultProvider ?? "(not set)"}`,
    `  defaultModel: ${readiness.defaultModel ?? "(not set)"}`,
    `  defaultModelRef: ${readiness.defaultModelRef ?? "(unresolved)"}`,
    `  default model status: ${readiness.defaultModelStatus}`,
  ];
}

const ROLE_ORDER: Array<Exclude<ColonyAgentRole, "queen">> = [
  "scout",
  "worker",
  "soldier",
  "design",
  "multimodal",
  "backend",
  "review",
];

const CORE_ROLE_ORDER: Array<Exclude<ColonyAgentRole, "queen">> = ["scout", "worker", "soldier"];

const ROLE_TO_INPUT_KEY: Record<Exclude<ColonyAgentRole, "queen">, keyof AntColonyToolInput> = {
  scout: "scoutModel",
  worker: "workerModel",
  soldier: "soldierModel",
  design: "designWorkerModel",
  multimodal: "multimodalWorkerModel",
  backend: "backendWorkerModel",
  review: "reviewWorkerModel",
};

const DEFAULT_MODEL_POLICY: ColonyPilotModelPolicyConfig = {
  enabled: true,
  specializedRolesEnabled: false,
  autoInjectRoleModels: true,
  requireHealthyCurrentModel: true,
  requireExplicitRoleModels: false,
  requiredRoles: ["scout", "worker", "soldier"],
  enforceFullModelRef: true,
  allowMixedProviders: true,
  allowedProviders: [],
  allowedProvidersByRole: {},
  roleModels: {},
};

const DEFAULT_BUDGET_POLICY: ColonyPilotBudgetPolicyConfig = {
  enabled: false,
  enforceOnAntColonyTool: true,
  requireMaxCost: true,
  autoInjectMaxCost: true,
  defaultMaxCostUsd: 2,
  hardCapUsd: 20,
  minMaxCostUsd: 0.05,
  enforceProviderBudgetBlock: false,
  providerBudgetLookbackDays: 30,
  allowProviderBudgetOverride: true,
  providerBudgetOverrideToken: "budget-override:",
};

const DEFAULT_PROJECT_TASK_SYNC: ColonyPilotProjectTaskSyncConfig = {
  enabled: false,
  createOnLaunch: true,
  trackProgress: true,
  markTerminalState: true,
  taskIdPrefix: "colony",
  requireHumanClose: true,
  maxNoteLines: 20,
  autoQueueRecoveryOnCandidate: true,
  recoveryTaskSuffix: "promotion",
};

const DEFAULT_DELIVERY_POLICY: ColonyPilotDeliveryPolicyConfig = {
  enabled: false,
  mode: "report-only",
  requireWorkspaceReport: true,
  requireTaskSummary: true,
  requireFileInventory: false,
  requireValidationCommandLog: false,
  blockOnMissingEvidence: true,
};

export interface AntColonyToolInput {
  goal: string;
  maxAnts?: number;
  maxCost?: number;
  scoutModel?: string;
  workerModel?: string;
  soldierModel?: string;
  designWorkerModel?: string;
  multimodalWorkerModel?: string;
  backendWorkerModel?: string;
  reviewWorkerModel?: string;
}

function normalizeRoleList(value: unknown): ColonyAgentRole[] {
  if (!Array.isArray(value)) return [...DEFAULT_MODEL_POLICY.requiredRoles];
  const allowed: ColonyAgentRole[] = ["queen", ...ROLE_ORDER];
  const out = value.filter((v): v is ColonyAgentRole => typeof v === "string" && allowed.includes(v as ColonyAgentRole));
  return out.length > 0 ? out : [...DEFAULT_MODEL_POLICY.requiredRoles];
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}

function normalizeRoleModels(value: unknown): ColonyRoleModelMap {
  const input = isPlainObject(value) ? (value as Record<string, unknown>) : {};
  const out: ColonyRoleModelMap = {};
  for (const role of ROLE_ORDER) {
    const v = input[role];
    if (typeof v === "string" && v.trim().length > 0) out[role] = v.trim();
  }
  return out;
}

function normalizeAllowedProvidersByRole(value: unknown): Partial<Record<ColonyAgentRole, string[]>> {
  const input = isPlainObject(value) ? (value as Record<string, unknown>) : {};
  const out: Partial<Record<ColonyAgentRole, string[]>> = {};
  for (const role of ["queen", ...ROLE_ORDER] as ColonyAgentRole[]) {
    const providers = normalizeStringList(input[role]);
    if (providers.length > 0) out[role] = providers;
  }
  return out;
}

export function resolveColonyPilotModelPolicy(raw?: Partial<ColonyPilotModelPolicyConfig>): ColonyPilotModelPolicyConfig {
  const specializedRolesEnabled = raw?.specializedRolesEnabled === true;
  const requestedRequiredRoles = normalizeRoleList(raw?.requiredRoles);
  const requiredRoles = specializedRolesEnabled
    ? requestedRequiredRoles
    : requestedRequiredRoles.filter((role) => role === "queen" || CORE_ROLE_ORDER.includes(role as Exclude<ColonyAgentRole, "queen">));

  return {
    enabled: raw?.enabled !== false,
    specializedRolesEnabled,
    autoInjectRoleModels: raw?.autoInjectRoleModels !== false,
    requireHealthyCurrentModel: raw?.requireHealthyCurrentModel !== false,
    requireExplicitRoleModels: raw?.requireExplicitRoleModels === true,
    requiredRoles,
    enforceFullModelRef: raw?.enforceFullModelRef !== false,
    allowMixedProviders: raw?.allowMixedProviders !== false,
    allowedProviders: normalizeStringList(raw?.allowedProviders),
    allowedProvidersByRole: normalizeAllowedProvidersByRole(raw?.allowedProvidersByRole),
    roleModels: normalizeRoleModels(raw?.roleModels),
  };
}

function normalizeOptionalBudget(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value <= 0) return undefined;
  return Number(value.toFixed(4));
}

export function resolveColonyPilotBudgetPolicy(raw?: Partial<ColonyPilotBudgetPolicyConfig>): ColonyPilotBudgetPolicyConfig {
  const providerBudgetLookbackDaysRaw = typeof raw?.providerBudgetLookbackDays === "number" && Number.isFinite(raw.providerBudgetLookbackDays)
    ? Math.floor(raw.providerBudgetLookbackDays)
    : DEFAULT_BUDGET_POLICY.providerBudgetLookbackDays;

  const providerBudgetOverrideTokenRaw = typeof raw?.providerBudgetOverrideToken === "string"
    ? raw.providerBudgetOverrideToken.trim()
    : "";

  return {
    enabled: raw?.enabled === true,
    enforceOnAntColonyTool: raw?.enforceOnAntColonyTool !== false,
    requireMaxCost: raw?.requireMaxCost !== false,
    autoInjectMaxCost: raw?.autoInjectMaxCost !== false,
    defaultMaxCostUsd: normalizeOptionalBudget(raw?.defaultMaxCostUsd) ?? DEFAULT_BUDGET_POLICY.defaultMaxCostUsd,
    hardCapUsd: normalizeOptionalBudget(raw?.hardCapUsd) ?? DEFAULT_BUDGET_POLICY.hardCapUsd,
    minMaxCostUsd: normalizeOptionalBudget(raw?.minMaxCostUsd) ?? DEFAULT_BUDGET_POLICY.minMaxCostUsd,
    enforceProviderBudgetBlock: raw?.enforceProviderBudgetBlock === true,
    providerBudgetLookbackDays: Math.max(1, Math.min(90, providerBudgetLookbackDaysRaw)),
    allowProviderBudgetOverride: raw?.allowProviderBudgetOverride !== false,
    providerBudgetOverrideToken: providerBudgetOverrideTokenRaw.length > 0
      ? providerBudgetOverrideTokenRaw
      : DEFAULT_BUDGET_POLICY.providerBudgetOverrideToken,
  };
}

export function resolveColonyPilotProjectTaskSync(
  raw?: Partial<ColonyPilotProjectTaskSyncConfig>
): ColonyPilotProjectTaskSyncConfig {
  const prefixRaw = typeof raw?.taskIdPrefix === "string" ? raw.taskIdPrefix.trim() : "";
  const prefix = prefixRaw.length > 0 ? prefixRaw : DEFAULT_PROJECT_TASK_SYNC.taskIdPrefix;
  const maxNoteLinesRaw = typeof raw?.maxNoteLines === "number" && Number.isFinite(raw.maxNoteLines)
    ? Math.floor(raw.maxNoteLines)
    : DEFAULT_PROJECT_TASK_SYNC.maxNoteLines;
  const recoverySuffixRaw = typeof raw?.recoveryTaskSuffix === "string" ? raw.recoveryTaskSuffix.trim() : "";
  const recoveryTaskSuffix = recoverySuffixRaw.length > 0
    ? recoverySuffixRaw.replace(/[^a-zA-Z0-9_-]+/g, "-")
    : DEFAULT_PROJECT_TASK_SYNC.recoveryTaskSuffix;

  return {
    enabled: raw?.enabled === true,
    createOnLaunch: raw?.createOnLaunch !== false,
    trackProgress: raw?.trackProgress !== false,
    markTerminalState: raw?.markTerminalState !== false,
    taskIdPrefix: prefix,
    requireHumanClose: raw?.requireHumanClose !== false,
    maxNoteLines: Math.max(5, Math.min(200, maxNoteLinesRaw)),
    autoQueueRecoveryOnCandidate: raw?.autoQueueRecoveryOnCandidate !== false,
    recoveryTaskSuffix,
  };
}

export function resolveColonyPilotDeliveryPolicy(
  raw?: Partial<ColonyPilotDeliveryPolicyConfig>
): ColonyPilotDeliveryPolicyConfig {
  const modeRaw = typeof raw?.mode === "string" ? raw.mode.trim() : "";
  const mode: ColonyDeliveryMode =
    modeRaw === "patch-artifact" || modeRaw === "apply-to-branch" || modeRaw === "report-only"
      ? modeRaw
      : DEFAULT_DELIVERY_POLICY.mode;

  return {
    enabled: raw?.enabled === true,
    mode,
    requireWorkspaceReport: raw?.requireWorkspaceReport !== false,
    requireTaskSummary: raw?.requireTaskSummary !== false,
    requireFileInventory: raw?.requireFileInventory === true,
    requireValidationCommandLog: raw?.requireValidationCommandLog === true,
    blockOnMissingEvidence: raw?.blockOnMissingEvidence !== false,
  };
}

export function evaluateColonyDeliveryEvidence(
  text: string,
  phase: ColonyPhase,
  policy: ColonyPilotDeliveryPolicyConfig
): ColonyPilotDeliveryEvaluation {
  const evidence: ColonyPilotDeliveryEvidence = {
    hasWorkspaceReport: /###\s+🧪\s+Workspace|Mode:\s+(?:isolated|shared)/i.test(text),
    hasTaskSummary: /\*\*Tasks:\*\*\s*\d+\/\d+|tasks\s+done/i.test(text),
    hasFileInventory: /(?:files?\s+(?:changed|altered|touched)|arquivos?\s+alterad|invent[aá]rio\s+final)/i.test(text),
    hasValidationCommandLog: /(?:`(?:pnpm|npm|npx|vitest|node\s+--test|tsc)\b[^`]*`|comandos?\s+de\s+valida[cç][aã]o)/i.test(text),
  };

  if (!policy.enabled || phase !== "completed") {
    return { ok: true, issues: [], evidence };
  }

  const issues: string[] = [];
  if (policy.requireWorkspaceReport && !evidence.hasWorkspaceReport) {
    issues.push("delivery evidence missing: workspace report");
  }
  if (policy.requireTaskSummary && !evidence.hasTaskSummary) {
    issues.push("delivery evidence missing: task summary");
  }
  if (policy.requireFileInventory && !evidence.hasFileInventory) {
    issues.push("delivery evidence missing: file inventory");
  }
  if (policy.requireValidationCommandLog && !evidence.hasValidationCommandLog) {
    issues.push("delivery evidence missing: validation command log");
  }

  return { ok: issues.length === 0, issues, evidence };
}

export function formatDeliveryPolicyEvaluation(
  policy: ColonyPilotDeliveryPolicyConfig,
  evalResult: ColonyPilotDeliveryEvaluation
): string[] {
  return [
    "delivery policy:",
    `  enabled: ${policy.enabled ? "yes" : "no"}`,
    `  mode: ${policy.mode}`,
    `  requireWorkspaceReport: ${policy.requireWorkspaceReport ? "yes" : "no"}`,
    `  requireTaskSummary: ${policy.requireTaskSummary ? "yes" : "no"}`,
    `  requireFileInventory: ${policy.requireFileInventory ? "yes" : "no"}`,
    `  requireValidationCommandLog: ${policy.requireValidationCommandLog ? "yes" : "no"}`,
    `  blockOnMissingEvidence: ${policy.blockOnMissingEvidence ? "yes" : "no"}`,
    `  evaluation: ${evalResult.ok ? "ok" : "issues"}`,
  ];
}

export function colonyPhaseToProjectTaskStatus(
  phase: ColonyPhase,
  requireHumanClose: boolean
): "planned" | "in-progress" | "completed" | "blocked" {
  if (phase === "failed" || phase === "aborted" || phase === "budget_exceeded") return "blocked";
  if (phase === "completed") return requireHumanClose ? "in-progress" : "completed";
  return "in-progress";
}

export function parseBudgetOverrideReason(goal: string, overrideToken: string): string | undefined {
  const token = overrideToken.trim();
  if (!token) return undefined;

  const lowerGoal = goal.toLowerCase();
  const lowerToken = token.toLowerCase();
  const idx = lowerGoal.indexOf(lowerToken);
  if (idx < 0) return undefined;

  const raw = goal.slice(idx + token.length).trim();
  if (!raw) return undefined;

  const reason = raw.split(/[\r\n;]+/)[0]?.trim();
  return reason && reason.length > 0 ? reason : undefined;
}

export function collectAntColonyProviders(input: AntColonyToolInput, currentModelRef?: string): string[] {
  const out = new Set<string>();

  const add = (modelRef?: string) => {
    const provider = providerOf(modelRef);
    if (provider) out.add(provider);
  };

  add(currentModelRef);
  add(input.scoutModel);
  add(input.workerModel);
  add(input.soldierModel);
  add(input.designWorkerModel);
  add(input.multimodalWorkerModel);
  add(input.backendWorkerModel);
  add(input.reviewWorkerModel);

  return [...out.values()].sort();
}

export interface ColonyPilotProviderBudgetGateEvaluation {
  ok: boolean;
  checked: boolean;
  issues: string[];
  consideredProviders: string[];
  blockedProviders: string[];
  allocationWarnings: string[];
  overrideReason?: string;
}

export function evaluateProviderBudgetGate(
  input: AntColonyToolInput,
  currentModelRef: string | undefined,
  goal: string,
  statuses: ProviderBudgetStatus[],
  allocationWarnings: string[],
  policy: ColonyPilotBudgetPolicyConfig
): ColonyPilotProviderBudgetGateEvaluation {
  const consideredProviders = collectAntColonyProviders(input, currentModelRef);
  if (statuses.length === 0) {
    return {
      ok: true,
      checked: false,
      issues: [],
      consideredProviders,
      blockedProviders: [],
      allocationWarnings,
    };
  }

  const blocked = statuses
    .filter((s) => s.state === "blocked")
    .filter((s) => consideredProviders.length === 0 || consideredProviders.includes(s.provider));

  if (blocked.length === 0) {
    return {
      ok: true,
      checked: true,
      issues: [],
      consideredProviders,
      blockedProviders: [],
      allocationWarnings,
    };
  }

  const blockedProviders = blocked.map((s) => s.provider).sort();

  if (policy.allowProviderBudgetOverride) {
    const reason = parseBudgetOverrideReason(goal, policy.providerBudgetOverrideToken);
    if (reason) {
      return {
        ok: true,
        checked: true,
        issues: [],
        consideredProviders,
        blockedProviders,
        allocationWarnings,
        overrideReason: reason,
      };
    }
  }

  const issues = [
    `provider budget blocked for: ${blockedProviders.join(", ")}`,
    policy.allowProviderBudgetOverride
      ? `override required in goal: '${policy.providerBudgetOverrideToken}<reason>'`
      : "override disabled by policy",
  ];

  return {
    ok: false,
    checked: true,
    issues,
    consideredProviders,
    blockedProviders,
    allocationWarnings,
  };
}

export function evaluateAntColonyBudgetPolicy(
  input: AntColonyToolInput,
  policy: ColonyPilotBudgetPolicyConfig
): ColonyPilotBudgetPolicyEvaluation {
  const issues: string[] = [];

  let effectiveMax = typeof input.maxCost === "number" && Number.isFinite(input.maxCost)
    ? input.maxCost
    : undefined;

  if ((effectiveMax === undefined || effectiveMax <= 0) && policy.autoInjectMaxCost) {
    const injected = normalizeOptionalBudget(policy.defaultMaxCostUsd);
    if (injected !== undefined) {
      input.maxCost = injected;
      effectiveMax = injected;
    }
  }

  if (policy.requireMaxCost && (effectiveMax === undefined || effectiveMax <= 0)) {
    issues.push("maxCost is required for ant_colony (set input.maxCost or configure budgetPolicy.defaultMaxCostUsd)");
  }

  if (effectiveMax !== undefined) {
    const min = normalizeOptionalBudget(policy.minMaxCostUsd);
    const cap = normalizeOptionalBudget(policy.hardCapUsd);

    if (min !== undefined && effectiveMax < min) {
      issues.push(`maxCost (${effectiveMax}) is below minMaxCostUsd (${min})`);
    }

    if (cap !== undefined && effectiveMax > cap) {
      issues.push(`maxCost (${effectiveMax}) exceeds hardCapUsd (${cap})`);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    effectiveMaxCostUsd: effectiveMax,
  };
}

function formatBudgetPolicyEvaluation(
  policy: ColonyPilotBudgetPolicyConfig,
  evaluation: ColonyPilotBudgetPolicyEvaluation
): string[] {
  return [
    "budget-policy:",
    `  enabled: ${policy.enabled ? "yes" : "no"}`,
    `  enforceOnAntColonyTool: ${policy.enforceOnAntColonyTool ? "yes" : "no"}`,
    `  requireMaxCost: ${policy.requireMaxCost ? "yes" : "no"}`,
    `  autoInjectMaxCost: ${policy.autoInjectMaxCost ? "yes" : "no"}`,
    `  defaultMaxCostUsd: ${policy.defaultMaxCostUsd ?? "(none)"}`,
    `  hardCapUsd: ${policy.hardCapUsd ?? "(none)"}`,
    `  minMaxCostUsd: ${policy.minMaxCostUsd ?? "(none)"}`,
    `  enforceProviderBudgetBlock: ${policy.enforceProviderBudgetBlock ? "yes" : "no"}`,
    `  providerBudgetLookbackDays: ${policy.providerBudgetLookbackDays}`,
    `  allowProviderBudgetOverride: ${policy.allowProviderBudgetOverride ? "yes" : "no"}`,
    `  providerBudgetOverrideToken: ${policy.providerBudgetOverrideToken}`,
    `  effectiveMaxCostUsd: ${evaluation.effectiveMaxCostUsd ?? "(none)"}`,
  ];
}

export interface ColonyModelPolicyEvaluation {
  ok: boolean;
  issues: string[];
  effectiveModels: Record<ColonyAgentRole, string | undefined>;
}

function providerOf(modelRef: string | undefined): string | undefined {
  if (!modelRef) return undefined;
  return parseProviderModelRef(modelRef)?.provider;
}

export function evaluateAntColonyModelPolicy(
  input: AntColonyToolInput,
  currentModelRef: string | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modelRegistry: any,
  policy: ColonyPilotModelPolicyConfig
): ColonyModelPolicyEvaluation {
  const issues: string[] = [];
  const effectiveModels: Record<ColonyAgentRole, string | undefined> = {
    queen: currentModelRef,
    scout: undefined,
    worker: undefined,
    soldier: undefined,
    design: undefined,
    multimodal: undefined,
    backend: undefined,
    review: undefined,
  };

  const activeRoles = policy.specializedRolesEnabled ? ROLE_ORDER : CORE_ROLE_ORDER;

  if (policy.requireHealthyCurrentModel) {
    const status = resolveModelAuthStatus(modelRegistry, currentModelRef);
    if (status !== "ok" && status !== "unavailable") {
      issues.push(`queen model invalid/unavailable for runtime: ${currentModelRef ?? "(none)"} (${status})`);
    }
  }

  const queenProvider = providerOf(currentModelRef);
  const queenAllowed = policy.allowedProvidersByRole.queen ?? [];
  if (queenProvider && queenAllowed.length > 0 && !queenAllowed.includes(queenProvider)) {
    issues.push(`queen provider '${queenProvider}' is not in allowedProvidersByRole.queen`);
  }

  for (const role of ROLE_ORDER) {
    const key = ROLE_TO_INPUT_KEY[role];
    const explicit = typeof input[key] === "string" ? input[key]?.trim() : undefined;
    const roleIsActive = activeRoles.includes(role);
    const configured = roleIsActive ? policy.roleModels[role] : undefined;

    if (!explicit && roleIsActive && policy.autoInjectRoleModels && configured) {
      input[key] = configured;
    }

    const effective = (typeof input[key] === "string" && input[key]?.trim().length ? input[key]?.trim() : undefined) ?? currentModelRef;
    effectiveModels[role] = effective;

    // In generic-first mode, specialist roles are advisory only unless explicitly overridden.
    if (!roleIsActive && !explicit) {
      continue;
    }

    if (policy.requireExplicitRoleModels && policy.requiredRoles.includes(role) && !input[key]) {
      issues.push(`missing explicit model for role '${role}' (${String(key)})`);
      continue;
    }

    if (!effective) {
      issues.push(`role '${role}' has no effective model`);
      continue;
    }

    if (policy.enforceFullModelRef && !parseProviderModelRef(effective)) {
      issues.push(`role '${role}' model must be provider/model: ${effective}`);
      continue;
    }

    const status = resolveModelAuthStatus(modelRegistry, effective);
    if (status !== "ok" && status !== "unavailable") {
      issues.push(`role '${role}' model not ready: ${effective} (${status})`);
    }

    const provider = providerOf(effective);
    if (provider && policy.allowedProviders.length > 0 && !policy.allowedProviders.includes(provider)) {
      issues.push(`role '${role}' provider '${provider}' is not in allowedProviders`);
    }

    const roleAllowed = policy.allowedProvidersByRole[role] ?? [];
    if (provider && roleAllowed.length > 0 && !roleAllowed.includes(provider)) {
      issues.push(`role '${role}' provider '${provider}' is not in allowedProvidersByRole.${role}`);
    }
  }

  if (!policy.allowMixedProviders) {
    const providers = new Set<string>();
    for (const role of ["queen", ...activeRoles] as ColonyAgentRole[]) {
      const p = providerOf(effectiveModels[role]);
      if (p) providers.add(p);
    }
    if (providers.size > 1) {
      issues.push(`mixed providers are disabled, found: ${[...providers].join(", ")}`);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    effectiveModels,
  };
}

function formatPolicyEvaluation(policy: ColonyPilotModelPolicyConfig, evalResult: ColonyModelPolicyEvaluation): string[] {
  const roleAllowRows = (["queen", ...ROLE_ORDER] as ColonyAgentRole[])
    .map((role) => {
      const providers = policy.allowedProvidersByRole[role] ?? [];
      if (providers.length === 0) return undefined;
      return `    ${role}: ${providers.join(", ")}`;
    })
    .filter((row): row is string => Boolean(row));

  const activeRoles = policy.specializedRolesEnabled ? ROLE_ORDER : CORE_ROLE_ORDER;

  return [
    "model-policy:",
    `  enabled: ${policy.enabled ? "yes" : "no"}`,
    `  specializedRolesEnabled: ${policy.specializedRolesEnabled ? "yes" : "no"}`,
    `  activeRoles: ${activeRoles.join(", ")}`,
    `  autoInjectRoleModels: ${policy.autoInjectRoleModels ? "yes" : "no"}`,
    `  requireHealthyCurrentModel: ${policy.requireHealthyCurrentModel ? "yes" : "no"}`,
    `  requireExplicitRoleModels: ${policy.requireExplicitRoleModels ? "yes" : "no"}`,
    `  requiredRoles: ${policy.requiredRoles.join(", ") || "(none)"}`,
    `  allowMixedProviders: ${policy.allowMixedProviders ? "yes" : "no"}`,
    `  allowedProviders: ${policy.allowedProviders.join(", ") || "(any)"}`,
    `  allowedProvidersByRole: ${roleAllowRows.length > 0 ? "(configured)" : "(none)"}`,
    ...(roleAllowRows.length > 0 ? roleAllowRows : []),
    "  effectiveModels:",
    `    queen: ${evalResult.effectiveModels.queen ?? "(none)"}`,
    ...ROLE_ORDER.map((role) => `    ${role}: ${evalResult.effectiveModels[role] ?? "(none)"}`),
  ];
}

export function buildRuntimeRunSequence(caps: PilotCapabilities, goal: string): string[] {
  const webStart = caps.sessionWeb ? "/session-web start" : "/remote";
  return ["/monitors off", webStart, `/colony ${goal}`];
}

export function buildRuntimeStopSequence(caps: PilotCapabilities, options?: { restoreMonitors?: boolean }): string[] {
  const webStop = caps.sessionWeb ? "/session-web stop" : "/remote stop";
  const out = ["/colony-stop all", webStop];
  if (options?.restoreMonitors) out.push("/monitors on");
  return out;
}

export function buildAntColonyMirrorCandidates(cwd: string): string[] {
  const root = path.join(homedir(), ".pi", "agent", "ant-colony");

  // Preserve Windows drive-style paths even when tests run on non-Windows hosts.
  // Example: "C:/Users/alice/work/repo" should map to ".../c/Users/alice/work/repo"
  // instead of being treated as a relative path by path.resolve on Linux/macOS.
  const raw = String(cwd ?? "").replace(/\\/g, "/");
  const win = raw.match(/^([A-Za-z]):\/(.*)$/);
  if (win) {
    const drive = win[1].toLowerCase();
    const rest = win[2];
    return [
      path.join(root, drive, rest),
      path.join(root, "root", drive, rest),
    ];
  }

  const normalized = path.resolve(cwd).replace(/\\/g, "/");
  const unix = normalized.startsWith("/") ? normalized.slice(1) : normalized;
  return [
    path.join(root, unix),
    path.join(root, "root", unix),
  ];
}

function inspectAntColonyRuntime(cwd: string) {
  const roots = buildAntColonyMirrorCandidates(cwd).filter((p) => existsSync(p));

  const mirrors = roots.map((rootPath) => {
    const coloniesDir = path.join(rootPath, "colonies");
    const worktreesDir = path.join(rootPath, "worktrees");

    const colonies: Array<{ id: string; status: string; updatedAt: number; goal?: string; statePath: string }> = [];
    if (existsSync(coloniesDir)) {
      for (const d of readdirSync(coloniesDir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const statePath = path.join(coloniesDir, d.name, "state.json");
        if (!existsSync(statePath)) continue;
        try {
          const json = JSON.parse(readFileSync(statePath, "utf8"));
          const st = statSync(statePath);
          colonies.push({
            id: json.id ?? d.name,
            status: json.status ?? "unknown",
            goal: typeof json.goal === "string" ? json.goal : undefined,
            updatedAt: st.mtimeMs,
            statePath,
          });
        } catch {
          // ignore malformed state
        }
      }
    }

    colonies.sort((a, b) => b.updatedAt - a.updatedAt);

    const worktrees: Array<{ name: string; path: string; updatedAt: number }> = [];
    if (existsSync(worktreesDir)) {
      for (const d of readdirSync(worktreesDir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const full = path.join(worktreesDir, d.name);
        if (!existsSync(path.join(full, ".git"))) continue;
        worktrees.push({ name: d.name, path: full, updatedAt: statSync(full).mtimeMs });
      }
    }

    worktrees.sort((a, b) => b.updatedAt - a.updatedAt);

    return {
      root: rootPath,
      colonies: colonies.slice(0, 8),
      worktrees: worktrees.slice(0, 8),
    };
  });

  return { cwd: path.resolve(cwd), mirrors };
}

function formatArtifactsReport(data: ReturnType<typeof inspectAntColonyRuntime>): string {
  const out: string[] = [];
  out.push("colony-pilot artifacts");
  out.push(`cwd: ${data.cwd}`);

  if (data.mirrors.length === 0) {
    out.push("No ant-colony workspace mirror found for this cwd.");
    return out.join("\n");
  }

  for (const m of data.mirrors) {
    out.push("");
    out.push(`mirror: ${m.root}`);

    out.push("  colonies:");
    if (m.colonies.length === 0) out.push("    (none)");
    for (const c of m.colonies) {
      out.push(`    - ${c.id} [${c.status}] ${new Date(c.updatedAt).toISOString()}`);
      out.push(`      state: ${c.statePath}`);
      if (c.goal) out.push(`      goal: ${c.goal.slice(0, 100)}`);
    }

    out.push("  worktrees:");
    if (m.worktrees.length === 0) out.push("    (none)");
    for (const w of m.worktrees) {
      out.push(`    - ${w.name} ${new Date(w.updatedAt).toISOString()}`);
      out.push(`      path: ${w.path}`);
    }
  }

  return out.join("\n");
}

export function missingCapabilities(
  caps: PilotCapabilities,
  required: Array<keyof PilotCapabilities>
): Array<keyof PilotCapabilities> {
  return required.filter((k) => !caps[k]);
}

export interface ColonyPilotPreflightConfig {
  enabled: boolean;
  enforceOnAntColonyTool: boolean;
  requiredExecutables: string[];
  requireColonyCapabilities: Array<keyof PilotCapabilities>;
}

export interface ColonyPilotPreflightResult {
  ok: boolean;
  missingExecutables: string[];
  missingCapabilities: Array<keyof PilotCapabilities>;
  failures: string[];
  checkedAt: number;
}

const DEFAULT_PREFLIGHT_CONFIG: ColonyPilotPreflightConfig = {
  enabled: true,
  enforceOnAntColonyTool: true,
  requiredExecutables: ["node", "git", "npm"],
  requireColonyCapabilities: ["colony", "colonyStop"],
};

export type ColonyAgentRole = "queen" | "scout" | "worker" | "soldier" | "design" | "multimodal" | "backend" | "review";

export interface ColonyRoleModelMap {
  scout?: string;
  worker?: string;
  soldier?: string;
  design?: string;
  multimodal?: string;
  backend?: string;
  review?: string;
}

export interface ColonyPilotModelPolicyConfig {
  enabled: boolean;
  specializedRolesEnabled: boolean;
  autoInjectRoleModels: boolean;
  requireHealthyCurrentModel: boolean;
  requireExplicitRoleModels: boolean;
  requiredRoles: ColonyAgentRole[];
  enforceFullModelRef: boolean;
  allowMixedProviders: boolean;
  allowedProviders: string[];
  allowedProvidersByRole: Partial<Record<ColonyAgentRole, string[]>>;
  roleModels: ColonyRoleModelMap;
}

export interface ColonyPilotBudgetPolicyConfig {
  enabled: boolean;
  enforceOnAntColonyTool: boolean;
  requireMaxCost: boolean;
  autoInjectMaxCost: boolean;
  defaultMaxCostUsd?: number;
  hardCapUsd?: number;
  minMaxCostUsd?: number;
  enforceProviderBudgetBlock: boolean;
  providerBudgetLookbackDays: number;
  allowProviderBudgetOverride: boolean;
  providerBudgetOverrideToken: string;
}

export interface ColonyPilotBudgetPolicyEvaluation {
  ok: boolean;
  issues: string[];
  effectiveMaxCostUsd?: number;
}

export interface ColonyPilotProjectTaskSyncConfig {
  enabled: boolean;
  createOnLaunch: boolean;
  trackProgress: boolean;
  markTerminalState: boolean;
  taskIdPrefix: string;
  requireHumanClose: boolean;
  maxNoteLines: number;
  autoQueueRecoveryOnCandidate: boolean;
  recoveryTaskSuffix: string;
}

export type ColonyDeliveryMode = "report-only" | "patch-artifact" | "apply-to-branch";

export interface ColonyPilotDeliveryPolicyConfig {
  enabled: boolean;
  mode: ColonyDeliveryMode;
  requireWorkspaceReport: boolean;
  requireTaskSummary: boolean;
  requireFileInventory: boolean;
  requireValidationCommandLog: boolean;
  blockOnMissingEvidence: boolean;
}

export interface ColonyPilotDeliveryEvidence {
  hasWorkspaceReport: boolean;
  hasTaskSummary: boolean;
  hasFileInventory: boolean;
  hasValidationCommandLog: boolean;
}

export interface ColonyPilotDeliveryEvaluation {
  ok: boolean;
  issues: string[];
  evidence: ColonyPilotDeliveryEvidence;
}

interface ColonyPilotSettings {
  preflight?: Partial<ColonyPilotPreflightConfig>;
  modelPolicy?: Partial<ColonyPilotModelPolicyConfig>;
  budgetPolicy?: Partial<ColonyPilotBudgetPolicyConfig>;
  projectTaskSync?: Partial<ColonyPilotProjectTaskSyncConfig>;
  deliveryPolicy?: Partial<ColonyPilotDeliveryPolicyConfig>;
}

interface QuotaVisibilityBudgetSettings {
  weeklyQuotaTokens?: number;
  weeklyQuotaCostUsd?: number;
  monthlyQuotaTokens?: number;
  monthlyQuotaCostUsd?: number;
  providerBudgets: ProviderBudgetMap;
}

function parseColonyPilotSettings(cwd: string): ColonyPilotSettings {
  try {
    const p = path.join(cwd, ".pi", "settings.json");
    if (!existsSync(p)) return {};
    const json = JSON.parse(readFileSync(p, "utf8"));
    return json?.piStack?.colonyPilot ?? json?.extensions?.colonyPilot ?? {};
  } catch {
    return {};
  }
}

function parseQuotaVisibilityBudgetSettings(cwd: string): QuotaVisibilityBudgetSettings {
  try {
    const p = path.join(cwd, ".pi", "settings.json");
    if (!existsSync(p)) return { providerBudgets: {} };
    const json = JSON.parse(readFileSync(p, "utf8"));
    const cfg = json?.piStack?.quotaVisibility ?? {};

    return {
      weeklyQuotaTokens: safeNum(cfg.weeklyQuotaTokens) || undefined,
      weeklyQuotaCostUsd: safeNum(cfg.weeklyQuotaCostUsd) || undefined,
      monthlyQuotaTokens: safeNum(cfg.monthlyQuotaTokens) || undefined,
      monthlyQuotaCostUsd: safeNum(cfg.monthlyQuotaCostUsd) || undefined,
      providerBudgets: parseProviderBudgets(cfg.providerBudgets),
    };
  } catch {
    return { providerBudgets: {} };
  }
}

function normalizeCapabilitiesList(value: unknown): Array<keyof PilotCapabilities> {
  if (!Array.isArray(value)) return [...DEFAULT_PREFLIGHT_CONFIG.requireColonyCapabilities];
  const allowed: Array<keyof PilotCapabilities> = ["monitors", "remote", "sessionWeb", "colony", "colonyStop"];
  const out = value
    .filter((v): v is keyof PilotCapabilities => typeof v === "string" && allowed.includes(v as keyof PilotCapabilities));
  return out.length > 0 ? out : [...DEFAULT_PREFLIGHT_CONFIG.requireColonyCapabilities];
}

export function resolveColonyPilotPreflightConfig(raw?: Partial<ColonyPilotPreflightConfig>): ColonyPilotPreflightConfig {
  return {
    enabled: raw?.enabled !== false,
    enforceOnAntColonyTool: raw?.enforceOnAntColonyTool !== false,
    requiredExecutables: Array.isArray(raw?.requiredExecutables)
      ? raw!.requiredExecutables.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      : [...DEFAULT_PREFLIGHT_CONFIG.requiredExecutables],
    requireColonyCapabilities: normalizeCapabilitiesList(raw?.requireColonyCapabilities),
  };
}

export function executableProbe(name: string, platform = process.platform): { command: string; args: string[]; label: string } {
  const clean = name.trim();
  if (!clean) return { command: "", args: [], label: "" };

  if (platform === "win32" && clean.toLowerCase() === "npm") {
    // Em alguns runtimes (ex.: shell híbrido), spawn direto de npm.cmd pode falhar com EINVAL.
    // cmd /c npm --version é mais portável nesses cenários.
    return { command: "cmd", args: ["/c", "npm", "--version"], label: "npm" };
  }

  return { command: clean, args: ["--version"], label: clean };
}

export async function runColonyPilotPreflight(
  pi: ExtensionAPI,
  caps: PilotCapabilities,
  config: ColonyPilotPreflightConfig
): Promise<ColonyPilotPreflightResult> {
  const missingCaps = missingCapabilities(caps, config.requireColonyCapabilities);
  const missingExecutables: string[] = [];

  for (const execName of config.requiredExecutables) {
    const probe = executableProbe(execName);
    if (!probe.command) continue;

    try {
      const r = await pi.exec(probe.command, probe.args, { timeout: 5000 });
      if (r.code !== 0) missingExecutables.push(probe.label);
    } catch {
      missingExecutables.push(probe.label);
    }
  }

  const failures: string[] = [];
  if (missingCaps.length > 0) {
    failures.push(`missing capabilities: ${missingCaps.join(", ")}`);
  }
  if (missingExecutables.length > 0) {
    failures.push(`missing executables: ${missingExecutables.join(", ")}`);
  }

  return {
    ok: failures.length === 0,
    missingCapabilities: missingCaps,
    missingExecutables,
    failures,
    checkedAt: Date.now(),
  };
}

function formatPreflightResult(result: ColonyPilotPreflightResult): string {
  const lines = [
    "colony-pilot preflight",
    `ok: ${result.ok ? "yes" : "no"}`,
    `missingCapabilities: ${result.missingCapabilities.length > 0 ? result.missingCapabilities.join(", ") : "(none)"}`,
    `missingExecutables: ${result.missingExecutables.length > 0 ? result.missingExecutables.join(", ") : "(none)"}`,
    `checkedAt: ${new Date(result.checkedAt).toISOString()}`,
  ];

  if (result.failures.length > 0) {
    lines.push("", "failures:", ...result.failures.map((f) => `  - ${f}`));
  }

  return lines.join("\n");
}

export type BaselineProfile = "default" | "phase2";
export type ModelPolicyProfile =
  | "copilot"
  | "codex"
  | "hybrid"
  | "factory-strict"
  | "factory-strict-copilot"
  | "factory-strict-hybrid";

export function resolveBaselineProfile(input?: string): BaselineProfile {
  return input === "phase2" ? "phase2" : "default";
}

export function resolveModelPolicyProfile(input?: string): ModelPolicyProfile {
  return input === "copilot" ||
      input === "hybrid" ||
      input === "factory-strict" ||
      input === "factory-strict-copilot" ||
      input === "factory-strict-hybrid"
    ? input
    : "codex";
}

export function buildModelPolicyProfile(profile: ModelPolicyProfile): ColonyPilotModelPolicyConfig {
  if (profile === "copilot") {
    return resolveColonyPilotModelPolicy({
      specializedRolesEnabled: false,
      allowMixedProviders: false,
      allowedProviders: ["github-copilot"],
      roleModels: {
        scout: "github-copilot/claude-haiku-4.5",
        worker: "github-copilot/claude-sonnet-4.6",
        soldier: "github-copilot/claude-sonnet-4.6",
      },
    });
  }

  if (profile === "hybrid") {
    return resolveColonyPilotModelPolicy({
      specializedRolesEnabled: false,
      allowMixedProviders: true,
      allowedProviders: ["github-copilot", "openai-codex"],
      roleModels: {
        scout: "openai-codex/gpt-5.4-mini",
        worker: "github-copilot/claude-sonnet-4.6",
        soldier: "openai-codex/gpt-5.2-codex",
      },
    });
  }

  if (profile === "factory-strict-copilot") {
    return resolveColonyPilotModelPolicy({
      specializedRolesEnabled: true,
      autoInjectRoleModels: true,
      requireExplicitRoleModels: true,
      requiredRoles: ["scout", "worker", "soldier", "design", "multimodal", "backend", "review"],
      enforceFullModelRef: true,
      allowMixedProviders: false,
      allowedProviders: ["github-copilot"],
      roleModels: {
        scout: "github-copilot/claude-haiku-4.5",
        worker: "github-copilot/claude-sonnet-4.6",
        soldier: "github-copilot/claude-sonnet-4.6",
        design: "github-copilot/claude-sonnet-4.6",
        multimodal: "github-copilot/claude-haiku-4.5",
        backend: "github-copilot/claude-sonnet-4.6",
        review: "github-copilot/claude-sonnet-4.6",
      },
    });
  }

  if (profile === "factory-strict-hybrid") {
    return resolveColonyPilotModelPolicy({
      specializedRolesEnabled: true,
      autoInjectRoleModels: true,
      requireExplicitRoleModels: true,
      requiredRoles: ["scout", "worker", "soldier", "design", "multimodal", "backend", "review"],
      enforceFullModelRef: true,
      allowMixedProviders: true,
      allowedProviders: ["github-copilot", "openai-codex"],
      allowedProvidersByRole: {
        queen: ["openai-codex", "github-copilot"],
        scout: ["openai-codex"],
        worker: ["github-copilot"],
        soldier: ["openai-codex"],
        design: ["github-copilot"],
        multimodal: ["openai-codex"],
        backend: ["openai-codex"],
        review: ["github-copilot"],
      },
      roleModels: {
        scout: "openai-codex/gpt-5.4-mini",
        worker: "github-copilot/claude-sonnet-4.6",
        soldier: "openai-codex/gpt-5.2-codex",
        design: "github-copilot/claude-sonnet-4.6",
        multimodal: "openai-codex/gpt-5.4-mini",
        backend: "openai-codex/gpt-5.3-codex",
        review: "github-copilot/claude-sonnet-4.6",
      },
    });
  }

  if (profile === "factory-strict") {
    return resolveColonyPilotModelPolicy({
      specializedRolesEnabled: true,
      autoInjectRoleModels: true,
      requireExplicitRoleModels: true,
      requiredRoles: ["scout", "worker", "soldier", "design", "multimodal", "backend", "review"],
      enforceFullModelRef: true,
      allowMixedProviders: false,
      allowedProviders: ["openai-codex"],
      roleModels: {
        scout: "openai-codex/gpt-5.4-mini",
        worker: "openai-codex/gpt-5.3-codex",
        soldier: "openai-codex/gpt-5.2-codex",
        design: "openai-codex/gpt-5.3-codex",
        multimodal: "openai-codex/gpt-5.4-mini",
        backend: "openai-codex/gpt-5.3-codex",
        review: "openai-codex/gpt-5.2-codex",
      },
    });
  }

  return resolveColonyPilotModelPolicy({
    specializedRolesEnabled: false,
    allowMixedProviders: false,
    allowedProviders: ["openai-codex"],
    roleModels: {
      scout: "openai-codex/gpt-5.4-mini",
      worker: "openai-codex/gpt-5.3-codex",
      soldier: "openai-codex/gpt-5.2-codex",
    },
  });
}

export function buildProjectBaselineSettings(profile: BaselineProfile = "default") {
  const base = {
    piStack: {
      colonyPilot: {
        preflight: {
          enabled: true,
          enforceOnAntColonyTool: true,
          requiredExecutables: ["node", "git", "npm"],
          requireColonyCapabilities: ["colony", "colonyStop"],
        },
        modelPolicy: {
          enabled: true,
          specializedRolesEnabled: false,
          autoInjectRoleModels: true,
          requireHealthyCurrentModel: true,
          requireExplicitRoleModels: false,
          requiredRoles: ["scout", "worker", "soldier"],
          enforceFullModelRef: true,
          allowMixedProviders: true,
          allowedProviders: [],
          allowedProvidersByRole: {},
          roleModels: {},
        },
        budgetPolicy: {
          enabled: true,
          enforceOnAntColonyTool: true,
          requireMaxCost: true,
          autoInjectMaxCost: true,
          defaultMaxCostUsd: 2,
          hardCapUsd: 20,
          minMaxCostUsd: 0.05,
          enforceProviderBudgetBlock: false,
          providerBudgetLookbackDays: 30,
          allowProviderBudgetOverride: true,
          providerBudgetOverrideToken: "budget-override:",
        },
        projectTaskSync: {
          enabled: false,
          createOnLaunch: true,
          trackProgress: true,
          markTerminalState: true,
          taskIdPrefix: "colony",
          requireHumanClose: true,
          maxNoteLines: 20,
          autoQueueRecoveryOnCandidate: true,
          recoveryTaskSuffix: "promotion",
        },
        deliveryPolicy: {
          enabled: false,
          mode: "report-only",
          requireWorkspaceReport: true,
          requireTaskSummary: true,
          requireFileInventory: false,
          requireValidationCommandLog: false,
          blockOnMissingEvidence: true,
        },
      },
      webSessionGateway: {
        mode: "local",
        port: 3100,
      },
      schedulerGovernance: {
        enabled: true,
        policy: "observe",
        requireTextConfirmation: true,
        allowEnvOverride: true,
        staleAfterMs: 10000,
      },
      guardrailsCore: {
        portConflict: {
          enabled: true,
          suggestedTestPort: 4173,
        },
      },
    },
  };

  if (profile === "default") return base;

  return deepMergeObjects(base, {
    piStack: {
      colonyPilot: {
        preflight: {
          requiredExecutables: ["node", "git", "npm", "npx"],
          requireColonyCapabilities: ["colony", "colonyStop", "monitors", "sessionWeb"],
        },
        modelPolicy: {
          requireExplicitRoleModels: true,
          allowMixedProviders: false,
        },
        budgetPolicy: {
          defaultMaxCostUsd: 1,
          hardCapUsd: 10,
          enforceProviderBudgetBlock: true,
        },
        deliveryPolicy: {
          enabled: true,
          mode: "patch-artifact",
          requireFileInventory: true,
          requireValidationCommandLog: true,
        },
      },
      guardrailsCore: {
        portConflict: {
          suggestedTestPort: 4273,
        },
      },
    },
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function deepMergeObjects<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMergeObjects(out[key] as Record<string, unknown>, value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

export function applyProjectBaselineSettings(existing: unknown, profile: BaselineProfile = "default") {
  const current = isPlainObject(existing) ? { ...existing } : {};

  // Migration safety: older versions wrote custom config under `extensions` (reserved by pi).
  // If that happened, move known keys under `piStack` and restore `extensions` as array.
  const ext = current.extensions;
  if (isPlainObject(ext) && !Array.isArray(ext)) {
    const migrated: Record<string, unknown> = isPlainObject(current.piStack) ? { ...(current.piStack as Record<string, unknown>) } : {};
    for (const key of ["colonyPilot", "webSessionGateway", "guardrailsCore"]) {
      if (key in ext) migrated[key] = (ext as Record<string, unknown>)[key];
    }
    current.piStack = migrated;
    current.extensions = [];
  }

  const baseline = buildProjectBaselineSettings(profile);
  return deepMergeObjects(current, baseline as Record<string, unknown>);
}

function readProjectSettings(cwd: string): Record<string, unknown> {
  const p = path.join(cwd, ".pi", "settings.json");
  if (!existsSync(p)) return {};
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    return isPlainObject(raw) ? raw : {};
  } catch {
    return {};
  }
}

function writeProjectSettings(cwd: string, data: Record<string, unknown>) {
  const dir = path.join(cwd, ".pi");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "settings.json"), `${JSON.stringify(data, null, 2)}\n`);
}

interface ProjectTaskItem {
  id: string;
  description: string;
  status: "planned" | "in-progress" | "completed" | "blocked" | "cancelled";
  files?: string[];
  acceptance_criteria?: string[];
  depends_on?: string[];
  assigned_agent?: string;
  verification?: string;
  notes?: string;
}

interface ProjectTasksBlock {
  tasks: ProjectTaskItem[];
}

function readProjectTasksBlock(cwd: string): ProjectTasksBlock {
  const p = path.join(cwd, ".project", "tasks.json");
  if (!existsSync(p)) return { tasks: [] };

  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    if (!raw || typeof raw !== "object") return { tasks: [] };
    const tasks = Array.isArray((raw as { tasks?: unknown }).tasks)
      ? ((raw as { tasks: unknown[] }).tasks.filter((t): t is ProjectTaskItem => !!t && typeof t === "object") as ProjectTaskItem[])
      : [];
    return { tasks };
  } catch {
    return { tasks: [] };
  }
}

function writeProjectTasksBlock(cwd: string, block: ProjectTasksBlock) {
  const dir = path.join(cwd, ".project");
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "tasks.json");
  writeFileSync(p, `${JSON.stringify({ tasks: block.tasks }, null, 2)}\n`);
}

function sanitizeTaskSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function appendNote(existing: string | undefined, line: string, maxLines: number): string {
  const lines = (existing ?? "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  lines.push(line);
  const keep = lines.slice(Math.max(0, lines.length - maxLines));
  return keep.join("\n");
}

function upsertProjectTaskFromColonySignal(
  cwd: string,
  signal: { phase: ColonyPhase; id: string },
  options: {
    config: ColonyPilotProjectTaskSyncConfig;
    goal?: string;
    taskIdOverride?: string;
    source?: "ant_colony" | "manual";
  }
): { changed: boolean; taskId: string; status: ProjectTaskItem["status"] } {
  const cfg = options.config;
  const block = readProjectTasksBlock(cwd);

  const baseTaskId = options.taskIdOverride
    ? options.taskIdOverride
    : `${cfg.taskIdPrefix}-${signal.id}`;
  const taskId = sanitizeTaskSlug(baseTaskId) || `${cfg.taskIdPrefix}-${Date.now()}`;
  const now = new Date().toISOString();

  const idx = block.tasks.findIndex((t) => t.id === taskId);
  const nextStatus = colonyPhaseToProjectTaskStatus(signal.phase, cfg.requireHumanClose);
  const isTerminal = signal.phase === "completed" || signal.phase === "failed" || signal.phase === "aborted" || signal.phase === "budget_exceeded";
  const origin = options.source ?? "manual";
  const goalLabel = options.goal?.trim() || `colony ${signal.id}`;

  const line =
    signal.phase === "completed" && cfg.requireHumanClose
      ? `[${now}] colony ${signal.id} phase=completed (candidate only, aguardando revisão humana)`
      : `[${now}] colony ${signal.id} phase=${signal.phase}`;

  if (idx === -1) {
    if (!cfg.createOnLaunch && signal.phase === "launched") {
      return { changed: false, taskId, status: nextStatus };
    }

    block.tasks.push({
      id: taskId,
      description: `[COLONY:${origin}] ${goalLabel}`,
      status: nextStatus,
      notes: appendNote(undefined, line, cfg.maxNoteLines),
    });
    writeProjectTasksBlock(cwd, block);
    return { changed: true, taskId, status: nextStatus };
  }

  const current = block.tasks[idx]!;
  let changed = false;

  if (cfg.trackProgress && current.status !== nextStatus) {
    if (!isTerminal || cfg.markTerminalState) {
      current.status = nextStatus;
      changed = true;
    }
  }

  if (cfg.trackProgress) {
    current.notes = appendNote(current.notes, line, cfg.maxNoteLines);
    changed = true;
  }

  if (changed) writeProjectTasksBlock(cwd, block);
  return { changed, taskId, status: current.status };
}

function ensureRecoveryTaskForCandidate(
  cwd: string,
  options: {
    sourceTaskId: string;
    colonyId: string;
    goal?: string;
    deliveryMode: ColonyDeliveryMode;
    issues: string[];
    config: ColonyPilotProjectTaskSyncConfig;
  }
): { taskId: string; changed: boolean } {
  const block = readProjectTasksBlock(cwd);
  const suffix = sanitizeTaskSlug(options.config.recoveryTaskSuffix || "promotion") || "promotion";
  const recoveryTaskId = sanitizeTaskSlug(`${options.sourceTaskId}-${suffix}`) || `${options.sourceTaskId}-promotion`;
  const idx = block.tasks.findIndex((t) => t.id === recoveryTaskId);
  const now = new Date().toISOString();
  const issueLine = options.issues.length > 0
    ? options.issues.join("; ")
    : (options.deliveryMode === "apply-to-branch"
      ? "completion pending explicit promotion"
      : `delivery mode '${options.deliveryMode}' requires promotion`);
  const line = `[${now}] auto-queued from colony ${options.colonyId}: ${issueLine}`;
  const checklist = [
    "Coletar inventário final de arquivos alterados e validar se aplica ao branch alvo.",
    "Executar/registrar comandos de validação (smoke/regression) e anexar evidências.",
    "Promover candidate para revisão humana (sem auto-close).",
  ];

  if (idx === -1) {
    block.tasks.push({
      id: recoveryTaskId,
      description: `[RECOVERY:colony] Promote candidate ${options.sourceTaskId}${options.goal ? ` — ${options.goal}` : ""}`,
      status: "planned",
      depends_on: [options.sourceTaskId],
      acceptance_criteria: checklist,
      notes: appendNote(undefined, line, options.config.maxNoteLines),
    });
    writeProjectTasksBlock(cwd, block);
    return { taskId: recoveryTaskId, changed: true };
  }

  const task = block.tasks[idx]!;
  task.notes = appendNote(task.notes, line, options.config.maxNoteLines);
  if (task.status === "completed" || task.status === "cancelled") {
    task.status = "planned";
  }
  if (!Array.isArray(task.depends_on)) task.depends_on = [];
  if (!task.depends_on.includes(options.sourceTaskId)) task.depends_on.push(options.sourceTaskId);
  if (!Array.isArray(task.acceptance_criteria) || task.acceptance_criteria.length === 0) {
    task.acceptance_criteria = checklist;
  }
  writeProjectTasksBlock(cwd, block);
  return { taskId: recoveryTaskId, changed: true };
}

function extractColonyGoalFromMessageText(text: string): string | undefined {
  const m = text.match(/(?:Colony launched[^:]*:|\/colony\s+)([^\n]+)/i);
  if (!m) return undefined;
  const goal = m[1].trim();
  return goal.length > 0 ? goal : undefined;
}

function extractText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const msg = message as { content?: unknown };
  const { content } = msg;

  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: string; text?: string };
    if (p.type === "text" && typeof p.text === "string") {
      parts.push(p.text);
    }
  }
  return parts.join("\n");
}

function inferMonitorModeFromSessionFile(sessionFile?: string): MonitorMode {
  if (!sessionFile || !existsSync(sessionFile)) return "unknown";
  try {
    const text = readFileSync(sessionFile, "utf8");
    const lines = text.split(/\r?\n/);
    const tail = lines.slice(Math.max(0, lines.length - 1200)).reverse();
    for (const line of tail) {
      const mode = parseMonitorModeFromText(line);
      if (mode) return mode;
    }
  } catch {
    // ignore session parse failures
  }
  return "unknown";
}

function countLiveColonies(state: PilotState): number {
  let live = 0;
  for (const colony of state.colonies.values()) {
    if (!TERMINAL_COLONY_PHASES.has(colony.phase)) live += 1;
  }
  return live;
}

function pruneColonies(state: PilotState, now = Date.now()): boolean {
  let changed = false;
  for (const [id, colony] of state.colonies.entries()) {
    const ageMs = Math.max(0, now - colony.updatedAt);
    const terminalStale = TERMINAL_COLONY_PHASES.has(colony.phase) && ageMs > 15 * 60_000;
    const nonTerminalStale = !TERMINAL_COLONY_PHASES.has(colony.phase) && ageMs > 4 * 60 * 60_000;
    const invalidId = normalizeColonySignalId(id) === undefined;
    if (terminalStale || nonTerminalStale || invalidId) {
      state.colonies.delete(id);
      changed = true;
    }
  }
  return changed;
}

function renderStatus(state: PilotState): string | undefined {
  const colonies = countLiveColonies(state);
  if (!state.remoteActive && colonies === 0 && state.monitorMode === "unknown") return undefined;

  const monitors = `monitors=${state.monitorMode}`;
  const web = `web=${state.remoteActive ? "on" : "off"}`;
  const ants = `colonies=${colonies}`;
  return `[pilot] ${monitors} · ${web} · ${ants}`;
}

function formatSnapshot(state: PilotState): string {
  const colonyRows = [...state.colonies.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => `  - ${c.id}: ${c.phase} (${new Date(c.updatedAt).toLocaleTimeString()})`);

  return [
    "colony-pilot status",
    `monitorMode: ${state.monitorMode}`,
    `remote: ${state.remoteActive ? "active" : "inactive"}`,
    `remoteUrl: ${state.remoteUrl ?? "(none)"}`,
    `remoteClients: ${state.remoteClients ?? 0}`,
    `sessionFile: ${state.lastSessionFile ?? "(ephemeral)"}`,
    `colonies: ${countLiveColonies(state)} (tracked=${state.colonies.size})`,
    ...(colonyRows.length > 0 ? ["", ...colonyRows] : []),
  ].join("\n");
}

function updateStatusUI(ctx: ExtensionContext | undefined, state: PilotState) {
  ctx?.ui?.setStatus?.("colony-pilot", renderStatus(state));
}

function trackFromText(text: string, state: PilotState): boolean {
  let changed = pruneColonies(state);

  const mode = parseMonitorModeFromText(text);
  if (mode && state.monitorMode !== mode) {
    state.monitorMode = mode;
    changed = true;
  }

  const signal = parseColonySignal(text);
  if (signal) {
    const normalizedId = normalizeColonySignalId(signal.id);
    if (normalizedId) {
      const current = state.colonies.get(normalizedId);
      state.colonies.set(normalizedId, {
        id: normalizedId,
        phase: signal.phase,
        updatedAt: Date.now(),
      });
      changed = !current || current.phase !== signal.phase || changed;
    }
  }

  const remoteUrl = parseRemoteAccessUrl(text);
  if (remoteUrl) {
    state.remoteActive = true;
    state.remoteUrl = remoteUrl;
    changed = true;
  }

  const clients = text.match(REMOTE_CLIENTS_RE)?.[1];
  if (clients) {
    const count = Number.parseInt(clients, 10);
    if (!Number.isNaN(count)) {
      state.remoteClients = count;
      state.remoteActive = true;
      changed = true;
    }
  }

  if (/Remote access stopped/i.test(text)) {
    state.remoteActive = false;
    state.remoteClients = 0;
    changed = true;
  }

  return changed;
}

export function applyTelemetryText(state: PilotState, text: string): boolean {
  return trackFromText(text, state);
}

export function snapshotPilotState(state: PilotState) {
  return {
    monitorMode: state.monitorMode,
    remoteActive: state.remoteActive,
    remoteUrl: state.remoteUrl,
    remoteClients: state.remoteClients ?? 0,
    sessionFile: state.lastSessionFile,
    colonies: [...state.colonies.values()].map((c) => ({
      id: c.id,
      phase: c.phase,
      updatedAt: c.updatedAt,
    })),
  };
}

export function parseCommandInput(input: string): { cmd: string; body: string } {
  const trimmed = input.trim();
  if (!trimmed) return { cmd: "", body: "" };

  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace === -1) return { cmd: trimmed, body: "" };

  return {
    cmd: trimmed.slice(0, firstSpace),
    body: trimmed.slice(firstSpace + 1).trim(),
  };
}

export function normalizeQuotedText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function primeManualRunbook(
  ctx: ExtensionContext,
  title: string,
  steps: string[],
  reason = "Auto-dispatch de slash commands entre extensões não é suportado de forma confiável pela API atual do pi."
) {
  if (steps.length === 0) return;

  const text = [
    title,
    reason,
    "",
    "Execute na ordem:",
    ...steps.map((s) => `  - ${s}`),
    "",
    `Primei o editor com: ${steps[0]}`,
  ].join("\n");

  ctx.ui.notify(text, "info");
  ctx.ui.setEditorText?.(steps[0]);
}

function capabilityGuidance(capability: keyof PilotCapabilities): string {
  switch (capability) {
    case "remote":
      return "`/remote` ausente — revisar inclusão de `@ifi/pi-web-remote` na stack curada do ambiente (ou usar `/session-web` first-party).";
    case "sessionWeb":
      return "`/session-web` ausente — revisar carga da extensão first-party `web-session-gateway` no `@aretw0/pi-stack`.";
    case "colony":
    case "colonyStop":
      return "Comandos de colony ausentes — revisar inclusão de `@ifi/oh-pi-ant-colony` na stack curada do ambiente.";
    case "monitors":
      return "`/monitors` ausente — revisar inclusão de `@davidorex/pi-project-workflows` na stack curada do ambiente.";
    default:
      return "Capacidade ausente.";
  }
}

function getCapabilities(pi: ExtensionAPI): PilotCapabilities {
  const commands = pi.getCommands().map((c) => c.name);
  return detectPilotCapabilities(commands);
}

function requireCapabilities(
  ctx: ExtensionContext,
  caps: PilotCapabilities,
  required: Array<keyof PilotCapabilities>,
  action: string
): boolean {
  const missing = missingCapabilities(caps, required);
  if (missing.length === 0) return true;

  const lines = [
    `Não posso preparar \`${action}\` porque faltam comandos no runtime atual:`,
    ...missing.map((m) => `  - ${m}: ${capabilityGuidance(m)}`),
    "",
    "Sem acoplamento ad hoc: valide a composição da stack e só então rode /reload.",
    "Use /colony-pilot check para diagnóstico rápido.",
  ];

  ctx.ui.notify(lines.join("\n"), "warning");
  ctx.ui.setEditorText?.("/colony-pilot check");
  return false;
}

async function tryOpenUrl(pi: ExtensionAPI, url: string): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      const r = await pi.exec("cmd", ["/c", "start", "", url], { timeout: 5000 });
      return r.code === 0;
    }
    if (process.platform === "darwin") {
      const r = await pi.exec("open", [url], { timeout: 5000 });
      return r.code === 0;
    }

    const r = await pi.exec("xdg-open", [url], { timeout: 5000 });
    return r.code === 0;
  } catch {
    return false;
  }
}

interface ProviderBudgetGateSnapshot {
  lookbackDays: number;
  generatedAtIso: string;
  budgets: ProviderBudgetStatus[];
  allocationWarnings: string[];
}

function formatProviderBudgetStatusLine(status: ProviderBudgetStatus): string {
  const capTokens = status.periodTokensCap ? Math.round(status.periodTokensCap).toLocaleString("en-US") : "n/a";
  const usedPct = status.usedPctTokens !== undefined ? `${status.usedPctTokens.toFixed(1)}%` : "n/a";
  return `  - ${status.provider} (${status.period}) used=${Math.round(status.observedTokens).toLocaleString("en-US")} tok (${usedPct}) cap=${capTokens}`;
}

export default function (pi: ExtensionAPI) {
  const state: PilotState = createPilotState();

  let currentCtx: ExtensionContext | undefined;
  let preflightConfig = resolveColonyPilotPreflightConfig();
  let modelPolicyConfig = resolveColonyPilotModelPolicy();
  let budgetPolicyConfig = resolveColonyPilotBudgetPolicy();
  let projectTaskSyncConfig = resolveColonyPilotProjectTaskSync();
  let deliveryPolicyConfig = resolveColonyPilotDeliveryPolicy();
  const pendingColonyGoals: Array<{ goal: string; source: "ant_colony" | "manual"; at: number }> = [];
  const colonyTaskMap = new Map<string, string>();
  const colonyGoalMap = new Map<string, string>();
  let preflightCache: { at: number; result: ColonyPilotPreflightResult } | undefined;
  let providerBudgetGateCache: { at: number; key: string; snapshot: ProviderBudgetGateSnapshot } | undefined;

  pi.on("session_start", (_event, ctx) => {
    currentCtx = ctx;
    state.colonies.clear();
    state.remoteActive = false;
    state.remoteUrl = undefined;
    state.remoteClients = 0;
    state.monitorMode = "unknown";
    state.lastSessionFile = ctx.sessionManager.getSessionFile?.() ?? undefined;
    state.monitorMode = inferMonitorModeFromSessionFile(state.lastSessionFile);
    pendingColonyGoals.splice(0, pendingColonyGoals.length);
    colonyTaskMap.clear();
    colonyGoalMap.clear();

    const settings = parseColonyPilotSettings(ctx.cwd);
    preflightConfig = resolveColonyPilotPreflightConfig(settings.preflight);
    modelPolicyConfig = resolveColonyPilotModelPolicy(settings.modelPolicy);
    budgetPolicyConfig = resolveColonyPilotBudgetPolicy(settings.budgetPolicy);
    projectTaskSyncConfig = resolveColonyPilotProjectTaskSync(settings.projectTaskSync);
    deliveryPolicyConfig = resolveColonyPilotDeliveryPolicy(settings.deliveryPolicy);
    preflightCache = undefined;
    providerBudgetGateCache = undefined;

    updateStatusUI(ctx, state);
  });

  function maybeSyncProjectTaskFromTelemetry(text: string, ctx: ExtensionContext) {
    if (!projectTaskSyncConfig.enabled) return;

    const signalRaw = parseColonySignal(text);
    if (!signalRaw) return;

    const primaryId = normalizeColonySignalId(signalRaw.id);
    if (!primaryId) return;
    const signal = { ...signalRaw, id: primaryId };

    const guessedGoal = colonyGoalMap.get(signal.id)
      ?? pendingColonyGoals.shift()?.goal
      ?? extractColonyGoalFromMessageText(text);

    if (guessedGoal) {
      colonyGoalMap.set(signal.id, guessedGoal);
    }

    const taskIdOverride = colonyTaskMap.get(signal.id);
    const syncResult = upsertProjectTaskFromColonySignal(ctx.cwd, signal, {
      config: projectTaskSyncConfig,
      goal: guessedGoal,
      taskIdOverride,
      source: "ant_colony",
    });

    if (signal.phase === "completed") {
      const deliveryEval = evaluateColonyDeliveryEvidence(text, signal.phase, deliveryPolicyConfig);
      const requiresPromotion =
        deliveryPolicyConfig.mode !== "apply-to-branch" || !deliveryEval.ok;

      if (!deliveryEval.ok && deliveryPolicyConfig.enabled && deliveryPolicyConfig.blockOnMissingEvidence) {
        const block = readProjectTasksBlock(ctx.cwd);
        const idx = block.tasks.findIndex((t) => t.id === syncResult.taskId);
        if (idx >= 0) {
          const task = block.tasks[idx]!;
          task.status = "blocked";
          const now = new Date().toISOString();
          task.notes = appendNote(
            task.notes,
            `[${now}] delivery-policy blocked completion: ${deliveryEval.issues.join("; ")}`,
            projectTaskSyncConfig.maxNoteLines
          );
          writeProjectTasksBlock(ctx.cwd, block);
        }
      }

      if (projectTaskSyncConfig.autoQueueRecoveryOnCandidate && requiresPromotion) {
        const promotionIssues = deliveryEval.ok
          ? [`delivery mode '${deliveryPolicyConfig.mode}' requires explicit promotion flow`]
          : deliveryEval.issues;
        const recovery = ensureRecoveryTaskForCandidate(ctx.cwd, {
          sourceTaskId: syncResult.taskId,
          colonyId: signal.id,
          goal: guessedGoal,
          deliveryMode: deliveryPolicyConfig.mode,
          issues: promotionIssues,
          config: projectTaskSyncConfig,
        });

        const block = readProjectTasksBlock(ctx.cwd);
        const idx = block.tasks.findIndex((t) => t.id === syncResult.taskId);
        if (idx >= 0) {
          const task = block.tasks[idx]!;
          const now = new Date().toISOString();
          task.notes = appendNote(
            task.notes,
            `[${now}] promotion queued automatically: ${recovery.taskId}`,
            projectTaskSyncConfig.maxNoteLines
          );
          writeProjectTasksBlock(ctx.cwd, block);
        }
      }
    }

    colonyTaskMap.set(signal.id, syncResult.taskId);
  }

  async function resolveProviderBudgetGateSnapshot(ctx: ExtensionContext): Promise<ProviderBudgetGateSnapshot | undefined> {
    const quotaCfg = parseQuotaVisibilityBudgetSettings(ctx.cwd);
    if (Object.keys(quotaCfg.providerBudgets).length === 0) return undefined;

    const cacheKey = JSON.stringify({
      cwd: ctx.cwd,
      days: budgetPolicyConfig.providerBudgetLookbackDays,
      weeklyQuotaTokens: quotaCfg.weeklyQuotaTokens,
      weeklyQuotaCostUsd: quotaCfg.weeklyQuotaCostUsd,
      monthlyQuotaTokens: quotaCfg.monthlyQuotaTokens,
      monthlyQuotaCostUsd: quotaCfg.monthlyQuotaCostUsd,
      providerBudgets: quotaCfg.providerBudgets,
    });

    if (providerBudgetGateCache && providerBudgetGateCache.key === cacheKey && Date.now() - providerBudgetGateCache.at < 30_000) {
      return providerBudgetGateCache.snapshot;
    }

    const status = await analyzeQuota({
      days: budgetPolicyConfig.providerBudgetLookbackDays,
      weeklyQuotaTokens: quotaCfg.weeklyQuotaTokens,
      weeklyQuotaCostUsd: quotaCfg.weeklyQuotaCostUsd,
      monthlyQuotaTokens: quotaCfg.monthlyQuotaTokens,
      monthlyQuotaCostUsd: quotaCfg.monthlyQuotaCostUsd,
      providerWindowHours: {},
      providerBudgets: quotaCfg.providerBudgets,
    });

    const snapshot: ProviderBudgetGateSnapshot = {
      lookbackDays: budgetPolicyConfig.providerBudgetLookbackDays,
      generatedAtIso: status.source.generatedAtIso,
      budgets: status.providerBudgets,
      allocationWarnings: status.providerBudgetPolicy.allocationWarnings,
    };

    providerBudgetGateCache = { at: Date.now(), key: cacheKey, snapshot };
    return snapshot;
  }

  pi.on("message_end", (event, ctx) => {
    const text = extractText((event as { message?: unknown }).message);
    if (!text) return;
    if (trackFromText(text, state)) updateStatusUI(ctx, state);
    maybeSyncProjectTaskFromTelemetry(text, ctx);
  });

  pi.on("tool_result", (event, ctx) => {
    const text = extractText(event);
    if (!text) return;
    if (trackFromText(text, state)) updateStatusUI(ctx, state);
    maybeSyncProjectTaskFromTelemetry(text, ctx);
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType<"ant_colony", AntColonyToolInput>("ant_colony", event)) return undefined;

    if (preflightConfig.enabled && preflightConfig.enforceOnAntColonyTool) {
      const now = Date.now();
      let result = preflightCache?.result;
      if (!result || now - preflightCache!.at > 30_000) {
        result = await runColonyPilotPreflight(pi, getCapabilities(pi), preflightConfig);
        preflightCache = { at: now, result };
      }

      if (!result.ok) {
        const reason = `Blocked by colony-pilot preflight: ${result.failures.join("; ")}`;
        ctx.ui.notify(["ant_colony bloqueada por preflight", formatPreflightResult(result)].join("\n\n"), "warning");
        return { block: true, reason };
      }
    }

    const currentModelRef = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
    const goal = typeof event.input.goal === "string" ? event.input.goal.trim() : "";

    if (modelPolicyConfig.enabled) {
      const evaluation = evaluateAntColonyModelPolicy(event.input, currentModelRef, ctx.modelRegistry, modelPolicyConfig);

      if (!evaluation.ok) {
        const reason = `Blocked by colony-pilot model-policy: ${evaluation.issues.join("; ")}`;
        const msg = [
          "ant_colony bloqueada por model-policy",
          ...formatPolicyEvaluation(modelPolicyConfig, evaluation),
          "",
          "issues:",
          ...evaluation.issues.map((i) => `  - ${i}`),
        ].join("\n");
        ctx.ui.notify(msg, "warning");
        return { block: true, reason };
      }
    }

    let budgetEval: ColonyPilotBudgetPolicyEvaluation | undefined;
    if (budgetPolicyConfig.enabled && budgetPolicyConfig.enforceOnAntColonyTool) {
      budgetEval = evaluateAntColonyBudgetPolicy(event.input, budgetPolicyConfig);
      if (!budgetEval.ok) {
        const reason = `Blocked by colony-pilot budget-policy: ${budgetEval.issues.join("; ")}`;
        const msg = [
          "ant_colony bloqueada por budget-policy",
          ...formatBudgetPolicyEvaluation(budgetPolicyConfig, budgetEval),
          "",
          "issues:",
          ...budgetEval.issues.map((i) => `  - ${i}`),
        ].join("\n");
        ctx.ui.notify(msg, "warning");
        return { block: true, reason };
      }
    }

    if (budgetPolicyConfig.enabled && budgetPolicyConfig.enforceOnAntColonyTool && budgetPolicyConfig.enforceProviderBudgetBlock) {
      const snapshot = await resolveProviderBudgetGateSnapshot(ctx);
      const providerGateEval = evaluateProviderBudgetGate(
        event.input,
        currentModelRef,
        goal,
        snapshot?.budgets ?? [],
        snapshot?.allocationWarnings ?? [],
        budgetPolicyConfig
      );

      if (!providerGateEval.ok) {
        const blockedRows = (snapshot?.budgets ?? [])
          .filter((b) => providerGateEval.blockedProviders.includes(b.provider))
          .map((b) => formatProviderBudgetStatusLine(b));

        const reason = `Blocked by colony-pilot provider-budget gate: ${providerGateEval.issues.join("; ")}`;
        const msg = [
          "ant_colony bloqueada por provider-budget gate",
          ...formatBudgetPolicyEvaluation(
            budgetPolicyConfig,
            budgetEval ?? evaluateAntColonyBudgetPolicy(event.input, budgetPolicyConfig)
          ),
          `  lookbackDays: ${snapshot?.lookbackDays ?? budgetPolicyConfig.providerBudgetLookbackDays}`,
          `  snapshotAt: ${snapshot?.generatedAtIso ?? "(no data)"}`,
          `  consideredProviders: ${providerGateEval.consideredProviders.join(", ") || "(none)"}`,
          `  blockedProviders: ${providerGateEval.blockedProviders.join(", ") || "(none)"}`,
          ...(snapshot?.allocationWarnings?.length
            ? ["", "allocationWarnings:", ...snapshot.allocationWarnings.map((w) => `  - ${w}`)]
            : []),
          ...(blockedRows.length ? ["", "blocked status:", ...blockedRows] : []),
          "",
          "Ação:",
          "  - Ajuste budgets/uso no provider",
          `  - Ou use override auditável no goal: '${budgetPolicyConfig.providerBudgetOverrideToken}<motivo>'`,
          "  - Inspecione: /quota-visibility budget <provider> <days>",
        ].join("\n");
        ctx.ui.notify(msg, "warning");
        return { block: true, reason };
      }

      if (providerGateEval.overrideReason) {
        const audit = {
          atIso: new Date().toISOString(),
          goal,
          overrideReason: providerGateEval.overrideReason,
          blockedProviders: providerGateEval.blockedProviders,
          consideredProviders: providerGateEval.consideredProviders,
          lookbackDays: snapshot?.lookbackDays ?? budgetPolicyConfig.providerBudgetLookbackDays,
          snapshotAtIso: snapshot?.generatedAtIso,
        };
        pi.appendEntry("colony-pilot.provider-budget-override", audit);
        ctx.ui.notify(
          [
            "provider-budget override aceito (auditado)",
            `reason: ${providerGateEval.overrideReason}`,
            `blockedProviders: ${providerGateEval.blockedProviders.join(", ") || "(none)"}`,
          ].join("\n"),
          "warning"
        );
      }
    }

    if (
      deliveryPolicyConfig.enabled &&
      goal.length > 0 &&
      requiresApplyToBranch(goal) &&
      deliveryPolicyConfig.mode !== "apply-to-branch"
    ) {
      const reason = `Blocked by colony-pilot delivery-policy: goal requires apply-to-branch but mode=${deliveryPolicyConfig.mode}`;
      const msg = [
        "ant_colony bloqueada por delivery-policy",
        "Goal indica materialização/promoção no branch principal,",
        `mas delivery mode atual é '${deliveryPolicyConfig.mode}'.`,
        "",
        "Ajuste recomendado:",
        "  - definir piStack.colonyPilot.deliveryPolicy.mode = 'apply-to-branch'",
        "  - /reload 3",
      ].join("\n");
      ctx.ui.notify(msg, "warning");
      return { block: true, reason };
    }

    if (goal.length > 0) {
      pendingColonyGoals.push({ goal, source: "ant_colony", at: Date.now() });
      while (pendingColonyGoals.length > 20) pendingColonyGoals.shift();
    }

    return undefined;
  });

  pi.registerTool({
    name: "colony_pilot_status",
    label: "Colony Pilot Status",
    description: "Mostra o estado atual do pilot: monitores, remote web e colonies em background.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const snapshot = snapshotPilotState(state);
      const capabilities = getCapabilities(pi);
      const currentModelRef = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
      const modelReadiness = resolveColonyModelReadiness(ctx.cwd, currentModelRef, ctx.modelRegistry);
      const modelPolicyEvaluation = evaluateAntColonyModelPolicy(
        { goal: "status" },
        currentModelRef,
        ctx.modelRegistry,
        modelPolicyConfig
      );
      const budgetPolicyEvaluation = evaluateAntColonyBudgetPolicy({ goal: "status" }, budgetPolicyConfig);
      const deliveryPolicyEvaluation = evaluateColonyDeliveryEvidence("", "running", deliveryPolicyConfig);
      const payload = {
        ...snapshot,
        capabilities,
        modelReadiness,
        modelPolicy: modelPolicyConfig,
        modelPolicyEvaluation,
        budgetPolicy: budgetPolicyConfig,
        budgetPolicyEvaluation,
        providerBudgetGateCache: providerBudgetGateCache
          ? {
              at: new Date(providerBudgetGateCache.at).toISOString(),
              lookbackDays: providerBudgetGateCache.snapshot.lookbackDays,
              generatedAtIso: providerBudgetGateCache.snapshot.generatedAtIso,
              blockedProviders: providerBudgetGateCache.snapshot.budgets
                .filter((b) => b.state === "blocked")
                .map((b) => b.provider),
              allocationWarnings: providerBudgetGateCache.snapshot.allocationWarnings,
            }
          : undefined,
        projectTaskSync: projectTaskSyncConfig,
        deliveryPolicy: deliveryPolicyConfig,
        deliveryPolicyEvaluation,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        details: payload,
      };
    },
  });

  pi.registerTool({
    name: "colony_pilot_artifacts",
    label: "Colony Pilot Artifacts",
    description: "Inspect colony runtime artifacts (workspace mirrors, state files, worktrees).",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const data = inspectAntColonyRuntime(ctx.cwd);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: data,
      };
    },
  });

  pi.registerTool({
    name: "colony_pilot_preflight",
    label: "Colony Pilot Preflight",
    description: "Run hard preflight checks used to gate ant_colony execution.",
    parameters: Type.Object({}),
    async execute() {
      const caps = getCapabilities(pi);
      const result = await runColonyPilotPreflight(pi, caps, preflightConfig);
      preflightCache = { at: Date.now(), result };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "colony_pilot_baseline",
    label: "Colony Pilot Baseline",
    description: "Show or apply project baseline settings for colony/web runtime governance.",
    parameters: Type.Object({
      apply: Type.Optional(Type.Boolean()),
      profile: Type.Optional(Type.String({ description: "default | phase2" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = params as { apply?: boolean; profile?: string };
      const apply = Boolean(p?.apply);
      const profile = resolveBaselineProfile(p?.profile);
      const baseline = buildProjectBaselineSettings(profile);
      if (!apply) {
        return {
          content: [{ type: "text", text: JSON.stringify({ profile, baseline }, null, 2) }],
          details: { profile, baseline },
        };
      }

      const merged = applyProjectBaselineSettings(readProjectSettings(ctx.cwd), profile);
      writeProjectSettings(ctx.cwd, merged);
      return {
        content: [{ type: "text", text: `Applied project baseline (${profile}) to .pi/settings.json` }],
        details: { applied: true, profile, path: path.join(ctx.cwd, ".pi", "settings.json") },
      };
    },
  });

  pi.registerCommand("colony-pilot", {
    description: "Orquestra pilot de colony + web inspect + profile de monitores (run/status/stop/web).",
    handler: async (args, ctx) => {
      currentCtx = ctx;
      const input = (args ?? "").trim();
      const { cmd, body } = parseCommandInput(input);
      const caps = getCapabilities(pi);

      if (!cmd || cmd === "help") {
        ctx.ui.notify(
          [
            "Usage: /colony-pilot <command>",
            "",
            "Commands:",
            "  prep                          Mostrar plano recomendado do pilot",
            "  run <goal>                    Prepara sequência manual: /monitors off -> /remote -> /colony <goal> (sem maxCost no /colony)",
            "  stop [--restore-monitors]     Prepara sequência manual: /colony-stop all -> /remote stop [-> /monitors on]",
            "  monitors <on|off>             Prepara comando de profile de monitores",
            "  web <start|stop|open|status>  Controla/inspeciona sessão web",
            "  tui                           Mostra como entrar/retomar sessão no TUI",
            "  status                        Snapshot consolidado",
            "  check                         Diagnóstico de capacidades + readiness de provider/model/budget para ant_colony",
            "  models <status|template|apply> [copilot|codex|hybrid|factory-strict|factory-strict-copilot|factory-strict-hybrid]  Política granular de modelos por classe",
            "  preflight                     Executa gates duros (capabilities + executáveis) antes da colony",
            "  baseline [show|apply] [default|phase2]  Baseline de .pi/settings.json (phase2 = mais estrito)",
            "  artifacts                     Mostra onde colony guarda states/worktrees para recovery",
            "",
            "Nota: o pi não expõe API confiável para uma extensão invocar slash commands de outra",
            "extensão no mesmo runtime. O pilot prepara e guia execução manual assistida.",
          ].join("\n"),
          "info"
        );
        return;
      }

      if (cmd === "prep") {
        const base = ["/monitors off", "/remote", "/colony <goal>"];
        primeManualRunbook(
          ctx,
          "Pilot direction:",
          base,
          [
            "- colony run com monitores gerais OFF",
            "- governança principal: mecanismos da colony (inclui soldier)",
            "- inspeção ativa por web remote + TUI status",
            "",
            "Auto-dispatch foi desativado por confiabilidade da API de comandos entre extensões.",
          ].join("\n")
        );
        return;
      }

      if (cmd === "check") {
        const missing = missingCapabilities(caps, ["monitors", "sessionWeb", "remote", "colony", "colonyStop"]);
        const currentModelRef = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
        const readiness = resolveColonyModelReadiness(ctx.cwd, currentModelRef, ctx.modelRegistry);
        const policyEval = evaluateAntColonyModelPolicy(
          { goal: "check" },
          currentModelRef,
          ctx.modelRegistry,
          modelPolicyConfig
        );
        const budgetEval = evaluateAntColonyBudgetPolicy({ goal: "check" }, budgetPolicyConfig);
        const deliveryEval = evaluateColonyDeliveryEvidence("", "running", deliveryPolicyConfig);

        const lines = [
          "colony-pilot capabilities",
          `  monitors: ${caps.monitors ? "ok" : "missing"}`,
          `  session-web: ${caps.sessionWeb ? "ok" : "missing"}`,
          `  remote: ${caps.remote ? "ok" : "missing"}`,
          `  colony: ${caps.colony ? "ok" : "missing"}`,
          `  colony-stop: ${caps.colonyStop ? "ok" : "missing"}`,
          "",
          ...formatModelReadiness(readiness),
          "",
          ...formatPolicyEvaluation(modelPolicyConfig, policyEval),
          "",
          ...formatBudgetPolicyEvaluation(budgetPolicyConfig, budgetEval),
          "",
          ...formatDeliveryPolicyEvaluation(deliveryPolicyConfig, deliveryEval),
          "",
          "project-task-sync:",
          `  enabled: ${projectTaskSyncConfig.enabled ? "yes" : "no"}`,
          `  createOnLaunch: ${projectTaskSyncConfig.createOnLaunch ? "yes" : "no"}`,
          `  trackProgress: ${projectTaskSyncConfig.trackProgress ? "yes" : "no"}`,
          `  markTerminalState: ${projectTaskSyncConfig.markTerminalState ? "yes" : "no"}`,
          `  requireHumanClose: ${projectTaskSyncConfig.requireHumanClose ? "yes" : "no"}`,
          `  taskIdPrefix: ${projectTaskSyncConfig.taskIdPrefix}`,
          `  autoQueueRecoveryOnCandidate: ${projectTaskSyncConfig.autoQueueRecoveryOnCandidate ? "yes" : "no"}`,
          `  recoveryTaskSuffix: ${projectTaskSyncConfig.recoveryTaskSuffix}`,
        ];

        if (missing.length > 0) {
          lines.push("", "Gaps detectados:", ...missing.map((m) => `  - ${capabilityGuidance(m)}`));
        }

        const modelIssues: string[] = [];
        if (readiness.currentModelStatus !== "ok" && readiness.currentModelStatus !== "unavailable") {
          modelIssues.push("Current session model cannot run ant_colony defaults reliably.");
        }
        if (
          readiness.defaultModelStatus !== "ok" &&
          readiness.defaultModelStatus !== "not-set" &&
          readiness.defaultModelStatus !== "unavailable"
        ) {
          modelIssues.push("defaultProvider/defaultModel appears misconfigured or unauthenticated.");
        }
        if (policyEval.issues.length > 0) {
          modelIssues.push(...policyEval.issues);
        }
        if (budgetPolicyConfig.enabled && budgetEval.issues.length > 0) {
          modelIssues.push(...budgetEval.issues);
        }

        if (modelIssues.length > 0) {
          lines.push("", "Provider/model issues:", ...modelIssues.map((m) => `  - ${m}`));
          lines.push("  - Use /model and/or configure piStack.colonyPilot.modelPolicy/budgetPolicy.");
        }

        const warn = missing.length > 0 || modelIssues.length > 0;
        ctx.ui.notify(lines.join("\n"), warn ? "warning" : "info");
        return;
      }

      if (cmd === "status") {
        const currentModelRef = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
        const readiness = resolveColonyModelReadiness(ctx.cwd, currentModelRef, ctx.modelRegistry);
        const policyEval = evaluateAntColonyModelPolicy(
          { goal: "status" },
          currentModelRef,
          ctx.modelRegistry,
          modelPolicyConfig
        );
        const budgetEval = evaluateAntColonyBudgetPolicy({ goal: "status" }, budgetPolicyConfig);
        const deliveryEval = evaluateColonyDeliveryEvidence("", "running", deliveryPolicyConfig);
        const lines = [
          formatSnapshot(state),
          "",
          "capabilities:",
          `  monitors=${caps.monitors ? "ok" : "missing"}`,
          `  session-web=${caps.sessionWeb ? "ok" : "missing"}`,
          `  remote=${caps.remote ? "ok" : "missing"}`,
          `  colony=${caps.colony ? "ok" : "missing"}`,
          `  colony-stop=${caps.colonyStop ? "ok" : "missing"}`,
          "",
          ...formatModelReadiness(readiness),
          "",
          ...formatPolicyEvaluation(modelPolicyConfig, policyEval),
          "",
          ...formatBudgetPolicyEvaluation(budgetPolicyConfig, budgetEval),
          "",
          ...formatDeliveryPolicyEvaluation(deliveryPolicyConfig, deliveryEval),
          "",
          "project-task-sync:",
          `  enabled: ${projectTaskSyncConfig.enabled ? "yes" : "no"}`,
          `  taskIdPrefix: ${projectTaskSyncConfig.taskIdPrefix}`,
          `  requireHumanClose: ${projectTaskSyncConfig.requireHumanClose ? "yes" : "no"}`,
          `  autoQueueRecoveryOnCandidate: ${projectTaskSyncConfig.autoQueueRecoveryOnCandidate ? "yes" : "no"}`,
          `  recoveryTaskSuffix: ${projectTaskSyncConfig.recoveryTaskSuffix}`,
        ];
        const warn = !policyEval.ok || (budgetPolicyConfig.enabled && !budgetEval.ok);
        ctx.ui.notify(lines.join("\n"), warn ? "warning" : "info");
        return;
      }

      if (cmd === "models") {
        const parsed = parseCommandInput(body);
        const action = parsed.cmd || "status";
        const profile = resolveModelPolicyProfile(parseCommandInput(parsed.body).cmd || parsed.body || "codex");

        if (action === "status") {
          const currentModelRef = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
          const evalResult = evaluateAntColonyModelPolicy(
            { goal: "models-status" },
            currentModelRef,
            ctx.modelRegistry,
            modelPolicyConfig
          );

          const lines = [
            "colony-pilot model policy status",
            ...formatPolicyEvaluation(modelPolicyConfig, evalResult),
            ...(evalResult.issues.length > 0
              ? ["", "issues:", ...evalResult.issues.map((i) => `  - ${i}`)]
              : ["", "issues: (none)"]),
          ];

          ctx.ui.notify(lines.join("\n"), evalResult.ok ? "info" : "warning");
          return;
        }

        if (action === "template") {
          const template = buildModelPolicyProfile(profile);
          ctx.ui.notify(
            [
              `colony-pilot model policy template (${profile})`,
              "",
              JSON.stringify({ piStack: { colonyPilot: { modelPolicy: template } } }, null, 2),
              "",
              "Para aplicar automaticamente:",
              `  /colony-pilot models apply ${profile}`,
            ].join("\n"),
            "info"
          );
          return;
        }

        if (action === "apply") {
          const settings = readProjectSettings(ctx.cwd);
          const merged = deepMergeObjects(settings, {
            piStack: { colonyPilot: { modelPolicy: buildModelPolicyProfile(profile) } },
          });
          writeProjectSettings(ctx.cwd, merged);
          const currentModelRef = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
          modelPolicyConfig = resolveColonyPilotModelPolicy(buildModelPolicyProfile(profile));
          const evalResult = evaluateAntColonyModelPolicy(
            { goal: "models-apply" },
            currentModelRef,
            ctx.modelRegistry,
            modelPolicyConfig
          );

          ctx.ui.notify(
            [
              `Model policy (${profile}) aplicada em .pi/settings.json`,
              "Recomendado: /reload",
              "",
              ...formatPolicyEvaluation(modelPolicyConfig, evalResult),
            ].join("\n"),
            evalResult.ok ? "info" : "warning"
          );
          ctx.ui.setEditorText?.("/reload");
          return;
        }

        ctx.ui.notify("Usage: /colony-pilot models <status|template|apply> [copilot|codex|hybrid|factory-strict|factory-strict-copilot|factory-strict-hybrid]", "warning");
        return;
      }

      if (cmd === "preflight") {
        const result = await runColonyPilotPreflight(pi, caps, preflightConfig);
        preflightCache = { at: Date.now(), result };
        ctx.ui.notify(formatPreflightResult(result), result.ok ? "info" : "warning");
        return;
      }

      if (cmd === "baseline") {
        const parsed = parseCommandInput(body);
        const maybeAction = parsed.cmd || "show";
        const isProfileOnly = maybeAction === "default" || maybeAction === "phase2";
        const act = isProfileOnly ? "show" : maybeAction;
        const profileSource = isProfileOnly
          ? maybeAction
          : (parseCommandInput(parsed.body).cmd || parsed.body || "default");
        const profile = resolveBaselineProfile(profileSource);

        if (act === "show") {
          const baseline = buildProjectBaselineSettings(profile);
          ctx.ui.notify(
            [
              `colony-pilot project baseline (${profile}) (.pi/settings.json)`,
              "",
              JSON.stringify(baseline, null, 2),
              "",
              "Para aplicar automaticamente:",
              `  /colony-pilot baseline apply ${profile}`,
            ].join("\n"),
            "info"
          );
          return;
        }

        if (act === "apply") {
          const merged = applyProjectBaselineSettings(readProjectSettings(ctx.cwd), profile);
          writeProjectSettings(ctx.cwd, merged);
          ctx.ui.notify(
            [
              `Baseline (${profile}) aplicada em .pi/settings.json`,
              "Recomendado: /reload",
            ].join("\n"),
            "info"
          );
          ctx.ui.setEditorText?.("/reload");
          return;
        }

        ctx.ui.notify("Usage: /colony-pilot baseline [show|apply] [default|phase2]", "warning");
        return;
      }

      if (cmd === "artifacts") {
        const data = inspectAntColonyRuntime(ctx.cwd);
        ctx.ui.notify(formatArtifactsReport(data), "info");
        return;
      }

      if (cmd === "run") {
        const goal = normalizeQuotedText(body);
        if (!goal) {
          ctx.ui.notify("Usage: /colony-pilot run <goal>", "warning");
          return;
        }

        if (!caps.monitors || !caps.colony || (!caps.remote && !caps.sessionWeb)) {
          const missing: Array<keyof PilotCapabilities> = [];
          if (!caps.monitors) missing.push("monitors");
          if (!caps.colony) missing.push("colony");
          if (!caps.remote && !caps.sessionWeb) missing.push("sessionWeb", "remote");
          const lines = [
            "Não posso preparar `run` porque faltam comandos no runtime atual:",
            ...missing.map((m) => `  - ${m}: ${capabilityGuidance(m)}`),
            "",
            "Use /colony-pilot check para diagnóstico rápido.",
          ];
          ctx.ui.notify(lines.join("\n"), "warning");
          return;
        }

        const preflight = await runColonyPilotPreflight(pi, caps, preflightConfig);
        preflightCache = { at: Date.now(), result: preflight };
        if (!preflight.ok) {
          ctx.ui.notify(
            [
              "Run bloqueado por preflight.",
              formatPreflightResult(preflight),
              "",
              "Resolva os itens e rode /colony-pilot preflight novamente.",
            ].join("\n"),
            "warning"
          );
          ctx.ui.setEditorText?.("/colony-pilot preflight");
          return;
        }

        const sequence = buildRuntimeRunSequence(caps, goal);
        state.monitorMode = "off";
        updateStatusUI(ctx, state);

        pendingColonyGoals.push({ goal, source: "manual", at: Date.now() });
        while (pendingColonyGoals.length > 20) pendingColonyGoals.shift();

        const reason = budgetPolicyConfig.enabled && budgetPolicyConfig.requireMaxCost
          ? [
            "Auto-dispatch de slash commands entre extensões não é suportado de forma confiável pela API atual do pi.",
            "",
            "Aviso de budget: /colony não aceita maxCost via CLI atualmente.",
            "Se precisar hard-cap de custo, prefira execução via tool ant_colony com { goal, maxCost }.",
          ].join("\n")
          : undefined;

        primeManualRunbook(ctx, "Pilot run pronto (manual assistido)", sequence, reason);
        return;
      }

      if (cmd === "stop") {
        const restore = body.includes("--restore-monitors");
        if (!caps.colonyStop || (!caps.remote && !caps.sessionWeb) || (restore && !caps.monitors)) {
          const missing: Array<keyof PilotCapabilities> = [];
          if (!caps.colonyStop) missing.push("colonyStop");
          if (!caps.remote && !caps.sessionWeb) missing.push("sessionWeb", "remote");
          if (restore && !caps.monitors) missing.push("monitors");

          const lines = [
            "Não posso preparar `stop` porque faltam comandos no runtime atual:",
            ...missing.map((m) => `  - ${m}: ${capabilityGuidance(m)}`),
            "",
            "Use /colony-pilot check para diagnóstico rápido.",
          ];
          ctx.ui.notify(lines.join("\n"), "warning");
          return;
        }

        const sequence = buildRuntimeStopSequence(caps, { restoreMonitors: restore });
        if (restore) state.monitorMode = "on";
        updateStatusUI(ctx, state);

        primeManualRunbook(ctx, "Pilot stop pronto (manual assistido)", sequence);
        return;
      }

      if (cmd === "monitors") {
        const mode = normalizeQuotedText(body).split(/\s+/)[0];
        if (mode !== "on" && mode !== "off") {
          ctx.ui.notify("Usage: /colony-pilot monitors <on|off>", "warning");
          return;
        }

        if (!requireCapabilities(ctx, caps, ["monitors"], "monitors")) {
          return;
        }

        state.monitorMode = mode;
        updateStatusUI(ctx, state);
        primeManualRunbook(
          ctx,
          `Profile de monitores (${mode.toUpperCase()}) pronto`,
          [`/monitors ${mode}`],
          "Execute o comando abaixo para aplicar no runtime atual."
        );
        return;
      }

      if (cmd === "web") {
        const { cmd: actionCmd } = parseCommandInput(body);
        const action = actionCmd || "status";

        if (action === "start") {
          if (!caps.remote && !caps.sessionWeb) {
            const lines = [
              "Não posso preparar `web start` porque faltam comandos de web no runtime:",
              `  - sessionWeb: ${capabilityGuidance("sessionWeb")}`,
              `  - remote: ${capabilityGuidance("remote")}`,
            ];
            ctx.ui.notify(lines.join("\n"), "warning");
            return;
          }

          const cmd = caps.sessionWeb ? "/session-web start" : "/remote";
          primeManualRunbook(
            ctx,
            "Start do web session pronto",
            [cmd],
            "Execute o comando abaixo para iniciar o servidor web da sessão."
          );
          return;
        }

        if (action === "stop") {
          if (!caps.remote && !caps.sessionWeb) {
            const lines = [
              "Não posso preparar `web stop` porque faltam comandos de web no runtime:",
              `  - sessionWeb: ${capabilityGuidance("sessionWeb")}`,
              `  - remote: ${capabilityGuidance("remote")}`,
            ];
            ctx.ui.notify(lines.join("\n"), "warning");
            return;
          }

          state.remoteActive = false;
          state.remoteClients = 0;
          updateStatusUI(ctx, state);
          const cmd = caps.sessionWeb ? "/session-web stop" : "/remote stop";
          primeManualRunbook(
            ctx,
            "Stop do web session pronto",
            [cmd],
            "Execute o comando abaixo para encerrar o servidor web da sessão."
          );
          return;
        }

        if (action === "open") {
          if (!state.remoteUrl) {
            ctx.ui.notify("Nenhuma URL remote detectada ainda. Rode /colony-pilot web start e depois /colony-pilot status.", "warning");
            return;
          }

          const ok = await tryOpenUrl(pi, state.remoteUrl);
          if (ok) {
            ctx.ui.notify(`Abrindo browser: ${state.remoteUrl}`, "info");
          } else {
            ctx.ui.notify(`Nao consegui abrir automaticamente. URL: ${state.remoteUrl}`, "warning");
          }
          return;
        }

        if (action === "status") {
          const lines = [
            `remote: ${state.remoteActive ? "active" : "inactive"}`,
            `clients: ${state.remoteClients ?? 0}`,
            `url: ${state.remoteUrl ?? "(none)"}`,
          ];
          ctx.ui.notify(lines.join("\n"), "info");
          return;
        }

        ctx.ui.notify("Usage: /colony-pilot web <start|stop|open|status>", "warning");
        return;
      }

      if (cmd === "tui") {
        ctx.ui.notify(
          [
            "TUI session access:",
            "- Nesta instância você já está na sessão ativa.",
            "- Em outro terminal, abra `pi` e use `/resume` para entrar nesta sessão.",
            `- Session file atual: ${state.lastSessionFile ?? "(ephemeral / sem arquivo)"}`,
          ].join("\n"),
          "info"
        );
        return;
      }

      ctx.ui.notify(`Comando desconhecido: ${cmd}. Use /colony-pilot help`, "warning");
    },
  });

  pi.on("session_shutdown", () => {
    updateStatusUI(currentCtx, {
      ...state,
      monitorMode: "unknown",
      remoteActive: false,
      colonies: new Map(),
    });
  });
}
