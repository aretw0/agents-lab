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
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_BLOAT_SMELL_CONFIG,
  resolveBloatSmellConfig,
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
  resolveAutoDrainGateReason,
  resolveAutoDrainRuntimeGateReason,
  resolveDispatchFailureRuntimeGate,
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
  shouldEmitLoopActivationAudit,
  resolveRuntimeCodeActivationState,
  enqueueDeferredIntent,
  dequeueDeferredIntent,
  getDeferredIntentQueueCount,
  readLongRunLoopRuntimeState,
  setLongRunLoopRuntimeMode,
  markLongRunLoopRuntimeDispatch,
  markLongRunLoopRuntimeDegraded,
  markLongRunLoopRuntimeHealthy,
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
import { evaluateBoardLongRunReadiness } from "./guardrails-core-board-readiness";
import { buildBoardExecuteNextIntent, encodeGuardrailsIntent, summarizeGuardrailsIntent } from "./guardrails-core-intent-bus";
import { buildShellRoutingStatusLabel, resolveBashCommandRoutingDecision, resolveCommandRoutingProfile, type CommandRoutingProfile } from "./guardrails-core-shell-routing";
import { DEFAULT_I18N_INTENT_CONFIG, resolveI18nIntentConfig, type I18nIntentConfig } from "./guardrails-core-i18n-intents";
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
import { registerGuardrailsRuntimeConfigSurface } from "./guardrails-core-runtime-config-surface";
import { shouldAnnounceStrictInteractiveMode } from "./guardrails-core-command-utils";
export { shouldAnnounceStrictInteractiveMode } from "./guardrails-core-command-utils";
import { guardrailsCoreHandleStructuredMutationBloat, registerGuardrailsCoreEventSurface } from "./guardrails-core-event-surface";
import {
  isInsideCwd,
  isUpstreamPiPackagePath,
  upstreamPiPackageMutationToolReason,
} from "./guardrails-core-path-guard";
export {
  extractPathsFromBash,
  isAllowedOutside,
  isInsideCwd,
  isSensitive,
  isUpstreamPiPackagePath,
  upstreamPiPackageMutationToolReason,
} from "./guardrails-core-path-guard";
import { resolveStructuredFirstMutationDecision } from "./guardrails-core-structured-first";
import { evaluateBashGuardPolicies } from "./guardrails-core-bash-guard-policies";
import { appendAuditEntry } from "./guardrails-core-confirmation-audit";
import { guardBashPathReads, guardReadPath } from "./guardrails-core-read-path-runtime";
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
import {
  detectProviderBudgetGovernorMisconfig,
  providerBudgetGovernorMisconfigReason,
  readQuotaBudgetSettings,
  resolveProviderBudgetGovernorConfig,
  resolveProviderBudgetGovernorSnapshot,
  type ProviderBudgetGovernorConfig,
  type ProviderBudgetGovernorMisconfig,
  type ProviderBudgetGovernorSnapshot,
  type ProviderBudgetGovernorSnapshotCache,
} from "./guardrails-core-provider-budget-governor";
export {
  detectProviderBudgetGovernorMisconfig,
  providerBudgetGovernorMisconfigReason,
} from "./guardrails-core-provider-budget-governor";
export type { ProviderBudgetGovernorMisconfig } from "./guardrails-core-provider-budget-governor";

import {
  DEFAULT_PRAGMATIC_AUTONOMY_CONFIG,
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
  try { return statSync(GUARDRAILS_CORE_SOURCE_PATH).mtimeMs; } catch { return undefined; }
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
  let providerBudgetSnapshotCache: ProviderBudgetGovernorSnapshotCache | undefined;
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
    const result = await resolveProviderBudgetGovernorSnapshot(ctx.cwd, providerBudgetGovernorConfig, providerBudgetSnapshotCache);
    providerBudgetSnapshotCache = result.cache;
    return result.snapshot;
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

  const eventSurfaceRuntime = {
    getStrictInteractiveMode: () => strictInteractiveMode,
    setStrictInteractiveMode: (value: boolean) => { strictInteractiveMode = value; },
    getStrictInteractiveAnnounced: () => strictInteractiveAnnounced,
    setStrictInteractiveAnnounced: (value: boolean) => { strictInteractiveAnnounced = value; },
    getShellRoutingProfile: () => shellRoutingProfile,
    getLongRunIntentQueueConfig: () => longRunIntentQueueConfig,
    getPragmaticAutonomyConfig: () => pragmaticAutonomyConfig,
    getI18nIntentConfig: () => i18nIntentConfig,
    getBloatSmellConfig: () => bloatSmellConfig,
    getProviderBudgetGovernorConfig: () => providerBudgetGovernorConfig,
    getProviderBudgetGovernorMisconfig: () => providerBudgetGovernorMisconfig,
    getLongRunLoopRuntimeState: () => longRunLoopRuntimeState,
    resolveProviderBudgetSnapshot,
    setLastLongRunBusyAt: (value: number) => { lastLongRunBusyAt = value; },
    setLastForceNowAt: (value: number) => { lastForceNowAt = value; },
    setLastForceNowTextPreview: (value: string | undefined) => { lastForceNowTextPreview = value; },
    getTextBloatSignal: () => ({ at: lastTextBloatSignalAt, key: lastTextBloatSignalKey }),
    setTextBloatSignal: (value: { at: number; key?: string }) => { lastTextBloatSignalAt = value.at; lastTextBloatSignalKey = value.key; },
    getCodeBloatSignal: () => ({ at: lastCodeBloatSignalAt, key: lastCodeBloatSignalKey }),
    setCodeBloatSignal: (value: { at: number; key?: string }) => { lastCodeBloatSignalAt = value.at; lastCodeBloatSignalKey = value.key; },
    getWideSliceSignal: () => ({ at: lastWideSliceSignalAt, key: lastWideSliceSignalKey }),
    setWideSliceSignal: (value: { at: number; key?: string }) => { lastWideSliceSignalAt = value.at; lastWideSliceSignalKey = value.key; },
    clearAutoDrainTimer,
    refreshLoopLeaseOnActivity,
    updateLongRunLaneStatus,
    scheduleAutoDrainDeferredIntent,
  };
  registerGuardrailsCoreEventSurface(pi, eventSurfaceRuntime);

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

    guardrailsCoreHandleStructuredMutationBloat(event, ctx, bloatSmellConfig, eventSurfaceRuntime, structuredMutationToolType);

    return undefined;
  });

  registerGuardrailsRuntimeConfigSurface(pi, appendAuditEntry, {
    onConfigChanged: (ctx) => {
      longRunIntentQueueConfig = resolveLongRunIntentQueueConfig(ctx.cwd);
      pragmaticAutonomyConfig = resolvePragmaticAutonomyConfig(ctx.cwd);
      i18nIntentConfig = resolveI18nIntentConfig(ctx.cwd);
      updateLongRunLaneStatus(ctx, !ctx.isIdle() || ctx.hasPendingMessages(), longRunLoopRuntimeState);
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
