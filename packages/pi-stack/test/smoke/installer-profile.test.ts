import { describe, expect, it } from "vitest";

const installModule = await import("../../install.mjs");
const listModule = await import("../../package-list.mjs");

const { DEFAULT_INSTALL_PROFILE, resolveInstallPackageList } = installModule;
const { STRICT_CURATED, CURATED_DEFAULT, CURATED_RUNTIME, PACKAGES } = listModule;

describe("installer profiles", () => {
  it("defaults to strict-curated profile", () => {
    expect(DEFAULT_INSTALL_PROFILE).toBe("strict-curated");
    const pkgs = resolveInstallPackageList();
    expect(pkgs).toEqual(STRICT_CURATED);
    expect(pkgs).not.toContain("pi-lens");
  });

  it("keeps curated-default as backward-compatible alias", () => {
    const pkgs = resolveInstallPackageList("curated-default");
    expect(pkgs).toEqual(CURATED_DEFAULT);
    expect(pkgs).toEqual(STRICT_CURATED);
  });

  it("supports explicit curated-runtime profile for extras opt-in", () => {
    const pkgs = resolveInstallPackageList("curated-runtime");
    expect(pkgs).toEqual(CURATED_RUNTIME);
    expect(pkgs.length).toBeGreaterThan(STRICT_CURATED.length);
    expect(pkgs).not.toContain("pi-lens");
  });

  it("supports explicit stack-full profile", () => {
    const pkgs = resolveInstallPackageList("stack-full");
    expect(pkgs).toEqual(PACKAGES);
    expect(pkgs.length).toBeGreaterThan(CURATED_RUNTIME.length);
    expect(pkgs).toContain("pi-lens");
  });

  it("throws for unknown profile", () => {
    expect(() => resolveInstallPackageList("unknown-profile")).toThrow();
  });
});
