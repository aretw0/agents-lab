import { afterEach, describe, expect, it } from "vitest";
import { calls, createTestSession, says, when, type TestSession } from "@marcfargas/pi-test-harness";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { Type } from "@sinclair/typebox";
import { tmpdir } from "node:os";
import { join } from "node:path";

import webSessionGateway from "../../extensions/web-session-gateway";
import colonyPilot from "../../extensions/colony-pilot";

function tempCwdWithGatewayConfig(port: number) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-gateway-e2e-"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify(
      {
        extensions: {
          webSessionGateway: {
            mode: "local",
            port,
          },
        },
      },
      null,
      2
    )
  );
  return cwd;
}

function fakeColonySignalToolExtension() {
  return function (pi: any) {
    pi.registerTool({
      name: "fake_colony_signal",
      label: "Fake Colony Signal",
      description: "Emit a fake colony signal in tool result text",
      parameters: Type.Object({
        id: Type.Optional(Type.String()),
        phase: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId: string, params: { id?: string; phase?: string }) {
        const id = params.id ?? "c9";
        const phase = (params.phase ?? "launched").toUpperCase();
        return {
          content: [{ type: "text", text: `[COLONY_SIGNAL:${phase}] [${id}]` }],
          details: {},
        };
      },
    });
  };
}

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

function fakePilotDepsExtension() {
  return function (pi: any) {
    for (const name of ["monitors", "colony", "colony-stop"]) {
      pi.registerCommand(name, {
        description: `fake ${name}`,
        handler: async (_args: string, _ctx: any) => {},
      });
    }
  };
}

function lastNotifyMessage(t: TestSession): string {
  const entries = t.events.uiCallsFor("notify");
  if (entries.length === 0) return "";
  const last = entries[entries.length - 1];
  return String(last?.args?.[0] ?? "");
}

describe("web-session-gateway e2e (pi-test-harness)", () => {
  let t: TestSession | undefined;

  afterEach(async () => {
    try {
      if (t) {
        await t.session.prompt("/session-web stop");
      }
    } catch {
      // ignore cleanup errors
    }
    t?.dispose();
    t = undefined;
  });

  it("sobe gateway local e expõe estado com sinal fake de colônia", async () => {
    const port = 31907;
    const cwd = tempCwdWithGatewayConfig(port);

    t = await createTestSession({
      cwd,
      extensionFactories: [webSessionGateway, fakeColonySignalToolExtension()],
    });
    patchHarnessAgentCompat(t);

    await t.session.prompt("/session-web start");

    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok", mode: "local" });

    const info = lastNotifyMessage(t);
    const tokenMatch = info.match(/\?t=([a-f0-9]+)/i);
    expect(tokenMatch).toBeTruthy();
    const token = tokenMatch![1];

    const unauth = await fetch(`http://127.0.0.1:${port}/api/state`);
    expect(unauth.status).toBe(401);

    await t.run(
      when("Emitir sinal fake", [
        calls("fake_colony_signal", { id: "c9", phase: "launched" }),
        says("ok"),
      ])
    );

    const stateRes = await fetch(`http://127.0.0.1:${port}/api/state?t=${token}`);
    expect(stateRes.status).toBe(200);
    const state = await stateRes.json();

    expect(Array.isArray(state.state.colonies)).toBe(true);
    expect(state.state.colonies.some((c: any) => c.id === "c9" && c.phase === "launched")).toBe(true);
  });

  it("colony-pilot usa session-web quando capability first-party está disponível", async () => {
    const port = 31908;
    const cwd = tempCwdWithGatewayConfig(port);

    t = await createTestSession({
      cwd,
      extensionFactories: [webSessionGateway, colonyPilot, fakePilotDepsExtension()],
    });

    await t.session.prompt('/colony-pilot run "Goal Test"');
    const runMsg = lastNotifyMessage(t);
    expect(runMsg).toContain("/session-web start");

    const editorCalls = t.events.uiCallsFor("setEditorText");
    expect(editorCalls.length).toBeGreaterThan(0);
    expect(String(editorCalls[editorCalls.length - 1]?.args?.[0] ?? "")).toBe("/monitors off");

    await t.session.prompt("/colony-pilot stop --restore-monitors");
    const stopMsg = lastNotifyMessage(t);
    expect(stopMsg).toContain("/session-web stop");
  });
});
