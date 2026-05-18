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

  it("requires every installer suppression to have curation coverage", () => {
    const registry = readCurationCoverageRegistry();
    const covered = new Set(
      registry.records.flatMap((record) =>
        record.thirdPartySurfaces.map((surface) => `${record.thirdPartyPackage}:${surface}`),
      ),
    );
    const suppressed = FILTER_PATCHES.flatMap((patch: { source?: string; extensions?: string[]; skills?: string[] }) => {
      const pkg = typeof patch.source === "string" && patch.source.startsWith("npm:")
        ? patch.source.slice(4)
        : patch.source;
      return [...(patch.extensions ?? []), ...(patch.skills ?? [])]
        .filter((surface) => surface.startsWith("!"))
        .map((surface) => `${pkg}:${surface.slice(1)}`);
    });

    expect(suppressed.filter((surface) => !covered.has(surface))).toEqual([]);
  });

  it("reads coverage records from capability owners registry", () => {
    const registry = readCurationCoverageRegistry();

    expect(registry.records.length).toBeGreaterThan(0);
    expect(registry.records.some((record) => record.id === "mitsupi-uv-bash-conflict")).toBe(true);
    expect(registry.records.every((record) => record.capabilityId.length > 0)).toBe(true);
  });

  it("detects installer filters for covered third-party surfaces", () => {
    expect(filterPatchCoversSurface(FILTER_PATCHES, "mitsupi", "pi-extensions/uv.ts")).toBe(true);
    expect(filterPatchCoversSurface(FILTER_PATCHES, "@ifi/oh-pi-extensions", "extensions/bg-process.ts")).toBe(true);
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
    expect(result.summary.filtered).toBeGreaterThanOrEqual(12);
    expect(result.summary.missingFilter).toBe(0);
    expect(result.records.find((record) => record.id === "oh-pi-watchdog")?.evaluatedStatus).toBe("tracked");
    expect(result.records.find((record) => record.id === "oh-pi-bg-process-future")?.evaluatedStatus).toBe("filtered");
    expect(result.evidence).toContain("dispatch=no");
  });

  it("tracks Pi session presentation as a full curated surface", () => {
    const registry = readCurationCoverageRegistry();
    const records = registry.records.filter((record) => record.capabilityId === "pi-session-presentation");
    const covered = new Set(records.flatMap((record) => record.thirdPartySurfaces));

    expect(records.map((record) => record.id)).toEqual([
      "oh-pi-custom-footer",
      "oh-pi-session-chrome",
      "oh-pi-session-naming-and-lifecycle",
      "oh-pi-editor-worktree-presentation",
    ]);
    expect(covered).toEqual(new Set([
      "extensions/answer.ts",
      "extensions/auto-session-name.ts",
      "extensions/auto-update.ts",
      "extensions/btw.ts",
      "extensions/compact-header.ts",
      "extensions/custom-footer.ts",
      "extensions/external-editor.ts",
      "extensions/git-guard.ts",
      "extensions/tool-metadata.ts",
      "extensions/worktree.ts",
    ]));
    expect(records.every((record) => record.strategy === "suppress-by-filter")).toBe(true);
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
