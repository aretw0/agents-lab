/**
 * Smoke tests for the installer baseline logic.
 *
 * Tests applyBaselineToSettings and deepMergeForBaseline to ensure
 * the --baseline flag in install.mjs produces the expected structure
 * without overwriting existing user settings.
 */
import { describe, expect, it } from "vitest";

// Import from install.mjs as ESM — we test the pure functions directly.
// Using a dynamic import resolves the .mjs extension correctly in vitest.
const installModule = await import("../../install.mjs");
const { applyBaselineToSettings, deepMergeForBaseline, INSTALLER_BASELINE } = installModule;

describe("installer-baseline — deepMergeForBaseline", () => {
  it("copia chaves do patch para base vazia", () => {
    const result = deepMergeForBaseline({}, { theme: "agents-lab", foo: 1 });
    expect(result.theme).toBe("agents-lab");
    expect(result.foo).toBe(1);
  });

  it("nao sobrescreve chaves existentes no base (nao-destrutivo)", () => {
    const result = deepMergeForBaseline(
      { theme: "custom-theme", existing: true },
      { theme: "agents-lab", newKey: 42 }
    );
    // theme was already set — must not change
    expect(result.theme).toBe("custom-theme");
    // new key is added
    expect(result.newKey).toBe(42);
    expect(result.existing).toBe(true);
  });

  it("merge recursivo de objetos aninhados", () => {
    const result = deepMergeForBaseline(
      { piStack: { colonyPilot: { preflight: { enabled: false } } } },
      { piStack: { colonyPilot: { preflight: { enabled: true, requiredExecutables: ["node"] }, budgetPolicy: { enabled: true } } } }
    );
    // existing key preserved
    expect(result.piStack.colonyPilot.preflight.enabled).toBe(false);
    // new nested key added
    expect(result.piStack.colonyPilot.budgetPolicy.enabled).toBe(true);
    // new nested key in existing object added
    expect(result.piStack.colonyPilot.preflight.requiredExecutables).toEqual(["node"]);
  });

  it("nao merge arrays — nao sao objetos", () => {
    const result = deepMergeForBaseline(
      { packages: ["a", "b"] },
      { packages: ["c", "d"] }
    );
    // packages already exists → not overwritten
    expect(result.packages).toEqual(["a", "b"]);
  });
});

describe("installer-baseline — applyBaselineToSettings", () => {
  it("settings vazio recebe baseline completo", () => {
    const result = applyBaselineToSettings({});
    expect(result.theme).toBe("agents-lab");
    expect(result.piStack?.colonyPilot?.preflight?.enabled).toBe(true);
    expect(result.piStack?.colonyPilot?.budgetPolicy?.defaultMaxCostUsd).toBe(2);
    expect(result.piStack?.claudeCodeAdapter?.sessionRequestCap).toBe(20);
    expect(result.piStack?.quotaVisibility?.routeModelRefs?.["claude-code"]).toBe("claude-code/claude-sonnet-4-6");
  });

  it("settings com tema existente preserva tema do usuario", () => {
    const result = applyBaselineToSettings({ theme: "my-custom-theme" });
    expect(result.theme).toBe("my-custom-theme");
  });

  it("settings com piStack parcial mescla corretamente", () => {
    const existing = {
      piStack: {
        colonyPilot: {
          budgetPolicy: { defaultMaxCostUsd: 5 },
        },
      },
    };
    const result = applyBaselineToSettings(existing);
    // User's budget is preserved
    expect(result.piStack.colonyPilot.budgetPolicy.defaultMaxCostUsd).toBe(5);
    // Other colonyPilot sections are added
    expect(result.piStack.colonyPilot.preflight?.enabled).toBe(true);
    // claudeCodeAdapter is added (didn't exist)
    expect(result.piStack.claudeCodeAdapter?.sessionRequestCap).toBe(20);
  });

  it("INSTALLER_BASELINE tem os campos esperados", () => {
    expect(INSTALLER_BASELINE.theme).toBe("agents-lab");
    expect(INSTALLER_BASELINE.piStack?.colonyPilot).toBeDefined();
    expect(INSTALLER_BASELINE.piStack?.claudeCodeAdapter).toBeDefined();
    expect(INSTALLER_BASELINE.piStack?.quotaVisibility?.routeModelRefs?.["claude-code"]).toBeDefined();
  });
});
