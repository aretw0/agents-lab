import { afterEach, describe, expect, it } from "vitest";
import { calls, createTestSession, says, when, type TestSession } from "@marcfargas/pi-test-harness";
import { Type } from "@sinclair/typebox";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import colonyPilot from "../../extensions/colony-pilot";

function patchHarnessAgentCompat(t: TestSession) {
  const agent = t.session?.agent as any;
  if (agent && typeof agent.setTools !== "function") {
    agent.setTools = (tools: any[]) => {
      if (agent.state) agent.state.tools = tools;
    };
  }

  const modelRegistry = (t.session as any)?._modelRegistry;
  if (modelRegistry) {
    modelRegistry.hasConfiguredAuth = () => true;
    modelRegistry.getApiKey = async () => "test-key";
    modelRegistry.getApiKeyForProvider = async () => "test-key";
  }
}

function tempCwdWithPreflightConfig() {
  const cwd = mkdtempSync(join(tmpdir(), "pi-colony-preflight-"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify(
      {
        extensions: {
          colonyPilot: {
            preflight: {
              requiredExecutables: [],
              requireColonyCapabilities: ["colony", "colonyStop", "monitors"],
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

function fakeAntColonyToolExtension(counter: { calls: number }) {
  return function (pi: any) {
    pi.registerTool({
      name: "ant_colony",
      label: "Fake Ant Colony",
      description: "fake",
      parameters: Type.Object({ goal: Type.String() }),
      async execute() {
        counter.calls += 1;
        return {
          content: [{ type: "text", text: "fake colony started" }],
          details: {},
        };
      },
    });

    // capabilities checked by preflight defaults
    pi.registerCommand("colony", { description: "fake", handler: async () => {} });
    pi.registerCommand("colony-stop", { description: "fake", handler: async () => {} });
  };
}

describe("colony-pilot preflight hard gate (ant_colony)", () => {
  let t: TestSession | undefined;

  afterEach(() => {
    t?.dispose();
    t = undefined;
  });

  it("bloqueia ant_colony quando preflight falha", async () => {
    const counter = { calls: 0 };
    t = await createTestSession({
      cwd: tempCwdWithPreflightConfig(),
      extensionFactories: [colonyPilot, fakeAntColonyToolExtension(counter)],
    });
    patchHarnessAgentCompat(t);

    await t.run(
      when("start colony", [
        calls("ant_colony", { goal: "Phase 2" }),
        says("ok"),
      ])
    );

    expect(counter.calls).toBe(0);
    const notify = t.events.uiCallsFor("notify").map((e) => String(e.args?.[0] ?? "")).join("\n");
    expect(notify).toContain("ant_colony bloqueada por preflight");
    expect(notify).toContain("missing capabilities");
  });
});
