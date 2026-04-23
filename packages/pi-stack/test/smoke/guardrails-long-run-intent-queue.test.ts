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
  shouldEmitAutoDrainDeferredAudit,
  readLongRunLoopRuntimeState,
  setLongRunLoopRuntimeMode,
  markLongRunLoopRuntimeDegraded,
  markLongRunLoopRuntimeDispatch,
  markLongRunLoopRuntimeHealthy,
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
    expect(helpLines.join("\n")).toContain("/lane-queue [status|help|list|add <text>|pop|clear|pause|resume]");

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
      expect(degraded.stopCondition).toBe("manual-pause");

      const resumed = setLongRunLoopRuntimeMode(cwd, "running", "manual-resume").state;
      expect(resumed.mode).toBe("running");
      expect(resumed.stopCondition).toBe("dispatch-failure");
      expect(resumed.stopReason).toBe("manual-resume");

      const dispatched = markLongRunLoopRuntimeDispatch(cwd, "intent-123").state;
      expect(dispatched.health).toBe("healthy");
      expect(dispatched.lastDispatchItemId).toBe("intent-123");
      expect(dispatched.lastError).toBeUndefined();
      expect(dispatched.stopCondition).toBe("none");
      expect(dispatched.stopReason).toBe("running");

      const healthy = markLongRunLoopRuntimeHealthy(cwd, "manual-resume").state;
      expect(healthy.health).toBe("healthy");
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
