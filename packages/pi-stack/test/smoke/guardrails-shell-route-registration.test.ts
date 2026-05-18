import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import guardrailsCore from "../../extensions/guardrails-core";

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
});
