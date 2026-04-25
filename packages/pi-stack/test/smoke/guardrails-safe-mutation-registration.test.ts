import { describe, expect, it, vi } from "vitest";
import guardrailsCore from "../../extensions/guardrails-core";

function makeMockPi() {
  return {
    on: vi.fn(),
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
  } as unknown as Parameters<typeof guardrailsCore>[0];
}

describe("guardrails-core safe-mutation registration", () => {
  it("registers /safe-mutation and /structured-io commands", () => {
    const pi = makeMockPi();
    guardrailsCore(pi);

    const commands = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      ([name]) => name as string,
    );

    expect(commands).toContain("safe-mutation");
    expect(commands).toContain("structured-io");
  });
});
