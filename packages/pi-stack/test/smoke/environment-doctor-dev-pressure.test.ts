import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import environmentDoctorExtension from "../../extensions/environment-doctor";
import {
  buildDevelopmentVelocityPressure,
  buildEnvironmentDevPressureReport,
} from "../../extensions/environment-doctor-dev-pressure";

function makeWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-env-pressure-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  mkdirSync(join(dir, ".sandbox", "pi-agent", "sessions"), { recursive: true });
  mkdirSync(join(dir, ".sandbox", "pi-agent"), { recursive: true });
  return dir;
}

function makePackage(root: string) {
  const packageRoot = join(root, "packages", "example-pi-stack");
  const extensionRoot = join(packageRoot, "extensions");
  mkdirSync(extensionRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: "@example/pi-stack",
      pi: { extensions: ["./extensions/light.ts", "./extensions/heavy.ts"] },
    }),
    "utf8",
  );
  writeFileSync(join(extensionRoot, "shared.ts"), "export const shared = 1;\n", "utf8");
  writeFileSync(join(extensionRoot, "light.ts"), "export const light = 1;\n", "utf8");
  writeFileSync(join(extensionRoot, "heavy.ts"), "import './shared';\nexport const heavy = 1;\n", "utf8");
  return packageRoot;
}

function makeMockPi() {
  return {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    getCommands: vi.fn(() => []),
  } as unknown as Parameters<typeof environmentDoctorExtension>[0];
}

function getTool(pi: ReturnType<typeof makeMockPi>, name: string) {
  const call = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === name);
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

describe("environment doctor dev pressure", () => {
  it("reports session and configured extension pressure without reading session bodies", () => {
    const dir = makeWorkspace();
    try {
      const packageRoot = makePackage(dir);
      writeFileSync(
        join(dir, ".pi", "settings.json"),
        JSON.stringify({
          packages: [{ source: packageRoot, extensions: ["!./extensions/heavy.ts"] }],
        }),
        "utf8",
      );
      writeFileSync(join(dir, ".sandbox", "pi-agent", "sessions", "large.jsonl"), "x".repeat(1024 * 1024), "utf8");

      const report = buildEnvironmentDevPressureReport(dir);

      expect(report.summary).toContain("environment-dev-pressure:");
      expect(report.sessions.count).toBe(1);
      expect(report.sessions.largest?.mb).toBe(1);
      expect(report.settings[0]?.extensionExcludeCount).toBe(1);
      expect(report.configuredEntrypoints.map((row) => row.entry)).toEqual(["./extensions/light.ts"]);
      expect(report.recommendation).toBe("continue");
      expect(report.velocityPressure.severity).toBe("ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("classifies accumulated development velocity pressure for operator decisions", () => {
    const pressure = buildDevelopmentVelocityPressure({
      signals: [
        { level: "warn", code: "heavy-configured-extension-entrypoint", detail: "heavy" },
        { level: "warn", code: "large-resume-session", detail: "large" },
      ],
    });

    expect(pressure.severity).toBe("pause");
    expect(pressure.recommendation).toBe("checkpoint-and-reduce-pressure");
    expect(pressure.stopConditions).toEqual([
      "checkpoint-before-more-work",
      "avoid-resume-heavy-session",
      "reduce-runtime-surface",
    ]);
  });

  it("registers environment_dev_pressure_status as an operator-visible Pi tool", async () => {
    const dir = makeWorkspace();
    try {
      writeFileSync(join(dir, ".pi", "settings.json"), JSON.stringify({ packages: [] }), "utf8");
      const pi = makeMockPi();
      environmentDoctorExtension(pi);
      const tool = getTool(pi, "environment_dev_pressure_status");

      const result = await tool.execute(
        "tc-env-pressure",
        {},
        undefined as unknown as AbortSignal,
        () => {},
        { cwd: dir },
      );

      expect(String(result.content?.[0]?.text ?? "")).toContain("environment-dev-pressure: recommendation=continue");
      expect(String(result.content?.[0]?.text ?? "")).toContain("payload completo disponível em details");
      expect((result.details as any)?.mode).toBe("environment-dev-pressure");
      expect((result.details as any)?.velocityPressure?.severity).toBe("ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
