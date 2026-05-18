import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import guardrailsCore from "../../extensions/guardrails-core";
import { buildLoopEvidenceReadinessPacket } from "../../extensions/guardrails-core-lane-queue-surface";

function makeMockPi() {
  const handlers = new Map<string, Function[]>();
  return {
    on: vi.fn((event: string, handler: Function) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
    emit: async (event: string, ctx: unknown) => {
      for (const handler of handlers.get(event) ?? []) {
        await handler({}, ctx);
      }
    },
  } as unknown as Parameters<typeof guardrailsCore>[0];
}

function makeCtx(cwd: string) {
  return {
    cwd,
    isIdle: () => true,
    hasPendingMessages: () => false,
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      setEditorText: vi.fn(),
    },
  };
}

describe("guardrails-core shell-route registration", () => {
  it("registers /shell-route command on session start by default", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "guardrails-surfaces-default-"));
    const pi = makeMockPi();
    guardrailsCore(pi);
    await (pi as unknown as { emit: (event: string, ctx: unknown) => Promise<void> }).emit("session_start", makeCtx(cwd));

    const commands = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      ([name]) => name as string,
    );

    expect(commands).toContain("shell-route");
    expect(commands).toContain("guardrails-config");
    expect(commands).toContain("lane-queue");
  });

  it("keeps command surfaces out of lean sessions when disabled", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "guardrails-surfaces-disabled-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({ piStack: { guardrailsCore: { surfaces: { enabled: false } } } }),
      "utf8",
    );

    const pi = makeMockPi();
    guardrailsCore(pi);
    await (pi as unknown as { emit: (event: string, ctx: unknown) => Promise<void> }).emit("session_start", makeCtx(cwd));

    const commands = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      ([name]) => name as string,
    );

    expect(commands).not.toContain("shell-route");
    expect(commands).not.toContain("guardrails-config");
    expect(commands).not.toContain("lane-queue");
  });

  it("executes /lane-queue status without missing loop marker helpers", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "lane-queue-status-smoke-"));
    mkdirSync(join(cwd, ".project"), { recursive: true });
    writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [] }), "utf8");

    const pi = makeMockPi();
    guardrailsCore(pi);
    await (pi as unknown as { emit: (event: string, ctx: unknown) => Promise<void> }).emit("session_start", makeCtx(cwd));
    const laneQueue = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([name]) => name === "lane-queue",
    )?.[1] as { handler: (args: string, ctx: unknown) => Promise<void> | void } | undefined;

    expect(laneQueue).toBeDefined();
    const notify = vi.fn();
    await laneQueue?.handler("status", {
      cwd,
      isIdle: () => true,
      hasPendingMessages: () => false,
      ui: {
        notify,
        setStatus: vi.fn(),
        setEditorText: vi.fn(),
      },
    });

    expect(notify).toHaveBeenCalled();
    const message = String(notify.mock.calls[0]?.[0] ?? "");
    expect(message).toContain("READY=");
    expect(message).toContain("loop=");
  });

  it("exposes loop evidence readiness as a read-only strict tool", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "lane-queue-evidence-tool-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi", "guardrails-loop-evidence.json"),
      JSON.stringify({
        version: 1,
        updatedAtIso: "2026-05-01T00:00:00.000Z",
        lastBoardAutoAdvance: {
          atIso: "2026-05-01T00:00:00.000Z",
          taskId: "TASK-1",
          milestone: "release",
          runtimeCodeState: "active",
          markersLabel: "IN_LOOP",
          emLoop: true,
        },
        lastLoopReady: {
          atIso: "2026-05-01T00:00:00.000Z",
          markersLabel: "IN_LOOP",
          runtimeCodeState: "active",
          boardAutoAdvanceGate: "ready",
          nextTaskId: "TASK-2",
          milestone: "release",
        },
      }),
      "utf8",
    );

    const packet = buildLoopEvidenceReadinessPacket({
      cwd,
      nowMs: Date.parse("2026-05-01T00:05:00.000Z"),
      strict: true,
      expectedMilestone: "release",
      maxAgeMin: 30,
    });

    expect(packet.ok).toBe(true);
    expect(packet.strictFailures).toEqual([]);
    expect(packet.summary).toContain("ready=yes");

    const pi = makeMockPi();
    guardrailsCore(pi);
    await (pi as unknown as { emit: (event: string, ctx: unknown) => Promise<void> }).emit("session_start", makeCtx(cwd));
    const tool = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(
      ([def]) => def?.name === "guardrails_loop_evidence_readiness",
    )?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => { content?: Array<{ text?: string }>; details?: Record<string, unknown> };
    } | undefined;

    expect(tool).toBeDefined();
    const result = tool?.execute(
      "tc-loop-evidence",
      { strict: true, expected_milestone: "release", max_age_min: 30 },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd },
    );

    expect(String(result?.content?.[0]?.text ?? "")).toContain("guardrails-loop-evidence-readiness:");
    expect((result?.details as any)?.dispatchAllowed).toBe(false);
    expect((result?.details as any)?.strictFailures).toEqual([]);
  });

  it("loop evidence readiness fails closed for missing strict evidence", () => {
    const cwd = mkdtempSync(join(tmpdir(), "lane-queue-evidence-missing-"));
    const packet = buildLoopEvidenceReadinessPacket({
      cwd,
      nowMs: Date.parse("2026-05-01T00:05:00.000Z"),
      strict: true,
    });

    expect(packet.status).toBe("missing");
    expect(packet.ok).toBe(false);
    expect(packet.strictFailures).toContain("evidence-missing");
    expect(packet.strictFailures).toContain("readiness-not-ready");
  });
});
