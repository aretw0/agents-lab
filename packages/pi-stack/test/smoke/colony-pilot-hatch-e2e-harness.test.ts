import { afterEach, describe, expect, it } from "vitest";
import { createTestSession, type TestSession } from "@marcfargas/pi-test-harness";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import colonyPilot from "../../extensions/colony-pilot";

function patchHarnessAgentCompat(t: TestSession) {
  const modelRegistry = (t.session as any)?._modelRegistry;
  if (modelRegistry) {
    modelRegistry.hasConfiguredAuth = () => true;
    modelRegistry.getApiKey = async () => "test-key";
    modelRegistry.getApiKeyForProvider = async () => "test-key";
  }
}

function fakePilotDepsExtension() {
  return function (pi: any) {
    for (const name of ["monitors", "colony", "colony-stop", "remote", "session-web"]) {
      pi.registerCommand(name, {
        description: `fake ${name}`,
        handler: async (_args: string, _ctx: any) => {},
      });
    }
  };
}

function tempCwdWithHatchSettings() {
  const cwd = mkdtempSync(join(tmpdir(), "pi-colony-hatch-"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify(
      {
        defaultProvider: "openai-codex",
        defaultModel: "gpt-5.3-codex",
        piStack: {
          colonyPilot: {
            preflight: {
              enabled: true,
              enforceOnAntColonyTool: true,
              requiredExecutables: ["node"],
              requireColonyCapabilities: ["colony", "colonyStop"],
              enforceMachineMaintenance: false,
            },
            budgetPolicy: {
              enabled: true,
              enforceOnAntColonyTool: true,
              requireMaxCost: true,
              autoInjectMaxCost: true,
              defaultMaxCostUsd: 1,
              hardCapUsd: 10,
              minMaxCostUsd: 0.05,
              enforceProviderBudgetBlock: false,
            },
          },
          quotaVisibility: {
            monthlyQuotaTokens: 100000,
            providerBudgets: {
              "openai-codex": {
                period: "monthly",
                shareMonthlyTokensPct: 50,
                warnPct: 80,
                hardPct: 100,
              },
            },
          },
        },
      },
      null,
      2
    )
  );
  return cwd;
}

function lastNotifyMessage(t: TestSession): string {
  const entries = t.events.uiCallsFor("notify");
  if (entries.length === 0) return "";
  const last = entries[entries.length - 1];
  return String(last?.args?.[0] ?? "");
}

describe("colony-pilot hatch e2e (pi-test-harness)", () => {
  let t: TestSession | undefined;

  afterEach(() => {
    t?.dispose();
    t = undefined;
  });

  it("hatch apply default grava baseline e orienta runbook", async () => {
    const cwd = tempCwdWithHatchSettings();
    const settingsPath = join(cwd, ".pi", "settings.json");

    t = await createTestSession({
      cwd,
      extensionFactories: [colonyPilot, fakePilotDepsExtension()],
    });
    patchHarnessAgentCompat(t);

    await t.session.prompt("/colony-pilot hatch apply default");

    const msg = lastNotifyMessage(t);
    expect(msg).toContain("hatch apply: baseline 'default' aplicado");
    expect(msg).toContain("/reload");

    const editorCalls = t.events.uiCallsFor("setEditorText");
    expect(editorCalls.length).toBeGreaterThan(0);
    expect(String(editorCalls[editorCalls.length - 1]?.args?.[0] ?? "")).toBe("/reload");

    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(settings?.piStack?.colonyPilot?.preflight?.enabled).toBe(true);
    expect(settings?.piStack?.colonyPilot?.budgetPolicy?.defaultMaxCostUsd).toBe(2);
  });

  it("hatch doctor delega para doctor canônico", async () => {
    const cwd = tempCwdWithHatchSettings();

    t = await createTestSession({
      cwd,
      extensionFactories: [colonyPilot, fakePilotDepsExtension()],
    });
    patchHarnessAgentCompat(t);

    await t.session.prompt("/colony-pilot hatch doctor");

    const msg = lastNotifyMessage(t);
    expect(msg).toContain("hatch doctor foi centralizado");
    expect(msg).toContain("/doctor hatch");

    const editorCalls = t.events.uiCallsFor("setEditorText");
    expect(editorCalls.length).toBeGreaterThan(0);
    expect(String(editorCalls[editorCalls.length - 1]?.args?.[0] ?? "")).toBe("/doctor hatch");
  });

  it("hatch check default usa modo simples sem CTA direta de swarm", async () => {
    const cwd = tempCwdWithHatchSettings();

    t = await createTestSession({
      cwd,
      extensionFactories: [colonyPilot, fakePilotDepsExtension()],
    });
    patchHarnessAgentCompat(t);

    await t.session.prompt("/colony-pilot hatch check");

    const msg = lastNotifyMessage(t);
    expect(msg).toContain("colony-pilot hatch");
    expect(msg).toContain("mode: simple");
    expect(msg).toContain("[PASS] runtime capabilities");
    expect(msg).toContain("[PASS] preflight executáveis");
    expect(msg).toContain("ready: yes");
    expect(msg).toContain("simple lane (default):");
    expect(msg).toContain("/colony-pilot hatch check --advanced");
    expect(msg).not.toContain("/colony <goal>");
  });

  it("hatch check --advanced libera trilha avançada explicitamente", async () => {
    const cwd = tempCwdWithHatchSettings();

    t = await createTestSession({
      cwd,
      extensionFactories: [colonyPilot, fakePilotDepsExtension()],
    });
    patchHarnessAgentCompat(t);

    await t.session.prompt("/colony-pilot hatch check --advanced");

    const msg = lastNotifyMessage(t);
    expect(msg).toContain("colony-pilot hatch");
    expect(msg).toContain("mode: advanced");
    expect(msg).toContain("advanced lane (explicit scale):");
    expect(msg).toContain("/colony <goal>");
  });
});
