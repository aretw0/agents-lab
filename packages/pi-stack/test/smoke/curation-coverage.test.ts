import { describe, expect, it } from "vitest";
import {
  CURATION_FILTER_PATCHES,
  evaluateCurationCoverage,
  filterPatchCoversSurface,
  readCurationCoverageRegistry,
} from "../../extensions/curation-coverage";

const installModule = await import("../../install.mjs");
const { FILTER_PATCHES } = installModule;

describe("first-party curation coverage", () => {
  it("keeps curation filter mirror aligned with installer filters", () => {
    expect(CURATION_FILTER_PATCHES).toEqual(FILTER_PATCHES);
  });

  it("reads coverage records from capability owners registry", () => {
    const registry = readCurationCoverageRegistry();

    expect(registry.records.length).toBeGreaterThan(0);
    expect(registry.records.some((record) => record.id === "mitsupi-uv-bash-conflict")).toBe(true);
    expect(registry.records.every((record) => record.capabilityId.length > 0)).toBe(true);
  });

  it("detects installer filters for covered third-party surfaces", () => {
    expect(filterPatchCoversSurface(FILTER_PATCHES, "mitsupi", "pi-extensions/uv.ts")).toBe(true);
    expect(filterPatchCoversSurface(FILTER_PATCHES, "@ifi/oh-pi-extensions", "extensions/bg-process.ts")).toBe(false);
  });

  it("surfaces filtered overlaps and decisions without dispatch authority", () => {
    const registry = readCurationCoverageRegistry();
    const result = evaluateCurationCoverage({
      registry,
      filterPatches: FILTER_PATCHES,
      installedPackages: new Set(["@aretw0/pi-stack", "mitsupi", "@ifi/oh-pi-extensions", "pi-web-access", "@ifi/oh-pi-skills"]),
    });

    expect(result).toMatchObject({
      mode: "first-party-curation-coverage",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      mutationAllowed: false,
    });
    expect(result.summary.filtered).toBeGreaterThanOrEqual(7);
    expect(result.summary.missingFilter).toBe(0);
    expect(result.records.find((record) => record.id === "oh-pi-bg-process-future")?.evaluatedStatus).toBe("needs-decision");
    expect(result.evidence).toContain("dispatch=no");
  });

  it("fails high-risk when a suppress-by-filter surface lacks an installer filter", () => {
    const result = evaluateCurationCoverage({
      registry: {
        version: "test",
        records: [{
          id: "missing",
          capabilityId: "x",
          firstPartyPackage: "@aretw0/pi-stack",
          coveredSurface: "x",
          thirdPartyPackage: "third-party",
          thirdPartySurfaces: ["extensions/x.ts"],
          strategy: "suppress-by-filter",
        }],
      },
      filterPatches: [],
      installedPackages: new Set(["third-party"]),
    });

    expect(result.summary.missingFilter).toBe(1);
    expect(result.records[0]?.risk).toBe("high");
  });
});
