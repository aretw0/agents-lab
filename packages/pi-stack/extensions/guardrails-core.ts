/**
 * guardrails-core — Unified first-party guard extension.
 * @capability-id runtime-guardrails
 * @capability-criticality high
 *
 * Consolidates:
 * - read path protection (former read-guard)
 * - deterministic scoped web routing enforcement (former web-routing-guard)
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeQuota, parseProviderBudgets, safeNum, type ProviderBudgetMap, type ProviderBudgetStatus } from "./quota-visibility";
import { parseBudgetOverrideReason } from "./colony-pilot";
import {
  DEFAULT_BLOAT_SMELL_CONFIG,
  resolveBloatSmellConfig,
  shouldEmitBloatSmellSignal,
  extractAssistantTextFromTurnMessage,
  estimateCodeBloatFromEditInput,
  estimateCodeBloatFromWriteInput,
  buildTextBloatStatusLabel,
  buildCodeBloatStatusLabel,
  type BloatSmellConfig,
} from "./guardrails-core-bloat";
import {
  DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG,
  resolveLongRunIntentQueueConfig,
  extractForceNowText,
  shouldQueueInputForLongRun,
  parseLaneQueueAddText,
  parseLaneQueueMilestoneScope,
  parseLaneQueueBoardNextMilestone,
  resolveLaneQueueBoardNextMilestoneSelection,
  evaluateLaneEvidenceMilestoneParity,
  shouldWarnLaneEvidence,
  buildLaneQueueHelpLines,
  buildLaneQueueStatusUsage,
  buildLaneQueueBoardNextUsage,
  buildLaneQueueEvidenceUsage,
  buildLaneQueueStatusTips,
  resolveAutoDrainGateReason,
  resolveAutoDrainRuntimeGateReason,
  resolveLongRunLoopStopBoundary,
  resolveDispatchFailureRuntimeGate,
  estimateAutoDrainWaitMs,
  shouldAutoDrainDeferredIntent,
  resolveAutoDrainRetryDelayMs,
  shouldSchedulePostDispatchAutoDrain,
  resolveBoardAutoAdvanceGateReason,
  shouldAutoAdvanceBoardTask,
  shouldEmitAutoDrainDeferredAudit,
  shouldEmitBoardAutoAdvanceGateAudit,
  resolveLoopActivationMarkers,
  buildLoopActivationMarkersLabel,
  shouldAnnounceLoopActivationReady,
  buildLoopActivationBlockerHint,
  shouldEmitLoopActivationAudit,
  resolveRuntimeCodeActivationState,
  enqueueDeferredIntent,
  dequeueDeferredIntent,
  clearDeferredIntentQueue,
  listDeferredIntents,
  oldestDeferredIntentAgeMs,
  getDeferredIntentQueueCount,
  readLongRunLoopRuntimeState,
  setLongRunLoopRuntimeMode,
  markLongRunLoopRuntimeDispatch,
  markLongRunLoopRuntimeDegraded,
  markLongRunLoopRuntimeHealthy,
  isLongRunLoopLeaseExpired,
  shouldBlockRapidSameTaskRedispatch,
  computeIdenticalFailureStreak,
  shouldPauseOnIdenticalFailure,
  type LongRunIntentQueueConfig,
  type AutoDrainGateReason,
  type BoardAutoAdvanceGateReason,
  type RuntimeCodeActivationState,
  type LongRunLoopRuntimeState,
} from "./guardrails-core-lane-queue";
import {
  DEFAULT_LONG_RUN_PROVIDER_TRANSIENT_RETRY_CONFIG,
  buildProviderRetryExhaustedActionLines,
  buildToolOutputOrphanRecoveryActionLines,
  classifyLongRunDispatchFailure,
  extractToolOutputOrphanCallId,
  resolveToolOutputOrphanRedispatchDecision,
  isProviderTransientRetryExhausted,
  resolveDispatchFailureBlockAfter,
  resolveDispatchFailurePauseAfter,
  resolveDispatchFailureWindowMs,
  resolveLongRunProviderTransientRetryConfig,
  resolveProviderTransientRetryDelayMs,
  type DispatchFailureClass,
  type LongRunProviderTransientRetryConfig,
} from "./guardrails-core-provider-retry";
import { buildBoardReadinessStatusLabel, evaluateBoardLongRunReadiness } from "./guardrails-core-board-readiness";
import { buildBoardExecuteNextIntent, buildGuardrailsIntentSystemPrompt, encodeGuardrailsIntent, parseGuardrailsIntent, summarizeGuardrailsIntent } from "./guardrails-core-intent-bus";
import { resolveGuardrailsIntentRuntimeDecision } from "./guardrails-core-intent-runtime";
import { buildBehaviorRouteSystemPrompt, classifyBehaviorRoute } from "./guardrails-core-behavior-routing";
import { buildShellRoutingStatusLabel, buildShellRoutingSystemPrompt, resolveBashCommandRoutingDecision, resolveCommandRoutingProfile, type CommandRoutingProfile } from "./guardrails-core-shell-routing";
import { buildI18nIntentSystemPrompt, DEFAULT_I18N_INTENT_CONFIG, resolveI18nIntentConfig, summarizeI18nIntentConfig, type I18nIntentConfig } from "./guardrails-core-i18n-intents";
import { registerGuardrailsShellRouteSurface } from "./guardrails-core-shell-route-surface";
import { registerGuardrailsDeliverySurface } from "./guardrails-core-delivery-surface";
import { registerGuardrailsSafeMutationSurface } from "./guardrails-core-safe-mutation-surface";
import { registerGuardrailsGitMaintenanceSurface } from "./guardrails-core-git-maintenance-surface";
import { registerGuardrailsMacroRefactorSurface } from "./guardrails-core-macro-refactor-surface";
import { registerGuardrailsMarkerCheckSurface } from "./guardrails-core-marker-check-surface";
import { registerGuardrailsRecurringFailureSurface } from "./guardrails-core-recurring-failure-surface";
import { registerGuardrailsStructuredIoSurface } from "./guardrails-core-structured-io-surface";
import { registerGuardrailsStructuredInterviewSurface } from "./guardrails-core-structured-interview-surface";
import { registerGuardrailsAutonomyLaneSurface } from "./guardrails-core-autonomy-lane-surface";
import { registerGuardrailsUnattendedContinuationSurface } from "./guardrails-core-unattended-continuation-surface";
import { registerGuardrailsUnattendedRehearsalSurface } from "./guardrails-core-unattended-rehearsal-surface";
import { registerGuardrailsValidationMethodSurface } from "./guardrails-core-validation-method-surface";
import { registerGuardrailsToolHygieneSurface } from "./guardrails-core-tool-hygiene-surface";
import { registerGuardrailsI18nLintSurface } from "./guardrails-core-i18n-lint-surface";
import { normalizeContextWatchdogConfig } from "./context-watchdog-config";
import { readProjectSettings as readProjectSettingsImpl, writeProjectSettings as writeProjectSettingsImpl } from "./context-watchdog-storage";
import { ALLOWED_OUTSIDE, SENSITIVE_PATHS, UPSTREAM_PI_PACKAGE_MUTATION_BLOCKLIST } from "./guardrails-core-path-guard-config";
import { resolveStructuredFirstMutationDecision } from "./guardrails-core-structured-first";
import { resolveTrustedGlobalSkillReadAccess } from "./guardrails-core-skill-access-policy";
import { evaluateBashGuardPolicies } from "./guardrails-core-bash-guard-policies";
import { CDP_SCRIPT_HINT, DISALLOWED_BASH_PATTERNS, INTERACTIVE_TERMS, SENSITIVE_DOMAINS, SENSITIVE_HINTS } from "./guardrails-core-web-routing-config";
export * from "./guardrails-core-exports";

// =============================================================================
// Read / Path Guard
// =============================================================================

export function isInsideCwd(filePath: string, cwd: string): boolean {
  const resolved = resolve(cwd, filePath);
  const rel = relative(cwd, resolved);
  return !rel.startsWith("..") && !rel.startsWith(sep);
}

export function isSensitive(filePath: string): boolean {
  const lower = filePath.toLowerCase().replace(/\\/g, "/");
  return SENSITIVE_PATHS.some((s) => lower.includes(s));
}

export function isAllowedOutside(filePath: string): boolean {
  const lower = filePath.toLowerCase().replace(/\\/g, "/");
  return ALLOWED_OUTSIDE.some((a) => lower.includes(a));
}

export function isUpstreamPiPackagePath(filePath: string, cwd: string): boolean {
  const resolved = resolve(cwd, filePath);
  return UPSTREAM_PI_PACKAGE_MUTATION_BLOCKLIST.some((blockedRoot) => {
    const root = resolve(cwd, blockedRoot);
    const rel = relative(root, resolved);
    return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
  });
}

export function upstreamPiPackageMutationToolReason(filePath: string): string {
  return [
    `Mutação bloqueada: pacote upstream/original do pi (${filePath}).`,
    "Use extensão, wrapper, patch controlado ou PR upstream; leitura bounded continua permitida.",
  ].join(" ");
}

/** Basic heuristic to extract file paths from bash read-like commands. */
export function extractPathsFromBash(command: string): string[] {
  const patterns = [
    /\bcat\s+["']?([^\s|>"';]+)/g,
    /\bless\s+["']?([^\s|>"';]+)/g,
    /\bhead\s+(?:-\d+\s+)?["']?([^\s|>"';]+)/g,
    /\btail\s+(?:-\d+\s+)?["']?([^\s|>"';]+)/g,
    /\bgrep\s+(?:-[a-zA-Z]+\s+)*["']?[^\s]+["']?\s+["']?([^\s|>"';]+)/g,
    /\bsed\s+(?:-[a-zA-Z]+\s+)*['"][^'"]*['"]\s+["']?([^\s|>"';]+)/g,
  ];

  const paths: string[] = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(command)) !== null) {
      if (match[1] && !match[1].startsWith("-")) {
        paths.push(match[1]);
      }
    }
  }

  return paths;
}

async function guardReadPath(filePath: string, ctx: ExtensionContext) {
  if (!filePath) return undefined;

  // Inside project — always allowed
  if (isInsideCwd(filePath, ctx.cwd)) return undefined;

  // Sensitive — block or confirm
  if (isSensitive(filePath)) {
    if (!ctx.hasUI) {
      return { block: true, reason: `Leitura bloqueada: path sensível (${filePath})` };
    }
    const ok = await ctx.ui.confirm(
      "⚠️ Path Sensível",
      `Leitura de arquivo sensível:\n${filePath}\n\nPermitir?`
    );
    if (!ok) return { block: true, reason: `Bloqueado pelo usuário: ${filePath}` };
    return undefined;
  }

  // Trusted global/devcontainer pi skill docs — bounded reads allowed.
  const trustedSkillRead = resolveTrustedGlobalSkillReadAccess(filePath);
  if (trustedSkillRead?.status === "allow") return undefined;

  // Allowed pi paths — no prompt needed
  if (isAllowedOutside(filePath)) return undefined;

  // Outside project, not sensitive, not pi — prompt
  if (ctx.hasUI) {
    const ok = await ctx.ui.confirm(
      "Leitura fora do projeto",
      `O agente quer ler um arquivo fora do projeto:\n${filePath}\n\nPermitir?`
    );
    if (!ok) return { block: true, reason: `Bloqueado pelo usuário: ${filePath}` };
  }

  return undefined;
}

async function guardBashPathReads(command: string, ctx: ExtensionContext) {
  const paths = extractPathsFromBash(command);

  for (const filePath of paths) {
    if (isInsideCwd(filePath, ctx.cwd)) continue;
    if (isAllowedOutside(filePath)) continue;

    if (isSensitive(filePath)) {
      if (!ctx.hasUI) {
        return { block: true, reason: `Comando lê path sensível: ${filePath}` };
      }
      const ok = await ctx.ui.confirm(
        "⚠️ Comando lê path sensível",
        `O comando acessa arquivo sensível:\n${command}\n\nPath: ${filePath}\n\nPermitir?`
      );
      if (!ok) return { block: true, reason: `Bloqueado pelo usuário: ${filePath}` };
    }
  }

  return undefined;
}

// =============================================================================
// Deterministic Web Routing Guard
// =============================================================================

export interface RoutingDecision {
  interactive: boolean;
  sensitiveDomain: boolean;
  sensitiveHint: boolean;
  strictMode: boolean;
  domains: string[];
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

export function extractDomains(text: string): string[] {
  const lower = text.toLowerCase();
  const domains: string[] = [];

  const urlMatches = lower.match(/https?:\/\/[^\s)"']+/g) ?? [];
  for (const raw of urlMatches) {
    try {
      const host = new URL(raw).hostname.replace(/^www\./, "");
      if (host) domains.push(host);
    } catch {
      // ignore malformed URLs
    }
  }

  const domainLikeMatches = lower.match(/\b[a-z0-9.-]+\.[a-z]{2,}\b/g) ?? [];
  for (const d of domainLikeMatches) {
    domains.push(d.replace(/^www\./, ""));
  }

  return uniq(domains);
}

export function hasInteractiveIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return INTERACTIVE_TERMS.some((term) => lower.includes(term));
}

export function classifyRouting(prompt: string): RoutingDecision {
  const lower = prompt.toLowerCase();
  const domains = extractDomains(lower);

  const interactive = hasInteractiveIntent(lower);
  const sensitiveDomain = domains.some((d) => SENSITIVE_DOMAINS.some((sd) => d === sd || d.endsWith(`.${sd}`)));
  const sensitiveHint = SENSITIVE_HINTS.some((hint) => lower.includes(hint));

  return {
    interactive,
    sensitiveDomain,
    sensitiveHint,
    strictMode: interactive && (sensitiveDomain || sensitiveHint),
    domains,
  };
}

export function isDisallowedBash(command: string): boolean {
  const lower = command.toLowerCase();
  if (CDP_SCRIPT_HINT.test(lower)) return false;
  return DISALLOWED_BASH_PATTERNS.some((p) => p.test(lower));
}

export function extractExplicitPorts(command: string): number[] {
  const out = new Set<number>();
  const patterns = [
    /(?:--port|--http-port|--listen)\s+([0-9]{2,5})\b/gi,
    /(?:--port|--http-port|--listen)=([0-9]{2,5})\b/gi,
    /\bPORT\s*=\s*([0-9]{2,5})\b/gi,
    /\b-p\s+([0-9]{2,5})\b/gi,
  ];

  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(command)) !== null) {
      const n = Number.parseInt(m[1] ?? "", 10);
      if (!Number.isNaN(n)) out.add(n);
    }
  }

  return [...out];
}

export function looksLikeServerStartCommand(command: string): boolean {
  const lower = command.toLowerCase();
  const hints = [
    "npm run dev",
    "npm run start",
    "pnpm dev",
    "pnpm start",
    "yarn dev",
    "yarn start",
    "vite",
    "next dev",
    "http-server",
    "serve ",
    "python -m http.server",
    "uvicorn",
    "gunicorn",
    "docker run",
  ];
  return hints.some((h) => lower.includes(h));
}

export function readReservedSessionWebPort(cwd: string): number | undefined {
  try {
    const p = join(cwd, ".pi", "session-web-runtime.json");
    if (!existsSync(p)) return undefined;
    const json = JSON.parse(readFileSync(p, "utf8"));
    if (!json?.running) return undefined;
    const port = Number(json?.port);
    if (Number.isNaN(port) || port <= 0) return undefined;
    return port;
  } catch {
    return undefined;
  }
}

export function detectPortConflict(command: string, reservedPort?: number): number | undefined {
  if (!reservedPort) return undefined;
  if (!looksLikeServerStartCommand(command)) return undefined;
  const ports = extractExplicitPorts(command);
  return ports.includes(reservedPort) ? reservedPort : undefined;
}

interface GuardrailsPortConflictConfig {
  enabled: boolean;
  suggestedTestPort: number;
}

function resolveGuardrailsPortConflictConfig(cwd: string): GuardrailsPortConflictConfig {
  const defaults: GuardrailsPortConflictConfig = { enabled: true, suggestedTestPort: 4173 };
  try {
    const p = join(cwd, ".pi", "settings.json");
    if (!existsSync(p)) return defaults;
    const json = JSON.parse(readFileSync(p, "utf8"));
    const cfg = json?.piStack?.guardrailsCore?.portConflict
      ?? json?.extensions?.guardrailsCore?.portConflict
      ?? {};
    const enabled = cfg?.enabled !== false;
    const suggested = Number(cfg?.suggestedTestPort);
    return {
      enabled,
      suggestedTestPort: Number.isNaN(suggested) || suggested <= 0 ? defaults.suggestedTestPort : suggested,
    };
  } catch {
    return defaults;
  }
}

interface ProviderBudgetGovernorConfig {
  enabled: boolean;
  lookbackDays: number;
  allowOverride: boolean;
  overrideToken: string;
  recoveryCommands: string[];
}

interface ProviderBudgetGovernorSnapshot {
  atIso: string;
  budgets: ProviderBudgetStatus[];
}

function appendAuditEntry(ctx: ExtensionContext, key: string, value: Record<string, unknown>): void {
  const maybeAppend = (ctx as unknown as { appendEntry?: (k: string, v: Record<string, unknown>) => void }).appendEntry;
  if (typeof maybeAppend === "function") {
    maybeAppend(key, value);
  }
}

function normalizeCmdName(text: string): string {
  const t = text.trim();
  if (!t.startsWith("/")) return "";
  const name = t.slice(1).split(/\s+/)[0] ?? "";
  return name.toLowerCase();
}

function readQuotaBudgetSettings(cwd: string): {
  weeklyQuotaTokens?: number;
  weeklyQuotaCostUsd?: number;
  weeklyQuotaRequests?: number;
  monthlyQuotaTokens?: number;
  monthlyQuotaCostUsd?: number;
  monthlyQuotaRequests?: number;
  providerBudgets: ProviderBudgetMap;
} {
  try {
    const p = join(cwd, ".pi", "settings.json");
    if (!existsSync(p)) return { providerBudgets: {} };
    const json = JSON.parse(readFileSync(p, "utf8"));
    const cfg = json?.piStack?.quotaVisibility ?? {};
    return {
      weeklyQuotaTokens: safeNum(cfg.weeklyQuotaTokens) || undefined,
      weeklyQuotaCostUsd: safeNum(cfg.weeklyQuotaCostUsd) || undefined,
      weeklyQuotaRequests: safeNum(cfg.weeklyQuotaRequests) || undefined,
      monthlyQuotaTokens: safeNum(cfg.monthlyQuotaTokens) || undefined,
      monthlyQuotaCostUsd: safeNum(cfg.monthlyQuotaCostUsd) || undefined,
      monthlyQuotaRequests: safeNum(cfg.monthlyQuotaRequests) || undefined,
      providerBudgets: parseProviderBudgets(cfg.providerBudgets),
    };
  } catch {
    return { providerBudgets: {} };
  }
}

function resolveProviderBudgetGovernorConfig(cwd: string): ProviderBudgetGovernorConfig {
  const defaults: ProviderBudgetGovernorConfig = {
    enabled: false,
    lookbackDays: 30,
    allowOverride: true,
    overrideToken: "budget-override:",
    recoveryCommands: ["doctor", "quota-visibility", "model", "login"],
  };

  try {
    const p = join(cwd, ".pi", "settings.json");
    if (!existsSync(p)) return defaults;
    const json = JSON.parse(readFileSync(p, "utf8"));
    const cfg = json?.piStack?.guardrailsCore?.providerBudgetGovernor ?? {};
    const lookback = Number.isFinite(Number(cfg.lookbackDays)) ? Math.floor(Number(cfg.lookbackDays)) : defaults.lookbackDays;
    const recoveryCommands = Array.isArray(cfg.recoveryCommands)
      ? cfg.recoveryCommands
        .filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x: string) => x.trim().toLowerCase())
      : defaults.recoveryCommands;

    return {
      enabled: cfg?.enabled === true,
      lookbackDays: Math.max(1, Math.min(90, lookback)),
      allowOverride: cfg?.allowOverride !== false,
      overrideToken: typeof cfg?.overrideToken === "string" && cfg.overrideToken.trim().length > 0 ? cfg.overrideToken.trim() : defaults.overrideToken,
      recoveryCommands,
    };
  } catch {
    return defaults;
  }
}

export type ProviderBudgetGovernorMisconfig = "missing-provider-budgets";

export function detectProviderBudgetGovernorMisconfig(
  enabled: boolean,
  providerBudgets: ProviderBudgetMap,
): ProviderBudgetGovernorMisconfig | undefined {
  if (!enabled) return undefined;
  if (Object.keys(providerBudgets).length === 0) return "missing-provider-budgets";
  return undefined;
}

export function providerBudgetGovernorMisconfigReason(
  issue: ProviderBudgetGovernorMisconfig,
): string {
  if (issue === "missing-provider-budgets") {
    return [
      "guardrails-core: providerBudgetGovernor habilitado sem quotaVisibility.providerBudgets.",
      "BLOCK por provider não será aplicado até configurar budgets em .pi/settings.json.",
    ].join(" ");
  }
  return "guardrails-core: providerBudgetGovernor misconfigured.";
}

interface PragmaticAutonomyConfig {
  enabled: boolean;
  noObviousQuestions: boolean;
  auditAssumptions: boolean;
  maxAuditTextChars: number;
}

const DEFAULT_PRAGMATIC_AUTONOMY_CONFIG: PragmaticAutonomyConfig = {
  enabled: true,
  noObviousQuestions: true,
  auditAssumptions: true,
  maxAuditTextChars: 140,
};

export function resolvePragmaticAutonomyConfig(cwd: string): PragmaticAutonomyConfig {
  try {
    const p = join(cwd, ".pi", "settings.json");
    if (!existsSync(p)) return DEFAULT_PRAGMATIC_AUTONOMY_CONFIG;
    const json = JSON.parse(readFileSync(p, "utf8"));
    const cfg = json?.piStack?.guardrailsCore?.pragmaticAutonomy ?? {};
    const maxAuditTextCharsRaw = Number(cfg?.maxAuditTextChars);
    return {
      enabled: cfg?.enabled !== false,
      noObviousQuestions: cfg?.noObviousQuestions !== false,
      auditAssumptions: cfg?.auditAssumptions !== false,
      maxAuditTextChars: Number.isFinite(maxAuditTextCharsRaw) && maxAuditTextCharsRaw > 0
        ? Math.max(40, Math.min(400, Math.floor(maxAuditTextCharsRaw)))
        : DEFAULT_PRAGMATIC_AUTONOMY_CONFIG.maxAuditTextChars,
    };
  } catch {
    return DEFAULT_PRAGMATIC_AUTONOMY_CONFIG;
  }
}

export type GuardrailsRuntimeConfigValue = boolean | number | string;

export interface GuardrailsRuntimeConfigSpec {
  key: string;
  path: string[];
  type: "boolean" | "number" | "string";
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  reloadRequired: boolean;
  description: string;
}

const CONTEXT_WATCH_STEERING_LEVEL_PATTERN = /^(warn|checkpoint|compact)$/;

export const GUARDRAILS_RUNTIME_CONFIG_SPECS: GuardrailsRuntimeConfigSpec[] = [
  {
    key: "longRunIntentQueue.enabled",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "enabled"],
    type: "boolean",
    reloadRequired: false,
    description: "Enable or disable long-run queue ingestion.",
  },
  {
    key: "longRunIntentQueue.requireActiveLongRun",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "requireActiveLongRun"],
    type: "boolean",
    reloadRequired: false,
    description: "Only queue inputs when long-run is active.",
  },
  {
    key: "longRunIntentQueue.maxItems",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "maxItems"],
    type: "number",
    min: 1,
    max: 500,
    reloadRequired: false,
    description: "Maximum deferred intents stored on disk.",
  },
  {
    key: "longRunIntentQueue.autoDrainOnIdle",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "autoDrainOnIdle"],
    type: "boolean",
    reloadRequired: false,
    description: "Auto-dispatch deferred intents when runtime is idle.",
  },
  {
    key: "longRunIntentQueue.autoDrainCooldownMs",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "autoDrainCooldownMs"],
    type: "number",
    min: 250,
    max: 180000,
    reloadRequired: false,
    description: "Cooldown between auto-drain attempts.",
  },
  {
    key: "longRunIntentQueue.autoDrainIdleStableMs",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "autoDrainIdleStableMs"],
    type: "number",
    min: 250,
    max: 120000,
    reloadRequired: false,
    description: "Required idle stability before auto-drain.",
  },
  {
    key: "longRunIntentQueue.autoDrainBatchSize",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "autoDrainBatchSize"],
    type: "number",
    min: 1,
    max: 20,
    reloadRequired: false,
    description: "How many deferred intents to dispatch per idle cycle.",
  },
  {
    key: "longRunIntentQueue.dispatchFailureBlockAfter",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "dispatchFailureBlockAfter"],
    type: "number",
    min: 1,
    max: 20,
    reloadRequired: false,
    description: "Failure streak threshold before stop-condition boundary.",
  },
  {
    key: "longRunIntentQueue.rapidRedispatchWindowMs",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "rapidRedispatchWindowMs"],
    type: "number",
    min: 1_000,
    max: 1_800_000,
    reloadRequired: false,
    description: "Window used to block rapid same-task board redispatch after silent failures.",
  },
  {
    key: "longRunIntentQueue.dedupeWindowMs",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "dedupeWindowMs"],
    type: "number",
    min: 1_000,
    max: 1_800_000,
    reloadRequired: false,
    description: "Window used to dedupe equivalent deferred intents before enqueue.",
  },
  {
    key: "longRunIntentQueue.identicalFailurePauseAfter",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "identicalFailurePauseAfter"],
    type: "number",
    min: 1,
    max: 20,
    reloadRequired: false,
    description: "Pause loop after N identical dispatch failures within configured window.",
  },
  {
    key: "longRunIntentQueue.orphanFailurePauseAfter",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "orphanFailurePauseAfter"],
    type: "number",
    min: 1,
    max: 5,
    reloadRequired: false,
    description: "Pause threshold used for tool-output-orphan dispatch failures.",
  },
  {
    key: "longRunIntentQueue.identicalFailureWindowMs",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "identicalFailureWindowMs"],
    type: "number",
    min: 1_000,
    max: 600_000,
    reloadRequired: false,
    description: "Window used to aggregate identical dispatch failures.",
  },
  {
    key: "longRunIntentQueue.orphanFailureWindowMs",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "orphanFailureWindowMs"],
    type: "number",
    min: 1_000,
    max: 600_000,
    reloadRequired: false,
    description: "Window used to aggregate tool-output-orphan dispatch failures.",
  },
  { key: "longRunIntentQueue.forceNowPrefix", path: ["piStack", "guardrailsCore", "longRunIntentQueue", "forceNowPrefix"], type: "string", minLength: 2, maxLength: 40, pattern: /^\S+$/, reloadRequired: false, description: "Immediate dispatch prefix (example: lane-now:)." },
  { key: "longRunIntentQueue.defaultBoardMilestone", path: ["piStack", "guardrailsCore", "longRunIntentQueue", "defaultBoardMilestone"], type: "string", maxLength: 120, reloadRequired: false, description: "Default milestone scope for board readiness/board-next when none is passed." },
  {
    key: "pragmaticAutonomy.enabled",
    path: ["piStack", "guardrailsCore", "pragmaticAutonomy", "enabled"],
    type: "boolean",
    reloadRequired: false,
    description: "Enable pragmatic-autonomy policy.",
  },
  {
    key: "pragmaticAutonomy.noObviousQuestions",
    path: ["piStack", "guardrailsCore", "pragmaticAutonomy", "noObviousQuestions"],
    type: "boolean",
    reloadRequired: false,
    description: "Prefer deterministic defaults for low-risk ambiguity.",
  },
  {
    key: "pragmaticAutonomy.maxAuditTextChars",
    path: ["piStack", "guardrailsCore", "pragmaticAutonomy", "maxAuditTextChars"],
    type: "number",
    min: 40,
    max: 400,
    reloadRequired: false,
    description: "Max chars for assumption audit summary.",
  },
  {
    key: "i18nIntents.enabled",
    path: ["piStack", "guardrailsCore", "i18nIntents", "enabled"],
    type: "boolean",
    reloadRequired: false,
    description: "Enable soft communication and hard artifact i18n intent steering.",
  },
  {
    key: "i18nIntents.communication.language",
    path: ["piStack", "guardrailsCore", "i18nIntents", "communication", "language"],
    type: "string",
    minLength: 2,
    maxLength: 80,
    reloadRequired: false,
    description: "Preferred communication language (soft intent, e.g. auto-user-profile, pt-BR, en).",
  },
  {
    key: "i18nIntents.artifacts.language",
    path: ["piStack", "guardrailsCore", "i18nIntents", "artifacts", "language"],
    type: "string",
    minLength: 2,
    maxLength: 120,
    reloadRequired: false,
    description: "Default generated artifact language policy (hard intent, e.g. preserve-existing-or-user-language).",
  },
  {
    key: "i18nIntents.artifacts.generateTranslations",
    path: ["piStack", "guardrailsCore", "i18nIntents", "artifacts", "generateTranslations"],
    type: "boolean",
    reloadRequired: false,
    description: "Allow opt-in generation of translation artifacts for selected scopes/rules.",
  },
  {
    key: "contextWatchdog.enabled",
    path: ["piStack", "contextWatchdog", "enabled"],
    type: "boolean",
    reloadRequired: true,
    description: "Enable/disable context-watchdog extension behavior.",
  },
  {
    key: "contextWatchdog.status",
    path: ["piStack", "contextWatchdog", "status"],
    type: "boolean",
    reloadRequired: true,
    description: "Enable/disable passive status line emission for context-watch.",
  },
  {
    key: "contextWatchdog.notify",
    path: ["piStack", "contextWatchdog", "notify"],
    type: "boolean",
    reloadRequired: true,
    description: "Enable/disable user-facing notify for context-watch steering.",
  },
  {
    key: "contextWatchdog.modelSteeringFromLevel",
    path: ["piStack", "contextWatchdog", "modelSteeringFromLevel"],
    type: "string",
    minLength: 4,
    maxLength: 10,
    pattern: CONTEXT_WATCH_STEERING_LEVEL_PATTERN,
    reloadRequired: true,
    description: "Context level where model steering starts (warn|checkpoint|compact).",
  },
  {
    key: "contextWatchdog.userNotifyFromLevel",
    path: ["piStack", "contextWatchdog", "userNotifyFromLevel"],
    type: "string",
    minLength: 4,
    maxLength: 10,
    pattern: CONTEXT_WATCH_STEERING_LEVEL_PATTERN,
    reloadRequired: true,
    description: "Context level where user notify starts (warn|checkpoint|compact).",
  },
  {
    key: "contextWatchdog.cooldownMs",
    path: ["piStack", "contextWatchdog", "cooldownMs"],
    type: "number",
    min: 60_000,
    max: 3_600_000,
    reloadRequired: true,
    description: "Cooldown between repeated steering announcements.",
  },
  {
    key: "contextWatchdog.checkpointPct",
    path: ["piStack", "contextWatchdog", "checkpointPct"],
    type: "number",
    min: 1,
    max: 99,
    reloadRequired: true,
    description: "Checkpoint threshold percent for context-watch evaluation.",
  },
  {
    key: "contextWatchdog.compactPct",
    path: ["piStack", "contextWatchdog", "compactPct"],
    type: "number",
    min: 2,
    max: 100,
    reloadRequired: true,
    description: "Compact threshold percent for context-watch evaluation.",
  },
  {
    key: "contextWatchdog.autoCheckpoint",
    path: ["piStack", "contextWatchdog", "autoCheckpoint"],
    type: "boolean",
    reloadRequired: true,
    description: "Enable/disable auto-checkpoint persistence on context pressure.",
  },
  {
    key: "contextWatchdog.autoCompact",
    path: ["piStack", "contextWatchdog", "autoCompact"],
    type: "boolean",
    reloadRequired: true,
    description: "Enable/disable auto-compact trigger logic.",
  },
  {
    key: "contextWatchdog.autoCompactRequireIdle",
    path: ["piStack", "contextWatchdog", "autoCompactRequireIdle"],
    type: "boolean",
    reloadRequired: true,
    description: "Require idle state before auto-compact can trigger.",
  },
  {
    key: "contextWatchdog.autoCompactCooldownMs",
    path: ["piStack", "contextWatchdog", "autoCompactCooldownMs"],
    type: "number",
    min: 60_000,
    max: 7_200_000,
    reloadRequired: true,
    description: "Cooldown between auto-compact attempts.",
  },
  {
    key: "contextWatchdog.autoResumeAfterCompact",
    path: ["piStack", "contextWatchdog", "autoResumeAfterCompact"],
    type: "boolean",
    reloadRequired: true,
    description: "Enable/disable auto-resume dispatch after compact.",
  },
  {
    key: "contextWatchdog.autoResumeCooldownMs",
    path: ["piStack", "contextWatchdog", "autoResumeCooldownMs"],
    type: "number",
    min: 5_000,
    max: 600_000,
    reloadRequired: true,
    description: "Cooldown before auto-resume dispatch is retried.",
  },
  {
    key: "contextWatchdog.handoffFreshMaxAgeMs",
    path: ["piStack", "contextWatchdog", "handoffFreshMaxAgeMs"],
    type: "number",
    min: 60_000,
    max: 7_200_000,
    reloadRequired: true,
    description: "Max handoff age considered fresh before compact/resume prep refresh.",
  },
];

function readProjectPiSettings(cwd: string): Record<string, unknown> {
  return readProjectSettingsImpl(cwd);
}

function writeProjectPiSettings(cwd: string, settings: Record<string, unknown>): string {
  return writeProjectSettingsImpl(cwd, settings);
}

function readValueByPath(obj: Record<string, unknown>, path: string[]): unknown {
  let cursor: unknown = obj;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

function writeValueByPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const next = cursor[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[path[path.length - 1]] = value;
}

export function resolveGuardrailsRuntimeConfigSpec(
  key: string,
): GuardrailsRuntimeConfigSpec | undefined {
  const normalized = String(key ?? "").trim().toLowerCase();
  if (!normalized) return undefined;
  return GUARDRAILS_RUNTIME_CONFIG_SPECS.find((spec) => spec.key.toLowerCase() === normalized);
}

export function validateGuardrailsRuntimeConfigValue(
  value: GuardrailsRuntimeConfigValue,
  spec: GuardrailsRuntimeConfigSpec,
): string | undefined {
  if (spec.type === "number") {
    if (!Number.isFinite(value as number) || !Number.isInteger(value as number)) {
      return `${spec.key}: value must be an integer number.`;
    }
    if (spec.min !== undefined && (value as number) < spec.min) {
      return `${spec.key}: value must be >= ${spec.min}.`;
    }
    if (spec.max !== undefined && (value as number) > spec.max) {
      return `${spec.key}: value must be <= ${spec.max}.`;
    }
    return undefined;
  }

  if (spec.type === "string") {
    const text = String(value ?? "").trim();
    if (spec.minLength !== undefined && text.length < spec.minLength) {
      return `${spec.key}: value length must be >= ${spec.minLength}.`;
    }
    if (spec.maxLength !== undefined && text.length > spec.maxLength) {
      return `${spec.key}: value length must be <= ${spec.maxLength}.`;
    }
    if (spec.pattern && !spec.pattern.test(text)) {
      return `${spec.key}: value does not match required format.`;
    }
    return undefined;
  }

  if (spec.type === "boolean" && typeof value !== "boolean") {
    return `${spec.key}: value must be boolean.`;
  }

  return undefined;
}

export function coerceGuardrailsRuntimeConfigValue(
  rawValue: string,
  spec: GuardrailsRuntimeConfigSpec,
): { ok: true; value: GuardrailsRuntimeConfigValue } | { ok: false; error: string } {
  const raw = String(rawValue ?? "").trim();

  if (spec.type === "boolean") {
    const lower = raw.toLowerCase();
    if (["true", "1", "yes", "on"].includes(lower)) {
      return { ok: true, value: true };
    }
    if (["false", "0", "no", "off"].includes(lower)) {
      return { ok: true, value: false };
    }
    return { ok: false, error: `${spec.key}: boolean expected (true|false).` };
  }

  if (spec.type === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return { ok: false, error: `${spec.key}: integer number expected.` };
    }
    const err = validateGuardrailsRuntimeConfigValue(n, spec);
    if (err) return { ok: false, error: err };
    return { ok: true, value: n };
  }

  const text = raw;
  const err = validateGuardrailsRuntimeConfigValue(text, spec);
  if (err) return { ok: false, error: err };
  return { ok: true, value: text };
}

export function readGuardrailsRuntimeConfigSnapshot(cwd: string): Record<string, GuardrailsRuntimeConfigValue> {
  const queueCfg = resolveLongRunIntentQueueConfig(cwd);
  const autonomyCfg = resolvePragmaticAutonomyConfig(cwd);
  const settings = readProjectPiSettings(cwd);
  const piStack = (settings.piStack as Record<string, unknown> | undefined) ?? {};
  const contextWatchCfg = normalizeContextWatchdogConfig(piStack.contextWatchdog);

  return {
    "longRunIntentQueue.enabled": queueCfg.enabled,
    "longRunIntentQueue.requireActiveLongRun": queueCfg.requireActiveLongRun,
    "longRunIntentQueue.maxItems": queueCfg.maxItems,
    "longRunIntentQueue.autoDrainOnIdle": queueCfg.autoDrainOnIdle,
    "longRunIntentQueue.autoDrainCooldownMs": queueCfg.autoDrainCooldownMs,
    "longRunIntentQueue.autoDrainIdleStableMs": queueCfg.autoDrainIdleStableMs,
    "longRunIntentQueue.autoDrainBatchSize": queueCfg.autoDrainBatchSize,
    "longRunIntentQueue.dispatchFailureBlockAfter": queueCfg.dispatchFailureBlockAfter,
    "longRunIntentQueue.rapidRedispatchWindowMs": queueCfg.rapidRedispatchWindowMs,
    "longRunIntentQueue.dedupeWindowMs": queueCfg.dedupeWindowMs,
    "longRunIntentQueue.identicalFailurePauseAfter": queueCfg.identicalFailurePauseAfter,
    "longRunIntentQueue.orphanFailurePauseAfter": queueCfg.orphanFailurePauseAfter,
    "longRunIntentQueue.identicalFailureWindowMs": queueCfg.identicalFailureWindowMs,
    "longRunIntentQueue.orphanFailureWindowMs": queueCfg.orphanFailureWindowMs,
    "longRunIntentQueue.forceNowPrefix": queueCfg.forceNowPrefix,
    "longRunIntentQueue.defaultBoardMilestone": queueCfg.defaultBoardMilestone ?? "(unset)",
    "pragmaticAutonomy.enabled": autonomyCfg.enabled,
    "pragmaticAutonomy.noObviousQuestions": autonomyCfg.noObviousQuestions,
    "pragmaticAutonomy.maxAuditTextChars": autonomyCfg.maxAuditTextChars,
    "contextWatchdog.enabled": contextWatchCfg.enabled,
    "contextWatchdog.status": contextWatchCfg.status,
    "contextWatchdog.notify": contextWatchCfg.notify,
    "contextWatchdog.modelSteeringFromLevel": contextWatchCfg.modelSteeringFromLevel,
    "contextWatchdog.userNotifyFromLevel": contextWatchCfg.userNotifyFromLevel,
    "contextWatchdog.cooldownMs": contextWatchCfg.cooldownMs,
    "contextWatchdog.checkpointPct": contextWatchCfg.checkpointPct ?? "(auto)",
    "contextWatchdog.compactPct": contextWatchCfg.compactPct ?? "(auto)",
    "contextWatchdog.autoCheckpoint": contextWatchCfg.autoCheckpoint,
    "contextWatchdog.autoCompact": contextWatchCfg.autoCompact,
    "contextWatchdog.autoCompactRequireIdle": contextWatchCfg.autoCompactRequireIdle,
    "contextWatchdog.autoCompactCooldownMs": contextWatchCfg.autoCompactCooldownMs,
    "contextWatchdog.autoResumeAfterCompact": contextWatchCfg.autoResumeAfterCompact,
    "contextWatchdog.autoResumeCooldownMs": contextWatchCfg.autoResumeCooldownMs,
    "contextWatchdog.handoffFreshMaxAgeMs": contextWatchCfg.handoffFreshMaxAgeMs,
  };
}

export function buildGuardrailsConfigHelpLines(): string[] {
  return [
    "guardrails-config usage:",
    "  /guardrails-config status",
    "  /guardrails-config get <key>",
    "  /guardrails-config set <key> <value>",
    "",
    "examples:",
    "  /guardrails-config get longRunIntentQueue.maxItems",
    "  /guardrails-config set longRunIntentQueue.maxItems 80",
    "  /guardrails-config set longRunIntentQueue.enabled true",
    "  /guardrails-config set longRunIntentQueue.dedupeWindowMs 120000",
    "  /guardrails-config set longRunIntentQueue.identicalFailurePauseAfter 3",
    "  /guardrails-config set longRunIntentQueue.orphanFailurePauseAfter 1",
    "  /guardrails-config set longRunIntentQueue.orphanFailureWindowMs 120000",
    "  /guardrails-config set longRunIntentQueue.defaultBoardMilestone \"MS-LOCAL\"",
    "  /guardrails-config set longRunIntentQueue.defaultBoardMilestone unset",
    "  /guardrails-config set contextWatchdog.modelSteeringFromLevel checkpoint",
    "  /guardrails-config set contextWatchdog.userNotifyFromLevel compact",
    "",
    "fallback: edit .pi/settings.json manually only for unsupported keys.",
  ];
}

function formatRuntimeConfigValue(value: unknown): string {
  if (value === undefined) return "(unset)";
  if (typeof value === "string") return `\"${value}\"`;
  return String(value);
}

export function buildGuardrailsRuntimeConfigStatus(cwd: string): string[] {
  const settings = readProjectPiSettings(cwd);
  const effective = readGuardrailsRuntimeConfigSnapshot(cwd);
  const lines: string[] = [
    "guardrails-config status",
    `settings: ${join(cwd, ".pi", "settings.json")}`,
  ];

  for (const spec of GUARDRAILS_RUNTIME_CONFIG_SPECS) {
    const configured = readValueByPath(settings, spec.path);
    const effectiveValue = effective[spec.key];
    lines.push(
      `- ${spec.key} = ${formatRuntimeConfigValue(effectiveValue)} | configured=${formatRuntimeConfigValue(configured)}`,
    );
  }

  return lines;
}

export function buildGuardrailsRuntimeConfigGetLines(cwd: string, key: string): string[] {
  const spec = resolveGuardrailsRuntimeConfigSpec(key);
  if (!spec) {
    return [
      `guardrails-config: unsupported key '${key}'.`,
      ...buildGuardrailsConfigHelpLines(),
    ];
  }

  const settings = readProjectPiSettings(cwd);
  const configured = readValueByPath(settings, spec.path);
  const effective = readGuardrailsRuntimeConfigSnapshot(cwd)[spec.key];
  return [
    `guardrails-config get ${spec.key}`,
    `type: ${spec.type}${spec.min !== undefined || spec.max !== undefined ? ` range=[${spec.min ?? "-inf"}, ${spec.max ?? "+inf"}]` : ""}`,
    `description: ${spec.description}`,
    `configured: ${formatRuntimeConfigValue(configured)}`,
    `effective: ${formatRuntimeConfigValue(effective)}`,
  ];
}

export function buildGuardrailsRuntimeConfigSetResult(params: {
  cwd: string;
  key: string;
  rawValue: string;
}): { ok: false; lines: string[] } | {
  ok: true;
  lines: string[];
  spec: GuardrailsRuntimeConfigSpec;
  oldConfigured: unknown;
  newValue: GuardrailsRuntimeConfigValue;
  settingsPath: string;
} {
  const spec = resolveGuardrailsRuntimeConfigSpec(params.key);
  if (!spec) {
    return {
      ok: false,
      lines: [
        `guardrails-config: unsupported key '${params.key}'.`,
        ...buildGuardrailsConfigHelpLines(),
      ],
    };
  }

  const rawValue = spec.key === "longRunIntentQueue.defaultBoardMilestone" && /^(unset|none|null)$/i.test(String(params.rawValue ?? "").trim()) ? "" : params.rawValue; const coerced = coerceGuardrailsRuntimeConfigValue(rawValue, spec);
  if (!coerced.ok) {
    return { ok: false, lines: [coerced.error] };
  }

  const settings = readProjectPiSettings(params.cwd);
  const oldConfigured = readValueByPath(settings, spec.path);
  writeValueByPath(settings, spec.path, coerced.value);
  const settingsPath = writeProjectPiSettings(params.cwd, settings);

  return {
    ok: true,
    lines: [
      `guardrails-config: set ${spec.key}=${formatRuntimeConfigValue(coerced.value)}.`,
      `settings: ${settingsPath}`,
      spec.reloadRequired
        ? "reload: recommended (/reload) to apply this key in the current runtime."
        : "reload: not required for this key (runtime reloaded config immediately).",
    ],
    spec,
    oldConfigured,
    newValue: coerced.value,
    settingsPath,
  };
}

export function buildPragmaticAutonomySystemPrompt(
  cfg: Pick<PragmaticAutonomyConfig, "enabled" | "noObviousQuestions">,
): string | undefined {
  if (!cfg.enabled || !cfg.noObviousQuestions) return undefined;
  return [
    "Pragmatic autonomy policy is active for this turn.",
    "- Resolve low-risk ambiguities using deterministic safe defaults.",
    "- Do not ask obvious/format/order questions when progress can continue safely.",
    "- Escalate to user only for irreversible actions, data-loss risk, security risk, or explicit objective conflict.",
    "- Keep automatic assumptions auditable through concise notes/audit entries.",
  ].join("\n");
}

export function summarizeAssumptionText(text: string, maxChars: number): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  const max = Math.max(20, Math.floor(maxChars));
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

export interface TextBloatSmellAssessment {
  triggered: boolean;
  reasons: string[];
  recommendation: string;
  metrics: {
    chars: number;
    lines: number;
    repeatedLineRatio: number;
  };
}

export interface CodeBloatSmellAssessment {
  triggered: boolean;
  reasons: string[];
  recommendation: string;
  metrics: {
    changedLines: number;
    hunks: number;
    filesTouched: number;
  };
}

export interface WideSingleFileSliceAssessment {
  triggered: boolean;
  reasons: string[];
  recommendation: string;
  metrics: {
    changedLines: number;
    hunks: number;
    filesTouched: number;
  };
}

export function evaluateTextBloatSmell(
  text: string,
  thresholds?: Partial<{ chars: number; lines: number; repeatedLineRatio: number }>,
): TextBloatSmellAssessment {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  const chars = normalized.trim().length;
  const linesRaw = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const lines = linesRaw.length;
  const uniqueCount = new Set(linesRaw.map((line) => line.toLowerCase())).size;
  const repeatedLineRatio = lines > 0 ? (lines - uniqueCount) / lines : 0;

  const charsThreshold = Math.max(200, Math.floor(Number(thresholds?.chars ?? 1200)));
  const linesThreshold = Math.max(8, Math.floor(Number(thresholds?.lines ?? 24)));
  const repeatedLineRatioThreshold = Number.isFinite(Number(thresholds?.repeatedLineRatio))
    ? Math.max(0.1, Math.min(0.9, Number(thresholds?.repeatedLineRatio ?? 0.35)))
    : 0.35;

  const reasons: string[] = [];
  if (chars >= charsThreshold) reasons.push(`high-char-count:${chars}`);
  if (lines >= linesThreshold) reasons.push(`high-line-count:${lines}`);
  if (repeatedLineRatio >= repeatedLineRatioThreshold) {
    reasons.push(`high-repetition:${repeatedLineRatio.toFixed(2)}`);
  }

  return {
    triggered: reasons.length > 0,
    reasons,
    recommendation: reasons.length > 0
      ? "text-bloat advisory: keep key claim first, trim repetition, and split into concise bullets/sections."
      : "text-bloat: healthy",
    metrics: {
      chars,
      lines,
      repeatedLineRatio,
    },
  };
}

export function evaluateCodeBloatSmell(
  metricsInput: { changedLines: number; hunks: number; filesTouched?: number },
  thresholds?: Partial<{ changedLines: number; hunks: number; filesTouched: number }>,
): CodeBloatSmellAssessment {
  const changedLines = Math.max(0, Math.floor(Number(metricsInput?.changedLines ?? 0)));
  const hunks = Math.max(0, Math.floor(Number(metricsInput?.hunks ?? 0)));
  const filesTouched = Math.max(0, Math.floor(Number(metricsInput?.filesTouched ?? 1)));

  const changedLinesThreshold = Math.max(20, Math.floor(Number(thresholds?.changedLines ?? 120)));
  const hunksThreshold = Math.max(1, Math.floor(Number(thresholds?.hunks ?? 8)));
  const filesTouchedThreshold = Math.max(1, Math.floor(Number(thresholds?.filesTouched ?? 5)));

  const reasons: string[] = [];
  if (changedLines >= changedLinesThreshold) reasons.push(`high-changed-lines:${changedLines}`);
  if (hunks >= hunksThreshold) reasons.push(`high-hunks:${hunks}`);
  if (filesTouched >= filesTouchedThreshold) reasons.push(`high-files-touched:${filesTouched}`);

  return {
    triggered: reasons.length > 0,
    reasons,
    recommendation: reasons.length > 0
      ? "code-bloat advisory: split into micro-slices; if indivisible, register explicit backlog note before continuing."
      : "code-bloat: healthy",
    metrics: {
      changedLines,
      hunks,
      filesTouched,
    },
  };
}

export function evaluateWideSingleFileSlice(
  metricsInput: { changedLines: number; hunks: number; filesTouched?: number },
  thresholds?: Partial<{ changedLines: number; hunks: number }>,
): WideSingleFileSliceAssessment {
  const changedLines = Math.max(0, Math.floor(Number(metricsInput?.changedLines ?? 0)));
  const hunks = Math.max(0, Math.floor(Number(metricsInput?.hunks ?? 0)));
  const filesTouched = Math.max(0, Math.floor(Number(metricsInput?.filesTouched ?? 1)));

  const changedLinesThreshold = Math.max(20, Math.floor(Number(thresholds?.changedLines ?? 40)));
  const hunksThreshold = Math.max(2, Math.floor(Number(thresholds?.hunks ?? 3)));

  const reasons: string[] = [];
  if (filesTouched !== 1) {
    reasons.push(`files-touched:${filesTouched}`);
  }
  if (changedLines >= changedLinesThreshold) {
    reasons.push(`wide-lines:${changedLines}`);
  }
  if (hunks >= hunksThreshold) {
    reasons.push(`wide-hunks:${hunks}`);
  }

  const triggered = filesTouched === 1 && changedLines >= changedLinesThreshold && hunks >= hunksThreshold;

  return {
    triggered,
    reasons: triggered ? reasons.filter((reason) => reason.startsWith("wide-")) : reasons,
    recommendation: triggered
      ? "slice-wide advisory: split this file change into micro-slices; if indivisible, register backlog/board note now before continuing."
      : "slice-width: healthy",
    metrics: {
      changedLines,
      hunks,
      filesTouched,
    },
  };
}

export function buildWideSingleFileSliceStatusLabel(assessment: WideSingleFileSliceAssessment): string {
  return `[slice] wide-file lines=${assessment.metrics.changedLines} hunks=${assessment.metrics.hunks}`;
}

const GUARDRAILS_CORE_SOURCE_PATH = fileURLToPath(import.meta.url);

function readGuardrailsCoreSourceMtimeMs(): number | undefined {
  try {
    return statSync(GUARDRAILS_CORE_SOURCE_PATH).mtimeMs;
  } catch {
    return undefined;
  }
}

function updateLongRunLaneStatus(
  ctx: ExtensionContext,
  activeLongRun: boolean,
  runtimeState?: LongRunLoopRuntimeState,
): void {
  const queued = getDeferredIntentQueueCount(ctx.cwd);
  const state = runtimeState ?? readLongRunLoopRuntimeState(ctx.cwd);
  if (queued <= 0 && !activeLongRun && state.mode === "running" && state.health === "healthy") {
    ctx.ui?.setStatus?.("guardrails-core-lane", undefined);
    return;
  }
  const lane = activeLongRun ? "active" : "idle";
  ctx.ui?.setStatus?.(
    "guardrails-core-lane",
    `[lane] ${lane} queued=${queued} loop=${state.mode}/${state.health}`,
  );
}

export interface LoopActivationEvidenceState {
  version: 1;
  updatedAtIso: string;
  lastLoopReady?: {
    atIso: string;
    markersLabel: string;
    runtimeCodeState: RuntimeCodeActivationState;
    boardAutoAdvanceGate: BoardAutoAdvanceGateReason;
    nextTaskId?: string;
    milestone?: string;
  };
  lastBoardAutoAdvance?: {
    atIso: string;
    taskId: string;
    milestone?: string;
    runtimeCodeState: RuntimeCodeActivationState;
    markersLabel: string;
    emLoop: boolean;
  };
}

export interface LoopEvidenceReadiness { readyForLoopEvidence: boolean; readyForTaskBud125: boolean; criteria: string[]; }

export function computeLoopEvidenceReadiness(
  evidence: LoopActivationEvidenceState,
): LoopEvidenceReadiness {
  const loopReady = evidence.lastLoopReady;
  const boardAuto = evidence.lastBoardAutoAdvance;
  const boardRuntimeActive = Boolean(boardAuto && boardAuto.runtimeCodeState === "active");
  const boardEmLoop = Boolean(boardAuto && boardAuto.emLoop);
  const loopRuntimeActive = Boolean(loopReady && loopReady.runtimeCodeState === "active");
  const criteria = [
    `boardAuto.runtime=active:${boardAuto ? (boardRuntimeActive ? "yes" : "no") : "n/a"}`,
    `boardAuto.emLoop=yes:${boardAuto ? (boardEmLoop ? "yes" : "no") : "n/a"}`,
    `loopReady.runtime=active:${loopReady ? (loopRuntimeActive ? "yes" : "no") : "n/a"}`,
  ];
  const readyForLoopEvidence = boardRuntimeActive && boardEmLoop && loopRuntimeActive;
  return { readyForLoopEvidence, readyForTaskBud125: readyForLoopEvidence, criteria };
}

export function shouldRefreshLoopEvidenceFromRuntimeSnapshot(
  runtime: Pick<LongRunLoopRuntimeState, "mode" | "health" | "stopCondition" | "leaseExpiresAtIso">,
  nowMs = Date.now(),
): boolean {
  if (runtime.mode !== "running" || runtime.health !== "healthy" || runtime.stopCondition !== "none") {
    return false;
  }
  return !isLongRunLoopLeaseExpired(runtime, nowMs);
}

function loopActivationEvidencePath(cwd: string): string {
  return join(cwd, ".pi", "guardrails-loop-evidence.json");
}

function readLoopActivationEvidence(cwd: string): LoopActivationEvidenceState {
  const p = loopActivationEvidencePath(cwd);
  if (!existsSync(p)) {
    return {
      version: 1,
      updatedAtIso: new Date(0).toISOString(),
    };
  }
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<LoopActivationEvidenceState>;
    return {
      version: 1,
      updatedAtIso: typeof raw.updatedAtIso === "string" ? raw.updatedAtIso : new Date(0).toISOString(),
      lastLoopReady: raw.lastLoopReady,
      lastBoardAutoAdvance: raw.lastBoardAutoAdvance,
    };
  } catch {
    return {
      version: 1,
      updatedAtIso: new Date(0).toISOString(),
    };
  }
}

function writeLoopActivationEvidence(cwd: string, state: LoopActivationEvidenceState): string {
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  const p = loopActivationEvidencePath(cwd);
  writeFileSync(p, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return p;
}

export function shouldAnnounceStrictInteractiveMode(
  alreadyAnnounced: boolean,
  strictMode: boolean,
): boolean {
  return strictMode && !alreadyAnnounced;
}

// =============================================================================
// Extension Entry
// =============================================================================

export default function (pi: ExtensionAPI) {
  let strictInteractiveMode = false;
  let strictInteractiveAnnounced = false;
  let shellRoutingProfile: CommandRoutingProfile = resolveCommandRoutingProfile();
  let portConflictConfig: GuardrailsPortConflictConfig = { enabled: true, suggestedTestPort: 4173 };
  let providerBudgetGovernorConfig: ProviderBudgetGovernorConfig = {
    enabled: false,
    lookbackDays: 30,
    allowOverride: true,
    overrideToken: "budget-override:",
    recoveryCommands: ["doctor", "quota-visibility", "model", "login"],
  };
  let providerBudgetSnapshotCache: { at: number; key: string; snapshot: ProviderBudgetGovernorSnapshot } | undefined;
  let providerBudgetGovernorMisconfig: ProviderBudgetGovernorMisconfig | undefined;
  let longRunIntentQueueConfig: LongRunIntentQueueConfig = DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG;
  let longRunProviderRetryConfig: LongRunProviderTransientRetryConfig =
    DEFAULT_LONG_RUN_PROVIDER_TRANSIENT_RETRY_CONFIG;
  let pragmaticAutonomyConfig: PragmaticAutonomyConfig = DEFAULT_PRAGMATIC_AUTONOMY_CONFIG;
  let i18nIntentConfig: I18nIntentConfig = DEFAULT_I18N_INTENT_CONFIG;
  let bloatSmellConfig: BloatSmellConfig = DEFAULT_BLOAT_SMELL_CONFIG;
  let lastTextBloatSignalAt = 0;
  let lastTextBloatSignalKey: string | undefined;
  let lastCodeBloatSignalAt = 0;
  let lastCodeBloatSignalKey: string | undefined;
  let lastWideSliceSignalAt = 0;
  let lastWideSliceSignalKey: string | undefined;
  let lastAutoDrainAt = 0;
  let lastAutoDrainDeferredAuditAt = 0;
  let lastAutoDrainDeferredGate: AutoDrainGateReason | undefined;
  let lastBoardAutoAdvanceTaskId: string | undefined;
  let lastBoardAutoAdvanceAt = 0;
  let lastBoardAutoAdvanceGateAuditAt = 0;
  let lastBoardAutoAdvanceGate: BoardAutoAdvanceGateReason | undefined;
  let sourceMtimeMsAtSessionStart: number | undefined;
  let lastLoopActivationAuditAt = 0;
  let lastLoopActivationLabel: string | undefined;
  let lastLoopActivationEmLoop = false;
  let lastLoopActivationReadyAt = 0;
  let lastLoopActivationReadyLabel: string | undefined;
  let lastLoopEvidenceHeartbeatAt = 0;
  let lastForceNowAt = 0;
  let lastForceNowTextPreview: string | undefined;
  let lastLoopLeaseRefreshAt = 0;
  let lastDispatchFailureFingerprint: string | undefined;
  let lastDispatchFailureAt = 0;
  let identicalDispatchFailureStreak = 0;
  let lastDispatchFailureClass: DispatchFailureClass = "other";
  let lastDispatchFailurePauseAfterUsed = 0;
  let lastDispatchFailureWindowMsUsed = 0;
  let seenToolOutputOrphanCallIds = new Set<string>();
  let lastLongRunBusyAt = Date.now();
  let autoDrainTimer: NodeJS.Timeout | undefined;
  let loopEvidenceHeartbeatTimer: NodeJS.Timeout | undefined;
  let loopLeaseHeartbeatTimer: NodeJS.Timeout | undefined;
  let longRunLoopRuntimeState: LongRunLoopRuntimeState = {
    version: 1,
    mode: "running",
    health: "healthy",
    leaseOwner: "guardrails-core:bootstrap",
    leaseTtlMs: 30_000,
    leaseHeartbeatAtIso: new Date().toISOString(),
    leaseExpiresAtIso: new Date(Date.now() + 30_000).toISOString(),
    stopCondition: "none",
    stopReason: "running",
    consecutiveDispatchFailures: 0,
    updatedAtIso: new Date().toISOString(),
    lastTransitionIso: new Date().toISOString(),
    lastTransitionReason: "init",
  };

  async function resolveProviderBudgetSnapshot(ctx: ExtensionContext): Promise<ProviderBudgetGovernorSnapshot | undefined> {
    const quota = readQuotaBudgetSettings(ctx.cwd);
    if (Object.keys(quota.providerBudgets).length === 0) return undefined;

    const key = JSON.stringify({
      lookbackDays: providerBudgetGovernorConfig.lookbackDays,
      quota,
    });

    if (providerBudgetSnapshotCache && providerBudgetSnapshotCache.key === key && Date.now() - providerBudgetSnapshotCache.at < 60_000) {
      return providerBudgetSnapshotCache.snapshot;
    }

    const status = await analyzeQuota({
      days: providerBudgetGovernorConfig.lookbackDays,
      weeklyQuotaTokens: quota.weeklyQuotaTokens,
      weeklyQuotaCostUsd: quota.weeklyQuotaCostUsd,
      weeklyQuotaRequests: quota.weeklyQuotaRequests,
      monthlyQuotaTokens: quota.monthlyQuotaTokens,
      monthlyQuotaCostUsd: quota.monthlyQuotaCostUsd,
      monthlyQuotaRequests: quota.monthlyQuotaRequests,
      providerWindowHours: {},
      providerBudgets: quota.providerBudgets,
    });

    const snapshot: ProviderBudgetGovernorSnapshot = {
      atIso: status.source.generatedAtIso,
      budgets: status.providerBudgets,
    };
    providerBudgetSnapshotCache = { at: Date.now(), key, snapshot };
    return snapshot;
  }

  function clearAutoDrainTimer(): void {
    if (!autoDrainTimer) return;
    clearTimeout(autoDrainTimer);
    autoDrainTimer = undefined;
  }

  function currentRuntimeCodeState(): RuntimeCodeActivationState {
    return resolveRuntimeCodeActivationState({
      loadedSourceMtimeMs: sourceMtimeMsAtSessionStart,
      currentSourceMtimeMs: readGuardrailsCoreSourceMtimeMs(),
      mtimeToleranceMs: 10,
    });
  }

  function recordLoopReadyEvidence(ctx: ExtensionContext, markersLabel: string, runtimeCodeState: RuntimeCodeActivationState, boardAutoAdvanceGate: BoardAutoAdvanceGateReason, nextTaskId?: string, milestone?: string): void {
    const evidence = readLoopActivationEvidence(ctx.cwd);
    evidence.updatedAtIso = new Date().toISOString();
    evidence.lastLoopReady = {
      atIso: evidence.updatedAtIso,
      markersLabel,
      runtimeCodeState,
      boardAutoAdvanceGate,
      nextTaskId,
      milestone,
    };
    writeLoopActivationEvidence(ctx.cwd, evidence);
  }

  function recordBoardAutoAdvanceEvidence(
    ctx: ExtensionContext,
    taskId: string,
    milestone: string | undefined,
    runtimeCodeState: RuntimeCodeActivationState,
    markersLabel: string,
    emLoop: boolean,
  ): void {
    const evidence = readLoopActivationEvidence(ctx.cwd);
    evidence.updatedAtIso = new Date().toISOString();
    evidence.lastBoardAutoAdvance = {
      atIso: evidence.updatedAtIso,
      taskId,
      milestone,
      runtimeCodeState,
      markersLabel,
      emLoop,
    };
    writeLoopActivationEvidence(ctx.cwd, evidence);
  }

  function refreshLoopEvidenceHeartbeat(ctx: ExtensionContext, markersLabel: string, runtimeCodeState: RuntimeCodeActivationState, boardAutoAdvanceGate: BoardAutoAdvanceGateReason, nextTaskId?: string, milestone?: string): void {
    const nowMs = Date.now();
    if (nowMs - lastLoopEvidenceHeartbeatAt < 5 * 60_000) return;
    const evidence = readLoopActivationEvidence(ctx.cwd);
    const readiness = computeLoopEvidenceReadiness(evidence);
    if (!readiness.readyForLoopEvidence || !evidence.lastLoopReady || !evidence.lastBoardAutoAdvance) return;

    const atIso = new Date(nowMs).toISOString();
    evidence.updatedAtIso = atIso;
    evidence.lastLoopReady = {
      atIso,
      markersLabel,
      runtimeCodeState,
      boardAutoAdvanceGate,
      nextTaskId,
      milestone,
    };
    writeLoopActivationEvidence(ctx.cwd, evidence);
    lastLoopEvidenceHeartbeatAt = nowMs;
    appendAuditEntry(ctx, "guardrails-core.loop-evidence-heartbeat", {
      atIso,
      markersLabel,
      runtimeCodeState,
      boardAutoAdvanceGate,
      nextTaskId,
      milestone,
    });
  }

  function refreshLoopEvidenceHeartbeatFromSnapshot(ctx: ExtensionContext): void {
    const nowMs = Date.now();
    if (nowMs - lastLoopEvidenceHeartbeatAt < 5 * 60_000) return;

    const runtime = readLongRunLoopRuntimeState(ctx.cwd);
    if (!shouldRefreshLoopEvidenceFromRuntimeSnapshot(runtime, nowMs)) return;

    const evidence = readLoopActivationEvidence(ctx.cwd);
    const readiness = computeLoopEvidenceReadiness(evidence);
    if (!readiness.readyForLoopEvidence || !evidence.lastLoopReady || !evidence.lastBoardAutoAdvance) return;

    const atIso = new Date(nowMs).toISOString();
    evidence.updatedAtIso = atIso;
    evidence.lastLoopReady = { ...evidence.lastLoopReady, atIso };
    writeLoopActivationEvidence(ctx.cwd, evidence);
    lastLoopEvidenceHeartbeatAt = nowMs;
    appendAuditEntry(ctx, "guardrails-core.loop-evidence-heartbeat", {
      atIso,
      markersLabel: evidence.lastLoopReady.markersLabel,
      runtimeCodeState: evidence.lastLoopReady.runtimeCodeState,
      boardAutoAdvanceGate: evidence.lastLoopReady.boardAutoAdvanceGate,
      nextTaskId: evidence.lastLoopReady.nextTaskId,
      milestone: evidence.lastLoopReady.milestone,
      source: "snapshot-refresh",
    });
  }

  function clearLoopEvidenceHeartbeatTimer(): void {
    if (!loopEvidenceHeartbeatTimer) return;
    clearInterval(loopEvidenceHeartbeatTimer);
    loopEvidenceHeartbeatTimer = undefined;
  }

  function ensureLoopEvidenceHeartbeatTimer(ctx: ExtensionContext): void {
    clearLoopEvidenceHeartbeatTimer();
    loopEvidenceHeartbeatTimer = setInterval(() => {
      try {
        refreshLoopEvidenceHeartbeatFromSnapshot(ctx);
      } catch {
        // best-effort heartbeat; avoid interrupting runtime
      }
    }, 60_000);
    loopEvidenceHeartbeatTimer.unref?.();
  }

  function clearLoopLeaseHeartbeatTimer(): void {
    if (!loopLeaseHeartbeatTimer) return;
    clearInterval(loopLeaseHeartbeatTimer);
    loopLeaseHeartbeatTimer = undefined;
  }

  function ensureLoopLeaseHeartbeatTimer(ctx: ExtensionContext): void {
    clearLoopLeaseHeartbeatTimer();
    loopLeaseHeartbeatTimer = setInterval(() => {
      try {
        refreshLoopLeaseOnActivity(ctx, "lease-heartbeat-timer", 5_000);
      } catch {
        // best-effort lease heartbeat; avoid interrupting runtime
      }
    }, 10_000);
    loopLeaseHeartbeatTimer.unref?.();
  }

  function scheduleAutoDrainDeferredIntent(
    ctx: ExtensionContext,
    reason: "agent_end" | "lane_pop" | "idle_timer",
    delayOverrideMs?: number,
  ): void {
    if (!longRunIntentQueueConfig.enabled || !longRunIntentQueueConfig.autoDrainOnIdle) return;
    clearAutoDrainTimer();
    const delay = delayOverrideMs !== undefined
      ? Math.max(0, Math.floor(delayOverrideMs))
      : Math.max(0, longRunIntentQueueConfig.autoDrainIdleStableMs);
    autoDrainTimer = setTimeout(() => {
      autoDrainTimer = undefined;
      tryAutoDrainDeferredIntent(ctx, reason);
    }, delay);
  }

  function setLoopMode(
    ctx: ExtensionContext,
    mode: "running" | "paused",
    reason: string,
  ): void {
    const next = setLongRunLoopRuntimeMode(ctx.cwd, mode, reason);
    longRunLoopRuntimeState = next.state;
  }

  function resetDispatchFailureTrackingState(): void {
    lastDispatchFailureFingerprint = undefined;
    lastDispatchFailureAt = 0;
    identicalDispatchFailureStreak = 0;
    lastDispatchFailureClass = "other";
    lastDispatchFailurePauseAfterUsed = 0;
    lastDispatchFailureWindowMsUsed = 0;
    seenToolOutputOrphanCallIds.clear();
  }

  function trackToolOutputOrphanCallId(errorText: string) {
    const decision = resolveToolOutputOrphanRedispatchDecision(seenToolOutputOrphanCallIds, errorText);
    if (decision.callId) seenToolOutputOrphanCallIds.add(decision.callId);
    return decision;
  }

  function markLoopHealthy(ctx: ExtensionContext, reason: string): void {
    const next = markLongRunLoopRuntimeHealthy(ctx.cwd, reason);
    longRunLoopRuntimeState = next.state;
    resetDispatchFailureTrackingState();
  }

  function markLoopDispatch(ctx: ExtensionContext, itemId: string): void {
    const next = markLongRunLoopRuntimeDispatch(ctx.cwd, itemId);
    longRunLoopRuntimeState = next.state;
    resetDispatchFailureTrackingState();
  }

  function markLoopDegraded(ctx: ExtensionContext, reason: string, errorText?: string): void {
    const next = markLongRunLoopRuntimeDegraded(ctx.cwd, reason, errorText);
    longRunLoopRuntimeState = next.state;
  }

  function trackDispatchFailureFingerprint(ctx: ExtensionContext, reason: string, errorText: string, options?: { errorClass?: DispatchFailureClass; pauseAfterOverride?: number; windowMsOverride?: number }): { fingerprint: string; streak: number; pauseTriggered: boolean; errorClass: DispatchFailureClass; pauseAfterUsed: number; windowMsUsed: number } {
    const nowMs = Date.now();
    const errorClass = options?.errorClass ?? "other";
    const pauseAfterUsed = Number.isFinite(Number(options?.pauseAfterOverride)) && Number(options?.pauseAfterOverride) > 0 ? Math.max(1, Math.floor(Number(options?.pauseAfterOverride))) : longRunIntentQueueConfig.identicalFailurePauseAfter;
    const windowMsUsed = Number.isFinite(Number(options?.windowMsOverride)) && Number(options?.windowMsOverride) >= 1_000 ? Math.max(1_000, Math.floor(Number(options?.windowMsOverride))) : longRunIntentQueueConfig.identicalFailureWindowMs;
    const next = computeIdenticalFailureStreak({
      lastFingerprint: lastDispatchFailureFingerprint,
      lastFailureAtMs: lastDispatchFailureAt,
      streak: identicalDispatchFailureStreak,
      nextErrorText: errorText,
      nowMs,
      windowMs: windowMsUsed,
    });
    lastDispatchFailureFingerprint = next.fingerprint;
    lastDispatchFailureAt = nowMs;
    identicalDispatchFailureStreak = next.streak;
    lastDispatchFailureClass = errorClass;
    lastDispatchFailurePauseAfterUsed = pauseAfterUsed;
    lastDispatchFailureWindowMsUsed = windowMsUsed;
    const pauseTriggered = longRunLoopRuntimeState.mode === "running" && shouldPauseOnIdenticalFailure(next.streak, pauseAfterUsed);
    if (pauseTriggered) {
      setLoopMode(ctx, "paused", `identical-dispatch-failure:${reason}`);
      appendAuditEntry(ctx, "guardrails-core.long-run-identical-failure-pause", {
        atIso: new Date(nowMs).toISOString(),
        reason,
        errorClass,
        streak: next.streak,
        pauseAfter: pauseAfterUsed,
        windowMs: windowMsUsed,
        fingerprint: next.fingerprint,
      });
      ctx.ui.notify(`lane-queue: loop paused after ${next.streak} falhas idênticas (${reason}; class=${errorClass}). run /lane-queue resume após correção.`, "warning");
    }
    return { fingerprint: next.fingerprint, streak: next.streak, pauseTriggered, errorClass, pauseAfterUsed, windowMsUsed };
  }

  function trackClassifiedDispatchFailure(ctx: ExtensionContext, reason: string, errorText: string) {
    const errorClass = classifyLongRunDispatchFailure(errorText);
    return trackDispatchFailureFingerprint(ctx, reason, errorText, {
      errorClass,
      pauseAfterOverride: resolveDispatchFailurePauseAfter(errorClass, longRunIntentQueueConfig.identicalFailurePauseAfter, longRunIntentQueueConfig.orphanFailurePauseAfter),
      windowMsOverride: resolveDispatchFailureWindowMs(errorClass, longRunIntentQueueConfig.identicalFailureWindowMs, longRunIntentQueueConfig.orphanFailureWindowMs),
    });
  }

  function refreshLoopLeaseOnActivity(
    ctx: ExtensionContext,
    reason: string,
    minIntervalMs = 10_000,
  ): void {
    if (longRunLoopRuntimeState.mode !== "running") return;
    const nowMs = Date.now();
    if (nowMs - lastLoopLeaseRefreshAt < Math.max(1_000, minIntervalMs)) return;
    const next = setLongRunLoopRuntimeMode(ctx.cwd, longRunLoopRuntimeState.mode, reason);
    longRunLoopRuntimeState = next.state;
    lastLoopLeaseRefreshAt = nowMs;
  }

  function tryAutoDrainDeferredIntent(ctx: ExtensionContext, reason: "agent_end" | "lane_pop" | "idle_timer"): boolean {
    const activeLongRun = !ctx.isIdle() || ctx.hasPendingMessages();
    const queuedCount = getDeferredIntentQueueCount(ctx.cwd);
    const nowMs = Date.now();
    const runtimeCodeState = currentRuntimeCodeState();
    const idleSinceMs = Math.max(0, nowMs - lastLongRunBusyAt);
    const dispatchFailureBlockAfter = resolveDispatchFailureBlockAfter(
      longRunLoopRuntimeState,
      longRunIntentQueueConfig.dispatchFailureBlockAfter,
      longRunProviderRetryConfig,
    );

    if (longRunLoopRuntimeState.mode === "paused") {
      updateLongRunLaneStatus(ctx, activeLongRun, longRunLoopRuntimeState);
      return false;
    }

    const dispatchFailureGate = resolveDispatchFailureRuntimeGate(
      longRunLoopRuntimeState,
      dispatchFailureBlockAfter,
    );
    if (dispatchFailureGate === "dispatch-failure-advisory" && queuedCount > 0) {
      if (shouldEmitAutoDrainDeferredAudit(
        lastAutoDrainDeferredAuditAt,
        lastAutoDrainDeferredGate,
        dispatchFailureGate,
        nowMs,
        Math.max(1_000, longRunIntentQueueConfig.autoDrainIdleStableMs),
      )) {
        appendAuditEntry(ctx, "guardrails-core.long-run-intent-auto-drain-advisory", {
          atIso: new Date().toISOString(),
          reason,
          gate: dispatchFailureGate,
          queuedCount,
          stopCondition: longRunLoopRuntimeState.stopCondition,
          stopReason: longRunLoopRuntimeState.stopReason,
        });
        lastAutoDrainDeferredAuditAt = nowMs;
      }
      lastAutoDrainDeferredGate = dispatchFailureGate;
    }

    const runtimeGate = resolveAutoDrainRuntimeGateReason(
      resolveAutoDrainGateReason(
        activeLongRun,
        queuedCount,
        nowMs,
        lastAutoDrainAt,
        idleSinceMs,
        longRunIntentQueueConfig,
      ),
      longRunLoopRuntimeState,
      nowMs,
    );
    const gate: AutoDrainGateReason =
      dispatchFailureGate === "dispatch-failure-blocking"
        ? "dispatch-failure-blocking"
        : runtimeGate;
    const providerRetryExhausted =
      gate === "dispatch-failure-blocking" &&
      isProviderTransientRetryExhausted(
        longRunLoopRuntimeState,
        dispatchFailureBlockAfter,
        longRunProviderRetryConfig,
      );

    if (gate === "lease-expired" || gate === "dispatch-failure-blocking") {
      if (shouldEmitAutoDrainDeferredAudit(
        lastAutoDrainDeferredAuditAt,
        lastAutoDrainDeferredGate,
        gate,
        nowMs,
        Math.max(1_000, longRunIntentQueueConfig.autoDrainIdleStableMs),
      )) {
        appendAuditEntry(ctx, "guardrails-core.long-run-intent-auto-drain-stopped", {
          atIso: new Date().toISOString(),
          reason,
          gate,
          queuedCount,
          stopCondition: longRunLoopRuntimeState.stopCondition,
          stopReason: longRunLoopRuntimeState.stopReason,
          leaseOwner: longRunLoopRuntimeState.leaseOwner,
          leaseExpiresAtIso: longRunLoopRuntimeState.leaseExpiresAtIso,
          consecutiveDispatchFailures: longRunLoopRuntimeState.consecutiveDispatchFailures,
          blockAfterFailures: dispatchFailureBlockAfter,
          providerRetryExhausted,
          actionHint: providerRetryExhausted
            ? "provider transient retry exhausted"
            : undefined,
          actionLines: providerRetryExhausted
            ? buildProviderRetryExhaustedActionLines()
            : undefined,
        });
        lastAutoDrainDeferredAuditAt = nowMs;
      }
      lastAutoDrainDeferredGate = gate;
      updateLongRunLaneStatus(ctx, activeLongRun, longRunLoopRuntimeState);
      return false;
    }

    const retryDelayMs = resolveAutoDrainRetryDelayMs(
      activeLongRun,
      queuedCount,
      nowMs,
      lastAutoDrainAt,
      idleSinceMs,
      longRunIntentQueueConfig,
    );
    if (retryDelayMs !== undefined) {
      scheduleAutoDrainDeferredIntent(ctx, "idle_timer", retryDelayMs);
      if (shouldEmitAutoDrainDeferredAudit(
        lastAutoDrainDeferredAuditAt,
        lastAutoDrainDeferredGate,
        gate,
        nowMs,
        Math.max(1_000, longRunIntentQueueConfig.autoDrainIdleStableMs),
      )) {
        appendAuditEntry(ctx, "guardrails-core.long-run-intent-auto-drain-deferred", {
          atIso: new Date().toISOString(),
          reason,
          gate,
          queuedCount,
          retryDelayMs,
        });
        lastAutoDrainDeferredAuditAt = nowMs;
      }
      lastAutoDrainDeferredGate = gate;
      updateLongRunLaneStatus(ctx, activeLongRun, longRunLoopRuntimeState);
      return false;
    }

    lastAutoDrainDeferredGate = undefined;

    const boardReadiness = evaluateBoardLongRunReadiness(ctx.cwd, { sampleLimit: 3, milestone: longRunIntentQueueConfig.defaultBoardMilestone });
    const autoAdvanceDedupeMs = Math.max(
      30_000,
      longRunIntentQueueConfig.autoDrainIdleStableMs * 4,
    );
    const boardAutoAdvanceGate = resolveBoardAutoAdvanceGateReason({
      activeLongRun,
      queuedCount,
      loopMode: longRunLoopRuntimeState.mode,
      loopHealth: longRunLoopRuntimeState.health,
      stopCondition: longRunLoopRuntimeState.stopCondition,
      boardReady: boardReadiness.ready,
      nextTaskId: boardReadiness.nextTaskId,
      nowMs,
      lastTaskId: lastBoardAutoAdvanceTaskId,
      lastTaskAtMs: lastBoardAutoAdvanceAt,
      dedupeWindowMs: autoAdvanceDedupeMs,
    });
    const boardAutoAdvanceAllowed = shouldAutoAdvanceBoardTask({
      activeLongRun,
      queuedCount,
      loopMode: longRunLoopRuntimeState.mode,
      loopHealth: longRunLoopRuntimeState.health,
      stopCondition: longRunLoopRuntimeState.stopCondition,
      boardReady: boardReadiness.ready,
      nextTaskId: boardReadiness.nextTaskId,
      nowMs,
      lastTaskId: lastBoardAutoAdvanceTaskId,
      lastTaskAtMs: lastBoardAutoAdvanceAt,
      dedupeWindowMs: autoAdvanceDedupeMs,
    });
    const loopMarkers = resolveLoopActivationMarkers({
      activeLongRun,
      queuedCount,
      loopMode: longRunLoopRuntimeState.mode,
      loopHealth: longRunLoopRuntimeState.health,
      stopCondition: longRunLoopRuntimeState.stopCondition,
      boardReady: boardReadiness.ready,
      nextTaskId: boardReadiness.nextTaskId,
      boardAutoGate: boardAutoAdvanceGate,
      runtimeCodeState,
    });
    const loopMarkersLabel = buildLoopActivationMarkersLabel(loopMarkers);
    if (shouldEmitLoopActivationAudit(
      lastLoopActivationAuditAt,
      lastLoopActivationLabel,
      loopMarkersLabel,
      nowMs,
      Math.max(1_000, longRunIntentQueueConfig.autoDrainIdleStableMs),
    )) {
      appendAuditEntry(ctx, "guardrails-core.loop-activation-state", {
        atIso: new Date().toISOString(),
        reason,
        markers: loopMarkers,
        markersLabel: loopMarkersLabel,
        runtimeCodeState,
        boardAutoAdvanceGate,
        boardReady: boardReadiness.ready,
        nextTaskId: boardReadiness.nextTaskId,
        queuedCount,
      });
      lastLoopActivationAuditAt = nowMs;
    }
    lastLoopActivationLabel = loopMarkersLabel;
    const announceLoopReady = shouldAnnounceLoopActivationReady(
      lastLoopActivationEmLoop,
      loopMarkers.emLoop,
    );
    if (announceLoopReady) {
      appendAuditEntry(ctx, "guardrails-core.loop-activation-ready", {
        atIso: new Date().toISOString(),
        reason,
        markers: loopMarkers,
        markersLabel: loopMarkersLabel,
        runtimeCodeState,
        boardAutoAdvanceGate,
        nextTaskId: boardReadiness.nextTaskId,
      });
      recordLoopReadyEvidence(
        ctx,
        loopMarkersLabel,
        runtimeCodeState,
        boardAutoAdvanceGate,
        boardReadiness.nextTaskId,
        boardReadiness.milestone,
      );
      lastLoopActivationReadyAt = nowMs;
      lastLoopActivationReadyLabel = loopMarkersLabel;
      ctx.ui.notify(`loop-ready: ${loopMarkersLabel}`, "info");
    }
    lastLoopActivationEmLoop = loopMarkers.emLoop;

    if (loopMarkers.emLoop) {
      refreshLoopEvidenceHeartbeat(
        ctx,
        loopMarkersLabel,
        runtimeCodeState,
        boardAutoAdvanceGate,
        boardReadiness.nextTaskId,
        boardReadiness.milestone,
      );
    }

    if (boardAutoAdvanceGate === "ready" && boardAutoAdvanceAllowed) {
      const nextTaskId = boardReadiness.nextTaskId ?? "";
      if (!nextTaskId) {
        appendAuditEntry(ctx, "guardrails-core.board-intent-auto-advance-blocked", {
          atIso: new Date().toISOString(),
          reason,
          boardReason: boardReadiness.reason,
          nextTaskId: boardReadiness.nextTaskId,
          selectionPolicy: boardReadiness.selectionPolicy,
          runtimeCodeState,
        });
        updateLongRunLaneStatus(ctx, activeLongRun, longRunLoopRuntimeState);
        return false;
      }

      const intent = buildBoardExecuteNextIntent(boardReadiness.milestone); const intentText = encodeGuardrailsIntent(intent);
      const intentSummary = summarizeGuardrailsIntent(intent);

      // Detect silent execution failure: same task dispatched again within the rapid
      // re-dispatch window. Happens when a compacted session leaves orphaned
      // function_call_output messages that cause pi to error on execution without
      // the dispatch itself throwing (so consecutiveDispatchFailures stays at 0).
      if (shouldBlockRapidSameTaskRedispatch({
        taskId: nextTaskId,
        lastDispatchItemId: longRunLoopRuntimeState.lastDispatchItemId,
        lastDispatchAtIso: longRunLoopRuntimeState.lastDispatchAtIso,
        nowMs,
        windowMs: longRunIntentQueueConfig.rapidRedispatchWindowMs,
      })) {
        const sinceMs = nowMs - new Date(longRunLoopRuntimeState.lastDispatchAtIso!).getTime();
        const message = `task ${nextTaskId} re-dispatched ${Math.round(sinceMs / 1000)}s after last — possible silent execution failure (orphaned function_call_output?)`;
        markLoopDegraded(ctx, `board-auto-rapid-redispatch:${nextTaskId}`, message);
        const failureTrack = trackDispatchFailureFingerprint(ctx, `board-auto-rapid-redispatch:${nextTaskId}`, message, {
          errorClass: "tool-output-orphan",
          pauseAfterOverride: resolveDispatchFailurePauseAfter("tool-output-orphan", longRunIntentQueueConfig.identicalFailurePauseAfter, longRunIntentQueueConfig.orphanFailurePauseAfter),
          windowMsOverride: resolveDispatchFailureWindowMs("tool-output-orphan", longRunIntentQueueConfig.identicalFailureWindowMs, longRunIntentQueueConfig.orphanFailureWindowMs),
        });
        appendAuditEntry(ctx, "guardrails-core.board-intent-rapid-redispatch-blocked", {
          atIso: new Date(nowMs).toISOString(),
          reason,
          taskId: nextTaskId,
          sinceLastDispatchMs: sinceMs,
          rapidRedispatchWindowMs: longRunIntentQueueConfig.rapidRedispatchWindowMs,
          consecutiveFailuresNow: longRunLoopRuntimeState.consecutiveDispatchFailures,
          errorClass: failureTrack.errorClass,
          errorFingerprint: failureTrack.fingerprint,
          identicalFailureStreak: failureTrack.streak,
          pauseAfterUsed: failureTrack.pauseAfterUsed,
          windowMsUsed: failureTrack.windowMsUsed,
          pauseTriggered: failureTrack.pauseTriggered,
          runtimeCodeState,
        });
        updateLongRunLaneStatus(ctx, activeLongRun, longRunLoopRuntimeState);
        if (!failureTrack.pauseTriggered) ctx.ui.notify(`lane-queue: rapid re-dispatch blocked for ${nextTaskId} (${Math.round(sinceMs / 1000)}s since last dispatch) — possible silent execution failure. Investigate session state then run: npm run pi:loop:resume`, "warning");
        return false;
      }

      try {
        pi.sendUserMessage(intentText, { deliverAs: "followUp" });
        appendAuditEntry(ctx, "guardrails-core.board-intent-auto-advance", {
          atIso: new Date().toISOString(),
          reason,
          taskId: nextTaskId,
          selectionPolicy: boardReadiness.selectionPolicy,
          milestone: boardReadiness.milestone,
          intentType: intent.type,
          intentVersion: intent.version,
          intentSummary,
          runtimeCodeState,
          loopMarkers,
          loopMarkersLabel,
        });
        lastBoardAutoAdvanceTaskId = nextTaskId;
        lastBoardAutoAdvanceAt = nowMs;
        lastAutoDrainAt = nowMs;
        recordBoardAutoAdvanceEvidence(
          ctx,
          nextTaskId,
          boardReadiness.milestone,
          runtimeCodeState,
          loopMarkersLabel,
          loopMarkers.emLoop,
        );
        markLoopDispatch(ctx, `board-auto-${nextTaskId}`);
        updateLongRunLaneStatus(ctx, false, longRunLoopRuntimeState);
        ctx.ui.notify(
          runtimeCodeState === "reload-required"
            ? `lane-queue: auto-advance board task ${nextTaskId} (runtimeCode=${runtimeCodeState}; considere reload para ativar código mais novo)`
            : `lane-queue: auto-advance board task ${nextTaskId}`,
          "info",
        );
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "unknown-error");
        const orphanCall = trackToolOutputOrphanCallId(message);
        const retryDiscarded = orphanCall.repeated;
        const queued = retryDiscarded
          ? { queuedCount: getDeferredIntentQueueCount(ctx.cwd), deduped: false }
          : enqueueDeferredIntent(
            ctx.cwd,
            intentText,
            "board-auto-advance-fallback",
            longRunIntentQueueConfig.maxItems,
            {
              dedupeKey: intentText,
              dedupeWindowMs: longRunIntentQueueConfig.dedupeWindowMs,
            },
          );
        markLoopDegraded(ctx, "board-auto-advance-dispatch-failed", message);
        const failureTrack = trackClassifiedDispatchFailure(ctx, "board-auto-advance-dispatch-failed", message);
        const errorClass = failureTrack.errorClass;
        if (retryDiscarded) {
          appendAuditEntry(ctx, "guardrails-core.tool-output-orphan-redispatch-discarded", {
            atIso: new Date().toISOString(),
            reason,
            source: "board-auto-advance",
            taskId: nextTaskId,
            callId: orphanCall.callId,
            errorClass,
            action: "discard-retry-before-redispatch",
          });
        }
        appendAuditEntry(ctx, "guardrails-core.board-intent-auto-advance-failed", {
          atIso: new Date().toISOString(),
          reason,
          taskId: nextTaskId,
          error: message,
          errorClass,
          errorFingerprint: failureTrack.fingerprint,
          identicalFailureStreak: failureTrack.streak,
          pauseAfterUsed: failureTrack.pauseAfterUsed,
          windowMsUsed: failureTrack.windowMsUsed,
          pauseTriggered: failureTrack.pauseTriggered,
          toolOutputOrphanCallId: orphanCall.callId,
          repeatedToolOutputOrphanCallId: orphanCall.repeated,
          retryDiscarded,
          queuedCount: queued.queuedCount,
          deduped: queued.deduped,
          selectionPolicy: boardReadiness.selectionPolicy,
          intentType: intent.type,
          intentVersion: intent.version,
          intentSummary,
          runtimeCodeState,
          loopMarkers,
          loopMarkersLabel,
        });
        if (!failureTrack.pauseTriggered) scheduleAutoDrainDeferredIntent(ctx, "idle_timer", longRunIntentQueueConfig.autoDrainIdleStableMs);
        updateLongRunLaneStatus(ctx, activeLongRun, longRunLoopRuntimeState);
        return false;
      }
    }

    if (boardAutoAdvanceGate !== "ready") {
      if (shouldEmitBoardAutoAdvanceGateAudit(
        lastBoardAutoAdvanceGateAuditAt,
        lastBoardAutoAdvanceGate,
        boardAutoAdvanceGate,
        nowMs,
        Math.max(1_000, longRunIntentQueueConfig.autoDrainIdleStableMs),
      )) {
        appendAuditEntry(ctx, "guardrails-core.board-intent-auto-advance-deferred", {
          atIso: new Date().toISOString(),
          reason,
          boardAutoAdvanceGate,
          boardReady: boardReadiness.ready,
          boardReason: boardReadiness.reason,
          queuedCount,
          nextTaskId: boardReadiness.nextTaskId,
          selectionPolicy: boardReadiness.selectionPolicy,
          runtimeCodeState,
          loopMarkers,
          loopMarkersLabel,
        });
        lastBoardAutoAdvanceGateAuditAt = nowMs;
      }
      lastBoardAutoAdvanceGate = boardAutoAdvanceGate;
    } else {
      lastBoardAutoAdvanceGate = "ready";
      lastBoardAutoAdvanceGateAuditAt = nowMs;
    }

    if (!boardReadiness.nextTaskId || !boardReadiness.ready || boardReadiness.nextTaskId !== lastBoardAutoAdvanceTaskId) {
      lastBoardAutoAdvanceTaskId = undefined;
      lastBoardAutoAdvanceAt = 0;
    }

    if (!shouldAutoDrainDeferredIntent(activeLongRun, queuedCount, nowMs, lastAutoDrainAt, idleSinceMs, longRunIntentQueueConfig)) {
      updateLongRunLaneStatus(ctx, activeLongRun, longRunLoopRuntimeState);
      return false;
    }

    const maxBatch = Math.max(1, longRunIntentQueueConfig.autoDrainBatchSize);
    let dispatched = 0;

    while (dispatched < maxBatch) {
      const popped = dequeueDeferredIntent(ctx.cwd);
      if (!popped.item) break;

      appendAuditEntry(ctx, "guardrails-core.long-run-intent-auto-pop", {
        atIso: new Date().toISOString(),
        itemId: popped.item.id,
        reason,
        queuedCount: popped.queuedCount,
        batchIndex: dispatched + 1,
        batchSize: maxBatch,
      });

      try {
        pi.sendUserMessage(popped.item.text, { deliverAs: "followUp" });
        markLoopDispatch(ctx, popped.item.id);
        dispatched += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "unknown-error");
        const orphanCall = trackToolOutputOrphanCallId(message);
        const retryDiscarded = orphanCall.repeated;
        const retryQueued = retryDiscarded
          ? { queuedCount: getDeferredIntentQueueCount(ctx.cwd), deduped: false }
          : enqueueDeferredIntent(
            ctx.cwd,
            popped.item.text,
            `auto-drain-retry:${reason}`,
            longRunIntentQueueConfig.maxItems,
            {
              dedupeKey: popped.item.text,
              dedupeWindowMs: longRunIntentQueueConfig.dedupeWindowMs,
            },
          );
        markLoopDegraded(ctx, `dispatch-failed:${reason}`, message);
        const failureTrack = trackClassifiedDispatchFailure(ctx, `dispatch-failed:${reason}`, message);
        const errorClass = failureTrack.errorClass;
        if (retryDiscarded) {
          appendAuditEntry(ctx, "guardrails-core.tool-output-orphan-redispatch-discarded", {
            atIso: new Date().toISOString(),
            reason,
            source: "auto-drain",
            itemId: popped.item.id,
            callId: orphanCall.callId,
            errorClass,
            action: "discard-retry-before-redispatch",
          });
        }
        const retryDelayMs =
          errorClass === "provider-transient" && longRunProviderRetryConfig.enabled
            ? resolveProviderTransientRetryDelayMs(
              longRunLoopRuntimeState.consecutiveDispatchFailures,
              longRunProviderRetryConfig,
            )
            : longRunIntentQueueConfig.autoDrainIdleStableMs;
        appendAuditEntry(ctx, "guardrails-core.long-run-intent-auto-dispatch-failed", {
          atIso: new Date().toISOString(),
          reason,
          itemId: popped.item.id,
          error: message,
          errorFingerprint: failureTrack.fingerprint,
          identicalFailureStreak: failureTrack.streak,
          pauseTriggered: failureTrack.pauseTriggered,
          errorClass,
          pauseAfterUsed: failureTrack.pauseAfterUsed,
          windowMsUsed: failureTrack.windowMsUsed,
          toolOutputOrphanCallId: orphanCall.callId,
          repeatedToolOutputOrphanCallId: orphanCall.repeated,
          retryDiscarded,
          retryDelayMs,
          retryQueuedCount: retryQueued.queuedCount,
          retryDeduped: retryQueued.deduped,
        });
        if (!failureTrack.pauseTriggered) scheduleAutoDrainDeferredIntent(ctx, "idle_timer", retryDelayMs);
        updateLongRunLaneStatus(ctx, activeLongRun, longRunLoopRuntimeState);
        return false;
      }

      if (!ctx.isIdle() || ctx.hasPendingMessages()) {
        break;
      }
    }

    if (dispatched <= 0) {
      updateLongRunLaneStatus(ctx, activeLongRun, longRunLoopRuntimeState);
      return false;
    }

    const remainingQueuedCount = getDeferredIntentQueueCount(ctx.cwd);
    if (shouldSchedulePostDispatchAutoDrain(dispatched, remainingQueuedCount)) {
      scheduleAutoDrainDeferredIntent(ctx, "idle_timer");
      appendAuditEntry(ctx, "guardrails-core.long-run-intent-auto-drain-backstop", {
        atIso: new Date().toISOString(),
        reason,
        dispatched,
        remainingQueuedCount,
      });
    }

    lastAutoDrainAt = nowMs;
    markLoopHealthy(ctx, "auto-drain-dispatch");
    updateLongRunLaneStatus(ctx, false, longRunLoopRuntimeState);
    ctx.ui.notify(`lane-queue: auto-dispatch ${dispatched} item(s)`, "info");
    return true;
  }

  pi.on("session_start", (_event, ctx) => {
    strictInteractiveMode = false;
    strictInteractiveAnnounced = false;
    sourceMtimeMsAtSessionStart = readGuardrailsCoreSourceMtimeMs();
    portConflictConfig = resolveGuardrailsPortConflictConfig(ctx.cwd);
    providerBudgetGovernorConfig = resolveProviderBudgetGovernorConfig(ctx.cwd);
    const quotaSettings = readQuotaBudgetSettings(ctx.cwd);
    providerBudgetGovernorMisconfig = detectProviderBudgetGovernorMisconfig(
      providerBudgetGovernorConfig.enabled,
      quotaSettings.providerBudgets,
    );
    longRunIntentQueueConfig = resolveLongRunIntentQueueConfig(ctx.cwd);
    longRunProviderRetryConfig = resolveLongRunProviderTransientRetryConfig(ctx.cwd);
    pragmaticAutonomyConfig = resolvePragmaticAutonomyConfig(ctx.cwd);
    i18nIntentConfig = resolveI18nIntentConfig(ctx.cwd);
    bloatSmellConfig = resolveBloatSmellConfig(ctx.cwd);
    shellRoutingProfile = resolveCommandRoutingProfile();
    if (providerBudgetGovernorMisconfig) {
      ctx.ui?.notify?.(
        providerBudgetGovernorMisconfigReason(providerBudgetGovernorMisconfig),
        "warning",
      );
      ctx.ui?.setStatus?.("guardrails-core-budget", "[budget] governor-misconfig");
    }
    providerBudgetSnapshotCache = undefined;
    lastAutoDrainAt = 0;
    lastAutoDrainDeferredAuditAt = 0;
    lastAutoDrainDeferredGate = undefined;
    lastBoardAutoAdvanceTaskId = undefined;
    lastBoardAutoAdvanceAt = 0;
    lastBoardAutoAdvanceGateAuditAt = 0;
    lastBoardAutoAdvanceGate = undefined;
    lastLoopActivationAuditAt = 0;
    lastLoopActivationLabel = undefined;
    lastLoopActivationEmLoop = false;
    lastLoopActivationReadyAt = 0;
    lastLoopActivationReadyLabel = undefined;
    lastTextBloatSignalAt = 0;
    lastTextBloatSignalKey = undefined;
    lastCodeBloatSignalAt = 0;
    lastCodeBloatSignalKey = undefined;
    lastWideSliceSignalAt = 0;
    lastWideSliceSignalKey = undefined;
    lastLongRunBusyAt = Date.now();
    lastLoopEvidenceHeartbeatAt = 0;
    lastForceNowAt = 0;
    lastForceNowTextPreview = undefined;
    lastLoopLeaseRefreshAt = 0;
    resetDispatchFailureTrackingState();
    clearAutoDrainTimer();
    clearLoopEvidenceHeartbeatTimer();
    clearLoopLeaseHeartbeatTimer();
    longRunLoopRuntimeState = readLongRunLoopRuntimeState(ctx.cwd);
    setLoopMode(ctx, longRunLoopRuntimeState.mode, "session-start-lease-renew");
    refreshLoopEvidenceHeartbeatFromSnapshot(ctx);
    ensureLoopEvidenceHeartbeatTimer(ctx);
    ensureLoopLeaseHeartbeatTimer(ctx);
    updateLongRunLaneStatus(ctx, false, longRunLoopRuntimeState);
    ctx.ui?.setStatus?.("guardrails-core-intent", undefined);
    ctx.ui?.setStatus?.("guardrails-core-behavior", undefined);
    ctx.ui?.setStatus?.("guardrails-core-bloat", undefined);
    ctx.ui?.setStatus?.("guardrails-core-bloat-code", undefined);
    ctx.ui?.setStatus?.("guardrails-core-slice-width", undefined);
    ctx.ui?.setStatus?.("guardrails-core-shell", buildShellRoutingStatusLabel(shellRoutingProfile));
    if (shellRoutingProfile.preferCmdForNodeFamily) {
      appendAuditEntry(ctx, "guardrails-core.shell-routing-profile", {
        atIso: new Date().toISOString(),
        profileId: shellRoutingProfile.profileId,
        platform: shellRoutingProfile.platform,
        shell: shellRoutingProfile.shell,
        preferCmdForNodeFamily: shellRoutingProfile.preferCmdForNodeFamily,
      });
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    lastLongRunBusyAt = Date.now();
    clearAutoDrainTimer();
    refreshLoopLeaseOnActivity(ctx, "agent-start-lease-heartbeat", 5_000);
    const decision = classifyRouting(event.prompt ?? "");
    strictInteractiveMode = decision.strictMode;

    const systemPromptParts: string[] = [event.systemPrompt ?? ""];
    const autonomyPrompt = buildPragmaticAutonomySystemPrompt(pragmaticAutonomyConfig);
    if (autonomyPrompt) {
      systemPromptParts.push("", autonomyPrompt);
      if (pragmaticAutonomyConfig.auditAssumptions) {
        appendAuditEntry(ctx, "guardrails-core.pragmatic-autonomy-policy", {
          atIso: new Date().toISOString(),
          noObviousQuestions: pragmaticAutonomyConfig.noObviousQuestions,
          strictInteractiveMode,
        });
      }
    }

    const i18nPrompt = buildI18nIntentSystemPrompt(i18nIntentConfig);
    if (i18nPrompt.length > 0) {
      systemPromptParts.push("", ...i18nPrompt);
      appendAuditEntry(ctx, "guardrails-core.i18n-intent-policy", {
        atIso: new Date().toISOString(),
        summary: summarizeI18nIntentConfig(i18nIntentConfig),
      });
    }

    const parsedIntent = parseGuardrailsIntent(event.prompt ?? "");
    if (parsedIntent.ok && parsedIntent.intent) {
      systemPromptParts.push("", ...buildGuardrailsIntentSystemPrompt(parsedIntent.intent));
      appendAuditEntry(ctx, "guardrails-core.intent-envelope-detected", {
        atIso: new Date().toISOString(),
        intentType: parsedIntent.intent.type,
        intentSummary: summarizeGuardrailsIntent(parsedIntent.intent),
      });
    }

    const behaviorRoute = parsedIntent.ok
      ? { kind: "none" as const }
      : classifyBehaviorRoute(event.prompt ?? "");
    const shellRoutingPrompt = buildShellRoutingSystemPrompt(shellRoutingProfile);
    if (behaviorRoute.kind === "matched" && behaviorRoute.match) {
      systemPromptParts.push("", ...buildBehaviorRouteSystemPrompt(behaviorRoute.match));
      ctx.ui?.setStatus?.(
        "guardrails-core-behavior",
        `[behavior] ${behaviorRoute.match.skill} (${behaviorRoute.match.confidence})`,
      );
      appendAuditEntry(ctx, "guardrails-core.behavior-route-selected", {
        atIso: new Date().toISOString(),
        skill: behaviorRoute.match.skill,
        confidence: behaviorRoute.match.confidence,
        score: behaviorRoute.match.score,
        reasons: behaviorRoute.match.reasons,
      });
    } else {
      ctx.ui?.setStatus?.("guardrails-core-behavior", undefined);
    }

    if (shellRoutingPrompt.length > 0) {
      systemPromptParts.push("", ...shellRoutingPrompt);
    }

    if (!strictInteractiveMode) {
      ctx.ui?.setStatus?.("guardrails-core", undefined);
      if (!autonomyPrompt && i18nPrompt.length === 0 && !parsedIntent.ok && shellRoutingPrompt.length === 0) return undefined;
      return { systemPrompt: systemPromptParts.join("\n") };
    }

    const domains = decision.domains.length > 0 ? decision.domains.join(", ") : "(none)";
    ctx.ui?.setStatus?.("guardrails-core", "[guardrails] strict_interactive=on");
    if (shouldAnnounceStrictInteractiveMode(strictInteractiveAnnounced, strictInteractiveMode)) {
      strictInteractiveAnnounced = true;
      ctx.ui?.notify?.(
        `guardrails-core: strict web mode ativo (interactive+sensitive). domains=${domains}`,
        "info"
      );
    }

    systemPromptParts.push(
      "",
      "Scoped hard routing guard (deterministic) is active for this turn.",
      "- For this task, start with web-browser CDP scripts only.",
      "- Do not use curl/wget/python-requests/r.jina.ai/npm view/registry.npmjs.org as primary path.",
      "- If CDP path fails, explain failure explicitly before proposing fallback.",
    );

    return { systemPrompt: systemPromptParts.join("\n") };
  });

  pi.on("input", async (event, ctx) => {
    const inputText = event.text ?? "";
    const activeLongRun = !ctx.isIdle() || ctx.hasPendingMessages();
    if (activeLongRun) {
      lastLongRunBusyAt = Date.now();
      clearAutoDrainTimer();
      refreshLoopLeaseOnActivity(ctx, "input-activity-lease-heartbeat", 10_000);
    }
    if (event.source === "interactive" && inputText.trim().length > 0) {
      refreshLoopLeaseOnActivity(ctx, "interactive-input-lease-heartbeat", 10_000);
    }
    updateLongRunLaneStatus(ctx, activeLongRun, longRunLoopRuntimeState);
    const maybeIntentEnvelope = inputText.trim().toLowerCase().startsWith("[intent:");
    const parsedInputIntent = parseGuardrailsIntent(inputText);
    const intentMilestone = parsedInputIntent.ok && parsedInputIntent.intent?.type === "board.execute-next"
      ? parsedInputIntent.intent.milestone
      : undefined;
    const boardReadinessForIntent = maybeIntentEnvelope
      ? evaluateBoardLongRunReadiness(ctx.cwd, { sampleLimit: 1, milestone: intentMilestone })
      : undefined;
    const intentRuntimeDecision = resolveGuardrailsIntentRuntimeDecision({
      text: inputText,
      parsed: parsedInputIntent,
      boardReady: boardReadinessForIntent?.ready,
      nextTaskId: boardReadinessForIntent?.nextTaskId,
    });
    if (intentRuntimeDecision.kind === "non-intent") {
      ctx.ui?.setStatus?.("guardrails-core-intent", undefined);
    } else if (intentRuntimeDecision.action === "reject") {
      ctx.ui?.setStatus?.("guardrails-core-intent", undefined);
      appendAuditEntry(ctx, "guardrails-core.intent-envelope-runtime-rejected", {
        atIso: new Date().toISOString(),
        reason: intentRuntimeDecision.reason,
        rawType: intentRuntimeDecision.rawType,
      });
      ctx.ui.notify(
        [
          `guardrails-core: intent envelope rejected (${intentRuntimeDecision.reason ?? "invalid-envelope"}).`,
          "Use /lane-queue board-next para emitir um envelope canônico válido.",
        ].join("\n"),
        "warning",
      );
      return { action: "handled" as const };
    } else if (parsedInputIntent.ok && parsedInputIntent.intent) {
      const intentSummary = summarizeGuardrailsIntent(parsedInputIntent.intent);
      const runtimeTaskId = intentRuntimeDecision.taskId;
      const expectedTaskId = intentRuntimeDecision.expectedTaskId;
      const scopedMilestone = intentRuntimeDecision.milestone ?? intentMilestone;
      const statusSuffix = scopedMilestone ? ` milestone=${scopedMilestone}` : "";
      const statusLine = expectedTaskId && runtimeTaskId && expectedTaskId !== runtimeTaskId
        ? `[intent] ${parsedInputIntent.intent.type} task=${runtimeTaskId} expected=${expectedTaskId}${statusSuffix}`
        : runtimeTaskId
          ? `[intent] ${parsedInputIntent.intent.type} task=${runtimeTaskId}${statusSuffix}`
          : expectedTaskId
            ? `[intent] ${parsedInputIntent.intent.type} expected=${expectedTaskId}${statusSuffix}`
            : `[intent] ${parsedInputIntent.intent.type}${statusSuffix}`;
      ctx.ui?.setStatus?.("guardrails-core-intent", statusLine);
      appendAuditEntry(ctx, "guardrails-core.intent-envelope-runtime-consumed", {
        atIso: new Date().toISOString(),
        decision: intentRuntimeDecision.kind,
        intentType: parsedInputIntent.intent.type,
        intentSummary,
        boardReady: boardReadinessForIntent?.ready,
        boardNextTaskId: boardReadinessForIntent?.nextTaskId,
        milestone: scopedMilestone,
      });

      if (intentRuntimeDecision.kind === "board-execute-board-not-ready") {
        ctx.ui.notify(
          [
            "guardrails-core: board.execute-task recebido com board não pronto.",
            `boardHint: ${boardReadinessForIntent?.recommendation ?? "decompose planned work into executable slices."}`,
          ].join("\n"),
          "warning",
        );
      } else if (intentRuntimeDecision.kind === "board-execute-next-mismatch") {
        ctx.ui.notify(
          `guardrails-core: board.execute-task task=${runtimeTaskId ?? "n/a"} difere do next=${expectedTaskId ?? "n/a"}; seguindo por override explícito.`,
          "info",
        );
      } else if (intentRuntimeDecision.kind === "board-execute-next-board-not-ready") {
        ctx.ui.notify(
          [
            `guardrails-core: board.execute-next recebido com board não pronto${scopedMilestone ? ` (milestone=${scopedMilestone})` : ""}.`,
            `boardHint: ${boardReadinessForIntent?.recommendation ?? "decompose planned work into executable slices."}`,
          ].join("\n"),
          "warning",
        );
      } else if (intentRuntimeDecision.kind === "board-execute-next-ready") {
        ctx.ui.notify(
          `guardrails-core: board.execute-next resolvido para next=${expectedTaskId ?? runtimeTaskId ?? "n/a"}${scopedMilestone ? ` (milestone=${scopedMilestone})` : ""}.`,
          "info",
        );
      }
    }
    if (event.source === "interactive") {
      const forceNowText = extractForceNowText(inputText, longRunIntentQueueConfig);
      if (forceNowText !== undefined) {
        if (!forceNowText) {
          ctx.ui.notify(
            `lane-now override vazio; use '${longRunIntentQueueConfig.forceNowPrefix}<mensagem>' para forçar processamento imediato.`,
            "warning",
          );
          return { action: "handled" as const };
        }

        const nowIso = new Date().toISOString();
        lastForceNowAt = Date.parse(nowIso);
        lastForceNowTextPreview = summarizeAssumptionText(forceNowText, pragmaticAutonomyConfig.maxAuditTextChars);

        appendAuditEntry(ctx, "guardrails-core.long-run-intent-force-now", {
          atIso: nowIso,
          activeLongRun,
          textPreview: lastForceNowTextPreview,
        });

        pi.sendUserMessage(forceNowText, { deliverAs: "followUp" });
        ctx.ui.notify(
          activeLongRun
            ? "lane-now: override aplicado; mensagem enviada como follow-up imediato."
            : "lane-now: override aplicado; mensagem enviada para processamento imediato.",
          "info",
        );
        return { action: "handled" as const };
      }
    }

    if (
      event.source === "interactive"
      && shouldQueueInputForLongRun(inputText, activeLongRun, longRunIntentQueueConfig)
    ) {
      const queueSource = parsedInputIntent.ok && parsedInputIntent.intent
        ? `intent:${parsedInputIntent.intent.type}`
        : event.source ?? "interactive";
      const queued = enqueueDeferredIntent(
        ctx.cwd,
        inputText,
        queueSource,
        longRunIntentQueueConfig.maxItems,
      );
      appendAuditEntry(ctx, "guardrails-core.long-run-intent-queued", {
        atIso: new Date().toISOString(),
        itemId: queued.itemId,
        queuedCount: queued.queuedCount,
        queuePath: queued.queuePath,
        activeLongRun,
        intentType: parsedInputIntent.ok ? parsedInputIntent.intent?.type : undefined,
        intentSummary: parsedInputIntent.ok && parsedInputIntent.intent
          ? summarizeGuardrailsIntent(parsedInputIntent.intent)
          : undefined,
      });
      if (pragmaticAutonomyConfig.enabled && pragmaticAutonomyConfig.auditAssumptions) {
        appendAuditEntry(ctx, "guardrails-core.pragmatic-assumption-applied", {
          atIso: new Date().toISOString(),
          assumption: "defer-noncritical-interrupt",
          itemId: queued.itemId,
          queuedCount: queued.queuedCount,
          activeLongRun,
          textPreview: summarizeAssumptionText(inputText, pragmaticAutonomyConfig.maxAuditTextChars),
        });
      }
      updateLongRunLaneStatus(ctx, activeLongRun, longRunLoopRuntimeState);
      ctx.ui.notify(
        [
          "Long-run ativo: solicitação registrada na fila sem trocar de foco.",
          "Assunção automática: ambiguidades de baixo risco foram deferidas sem interromper o lane atual.",
          `queued=${queued.queuedCount}`,
          `use '${longRunIntentQueueConfig.forceNowPrefix}<mensagem>' para forçar processamento imediato.`,
        ].join("\n"),
        "info",
      );
      return { action: "handled" as const };
    }

    if (!providerBudgetGovernorConfig.enabled) return { action: "continue" as const };
    if (providerBudgetGovernorMisconfig) return { action: "continue" as const };

    const cmd = normalizeCmdName(event.text ?? "");
    if (cmd && providerBudgetGovernorConfig.recoveryCommands.includes(cmd)) {
      return { action: "continue" as const };
    }

    const currentProvider = ctx.model?.provider;
    if (!currentProvider) return { action: "continue" as const };

    const snapshot = await resolveProviderBudgetSnapshot(ctx);
    const blocked = snapshot?.budgets.find((b) => b.provider === currentProvider && b.state === "blocked");
    if (!blocked) return { action: "continue" as const };

    if (providerBudgetGovernorConfig.allowOverride) {
      const reason = parseBudgetOverrideReason(event.text ?? "", providerBudgetGovernorConfig.overrideToken);
      if (reason) {
        appendAuditEntry(ctx, "guardrails-core.provider-budget-override", {
          atIso: new Date().toISOString(),
          provider: currentProvider,
          reason,
          snapshotAtIso: snapshot?.atIso,
        });
        ctx.ui.notify(`provider-budget override aceito para ${currentProvider}: ${reason}`, "warning");
        return { action: "continue" as const };
      }
    }

    appendAuditEntry(ctx, "guardrails-core.provider-budget-block", {
      atIso: new Date().toISOString(),
      provider: currentProvider,
      snapshotAtIso: snapshot?.atIso,
    });

    ctx.ui.notify(
      [
        `Bloqueado por provider-budget governor: ${currentProvider} está em BLOCK.`,
        `Use /quota-visibility budget ${currentProvider} ${providerBudgetGovernorConfig.lookbackDays}`,
        `Comandos de recovery permitidos: ${providerBudgetGovernorConfig.recoveryCommands.map((x) => `/${x}`).join(", ")}`,
        providerBudgetGovernorConfig.allowOverride
          ? `Override auditável: inclua '${providerBudgetGovernorConfig.overrideToken}<motivo>' na mensagem.`
          : "Override desativado pela policy.",
      ].join("\n"),
      "warning"
    );
    return { action: "handled" as const };
  });

  pi.on("turn_end", (event, ctx) => {
    if (!bloatSmellConfig.enabled || !bloatSmellConfig.text.enabled) {
      return;
    }
    const message = (event as unknown as { message?: unknown })?.message;
    const assistantText = extractAssistantTextFromTurnMessage(message);
    if (!assistantText) return;

    const assessment = evaluateTextBloatSmell(assistantText, {
      chars: bloatSmellConfig.text.chars,
      lines: bloatSmellConfig.text.lines,
      repeatedLineRatio: bloatSmellConfig.text.repeatedLineRatio,
    });

    if (!assessment.triggered) {
      ctx.ui?.setStatus?.("guardrails-core-bloat", undefined);
      return;
    }

    const statusLabel = buildTextBloatStatusLabel(assessment);
    ctx.ui?.setStatus?.("guardrails-core-bloat", statusLabel);

    const nowMs = Date.now();
    const signalKey = assessment.reasons.join("|");
    if (!shouldEmitBloatSmellSignal(
      lastTextBloatSignalAt,
      lastTextBloatSignalKey,
      signalKey,
      nowMs,
      bloatSmellConfig.cooldownMs,
    )) {
      return;
    }

    appendAuditEntry(ctx, "guardrails-core.bloat-smell-text", {
      atIso: new Date(nowMs).toISOString(),
      reasons: assessment.reasons,
      metrics: assessment.metrics,
      recommendation: assessment.recommendation,
      statusLabel,
    });

    if (bloatSmellConfig.notifyOnTrigger) {
      ctx.ui.notify(
        [
          statusLabel,
          assessment.recommendation,
        ].join("\n"),
        "info",
      );
    }

    lastTextBloatSignalAt = nowMs;
    lastTextBloatSignalKey = signalKey;
  });

  pi.on("before_provider_request", async (_event, ctx) => {
    if (!providerBudgetGovernorConfig.enabled) return undefined;
    if (providerBudgetGovernorMisconfig) {
      ctx.ui?.setStatus?.("guardrails-core-budget", "[budget] governor-misconfig");
      return undefined;
    }
    const currentProvider = ctx.model?.provider;
    if (!currentProvider) return undefined;
    const snapshot = await resolveProviderBudgetSnapshot(ctx);
    const blocked = snapshot?.budgets.find((b) => b.provider === currentProvider && b.state === "blocked");
    if (blocked) {
      ctx.ui?.setStatus?.("guardrails-core-budget", `[budget] ${currentProvider}=BLOCK`);
    } else {
      ctx.ui?.setStatus?.("guardrails-core-budget", undefined);
    }
    return undefined;
  });

  pi.on("tool_call", async (event, ctx) => {
    if (isToolCallEventType("read", event)) {
      return await guardReadPath(event.input.path ?? "", ctx);
    }

    if (isToolCallEventType("bash", event)) {
      const command = event.input.command ?? "";

      const shellRoutingDecision = resolveBashCommandRoutingDecision(command, shellRoutingProfile);
      if (shellRoutingDecision.action === "block") {
        appendAuditEntry(ctx, "guardrails-core.shell-routing-block", {
          atIso: new Date().toISOString(),
          profileId: shellRoutingProfile.profileId,
          shell: shellRoutingProfile.shell,
          firstToken: shellRoutingDecision.firstToken,
          commandPreview: command.slice(0, 240),
        });
        return {
          block: true,
          reason: shellRoutingDecision.reason ?? "Blocked by guardrails-core (host-shell-routing).",
        };
      }

      // Shared policy primitive for bash guardrails (same trigger semantics as monitors)
      const matchedBashPolicy = evaluateBashGuardPolicies(command);
      if (matchedBashPolicy) {
        appendAuditEntry(ctx, matchedBashPolicy.auditKey, {
          atIso: new Date().toISOString(),
          policyId: matchedBashPolicy.id,
          commandPreview: command.slice(0, 240),
        });
        return {
          block: true,
          reason: matchedBashPolicy.reason(),
        };
      }

      // Deterministic scoped web blocker
      if (strictInteractiveMode && isDisallowedBash(command)) {
        return {
          block: true,
          reason:
            "Blocked by guardrails-core (strict_interactive): use web-browser CDP scripts first for interactive sensitive-domain tasks.",
        };
      }

      // Session web port conflict guard
      const reservedPort = readReservedSessionWebPort(ctx.cwd);
      const conflictPort = portConflictConfig.enabled
        ? detectPortConflict(command, reservedPort)
        : undefined;
      if (conflictPort) {
        return {
          block: true,
          reason: `Blocked by guardrails-core (port_conflict): port ${conflictPort} is reserved by session-web. Try --port ${portConflictConfig.suggestedTestPort}.`,
        };
      }

      // Sensitive path guard for bash reads
      return await guardBashPathReads(command, ctx);
    }

    let structuredMutationToolType: "edit" | "write" | undefined;
    let structuredMutationPath: string | undefined;
    if (isToolCallEventType("edit", event)) {
      structuredMutationToolType = "edit";
      structuredMutationPath = event.input.path;
    } else if (isToolCallEventType("write", event)) {
      structuredMutationToolType = "write";
      structuredMutationPath = event.input.path;
    }

    if (structuredMutationToolType && structuredMutationPath && isUpstreamPiPackagePath(structuredMutationPath, ctx.cwd)) {
      appendAuditEntry(ctx, "guardrails-core.upstream-pi-package-mutation-block", {
        atIso: new Date().toISOString(),
        toolType: structuredMutationToolType,
        path: structuredMutationPath,
      });
      return {
        block: true,
        reason: upstreamPiPackageMutationToolReason(structuredMutationPath),
      };
    }

    if (structuredMutationToolType) {
      const structuredFirstDecision = resolveStructuredFirstMutationDecision({
        toolType: structuredMutationToolType,
        path: structuredMutationPath,
      });
      if (structuredFirstDecision.block) {
        appendAuditEntry(ctx, structuredFirstDecision.auditKey ?? "guardrails-core.structured-first-block", {
          atIso: new Date().toISOString(),
          toolType: structuredMutationToolType,
          path: structuredFirstDecision.path,
          recommendedSurface: structuredFirstDecision.recommendedSurface,
        });
        return {
          block: true,
          reason: structuredFirstDecision.reason ?? "Blocked by guardrails-core (structured-first).",
        };
      }
    }

    if (bloatSmellConfig.enabled && bloatSmellConfig.code.enabled) {
      let metrics: { changedLines: number; hunks: number; filesTouched: number } | undefined;
      let toolType = structuredMutationToolType;

      if (structuredMutationToolType === "edit") {
        metrics = estimateCodeBloatFromEditInput(event.input);
      } else if (structuredMutationToolType === "write") {
        metrics = estimateCodeBloatFromWriteInput(event.input);
      }

      if (metrics && toolType) {
        const wideSliceAssessment = evaluateWideSingleFileSlice(metrics, {
          changedLines: Math.max(20, Math.floor(bloatSmellConfig.code.changedLines * 0.4)),
          hunks: Math.max(2, Math.floor(bloatSmellConfig.code.hunks * 0.5)),
        });

        if (!wideSliceAssessment.triggered) {
          ctx.ui?.setStatus?.("guardrails-core-slice-width", undefined);
        } else {
          const wideSliceStatusLabel = buildWideSingleFileSliceStatusLabel(wideSliceAssessment);
          ctx.ui?.setStatus?.("guardrails-core-slice-width", wideSliceStatusLabel);

          const nowMs = Date.now();
          const wideSliceSignalKey = `${toolType}:${wideSliceAssessment.reasons.join("|")}`;
          if (shouldEmitBloatSmellSignal(
            lastWideSliceSignalAt,
            lastWideSliceSignalKey,
            wideSliceSignalKey,
            nowMs,
            bloatSmellConfig.cooldownMs,
          )) {
            appendAuditEntry(ctx, "guardrails-core.slice-wide-single-file", {
              atIso: new Date(nowMs).toISOString(),
              toolType,
              reasons: wideSliceAssessment.reasons,
              metrics: wideSliceAssessment.metrics,
              recommendation: wideSliceAssessment.recommendation,
              statusLabel: wideSliceStatusLabel,
            });

            if (bloatSmellConfig.notifyOnTrigger) {
              ctx.ui.notify([wideSliceStatusLabel, wideSliceAssessment.recommendation].join("\n"), "info");
            }

            lastWideSliceSignalAt = nowMs;
            lastWideSliceSignalKey = wideSliceSignalKey;
          }
        }

        const assessment = evaluateCodeBloatSmell(metrics, {
          changedLines: bloatSmellConfig.code.changedLines,
          hunks: bloatSmellConfig.code.hunks,
          filesTouched: bloatSmellConfig.code.filesTouched,
        });

        if (!assessment.triggered) {
          ctx.ui?.setStatus?.("guardrails-core-bloat-code", undefined);
          return undefined;
        }

        const statusLabel = buildCodeBloatStatusLabel(assessment);
        ctx.ui?.setStatus?.("guardrails-core-bloat-code", statusLabel);

        const nowMs = Date.now();
        const signalKey = `${toolType}:${assessment.reasons.join("|")}`;
        if (shouldEmitBloatSmellSignal(
          lastCodeBloatSignalAt,
          lastCodeBloatSignalKey,
          signalKey,
          nowMs,
          bloatSmellConfig.cooldownMs,
        )) {
          appendAuditEntry(ctx, "guardrails-core.bloat-smell-code", {
            atIso: new Date(nowMs).toISOString(),
            toolType,
            reasons: assessment.reasons,
            metrics: assessment.metrics,
            recommendation: assessment.recommendation,
            statusLabel,
          });

          if (bloatSmellConfig.notifyOnTrigger) {
            ctx.ui.notify([statusLabel, assessment.recommendation].join("\n"), "info");
          }

          lastCodeBloatSignalAt = nowMs;
          lastCodeBloatSignalKey = signalKey;
        }
      }
    }

    return undefined;
  });

  pi.registerCommand("guardrails-config", {
    description: "Operate runtime config safely (get/set) for guardrails long-run/pragmatic autonomy without manual settings edits. Usage: /guardrails-config [status|help|get <key>|set <key> <value>]",
    handler: async (args, ctx) => {
      const rawArgs = String(args ?? "").trim();
      const tokens = rawArgs.split(/\s+/).filter(Boolean);
      const sub = (tokens[0] ?? "status").toLowerCase();

      if (sub === "help") {
        ctx.ui.notify(buildGuardrailsConfigHelpLines().join("\n"), "info");
        return;
      }

      if (sub === "status") {
        ctx.ui.notify(buildGuardrailsRuntimeConfigStatus(ctx.cwd).join("\n"), "info");
        return;
      }

      if (sub === "get") {
        const key = tokens[1];
        if (!key) {
          ctx.ui.notify("guardrails-config: usage /guardrails-config get <key>", "warning");
          return;
        }
        const lines = buildGuardrailsRuntimeConfigGetLines(ctx.cwd, key);
        const isUnsupported = lines[0]?.includes("unsupported key") === true;
        ctx.ui.notify(lines.join("\n"), isUnsupported ? "warning" : "info");
        return;
      }

      if (sub === "set") {
        const key = tokens[1];
        const rawValue = tokens.slice(2).join(" ");
        if (!key || rawValue.length === 0) {
          ctx.ui.notify("guardrails-config: usage /guardrails-config set <key> <value>", "warning");
          return;
        }

        const before = readGuardrailsRuntimeConfigSnapshot(ctx.cwd);
        const result = buildGuardrailsRuntimeConfigSetResult({ cwd: ctx.cwd, key, rawValue });
        if (!result.ok) {
          ctx.ui.notify(result.lines.join("\n"), "warning");
          return;
        }

        // Re-read mutable configs so frequently tuned knobs apply now.
        longRunIntentQueueConfig = resolveLongRunIntentQueueConfig(ctx.cwd);
        pragmaticAutonomyConfig = resolvePragmaticAutonomyConfig(ctx.cwd);
        i18nIntentConfig = resolveI18nIntentConfig(ctx.cwd);

        const after = readGuardrailsRuntimeConfigSnapshot(ctx.cwd);
        appendAuditEntry(ctx, "guardrails-core.runtime-config-set", {
          atIso: new Date().toISOString(),
          actor: "operator-command",
          command: "guardrails-config set",
          key: result.spec.key,
          oldConfigured: result.oldConfigured,
          newConfigured: result.newValue,
          oldEffective: before[result.spec.key],
          newEffective: after[result.spec.key],
          settingsPath: result.settingsPath,
          reloadRecommended: result.spec.reloadRequired,
        });

        updateLongRunLaneStatus(ctx, !ctx.isIdle() || ctx.hasPendingMessages(), longRunLoopRuntimeState);

        const lines = [
          ...result.lines,
          `effective: ${formatRuntimeConfigValue(before[result.spec.key])} -> ${formatRuntimeConfigValue(after[result.spec.key])}`,
          "fallback: unsupported keys can still be edited in .pi/settings.json (manual mode).",
        ];
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      ctx.ui.notify(
        [`guardrails-config: unknown subcommand '${sub}'.`, ...buildGuardrailsConfigHelpLines()].join("\n"),
        "warning",
      );
    },
  });

  registerGuardrailsShellRouteSurface(pi, appendAuditEntry, () => shellRoutingProfile);
  registerGuardrailsDeliverySurface(pi, appendAuditEntry);
  registerGuardrailsSafeMutationSurface(pi, appendAuditEntry);
  registerGuardrailsGitMaintenanceSurface(pi);
  registerGuardrailsMacroRefactorSurface(pi, appendAuditEntry, isInsideCwd);
  registerGuardrailsMarkerCheckSurface(pi);
  registerGuardrailsRecurringFailureSurface(pi);
  registerGuardrailsStructuredIoSurface(pi, appendAuditEntry, isInsideCwd);
  registerGuardrailsStructuredInterviewSurface(pi);
  registerGuardrailsAutonomyLaneSurface(pi);
  registerGuardrailsUnattendedContinuationSurface(pi);
  registerGuardrailsUnattendedRehearsalSurface(pi);
  registerGuardrailsValidationMethodSurface(pi);
  registerGuardrailsToolHygieneSurface(pi);
  registerGuardrailsI18nLintSurface(pi);
  pi.registerCommand("lane-queue", {
    description: "Manage deferred intents that should not interrupt the current long-run lane. Usage: /lane-queue [status [--milestone <label>|-m <label>|-m=<label>|--no-milestone]|help|list|add <text>|board-next [--milestone <label>|-m <label>|-m=<label>|--no-milestone]|pop|clear|pause|resume|evidence [--milestone <label>|-m <label>|-m=<label>|--no-milestone]]",
    handler: async (args, ctx) => {
      const rawArgs = String(args ?? "").trim();
      const sub = rawArgs.toLowerCase().split(/\s+/)[0] || "status";
      const knownSubcommands = new Set(["status", "help", "list", "add", "board-next", "pop", "clear", "pause", "resume", "evidence"]);

      if (sub === "help") {
        ctx.ui.notify(buildLaneQueueHelpLines().join("\n"), "info");
        return;
      }

      if (rawArgs.length > 0 && !knownSubcommands.has(sub)) {
        ctx.ui.notify(
          [`lane-queue: unknown subcommand '${sub}'.`, ...buildLaneQueueHelpLines()].join("\n"),
          "warning",
        );
        return;
      }

      if (sub === "clear") {
        const cleared = clearDeferredIntentQueue(ctx.cwd);
        updateLongRunLaneStatus(ctx, !ctx.isIdle() || ctx.hasPendingMessages(), longRunLoopRuntimeState);
        ctx.ui.notify(`lane-queue: cleared ${cleared.cleared} item(s).`, "info");
        return;
      }

      if (sub === "pause") {
        clearAutoDrainTimer();
        setLoopMode(ctx, "paused", "manual-pause");
        updateLongRunLaneStatus(ctx, !ctx.isIdle() || ctx.hasPendingMessages(), longRunLoopRuntimeState);
        appendAuditEntry(ctx, "guardrails-core.long-run-loop-mode", {
          atIso: new Date().toISOString(),
          mode: longRunLoopRuntimeState.mode,
          health: longRunLoopRuntimeState.health,
          reason: longRunLoopRuntimeState.lastTransitionReason,
        });
        ctx.ui.notify("lane-queue: long-run loop paused (auto-drain off until resume)", "info");
        return;
      }

      if (sub === "resume") {
        setLoopMode(ctx, "running", "manual-resume");
        markLoopHealthy(ctx, "manual-resume");
        updateLongRunLaneStatus(ctx, !ctx.isIdle() || ctx.hasPendingMessages(), longRunLoopRuntimeState);
        appendAuditEntry(ctx, "guardrails-core.long-run-loop-mode", {
          atIso: new Date().toISOString(),
          mode: longRunLoopRuntimeState.mode,
          health: longRunLoopRuntimeState.health,
          reason: longRunLoopRuntimeState.lastTransitionReason,
        });
        scheduleAutoDrainDeferredIntent(ctx, "lane_pop");
        ctx.ui.notify("lane-queue: long-run loop resumed", "info");
        return;
      }

      if (sub === "add") {
        const text = parseLaneQueueAddText(rawArgs);
        if (!text) {
          ctx.ui.notify("lane-queue: usage /lane-queue add <text> (tip: /lane-queue help)", "warning");
          return;
        }

        const queued = enqueueDeferredIntent(
          ctx.cwd,
          text,
          "interactive-command",
          longRunIntentQueueConfig.maxItems,
        );
        appendAuditEntry(ctx, "guardrails-core.long-run-intent-queued", {
          atIso: new Date().toISOString(),
          itemId: queued.itemId,
          queuedCount: queued.queuedCount,
          queuePath: queued.queuePath,
          activeLongRun: !ctx.isIdle() || ctx.hasPendingMessages(),
          manual: true,
        });
        updateLongRunLaneStatus(ctx, !ctx.isIdle() || ctx.hasPendingMessages(), longRunLoopRuntimeState);
        ctx.ui.notify(`lane-queue: queued ${queued.itemId} (total=${queued.queuedCount})`, "info");
        return;
      }

      if (sub === "board-next") {
        const parsedBoardNext = parseLaneQueueMilestoneScope(rawArgs);
        if (parsedBoardNext.error) { ctx.ui.notify(`lane-queue: usage ${buildLaneQueueBoardNextUsage()}`, "warning"); return; }
        const boardNextSelection = resolveLaneQueueBoardNextMilestoneSelection(parsedBoardNext, longRunIntentQueueConfig.defaultBoardMilestone);
        const boardNextMilestone = boardNextSelection.milestone;
        const boardReadiness = evaluateBoardLongRunReadiness(ctx.cwd, { sampleLimit: 5, milestone: boardNextMilestone });
        if (!boardReadiness.ready || !boardReadiness.nextTaskId) {
          appendAuditEntry(ctx, "guardrails-core.board-intent-blocked", {
            atIso: new Date().toISOString(),
            reason: boardReadiness.reason,
            recommendation: boardReadiness.recommendation,
            blockedByDependencies: boardReadiness.blockedByDependencies,
            planned: boardReadiness.totals.planned,
            milestone: boardNextMilestone,
            milestoneSource: boardNextSelection.source,
          });
          ctx.ui.notify([
            `lane-queue: board-next blocked (${boardReadiness.reason}${boardNextMilestone ? `; milestone=${boardNextMilestone}` : ""})`,
            `boardHint: ${boardReadiness.recommendation}`,
          ].join("\n"), "warning");
          return;
        }
        const nextTaskId = boardReadiness.nextTaskId;
        const activeLongRun = !ctx.isIdle() || ctx.hasPendingMessages();
        if (activeLongRun) {
          const queuedIntent = buildBoardExecuteNextIntent(boardNextMilestone);
          const queuedText = encodeGuardrailsIntent(queuedIntent);
          const queuedSummary = summarizeGuardrailsIntent(queuedIntent);
          const queued = enqueueDeferredIntent(
            ctx.cwd,
            queuedText,
            "board-first-intent",
            longRunIntentQueueConfig.maxItems,
            {
              dedupeKey: queuedText,
              dedupeWindowMs: longRunIntentQueueConfig.dedupeWindowMs,
            },
          );
          appendAuditEntry(ctx, "guardrails-core.board-intent-queued", {
            atIso: new Date().toISOString(),
            itemId: queued.itemId,
            taskId: nextTaskId,
            queuePath: queued.queuePath,
            queuedCount: queued.queuedCount,
            selectionPolicy: boardReadiness.selectionPolicy,
            milestone: boardNextMilestone,
            milestoneSource: boardNextSelection.source,
            intentType: queuedIntent.type,
            intentVersion: queuedIntent.version,
            intentSummary: queuedSummary,
            deduped: queued.deduped,
          });
          updateLongRunLaneStatus(ctx, activeLongRun, longRunLoopRuntimeState);
          ctx.ui.notify(queued.deduped
            ? `lane-queue: board-next intent já estava na fila (next=${nextTaskId}; total=${queued.queuedCount})`
            : `lane-queue: board-next queued next=${nextTaskId} (total=${queued.queuedCount})`, "info");
          return;
        }
        const intent = buildBoardExecuteNextIntent(boardNextMilestone); const intentText = encodeGuardrailsIntent(intent); const intentSummary = summarizeGuardrailsIntent(intent);
        appendAuditEntry(ctx, "guardrails-core.board-intent-dispatch", {
          atIso: new Date().toISOString(),
          taskId: nextTaskId,
          selectionPolicy: boardReadiness.selectionPolicy,
          milestone: boardNextMilestone,
          milestoneSource: boardNextSelection.source,
          deliverAs: "followUp",
          intentType: intent.type,
          intentVersion: intent.version,
          intentSummary,
        });
        ctx.ui.notify(`lane-queue: board-next dispatch ${nextTaskId}`, "info");
        try {
          pi.sendUserMessage(intentText, { deliverAs: "followUp" });
          markLoopDispatch(ctx, `board-${nextTaskId}`);
          scheduleAutoDrainDeferredIntent(ctx, "lane_pop");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error ?? "unknown-error");
          const fallbackIntent = buildBoardExecuteNextIntent(boardNextMilestone);
          const fallbackText = encodeGuardrailsIntent(fallbackIntent);
          const fallbackSummary = summarizeGuardrailsIntent(fallbackIntent);
          const queued = enqueueDeferredIntent(
            ctx.cwd,
            fallbackText,
            "board-first-intent-fallback",
            longRunIntentQueueConfig.maxItems,
            {
              dedupeKey: fallbackText,
              dedupeWindowMs: longRunIntentQueueConfig.dedupeWindowMs,
            },
          );
          markLoopDegraded(ctx, "board-intent-dispatch-failed", message);
          const failureTrack = trackClassifiedDispatchFailure(ctx, "board-intent-dispatch-failed", message);
          const errorClass = failureTrack.errorClass;
          appendAuditEntry(ctx, "guardrails-core.board-intent-dispatch-failed", {
            atIso: new Date().toISOString(),
            taskId: nextTaskId,
            error: message,
            errorClass,
            errorFingerprint: failureTrack.fingerprint,
            identicalFailureStreak: failureTrack.streak,
            pauseAfterUsed: failureTrack.pauseAfterUsed,
            windowMsUsed: failureTrack.windowMsUsed,
            pauseTriggered: failureTrack.pauseTriggered,
            fallbackQueued: true,
            queuedCount: queued.queuedCount,
            deduped: queued.deduped,
            selectionPolicy: boardReadiness.selectionPolicy,
            milestone: boardNextMilestone,
            milestoneSource: boardNextSelection.source,
            intentType: fallbackIntent.type,
            intentVersion: fallbackIntent.version,
            intentSummary: fallbackSummary,
          });
          ctx.ui.notify(
            queued.deduped
              ? `lane-queue: board-next dispatch failed (${message}). fallback já estava em fila para next=${nextTaskId} (total=${queued.queuedCount})`
              : `lane-queue: board-next dispatch failed (${message}). fallback queued next=${nextTaskId} (total=${queued.queuedCount})`,
            "warning",
          );
        }
        return;
      }
      if (sub === "list") {
        const items = listDeferredIntents(ctx.cwd);
        if (items.length === 0) {
          ctx.ui.notify("lane-queue: empty", "info");
          return;
        }
        const lines = [
          `lane-queue: ${items.length} pending`,
          ...items.slice(-10).map((item) => `- ${item.id} ${item.atIso} :: ${item.text.slice(0, 120)}`),
        ];
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }
      if (sub === "evidence") {
        const evidenceMilestoneParsed = parseLaneQueueMilestoneScope(rawArgs);
        if (evidenceMilestoneParsed.error) { ctx.ui.notify(`lane-queue: usage ${buildLaneQueueEvidenceUsage()}`, "warning"); return; }
        const evidenceMilestoneSelection = resolveLaneQueueBoardNextMilestoneSelection(evidenceMilestoneParsed, longRunIntentQueueConfig.defaultBoardMilestone); const boardReadiness = evaluateBoardLongRunReadiness(ctx.cwd, { sampleLimit: 3, milestone: evidenceMilestoneSelection.milestone });
        const evidence = readLoopActivationEvidence(ctx.cwd);
        const loopReady = evidence.lastLoopReady; const boardAuto = evidence.lastBoardAutoAdvance;
        const readiness = computeLoopEvidenceReadiness(evidence); const milestoneParity = evaluateLaneEvidenceMilestoneParity(evidenceMilestoneSelection.milestone, boardAuto?.milestone, loopReady?.milestone);
        const lines = [
          "lane-queue: loop evidence",
          `updatedAt: ${evidence.updatedAtIso}`,
          `statusMilestone: ${evidenceMilestoneSelection.milestone ?? "n/a"}@${evidenceMilestoneSelection.source}`,
          `boardReadiness: ${buildBoardReadinessStatusLabel(boardReadiness)}`,
          `readyForLoopEvidence: ${readiness.readyForLoopEvidence ? "yes" : "no"}`,
          `readyForTaskBud125(deprecated): ${readiness.readyForTaskBud125 ? "yes" : "no"}`,
          `scopeParity: expected=${milestoneParity.expectedMilestone ?? "n/a"} boardAuto=${milestoneParity.boardAutoMilestone ?? "n/a"} loopReady=${milestoneParity.loopReadyMilestone ?? "n/a"} matches=${milestoneParity.matches ? "yes" : "no"} reason=${milestoneParity.reason}`,
          boardAuto
            ? `boardAuto: task=${boardAuto.taskId}${boardAuto.milestone ? ` milestone=${boardAuto.milestone}` : ""} at=${boardAuto.atIso} runtime=${boardAuto.runtimeCodeState} emLoop=${boardAuto.emLoop ? "yes" : "no"}`
            : "boardAuto: n/a",
          loopReady
            ? `loopReady: at=${loopReady.atIso}${loopReady.milestone ? ` milestone=${loopReady.milestone}` : ""} runtime=${loopReady.runtimeCodeState} gate=${loopReady.boardAutoAdvanceGate} next=${loopReady.nextTaskId ?? "n/a"}`
            : "loopReady: n/a",
          `criteria: ${readiness.criteria.join(" | ")}`,
          ...(boardReadiness.ready ? [] : [`boardHint: ${boardReadiness.recommendation}`]),
        ];
        appendAuditEntry(ctx, "guardrails-core.loop-evidence-status", {
          atIso: new Date().toISOString(),
          readyForLoopEvidence: readiness.readyForLoopEvidence,
          readyForTaskBud125: readiness.readyForTaskBud125,
          statusMilestone: evidenceMilestoneSelection.milestone,
          statusMilestoneSource: evidenceMilestoneSelection.source,
          boardReadiness,
          milestoneParity,
          boardAuto,
          loopReady,
          criteria: readiness.criteria,
        });
        ctx.ui.notify(lines.join("\n"), shouldWarnLaneEvidence(readiness.readyForLoopEvidence, milestoneParity) ? "warning" : "info");
        return;
      }

      if (sub === "pop") {
        const activeLongRun = !ctx.isIdle() || ctx.hasPendingMessages();
        if (activeLongRun) {
          ctx.ui.notify("lane-queue: long-run still active; pop blocked to avoid focus drift.", "warning");
          return;
        }
        const popped = dequeueDeferredIntent(ctx.cwd);
        updateLongRunLaneStatus(ctx, false, longRunLoopRuntimeState);
        if (!popped.item) {
          ctx.ui.notify("lane-queue: empty", "info");
          return;
        }
        appendAuditEntry(ctx, "guardrails-core.long-run-intent-pop", {
          atIso: new Date().toISOString(),
          itemId: popped.item.id,
          queuedCount: popped.queuedCount,
        });
        ctx.ui.notify(`lane-queue: dispatching ${popped.item.id}`, "info");
        pi.sendUserMessage(popped.item.text, { deliverAs: "followUp" });
        markLoopDispatch(ctx, popped.item.id);
        scheduleAutoDrainDeferredIntent(ctx, "lane_pop");
        return;
      }

      const activeLongRun = !ctx.isIdle() || ctx.hasPendingMessages();
      if (activeLongRun) {
        refreshLoopLeaseOnActivity(ctx, "lane-status-lease-heartbeat", 10_000);
      }
      const items = listDeferredIntents(ctx.cwd);
      const queued = items.length;
      const nowMs = Date.now();
      const idleSinceMs = Math.max(0, nowMs - lastLongRunBusyAt);
      const dispatchFailureBlockAfter = resolveDispatchFailureBlockAfter(
        longRunLoopRuntimeState,
        longRunIntentQueueConfig.dispatchFailureBlockAfter,
        longRunProviderRetryConfig,
      );
      const stopBoundary = resolveLongRunLoopStopBoundary(
        longRunLoopRuntimeState,
        dispatchFailureBlockAfter,
      );
      const dispatchFailureGate = resolveDispatchFailureRuntimeGate(
        longRunLoopRuntimeState,
        dispatchFailureBlockAfter,
      );
      const runtimeGate = resolveAutoDrainRuntimeGateReason(
        resolveAutoDrainGateReason(
          activeLongRun,
          queued,
          nowMs,
          lastAutoDrainAt,
          idleSinceMs,
          longRunIntentQueueConfig,
        ),
        longRunLoopRuntimeState,
        nowMs,
      );
      const gate: AutoDrainGateReason =
        dispatchFailureGate === "dispatch-failure-blocking"
          ? "dispatch-failure-blocking"
          : runtimeGate;
      const providerRetryExhausted =
        gate === "dispatch-failure-blocking" &&
        isProviderTransientRetryExhausted(
          longRunLoopRuntimeState,
          dispatchFailureBlockAfter,
          longRunProviderRetryConfig,
        );
      const waitMs = estimateAutoDrainWaitMs(
        activeLongRun,
        queued,
        nowMs,
        lastAutoDrainAt,
        idleSinceMs,
        longRunIntentQueueConfig,
      );
      const oldestAgeMs = oldestDeferredIntentAgeMs(items, nowMs);
      const nextDrain = gate === "lease-expired"
        ? "stopped:lease-expired"
        : gate === "dispatch-failure-blocking"
          ? providerRetryExhausted
            ? "stopped:retry-exhausted"
            : "stopped:dispatch-failure"
          : activeLongRun
          ? "after-idle"
          : waitMs === undefined
            ? "n/a"
            : waitMs === 0
              ? "now"
              : `${Math.ceil(waitMs / 1000)}s`;
      const oldest = oldestAgeMs === undefined ? "n/a" : `${Math.ceil(oldestAgeMs / 1000)}s`;
      const loopError = longRunLoopRuntimeState.lastError
        ? ` lastError=${longRunLoopRuntimeState.lastError.slice(0, 120)}`
        : "";
      const providerRetryPolicy = longRunProviderRetryConfig.enabled
        ? `${longRunProviderRetryConfig.maxAttempts}x@${Math.ceil(longRunProviderRetryConfig.baseDelayMs / 1000)}s→${Math.ceil(longRunProviderRetryConfig.maxDelayMs / 1000)}s`
        : "off";
      const statusMilestoneParsed = parseLaneQueueMilestoneScope(rawArgs);
      if (statusMilestoneParsed.error) { ctx.ui.notify(`lane-queue: usage ${buildLaneQueueStatusUsage()}`, "warning"); return; }
      const statusMilestoneSelection = resolveLaneQueueBoardNextMilestoneSelection(statusMilestoneParsed, longRunIntentQueueConfig.defaultBoardMilestone); const boardReadiness = evaluateBoardLongRunReadiness(ctx.cwd, { sampleLimit: 3, milestone: statusMilestoneSelection.milestone });
      const boardReadinessLabel = buildBoardReadinessStatusLabel(boardReadiness);
      const autoAdvanceDedupeMs = Math.max(30_000, longRunIntentQueueConfig.autoDrainIdleStableMs * 4);
      const boardAutoGate = resolveBoardAutoAdvanceGateReason({
        activeLongRun,
        queuedCount: queued,
        loopMode: longRunLoopRuntimeState.mode,
        loopHealth: longRunLoopRuntimeState.health,
        stopCondition: longRunLoopRuntimeState.stopCondition,
        boardReady: boardReadiness.ready,
        nextTaskId: boardReadiness.nextTaskId,
        nowMs,
        lastTaskId: lastBoardAutoAdvanceTaskId,
        lastTaskAtMs: lastBoardAutoAdvanceAt,
        dedupeWindowMs: autoAdvanceDedupeMs,
      });
      const boardAutoLast = lastBoardAutoAdvanceTaskId
        ? `${lastBoardAutoAdvanceTaskId}@${Math.max(0, Math.ceil((nowMs - lastBoardAutoAdvanceAt) / 1000))}s`
        : "n/a";
      const laneNowLast = lastForceNowAt > 0
        ? `${Math.max(0, Math.ceil((nowMs - lastForceNowAt) / 1000))}s${lastForceNowTextPreview ? ` text='${lastForceNowTextPreview}'` : ""}`
        : "n/a";
      const runtimeCodeState: RuntimeCodeActivationState = currentRuntimeCodeState();
      const loopEvidence = readLoopActivationEvidence(ctx.cwd);
      const loopMarkers = resolveLoopActivationMarkers({
        activeLongRun,
        queuedCount: queued,
        loopMode: longRunLoopRuntimeState.mode,
        loopHealth: longRunLoopRuntimeState.health,
        stopCondition: longRunLoopRuntimeState.stopCondition,
        boardReady: boardReadiness.ready,
        nextTaskId: boardReadiness.nextTaskId,
        boardAutoGate,
        runtimeCodeState,
      });
      const loopMarkersLabel = buildLoopActivationMarkersLabel(loopMarkers);
      const loopBlockerHint = buildLoopActivationBlockerHint(loopMarkers);
      const loopReadyLast = lastLoopActivationReadyAt > 0
        ? `${Math.max(0, Math.ceil((nowMs - lastLoopActivationReadyAt) / 1000))}s`
        : "n/a";
      const evidenceBoardAuto = loopEvidence.lastBoardAutoAdvance;
      const evidenceBoardAutoAge = evidenceBoardAuto
        ? `${Math.max(0, Math.ceil((nowMs - Date.parse(evidenceBoardAuto.atIso)) / 1000))}s`
        : "n/a";
      const evidenceBoardAutoSummary = evidenceBoardAuto
        ? `${evidenceBoardAuto.taskId}${evidenceBoardAuto.milestone ? `[${evidenceBoardAuto.milestone}]` : ""}@${evidenceBoardAutoAge} runtime=${evidenceBoardAuto.runtimeCodeState} emLoop=${evidenceBoardAuto.emLoop ? "yes" : "no"}`
        : "n/a";
      const evidenceLoopReady = loopEvidence.lastLoopReady;
      const evidenceLoopReadyAge = evidenceLoopReady
        ? `${Math.max(0, Math.ceil((nowMs - Date.parse(evidenceLoopReady.atIso)) / 1000))}s`
        : "n/a";
      const evidenceLoopReadySummary = evidenceLoopReady
        ? `${evidenceLoopReadyAge}${evidenceLoopReady.milestone ? ` milestone=${evidenceLoopReady.milestone}` : ""} runtime=${evidenceLoopReady.runtimeCodeState} gate=${evidenceLoopReady.boardAutoAdvanceGate}`
        : "n/a";
      const failSignature = !lastDispatchFailureFingerprint ? "n/a" : lastDispatchFailureFingerprint.length > 72 ? `${lastDispatchFailureFingerprint.slice(0, 72)}…` : lastDispatchFailureFingerprint;
      const failClass = lastDispatchFailureFingerprint ? lastDispatchFailureClass : "n/a";
      const failPolicy = lastDispatchFailureFingerprint && lastDispatchFailurePauseAfterUsed > 0 && lastDispatchFailureWindowMsUsed > 0
        ? `${lastDispatchFailurePauseAfterUsed}@${lastDispatchFailureWindowMsUsed}ms`
        : "n/a";

      ctx.ui.notify(
        [
          `lane-queue: ${activeLongRun ? "active" : "idle"} queued=${queued} oldest=${oldest} autoDrain=${longRunIntentQueueConfig.autoDrainOnIdle ? "on" : "off"} batch=${longRunIntentQueueConfig.autoDrainBatchSize} cooldownMs=${longRunIntentQueueConfig.autoDrainCooldownMs} idleStableMs=${longRunIntentQueueConfig.autoDrainIdleStableMs} rapidWindowMs=${longRunIntentQueueConfig.rapidRedispatchWindowMs} dedupeWindowMs=${longRunIntentQueueConfig.dedupeWindowMs} defaultMilestone=${longRunIntentQueueConfig.defaultBoardMilestone ?? "n/a"} statusMilestone=${statusMilestoneSelection.milestone ?? "n/a"}@${statusMilestoneSelection.source} gate=${gate} nextDrain=${nextDrain} stop=${longRunLoopRuntimeState.stopCondition}/${stopBoundary} failStreak=${longRunLoopRuntimeState.consecutiveDispatchFailures}/${dispatchFailureBlockAfter} identicalFail=${identicalDispatchFailureStreak}/${longRunIntentQueueConfig.identicalFailurePauseAfter}@${longRunIntentQueueConfig.identicalFailureWindowMs}ms orphanPauseAfter=${longRunIntentQueueConfig.orphanFailurePauseAfter}@${longRunIntentQueueConfig.orphanFailureWindowMs}ms failClass=${failClass} failPolicy=${failPolicy} failSig=${failSignature} providerRetry=${providerRetryPolicy} runtimeCode=${runtimeCodeState} ${boardReadinessLabel} boardAutoGate=${boardAutoGate} boardAutoLast=${boardAutoLast} laneNowLast=${laneNowLast} loopReadyLast=${loopReadyLast} evidenceBoardAuto=${evidenceBoardAutoSummary} evidenceLoopReady=${evidenceLoopReadySummary} ${loopMarkersLabel} loop=${longRunLoopRuntimeState.mode}/${longRunLoopRuntimeState.health} transition=${longRunLoopRuntimeState.lastTransitionReason}${loopError}`,
          ...(boardReadiness.ready ? [] : [`boardHint: ${boardReadiness.recommendation}`]),
          ...(boardReadiness.ready && boardReadiness.eligibleTaskIds.length > 0
            ? [`boardNext: ${boardReadiness.eligibleTaskIds.join(", ")}`]
            : []),
          ...(providerRetryExhausted ? buildProviderRetryExhaustedActionLines() : []),
          ...(lastDispatchFailureClass === "tool-output-orphan" ? buildToolOutputOrphanRecoveryActionLines() : []),
          ...(runtimeCodeState === "reload-required"
            ? ["runtimeCodeHint: local guardrails-core mudou após session_start; faça reload para ativar tudo aqui no control plane."]
            : []),
          ...(loopBlockerHint ? [loopBlockerHint] : []),
          ...(lastLoopActivationReadyLabel ? [`loopReadyLabel: ${lastLoopActivationReadyLabel}`] : []),
          ...buildLaneQueueStatusTips(queued),
        ].join("\n"),
        "info",
      );
    },
  });

  pi.on("agent_end", (_event, ctx) => {
    if (strictInteractiveMode) {
      strictInteractiveMode = false;
      ctx.ui?.setStatus?.("guardrails-core", undefined);
    }
    ctx.ui?.setStatus?.("guardrails-core-budget", undefined);
    ctx.ui?.setStatus?.("guardrails-core-intent", undefined);
    ctx.ui?.setStatus?.("guardrails-core-behavior", undefined);
    ctx.ui?.setStatus?.("guardrails-core-bloat", undefined);
    ctx.ui?.setStatus?.("guardrails-core-bloat-code", undefined);
    ctx.ui?.setStatus?.("guardrails-core-slice-width", undefined);
    lastLongRunBusyAt = Date.now();
    scheduleAutoDrainDeferredIntent(ctx, "agent_end");
    updateLongRunLaneStatus(ctx, false, longRunLoopRuntimeState);
  });
}
