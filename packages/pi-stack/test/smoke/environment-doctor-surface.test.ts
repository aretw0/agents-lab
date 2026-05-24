import { describe, expect, it, vi } from "vitest";
import environmentDoctorExtension from "../../extensions/environment-doctor";
import { resolveEnvironmentRuntimeHealthDecision } from "../../extensions/environment-doctor-runtime-health";

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

  it("environment_doctor_status includes issue details in compact summary", async () => {
    const pi = {
      ...makeMockPi(),
      exec: vi.fn(async (command: string) => {
        if (command === "gh") {
          return { code: 1, stdout: "", stderr: "gh missing" };
        }
        return { code: 0, stdout: `${command} version\n`, stderr: "" };
      }),
    } as unknown as ReturnType<typeof makeMockPi>;
    environmentDoctorExtension(pi);
    const tool = getTool(pi, "environment_doctor_status");

    const result = await tool.execute(
      "tc-environment-doctor-issue-summary",
      { includeAuthChecks: false },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );
    const text = String(result.content?.[0]?.text ?? "");

    expect(text).toContain("issues=1");
    expect(text).toContain("issueDetails=");
    expect(text).toContain("gh");
    expect(text).toContain("Nao encontrado");
  });

  it("environment_doctor_status treats missing glab as optional noise", async () => {
    const pi = {
      ...makeMockPi(),
      exec: vi.fn(async (command: string) => {
        if (command === "glab") {
          return { code: 1, stdout: "", stderr: "glab missing" };
        }
        return { code: 0, stdout: `${command} version\n`, stderr: "" };
      }),
    } as unknown as ReturnType<typeof makeMockPi>;
    environmentDoctorExtension(pi);
    const tool = getTool(pi, "environment_doctor_status");

    const result = await tool.execute(
      "tc-environment-doctor-optional-glab",
      { includeAuthChecks: false },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );
    const text = String(result.content?.[0]?.text ?? "");

    expect(text).toContain("ok=yes");
    expect(text).toContain("issues=0");
    expect(text).toContain("optionalIssues=1");
    expect(text).toContain("optionalIssueDetails=error:glab=Nao encontrado");
    expect((result.details as any)?.optionalIssues?.[0]?.name).toBe("glab");
  });

  it("environment_runtime_health_status aggregates read-only go/no-go checks", async () => {
    const pi = makeMockPi();
    environmentDoctorExtension(pi);
    const tool = getTool(pi, "environment_runtime_health_status");

    const result = await tool.execute(
      "tc-environment-runtime-health",
      { includeAuthChecks: false },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );
    const text = String(result.content?.[0]?.text ?? "");

    expect(text).toContain("environment-runtime-health:");
    expect(text).toContain("decision=");
    expect(text).toContain("devPressurePrimary=");
    expect(text).toContain("devPressureAction=");
    expect(text).toContain("liveWatchdog=unavailable");
    expect(text).toContain("watchdogSource=external-pressure-and-persisted-evidence");
    expect((result.details as any)?.mode).toBe("environment-runtime-health");
    expect((result.details as any)?.watchdog?.liveMetricsAvailable).toBe(false);
  });

  it("runtime health decision blocks hard failures and keeps optional pressure advisory", () => {
    expect(resolveEnvironmentRuntimeHealthDecision({
      doctorIssues: [],
      devPressureRecommendation: "continue",
      devPressureSeverity: "warn",
      runtimeArtifactViolations: [],
    })).toBe("continue");
    expect(resolveEnvironmentRuntimeHealthDecision({
      doctorIssues: [],
      devPressureRecommendation: "new-session",
      devPressureSeverity: "ok",
      runtimeArtifactViolations: [],
    })).toBe("safe-mode");
    expect(resolveEnvironmentRuntimeHealthDecision({
      doctorIssues: [{ name: "gh" }],
      devPressureRecommendation: "continue",
      devPressureSeverity: "ok",
      runtimeArtifactViolations: [],
    })).toBe("stop-and-investigate");
  });
});
