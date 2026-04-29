import { describe, expect, it } from "vitest";
import { resolveToolCadenceDecision } from "../../extensions/guardrails-core-tool-cadence";

describe("guardrails tool cadence", () => {
  it("keeps routine diagnostics out of the executor hot path", () => {
    expect(resolveToolCadenceDecision({ kind: "machine-maintenance", mode: "hot-path" })).toMatchObject({
      allow: false,
      cadence: "avoid",
      reason: "hot-path-context-economy",
    });
  });

  it("allows bounded board evidence on the hot path", () => {
    expect(resolveToolCadenceDecision({ kind: "board-surface", mode: "hot-path" })).toMatchObject({
      allow: true,
      cadence: "bounded-query",
      reason: "hot-path-board-evidence",
    });
  });

  it("validates only relevant runtime surfaces after reload", () => {
    expect(resolveToolCadenceDecision({ kind: "context-watch", runtimeChanged: true })).toMatchObject({
      allow: true,
      cadence: "single-check",
      reason: "post-reload-validation",
    });
    expect(resolveToolCadenceDecision({ kind: "session-analytics", runtimeChanged: true })).toMatchObject({
      allow: false,
      cadence: "avoid",
      reason: "post-reload-not-relevant",
    });
  });

  it("uses autonomy and board surfaces for selection only", () => {
    expect(resolveToolCadenceDecision({ kind: "autonomy-lane", selectingTask: true })).toMatchObject({
      allow: true,
      cadence: "bounded-query",
      reason: "task-selection",
    });
    expect(resolveToolCadenceDecision({ kind: "monitor-diagnostics", selectingTask: true })).toMatchObject({
      allow: false,
      reason: "selection-not-required",
    });
  });

  it("reserves diagnostic packs for troubleshooting or explicit request", () => {
    expect(resolveToolCadenceDecision({ kind: "monitor-diagnostics", hasErrorSignal: true })).toMatchObject({
      allow: true,
      cadence: "diagnostic-pack",
      reason: "troubleshooting",
    });
    expect(resolveToolCadenceDecision({ kind: "session-analytics", explicitUserRequest: true })).toMatchObject({
      allow: true,
      cadence: "single-check",
      reason: "explicit-user-request",
    });
  });
});
