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
  resolveAutoDrainRetryDelayMs,
  resolveLongRunIntentQueueConfig,
  extractForceNowText,
  resolvePragmaticAutonomyConfig,
  resolveGuardrailsRuntimeConfigSpec,
  coerceGuardrailsRuntimeConfigValue,
  readGuardrailsRuntimeConfigSnapshot,
  buildGuardrailsRuntimeConfigSetResult,
  resolveBloatSmellConfig,
  shouldAutoDrainDeferredIntent,
  shouldQueueInputForLongRun,
  buildPragmaticAutonomySystemPrompt,
  summarizeAssumptionText,
  evaluateTextBloatSmell,
  evaluateCodeBloatSmell,
  evaluateWideSingleFileSlice,
  estimateCodeBloatFromEditInput,
  estimateCodeBloatFromWriteInput,
  extractAssistantTextFromTurnMessage,
  buildTextBloatStatusLabel,
  buildCodeBloatStatusLabel,
  buildWideSingleFileSliceStatusLabel,
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
  computeLoopEvidenceReadiness,
  shouldRefreshLoopEvidenceFromRuntimeSnapshot,
  readLongRunLoopRuntimeState,
  setLongRunLoopRuntimeMode,
  markLongRunLoopRuntimeDegraded,
  markLongRunLoopRuntimeDispatch,
  markLongRunLoopRuntimeHealthy,
  buildProviderRetryExhaustedActionLines,
  buildToolOutputOrphanRecoveryActionLines,
  classifyLongRunDispatchFailure,
  isProviderTransientRetryExhausted,
  resolveDispatchFailureBlockAfter,
  resolveDispatchFailurePauseAfter,
  resolveDispatchFailureWindowMs,
  resolveLongRunProviderTransientRetryConfig,
  resolveProviderTransientRetryDelayMs,
  shouldBlockRapidSameTaskRedispatch,
  BOARD_RAPID_REDISPATCH_WINDOW_MS,
  normalizeDispatchFailureFingerprint,
  computeIdenticalFailureStreak,
  shouldPauseOnIdenticalFailure,
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
      expect(cfg.defaultBoardMilestone).toBeUndefined();
      expect(cfg.autoDrainOnIdle).toBe(true);
      expect(cfg.autoDrainCooldownMs).toBe(3000);
      expect(cfg.autoDrainBatchSize).toBe(1);
      expect(cfg.autoDrainIdleStableMs).toBe(1500);
      expect(cfg.dispatchFailureBlockAfter).toBe(3);
      expect(cfg.rapidRedispatchWindowMs).toBe(BOARD_RAPID_REDISPATCH_WINDOW_MS);
      expect(cfg.dedupeWindowMs).toBe(120_000);
      expect(cfg.identicalFailurePauseAfter).toBe(3);
      expect(cfg.orphanFailurePauseAfter).toBe(1);
      expect(cfg.identicalFailureWindowMs).toBe(120_000);
      expect(cfg.orphanFailureWindowMs).toBe(120_000);

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

  it("supports runtime config get/set coercion with validation and immediate snapshot refresh", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-runtime-config-cmd-"));
    try {
      const spec = resolveGuardrailsRuntimeConfigSpec("longRunIntentQueue.maxItems");
      expect(spec).toBeDefined();
      if (!spec) return;

      const valid = coerceGuardrailsRuntimeConfigValue("80", spec);
      expect(valid.ok).toBe(true);
      if (valid.ok) expect(valid.value).toBe(80);

      const invalid = coerceGuardrailsRuntimeConfigValue("0", spec);
      expect(invalid.ok).toBe(false);

      const setResult = buildGuardrailsRuntimeConfigSetResult({
        cwd,
        key: "longRunIntentQueue.maxItems",
        rawValue: "80",
      });
      expect(setResult.ok).toBe(true);

      const snapshot = readGuardrailsRuntimeConfigSnapshot(cwd);
      expect(snapshot["longRunIntentQueue.maxItems"]).toBe(80);

      const boolSpec = resolveGuardrailsRuntimeConfigSpec("pragmaticAutonomy.enabled");
      expect(boolSpec).toBeDefined();
      if (!boolSpec) return;
      const boolOk = coerceGuardrailsRuntimeConfigValue("off", boolSpec);
      expect(boolOk.ok).toBe(true);
      if (boolOk.ok) expect(boolOk.value).toBe(false);

      const rapidWindowSpec = resolveGuardrailsRuntimeConfigSpec("longRunIntentQueue.rapidRedispatchWindowMs");
      expect(rapidWindowSpec).toBeDefined();
      if (!rapidWindowSpec) return;
      const rapidWindowOk = coerceGuardrailsRuntimeConfigValue("45000", rapidWindowSpec);
      expect(rapidWindowOk.ok).toBe(true);

      const setRapidWindow = buildGuardrailsRuntimeConfigSetResult({
        cwd,
        key: "longRunIntentQueue.rapidRedispatchWindowMs",
        rawValue: "45000",
      });
      expect(setRapidWindow.ok).toBe(true);

      const dedupeWindowSpec = resolveGuardrailsRuntimeConfigSpec("longRunIntentQueue.dedupeWindowMs");
      expect(dedupeWindowSpec).toBeDefined();
      if (!dedupeWindowSpec) return;
      const dedupeWindowOk = coerceGuardrailsRuntimeConfigValue("50000", dedupeWindowSpec);
      expect(dedupeWindowOk.ok).toBe(true);

      const setDedupeWindow = buildGuardrailsRuntimeConfigSetResult({
        cwd,
        key: "longRunIntentQueue.dedupeWindowMs",
        rawValue: "50000",
      });
      expect(setDedupeWindow.ok).toBe(true);

      const identicalPauseSpec = resolveGuardrailsRuntimeConfigSpec("longRunIntentQueue.identicalFailurePauseAfter");
      expect(identicalPauseSpec).toBeDefined();
      if (!identicalPauseSpec) return;
      const identicalPauseOk = coerceGuardrailsRuntimeConfigValue("4", identicalPauseSpec);
      expect(identicalPauseOk.ok).toBe(true);

      const setIdenticalPause = buildGuardrailsRuntimeConfigSetResult({
        cwd,
        key: "longRunIntentQueue.identicalFailurePauseAfter",
        rawValue: "4",
      });
      expect(setIdenticalPause.ok).toBe(true);

      const orphanPauseSpec = resolveGuardrailsRuntimeConfigSpec("longRunIntentQueue.orphanFailurePauseAfter");
      expect(orphanPauseSpec).toBeDefined();
      if (!orphanPauseSpec) return;
      const orphanPauseOk = coerceGuardrailsRuntimeConfigValue("2", orphanPauseSpec);
      expect(orphanPauseOk.ok).toBe(true);

      const setOrphanPause = buildGuardrailsRuntimeConfigSetResult({
        cwd,
        key: "longRunIntentQueue.orphanFailurePauseAfter",
        rawValue: "2",
      });
      expect(setOrphanPause.ok).toBe(true);

      const orphanWindowSpec = resolveGuardrailsRuntimeConfigSpec("longRunIntentQueue.orphanFailureWindowMs");
      expect(orphanWindowSpec).toBeDefined();
      if (!orphanWindowSpec) return;
      const orphanWindowOk = coerceGuardrailsRuntimeConfigValue("70000", orphanWindowSpec);
      expect(orphanWindowOk.ok).toBe(true);

      const setOrphanWindow = buildGuardrailsRuntimeConfigSetResult({
        cwd,
        key: "longRunIntentQueue.orphanFailureWindowMs",
        rawValue: "70000",
      });
      expect(setOrphanWindow.ok).toBe(true);

      const identicalWindowSpec = resolveGuardrailsRuntimeConfigSpec("longRunIntentQueue.identicalFailureWindowMs");
      expect(identicalWindowSpec).toBeDefined();
      if (!identicalWindowSpec) return;
      const identicalWindowOk = coerceGuardrailsRuntimeConfigValue("90000", identicalWindowSpec);
      expect(identicalWindowOk.ok).toBe(true);

      const setIdenticalWindow = buildGuardrailsRuntimeConfigSetResult({
        cwd,
        key: "longRunIntentQueue.identicalFailureWindowMs",
        rawValue: "90000",
      });
      expect(setIdenticalWindow.ok).toBe(true);

      const defaultMilestoneSpec = resolveGuardrailsRuntimeConfigSpec("longRunIntentQueue.defaultBoardMilestone");
      expect(defaultMilestoneSpec).toBeDefined();
      if (!defaultMilestoneSpec) return;
      const defaultMilestoneOk = coerceGuardrailsRuntimeConfigValue("\"MS   LOCAL\"", defaultMilestoneSpec);
      expect(defaultMilestoneOk.ok).toBe(true);
      const setDefaultMilestone = buildGuardrailsRuntimeConfigSetResult({
        cwd,
        key: "longRunIntentQueue.defaultBoardMilestone",
        rawValue: "\"MS   LOCAL\"",
      });
      expect(setDefaultMilestone.ok).toBe(true);

      const modelLevelSpec = resolveGuardrailsRuntimeConfigSpec("contextWatchdog.modelSteeringFromLevel");
      expect(modelLevelSpec).toBeDefined();
      if (!modelLevelSpec) return;
      expect(modelLevelSpec.reloadRequired).toBe(true);
      const modelLevelOk = coerceGuardrailsRuntimeConfigValue("checkpoint", modelLevelSpec);
      expect(modelLevelOk.ok).toBe(true);
      const modelLevelInvalid = coerceGuardrailsRuntimeConfigValue("soon", modelLevelSpec);
      expect(modelLevelInvalid.ok).toBe(false);

      const setModel = buildGuardrailsRuntimeConfigSetResult({
        cwd,
        key: "contextWatchdog.modelSteeringFromLevel",
        rawValue: "checkpoint",
      });
      expect(setModel.ok).toBe(true);

      const setNotify = buildGuardrailsRuntimeConfigSetResult({
        cwd,
        key: "contextWatchdog.userNotifyFromLevel",
        rawValue: "warn",
      });
      expect(setNotify.ok).toBe(true);

      const autoCompactCooldownSpec = resolveGuardrailsRuntimeConfigSpec("contextWatchdog.autoCompactCooldownMs");
      expect(autoCompactCooldownSpec).toBeDefined();
      if (!autoCompactCooldownSpec) return;
      const autoCompactCooldownOk = coerceGuardrailsRuntimeConfigValue("120000", autoCompactCooldownSpec);
      expect(autoCompactCooldownOk.ok).toBe(true);

      const setAutoCompact = buildGuardrailsRuntimeConfigSetResult({
        cwd,
        key: "contextWatchdog.autoCompact",
        rawValue: "false",
      });
      expect(setAutoCompact.ok).toBe(true);

      const setAutoCompactCooldown = buildGuardrailsRuntimeConfigSetResult({
        cwd,
        key: "contextWatchdog.autoCompactCooldownMs",
        rawValue: "120000",
      });
      expect(setAutoCompactCooldown.ok).toBe(true);

      const contextSnapshot = readGuardrailsRuntimeConfigSnapshot(cwd);
      expect(contextSnapshot["longRunIntentQueue.rapidRedispatchWindowMs"]).toBe(45000);
      expect(contextSnapshot["longRunIntentQueue.dedupeWindowMs"]).toBe(50000);
      expect(contextSnapshot["longRunIntentQueue.identicalFailurePauseAfter"]).toBe(4);
      expect(contextSnapshot["longRunIntentQueue.orphanFailurePauseAfter"]).toBe(2);
      expect(contextSnapshot["longRunIntentQueue.identicalFailureWindowMs"]).toBe(90000);
      expect(contextSnapshot["longRunIntentQueue.orphanFailureWindowMs"]).toBe(70000);
      expect(contextSnapshot["longRunIntentQueue.defaultBoardMilestone"]).toBe("MS LOCAL");
      expect(contextSnapshot["contextWatchdog.modelSteeringFromLevel"]).toBe("checkpoint");
      expect(contextSnapshot["contextWatchdog.userNotifyFromLevel"]).toBe("checkpoint");
      expect(contextSnapshot["contextWatchdog.autoCompact"]).toBe(false);
      expect(contextSnapshot["contextWatchdog.autoCompactCooldownMs"]).toBe(120000);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("supports unset alias for default milestone runtime config key", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-runtime-config-unset-"));
    try {
      const setDefault = buildGuardrailsRuntimeConfigSetResult({
        cwd,
        key: "longRunIntentQueue.defaultBoardMilestone",
        rawValue: "MS-LOCAL",
      });
      expect(setDefault.ok).toBe(true);

      const unsetDefault = buildGuardrailsRuntimeConfigSetResult({
        cwd,
        key: "longRunIntentQueue.defaultBoardMilestone",
        rawValue: "unset",
      });
      expect(unsetDefault.ok).toBe(true);

      const snapshot = readGuardrailsRuntimeConfigSnapshot(cwd);
      expect(snapshot["longRunIntentQueue.defaultBoardMilestone"]).toBe("(unset)");
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

  it("detects wide single-file slice advisories without hard-block semantics", () => {
    const triggered = evaluateWideSingleFileSlice(
      { changedLines: 64, hunks: 4, filesTouched: 1 },
      { changedLines: 40, hunks: 2 },
    );
    expect(triggered.triggered).toBe(true);
    expect(triggered.reasons).toContain("wide-lines:64");
    expect(triggered.reasons).toContain("wide-hunks:4");
    expect(triggered.recommendation).toContain("split this file change into micro-slices");
    const status = buildWideSingleFileSliceStatusLabel(triggered);
    expect(status).toContain("[slice] wide-file");

    const oneHunkOnly = evaluateWideSingleFileSlice(
      { changedLines: 90, hunks: 1, filesTouched: 1 },
      { changedLines: 40, hunks: 2 },
    );
    expect(oneHunkOnly.triggered).toBe(false);

    const manyFiles = evaluateWideSingleFileSlice(
      { changedLines: 90, hunks: 4, filesTouched: 2 },
      { changedLines: 40, hunks: 2 },
    );
    expect(manyFiles.triggered).toBe(false);
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
      dispatchFailureBlockAfter: 3,
      rapidRedispatchWindowMs: BOARD_RAPID_REDISPATCH_WINDOW_MS,
      dedupeWindowMs: 120_000,
      identicalFailurePauseAfter: 3,
      orphanFailurePauseAfter: 1,
      identicalFailureWindowMs: 120_000,
      orphanFailureWindowMs: 120_000,
    };
    expect(shouldQueueInputForLongRun("registrar isso", true, cfg)).toBe(true);
    expect(shouldQueueInputForLongRun("/status", true, cfg)).toBe(false);
    expect(shouldQueueInputForLongRun("lane-now: processa agora", true, cfg)).toBe(false);
    expect(shouldQueueInputForLongRun("registrar isso", false, cfg)).toBe(false);
  });

  it("extracts lane-now override payload deterministically", () => {
    const cfg = { forceNowPrefix: "lane-now:" };
    expect(extractForceNowText("lane-now: processa agora", cfg)).toBe("processa agora");
    expect(extractForceNowText("  LANE-NOW:   revisar já   ", cfg)).toBe("revisar já");
    expect(extractForceNowText("lane-now:", cfg)).toBe("");
    expect(extractForceNowText("normal text", cfg)).toBeUndefined();
  });

  it("parses explicit lane-queue add payloads", () => {
    expect(parseLaneQueueAddText("add revisar isso depois")).toBe("revisar isso depois");
    expect(parseLaneQueueAddText("ADD   item")).toBe("item");
    expect(parseLaneQueueAddText("list")).toBeUndefined();
    expect(parseLaneQueueAddText("add")).toBeUndefined();
  });

  it("keeps milestone parser alias compatibility", () => {
    expect(parseLaneQueueMilestoneScope("board-next --milestone MS-LOCAL")).toEqual(
      parseLaneQueueBoardNextMilestone("board-next --milestone MS-LOCAL"),
    );
  });

  it("parses optional board-next milestone scope", () => {
    expect(parseLaneQueueBoardNextMilestone("board-next").milestone).toBeUndefined();
    expect(parseLaneQueueBoardNextMilestone("board-next --milestone MS-LOCAL").milestone).toBe("MS-LOCAL");
    expect(parseLaneQueueBoardNextMilestone("board-next --milestone=MS-FLAG").milestone).toBe("MS-FLAG");
    expect(parseLaneQueueBoardNextMilestone("board-next -m=MS-SHORT-FLAG").milestone).toBe("MS-SHORT-FLAG");
    expect(parseLaneQueueBoardNextMilestone("board-next -m \"MS   SHORT\"").milestone).toBe("MS SHORT");
    expect(parseLaneQueueBoardNextMilestone("board-next milestone=MS-REMOTE").milestone).toBe("MS-REMOTE");
    expect(parseLaneQueueBoardNextMilestone("board-next --milestone \"MS QUOTED\"").milestone).toBe("MS QUOTED");
    expect(parseLaneQueueBoardNextMilestone("board-next --milestone \"\"").error).toBe("invalid-board-next-args");
    expect(parseLaneQueueBoardNextMilestone("board-next --milestone \"MS-OPEN").error).toBe("invalid-board-next-args");
    expect(parseLaneQueueBoardNextMilestone("board-next -m='MS-CLOSE").error).toBe("invalid-board-next-args");
    expect(parseLaneQueueBoardNextMilestone("board-next --no-milestone").clearMilestone).toBe(true);
    expect(parseLaneQueueBoardNextMilestone("board-next --no-milestone oops").error).toBe("invalid-board-next-args");
    expect(parseLaneQueueBoardNextMilestone("board-next --oops").error).toBe("invalid-board-next-args");
    expect(parseLaneQueueBoardNextMilestone("status --milestone MS-LOCAL").milestone).toBe("MS-LOCAL");
    expect(parseLaneQueueBoardNextMilestone("status --no-milestone").clearMilestone).toBe(true);
    expect(parseLaneQueueBoardNextMilestone("status --milestone \"\"").error).toBe("invalid-board-next-args");
    expect(parseLaneQueueBoardNextMilestone("status nope").error).toBe("invalid-board-next-args");
    expect(parseLaneQueueBoardNextMilestone("evidence -m=MS-LOCAL").milestone).toBe("MS-LOCAL");
    expect(parseLaneQueueBoardNextMilestone("evidence --no-milestone").clearMilestone).toBe(true);
    expect(parseLaneQueueBoardNextMilestone("evidence --no-milestone oops").error).toBe("invalid-board-next-args");
  });

  it("evaluates milestone parity for evidence diagnostics", () => {
    const matched = evaluateLaneEvidenceMilestoneParity("MS-LOCAL", "MS-LOCAL", "MS-LOCAL");
    expect(matched.matches).toBe(true);
    expect(matched.reason).toBe("match");

    const mismatched = evaluateLaneEvidenceMilestoneParity("MS-LOCAL", "MS-A", "MS-B");
    expect(mismatched.matches).toBe(false);
    expect(mismatched.reason).toBe("mismatch");

    const noExpected = evaluateLaneEvidenceMilestoneParity(undefined, "MS-A", "MS-B");
    expect(noExpected.matches).toBe(true);
    expect(noExpected.reason).toBe("no-expectation");
  });

  it("escalates evidence notify when readiness/parity are degraded", () => {
    expect(shouldWarnLaneEvidence(true, { matches: true })).toBe(false);
    expect(shouldWarnLaneEvidence(false, { matches: true })).toBe(true);
    expect(shouldWarnLaneEvidence(true, { matches: false })).toBe(true);
  });

  it("resolves board-next milestone selection precedence", () => {
    const explicit = resolveLaneQueueBoardNextMilestoneSelection(
      parseLaneQueueBoardNextMilestone("board-next -m MS-EXP"),
      "MS-DEFAULT",
    );
    expect(explicit.source).toBe("explicit");
    expect(explicit.milestone).toBe("MS-EXP");

    const inherited = resolveLaneQueueBoardNextMilestoneSelection(
      parseLaneQueueBoardNextMilestone("board-next"),
      "\"MS   DEFAULT\"",
    );
    expect(inherited.source).toBe("default");
    expect(inherited.milestone).toBe("MS DEFAULT");

    const cleared = resolveLaneQueueBoardNextMilestoneSelection(
      parseLaneQueueBoardNextMilestone("board-next --no-milestone"),
      "MS-DEFAULT",
    );
    expect(cleared.source).toBe("cleared");
    expect(cleared.milestone).toBeUndefined();
  });

  it("builds help/status discoverability hints for lane-queue", () => {
    const helpLines = buildLaneQueueHelpLines();
    expect(helpLines.join("\n")).toContain("/lane-queue [status [--milestone <label>|-m <label>|-m=<label>|--no-milestone]|help|list|add <text>|board-next [--milestone <label>|-m <label>|-m=<label>|--no-milestone]|pop|clear|pause|resume|evidence [--milestone <label>|-m <label>|-m=<label>|--no-milestone]]");
    expect(helpLines.join("\n")).toContain("lane-now:<mensagem>");

    expect(buildLaneQueueStatusUsage()).toContain("/lane-queue status");
    expect(buildLaneQueueBoardNextUsage()).toContain("/lane-queue board-next");
    expect(buildLaneQueueEvidenceUsage()).toContain("/lane-queue evidence");

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

  it("dedupes recent queue entries when dedupe options are provided", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-intent-queue-dedupe-"));
    try {
      const intentText = [
        "[intent:board.execute-task]",
        "version=1",
        "task_id=TASK-BUD-119",
        "mode=board-first",
        "contract=no-auto-close+verification",
      ].join("\n");

      const first = enqueueDeferredIntent(cwd, intentText, "board-first-intent", 50, {
        dedupeKey: intentText,
        dedupeWindowMs: 60_000,
      });
      const second = enqueueDeferredIntent(cwd, `${intentText}   `, "board-first-intent", 50, {
        dedupeKey: `${intentText}\n\n`,
        dedupeWindowMs: 60_000,
      });

      expect(first.deduped).toBe(false);
      expect(second.deduped).toBe(true);
      expect(second.itemId).toBe(first.itemId);
      expect(listDeferredIntents(cwd)).toHaveLength(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("dedupes canonical intent envelopes despite key order differences", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-intent-queue-dedupe-order-"));
    try {
      const firstText = [
        "[intent:board.execute-task]",
        "version=1",
        "task_id=TASK-BUD-119",
        "mode=board-first",
        "contract=no-auto-close+verification",
      ].join("\n");
      const secondText = [
        "[intent:board.execute-task]",
        "contract=no-auto-close+verification",
        "mode=board-first",
        "task_id=TASK-BUD-119",
        "version=1",
      ].join("\n");

      const first = enqueueDeferredIntent(cwd, firstText, "board-first-intent", 50, {
        dedupeKey: firstText,
        dedupeWindowMs: 60_000,
      });
      const second = enqueueDeferredIntent(cwd, secondText, "board-first-intent", 50, {
        dedupeKey: secondText,
        dedupeWindowMs: 60_000,
      });

      expect(first.deduped).toBe(false);
      expect(second.deduped).toBe(true);
      expect(listDeferredIntents(cwd)).toHaveLength(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("dedupes board.execute-next milestone envelopes with reordered fields", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-intent-queue-dedupe-next-ms-"));
    try {
      const firstText = [
        "[intent:board.execute-next]",
        "version=1",
        "mode=board-first",
        "milestone=MS-LOCAL",
        "contract=no-auto-close+verification",
      ].join("\n");
      const secondText = [
        "[intent:board.execute-next]",
        "contract=no-auto-close+verification",
        "milestone=MS-LOCAL",
        "mode=board-first",
        "version=1",
      ].join("\n");

      const first = enqueueDeferredIntent(cwd, firstText, "board-first-intent", 50, {
        dedupeKey: firstText,
        dedupeWindowMs: 60_000,
      });
      const second = enqueueDeferredIntent(cwd, secondText, "board-first-intent", 50, {
        dedupeKey: secondText,
        dedupeWindowMs: 60_000,
      });

      expect(first.deduped).toBe(false);
      expect(second.deduped).toBe(true);
      expect(listDeferredIntents(cwd)).toHaveLength(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("allows enqueue after dedupe window expires", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-intent-queue-dedupe-expire-"));
    try {
      const intentText = "[intent:board.execute-task]\nversion=1\ntask_id=TASK-BUD-119";
      const first = enqueueDeferredIntent(cwd, intentText, "board-first-intent", 50, {
        dedupeKey: intentText,
        dedupeWindowMs: 5_000,
      });
      expect(first.deduped).toBe(false);

      const queuePath = join(cwd, ".pi", "deferred-intents.json");
      const json = JSON.parse(readFileSync(queuePath, "utf8"));
      json.items[0].atIso = "2000-01-01T00:00:00.000Z";
      writeFileSync(queuePath, `${JSON.stringify(json, null, 2)}\n`, "utf8");

      const second = enqueueDeferredIntent(cwd, intentText, "board-first-intent", 50, {
        dedupeKey: intentText,
        dedupeWindowMs: 5_000,
      });
      expect(second.deduped).toBe(false);
      expect(listDeferredIntents(cwd)).toHaveLength(2);
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

  it("renews long-run lease when mode is reasserted on session start", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-long-run-loop-lease-renew-"));
    try {
      mkdirSync(join(cwd, ".pi"), { recursive: true });
      writeFileSync(
        join(cwd, ".pi", "long-run-loop-state.json"),
        JSON.stringify({
          version: 1,
          mode: "running",
          health: "healthy",
          leaseOwner: "guardrails-core:stale",
          leaseTtlMs: 30_000,
          leaseHeartbeatAtIso: "2026-04-23T21:52:43.462Z",
          leaseExpiresAtIso: "2026-04-23T21:53:13.462Z",
          stopCondition: "none",
          stopReason: "running",
          consecutiveDispatchFailures: 0,
          updatedAtIso: "2026-04-23T21:52:43.462Z",
          lastTransitionIso: "2026-04-23T21:52:41.934Z",
          lastTransitionReason: "init",
        }),
      );

      const expired = readLongRunLoopRuntimeState(cwd);
      const nowMs = Date.parse("2026-04-24T01:00:00.000Z");
      expect(resolveAutoDrainRuntimeGateReason("ready", expired, nowMs)).toBe("lease-expired");

      const renewed = setLongRunLoopRuntimeMode(cwd, "running", "session-start-lease-renew").state;
      expect(renewed.mode).toBe("running");
      expect(renewed.health).toBe("healthy");
      expect(renewed.stopCondition).toBe("none");
      expect(Date.parse(renewed.leaseExpiresAtIso)).toBeGreaterThan(Date.now());
      expect(renewed.leaseOwner).toContain("guardrails-core:");
      expect(resolveAutoDrainRuntimeGateReason("ready", renewed, Date.now())).toBe("ready");
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
                defaultBoardMilestone: "  \"MS   DEFAULT\"  ",
                autoDrainOnIdle: false,
                autoDrainCooldownMs: 8000,
                autoDrainBatchSize: 4,
                autoDrainIdleStableMs: 5000,
                dispatchFailureBlockAfter: 5,
                rapidRedispatchWindowMs: 45_000,
                dedupeWindowMs: 50_000,
                identicalFailurePauseAfter: 6,
                orphanFailurePauseAfter: 2,
                identicalFailureWindowMs: 90_000,
                orphanFailureWindowMs: 70_000,
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
      expect(cfg.defaultBoardMilestone).toBe("MS DEFAULT");
      expect(cfg.autoDrainOnIdle).toBe(false);
      expect(cfg.autoDrainCooldownMs).toBe(8000);
      expect(cfg.autoDrainBatchSize).toBe(4);
      expect(cfg.autoDrainIdleStableMs).toBe(5000);
      expect(cfg.dispatchFailureBlockAfter).toBe(5);
      expect(cfg.rapidRedispatchWindowMs).toBe(45_000);
      expect(cfg.dedupeWindowMs).toBe(50_000);
      expect(cfg.identicalFailurePauseAfter).toBe(6);
      expect(cfg.orphanFailurePauseAfter).toBe(2);
      expect(cfg.identicalFailureWindowMs).toBe(90_000);
      expect(cfg.orphanFailureWindowMs).toBe(70_000);

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

  it("ignores blank/quoted-empty default milestone config", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-intent-queue-default-ms-empty-"));
    try {
      mkdirSync(join(cwd, ".pi"), { recursive: true });
      writeFileSync(
        join(cwd, ".pi", "settings.json"),
        JSON.stringify({
          piStack: {
            guardrailsCore: {
              longRunIntentQueue: {
                defaultBoardMilestone: "\"\"",
              },
            },
          },
        }),
      );
      expect(resolveLongRunIntentQueueConfig(cwd).defaultBoardMilestone).toBeUndefined();
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
    const labelA = "READY=yes ACTIVE_HERE=no IN_LOOP=no blocker=runtime-reload-required";
    const labelB = "READY=yes ACTIVE_HERE=yes IN_LOOP=yes blocker=none";

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

  it("builds loop activation markers for READY/ACTIVE_HERE/IN_LOOP", () => {
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
    expect(buildLoopActivationMarkersLabel(readyMarkers)).toContain("READY=yes");
    expect(buildLoopActivationMarkersLabel(readyMarkers)).toContain("IN_LOOP=yes");
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

  it("computes deterministic loop evidence readiness for task-bud-125 closure", () => {
    const ready = computeLoopEvidenceReadiness({
      version: 1,
      updatedAtIso: "2026-04-23T19:00:00.000Z",
      lastBoardAutoAdvance: {
        atIso: "2026-04-23T19:00:00.000Z",
        taskId: "TASK-BUD-125",
        runtimeCodeState: "active",
        markersLabel: "READY=yes ACTIVE_HERE=yes IN_LOOP=yes blocker=none",
        emLoop: true,
      },
      lastLoopReady: {
        atIso: "2026-04-23T18:59:59.000Z",
        markersLabel: "READY=yes ACTIVE_HERE=yes IN_LOOP=yes blocker=none",
        runtimeCodeState: "active",
        boardAutoAdvanceGate: "ready",
        nextTaskId: "TASK-BUD-125",
      },
    });
    expect(ready.readyForTaskBud125).toBe(true);
    expect(ready.criteria.join(" |")).toContain("boardAuto.runtime=active:yes");

    const blocked = computeLoopEvidenceReadiness({
      version: 1,
      updatedAtIso: "2026-04-23T19:00:00.000Z",
      lastBoardAutoAdvance: {
        atIso: "2026-04-23T19:00:00.000Z",
        taskId: "TASK-BUD-125",
        runtimeCodeState: "reload-required",
        markersLabel: "READY=yes ACTIVE_HERE=no IN_LOOP=no blocker=runtime-reload-required",
        emLoop: false,
      },
      lastLoopReady: undefined,
    });
    expect(blocked.readyForTaskBud125).toBe(false);
    expect(blocked.criteria.join(" |")).toContain("boardAuto.runtime=active:no");
  });

  it("refreshes loop-evidence snapshot only when runtime lease is still active", () => {
    const nowMs = Date.parse("2026-04-24T00:45:00.000Z");

    expect(shouldRefreshLoopEvidenceFromRuntimeSnapshot({
      mode: "running",
      health: "healthy",
      stopCondition: "none",
      leaseExpiresAtIso: "2026-04-24T00:45:20.000Z",
    }, nowMs)).toBe(true);

    expect(shouldRefreshLoopEvidenceFromRuntimeSnapshot({
      mode: "running",
      health: "healthy",
      stopCondition: "none",
      leaseExpiresAtIso: "2026-04-24T00:44:30.000Z",
    }, nowMs)).toBe(false);

    expect(shouldRefreshLoopEvidenceFromRuntimeSnapshot({
      mode: "paused",
      health: "healthy",
      stopCondition: "manual-pause",
      leaseExpiresAtIso: "2026-04-24T00:45:20.000Z",
    }, nowMs)).toBe(false);
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
    expect(classifyLongRunDispatchFailure("No tool call found for function call output with call_id call_abc123")).toBe("tool-output-orphan");
    expect(classifyLongRunDispatchFailure("unexpected parser error")).toBe("other");
    expect(resolveDispatchFailurePauseAfter("tool-output-orphan", 3)).toBe(1);
    expect(resolveDispatchFailurePauseAfter("tool-output-orphan", 3, 2)).toBe(2);
    expect(resolveDispatchFailurePauseAfter("provider-transient", 3)).toBe(3);
    expect(resolveDispatchFailurePauseAfter("other", 0)).toBe(3);
    expect(resolveDispatchFailureWindowMs("tool-output-orphan", 120_000, 70_000)).toBe(70_000);
    expect(resolveDispatchFailureWindowMs("provider-transient", 120_000, 70_000)).toBe(120_000);

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

    const orphanActions = buildToolOutputOrphanRecoveryActionLines();
    expect(orphanActions).toHaveLength(3);
    expect(orphanActions.join("\n")).toContain("/reload");
    expect(orphanActions.join("\n")).toContain("/lane-queue status");
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

  it("normalizes dispatch failure fingerprints deterministically", () => {
    const raw = "No tool call found for function call output with call_id call_QJlU6a2DGglAm3NntokWyBwo and hash 0123456789abcdef0123456789abcdef";
    const variant = "No tool call found for function call output with tool_call_id='alt-run-777' and hash 0123456789abcdef0123456789abcdef";
    const jsonVariant = "No tool call found for function call output payload={\"tool_call_id\":\"alt.run/777\"} and hash 0123456789abcdef0123456789abcdef";
    const normalized = normalizeDispatchFailureFingerprint(raw, 200);
    const normalizedVariant = normalizeDispatchFailureFingerprint(variant, 200);
    const normalizedJsonVariant = normalizeDispatchFailureFingerprint(jsonVariant, 200);
    expect(normalized).toContain("call_*");
    expect(normalized).toContain("hex_*");
    expect(normalized).not.toContain("call_QJlU6a2DGglAm3NntokWyBwo");
    expect(normalized).toBe(normalizedVariant);
    expect(normalizedJsonVariant).toContain("call_*=call_*");
    expect(normalizedJsonVariant).toContain("hex_*");
    expect(normalizedJsonVariant).not.toContain("alt.run/777");
  });

  it("increments identical failure streak only inside configured window", () => {
    const first = computeIdenticalFailureStreak({
      nextErrorText: "No tool call found for function call output with call_id call_abc123",
      nowMs: 10_000,
      windowMs: 60_000,
    });
    expect(first.streak).toBe(1);

    const second = computeIdenticalFailureStreak({
      lastFingerprint: first.fingerprint,
      lastFailureAtMs: 10_000,
      streak: first.streak,
      nextErrorText: "No tool call found for function call output with tool_call_id='xyz.999/phase-a'",
      nowMs: 20_000,
      windowMs: 60_000,
    });
    expect(second.withinWindow).toBe(true);
    expect(second.streak).toBe(2);

    const third = computeIdenticalFailureStreak({
      lastFingerprint: second.fingerprint,
      lastFailureAtMs: 20_000,
      streak: second.streak,
      nextErrorText: "No tool call found for function call output with call_id call_zzz",
      nowMs: 90_500,
      windowMs: 60_000,
    });
    expect(third.withinWindow).toBe(false);
    expect(third.streak).toBe(1);
  });

  it("pauses only when identical failure streak reaches threshold", () => {
    expect(shouldPauseOnIdenticalFailure(1, 3)).toBe(false);
    expect(shouldPauseOnIdenticalFailure(2, 3)).toBe(false);
    expect(shouldPauseOnIdenticalFailure(3, 3)).toBe(true);
    expect(shouldPauseOnIdenticalFailure(4, 3)).toBe(true);
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
      dispatchFailureBlockAfter: 3,
      rapidRedispatchWindowMs: BOARD_RAPID_REDISPATCH_WINDOW_MS,
      dedupeWindowMs: 120_000,
      identicalFailurePauseAfter: 3,
      orphanFailurePauseAfter: 1,
      identicalFailureWindowMs: 120_000,
      orphanFailureWindowMs: 120_000,
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

  it("blocks rapid same-task re-dispatch to catch silent execution failures", () => {
    const nowMs = Date.now();
    const recentIso = new Date(nowMs - 60_000).toISOString(); // 1 min ago (within 5 min window)
    const staleIso = new Date(nowMs - 6 * 60_000).toISOString(); // 6 min ago (outside window)

    // Should block: same task, within window
    expect(shouldBlockRapidSameTaskRedispatch({
      taskId: "TASK-BUD-067",
      lastDispatchItemId: "board-auto-TASK-BUD-067",
      lastDispatchAtIso: recentIso,
      nowMs,
    })).toBe(true);

    // Should NOT block: different task
    expect(shouldBlockRapidSameTaskRedispatch({
      taskId: "TASK-BUD-068",
      lastDispatchItemId: "board-auto-TASK-BUD-067",
      lastDispatchAtIso: recentIso,
      nowMs,
    })).toBe(false);

    // Should NOT block: same task but stale (outside 5 min window)
    expect(shouldBlockRapidSameTaskRedispatch({
      taskId: "TASK-BUD-067",
      lastDispatchItemId: "board-auto-TASK-BUD-067",
      lastDispatchAtIso: staleIso,
      nowMs,
    })).toBe(false);

    // Should NOT block: no prior dispatch
    expect(shouldBlockRapidSameTaskRedispatch({
      taskId: "TASK-BUD-067",
      lastDispatchItemId: undefined,
      lastDispatchAtIso: undefined,
      nowMs,
    })).toBe(false);

    // Should NOT block: lastDispatchItemId format doesn't match board-auto-* prefix
    expect(shouldBlockRapidSameTaskRedispatch({
      taskId: "TASK-BUD-067",
      lastDispatchItemId: "intent-TASK-BUD-067",
      lastDispatchAtIso: recentIso,
      nowMs,
    })).toBe(false);

    // Respects custom windowMs
    expect(shouldBlockRapidSameTaskRedispatch({
      taskId: "TASK-BUD-067",
      lastDispatchItemId: "board-auto-TASK-BUD-067",
      lastDispatchAtIso: recentIso,
      nowMs,
      windowMs: 30_000, // 30s window — 60s ago is outside
    })).toBe(false);

    // Constant is 5 minutes
    expect(BOARD_RAPID_REDISPATCH_WINDOW_MS).toBe(5 * 60 * 1000);
  });
});
