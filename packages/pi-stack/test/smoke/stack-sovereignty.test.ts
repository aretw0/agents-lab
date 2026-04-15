import { describe, expect, it } from "vitest";
import {
  evaluateCapabilityOwnership,
  normalizeInstalledPackagesFromSettings,
  normalizePackageSource,
  readCapabilityRegistry,
} from "../../extensions/stack-sovereignty";

describe("stack-sovereignty", () => {
  it("normaliza sources npm e paths locais", () => {
    expect(normalizePackageSource("npm:@ifi/oh-pi-extensions")).toBe("@ifi/oh-pi-extensions");
    expect(normalizePackageSource("../packages/pi-stack")).toBe("@aretw0/pi-stack");
    expect(normalizePackageSource({ source: "npm:pi-web-access" })).toBe("pi-web-access");
  });

  it("extrai packages instalados do settings", () => {
    const installed = normalizeInstalledPackagesFromSettings({
      packages: [
        "npm:@aretw0/pi-stack",
        { source: "npm:@ifi/oh-pi-extensions" },
        "../packages/web-skills",
      ],
    });

    expect(installed).toContain("@aretw0/pi-stack");
    expect(installed).toContain("@ifi/oh-pi-extensions");
    expect(installed).toContain("@aretw0/web-skills");
  });

  it("avalia ownership e detecta coexistência", () => {
    const registry = {
      version: "test",
      capabilities: [
        {
          id: "scheduler-runtime-governance",
          name: "Scheduler",
          criticality: "high" as const,
          primaryPackage: "@aretw0/pi-stack",
          secondaryPackages: ["@ifi/oh-pi-extensions"],
          conflictsWithPackages: ["@ifi/oh-pi-extensions"],
          defaultAction: "consolidate",
        },
      ],
    };

    const rows = evaluateCapabilityOwnership(registry, new Set(["@aretw0/pi-stack", "@ifi/oh-pi-extensions"]));
    expect(rows[0]?.status).toBe("coexisting");
    expect(rows[0]?.risk).toBe("medium");
  });

  it("owner missing em capability crítica vira risco alto", () => {
    const registry = {
      version: "test",
      capabilities: [
        {
          id: "global-runtime-doctor",
          name: "Doctor",
          criticality: "high" as const,
          primaryPackage: "@aretw0/pi-stack",
          secondaryPackages: ["@ifi/oh-pi-extensions"],
          conflictsWithPackages: ["@ifi/oh-pi-extensions"],
          defaultAction: "maintain",
        },
      ],
    };

    const rows = evaluateCapabilityOwnership(registry, new Set(["@ifi/oh-pi-extensions"]));
    expect(rows[0]?.status).toBe("owner-missing");
    expect(rows[0]?.risk).toBe("high");
  });

  it("carrega registry de capabilities", () => {
    const registry = readCapabilityRegistry();
    expect(registry.capabilities.length).toBeGreaterThan(0);
    expect(registry.capabilities.some((c) => c.id === "scheduler-runtime-governance")).toBe(true);
  });
});
