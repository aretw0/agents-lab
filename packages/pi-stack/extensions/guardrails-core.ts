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
  buildWideSingleFileSliceStatusLabel,
  evaluateCodeBloatSmell,
  evaluateTextBloatSmell,
  evaluateWideSingleFileSlice,
  summarizeAssumptionText,
  type BloatSmellConfig,
} from "./guardrails-core-bloat";
export {
  buildWideSingleFileSliceStatusLabel,
  evaluateCodeBloatSmell,
  evaluateTextBloatSmell,
  evaluateWideSingleFileSlice,
  summarizeAssumptionText,
} from "./guardrails-core-bloat";
export type {
  CodeBloatSmellAssessment,
  TextBloatSmellAssessment,
  WideSingleFileSliceAssessment,
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
import {
  computeLoopEvidenceReadiness,
  readLoopActivationEvidence,
  shouldRefreshLoopEvidenceFromRuntimeSnapshot,
  writeLoopActivationEvidence,
  type LoopActivationEvidenceState,
  type LoopEvidenceReadiness,
} from "./guardrails-core-lane-queue-evidence";
import {
  recordBoardAutoAdvanceEvidence as recordBoardAutoAdvanceEvidenceHelper,
  recordLoopReadyEvidence as recordLoopReadyEvidenceHelper,
  refreshLoopEvidenceHeartbeat as refreshLoopEvidenceHeartbeatHelper,
  refreshLoopEvidenceHeartbeatFromSnapshot as refreshLoopEvidenceHeartbeatFromSnapshotHelper,
  refreshLoopLeaseOnActivity as refreshLoopLeaseOnActivityHelper,
} from "./guardrails-core-lane-queue-heartbeat";
import {
  registerGuardrailsLaneQueueSurface,
  type GuardrailsLaneQueueSurfaceRuntimeSnapshot,
} from "./guardrails-core-lane-queue-surface";
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
import { registerGuardrailsGrowthMaturitySurface } from "./guardrails-core-growth-maturity-surface";
import { registerGuardrailsAgentSpawnReadinessSurface } from "./guardrails-core-agent-spawn-readiness-surface";
import { registerGuardrailsOpsCalibrationSurface } from "./guardrails-core-ops-calibration-surface";
import { registerGuardrailsShellSpoofingScoreSurface } from "./guardrails-core-shell-spoofing-score-surface";
import { registerGuardrailsI18nLintSurface } from "./guardrails-core-i18n-lint-surface";
import { registerGuardrailsBackgroundProcessSurface } from "./guardrails-core-background-process-surface";
import { registerGuardrailsHumanConfirmationSurface } from "./guardrails-core-human-confirmation-surface";
import { normalizeContextWatchdogConfig } from "./context-watchdog-config";
import { readProjectSettings as readProjectSettingsImpl, writeProjectSettings as writeProjectSettingsImpl } from "./context-watchdog-storage";
import { ALLOWED_OUTSIDE, SENSITIVE_PATHS, UPSTREAM_PI_PACKAGE_MUTATION_BLOCKLIST } from "./guardrails-core-path-guard-config";
import { resolveStructuredFirstMutationDecision } from "./guardrails-core-structured-first";
import { resolveTrustedGlobalSkillReadAccess } from "./guardrails-core-skill-access-policy";
import { evaluateBashGuardPolicies } from "./guardrails-core-bash-guard-policies";
import { recordTrustedHumanConfirmationUiDecision, type HumanConfirmationActionFingerprint } from "./guardrails-core-human-confirmation";
import {
  classifyRouting,
  detectPortConflict,
  isDisallowedBash,
  readReservedSessionWebPort,
  resolveGuardrailsPortConflictConfig,
  type GuardrailsPortConflictConfig,
} from "./guardrails-core-web-routing";
export * from "./guardrails-core-exports";
export {
  computeLoopEvidenceReadiness,
  shouldRefreshLoopEvidenceFromRuntimeSnapshot,
  type LoopActivationEvidenceState,
  type LoopEvidenceReadiness,
} from "./guardrails-core-lane-queue-evidence";

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
    appendTrustedUiConfirmationEvidence(ctx, {
      actionKind: "protected",
      toolName: "read",
      path: filePath,
      scope: "sensitive-path-read",
    }, ok);
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
    appendTrustedUiConfirmationEvidence(ctx, {
      actionKind: "protected",
      toolName: "read",
      path: filePath,
      scope: "outside-project-read",
    }, ok);
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
      appendTrustedUiConfirmationEvidence(ctx, {
        actionKind: "protected",
        toolName: "bash",
        path: filePath,
        scope: "sensitive-path-read",
        payloadHash: `command:${command.slice(0, 160)}`,
      }, ok);
      if (!ok) return { block: true, reason: `Bloqueado pelo usuário: ${filePath}` };
    }
  }

  return undefined;
}

// =============================================================================
// Deterministic Web Routing Guard
// =============================================================================

export {
  classifyRouting,
  detectPortConflict,
  extractDomains,
  extractExplicitPorts,
  hasInteractiveIntent,
  isDisallowedBash,
  looksLikeServerStartCommand,
  readReservedSessionWebPort,
  resolveGuardrailsPortConflictConfig,
} from "./guardrails-core-web-routing";

export type {
  GuardrailsPortConflictConfig,
  RoutingDecision,
} from "./guardrails-core-web-routing";

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

function appendTrustedUiConfirmationEvidence(
  ctx: ExtensionContext,
  fingerprint: HumanConfirmationActionFingerprint,
  confirmed: boolean,
): void {
  const result = recordTrustedHumanConfirmationUiDecision({
    ...fingerprint,
    confirmed,
    nowIso: new Date().toISOString(),
  });
  appendAuditEntry(ctx, "guardrails-core.human-confirmation-ui-decision", {
    atIso: new Date().toISOString(),
    decision: result.decision,
    reasons: result.reasons,
    dispatchAllowed: result.dispatchAllowed,
    canOverrideMonitorBlock: result.canOverrideMonitorBlock,
    authorization: result.authorization,
    evidence: result.envelope?.details,
  });
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

import {
  buildGuardrailsRuntimeConfigGetLines,
  buildGuardrailsRuntimeConfigSetResult,
  buildGuardrailsRuntimeConfigStatus,
  buildPragmaticAutonomySystemPrompt,
  DEFAULT_PRAGMATIC_AUTONOMY_CONFIG,
  readGuardrailsRuntimeConfigSnapshot,
  resolvePragmaticAutonomyConfig,
  type PragmaticAutonomyConfig,
} from "./guardrails-core-runtime-config";

export {
  buildGuardrailsConfigHelpLines,
  buildGuardrailsRuntimeConfigGetLines,
  buildGuardrailsRuntimeConfigSetResult,
  buildGuardrailsRuntimeConfigStatus,
  buildPragmaticAutonomySystemPrompt,
  coerceGuardrailsRuntimeConfigValue,
  DEFAULT_PRAGMATIC_AUTONOMY_CONFIG,
  GUARDRAILS_RUNTIME_CONFIG_SPECS,
  readGuardrailsRuntimeConfigSnapshot,
  resolveGuardrailsRuntimeConfigSpec,
  resolvePragmaticAutonomyConfig,
  validateGuardrailsRuntimeConfigValue,
} from "./guardrails-core-runtime-config";

export type {
  GuardrailsRuntimeConfigSpec,
  GuardrailsRuntimeConfigValue,
  PragmaticAutonomyConfig,
} from "./guardrails-core-runtime-config";

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
    recordLoopReadyEvidenceHelper({
      cwd: ctx.cwd,
      markersLabel,
      runtimeCodeState,
      boardAutoAdvanceGate,
      nextTaskId,
      milestone,
      readEvidence: readLoopActivationEvidence,
      writeEvidence: writeLoopActivationEvidence,
    });
  }

  function recordBoardAutoAdvanceEvidence(
    ctx: ExtensionContext,
    taskId: string,
    milestone: string | undefined,
    runtimeCodeState: RuntimeCodeActivationState,
    markersLabel: string,
    emLoop: boolean,
  ): void {
    recordBoardAutoAdvanceEvidenceHelper({
      cwd: ctx.cwd,
      taskId,
      milestone,
      runtimeCodeState,
      markersLabel,
      emLoop,
      readEvidence: readLoopActivationEvidence,
      writeEvidence: writeLoopActivationEvidence,
    });
  }

  function refreshLoopEvidenceHeartbeat(ctx: ExtensionContext, markersLabel: string, runtimeCodeState: RuntimeCodeActivationState, boardAutoAdvanceGate: BoardAutoAdvanceGateReason, nextTaskId?: string, milestone?: string): void {
    const nowMs = Date.now();
    const refresh = refreshLoopEvidenceHeartbeatHelper({
      cwd: ctx.cwd,
      nowMs,
      lastHeartbeatAt: lastLoopEvidenceHeartbeatAt,
      heartbeatIntervalMs: 5 * 60_000,
      markersLabel,
      runtimeCodeState,
      boardAutoAdvanceGate,
      nextTaskId,
      milestone,
      readEvidence: readLoopActivationEvidence,
      computeReadiness: computeLoopEvidenceReadiness,
      writeEvidence: writeLoopActivationEvidence,
    });
    if (!refresh.updated || !refresh.auditPayload) return;
    lastLoopEvidenceHeartbeatAt = refresh.nextLastHeartbeatAt;
    appendAuditEntry(ctx, "guardrails-core.loop-evidence-heartbeat", refresh.auditPayload);
  }

  function refreshLoopEvidenceHeartbeatFromSnapshot(ctx: ExtensionContext): void {
    const nowMs = Date.now();
    const refresh = refreshLoopEvidenceHeartbeatFromSnapshotHelper({
      cwd: ctx.cwd,
      nowMs,
      lastHeartbeatAt: lastLoopEvidenceHeartbeatAt,
      heartbeatIntervalMs: 5 * 60_000,
      readRuntime: readLongRunLoopRuntimeState,
      shouldRefreshRuntime: shouldRefreshLoopEvidenceFromRuntimeSnapshot,
      readEvidence: readLoopActivationEvidence,
      computeReadiness: computeLoopEvidenceReadiness,
      writeEvidence: writeLoopActivationEvidence,
    });
    if (!refresh.updated || !refresh.auditPayload) return;
    lastLoopEvidenceHeartbeatAt = refresh.nextLastHeartbeatAt;
    appendAuditEntry(ctx, "guardrails-core.loop-evidence-heartbeat", refresh.auditPayload);
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
    const refresh = refreshLoopLeaseOnActivityHelper({
      cwd: ctx.cwd,
      nowMs: Date.now(),
      lastLeaseRefreshAt: lastLoopLeaseRefreshAt,
      minIntervalMs,
      mode: longRunLoopRuntimeState.mode,
      reason,
      setRuntimeMode: setLongRunLoopRuntimeMode,
    });
    if (!refresh.updated || !refresh.nextState) return;
    longRunLoopRuntimeState = refresh.nextState;
    lastLoopLeaseRefreshAt = refresh.nextLastLeaseRefreshAt;
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
  registerGuardrailsGrowthMaturitySurface(pi);
  registerGuardrailsAgentSpawnReadinessSurface(pi);
  registerGuardrailsOpsCalibrationSurface(pi);
  registerGuardrailsShellSpoofingScoreSurface(pi);
  registerGuardrailsI18nLintSurface(pi);
  registerGuardrailsBackgroundProcessSurface(pi);
  registerGuardrailsHumanConfirmationSurface(pi);
  registerGuardrailsLaneQueueSurface({
    pi,
    appendAuditEntry,
    runtime: {
      getLongRunIntentQueueConfig: () => longRunIntentQueueConfig,
      getLongRunProviderRetryConfig: () => longRunProviderRetryConfig,
      getLongRunLoopRuntimeState: () => longRunLoopRuntimeState,
      getDiagnosticsSnapshot: (): GuardrailsLaneQueueSurfaceRuntimeSnapshot => ({
        lastAutoDrainAt,
        lastLongRunBusyAt,
        lastBoardAutoAdvanceTaskId,
        lastBoardAutoAdvanceAt,
        lastForceNowAt,
        lastForceNowTextPreview,
        lastLoopActivationReadyAt,
        lastLoopActivationReadyLabel,
        lastDispatchFailureFingerprint,
        lastDispatchFailureClass,
        lastDispatchFailurePauseAfterUsed,
        lastDispatchFailureWindowMsUsed,
        identicalDispatchFailureStreak,
      }),
      updateLongRunLaneStatus,
      clearAutoDrainTimer,
      setLoopMode,
      markLoopHealthy,
      scheduleAutoDrainDeferredIntent,
      markLoopDispatch,
      markLoopDegraded,
      trackClassifiedDispatchFailure,
      refreshLoopLeaseOnActivity,
      currentRuntimeCodeState,
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
