import { describe, expect, it } from "vitest";

const installModule = await import("../../install.mjs");
const listModule = await import("../../package-list.mjs");

const { DEFAULT_INSTALL_PROFILE, resolveInstallPackageList } = installModule;
const { CURATED_DEFAULT, PACKAGES } = listModule;

describe("installer profiles", () => {
  it("defaults to curated-default profile", () => {
    expect(DEFAULT_INSTALL_PROFILE).toBe("curated-default");
    const pkgs = resolveInstallPackageList();
    expect(pkgs).toEqual(CURATED_DEFAULT);
  });

  it("supports explicit stack-full profile", () => {
    const pkgs = resolveInstallPackageList("stack-full");
    expect(pkgs).toEqual(PACKAGES);
    expect(pkgs.length).toBeGreaterThan(CURATED_DEFAULT.length);
  });

  it("throws for unknown profile", () => {
    expect(() => resolveInstallPackageList("unknown-profile")).toThrow();
  });
});
