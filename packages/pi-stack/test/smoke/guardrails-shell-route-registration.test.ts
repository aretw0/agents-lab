import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import guardrailsCore from "../../extensions/guardrails-core";

function makeMockPi() {
  return {
    on: vi.fn(),
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
  } as unknown as Parameters<typeof guardrailsCore>[0];
}

describe("guardrails-core shell-route registration", () => {
  it("registers /shell-route command", () => {
    const pi = makeMockPi();
    guardrailsCore(pi);

    const commands = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      ([name]) => name as string,
    );

    expect(commands).toContain("shell-route");
    expect(commands).toContain("guardrails-config");
    expect(commands).toContain("lane-queue");
  });

  it("executes /lane-queue status without missing loop marker helpers", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "lane-queue-status-smoke-"));
    mkdirSync(join(cwd, ".project"), { recursive: true });
    writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [] }), "utf8");

    const pi = makeMockPi();
    guardrailsCore(pi);
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
