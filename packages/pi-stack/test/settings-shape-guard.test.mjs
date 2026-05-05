import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("settings shape guard", () => {
  it("project .pi/settings.json keeps resource keys iterable", () => {
    const settingsPath = resolve(process.cwd(), ".pi", "settings.json");
    assert.ok(existsSync(settingsPath), "project .pi/settings.json should exist");

    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.equal(typeof settings, "object");

    // package-manager expects iterable arrays for these keys.
    const iterableKeys = ["packages", "extensions", "skills", "prompts", "themes"];
    for (const key of iterableKeys) {
      const value = settings[key];
      if (value === undefined) continue;
      assert.ok(Array.isArray(value), `${key} must be an array when present`);
    }
  });

  it("monitor provider patch config lives under piStack namespace", () => {
    const settingsPath = resolve(process.cwd(), ".pi", "settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));

    const cfg = settings?.piStack?.monitorProviderPatch;
    assert.ok(cfg && typeof cfg === "object", "piStack.monitorProviderPatch should be an object");
    assert.equal(
      cfg.hedgeConversationHistory,
      true,
      "long-run calibration keeps bounded conversation history enabled for hedge",
    );
  });
});
