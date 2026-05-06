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
import { statSync } from "node:fs";
import { createGuardrailsCoreAutoDrain, type GuardrailsCoreAutoDrainState } from "./guardrails-core-auto-drain";
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
  resolveRuntimeCodeActivationState,
  getDeferredIntentQueueCount,
  readLongRunLoopRuntimeState,
  setLongRunLoopRuntimeMode,
  markLongRunLoopRuntimeDispatch,
  markLongRunLoopRuntimeDegraded,
  markLongRunLoopRuntimeHealthy,
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
  classifyLongRunDispatchFailure,
  resolveToolOutputOrphanRedispatchDecision,
  resolveDispatchFailurePauseAfter,
  resolveDispatchFailureWindowMs,
  resolveLongRunProviderTransientRetryConfig,
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
import { buildShellRoutingStatusLabel, resolveCommandRoutingProfile, type CommandRoutingProfile } from "./guardrails-core-shell-routing";
import { DEFAULT_I18N_INTENT_CONFIG, resolveI18nIntentConfig, type I18nIntentConfig } from "./guardrails-core-i18n-intents";
import { shouldAnnounceStrictInteractiveMode } from "./guardrails-core-command-utils";
export { shouldAnnounceStrictInteractiveMode } from "./guardrails-core-command-utils";
import { registerGuardrailsCoreEventSurface } from "./guardrails-core-event-surface";
import { registerGuardrailsCoreToolCallGuard } from "./guardrails-core-tool-call-guard";
import { registerGuardrailsCoreSurfaces, type GuardrailsLaneQueueSurfaceRuntimeSnapshot } from "./guardrails-core-surface-registration";
import {
  isInsideCwd,
} from "./guardrails-core-path-guard";
export {
  extractPathsFromBash,
  isAllowedOutside,
  isInsideCwd,
  isSensitive,
  isUpstreamPiPackagePath,
  upstreamPiPackageMutationToolReason,
} from "./guardrails-core-path-guard";
import { appendAuditEntry } from "./guardrails-core-confirmation-audit";
import {
  classifyRouting,
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

  const autoDrainState: GuardrailsCoreAutoDrainState = {
    get longRunIntentQueueConfig() { return longRunIntentQueueConfig; },
    set longRunIntentQueueConfig(value) { longRunIntentQueueConfig = value; },
    get longRunProviderRetryConfig() { return longRunProviderRetryConfig; },
    set longRunProviderRetryConfig(value) { longRunProviderRetryConfig = value; },
    get longRunLoopRuntimeState() { return longRunLoopRuntimeState; },
    set longRunLoopRuntimeState(value) { longRunLoopRuntimeState = value; },
    get lastLongRunBusyAt() { return lastLongRunBusyAt; },
    set lastLongRunBusyAt(value) { lastLongRunBusyAt = value; },
    get lastAutoDrainAt() { return lastAutoDrainAt; },
    set lastAutoDrainAt(value) { lastAutoDrainAt = value; },
    get lastAutoDrainDeferredAuditAt() { return lastAutoDrainDeferredAuditAt; },
    set lastAutoDrainDeferredAuditAt(value) { lastAutoDrainDeferredAuditAt = value; },
    get lastAutoDrainDeferredGate() { return lastAutoDrainDeferredGate; },
    set lastAutoDrainDeferredGate(value) { lastAutoDrainDeferredGate = value; },
    get lastBoardAutoAdvanceTaskId() { return lastBoardAutoAdvanceTaskId; },
    set lastBoardAutoAdvanceTaskId(value) { lastBoardAutoAdvanceTaskId = value; },
    get lastBoardAutoAdvanceAt() { return lastBoardAutoAdvanceAt; },
    set lastBoardAutoAdvanceAt(value) { lastBoardAutoAdvanceAt = value; },
    get lastBoardAutoAdvanceGateAuditAt() { return lastBoardAutoAdvanceGateAuditAt; },
    set lastBoardAutoAdvanceGateAuditAt(value) { lastBoardAutoAdvanceGateAuditAt = value; },
    get lastBoardAutoAdvanceGate() { return lastBoardAutoAdvanceGate; },
    set lastBoardAutoAdvanceGate(value) { lastBoardAutoAdvanceGate = value; },
    get lastLoopActivationAuditAt() { return lastLoopActivationAuditAt; },
    set lastLoopActivationAuditAt(value) { lastLoopActivationAuditAt = value; },
    get lastLoopActivationLabel() { return lastLoopActivationLabel; },
    set lastLoopActivationLabel(value) { lastLoopActivationLabel = value; },
    get lastLoopActivationEmLoop() { return lastLoopActivationEmLoop; },
    set lastLoopActivationEmLoop(value) { lastLoopActivationEmLoop = value; },
    get lastLoopActivationReadyAt() { return lastLoopActivationReadyAt; },
    set lastLoopActivationReadyAt(value) { lastLoopActivationReadyAt = value; },
    get lastLoopActivationReadyLabel() { return lastLoopActivationReadyLabel; },
    set lastLoopActivationReadyLabel(value) { lastLoopActivationReadyLabel = value; },
  };

  const tryAutoDrainDeferredIntent = createGuardrailsCoreAutoDrain({
    pi,
    appendAuditEntry,
    state: autoDrainState,
    updateLongRunLaneStatus,
    scheduleAutoDrainDeferredIntent,
    markLoopDispatch,
    markLoopHealthy,
    markLoopDegraded,
    trackDispatchFailureFingerprint,
    trackClassifiedDispatchFailure,
    trackToolOutputOrphanCallId,
    recordLoopReadyEvidence,
    recordBoardAutoAdvanceEvidence,
    refreshLoopEvidenceHeartbeat,
    currentRuntimeCodeState,
  });

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

  registerGuardrailsCoreToolCallGuard(pi, {
    getShellRoutingProfile: () => shellRoutingProfile,
    getStrictInteractiveMode: () => strictInteractiveMode,
    getPortConflictConfig: () => portConflictConfig,
    getBloatSmellConfig: () => bloatSmellConfig,
    getEventSurfaceRuntime: () => eventSurfaceRuntime,
  });

  registerGuardrailsCoreSurfaces({
    pi,
    appendAuditEntry,
    isInsideCwd,
    getShellRoutingProfile: () => shellRoutingProfile,
    onRuntimeConfigChanged: (ctx) => {
      longRunIntentQueueConfig = resolveLongRunIntentQueueConfig(ctx.cwd);
      pragmaticAutonomyConfig = resolvePragmaticAutonomyConfig(ctx.cwd);
      i18nIntentConfig = resolveI18nIntentConfig(ctx.cwd);
      updateLongRunLaneStatus(ctx, !ctx.isIdle() || ctx.hasPendingMessages(), longRunLoopRuntimeState);
    },
    laneQueueRuntime: {
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
