import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGuardrailsSafeMutationSurface } from "../../extensions/guardrails-core-safe-mutation-surface";
import { registerGuardrailsStructuredIoSurface } from "../../extensions/guardrails-core-structured-io-surface";
import { isInsideCwd } from "../../extensions/guardrails-core-path-guard";

const appendAuditEntry = vi.fn();

function makeMockPi() {
  return {
    on: vi.fn(),
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
  } as unknown as ExtensionAPI;
}

describe("guardrails-core safe-mutation registration", () => {
  it("registers /safe-mutation and /structured-io commands", () => {
    const pi = makeMockPi();
    registerGuardrailsSafeMutationSurface(pi, appendAuditEntry);
    registerGuardrailsStructuredIoSurface(pi, appendAuditEntry, isInsideCwd);

    const commands = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      ([name]) => name as string,
    );

    expect(commands).toContain("safe-mutation");
    expect(commands).toContain("structured-io");
  });
});
