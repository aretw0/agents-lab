import { describe, expect, it, vi } from "vitest";
import guardrailsCore from "../../extensions/guardrails-core";

function makeMockPi() {
  return {
    on: vi.fn(),
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
    sendUserMessage: vi.fn(),
  } as unknown as Parameters<typeof guardrailsCore>[0];
}

function getCommand(pi: ReturnType<typeof makeMockPi>, name: string) {
  const call = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
    ([commandName]) => commandName === name,
  );
  if (!call) throw new Error(`command not found: ${name}`);
  return call[1] as { handler: (args: string, ctx: any) => Promise<void> | void };
}

describe("guardrails-core macro-refactor command", () => {
  it("defaults to dry-run for rename-symbol", async () => {
    const pi = makeMockPi();
    guardrailsCore(pi);
    const command = getCommand(pi, "macro-refactor");
    const notify = vi.fn();

    await command.handler("rename-symbol OldName NewName --scope workspace", {
      cwd: process.cwd(),
      ui: { notify },
      hasUI: true,
    });

    const message = String(notify.mock.calls.at(-1)?.[0] ?? "");
    expect(message).toContain("macro-refactor rename-symbol");
    expect(message).toContain('"dryRun": true');
    expect(message).toContain('"reason": "preview-ready"');
  });

  it("supports apply flag and reports engine-unavailable fallback", async () => {
    const pi = makeMockPi();
    guardrailsCore(pi);
    const command = getCommand(pi, "macro-refactor");
    const notify = vi.fn();

    await command.handler("format-target src/main.ts --start 10 --end 20 --apply", {
      cwd: process.cwd(),
      ui: { notify },
      hasUI: true,
    });

    const message = String(notify.mock.calls.at(-1)?.[0] ?? "");
    expect(message).toContain("macro-refactor format-target");
    expect(message).toContain('"applyRequested": true');
    expect(message).toContain('"reason": "engine-unavailable"');
  });
});
