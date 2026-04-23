import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearDeferredIntentQueue,
  dequeueDeferredIntent,
  enqueueDeferredIntent,
  estimateAutoDrainWaitMs,
  listDeferredIntents,
  oldestDeferredIntentAgeMs,
  parseLaneQueueAddText,
  buildLaneQueueHelpLines,
  buildLaneQueueStatusTips,
  resolveAutoDrainGateReason,
  resolveAutoDrainRuntimeGateReason,
  resolveLongRunLoopStopBoundary,
  resolveDispatchFailureRuntimeGate,
  resolveAutoDrainRetryDelayMs,
  resolveLongRunIntentQueueConfig,
  resolvePragmaticAutonomyConfig,
  resolveBloatSmellConfig,
  shouldAutoDrainDeferredIntent,
  shouldQueueInputForLongRun,
  buildPragmaticAutonomySystemPrompt,
  summarizeAssumptionText,
  evaluateTextBloatSmell,
  evaluateCodeBloatSmell,
  estimateCodeBloatFromEditInput,
  estimateCodeBloatFromWriteInput,
  extractAssistantTextFromTurnMessage,
  buildTextBloatStatusLabel,
  buildCodeBloatStatusLabel,
  shouldEmitBloatSmellSignal,
  shouldSchedulePostDispatchAutoDrain,
  resolveBoardAutoAdvanceGateReason,
  resolveLoopActivationMarkers,
  buildLoopActivationMarkersLabel,
  shouldAnnounceLoopActivationReady,
  buildLoopActivationBlockerHint,
  shouldAutoAdvanceBoardTask,
  resolveRuntimeCodeActivationState,
  shouldEmitAutoDrainDeferredAudit,
  shouldEmitBoardAutoAdvanceGateAudit,
  shouldEmitLoopActivationAudit,
  readLongRunLoopRuntimeState,
  setLongRunLoopRuntimeMode,
  markLongRunLoopRuntimeDegraded,
  markLongRunLoopRuntimeDispatch,
  markLongRunLoopRuntimeHealthy,
  buildProviderRetryExhaustedActionLines,
  classifyLongRunDispatchFailure,
  isProviderTransientRetryExhausted,
  resolveDispatchFailureBlockAfter,
  resolveLongRunProviderTransientRetryConfig,
  resolveProviderTransientRetryDelayMs,
} from "../../extensions/guardrails-core";

describe("guardrails-core long-run intent queue", () => {
  it("uses safe defaults when settings are missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-intent-queue-default-"));
    try {
      const cfg = resolveLongRunIntentQueueConfig(cwd);
      expect(cfg.enabled).toBe(true);
      expect(cfg.requireActiveLongRun).toBe(true);
      expect(cfg.maxItems).toBe(50);
      expect(cfg.forceNowPrefix).toBe("lane-now:");
      expect(cfg.autoDrainOnIdle).toBe(true);
      expect(cfg.autoDrainCooldownMs).toBe(3000);
      expect(cfg.autoDrainBatchSize).toBe(1);
      expect(cfg.autoDrainIdleStableMs).toBe(1500);
      expect(cfg.dispatchFailureBlockAfter).toBe(3);

      const retryCfg = resolveLongRunProviderTransientRetryConfig(cwd);
      expect(retryCfg.enabled).toBe(true);
      expect(retryCfg.maxAttempts).toBe(10);
      expect(retryCfg.baseDelayMs).toBe(2_000);
      expect(retryCfg.maxDelayMs).toBe(60_000);
      expect(retryCfg.backoffMultiplier).toBe(2);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("uses pragmatic autonomy defaults when settings are missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-pragmatic-autonomy-default-"));
    try {
      const cfg = resolvePragmaticAutonomyConfig(cwd);
      expect(cfg.enabled).toBe(true);
      expect(cfg.noObviousQuestions).toBe(true);
      expect(cfg.auditAssumptions).toBe(true);
      expect(cfg.maxAuditTextChars).toBe(140);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("uses bloat-smell defaults and supports deterministic throttle keys", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-bloat-smell-default-"));
    try {
      const cfg = resolveBloatSmellConfig(cwd);
      expect(cfg.enabled).toBe(true);
      expect(cfg.notifyOnTrigger).toBe(false);
      expect(cfg.cooldownMs).toBe(90_000);
      expect(cfg.text.enabled).toBe(true);
      expect(cfg.text.chars).toBe(1200);
      expect(cfg.text.lines).toBe(24);
      expect(cfg.code.enabled).toBe(true);
      expect(cfg.code.changedLines).toBe(120);
      expect(cfg.code.hunks).toBe(8);

      expect(shouldEmitBloatSmellSignal(0, undefined, "high-char-count:1200", 10_000, 90_000)).toBe(true);
      expect(shouldEmitBloatSmellSignal(9_500, "same", "same", 10_000, 90_000)).toBe(false);
      expect(shouldEmitBloatSmellSignal(9_500, "same", "changed", 10_000, 90_000)).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("extracts assistant text for bloat signal across message content shapes", () => {
    const direct = extractAssistantTextFromTurnMessage({ role: "assistant", text: "resposta curta" });
    expect(direct).toContain("resposta curta");

    const contentParts = extractAssistantTextFromTurnMessage({
      role: "assistant",
      content: [
        { type: "text", text: "linha 1" },
        { type: "output_text", text: "linha 2" },
      ],
    });
    expect(contentParts).toContain("linha 1");
    expect(contentParts).toContain("linha 2");

    const notAssistant = extractAssistantTextFromTurnMessage({ role: "user", text: "oi" });
    expect(notAssistant).toBe("");
  });

  it("builds concise status label for text-bloat signal", () => {
    const assessment = evaluateTextBloatSmell("a\n".repeat(40), { chars: 10, lines: 8, repeatedLineRatio: 0.9 });
    const label = buildTextBloatStatusLabel(assessment);
    expect(label).toContain("[bloat] text");
    expect(label).toContain("chars=");
    expect(label).toContain("lines=");
    expect(label).toContain("rep=");
  });

  it("estimates code-bloat metrics from edit/write payloads", () => {
    const editMetrics = estimateCodeBloatFromEditInput({
      path: "a.ts",
      edits: [
        { oldText: "a\nb", newText: "a\nb\nc" },
        { oldText: "x", newText: "y" },
      ],
    });
    expect(editMetrics.changedLines).toBeGreaterThanOrEqual(4);
    expect(editMetrics.hunks).toBe(2);
    expect(editMetrics.filesTouched).toBe(1);

    const writeMetrics = estimateCodeBloatFromWriteInput({
      path: "b.ts",
      content: "linha1\nlinha2\nlinha3",
    });
    expect(writeMetrics.changedLines).toBe(3);
    expect(writeMetrics.hunks).toBe(1);

    const assessment = evaluateCodeBloatSmell(writeMetrics, { changedLines: 2, hunks: 1, filesTouched: 1 });
    const label = buildCodeBloatStatusLabel(assessment);
    expect(label).toContain("[bloat] code");
    expect(label).toContain("lines=");
    expect(label).toContain("hunks=");
    expect(label).toContain("files=");
  });

  it("builds no-obvious-questions prompt only when policy is enabled", () => {
    const enabled = buildPragmaticAutonomySystemPrompt({ enabled: true, noObviousQuestions: true });
    expect(enabled).toContain("Pragmatic autonomy policy is active");
    expect(enabled).toContain("irreversible actions");

    const disabled = buildPragmaticAutonomySystemPrompt({ enabled: false, noObviousQuestions: true });
    expect(disabled).toBeUndefined();
  });

  it("summarizes assumption text deterministically", () => {
    const summary = summarizeAssumptionText(
      "  manter execução, sem perguntar formato agora, seguir com default seguro até checkpoint  ",
      48,
    );
    expect(summary).toContain("manter execução");
    expect(summary.length).toBeLessThanOrEqual(49);
  });

  it("detects text/code bloat smells with deterministic advisory output", () => {
    const bloatedText = [
      "Resumo:",
      "Este trecho repete a mesma ideia para forçar bloat.",
      "Este trecho repete a mesma ideia para forçar bloat.",
      "Este trecho repete a mesma ideia para forçar bloat.",
      "Este trecho repete a mesma ideia para forçar bloat.",
      "Este trecho repete a mesma ideia para forçar bloat.",
      "Este trecho repete a mesma ideia para forçar bloat.",
      "Este trecho repete a mesma ideia para forçar bloat.",
      "Este trecho repete a mesma ideia para forçar bloat.",
    ].join("\n");

    const textAssessment = evaluateTextBloatSmell(bloatedText, {
      chars: 80,
      lines: 8,
      repeatedLineRatio: 0.2,
    });
    expect(textAssessment.triggered).toBe(true);
    expect(textAssessment.reasons.some((r) => r.startsWith("high-line-count"))).toBe(true);
    expect(textAssessment.reasons.some((r) => r.startsWith("high-repetition"))).toBe(true);
    expect(textAssessment.recommendation).toContain("text-bloat advisory");

    const codeAssessment = evaluateCodeBloatSmell({ changedLines: 180, hunks: 10, filesTouched: 2 }, {
      changedLines: 120,
      hunks: 8,
      filesTouched: 5,
    });
    expect(codeAssessment.triggered).toBe(true);
    expect(codeAssessment.reasons).toContain("high-changed-lines:180");
    expect(codeAssessment.reasons).toContain("high-hunks:10");
    expect(codeAssessment.recommendation).toContain("code-bloat advisory");

    const healthyText = evaluateTextBloatSmell("mensagem curta", { chars: 80, lines: 4, repeatedLineRatio: 0.5 });
    expect(healthyText.triggered).toBe(false);
  });

  it("queues only normal text while long-run is active", () => {
    const cfg = {
      enabled: true,
      requireActiveLongRun: true,
      maxItems: 50,
      forceNowPrefix: "lane-now:",
      autoDrainOnIdle: true,
      autoDrainCooldownMs: 3000,
      autoDrainBatchSize: 1,
      autoDrainIdleStableMs: 1500,
    };
    expect(shouldQueueInputForLongRun("registrar isso", true, cfg)).toBe(true);
    expect(shouldQueueInputForLongRun("/status", true, cfg)).toBe(false);
    expect(shouldQueueInputForLongRun("lane-now: processa agora", true, cfg)).toBe(false);
    expect(shouldQueueInputForLongRun("registrar isso", false, cfg)).toBe(false);
  });

  it("parses explicit lane-queue add payloads", () => {
    expect(parseLaneQueueAddText("add revisar isso depois")).toBe("revisar isso depois");
    expect(parseLaneQueueAddText("ADD   item")).toBe("item");
    expect(parseLaneQueueAddText("list")).toBeUndefined();
    expect(parseLaneQueueAddText("add")).toBeUndefined();
  });

  it("builds help/status discoverability hints for lane-queue", () => {
    const helpLines = buildLaneQueueHelpLines();
    expect(helpLines.join("\n")).toContain("/lane-queue [status|help|list|add <text>|board-next|pop|clear|pause|resume|evidence]");

    const queuedTips = buildLaneQueueStatusTips(2).join("\n");
    expect(queuedTips).toContain("/lane-queue list");
    expect(queuedTips).toContain("/lane-queue clear");

    const emptyTips = buildLaneQueueStatusTips(0).join("\n");
    expect(emptyTips).toContain("/lane-queue add <text>");
  });

  it("computes oldest queued intent age", () => {
    const nowMs = Date.parse("2026-04-21T22:00:10.000Z");
    const age = oldestDeferredIntentAgeMs([
      { id: "i-1", atIso: "2026-04-21T22:00:05.000Z", text: "a", source: "interactive" },
      { id: "i-2", atIso: "2026-04-21T22:00:00.000Z", text: "b", source: "interactive" },
    ], nowMs);
    expect(age).toBe(10_000);
    expect(oldestDeferredIntentAgeMs([], nowMs)).toBeUndefined();
  });

  it("enqueues items and enforces max size", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-intent-queue-cap-"));
    try {
      for (let i = 0; i < 5; i++) {
        enqueueDeferredIntent(cwd, `item-${i + 1}`, "interactive", 3);
      }

      const queuePath = join(cwd, ".pi", "deferred-intents.json");
      const json = JSON.parse(readFileSync(queuePath, "utf8"));
      expect(Array.isArray(json.items)).toBe(true);
      expect(json.items).toHaveLength(3);
      expect(json.items[0].text).toBe("item-3");
      expect(json.items[2].text).toBe("item-5");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("supports list/pop/clear helpers for safe drain", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-intent-queue-drain-"));
    try {
      enqueueDeferredIntent(cwd, "item-a", "interactive", 50);
      enqueueDeferredIntent(cwd, "item-b", "interactive", 50);

      expect(listDeferredIntents(cwd)).toHaveLength(2);

      const popped = dequeueDeferredIntent(cwd);
      expect(popped.item?.text).toBe("item-a");
      expect(popped.queuedCount).toBe(1);

      const cleared = clearDeferredIntentQueue(cwd);
      expect(cleared.cleared).toBe(1);
      expect(listDeferredIntents(cwd)).toHaveLength(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("persists long-run loop runtime mode/health transitions", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-long-run-loop-state-"));
    try {
      const initial = readLongRunLoopRuntimeState(cwd);
      expect(initial.mode).toBe("running");
      expect(initial.health).toBe("healthy");
      expect(initial.stopCondition).toBe("none");
      expect(initial.stopReason).toBe("running");
      expect(initial.consecutiveDispatchFailures).toBe(0);
      expect(initial.leaseOwner).toContain("guardrails-core:");
      expect(initial.leaseExpiresAtIso).toBeTruthy();

      const paused = setLongRunLoopRuntimeMode(cwd, "paused", "manual-pause").state;
      expect(paused.mode).toBe("paused");
      expect(paused.lastTransitionReason).toBe("manual-pause");
      expect(paused.stopCondition).toBe("manual-pause");
      expect(paused.stopReason).toBe("manual-pause");

      const degraded = markLongRunLoopRuntimeDegraded(
        cwd,
        "dispatch-failed:idle_timer",
        "queue dispatch failed",
      ).state;
      expect(degraded.health).toBe("degraded");
      expect(degraded.lastError).toContain("dispatch failed");
      expect(degraded.consecutiveDispatchFailures).toBe(1);
      expect(degraded.stopCondition).toBe("manual-pause");

      const resumed = setLongRunLoopRuntimeMode(cwd, "running", "manual-resume").state;
      expect(resumed.mode).toBe("running");
      expect(resumed.consecutiveDispatchFailures).toBe(1);
      expect(resumed.stopCondition).toBe("dispatch-failure");
      expect(resumed.stopReason).toBe("manual-resume");

      const dispatched = markLongRunLoopRuntimeDispatch(cwd, "intent-123").state;
      expect(dispatched.health).toBe("healthy");
      expect(dispatched.lastDispatchItemId).toBe("intent-123");
      expect(dispatched.lastError).toBeUndefined();
      expect(dispatched.consecutiveDispatchFailures).toBe(0);
      expect(dispatched.stopCondition).toBe("none");
      expect(dispatched.stopReason).toBe("running");

      const degradedAgain = markLongRunLoopRuntimeDegraded(
        cwd,
        "dispatch-failed:idle_timer",
        "queue dispatch failed again",
      ).state;
      expect(degradedAgain.consecutiveDispatchFailures).toBe(1);

      const healthy = markLongRunLoopRuntimeHealthy(cwd, "manual-resume").state;
      expect(healthy.health).toBe("healthy");
      expect(healthy.consecutiveDispatchFailures).toBe(0);
      expect(healthy.stopCondition).toBe("none");
      expect(Date.parse(healthy.leaseExpiresAtIso)).toBeGreaterThan(Date.parse(healthy.leaseHeartbeatAtIso));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("reads configured values from .pi/settings.json", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-intent-queue-config-"));
    try {
      mkdirSync(join(cwd, ".pi"), { recursive: true });
      writeFileSync(
        join(cwd, ".pi", "settings.json"),
        JSON.stringify({
          piStack: {
            guardrailsCore: {
              longRunIntentQueue: {
                enabled: true,
                requireActiveLongRun: false,
                maxItems: 99,
                forceNowPrefix: "agora:",
                autoDrainOnIdle: false,
                autoDrainCooldownMs: 8000,
                autoDrainBatchSize: 4,
                autoDrainIdleStableMs: 5000,
                dispatchFailureBlockAfter: 5,
                providerTransientRetry: {
                  enabled: true,
                  maxAttempts: 8,
                  baseDelayMs: 1500,
                  maxDelayMs: 120000,
                  backoffMultiplier: 1.5,
                },
              },
            },
          },
        }),
      );

      const cfg = resolveLongRunIntentQueueConfig(cwd);
      expect(cfg.requireActiveLongRun).toBe(false);
      expect(cfg.maxItems).toBe(99);
      expect(cfg.forceNowPrefix).toBe("agora:");
      expect(cfg.autoDrainOnIdle).toBe(false);
      expect(cfg.autoDrainCooldownMs).toBe(8000);
      expect(cfg.autoDrainBatchSize).toBe(4);
      expect(cfg.autoDrainIdleStableMs).toBe(5000);
      expect(cfg.dispatchFailureBlockAfter).toBe(5);

      const retryCfg = resolveLongRunProviderTransientRetryConfig(cwd);
      expect(retryCfg.enabled).toBe(true);
      expect(retryCfg.maxAttempts).toBe(10);
      expect(retryCfg.baseDelayMs).toBe(1500);
      expect(retryCfg.maxDelayMs).toBe(120000);
      expect(retryCfg.backoffMultiplier).toBe(1.5);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("schedules post-dispatch backstop only when queue still has items", () => {
    expect(shouldSchedulePostDispatchAutoDrain(0, 3)).toBe(false);
    expect(shouldSchedulePostDispatchAutoDrain(1, 0)).toBe(false);
    expect(shouldSchedulePostDispatchAutoDrain(1, 2)).toBe(true);
  });

  it("throttles deferred auto-drain audit spam unless gate changes", () => {
    const nowMs = 10_000;
    const minIntervalMs = 1_500;

    expect(shouldEmitAutoDrainDeferredAudit(0, undefined, "cooldown", nowMs, minIntervalMs)).toBe(true);
    expect(shouldEmitAutoDrainDeferredAudit(9_400, "cooldown", "cooldown", nowMs, minIntervalMs)).toBe(false);
    expect(shouldEmitAutoDrainDeferredAudit(8_000, "cooldown", "cooldown", nowMs, minIntervalMs)).toBe(true);
    expect(shouldEmitAutoDrainDeferredAudit(9_400, "cooldown", "idle-stability", nowMs, minIntervalMs)).toBe(true);
  });

  it("throttles board auto-advance gate audit unless gate changes", () => {
    const nowMs = 10_000;
    const minIntervalMs = 1_500;

    expect(shouldEmitBoardAutoAdvanceGateAudit(0, undefined, "queued-intents", nowMs, minIntervalMs)).toBe(true);
    expect(shouldEmitBoardAutoAdvanceGateAudit(9_400, "queued-intents", "queued-intents", nowMs, minIntervalMs)).toBe(false);
    expect(shouldEmitBoardAutoAdvanceGateAudit(8_000, "queued-intents", "queued-intents", nowMs, minIntervalMs)).toBe(true);
    expect(shouldEmitBoardAutoAdvanceGateAudit(9_400, "queued-intents", "board-not-ready", nowMs, minIntervalMs)).toBe(true);
  });

  it("throttles loop activation audit unless label changes", () => {
    const nowMs = 10_000;
    const minIntervalMs = 1_500;
    const labelA = "PREPARADO=yes ATIVO_AQUI=no EM_LOOP=no blocker=runtime-reload-required";
    const labelB = "PREPARADO=yes ATIVO_AQUI=yes EM_LOOP=yes blocker=none";

    expect(shouldEmitLoopActivationAudit(0, undefined, labelA, nowMs, minIntervalMs)).toBe(true);
    expect(shouldEmitLoopActivationAudit(9_400, labelA, labelA, nowMs, minIntervalMs)).toBe(false);
    expect(shouldEmitLoopActivationAudit(8_000, labelA, labelA, nowMs, minIntervalMs)).toBe(true);
    expect(shouldEmitLoopActivationAudit(9_400, labelA, labelB, nowMs, minIntervalMs)).toBe(true);
  });

  it("detects whether runtime code is active or reload-required", () => {
    expect(resolveRuntimeCodeActivationState({ loadedSourceMtimeMs: 1000, currentSourceMtimeMs: 1000 })).toBe("active");
    expect(resolveRuntimeCodeActivationState({ loadedSourceMtimeMs: 1000, currentSourceMtimeMs: 1008, mtimeToleranceMs: 10 })).toBe("active");
    expect(resolveRuntimeCodeActivationState({ loadedSourceMtimeMs: 1000, currentSourceMtimeMs: 1020, mtimeToleranceMs: 10 })).toBe("reload-required");
    expect(resolveRuntimeCodeActivationState({ loadedSourceMtimeMs: undefined, currentSourceMtimeMs: 1000 })).toBe("unknown");
  });

  it("builds loop activation markers for PREPARADO/ATIVO_AQUI/EM_LOOP", () => {
    const readyMarkers = resolveLoopActivationMarkers({
      activeLongRun: false,
      queuedCount: 0,
      loopMode: "running",
      loopHealth: "healthy",
      stopCondition: "none",
      boardReady: true,
      nextTaskId: "TASK-BUD-125",
      boardAutoGate: "ready",
      runtimeCodeState: "active",
    });
    expect(readyMarkers.preparado).toBe(true);
    expect(readyMarkers.ativoAqui).toBe(true);
    expect(readyMarkers.emLoop).toBe(true);
    expect(readyMarkers.blocker).toBe("none");
    expect(buildLoopActivationMarkersLabel(readyMarkers)).toContain("PREPARADO=yes");
    expect(buildLoopActivationMarkersLabel(readyMarkers)).toContain("EM_LOOP=yes");
    expect(shouldAnnounceLoopActivationReady(false, readyMarkers.emLoop)).toBe(true);

    const reloadMarkers = resolveLoopActivationMarkers({
      activeLongRun: false,
      queuedCount: 0,
      loopMode: "running",
      loopHealth: "healthy",
      stopCondition: "none",
      boardReady: true,
      nextTaskId: "TASK-BUD-125",
      boardAutoGate: "ready",
      runtimeCodeState: "reload-required",
    });
    expect(reloadMarkers.preparado).toBe(true);
    expect(reloadMarkers.ativoAqui).toBe(false);
    expect(reloadMarkers.emLoop).toBe(false);
    expect(reloadMarkers.blocker).toBe("runtime-reload-required");
    expect(shouldAnnounceLoopActivationReady(true, reloadMarkers.emLoop)).toBe(false);

    const queueBlockedMarkers = resolveLoopActivationMarkers({
      activeLongRun: false,
      queuedCount: 2,
      loopMode: "running",
      loopHealth: "healthy",
      stopCondition: "none",
      boardReady: true,
      nextTaskId: "TASK-BUD-125",
      boardAutoGate: "queued-intents",
      runtimeCodeState: "active",
    });
    expect(queueBlockedMarkers.emLoop).toBe(false);
    expect(queueBlockedMarkers.blocker).toBe("queued-intents");

    expect(buildLoopActivationBlockerHint(reloadMarkers)).toContain("faça reload");
    expect(buildLoopActivationBlockerHint(queueBlockedMarkers)).toContain("esvazie fila");
    expect(buildLoopActivationBlockerHint(readyMarkers)).toBeUndefined();
  });

  it("auto-advances board task only when lane is idle, empty and healthy", () => {
    const ready = {
      activeLongRun: false,
      queuedCount: 0,
      loopMode: "running" as const,
      loopHealth: "healthy" as const,
      stopCondition: "none" as const,
      boardReady: true,
      nextTaskId: "TASK-BUD-125",
    };

    expect(shouldAutoAdvanceBoardTask(ready)).toBe(true);
    expect(resolveBoardAutoAdvanceGateReason(ready)).toBe("ready");

    const activeLongRun = {
      ...ready,
      activeLongRun: true,
    };
    expect(shouldAutoAdvanceBoardTask(activeLongRun)).toBe(false);
    expect(resolveBoardAutoAdvanceGateReason(activeLongRun)).toBe("active-long-run");

    const queued = {
      ...ready,
      queuedCount: 1,
    };
    expect(shouldAutoAdvanceBoardTask(queued)).toBe(false);
    expect(resolveBoardAutoAdvanceGateReason(queued)).toBe("queued-intents");

    const paused = {
      ...ready,
      loopMode: "paused" as const,
      stopCondition: "manual-pause" as const,
    };
    expect(shouldAutoAdvanceBoardTask(paused)).toBe(false);
    expect(resolveBoardAutoAdvanceGateReason(paused)).toBe("loop-paused");

    const degraded = {
      ...ready,
      loopHealth: "degraded" as const,
      stopCondition: "dispatch-failure" as const,
    };
    expect(shouldAutoAdvanceBoardTask(degraded)).toBe(false);
    expect(resolveBoardAutoAdvanceGateReason(degraded)).toBe("loop-degraded");

    const notReady = {
      ...ready,
      boardReady: false,
      nextTaskId: undefined,
    };
    expect(shouldAutoAdvanceBoardTask(notReady)).toBe(false);
    expect(resolveBoardAutoAdvanceGateReason(notReady)).toBe("board-not-ready");

    const missingTask = {
      ...ready,
      nextTaskId: "",
    };
    expect(shouldAutoAdvanceBoardTask(missingTask)).toBe(false);
    expect(resolveBoardAutoAdvanceGateReason(missingTask)).toBe("missing-next-task-id");

    const deduped = {
      ...ready,
      nowMs: 12_000,
      lastTaskId: "TASK-BUD-125",
      lastTaskAtMs: 10_700,
      dedupeWindowMs: 2_000,
    };
    expect(shouldAutoAdvanceBoardTask(deduped)).toBe(false);
    expect(resolveBoardAutoAdvanceGateReason(deduped)).toBe("dedupe-window");

    const dedupeExpired = {
      ...deduped,
      nowMs: 13_100,
    };
    expect(shouldAutoAdvanceBoardTask(dedupeExpired)).toBe(true);
    expect(resolveBoardAutoAdvanceGateReason(dedupeExpired)).toBe("ready");
  });

  it("applies lease-expired as explicit runtime auto-drain gate", () => {
    const nowMs = Date.parse("2026-04-23T04:00:00.000Z");
    const expiredState = {
      leaseExpiresAtIso: "2026-04-23T03:59:59.000Z",
      stopCondition: "none" as const,
    };
    const healthyState = {
      leaseExpiresAtIso: "2026-04-23T04:10:00.000Z",
      stopCondition: "none" as const,
    };

    expect(resolveAutoDrainRuntimeGateReason("ready", expiredState, nowMs)).toBe("lease-expired");
    expect(resolveAutoDrainRuntimeGateReason("cooldown", expiredState, nowMs)).toBe("lease-expired");
    expect(resolveAutoDrainRuntimeGateReason("ready", healthyState, nowMs)).toBe("ready");
    expect(resolveAutoDrainRuntimeGateReason("active-long-run", healthyState, nowMs)).toBe("active-long-run");
  });

  it("classifies stop-condition boundary as blocking vs advisory", () => {
    expect(resolveLongRunLoopStopBoundary({ mode: "running", stopCondition: "none" })).toBe("none");
    expect(resolveLongRunLoopStopBoundary({ mode: "running", stopCondition: "dispatch-failure" })).toBe("advisory");
    expect(
      resolveLongRunLoopStopBoundary({ mode: "running", stopCondition: "dispatch-failure", consecutiveDispatchFailures: 3 }),
    ).toBe("blocking");
    expect(
      resolveLongRunLoopStopBoundary(
        { mode: "running", stopCondition: "dispatch-failure", consecutiveDispatchFailures: 3 },
        5,
      ),
    ).toBe("advisory");
    expect(resolveLongRunLoopStopBoundary({ mode: "running", stopCondition: "lease-expired" })).toBe("blocking");
    expect(resolveLongRunLoopStopBoundary({ mode: "paused", stopCondition: "manual-pause" })).toBe("blocking");
  });

  it("resolves dispatch-failure runtime gate based on failure streak threshold", () => {
    expect(resolveDispatchFailureRuntimeGate({ mode: "running", stopCondition: "none" }, 3)).toBeUndefined();
    expect(
      resolveDispatchFailureRuntimeGate(
        { mode: "running", stopCondition: "dispatch-failure", consecutiveDispatchFailures: 2 },
        3,
      ),
    ).toBe("dispatch-failure-advisory");
    expect(
      resolveDispatchFailureRuntimeGate(
        { mode: "running", stopCondition: "dispatch-failure", consecutiveDispatchFailures: 3 },
        3,
      ),
    ).toBe("dispatch-failure-blocking");
  });

  it("supports prolonged advisory retries when threshold is configured to 10", () => {
    const threshold = 10;
    for (let failures = 1; failures < threshold; failures += 1) {
      expect(
        resolveDispatchFailureRuntimeGate(
          { mode: "running", stopCondition: "dispatch-failure", consecutiveDispatchFailures: failures },
          threshold,
        ),
      ).toBe("dispatch-failure-advisory");
      expect(
        resolveLongRunLoopStopBoundary(
          { mode: "running", stopCondition: "dispatch-failure", consecutiveDispatchFailures: failures },
          threshold,
        ),
      ).toBe("advisory");
    }

    expect(
      resolveDispatchFailureRuntimeGate(
        { mode: "running", stopCondition: "dispatch-failure", consecutiveDispatchFailures: threshold },
        threshold,
      ),
    ).toBe("dispatch-failure-blocking");
    expect(
      resolveLongRunLoopStopBoundary(
        { mode: "running", stopCondition: "dispatch-failure", consecutiveDispatchFailures: threshold },
        threshold,
      ),
    ).toBe("blocking");
  });

  it("classifies provider transient errors and escalates block threshold to retry budget", () => {
    expect(classifyLongRunDispatchFailure("server_is_overload")).toBe("provider-transient");
    expect(classifyLongRunDispatchFailure("HTTP 429 too many requests")).toBe("provider-transient");
    expect(classifyLongRunDispatchFailure("unexpected parser error")).toBe("other");

    const cfg = {
      enabled: true,
      maxAttempts: 10,
      baseDelayMs: 1000,
      maxDelayMs: 8000,
      backoffMultiplier: 2,
    };

    expect(
      resolveDispatchFailureBlockAfter({ lastError: "server_is_overload" }, 3, cfg),
    ).toBe(10);
    expect(resolveDispatchFailureBlockAfter({ lastError: "bad json" }, 3, cfg)).toBe(3);

    expect(
      isProviderTransientRetryExhausted(
        { consecutiveDispatchFailures: 10, lastError: "server_is_overload" },
        10,
        cfg,
      ),
    ).toBe(true);
    expect(
      isProviderTransientRetryExhausted(
        { consecutiveDispatchFailures: 9, lastError: "server_is_overload" },
        10,
        cfg,
      ),
    ).toBe(false);
    expect(
      isProviderTransientRetryExhausted(
        { consecutiveDispatchFailures: 11, lastError: "bad json" },
        10,
        cfg,
      ),
    ).toBe(false);

    const actionLines = buildProviderRetryExhaustedActionLines();
    expect(actionLines).toHaveLength(3);
    expect(actionLines.join("\n")).toContain("/provider-readiness-matrix");
    expect(actionLines.join("\n")).toContain("/lane-queue resume");
  });

  it("computes deterministic exponential retry delay for transient provider failures", () => {
    const cfg = {
      enabled: true,
      maxAttempts: 10,
      baseDelayMs: 1000,
      maxDelayMs: 8000,
      backoffMultiplier: 2,
    };

    expect(resolveProviderTransientRetryDelayMs(1, cfg)).toBe(1000);
    expect(resolveProviderTransientRetryDelayMs(2, cfg)).toBe(2000);
    expect(resolveProviderTransientRetryDelayMs(3, cfg)).toBe(4000);
    expect(resolveProviderTransientRetryDelayMs(5, cfg)).toBe(8000);
  });

  it("auto-drains only when idle, enabled and after cooldown", () => {
    const cfg = {
      enabled: true,
      requireActiveLongRun: true,
      maxItems: 50,
      forceNowPrefix: "lane-now:",
      autoDrainOnIdle: true,
      autoDrainCooldownMs: 1000,
      autoDrainBatchSize: 1,
      autoDrainIdleStableMs: 800,
    };

    expect(estimateAutoDrainWaitMs(false, 1, 2_000, 0, 1_200, cfg)).toBe(0);
    expect(estimateAutoDrainWaitMs(false, 1, 500, 0, 1_200, cfg)).toBe(500);
    expect(estimateAutoDrainWaitMs(false, 1, 2_000, 0, 200, cfg)).toBe(600);
    expect(estimateAutoDrainWaitMs(true, 1, 2_000, 0, 1_200, cfg)).toBeUndefined();

    expect(resolveAutoDrainGateReason(true, 1, 2_000, 0, 1_200, cfg)).toBe("active-long-run");
    expect(resolveAutoDrainGateReason(false, 1, 500, 0, 1_200, cfg)).toBe("cooldown");
    expect(resolveAutoDrainGateReason(false, 1, 2_000, 0, 200, cfg)).toBe("idle-stability");
    expect(resolveAutoDrainGateReason(false, 1, 2_000, 0, 1_200, cfg)).toBe("ready");

    expect(resolveAutoDrainRetryDelayMs(false, 1, 500, 0, 1_200, cfg)).toBe(500);
    expect(resolveAutoDrainRetryDelayMs(false, 1, 2_000, 0, 200, cfg)).toBe(600);
    expect(resolveAutoDrainRetryDelayMs(false, 1, 2_000, 0, 1_200, cfg)).toBeUndefined();
    expect(resolveAutoDrainRetryDelayMs(true, 1, 2_000, 0, 1_200, cfg)).toBe(800);

    expect(shouldAutoDrainDeferredIntent(false, 1, 2_000, 0, 1_200, cfg)).toBe(true);
    expect(shouldAutoDrainDeferredIntent(true, 1, 2_000, 0, 1_200, cfg)).toBe(false);
    expect(shouldAutoDrainDeferredIntent(false, 0, 2_000, 0, 1_200, cfg)).toBe(false);
    expect(shouldAutoDrainDeferredIntent(false, 1, 500, 0, 1_200, cfg)).toBe(false);
    expect(shouldAutoDrainDeferredIntent(false, 1, 2_000, 0, 200, cfg)).toBe(false);
  });
});
