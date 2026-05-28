import { describe, expect, it, vi } from "vitest";
import environmentDoctorExtension from "../../extensions/environment-doctor";
import { buildEnvironmentRuntimeHealthPayload, resolveEnvironmentRuntimeHealthDecision } from "../../extensions/environment-doctor-runtime-health";
import { analyzeRuntimeOutputAdvisories } from "../../extensions/environment-runtime-output-advisory";

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

  it("environment_doctor_status treats unauthenticated glab as optional noise", async () => {
    const pi = {
      ...makeMockPi(),
      exec: vi.fn(async (command: string, args: string[]) => {
        if (command === "glab" && args[0] === "auth") {
          return { code: 1, stdout: "", stderr: "glab not logged in" };
        }
        return { code: 0, stdout: `${command} version\n`, stderr: "" };
      }),
    } as unknown as ReturnType<typeof makeMockPi>;
    environmentDoctorExtension(pi);
    const tool = getTool(pi, "environment_doctor_status");

    const result = await tool.execute(
      "tc-environment-doctor-optional-glab-auth",
      { includeAuthChecks: true },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );
    const text = String(result.content?.[0]?.text ?? "");

    expect(text).toContain("ok=yes");
    expect(text).toContain("issues=0");
    expect(text).toContain("optionalIssues=1");
    expect(text).toContain("optionalIssueDetails=warn:glab=Instalado mas nao autenticado");
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
    expect(text).toContain("next=continue-with-bounded-work");
    expect(text).toContain("devPressurePrimary=");
    expect(text).toContain("devPressureAction=");
    expect(text).toContain("liveWatchdog=unavailable");
    expect(text).toContain("operatorWatchdog=required-for-live-metrics");
    expect(text).toContain("watchdogSource=external-pressure-and-persisted-evidence");
    expect((result.details as any)?.mode).toBe("environment-runtime-health");
    expect((result.details as any)?.nextAction).toBe("continue-with-bounded-work");
    expect((result.details as any)?.watchdog?.liveMetricsAvailable).toBe(false);
    expect((result.details as any)?.watchdog?.operatorTuiCheckRequiredForLiveMetrics).toBe(true);
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
      doctorIssues: [],
      devPressureRecommendation: "reduce-governance-surface",
      devPressureSeverity: "warn",
      runtimeArtifactViolations: [],
    })).toBe("safe-mode");
    expect(resolveEnvironmentRuntimeHealthDecision({
      doctorIssues: [{ name: "gh" }],
      devPressureRecommendation: "continue",
      devPressureSeverity: "ok",
      runtimeArtifactViolations: [],
    })).toBe("stop-and-investigate");
  });

  it("runtime health summary surfaces pressure recovery action count", () => {
    const { summary, payload } = buildEnvironmentRuntimeHealthPayload({
      allResults: [{ status: "ok" }],
      terminalId: "vscode",
      shellId: "native-bash",
      devPressure: {
        recommendation: "reduce-governance-surface",
        primarySignal: { level: "warn", code: "pi-lens-active-full-startup-risk" },
        primaryAction: "set-pi-lens-startup-mode-quick-or-minimal-or-exclude-until-requested",
        primaryRecoveryActions: ["set quick", "reapply curated"],
        velocityPressure: { severity: "warn" },
        summary: "environment-dev-pressure: recommendation=reduce-governance-surface",
      },
      runtimeArtifacts: { violations: [] },
      runtimeArtifactSummary: "runtime-artifact-audit: clean",
    });

    expect(payload.decision).toBe("safe-mode");
    expect(payload.nextAction).toBe("enable-safe-mode-or-reduce-governance-surface-before-long-runs");
    expect(summary).toContain("devPressureAction=set-pi-lens-startup-mode-quick-or-minimal-or-exclude-until-requested");
    expect(summary).toContain("next=enable-safe-mode-or-reduce-governance-surface-before-long-runs");
    expect(summary).toContain("recoveryActions=2");
  });

  it("classifies pasted Pi startup output as runtime advisories", async () => {
    const report = analyzeRuntimeOutputAdvisories(`
[Extension issues]
  npm:@ifi/pi-extension-subagents (user) index.ts
    Extension shortcut 'ctrl+shift+a' from
C:\\Users\\aretw\\.pi\\agent\\npm\\node_modules\\@ifi\\pi-extension-subagents\\index.ts conflicts with built-in
shortcut. Skipping.

 Warning: Dirty repo: 1 uncommitted change(s)
 Update available: @davidorex/pi-project-workflows 0.14.6 -> 0.26.0
 Error: Performance watchdog critical: event-loop max 310ms. Run /watchdog:status or /safe-mode on if input feels laggy.
`);

    expect(report.decision).toBe("safe-mode");
    expect(report.advisories.map((row) => row.code)).toEqual([
      "extension-shortcut-conflict",
      "third-party-package-update-available",
      "runtime-dirty-repo",
      "performance-watchdog-critical",
    ]);
    expect(report.summary).toContain("warn=2");
    expect(report.summary).toContain("codes=extension-shortcut-conflict,performance-watchdog-critical,runtime-dirty-repo,third-party-package-update-available");
    expect(report.summary).toContain("recurringOrSevere=no");
  });

  it("classifies empty runtime output as missing evidence, not a stop condition", async () => {
    const report = analyzeRuntimeOutputAdvisories("");

    expect(report.decision).toBe("needs-evidence");
    expect(report.advisories).toEqual([
      expect.objectContaining({
        code: "missing-runtime-output",
        level: "info",
      }),
    ]);
    expect(report.summary).toContain("decision=needs-evidence");
    expect(report.summary).toContain("codes=missing-runtime-output");
  });

  it("classifies placeholder runtime output as missing evidence", async () => {
    const report = analyzeRuntimeOutputAdvisories("[cole aqui os últimos erros Performance watchdog critical e Warning safe mode]");

    expect(report.decision).toBe("needs-evidence");
    expect(report.advisories).toEqual([
      expect.objectContaining({
        code: "missing-runtime-output",
        detail: "raw_output is a placeholder",
      }),
    ]);
  });

  it("classifies watchdog threshold crossings and auto safe-mode as safe-mode advisories", async () => {
    const report = analyzeRuntimeOutputAdvisories(`
 Error: Performance watchdog critical: event-loop max 416ms. Run /watchdog:status or /safe-mode on if input feels laggy.
 Warning: Watchdog enabled safe mode automatically: safe mode is on (watchdog: event-loop max 368ms).
`);

    expect(report.decision).toBe("safe-mode");
    expect(report.advisories.map((row) => row.code)).toEqual([
      "performance-watchdog-critical",
      "performance-watchdog-auto-safe-mode",
    ]);
    expect(report.advisories.every((row) => row.level === "warn")).toBe(true);
    expect(report.summary).toContain("codes=performance-watchdog-auto-safe-mode,performance-watchdog-critical");
    expect(report.summary).toContain("recurringOrSevere=no");
  });

  it("highlights recurring or severe watchdog spikes without converting them to stop", async () => {
    const report = analyzeRuntimeOutputAdvisories(`
 Error: Performance watchdog critical: event-loop max 454ms. Run /watchdog:status or /safe-mode on if input feels laggy.
 Error: Performance watchdog critical: event-loop max 1213ms. Run /watchdog:status or /safe-mode on if input feels laggy.
 Warning: Watchdog enabled safe mode automatically: safe mode is on (watchdog: event-loop max 832ms).
`);

    expect(report.decision).toBe("safe-mode");
    expect(report.advisories).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "performance-watchdog-recurring-or-severe",
        level: "warn",
        detail: "events=2 eventLoopMaxMs=1213",
      }),
    ]));
    expect(report.summary).toContain("decision=safe-mode");
    expect(report.summary).toContain("codes=performance-watchdog-auto-safe-mode,performance-watchdog-critical,performance-watchdog-recurring-or-severe");
    expect(report.summary).toContain("recurringOrSevere=yes");
  });

  it("environment_runtime_output_advisory exposes compact operator output", async () => {
    const pi = makeMockPi();
    environmentDoctorExtension(pi);
    const tool = getTool(pi, "environment_runtime_output_advisory");

    const result = await tool.execute(
      "tc-runtime-output-advisory",
      { raw_output: "Warning: Dirty repo: 1 uncommitted change(s)" },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );
    const text = String(result.content?.[0]?.text ?? "");

    expect(text).toContain("runtime-output-advisory:");
    expect(text).toContain("decision=continue");
    expect((result.details as any)?.advisories?.[0]?.code).toBe("runtime-dirty-repo");
  });
});
