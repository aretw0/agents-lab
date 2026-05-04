import { describe, expect, it } from "vitest";

import {
  resolvePostReloadPendingNotifyDecision,
  type AutoResumeDispatchReason,
} from "../../extensions/context-watchdog-resume";

describe("context-watchdog-resume", () => {
  it("emits first pending post-reload warning when no prior memory exists", () => {
    const decision = resolvePostReloadPendingNotifyDecision({
      nowMs: 1_000,
      intentCreatedAtIso: "2026-05-04T12:00:00.000Z",
      reason: "checkpoint-evidence-missing",
      previous: {},
      cooldownMs: 60_000,
      minCooldownMs: 5 * 60_000,
    });

    expect(decision.shouldEmit).toBe(true);
    expect(decision.next).toMatchObject({
      reason: "checkpoint-evidence-missing",
      intentCreatedAtIso: "2026-05-04T12:00:00.000Z",
      lastNotifyAtMs: 1_000,
    });
  });

  it("suppresses repeated pending warning while cooldown is active and state is unchanged", () => {
    const reason: AutoResumeDispatchReason = "checkpoint-evidence-missing";
    const first = resolvePostReloadPendingNotifyDecision({
      nowMs: 10_000,
      intentCreatedAtIso: "2026-05-04T12:00:00.000Z",
      reason,
      previous: {},
      cooldownMs: 60_000,
      minCooldownMs: 5 * 60_000,
    });

    const second = resolvePostReloadPendingNotifyDecision({
      nowMs: 30_000,
      intentCreatedAtIso: "2026-05-04T12:00:00.000Z",
      reason,
      previous: first.next,
      cooldownMs: 60_000,
      minCooldownMs: 5 * 60_000,
    });

    expect(second.shouldEmit).toBe(false);
    expect(second.next.lastNotifyAtMs).toBe(10_000);
  });

  it("re-emits immediately when reason changes even within cooldown", () => {
    const first = resolvePostReloadPendingNotifyDecision({
      nowMs: 10_000,
      intentCreatedAtIso: "2026-05-04T12:00:00.000Z",
      reason: "checkpoint-evidence-missing",
      previous: {},
      cooldownMs: 60_000,
      minCooldownMs: 5 * 60_000,
    });

    const second = resolvePostReloadPendingNotifyDecision({
      nowMs: 15_000,
      intentCreatedAtIso: "2026-05-04T12:00:00.000Z",
      reason: "board-handoff-divergence",
      previous: first.next,
      cooldownMs: 60_000,
      minCooldownMs: 5 * 60_000,
    });

    expect(second.shouldEmit).toBe(true);
    expect(second.next.reason).toBe("board-handoff-divergence");
    expect(second.next.lastNotifyAtMs).toBe(15_000);
  });
});
