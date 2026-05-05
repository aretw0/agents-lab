import { describe, expect, it, vi } from "vitest";
import environmentDoctorExtension from "../../extensions/environment-doctor";

function makeMockPi() {
  return {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    getCommands: vi.fn(() => []),
    exec: vi.fn(async (command: string) => ({
      code: 0,
      stdout: `${command} version\n`,
      stderr: "",
    })),
  } as unknown as Parameters<typeof environmentDoctorExtension>[0];
}

function getTool(pi: ReturnType<typeof makeMockPi>, name: string) {
  const call = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(
    ([tool]) => tool?.name === name,
  );
  if (!call) throw new Error(`tool not found: ${name}`);
  return call[0] as {
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal,
      onUpdate: (update: unknown) => void,
      ctx: { cwd: string },
    ) => Promise<{ content?: Array<{ text?: string }>; details?: Record<string, unknown> }>;
  };
}

describe("environment-doctor surface", () => {
  it("environment_doctor_status emits summary-first content with details preserved", async () => {
    const pi = makeMockPi();
    environmentDoctorExtension(pi);
    const tool = getTool(pi, "environment_doctor_status");

    const result = await tool.execute(
      "tc-environment-doctor-status",
      { includeAuthChecks: false },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );

    expect(result.details?.profile).toBe("default");
    expect(typeof result.details?.okCount).toBe("number");
    expect(String(result.content?.[0]?.text ?? "")).toContain("environment-doctor:");
    expect(String(result.content?.[0]?.text ?? "")).toContain("payload completo disponível em details");
    expect(String(result.content?.[0]?.text ?? "")).not.toContain('\"platform\"');
  });
});
