import { afterEach, describe, expect, it } from "vitest";
import { createTestSession, type TestSession } from "@marcfargas/pi-test-harness";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import colonyPilot from "../../extensions/colony-pilot";
import webSessionGateway from "../../extensions/web-session-gateway";
import guardrailsCore from "../../extensions/guardrails-core";

function patchHarnessAuth(t: TestSession) {
  const modelRegistry = (t.session as any)?._modelRegistry;
  if (modelRegistry) {
    modelRegistry.hasConfiguredAuth = () => true;
    modelRegistry.getApiKey = async () => "test-key";
    modelRegistry.getApiKeyForProvider = async () => "test-key";
  }
}

function tempCwdWithProjectSettings() {
  const cwd = mkdtempSync(join(tmpdir(), "pi-reload-baseline-"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify(
      {
        packages: ["../packages/pi-stack"],
        extensions: [],
      },
      null,
      2
    )
  );
  return cwd;
}

describe("reload safety after /colony-pilot baseline apply", () => {
  let t: TestSession | undefined;

  afterEach(() => {
    t?.dispose();
    t = undefined;
  });

  it("baseline apply mantém settings compatível com reload", async () => {
    const cwd = tempCwdWithProjectSettings();
    const settingsPath = join(cwd, ".pi", "settings.json");

    t = await createTestSession({
      cwd,
      extensionFactories: [colonyPilot, webSessionGateway, guardrailsCore],
    });
    patchHarnessAuth(t);

    await t.session.prompt("/colony-pilot baseline apply phase2");

    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));

    expect(Array.isArray(settings.extensions)).toBe(true);
    expect(settings.piStack?.colonyPilot?.preflight?.requiredExecutables).toEqual(["node", "git", "npm", "npx"]);
    expect(settings.piStack?.webSessionGateway?.port).toBe(3100);

    await expect(t.session.prompt("/reload")).resolves.toBeUndefined();
    await t.session.agent.waitForIdle();
  });
});
